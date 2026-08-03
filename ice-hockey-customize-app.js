/* ==========================================================================
   LOCKER ROOM — Equipment Editor
   ==========================================================================
   Architecture (per the brief — kept as separate, named sections so a future
   Forza-style layer/decal system, UV painter, etc. can be dropped in without
   a rewrite):

     Color Utils        — hex/rgb/hsv conversion
     Asset Loader        — b64 -> ArrayBuffer, bone-name remap
     Scene Manager        — renderer / lights / podium / reflection floor
     Camera Controller    — orbit + zoom + eased preset transitions
     Character Loader     — loads the hasa1992 player + stick GLBs
     Material Manager     — palette extraction, recolor mask + shader
                              (THIS is the seam a future paint-layer /
                              decal system hooks into — see setZoneColor)
     Equipment Manager     — sidebar categories <-> right panel <-> camera
     Color Picker          — custom SV/hue picker, recent + favorites
     History Manager        — undo/redo
     Preset Manager         — save/load named loadouts (localStorage)
     Boot                   — wires it all together
   ========================================================================== */

/* ============================== COLOR UTILS ============================== */
function clamp01(v){return Math.max(0,Math.min(1,v));}
function rgbToHex(r,g,b){return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');}
function hexToRgb(hex){hex=(hex||'#000000').replace('#','');if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');
  const n=parseInt(hex,16)||0;return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};}
function rgbToHsv(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b);const d=max-min;
  let h=0;if(d!==0){if(max===r)h=(((g-b)/d)%6);else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360;}
  const s=max===0?0:d/max;const v=max;return{h,s,v};}
function hsvToRgb(h,s,v){const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let r,g,b;
  if(h<60){r=c;g=x;b=0;}else if(h<120){r=x;g=c;b=0;}else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;}else if(h<300){r=x;g=0;b=c;}else{r=c;g=0;b=x;}
  return{r:(r+m)*255,g:(g+m)*255,b:(b+m)*255};}

/* ============================== ASSET LOADER ============================== */
/* b64ToBuf + remapBoneNames + the whole recolor pipeline + the name/number
   plate renderer now live in ice-hockey-customize-core.js (loaded before this
   file), shared verbatim with the main menu's player preview so the two can
   never drift apart. */

/* ============================== SCENE MANAGER ============================== */
const viewportEl=document.getElementById('viewport');
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
if(THREE.sRGBEncoding)renderer.outputEncoding=THREE.sRGBEncoding;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
viewportEl.insertBefore(renderer.domElement, viewportEl.firstChild);

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0a0b10);
scene.fog=new THREE.Fog(0x0a0b10,6.5,15);
const camera=new THREE.PerspectiveCamera(36,1,0.05,60);

scene.add(new THREE.HemisphereLight(0x4a5a8a,0x08080d,0.6));
const keyLight=new THREE.SpotLight(0xffffff,1.5,14,Math.PI/6,0.45,1.1);
keyLight.position.set(2.3,4.2,2.6);keyLight.castShadow=true;
keyLight.shadow.mapSize.set(1024,1024);
scene.add(keyLight,keyLight.target);
const fillLight=new THREE.SpotLight(0x88aaff,0.45,14,Math.PI/5,0.6);
fillLight.position.set(-2.6,2.6,1.6);scene.add(fillLight,fillLight.target);
const rimLight=new THREE.SpotLight(0x9c7bff,1.0,14,Math.PI/6,0.55);
rimLight.position.set(0,3.1,-3.1);scene.add(rimLight,rimLight.target);

const podium=new THREE.Mesh(
  new THREE.CylinderGeometry(1.05,1.15,0.12,48),
  new THREE.MeshStandardMaterial({color:0x14151c,metalness:0.65,roughness:0.32}));
podium.position.y=0.06;podium.receiveShadow=true;scene.add(podium);
const podiumRing=new THREE.Mesh(new THREE.TorusGeometry(1.06,0.012,8,64),new THREE.MeshBasicMaterial({color:0x7c5cff}));
podiumRing.rotation.x=Math.PI/2;podiumRing.position.y=0.121;scene.add(podiumRing);

const floor=new THREE.Mesh(new THREE.CircleGeometry(9,48),
  new THREE.MeshStandardMaterial({color:0x05060a,roughness:0.18,metalness:0.75}));
floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);

let reflectionClone=null,reflectionOn=true;
function buildReflectionClone(visual){
  reflectionClone=visual.clone(true);
  reflectionClone.traverse(o=>{
    if(o.isMesh){
      o.material=o.material.clone();
      o.material.transparent=true;o.material.opacity=0.16;
      o.castShadow=false;o.receiveShadow=false;
    }
  });
  reflectionClone.scale.y*=-1;
  scene.add(reflectionClone);
}

function handleResize(){
  const w=viewportEl.clientWidth,h=viewportEl.clientHeight;
  renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();
}
addEventListener('resize',handleResize);

/* ============================== CAMERA CONTROLLER ============================== */
const CAM_PRESETS={
  full:  {yaw:0.55,pitch:0.11,dist:3.35,target:[0,0.95,0]},
  upper: {yaw:0.55,pitch:0.09,dist:2.05,target:[0,1.42,0]},
  helmet:{yaw:0.42,pitch:0.04,dist:1.15,target:[0,1.68,0]},
  gloves:{yaw:1.15,pitch:0.05,dist:1.35,target:[0.15,1.05,0]},
  pants: {yaw:0.55,pitch:0.04,dist:1.9, target:[0,0.62,0]},
  skates:{yaw:0.55,pitch:-0.04,dist:1.7,target:[0,0.18,0]},
  stick: {yaw:0.95,pitch:0.12,dist:2.05,target:[0.32,0.65,0.18]},
  free:  {yaw:0.7, pitch:0.14,dist:3.6, target:[0,1.0,0]},
};
const camState={yaw:0.55,pitch:0.11,dist:3.35,target:new THREE.Vector3(0,0.95,0)};
const camGoal={yaw:0.55,pitch:0.11,dist:3.35,target:new THREE.Vector3(0,0.95,0)};
let dragMode=null,lastPX=0,lastPY=0,currentPresetName='full';
/* Where the pointer went DOWN, and whether it has travelled far enough to be
   an orbit rather than a click on a part. A few px of slop keeps a click from
   being lost to hand tremor or a trackpad. */
let downPX=0,downPY=0,orbitMoved=false;
const CLICK_SLOP=5;
/* Pitch limits are clamped where the pitch is SET, not where the camera is
   positioned. Clamping only at the render step let camGoal.pitch keep
   integrating past the limit while the view stayed frozen: a normal upward
   drag ran it to ~8.6 rad against a 0.58 ceiling, and the camera then ignored
   1600px of downward drag before it moved again — it read as a stuck camera.
   The top limit is high enough to actually look DOWN on the crown of the
   helmet, which is what painting the top of it needs. */
const CAM_PITCH_MIN=-0.35,CAM_PITCH_MAX=1.15;
const clampPitch=p=>Math.max(CAM_PITCH_MIN,Math.min(CAM_PITCH_MAX,p));

function goToPreset(name){
  const p=CAM_PRESETS[name]||CAM_PRESETS.full;
  camGoal.yaw=p.yaw;camGoal.pitch=clampPitch(p.pitch);camGoal.dist=p.dist;
  camGoal.target.set(p.target[0],p.target[1],p.target[2]);
  currentPresetName=name;
}
function updateCamera(dt){
  const k=1-Math.pow(0.0015,Math.min(dt,0.1));
  camState.yaw+=(camGoal.yaw-camState.yaw)*k;
  camState.pitch+=(camGoal.pitch-camState.pitch)*k;
  camState.dist+=(camGoal.dist-camState.dist)*k;
  camState.target.lerp(camGoal.target,k);
  const p=camState.pitch;
  const x=camState.target.x+Math.sin(camState.yaw)*Math.cos(p)*camState.dist;
  const y=camState.target.y+Math.sin(p)*camState.dist;
  const z=camState.target.z+Math.cos(camState.yaw)*Math.cos(p)*camState.dist;
  camera.position.set(x,y,z);
  camera.lookAt(camState.target);
}
/* dragMode tracks which single interaction is active for THIS drag, decided
   once on pointerdown, so pointermove never has to guess. Middle mouse is
   reserved for camera control ALWAYS — it forces dragMode='orbit' even
   while a paint or decal tool is armed, before either of them gets a
   chance to claim the drag. (Previously the paint/decal checks ran first
   and unconditionally captured every pointerdown regardless of button, so
   a middle-click while the brush was armed painted instead of orbiting — and
   because pointermove checked `paintModeOn`/`decalMoveModeOn` rather than
   "is THIS drag actually a paint/decal drag", a middle-drag would silently
   do nothing at all once those modes were on, since it fell into the
   paint/decal branch without ever setting their per-drag flag.) */
renderer.domElement.addEventListener('pointerdown',e=>{
  /* Capture is an optimisation (it keeps a drag alive when the pointer leaves
     the canvas), not a precondition. It THROWS for a pointer the browser no
     longer considers active, and being the first statement in the handler that
     used to abort the entire interaction — no stroke, no orbit, no select. */
  try{renderer.domElement.setPointerCapture(e.pointerId);}catch(err){}
  if(e.button===1){
    dragMode='orbit';lastPX=e.clientX;lastPY=e.clientY;
    // middle-drag is always a camera move — never let it select a part
    downPX=e.clientX;downPY=e.clientY;orbitMoved=true;
    e.preventDefault();
    return;
  }
  if(isPickTool()){
    // a pick is a single click, never a drag — resolve it here and be done
    dragMode='pick';
    pickColorAt(e.clientX,e.clientY);
    return;
  }
  if(isFreehandTool()){
    dragMode='paint';
    // one drag = one layer: points accumulate on currentStroke (drawn live,
    // fast, exactly like before) and only land in the persisted layer stack
    // on pointerup — see redrawPaintLayer() for why storing POINTS instead
    // of raw pixels is what makes a stroke individually deletable/
    // reorderable/hideable and savable into presets+undo.
    currentStroke={id:newLayerId('S'),kind:'stroke',target:paintTarget,
      name:(activeTool==='erase'?'Erase':'Stroke'),color:paintBrushColor,
      size:paintBrushSize,opacity:paintBrushOpacity,hardness:paintBrushHardness,
      mode:activeTool==='erase'?'erase':'paint',visible:true,points:[]};
    const uv=raycastUV(e.clientX,e.clientY);
    if(uv){currentStroke.points.push(strokePoint(uv));paintStamp(uv,null);lastPaintUV=uv;}
    return;
  }
  if(isLineTool()){
    dragMode='line';
    lineStart={x:e.clientX,y:e.clientY};
    lineEnd={x:e.clientX,y:e.clientY};
    updateLinePreview(e.shiftKey);
    return;
  }
  /* A stamp is one click, resolved here — but it then behaves exactly like a
     decal drag, so dragging straight off the stamp slides the decal you just
     dropped into place instead of making you re-press with ✥. */
  if(isStampTool()){
    const uv=raycastUV(e.clientX,e.clientY);
    if(!uv){showToast('Click on the '+paintTargetLabel()+' itself to drop a decal');dragMode=null;return;}
    dragMode='decal';
    stampDecalAt(uv);
    return;
  }
  if(isDecalTool()&&isDecalLayer(selectedLayer())){
    dragMode='decal';
    const uv=raycastUV(e.clientX,e.clientY);
    if(uv)moveSelectedDecal(uv);
    return;
  }
  /* An orbit drag and a select click start identically — which one it was is
     only known on pointerup, from how far the pointer travelled. */
  dragMode='orbit';lastPX=e.clientX;lastPY=e.clientY;
  downPX=e.clientX;downPY=e.clientY;orbitMoved=false;
});
renderer.domElement.addEventListener('pointermove',e=>{
  // the brush ring follows the pointer whenever a paint tool is armed, drag
  // or no drag — seeing the footprint BEFORE committing is the whole point
  if(isBrushLike())updateBrushRing(e.clientX,e.clientY);
  else hideBrushRing();
  if(dragMode==='paint'){
    const uv=raycastUV(e.clientX,e.clientY);
    if(uv){if(currentStroke)currentStroke.points.push(strokePoint(uv));paintStamp(uv,lastPaintUV);lastPaintUV=uv;}
  }else if(dragMode==='line'){
    lineEnd={x:e.clientX,y:e.clientY};
    updateLinePreview(e.shiftKey);
  }else if(dragMode==='decal'){
    const uv=raycastUV(e.clientX,e.clientY);
    if(uv)moveSelectedDecal(uv);
  }else if(dragMode==='orbit'){
    if(Math.hypot(e.clientX-downPX,e.clientY-downPY)>CLICK_SLOP)orbitMoved=true;
    const dx=e.clientX-lastPX,dy=e.clientY-lastPY;lastPX=e.clientX;lastPY=e.clientY;
    camGoal.yaw-=dx*0.0068;camGoal.pitch=clampPitch(camGoal.pitch+dy*0.005);
    camState.yaw=camGoal.yaw;camState.pitch=camGoal.pitch; // direct while dragging, no lag
  }
});
addEventListener('pointerup',e=>{
  if(dragMode==='line'){
    commitLine(e&&e.shiftKey);
    hideLinePreview();
  }
  if(dragMode==='paint'&&currentStroke&&currentStroke.points.length){
    layers.push(currentStroke);
    selectedLayerIdx=layers.length-1;
    renderLayersList();renderLayerControls();
    buildSidebar(); // the Decorate rows carry a live layer count
    pushHistory();
  }
  if(dragMode==='decal')pushHistory(); // a move is one undo step, not one per sample
  /* A click that never became a drag selects the part under it. Only from the
     orbit branch: in paint or decal-move mode the click already meant
     something, and stealing it would move the panel out from under the brush. */
  if(dragMode==='orbit'&&!orbitMoved){
    const pid=raycastPiece(downPX,downPY);
    if(pid){
      const def=ihcPiece(pid);
      if(selectPieceInEditor(pid)&&def)showToast(def.icon+' '+def.label);
    }
  }
  currentStroke=null;dragMode=null;lastPaintUV=null;
});
renderer.domElement.addEventListener('wheel',e=>{
  e.preventDefault();
  if(isBrushLike()||isDecalTool()||isStampTool()){
    // dragging paints/moves a decal while either mode is on, so the wheel
    // takes over rotation instead of zoom — otherwise there'd be no way to
    // turn the model to reach the other side without leaving that mode.
    camGoal.yaw+=e.deltaY*0.0022;
    camState.yaw=camGoal.yaw;
    return;
  }
  camGoal.dist=Math.max(0.7,Math.min(6.5,camGoal.dist+e.deltaY*0.0016));
},{passive:false});
renderer.domElement.addEventListener('dblclick',()=>goToPreset(currentPresetName));

/* ============================== CHARACTER LOADER ============================== */
let player=null,stickGroup=null;
const gltfLoader=new THREE.GLTFLoader();

function placeStickRest(){
  const stickLen=1.45,mn=-0.005528158973902464,mx=1.204079031944275,flip=true;
  const scale=stickLen/(mx-mn);
  const axisSign=flip?-1:1,posSign=flip?1:-1;
  const localAxis=new THREE.Vector3(0,axisSign,0);
  const dir=new THREE.Vector3(0.30,-1,0.16).normalize();
  const tip=new THREE.Vector3(0.58,0.14,0.32);
  stickGroup.scale.setScalar(scale);
  stickGroup.quaternion.setFromUnitVectors(localAxis,dir);
  stickGroup.position.copy(tip).addScaledVector(dir,posSign*mn*scale);
  stickGroup.rotateY(1.5708);
  stickGroup.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
}

let idleT=0,swayBones=null;
function setupIdleSway(v){
  const spine=v.getObjectByName('spine_03'),head=v.getObjectByName('head');
  if(spine)spine.userData.baseQ=spine.quaternion.clone();
  if(head)head.userData.baseQ=head.quaternion.clone();
  swayBones={spine,head};
}
function animateIdle(dt){
  if(!swayBones)return;idleT+=dt;
  const s=swayBones.spine,h=swayBones.head;
  if(s&&s.userData.baseQ){
    const sw=Math.sin(idleT*0.9)*0.018;
    s.quaternion.copy(s.userData.baseQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),sw));
  }
  if(h&&h.userData.baseQ){
    const sw=Math.sin(idleT*0.9+0.4);
    h.quaternion.copy(h.userData.baseQ)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),sw*0.018))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),sw*0.012));
  }
}

function loadCharacter(cb){
  let n=0;const done=()=>{n++;if(n===2)cb();};
  gltfLoader.parse(b64ToBuf(PLAYER_B64),'',gltf=>{
    remapBoneNames(gltf.scene);
    const v=gltf.scene;
    let box=new THREE.Box3().setFromObject(v),size=new THREE.Vector3();box.getSize(size);
    const s=1.75/(size.y||1);v.scale.setScalar(s);
    box=new THREE.Box3().setFromObject(v);v.position.y=-box.min.y+0.12;
    v.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    const root=new THREE.Group();root.add(v);scene.add(root);
    player={root,visual:v,scale:s};
    ihcNoCull(v);
    setupIdleSway(v);
    buildReflectionClone(v);
    done();
  },undefined,e=>{console.error('player load failed',e);done();});
  gltfLoader.parse(b64ToBuf(STICK_B64),'',gltf=>{
    stickGroup=gltf.scene;scene.add(stickGroup);ihcNoCull(stickGroup);placeStickRest();done();
  },undefined,e=>{console.error('stick load failed',e);done();});
}

/* ============================== MATERIAL MANAGER ============================== */
/* This is the seam a future paint-layer / decal system replaces: right now
   setZoneColor() writes a flat color into a shader uniform. Later, the same
   call site could instead recomposite a layer stack into the mask texture.
   getImageDataFromTexture/extractPalette/buildMaskTexture/installRecolorShader/
   setupZoneMaterial/setupTintZone moved to ice-hockey-customize-core.js. */
/* ----- Name/Number decal + freehand paint layers (jersey/body material only) -----
   Both are separate always-on-top canvases composited in the same shader patch
   as the zone recolor (see installRecolorShader's `decals` argument): fully
   transparent until something is drawn, so the original baked "PLAYER"/"10"
   text stays visible until the user sets a custom name/number.
   DECAL_SIZE/NAME_RECT/NUMBER_RECT + the plate drawing live in core now. */
let nameNumberCanvas,nameNumberCtx,nameNumberTexture;
/* ONE decoration canvas. There used to be a second pair for the mirrored
   packing convention (see ihcPaintCanvasXY) and, until the layer stack landed,
   a separate logo canvas underneath this one — which is what hard-wired
   "decals always below paint" and left the eraser unable to touch a decal.
   Strokes and decals now flatten into this single canvas in stack order. */
let paintCanvas,paintCtx,paintTexture;
let jerseyName='',jerseyNumber='';
/* CanvasTexture custom samplers (nameNumberMap/paintMap) silently failed to
   ever reach the GPU in this material's onBeforeCompile-patched shader —
   confirmed via renderer.properties.get(tex).__webglTexture staying unset
   indefinitely, even though the identical DataTexture-based maskMap sampler
   in the SAME shader uploads and renders correctly every time. Rather than
   chase the exact three.js/ANGLE internals further, both decal layers use
   the proven-working DataTexture path instead: draw into a normal 2D canvas,
   then copy its pixels into the DataTexture's backing array. */
function makeDecalDataTexture(w,h){
  const tex=new THREE.DataTexture(new Uint8Array(w*h*4),w,h,THREE.RGBAFormat);
  tex.flipY=false;
  return tex;
}
function syncCanvasToDataTexture(ctx,canvas,tex){
  const imgData=ctx.getImageData(0,0,canvas.width,canvas.height);
  tex.image.data.set(imgData.data);
  tex.needsUpdate=true;
}
function setupDecalCanvases(){
  nameNumberCanvas=document.createElement('canvas');
  nameNumberCanvas.width=nameNumberCanvas.height=DECAL_SIZE;
  nameNumberCtx=nameNumberCanvas.getContext('2d');
  nameNumberTexture=makeDecalDataTexture(DECAL_SIZE,DECAL_SIZE);

  /* PAINT_W x PAINT_H, not square: the paint canvas holds the atlas TWICE,
     once per body side, so each half is a full-resolution square copy. */
  paintCanvas=document.createElement('canvas');
  paintCanvas.width=PAINT_W;paintCanvas.height=PAINT_H;
  paintCtx=paintCanvas.getContext('2d');
  paintTexture=makeDecalDataTexture(PAINT_W,PAINT_H);
}
let jerseyFont='Arial';
function setJerseyFont(font){
  jerseyFont=font;
  redrawNameNumber();
  pushHistory();
}
function redrawNameNumber(){
  if(!nameNumberCtx)return;
  ihcDrawNameNumber(nameNumberCtx,{
    name:jerseyName,number:jerseyNumber,font:jerseyFont,
    primary:'#'+bodyZM.zones[0].color.getHexString(),
    secondary:'#'+bodyZM.zones[1].color.getHexString(),
    trim:'#'+bodyZM.zones[2].color.getHexString(),
  });
  syncCanvasToDataTexture(nameNumberCtx,nameNumberCanvas,nameNumberTexture);
  saveToStore();
}

/* ============================== TEAM CONTEXT ============================== */
/* The editor always works on ONE context: (team, jersey set, acting role).
   TEAM-owned state (jersey colors, lettering font, team paint/decal layers)
   round-trips with the team store; PLAYER-owned state
   (name, skin, stick, personal accent layers) round-trips with the player
   kit. The game keeps reading the same flat ihGameLoadout_v1 snapshot it
   always has — ihtWriteGameLoadout() (core) recomputes it from the FAVOURITE
   context on every save, so editing a non-favourite team never changes what
   you wear in-game until you star it. */
let TSTORE=ihtLoad(),PKIT=ihtLoadKit();
let ctxTeamId=TSTORE.favourite.teamId,ctxJerseyId=TSTORE.favourite.jerseyId;
/* SOLO MODE (default ON) — see the ACTIVITIES block for the full reasoning.
   It is declared here because it decides the acting role, and the role decides
   which layer stack is the editable one on the very first load. Solo acts as
   the ADMIN: that is the role that owns the uniform design, so in solo every
   edit lands in the team design and the jersey is editable out of the box
   (as a player the editor used to open on a Jersey with zero live controls). */
let soloMode=true;
try{soloMode=localStorage.getItem('ihc.solo')!=='0';}catch(e){}
let actingRole=soloMode?'admin':'player';
/* the OTHER party's layers for the current role: replayed underneath (team
   design) or on top (player accents) but never selectable/editable */
/* The OTHER owner's layer stack — replayed underneath (team design, while a
   player edits) or on top (player accents, while an admin edits) but never
   selectable. One list now, not a stroke list plus a decal list. */
let baseLayers=[];
let suppressStore=false;
function ctxTeam(){return ihtTeam(TSTORE,ctxTeamId);}
function ctxJersey(){return ihtJersey(ctxTeam(),ctxJerseyId);}
function ctxKit(){
  const key=ihtContextKey(ctxTeamId,ctxJerseyId);
  return PKIT.contexts[key]||(PKIT.contexts[key]={});
}
function catAllowed(catId){return ihtAllowed(TSTORE,ctxTeam(),catId);}
function catLockLabel(catId){return ihtLockSource(TSTORE,ctxTeam(),catId);}
/* Every edit path already funnels through redrawNameNumber (colors, name,
   number, font via refreshSwatches) or pushHistory (paint, decals),
   and both call this — one save covers every edit site. Written back by
   ASSIGNMENT (not shared array references) because applyState/undo replaces
   the live arrays wholesale. */
/* {pieceId:[hex,...]} for every TEAM-owned piece, in that piece's own zone
   order — the shape the team store, presets, undo history and the game
   loadout all speak. */
function capturePieceColors(){
  const out={};
  TEAM_PIECE_IDS.forEach(id=>{
    const m=mgrByKey(id);
    if(m)out[id]=m.zones.map(z=>'#'+z.color.getHexString());
  });
  return out;
}
function applyPieceColors(pieces){
  if(!pieces)return;
  Object.keys(pieces).forEach(id=>{
    const m=mgrByKey(id);
    if(!m)return;
    (pieces[id]||[]).forEach((hex,i)=>{if(m.zones[i])m.zones[i].setColor(hex);});
  });
}
function saveToStore(){
  if(suppressStore||!bodyZM||!stickZM||!neckZone)return;
  const j=ctxJersey(),kctx=ctxKit();
  if(actingRole==='admin'){
    j.design.pieces=capturePieceColors();
    j.design.body=j.design.pieces.jersey.slice(); // legacy mirror of the jersey triple
    j.design.font=jerseyFont;
    j.design.layers=layers;
    /* the pre-layer-stack keys are dropped rather than left behind: a stale
       second copy of the same decoration is exactly the kind of thing a later
       reader picks up by accident */
    delete j.design.paintStrokes;delete j.design.decals;
  }else{
    PKIT.name=jerseyName;
    PKIT.skin='#'+neckZone.color.getHexString();
    kctx.stick=stickZM.zones.map(z=>'#'+z.color.getHexString());
    kctx.layers=layers;
    delete kctx.accStrokes;delete kctx.accDecals;
  }
  ihtSaveStore(TSTORE);ihtSaveKit(PKIT);
  ihtWriteGameLoadout(TSTORE,PKIT);
}
/* Pull one context's stored state into the live editor (zones, plate, layer
   stacks), pointing the editable stacks at whichever party the role owns. */
function loadContext(){
  const t=ctxTeam(),j=ctxJersey(),kctx=ctxKit();
  suppressStore=true;
  applyPieceColors(ihtDesignPieces(j.design));
  const stick=kctx.stick||PKIT.defaultStick||IHT_DEFAULT_STICK;
  stick.forEach((h,i)=>stickZM.setZoneColor(i,h));
  neckZone.setColor(PKIT.skin||'#c68863');
  jerseyName=PKIT.name||'';
  jerseyFont=j.design.font||'Arial';
  jerseyNumber=ihtEffectiveNumber(t);
  /* Both sides go through ihcDesignLayers, so a context stored before the
     layer stack existed is migrated from its old stroke+decal lists on the
     way in and saved back in the new shape on the first edit. */
  const teamLayers=ihcDesignLayers(j.design,'paintStrokes','decals');
  const kitLayers=ihcDesignLayers(kctx,'accStrokes','accDecals');
  if(actingRole==='admin'){
    layers=j.design.layers=teamLayers;
    baseLayers=kitLayers;
  }else{
    layers=kctx.layers=kitLayers;
    baseLayers=teamLayers;
  }
  selectedLayerIdx=-1;setActiveTool('orbit',true);
  redrawPaintLayer();
  suppressStore=false;
  refreshSwatches(); // also redraws the plate + saves the store once
  history.length=0;historyIdx=-1;pushHistory();
  updateContextBar();
  buildEditorModeTabs();
  selectActivity(currentActivity,currentCategory&&currentCategory.id);
}
function switchContext(teamId,jerseyId,role){
  ctxTeamId=teamId;ctxJerseyId=jerseyId;
  if(role)actingRole=role;
  if(!activitiesAvailable().some(a=>a.id===currentActivity))currentActivity='design';
  loadContext();
}
function sanitizeName(raw){
  let s=(raw||'').toUpperCase().replace(/[^A-Z -]/g,'');
  s=s.replace(/\s+/g,' ').replace(/^-+|-+$/g,'').trimStart();
  if(s.length>11)s=s.slice(0,11);
  return s;
}
function sanitizeNumber(raw){
  const digits=(raw||'').replace(/[^0-9]/g,'');
  if(digits==='')return'';
  let v=parseInt(digits,10);
  if(isNaN(v))return'';
  v=Math.max(1,Math.min(99,v));
  return String(v);
}

/* ------------------------------ TOOL RAIL ------------------------------
   One `activeTool` replaces the old pair of independent booleans
   (paintModeOn / decalMoveModeOn). Those could not both be true, but nothing
   in the type said so: each was toggled from a button in a different collapsed
   section of the right panel, each silently switched the other off, and the
   only on-screen evidence of which was active was the mouse cursor. A single
   enum makes the illegal state unrepresentable and gives the rail one thing
   to highlight. */
const TOOLS=[
  {id:'orbit',icon:'↻', key:'V',label:'Orbit',       cursor:'',
   banner:null},
  {id:'paint',icon:'🖌',key:'B',label:'Brush',       cursor:'crosshair',
   banner:'Drag on the model to paint',paint:true,decorateOnly:true},
  {id:'erase',icon:'🧽',key:'E',label:'Eraser',      cursor:'crosshair',
   banner:'Drag to rub paint off this part',paint:true,decorateOnly:true},
  {id:'line', icon:'╱', key:'L',label:'Line',        cursor:'crosshair',
   banner:'Drag from one end to the other · hold Shift to snap the angle',
   paint:true,decorateOnly:true},
  /* The decal system's ENTRY POINT. Placing a decal used to be reachable only
     from the "Stamp a shape" grid in the right panel, so on a fresh load the
     rail showed no decal button at all (✥ hides itself until something is
     already selected) and the whole feature read as missing. Stamp is armable
     from cold, and drops where you CLICK rather than at viewport centre. */
  {id:'stamp',icon:'✦', key:'S',label:'Stamp decal', cursor:'copy',
   banner:'Click the model to drop the chosen shape or logo · pick one in the bar above',
   decorateOnly:true,stamp:true},
  {id:'decal',icon:'✥', key:'M',label:'Move decal',  cursor:'move',
   banner:'Drag to move the selected decal · arrow keys nudge it',decorateOnly:true},
  {id:'pick', icon:'💧',key:'I',label:'Pick colour', cursor:'crosshair',
   banner:'Click any part to lift its colour'},
];
function toolDef(id){return TOOLS.find(t=>t.id===id)||TOOLS[0];}
let activeTool='orbit';
/* Held Space is a TEMPORARY orbit override — the single most-missed thing in
   the old paint mode was any way to turn the model without leaving the brush
   (only middle-drag worked, and nothing said so). */
let spaceOrbit=false;
/* Every predicate also asks whether the armed tool is still OFFERED. Without
   that check a tool could stay armed after the thing that offered it went away
   — switching Decorate->Design kept ✥ armed, so the pointerdown handler took
   the decal branch and swallowed the click that was supposed to select a part
   on the model. The rail correctly hid the button; hiding a button is not the
   same as disarming the tool. */
function toolLive(id){return !spaceOrbit&&activeTool===id&&toolAvailable(toolDef(id));}
/* Freehand: a drag IS the stroke. The line tool also paints, and wants the
   same brush ring and the same wheel-turns-the-model behaviour, but its drag
   only picks the two ENDS — so anything that means "this drag lays paint down
   as it moves" must ask isFreehandTool, not isBrushLike. Conflating them is
   how the line tool would paint a freehand smear on the way to its endpoint. */
function isFreehandTool(){return (toolLive('paint')||toolLive('erase'));}
function isLineTool(){return toolLive('line');}
function isBrushLike(){return isFreehandTool()||isLineTool();}
function isDecalTool(){return toolLive('decal');}
function isStampTool(){return toolLive('stamp');}
function isPickTool(){return toolLive('pick');}
let lastPaintUV=null;
/* What ✦ will drop next. Kept as a DESCRIPTION ({kind,id}) rather than a built
   layer so it survives switching parts, and so the shape picker and the logo
   picker can feed the same one slot. Defaults to the first shape, so the tool
   is usable the instant it is armed without picking anything first. */
let stampPick={kind:'shape',id:IHC_SHAPES[0].id};
/* ============================== THE LAYER STACK ==============================
   ONE ordered list of every decoration on the kit — brush strokes and placed
   decals together, bottom first, exactly like GIMP's or Forza's layer panel.

   Everything is stored as DESCRIPTION, never as pixels: a stroke keeps its UV
   point path plus the brush settings it was drawn with, a decal keeps its
   shape/logo id plus a transform. That is what makes every layer individually
   deletable, reorderable, hideable, recolourable and restretchable after the
   fact (redrawPaintLayer replays the visible ones, in order) and, as a bonus,
   small enough to round-trip through JSON — so decoration saves into presets,
   undo/redo and the game loadout instead of living only in a canvas.

   This replaced two parallel lists (paintStrokes + placedDecals) rendered into
   two textures whose order the SHADER fixed. No amount of UI could have moved
   a decal above a stroke, and the eraser could not touch a decal at all. */
let layers=[],currentStroke=null,selectedLayerIdx=-1;
function layerAt(i){return layers[i]||null;}
function selectedLayer(){return layerAt(selectedLayerIdx);}
function newLayerId(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5);}
/* `hardness` 1 = the hard round brush this always had; below 1 the dab falls
   off to transparent at its rim. Strokes saved before it existed have no
   field at all and replay as hard, so old designs are pixel-identical. */
let paintBrushColor='#ffffff',paintBrushSize=44,paintBrushOpacity=1,paintBrushHardness=1;
/* Mirroring is gone — a stroke lands on the side it was painted on, full stop.
   The per-target toggle, its two packing conventions and the uMirrorPaint
   uniform are all deleted; ihcPaintCanvasXY is now the single convention. */
const raycaster=new THREE.Raycaster();
const pointerNDC=new THREE.Vector2();
/* Paint is restricted to whichever single equipment piece is picked as the
   paint target — painting no longer touches the whole body at once. This
   also fixes a real gap: with an unrestricted raycast, clicking near the
   stick (which was never a valid paint target) fell through to whatever
   body mesh sat behind it, looking exactly like "painting one piece changes
   another". Named mesh identity was confirmed by rendering each of the 9
   body meshes in a distinct flat color: Cube=neck/collar, Cube001=jersey
   (torso+sleeves, one mesh), Cube002=pants, Cube003=gloves, Cube004=helmet
   shell, Cube005=cage, Cube006=skate boots, Cube007=blades. */
const PAINT_TARGET_MESHES={
  jersey:['Cube','Cube001'],
  pants:['Cube002'],
  gloves:['Cube003'],
  helmet:['Cube004','Cube005'],
  skates:['Cube006','Cube007'],
};
const PAINT_TARGET_LIST=[
  {id:'jersey',icon:'🏒',label:'Jersey',cam:'upper'},
  {id:'pants', icon:'🩳',label:'Pants', cam:'pants'},
  {id:'gloves',icon:'🧤',label:'Gloves',cam:'gloves'},
  {id:'helmet',icon:'⛑️',label:'Helmet',cam:'helmet'},
  {id:'skates',icon:'⛸️',label:'Skates',cam:'skates'},
];
let paintTarget='jersey';
/* Which pieces the CURRENT role may paint/decal. Admin designs the whole
   uniform. A player only ever gets small personal-accent surfaces — never
   the jersey body/logo/numbers — and each surface is policy-gated by its
   own category so teams/leagues can carve freedom as finely as they like:
   pants+gloves ride the 'accents' policy, helmet the 'helmetStyle' policy,
   skates the 'skates' policy. */
function availablePaintTargets(){
  if(soloMode||actingRole==='admin')return PAINT_TARGET_LIST;
  const ids=[];
  if(catAllowed('accents'))ids.push('pants','gloves');
  if(catAllowed('helmetStyle'))ids.push('helmet');
  if(catAllowed('skates'))ids.push('skates');
  return PAINT_TARGET_LIST.filter(t=>ids.includes(t.id));
}
function getPaintTargetMeshes(){
  const names=PAINT_TARGET_MESHES[paintTarget]||[];
  return names.map(n=>player.visual.getObjectByName(n)).filter(Boolean);
}
/* ----- skinned raycast proxy -----
   three.js r128 raycasts a SkinnedMesh against its BIND-POSE vertices:
   Mesh.raycast reads geometry.attributes.position straight off the buffer and
   never applies boneTransform. The editor's player stands in a posed,
   idle-swaying stance, so the invisible thing the ray actually hits sits well
   below the body you see. Measured on the helmet: it RENDERS spanning world Y
   1.740-2.061, its collider spans 1.581-1.870 — a 19cm drop.
   Everything below the crown still appeared to work because the two shells
   overlap enough to catch a ray (at a subtly wrong UV), but the top ~79 screen
   pixels of the helmet had no collider behind them at all, so every stroke
   there was silently swallowed — "the top of the helmet can't be painted on".
   Same family as the bind-pose bounding-sphere frustum-culling bug that hid
   the grip tape, and the fix has the same shape: mirror the skinned positions
   into a plain Mesh and raycast THAT. It shares the source uv/index buffers,
   so the stock raycaster still does its own barycentric UV interpolation and
   painting behaves exactly as before everywhere it already worked.
   Refresh is gated on the render frame: the idle sway moves the head every
   frame, so a cached pose would go stale, but re-skinning more than once per
   frame is pure waste (~1ms per target mesh). */
let paintProxyFrame=-1;
const _ppv=new THREE.Vector3();
function skinnedPaintProxy(mesh){
  if(!mesh.isSkinnedMesh||!mesh.geometry.attributes.skinIndex)return mesh;
  let p=mesh.userData._paintProxy;
  if(!p){
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(
      new Float32Array(mesh.geometry.attributes.position.count*3),3));
    if(mesh.geometry.attributes.uv)g.setAttribute('uv',mesh.geometry.attributes.uv);
    if(mesh.geometry.index)g.setIndex(mesh.geometry.index);
    // never added to the scene and never rendered — it exists only to be hit
    p=new THREE.Mesh(g,mesh.material);
    /* Carries the source mesh's NAME: a raycast hit reports the proxy, and
       callers legitimately ask the hit which mesh it belongs to (whether its
       two sides share a UV island, which piece it is). An anonymous stand-in
       would answer '' to all of them, silently. */
    p.name=mesh.name;
    p.matrixAutoUpdate=false;p.frustumCulled=false;p.visible=false;
    mesh.userData._paintProxy=p;
    mesh.userData._paintProxyFrame=-1;
  }
  if(mesh.userData._paintProxyFrame!==paintProxyFrame){
    mesh.userData._paintProxyFrame=paintProxyFrame;
    const src=mesh.geometry.attributes.position,dst=p.geometry.attributes.position;
    // boneTransform returns MESH-LOCAL skinned position (it applies
    // bindMatrixInverse last), which is exactly the space the proxy's own
    // matrixWorld then takes to world — so copying mesh.matrixWorld is right.
    for(let i=0;i<src.count;i++){mesh.boneTransform(i,_ppv);dst.setXYZ(i,_ppv.x,_ppv.y,_ppv.z);}
    dst.needsUpdate=true;
    p.geometry.computeBoundingSphere();
    p.matrix.copy(mesh.matrixWorld);p.matrixWorld.copy(mesh.matrixWorld);
  }
  return p;
}
/* Shared by the brush, the eyedropper and the brush-ring preview. Returns the
   hit UV augmented with the surface data those extras need — the ring has to
   know how big a UV-space brush is in METRES, which is a per-triangle question
   because the atlas packs different pieces at wildly different texel density.
   `_uvHit` carries the geometric extras; the returned value stays a Vector2
   with .side so every existing caller is untouched. */
let _uvHit=null;
const _uvNM=new THREE.Matrix3();
function raycastUVOnMeshes(meshes,clientX,clientY){
  _uvHit=null;
  if(!meshes.length)return null;
  const r=renderer.domElement.getBoundingClientRect();
  pointerNDC.x=((clientX-r.left)/r.width)*2-1;
  pointerNDC.y=-((clientY-r.top)/r.height)*2+1;
  raycaster.setFromCamera(pointerNDC,camera);
  const hits=raycaster.intersectObjects(meshes,false);
  if(!hits.length||!hits[0].uv)return null;
  const h=hits[0],uv=h.uv;
  // JS-side counterpart to the shader's vIhSide: which real-world side of
  // the body this hit landed on, used by the independent-sides paint
  // feature below. Local space (not world) so it agrees with the shader's
  // own local-space `position.x` regardless of camera orbit.
  uv.side=h.object.worldToLocal(h.point.clone()).x>=0?1:-1;
  /* Does this mesh keep its two sides in SEPARATE UV islands? If so the stroke
     is written into both canvas halves and the anatomical-midline slice cannot
     happen — see IHC_UV_UNIQUE_MESHES in core for the per-mesh measurements.
     The proxy shares its source mesh's name, so this reads correctly off the
     raycast hit even though the thing actually hit is the skinned stand-in. */
  uv.b=ihcMeshBothHalves(h.object.name)?1:0;
  _uvHit={point:h.point.clone(),normal:null,uvToWorld:0,object:h.object};
  if(h.face){
    _uvNM.getNormalMatrix(h.object.matrixWorld);
    _uvHit.normal=h.face.normal.clone().applyMatrix3(_uvNM).normalize();
    _uvHit.uvToWorld=faceUvToWorldScale(h.object,h.face);
  }
  return uv;
}
/* Metres of surface per 1.0 of UV, measured on the hit triangle itself: take
   one edge in world space and the same edge in UV space and divide. Measuring
   it per-face rather than assuming a global scale is what keeps the brush ring
   honest — the boot and the jersey are packed at very different densities, so
   one constant would be wrong on nearly every piece. */
function faceUvToWorldScale(obj,face){
  const g=obj.geometry,pos=g.attributes.position,uvA=g.attributes.uv;
  if(!pos||!uvA)return 0;
  const pa=new THREE.Vector3().fromBufferAttribute(pos,face.a).applyMatrix4(obj.matrixWorld);
  const pb=new THREE.Vector3().fromBufferAttribute(pos,face.b).applyMatrix4(obj.matrixWorld);
  const ua=new THREE.Vector2().fromBufferAttribute(uvA,face.a);
  const ub=new THREE.Vector2().fromBufferAttribute(uvA,face.b);
  const du=ua.distanceTo(ub);
  if(du<1e-7)return 0; // degenerate UV edge — caller falls back
  return pa.distanceTo(pb)/du;
}
function raycastUV(clientX,clientY){
  return raycastUVOnMeshes(getPaintTargetMeshes().map(skinnedPaintProxy),clientX,clientY);
}
/* ---------- click a part on the MODEL to open that part's editor ----------
   Until now the model was only ever a paint surface: the three ways to choose
   a part (sidebar category, the old paint-target strip, and clicking the
   model) each drove different state and none of them updated the others, so
   picking a part in one place left the other two pointing somewhere else.
   selectPieceInEditor is now the single entry point all three funnel into.
   This raycast deliberately does NOT reuse raycastUV: that one only tests the
   CURRENT paint target's meshes, which is exactly the set you are trying to
   change when you click something else. */
function pieceMeshMap(){
  const byMesh={};
  if(player&&player.visual)player.visual.traverse(o=>{if(o.isMesh)byMesh[o.name]=o;});
  return byMesh;
}
function raycastPiece(clientX,clientY){
  if(!player||!player.visual)return null;
  const byMesh=pieceMeshMap(),list=[];
  /* Visible meshes only. three.js r128's raycaster does NOT skip invisible
     objects (the skinned paint proxies rely on exactly that), so without this
     filter an isolated view would still let you click the parts it is hiding. */
  IHC_PIECES.forEach(def=>{const m=byMesh[def.mesh];
    if(m&&m.visible&&list.indexOf(m)<0)list.push(m);});
  if(!list.length)return null;
  const proxies=list.map(skinnedPaintProxy);
  const r=renderer.domElement.getBoundingClientRect();
  pointerNDC.x=((clientX-r.left)/r.width)*2-1;
  pointerNDC.y=-((clientY-r.top)/r.height)*2+1;
  raycaster.setFromCamera(pointerNDC,camera);
  const hits=raycaster.intersectObjects(proxies,false);
  if(!hits.length)return null;
  const src=list[proxies.indexOf(hits[0].object)];
  if(!src)return null;
  const defs=IHC_PIECES.filter(p=>p.mesh===src.name);
  if(defs.length===1)return defs[0].id;
  /* Pants and socks are ONE continuous leg mesh split at the shorts hem. The
     split is defined on the BIND pose (IHC_SPLIT_Y — the same constant the
     shader's vIhY compares against), so measure the hit triangle on the source
     mesh's untouched position attribute, NOT on the skinned proxy: the proxy
     holds posed vertices, and a raised knee would read as the wrong garment. */
  const pos=src.geometry.attributes.position,f=hits[0].face;
  if(!f||!pos)return defs[0].id;
  const y=(pos.getY(f.a)+pos.getY(f.b)+pos.getY(f.c))/3;
  const want=y>=IHC_SPLIT_Y?'above':'below';
  return (defs.find(d=>d.splitSide===want)||defs[0]).id;
}
/* piece id -> the paint target that owns its mesh (targets are a coarser
   grouping than pieces: helmet+cage are one paint surface, and so on).
   Returns null for pieces with no paint surface at all — 'laces' (Plane004)
   and 'blades'/'neck' are in no PAINT_TARGET_MESHES list, so they are
   colour-zone-only. Selecting one still opens its category; the paint target
   just stays where it was rather than being pointed at something unpaintable. */
function paintTargetForPiece(pieceId){
  const def=ihcPiece(pieceId);
  if(!def)return null;
  return Object.keys(PAINT_TARGET_MESHES)
    .find(t=>PAINT_TARGET_MESHES[t].indexOf(def.mesh)>=0)||null;
}
/* The one place a part gets selected, whoever asked. Moves the editor mode if
   the part lives in the other one, opens its category, and points the paint
   target at it so Decorate is already aimed where you just clicked. */
/* Clicking the MODEL is the primary way to choose a part now, so this has to
   land somewhere sensible from any activity. Rule: stay in the activity you
   are in if the clicked part exists there (clicking the pants while decorating
   the helmet keeps you decorating), otherwise fall back to Design, which lists
   every part. */
function selectPieceInEditor(pieceId){
  if(!pieceId)return false;
  const cat=CATEGORIES.find(c=>c.piece===pieceId)
        ||(pieceId==='neck'?CATEGORIES.find(c=>c.id==='skin'):null);
  if(!cat)return false;
  const pt=paintTargetForPiece(pieceId);
  if(pt&&availablePaintTargets().some(t=>t.id===pt))paintTarget=pt;
  if(categoriesForActivity(currentActivity).some(c=>c.id===cat.id)){
    selectCategory(cat.id);
    return true;
  }
  /* Decorating and you clicked a surface that has no paint layer of its own
     (cage, laces, blades)? Those meshes belong to a paintable target, so
     retarget to the owning surface rather than yanking the user out of the
     activity they chose. */
  if(currentActivity==='decorate'&&pt){
    const owner=decorateCategories().find(c=>c.id===pt);
    if(owner&&categoriesForActivity('decorate').some(c=>c.id===owner.id)){
      selectCategory(owner.id);
      return true;
    }
  }
  selectActivity('design',cat.id);
  return true;
}
/* stampSegment/ihcPaintCanvasXY/SEAM_JUMP_UV + stroke/decal replay moved to
   core (the menu preview replays the exact same stored layers). */
function paintStamp(uv,prevUV){
  const layered=paintNeedsStackLayers();
  /* Stamping trusts what is already in the layer canvases. If they have never
     been filled (or were last used in single-stack mode) replay both stacks
     first, or the other party's paint would silently vanish behind this drag. */
  if(layered&&!paintStackLayersValid)redrawPaintLayer();
  /* Layered: stamp into the EDITING stack's own canvas, never the flattened
     one — that containment is the whole point, and a live erase drag is
     exactly the case that used to eat through to the other party's strokes.
     Unlayered: the flattened canvas IS the only stack, so stamp straight
     into it (one fewer blit per pointermove). */
  let ctx,cvs,tex;
  if(layered){
    const L=ensurePaintStackLayers();
    ctx=(activeStackIsAbove()?L.above:L.below).ctx;
  }else{
    ctx=paintCtx;cvs=paintCanvas;tex=paintTexture;
  }
  /* The live drag must land on exactly the pixels the stored stroke will
     replay onto, so it goes through the same ihcHalves() the replay does —
     that is what makes a dual-half (jersey/cage) stroke continuous across the
     chest DURING the drag and not just after the next redraw. */
  const halves=ihcHalves(uv);
  // a side change mid-drag (e.g. dragging across the crotch from one leg to
  // the other) is ALWAYS a seam crossing, even if the raw UV looks continuous
  // — the two sides land on opposite halves of the canvas. A change in
  // dual-ness is a seam for the same reason.
  const sameHalves=prevUV&&!!prevUV.b===!!uv.b&&(uv.b||(prevUV.side>=0)===(uv.side>=0));
  const seamJump=!!prevUV&&(Math.hypot(uv.x-prevUV.x,uv.y-prevUV.y)>SEAM_JUMP_UV||!sameHalves);
  halves.forEach(h=>{
    const xy=ihcPaintCanvasXY(uv,h);
    const pxy=(prevUV&&!seamJump)?ihcPaintCanvasXY(prevUV,h):null;
    stampSegment(ctx,xy.x,xy.y,pxy?pxy.x:null,pxy?pxy.y:null,
      paintBrushSize,paintBrushColor,paintBrushOpacity,seamJump,
      {mode:currentStroke&&currentStroke.mode,hardness:paintBrushHardness});
  });
  if(layered)compositePaintLayers();
  else syncCanvasToDataTexture(ctx,cvs,tex);
}
/* One recorded drag sample. `b` (both halves) rides along per point rather
   than per stroke because a single drag can cross from a mesh whose sides
   share a UV island onto one whose sides don't. */
function strokePoint(uv){
  return uv.b?{x:uv.x,y:uv.y,side:uv.side,b:1}:{x:uv.x,y:uv.y,side:uv.side};
}
/* ------------------------------ EYEDROPPER ------------------------------
   Deliberately does NOT sample the framebuffer: the pixel on screen is lit,
   shadowed and tone-mapped, so picking a "white" jersey would hand back a
   grey. It samples the same three sources the SHADER composites, in the same
   order it composites them, and returns the authored colour:
       paint canvas  ->  logo canvas  ->  the piece's zone palette
   so a pick always round-trips exactly to the value that produced it. */
function pickColorAt(clientX,clientY){
  const pid=raycastPiece(clientX,clientY);
  if(!pid){showToast('Nothing under the cursor to pick from');return null;}
  const def=ihcPiece(pid);
  const mesh=def?pieceMeshMap()[def.mesh]:null;
  if(!mesh){showToast('Nothing under the cursor to pick from');return null;}
  const uv=raycastUVOnMeshes([skinnedPaintProxy(mesh)],clientX,clientY);
  if(!uv){showToast('Nothing under the cursor to pick from');return null;}

  const target=ihcTargetForPieceId(pid);
  const hex=(target?pickFromDecalCanvas(uv,target):null)||pickFromZoneMask(pid,uv);
  if(!hex){showToast('No colour to pick there');return null;}
  applyPickedColor(hex,def);
  return hex;
}
/* Decoration sits above the recoloured base — one flattened canvas now, so
   whatever is topmost in the layer stack is already the pixel here. */
function pickFromDecalCanvas(uv,target){
  if(!paintCtx)return null;
  const xy=ihcPaintCanvasXY(uv,ihcHalves(uv)[0]);
  const px=Math.max(0,Math.min(PAINT_W-1,Math.round(xy.x)));
  const py=Math.max(0,Math.min(PAINT_H-1,Math.round(xy.y)));
  const d=paintCtx.getImageData(px,py,1,1).data;
  if(d[3]>24)return rgbToHex(d[0],d[1],d[2]);
  return null;
}
/* The mask is the same DataTexture the fragment shader reads: R/G/B flag zone
   0/1/2 and a fully black texel means "not recoloured" (a fixed/baked colour
   the editor has no slider for). */
function pickFromZoneMask(pid,uv){
  const mgr=mgrByKey(pid);
  if(!mgr||!mgr.material)return null;
  const ref=mgr.material.userData.shaderRef;
  const mask=ref&&ref.uniforms&&ref.uniforms.maskMap&&ref.uniforms.maskMap.value;
  if(!mask||!mask.image||!mask.image.data)return null;
  const w=mask.image.width,h=mask.image.height,data=mask.image.data;
  const x=Math.max(0,Math.min(w-1,Math.floor(uv.x*w)));
  // flipY is false on this texture, so v maps straight to the row index
  const y=Math.max(0,Math.min(h-1,Math.floor(uv.y*h)));
  const o=(y*w+x)*4;
  let zone=-1;
  if(data[o]>127)zone=0;else if(data[o+1]>127)zone=1;else if(data[o+2]>127)zone=2;
  if(zone<0||!mgr.zones[zone])return null;
  return'#'+mgr.zones[zone].color.getHexString();
}
function applyPickedColor(hex,def){
  addRecent(hex);
  /* If the colour picker is open on a zone, the pick goes THERE — that is the
     whole "make the gloves match the jersey trim" workflow in one gesture
     instead of pick, memorise six hex digits, retype. With it closed the pick
     loads the brush, which is what Decorate wants. */
  const cp=document.getElementById('colorPicker');
  if(cp&&cp.classList.contains('open')){
    setPickerHex(hex);
    showToast('💧 '+hex.toUpperCase()+' → '+(def?def.label:'selection'));
    return;
  }
  paintBrushColor=hex;
  renderToolOptions();
  const sw=document.getElementById('paintColorSwatch');
  if(sw)sw.style.background=hex;
  showToast('💧 Picked '+hex.toUpperCase()+' from the '+(def?def.label.toLowerCase():'model')+' — now the brush colour');
}

/* ------------------------------ BRUSH RING ------------------------------
   A world-space ring the size of the actual footprint, lying on the surface.
   Without it the brush size slider is a number with no referent: you find out
   how big 44 is by painting 44 and undoing. */
let brushRing=null;
function ensureBrushRing(){
  if(brushRing)return brushRing;
  brushRing=new THREE.Mesh(
    new THREE.RingGeometry(0.92,1,48),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.85,
      side:THREE.DoubleSide,depthTest:false}));
  brushRing.renderOrder=999; // always on top; it is a cursor, not geometry
  brushRing.visible=false;
  scene.add(brushRing);
  return brushRing;
}
function hideBrushRing(){if(brushRing)brushRing.visible=false;}
const _ringLook=new THREE.Vector3();
function updateBrushRing(clientX,clientY){
  const ring=ensureBrushRing();
  const uv=raycastUV(clientX,clientY);
  if(!uv||!_uvHit||!_uvHit.normal||!_uvHit.uvToWorld){ring.visible=false;return;}
  /* Brush size is quoted in ATLAS texels, and each half of the paint canvas is
     a full-resolution square copy of the atlas, so the footprint is genuinely
     round in UV and this ring is exact on both axes. (It was not, while the
     canvas was 2048² and each half only 1024 wide — the real footprint was
     2:1 and the ring showed the vertical extent only.) */
  const radiusUV=(paintBrushSize/2)/DECAL_SIZE;
  const r=radiusUV*_uvHit.uvToWorld;
  if(!(r>0)||!isFinite(r)){ring.visible=false;return;}
  ring.scale.setScalar(Math.max(r,0.002));
  // lift it off the surface so it isn't z-fought into the mesh it describes
  ring.position.copy(_uvHit.point).addScaledVector(_uvHit.normal,0.004);
  _ringLook.copy(ring.position).add(_uvHit.normal);
  ring.lookAt(_ringLook);
  ring.material.color.set(activeTool==='erase'?0xffb454:paintBrushColor);
  ring.visible=true;
}

/* ------------------------------ LINE TOOL ------------------------------
   Drag from one end to the other; the paint lands on release.

   The line is laid down by RE-RAYCASTING along the screen-space segment, not
   by interpolating between two UVs. Interpolating UV would only be right on a
   flat, unwrapped-linearly patch: across a shoulder or around a sleeve the two
   endpoints' UVs are not connected by a straight line in texture space, and
   the "line" would bow away from the surface it was drawn on — or, across a
   UV seam, shoot across the atlas. Sampling the screen segment asks the model
   where each step actually is, so the result follows the surface and reuses
   the same seam/side/dual-half handling every freehand stroke gets.

   The preview is a world-space segment between the two hit POINTS, drawn on
   top of everything: cheap, and it shows where the ends landed on the mesh
   rather than where the cursor is in the air. */
let lineStart=null,lineEnd=null,linePreview=null;
const LINE_STEP_PX=4;      // one sample per 4 screen px
const LINE_MAX_SAMPLES=260;
/* Shift snaps to 45° increments, measured in SCREEN space — the same thing
   every 2D editor does, and the only frame the user is actually aiming in. */
function lineEndPoint(shift){
  if(!lineStart||!lineEnd)return lineEnd;
  if(!shift)return lineEnd;
  const dx=lineEnd.x-lineStart.x,dy=lineEnd.y-lineStart.y;
  const len=Math.hypot(dx,dy);
  if(len<1)return lineEnd;
  const step=Math.PI/4;
  const a=Math.round(Math.atan2(dy,dx)/step)*step;
  return{x:lineStart.x+Math.cos(a)*len,y:lineStart.y+Math.sin(a)*len};
}
function ensureLinePreview(){
  if(linePreview)return linePreview;
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
  linePreview=new THREE.Line(g,new THREE.LineBasicMaterial({
    color:0xffffff,transparent:true,opacity:0.95,depthTest:false}));
  linePreview.renderOrder=999; // it is a cursor, not geometry
  linePreview.frustumCulled=false;
  linePreview.visible=false;
  scene.add(linePreview);
  return linePreview;
}
function hideLinePreview(){
  if(linePreview)linePreview.visible=false;
  lineStart=lineEnd=null;
}
function updateLinePreview(shift){
  const pv=ensureLinePreview();
  const end=lineEndPoint(shift);
  const meshes=getPaintTargetMeshes().map(skinnedPaintProxy);
  const a=raycastUVOnMeshes(meshes,lineStart.x,lineStart.y)?_uvHit.point.clone():null;
  const b=raycastUVOnMeshes(meshes,end.x,end.y)?_uvHit.point.clone():null;
  if(!a||!b){pv.visible=false;return;}
  const p=pv.geometry.attributes.position;
  p.setXYZ(0,a.x,a.y,a.z);p.setXYZ(1,b.x,b.y,b.z);
  p.needsUpdate=true;
  pv.geometry.computeBoundingSphere();
  pv.material.color.set(paintBrushColor);
  pv.visible=true;
}
function commitLine(shift){
  if(!lineStart||!lineEnd)return;
  const end=lineEndPoint(shift);
  const dist=Math.hypot(end.x-lineStart.x,end.y-lineStart.y);
  const meshes=()=>getPaintTargetMeshes().map(skinnedPaintProxy);
  const n=Math.max(1,Math.min(LINE_MAX_SAMPLES,Math.ceil(dist/LINE_STEP_PX)));
  const stroke={id:newLayerId('S'),kind:'stroke',target:paintTarget,name:'Line',
    color:paintBrushColor,size:paintBrushSize,opacity:paintBrushOpacity,
    hardness:paintBrushHardness,mode:'paint',visible:true,points:[]};
  for(let i=0;i<=n;i++){
    const t=i/n;
    const uv=raycastUVOnMeshes(meshes(),
      lineStart.x+(end.x-lineStart.x)*t, lineStart.y+(end.y-lineStart.y)*t);
    if(uv)stroke.points.push(strokePoint(uv));
  }
  /* A click with no drag is a single dab, which is a legitimate thing to want
     from the line tool; a drag that hit nothing at all is not a layer. */
  if(!stroke.points.length){showToast('That line missed the '+paintTarget);return;}
  layers.push(stroke);
  selectedLayerIdx=layers.length-1;
  redrawPaintLayer();
  renderLayersList();renderLayerControls();
  buildSidebar();
  pushHistory();
}

/* Full reconstruction from the stored stroke lists — needed any time a STACK
   changes shape (delete/reorder/hide/undo), as opposed to live dragging which
   just stamps incrementally onto the existing canvas. Draw order is fixed by
   OWNERSHIP, not by who's editing: team design strokes first, the player's
   personal accents on top of them — so both roles see the same jersey. */
function paintStackOrder(active,base){
  return actingRole==='admin'?[active,base]:[base,active];
}
/* ---------------------- OWNERSHIP-SEPARATED PAINT LAYERS ----------------------
   Both stacks used to be replayed into ONE canvas, bottom stack first. That is
   correct for opaque paint and WRONG the moment a stroke erases: an erase
   stroke composites destination-out against whatever pixels are already on the
   canvas, so a player rubbing out their own accent also rubbed out the team
   stroke underneath it — the player could destroy team design they are not even
   allowed to recolour, and it survived into the saved store because the erase
   stroke replays the same way on every reload.

   Each ownership stack now composites into its own canvas and the two are
   flattened with drawImage, so an erase can only ever reach pixels its own
   stack put down. Which stack sits on top is still paintStackOrder's call —
   this only changes WHERE each one is drawn, never the order.

   Allocated lazily: with no second stack (solo mode, and any context where the
   other party has painted nothing) the original single-canvas path is used
   unchanged, so the common case pays neither the memory nor the extra blit. */
let paintStackLayers=null;
/* Whether below/above currently hold a faithful replay of the two stacks.
   paintStamp draws into them incrementally and trusts what is already there,
   so it must never run against layers that were merely allocated. */
let paintStackLayersValid=false;
function makeLayerSurface(){
  const c=document.createElement('canvas');
  c.width=PAINT_W;c.height=PAINT_H;
  return{canvas:c,ctx:c.getContext('2d')};
}
function ensurePaintStackLayers(){
  if(!paintStackLayers){
    paintStackLayers={below:makeLayerSurface(),above:makeLayerSurface()};
  }
  return paintStackLayers;
}
/* True when there is a second stack to keep separate. */
function paintNeedsStackLayers(){return baseLayers.length>0;}
/* Is the stack the user is EDITING the upper one? Derived from paintStackOrder
   rather than re-testing the role, so there is one definition of the order. */
const _stackProbeActive={},_stackProbeBase={};
function activeStackIsAbove(){
  return paintStackOrder(_stackProbeActive,_stackProbeBase)[1]===_stackProbeActive;
}
/* Flattens below+above into the GPU-bound canvas and uploads it. Live drags
   call this per pointermove, and syncCanvasToDataTexture is a full 2048²
   readback, so it stays as small as it can be. */
function compositePaintLayers(){
  const L=ensurePaintStackLayers();
  paintCtx.clearRect(0,0,PAINT_W,PAINT_H);
  paintCtx.globalAlpha=1;paintCtx.globalCompositeOperation='source-over';
  paintCtx.drawImage(L.below.canvas,0,0);
  paintCtx.drawImage(L.above.canvas,0,0);
  syncCanvasToDataTexture(paintCtx,paintCanvas,paintTexture);
}
function redrawPaintLayer(){
  if(!paintCtx)return;
  paintCtx.clearRect(0,0,PAINT_W,PAINT_H);
  if(!paintNeedsStackLayers()){
    /* One stack only — nothing an erase could reach across, so composite
       straight into the final canvas. */
    paintStackLayersValid=false;
    ihcReplayLayers(paintCtx,layers,logoLibrary);
    syncCanvasToDataTexture(paintCtx,paintCanvas,paintTexture);
    return;
  }
  const L=ensurePaintStackLayers();
  const order=paintStackOrder(layers,baseLayers);
  L.below.ctx.clearRect(0,0,PAINT_W,PAINT_H);
  L.above.ctx.clearRect(0,0,PAINT_W,PAINT_H);
  ihcReplayLayers(L.below.ctx,order[0],logoLibrary);
  ihcReplayLayers(L.above.ctx,order[1],logoLibrary);
  paintStackLayersValid=true;
  compositePaintLayers();
}

let bodyZM=null,stickZM=null,neckZone=null,PIECES=null;
function buildMaterialManagers(){
  setupDecalCanvases();
  /* EVERY equipment piece gets its own material + its own zone palette,
     clustered from only the atlas pixels that piece actually uses (see
     ihcBuildPieceKit in core). Before this, all nine body meshes shared ONE
     material and one atlas-wide mask, so "Socks · Primary" and "Jersey ·
     Primary" were the same slider — changing one changed the whole kit. */
  PIECES=ihcBuildPieceKit(player.visual,
    {nameNumberMap:nameNumberTexture,paintMap:paintTexture});
  bodyZM=PIECES.jersey; // the jersey is still what the name/number plate reads its colors from

  /* "Neck" (mesh "Cube") is the only exposed-skin-adjacent geometry this
     model has — there is NO separate face/skin texture anywhere: the color
     histogram of the whole atlas has zero skin-tone clusters, and an
     untextured clay render of the head shows an empty/dark cavity behind
     the cage bars, not a face. The helmet+cage cover the whole head, so
     "head skin color" genuinely has nothing to attach to on this asset —
     Neck is the closest honest, real, independently-colorable stand-in. */
  neckZone=PIECES.neck.zones[0];
  // default to a realistic skin tone rather than the auto-extracted collar
  // navy — the auto-extraction just classifies this mesh's baked color,
  // which happens to match the jersey collar since there's no real skin
  // pixel anywhere in the texture (see the note above).
  neckZone.setColor('#c68863');

  /* stick geometry is 3 separate mesh objects sharing ONE material by default
     (confirmed via an isolated color-coded render): "Plane001" is the long
     shaft+blade body, "Plane002" a small blade-tape wrap, "Plane005" a small
     grip-tape wrap near the handle. Sharing one material is exactly why grip
     tape used to "use whatever the rest of the stick used" — cloning a
     material per part is the fix, each independently colorable. */
  const meshMain=stickGroup.getObjectByName('Plane001');
  const meshBladeTape=stickGroup.getObjectByName('Plane002');
  const meshGripTape=stickGroup.getObjectByName('Plane005');
  meshBladeTape.material=meshBladeTape.material.clone();
  meshGripTape.material=meshGripTape.material.clone();
  /* Shaft vs blade is split by GEOMETRY, not by clustering this material's
     texture — the shaft mesh's UVs only ever sample the texture's black
     region, so the old two-cluster split left the Blade swatch dead. See
     setupStickZones in core. */
  const shaftBladeMgr=setupStickZones(meshMain.material);
  const gripTapeZone=setupTintZone(meshGripTape.material,'Grip Tape');
  const bladeTapeZone=setupTintZone(meshBladeTape.material,'Blade Tape');
  const zones=[shaftBladeMgr.shaft,shaftBladeMgr.blade,gripTapeZone,bladeTapeZone];
  stickZM={
    material:meshMain.material,
    zones,
    setZoneColor(i,hex){ if(zones[i])zones[i].setColor(hex); },
  };
}

/* ============================== EQUIPMENT MANAGER ============================== */
/* Two editors, matching how a real roster is actually organized: TEAM
   properties (uniform colors, name/number, logos) are shared across every
   player on the roster, while PLAYER properties (stick, skin tone) belong
   to one individual and stay with them regardless of which team/jersey
   they're wearing. */
/* ---------------------------- ACTIVITIES ----------------------------
   The old top-level nav was three tabs (Team Uniform / Player / Team Admin)
   whose membership changed with a SEPARATE role toggle in the top bar — so
   "Team Admin" named both a tab and a role, and which parts you could see
   depended on two controls that looked unrelated. It also split by WHO OWNS
   a part, which is an ownership question the user has to already understand
   before they can find anything.

   Nav is split by WHAT YOU ARE DOING instead, the way every livery/config
   editor does it:
     DESIGN   — colours and materials of a part
     DECORATE — paint, decals and logos on a part
     TEAM     — numbers, roster, league rules (only when solo mode is off)
   The same part (Helmet) exists in both Design and Decorate and is the same
   category object, so switching activity keeps the camera and the part. */
const ACTIVITIES=[
  {id:'design',  label:'Design',  icon:'🎨',  hint:'Colours & material'},
  {id:'decorate',label:'Decorate',icon:'🖌',  hint:'Paint, decals, logos'},
  {id:'team',    label:'Team',    icon:'🛡️', hint:'Numbers & rules'},
];
/* SOLO MODE (declared up in TEAM CONTEXT, default ON): there is no server, no
   real roster and no second human — so out of the box the whole player-vs-admin
   permission layer is noise that shipped a locked, uneditable Jersey as the
   very first screen. Solo hides the roles, the number-approval round trip and
   the policy matrix; switching it off restores all of it untouched. */
function activitiesAvailable(){
  return soloMode?ACTIVITIES.filter(a=>a.id!=='team'):ACTIVITIES;
}
let currentActivity='design';
/* One category per real equipment PIECE — each drives only its own mesh's
   material now (`piece` is the id in IHC_PIECES/core), so socks recolor
   socks and nothing else. Pieces whose baked texture only ever had one color
   (helmet shell, cage, boot, laces, blade steel) honestly show one zone
   rather than three sliders that would move nothing. */
/* `mode` is the OWNERSHIP tag (whose data this part lives in — team design vs
   personal kit) and still drives permissions. `act` is which nav ACTIVITY the
   part appears under, which is a separate question: a jersey is team-owned
   (mode) but you both design and decorate it (act). */
const CATEGORIES=[
  {id:'jersey',label:'Jersey', icon:'🏒',cam:'upper', group:'body',piece:'jersey',mode:'team'},
  {id:'helmet',label:'Helmet', icon:'⛑️',cam:'helmet',group:'body',piece:'helmet',mode:'team'},
  {id:'cage',  label:'Cage',   icon:'🥅',cam:'helmet',group:'body',piece:'cage',  mode:'team'},
  {id:'gloves',label:'Gloves', icon:'🧤',cam:'gloves',group:'body',piece:'gloves',mode:'team'},
  {id:'pants', label:'Pants',  icon:'🩳',cam:'pants', group:'body',piece:'pants', mode:'team'},
  {id:'socks', label:'Socks',  icon:'🧦',cam:'pants', group:'body',piece:'socks', mode:'team',
   note:'Socks and pants are one continuous leg mesh on this rig — they are split at the shorts hem, so this recolors only the sock below it.'},
  {id:'skates',label:'Skates', icon:'⛸️',cam:'skates',group:'body',piece:'skates',mode:'team'},
  {id:'laces', label:'Laces',  icon:'🪢',cam:'skates',group:'body',piece:'laces', mode:'team',
   note:'The lace straps across each boot are their own little meshes — colorable independently of the boot.'},
  {id:'blades',label:'Blades', icon:'🔪',cam:'skates',group:'body',piece:'blades',mode:'team'},
  {id:'skin',  label:'Skin',   icon:'🧑',cam:'helmet',group:'skin',mode:'player',
   note:'This model has no separate face/skin texture — the helmet+cage cover the whole head with no exposed geometry behind the bars. "Skin" recolors the one real stand-in this rig has: the neck/collar-trim sliver between helmet and jersey.'},
  {id:'stick', label:'Stick',  icon:'🏑',cam:'stick', group:'stick',mode:'player'},
  /* Name & number belong to the PERSON, not the jersey — a player keeps
     their name/number when traded to a different team/uniform. Moved out
     of Player mode's Skin/Stick company for a real roster reason: a team
     can only field one of each number, so ownership needs to sit with
     whoever's actually being customized (the player), with the team layer
     (once a real roster exists) allowed to veto/reassign a conflicting
     number — see the note rendered in this category for the honest
     current-vs-intended state (no roster/conflict system exists yet, this
     is a single player being edited, not a squad). */
  {id:'nameplate',label:'Name & Number', icon:'🔢',cam:'upper',group:'nameplate',mode:'player'},
  /* Team Admin tools — only reachable while acting as admin. */
  {id:'roster',  label:'Numbers & Roster', icon:'🔢',cam:'upper',group:'roster',  mode:'admin',act:'team'},
  {id:'policies',label:'Player Freedom',   icon:'⚖️',cam:'full', group:'policies',mode:'admin',act:'team'},
];
/* Everything that isn't an admin tool is a part you design. */
CATEGORIES.forEach(c=>{if(!c.act)c.act='design';});
/* Decorate lists only surfaces that actually have a paint/decal layer. Those
   are the five PAINT TARGETS, and their ids happen to be exactly five
   category ids — so Decorate reuses the very same category objects rather
   than inventing a parallel list that could drift out of sync (the old
   "Paint Target" strip was exactly that kind of second, disagreeing list). */
function decorateCategories(){
  return CATEGORIES.filter(c=>PAINT_TARGET_LIST.some(t=>t.id===c.id));
}
function categoriesForActivity(act){
  if(act==='decorate')return decorateCategories().filter(categoryPaintable);
  return CATEGORIES.filter(c=>c.act===act);
}
const SKIN_TONES=['#3d2314','#5c3a21','#8d5a34','#c68863','#e0ac69','#f1c27d','#ffdbac','#f5dbc5'];
const QUICK_PALETTES=[
  {name:'Original',  colors:['#020c3d','#4c0a16','#ffffff']},
  {name:'Away',      colors:['#f2f2f2','#0c2340','#a6192e']},
  {name:'Blackout',  colors:['#0a0a0c','#1c1c22','#3a3a44']},
  {name:'Ice Blue',  colors:['#0d3b66','#3fa9e6','#ffffff']},
  {name:'Alternate', colors:['#4b3a52','#3f7a6e','#f0f0f0']},
  {name:'Sunrise',   colors:['#7a1224','#ff9a3c','#111319']},
];
let currentCategory=CATEGORIES.find(c=>c.act==='design');

function buildEditorModeTabs(){
  const wrap=document.getElementById('editorModeTabs');
  wrap.innerHTML='';
  activitiesAvailable().forEach(a=>{
    const el=document.createElement('div');
    el.className='editor-mode-tab'+(a.id===currentActivity?' active':'');
    el.dataset.mode=a.id;
    el.innerHTML=`<span class="em-icon">${a.icon}</span>${a.label}<span class="em-hint">${a.hint}</span>`;
    el.addEventListener('click',()=>selectActivity(a.id));
    wrap.appendChild(el);
  });
}
const ACTIVITY_HEADINGS={design:'Parts',decorate:'Surfaces',team:'Team Admin'};
/* `keepPart` lets a part survive an activity switch: flipping Design→Decorate
   on the helmet should stay on the helmet, not jump back to the first row. */
function selectActivity(act,keepPart){
  const list=categoriesForActivity(act);
  if(!list.length){showToast('Nothing to do here on this team');return;}
  currentActivity=act;
  document.querySelectorAll('.editor-mode-tab').forEach(el=>el.classList.toggle('active',el.dataset.mode===act));
  document.getElementById('sbHeading').textContent=ACTIVITY_HEADINGS[act]||'Parts';
  const want=keepPart&&list.some(c=>c.id===keepPart)?keepPart:null;
  if(!want&&!list.some(c=>c.id===currentCategory.id))currentCategory=list[0];
  buildSidebar();
  syncToolRail();
  selectCategory(want||currentCategory.id);
}
/* A part has TWO independent permissions, and conflating them is what used to
   leave a player staring at a kit where every part said 🔒 and the only way in
   was a separate "Decals & Paint" category:
     colours/material — the team's uniform design, admin only
     paint/decals     — the player's own accents, per team/league policy
   A player may well be allowed to paint a helmet they cannot recolour. */
function categoryColorEditable(cat){
  if(soloMode)return cat.mode!=='admin'; // solo: every part is yours
  if(actingRole==='admin')return cat.mode==='team'||cat.mode==='admin';
  if(cat.mode==='player'){
    if(cat.id==='stick')return catAllowed('stick');
    return true; // skin + nameplate are always the player's own
  }
  return false; // uniform design is team-controlled
}
function categoryPaintable(cat){
  if(!cat.piece)return false;
  const pt=paintTargetForPiece(cat.piece);
  return !!pt&&availablePaintTargets().some(t=>t.id===pt);
}
/* Drives the sidebar's 🔒 chip: unlocked if there is ANYTHING to do here. */
function categoryEditable(cat){
  return categoryColorEditable(cat)||categoryPaintable(cat);
}
function buildSidebar(){
  const list=document.getElementById('sbList');
  list.innerHTML='';
  categoriesForActivity(currentActivity).forEach(cat=>{
    const el=document.createElement('div');
    el.className='sb-item'+(cat.id===currentCategory.id?' active':'');
    el.dataset.cat=cat.id;
    /* In Decorate the row's chip counts what is actually ON that surface —
       a layer count is far more use there than a padlock, and Decorate only
       ever lists surfaces you are already allowed to touch. */
    let chip='';
    if(currentActivity==='decorate'){
      const n=layerCountForTarget(cat.id);
      if(n)chip=`<div class="sb-chip">${n}</div>`;
    }else if(!categoryEditable(cat))chip='<div class="sb-chip">🔒</div>';
    el.innerHTML=`<div class="sb-icon">${cat.icon}</div><div class="sb-label">${cat.label}</div>${chip}`;
    el.addEventListener('click',()=>selectCategory(cat.id));
    list.appendChild(el);
  });
}
function layerCountForTarget(targetId){
  return layers.filter(L=>L.target===targetId).length;
}
function selectCategory(id){
  currentCategory=CATEGORIES.find(c=>c.id===id)||CATEGORIES[0];
  /* The part you open IS the paint target. This is the whole reason the old
     "Paint Target" strip could disagree with the sidebar — two selections, no
     link. Only moves when the part actually has a paint surface, so opening
     Laces or Blades leaves the brush where it was rather than pointing it at
     something unpaintable. */
  if(currentCategory.piece){
    const pt=paintTargetForPiece(currentCategory.piece);
    if(pt&&availablePaintTargets().some(t=>t.id===pt))paintTarget=pt;
  }
  document.querySelectorAll('.sb-item').forEach(el=>el.classList.toggle('active',el.dataset.cat===id));
  goToPreset(currentCategory.cam);
  applyPartIsolation();
  renderRightPanel();
  syncToolRail();
}

/* ---------------------- PART ISOLATION ----------------------
   Opening a part's editor focuses that part. Categories that aren't about one
   piece (Stick, roster, policies) keep the whole player, because you need the
   body to aim at.

   THREE TIERS, not two. A skate is a boot + laces + blade steel, and a helmet
   is a shell + cage: they are separate EDITORS but one physical item of gear,
   and you cannot judge a lace colour against a boot that has been ghosted out
   from under it. So the assembly (IHC_ASSEMBLIES in core) stays clearly
   readable while its edited member is solid, and only unrelated gear drops to
   the faint ghost:
       edited piece      opacity 1.00   (untouched material)
       assembly siblings opacity 0.55   (present, obviously not the subject)
       everything else   opacity 0.13   (context + a raycast surface)

   Pants and socks are ONE mesh with ONE material, so neither of those opacity
   tiers can separate them. They used to be isolated with a world-space
   CLIPPING PLANE at the shorts hem, which DELETED the sibling half — the same
   complaint one level down. The fade is now per-fragment in the recolor shader
   instead (uGhostMode/uGhostAlpha, keyed off the vIhY the split already uses),
   so socks-under-edit leaves the pants standing at sibling opacity. */
let isolationOn=true;
function pieceIsolationTarget(){
  if(!isolationOn||!currentCategory)return null;
  return currentCategory.piece||(currentCategory.id==='skin'?'neck':null);
}
const GHOST_OPACITY=0.13;
const SIBLING_OPACITY=0.55;
/* opacity===null restores the material's own captured base. */
function setPieceGhost(m,opacity){
  const mat=m.material;
  if(!mat)return;
  if(m.userData._ghostBase===undefined){
    m.userData._ghostBase={transparent:mat.transparent,opacity:mat.opacity,
      depthWrite:mat.depthWrite,colorWrite:mat.colorWrite};
  }
  const b=m.userData._ghostBase;
  if(opacity===null||opacity===undefined){
    mat.transparent=b.transparent;mat.opacity=b.opacity;mat.depthWrite=b.depthWrite;
  }else{
    mat.transparent=true;mat.opacity=opacity;
    /* Siblings keep depth-writing: at 0.55 a boot that let its own far side
       show through reads as a mess, and it is meant to look like a solid
       object you are simply not editing. The 0.13 ghost does not — at that
       alpha the see-through look IS the point. */
    mat.depthWrite=opacity>=0.4;
  }
  mat.needsUpdate=true;
}
/* Per-fragment half-fade for the one mesh that carries two pieces. Written
   every frame from the tick, because a material has no shaderRef until it has
   actually compiled, i.e. been rendered once. */
let _splitGhost={mesh:null,mode:0,alpha:1};
function applySplitGhostUniform(){
  if(!PIECES)return;
  Object.keys(PIECES).forEach(id=>{
    const def=ihcPiece(id);
    if(!def||!def.splitSide)return;               // only the pants/socks mesh
    const ref=PIECES[id].material&&PIECES[id].material.userData.shaderRef;
    if(!ref||!ref.uniforms.uGhostMode)return;
    ref.uniforms.uGhostMode.value=_splitGhost.mode;
    ref.uniforms.uGhostAlpha.value=_splitGhost.alpha;
  });
}
function applyPartIsolation(){
  if(!player||!player.visual)return;
  const target=pieceIsolationTarget();
  const byMesh=pieceMeshMap();
  const def=target?ihcPiece(target):null;
  /* Siblings by MESH, because that is the granularity opacity works at. The
     edited piece's own mesh is in here too — anything else sharing it (the
     pants/socks partner) has to render, and gets faded in the shader below. */
  const sibs=target?ihcAssemblyPieces(target):[];
  const solidMeshes=def?[def.mesh]:[];
  const sibMeshes=sibs.map(id=>{const d=ihcPiece(id);return d&&d.mesh;}).filter(Boolean);
  renderer.localClippingEnabled=false;
  IHC_PIECES.forEach(p=>{
    const m=byMesh[p.mesh];
    if(!m)return;
    if(m.userData._isoBaseVisible===undefined)m.userData._isoBaseVisible=m.visible;
    m.visible=m.userData._isoBaseVisible;
    if(!target)                              setPieceGhost(m,null);
    else if(solidMeshes.indexOf(p.mesh)>=0)  setPieceGhost(m,null);
    else if(sibMeshes.indexOf(p.mesh)>=0)    setPieceGhost(m,SIBLING_OPACITY);
    else                                     setPieceGhost(m,GHOST_OPACITY);
    /* Nothing clips any more — kept as a reset so a design saved while the old
       clipping build was running cannot leave a stale plane on a material. */
    if(m.material&&m.material.clippingPlanes!==undefined)m.material.clippingPlanes=null;
  });
  /* The stick is its own GLB with its own materials, so it gets the same
     treatment one level up rather than being switched off outright. It is
     never part of an assembly — it is carried, not worn. */
  if(stickGroup){
    stickGroup.visible=true;
    stickGroup.traverse(o=>{if(o.isMesh)setPieceGhost(o,target?GHOST_OPACITY:null);});
  }
  /* The split mesh: fade the half that isn't the subject. 'above' = pants, so
     editing pants fades BELOW (-1) and editing socks fades ABOVE (+1). Both
     halves are assembly siblings, so the faded half uses SIBLING_OPACITY; when
     the whole mesh is a mere bystander its material opacity already handles it
     and the shader must stay out of the way. */
  const splitMesh=byMesh[(ihcPiece('pants')||{}).mesh];
  if(def&&def.splitSide){
    _splitGhost.mode=def.splitSide==='above'?-1:1;
    _splitGhost.alpha=SIBLING_OPACITY;
    if(splitMesh&&splitMesh.material){
      splitMesh.material.transparent=true;   // per-fragment alpha needs blending
      splitMesh.material.needsUpdate=true;
    }
  }else{
    _splitGhost.mode=0;_splitGhost.alpha=1;
  }
  applySplitGhostUniform();
}

function zoneRowHTML(zone,idx,mgr,locked){
  return `<div class="zone-row${locked?' locked':''}" data-idx="${idx}" data-mgr="${mgr}"${locked?' data-locked="1"':''}>
    <div class="zone-swatch" id="swatch-${mgr}-${idx}" style="background:#${zone.color.getHexString()}"></div>
    <div class="zone-info"><div class="zone-name">${zone.label}</div>
      <div class="zone-hex" id="hex-${mgr}-${idx}">#${zone.color.getHexString().toUpperCase()}</div></div>
    ${locked?'<div style="font-size:15px;opacity:.6;">🔒</div>':''}
  </div>`;
}
function paletteHTML(){
  return `<div class="preset-strip" id="paletteStrip">`+QUICK_PALETTES.map((p,i)=>`
    <div class="preset-card" data-palette="${i}">
      <div class="preset-swatch3">${p.colors.map(c=>`<div style="background:${c}"></div>`).join('')}</div>
      <span>${p.name}</span>
    </div>`).join('')+`</div>`;
}
function presetStripHTML(){
  const presets=loadPresets();
  let html=`<div class="preset-strip" id="userPresetStrip">`;
  presets.forEach(p=>{
    const cols=(p.body||['#222','#333','#fff']);
    html+=`<div class="preset-card" data-preset="${p.id}">
      <div class="preset-swatch3">${cols.map(c=>`<div style="background:${c}"></div>`).join('')}</div>
      <span>${p.name}</span></div>`;
  });
  html+=`<div class="preset-card" data-newpreset="1">
    <div class="preset-swatch3" style="align-items:center;justify-content:center;display:flex;font-size:20px;color:var(--text-faint);">+</div>
    <span>New</span></div></div>`;
  return html;
}

/* The DECORATE panel, scoped to ONE surface. The part you have open IS the
   paint target (selectCategory points it there), which is what killed the old
   "Paint Target" strip — a second place to choose a part that could disagree
   with the sidebar.
   Brush colour/size/opacity/hardness are deliberately NOT here — they
   live in the floating tool-options bar next to the rail, where the tool that
   owns them is, so this panel is only ever about content: what to stamp, and
   what is already stacked on the model. */
function paintToolsHTML(label){
  const nHere=layerCountForTarget(paintTarget);
  /* ORDER IS DISCOVERABILITY. Add-tools first, then the stack they feed, and
     the housekeeping row LAST — it used to lead, which cost ~110px at the top
     of a panel whose most important section (Layers) was already falling off
     the bottom. Undo also has Ctrl+Z, so the button is a convenience, not the
     way in. Measure with getBoundingClientRect after any edit here: at 1600x900
     the panel viewport is only ~659px and this content is ~1000px. */
  let html=`<div class="rp-section"><div class="rp-section-title">Stamp a shape</div>
      <div class="shape-palette" id="shapeGrid"></div>
      <div style="font-size:13px;color:var(--text-faint);margin-top:6px;">Lands in the middle of the ${label} in the brush colour, then arms ✥ to drag it.</div>
    </div>`;
  html+=`<div class="rp-section"><div class="rp-section-title">Logos<span class="btn ghost" id="openLogoCreatorBtn" style="flex:none;padding:5px 10px;font-size:12.5px;">+ Create Logo</span></div>
      <div class="palette-grid" id="logoLibraryGrid"></div>
      <div class="btn-row" style="margin-top:8px;"><label class="btn" style="flex:1;text-align:center;cursor:pointer;">📁 Import Image<input type="file" id="importLogoFile" accept="image/*" style="display:none;"></label></div>
    </div>`;
  html+=`<div class="rp-section"><div class="rp-section-title">Layers
      <span class="sb-chip" style="font-weight:600;" id="layersTotalBadge">${nHere} on this part · ${layers.length} total</span></div>
      <label class="rp-check" style="margin:0 0 10px;"><input type="checkbox" id="layersThisPartOnly"${layersThisPartOnly?' checked':''}> Only show this part's layers</label>
      <div id="layersList"></div>
      <div id="layerControls"></div>
      <div style="font-size:13px;color:var(--text-faint);margin-top:10px;">One stack, top of the list = on top on the model. Strokes and decals share it, so a decal can sit over paint or under it, and any layer can be flipped to 🧽 Remove to punch a hole through everything below it.</div>
    </div>`;
  html+=`<div class="rp-section"><div class="btn-row">
      <div class="btn" id="undoStrokeBtn">↶ Undo layer</div>
      <div class="btn" id="clearPaintBtn">🗑 Clear this part</div>
    </div>
    <div style="font-size:13px;color:var(--text-faint);margin-top:8px;" id="paintNote">Decoration lands on the side of the ${label} you put it on — the two sides are decorated separately, and nothing is mirrored.</div>
  </div>`;
  return html;
}
/* The layer lists used to always show the whole kit while the tools above them
   were scoped to one part — two different scopes stacked in one panel with
   nothing saying so. Default is now "this part", with the old whole-kit view
   one checkbox away. */
let layersThisPartOnly=true;
function renderRightPanel(){
  const rp=document.getElementById('rightpanel');
  const cat=currentCategory;
  let html=`<h2 class="rp-title">${cat.icon} ${cat.label}</h2>`;
  /* DECORATE is its own panel end-to-end. Paint used to be appended to the
     bottom of the colour panel, which is how it ended up as section ~10 of a
     single unbroken scroll — the reason "where is the paint tool" needed
     asking at all. */
  if(currentActivity==='decorate'){
    html+=`<p class="rp-sub">Tools are on the rail, top left of the viewport — 🖌 brush, 🧽 eraser, ╱ line, ✥ move a decal, 💧 lift a colour.</p>`;
    html+=paintToolsHTML(cat.label.toLowerCase());
    rp.innerHTML=html;
    wireDecalsPanel();
    return;
  }
  if(cat.group==='fixed'){
    html+=`<p class="rp-sub">Fixed component</p><div class="rp-note">${cat.note}</div>`;
    rp.innerHTML=html;return;
  }
  if(cat.group==='skin'){
    html+=`<p class="rp-sub">Individual to this player — stays with them regardless of which team jersey they wear.</p>`;
    html+=`<div class="rp-note">${cat.note}</div>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Color</div>${zoneRowHTML(neckZone,0,'neck')}</div>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Skin Tone</div>
      <div class="palette-grid">${SKIN_TONES.map(c=>`<div class="palette-swatch" data-skintone="${c}" style="background:${c};"></div>`).join('')}</div>
    </div>`;
    rp.innerHTML=html;
    document.querySelectorAll('[data-skintone]').forEach(el=>{
      el.addEventListener('click',()=>{neckZone.setColor(el.dataset.skintone);refreshSwatches();pushHistory();showToast('Skin tone applied');});
    });
    document.querySelector('.zone-row[data-mgr="neck"]').addEventListener('click',()=>{
      openColorPicker(document.querySelector('.zone-row[data-mgr="neck"] .zone-swatch'),'neck',0);
    });
    return;
  }
  if(cat.group==='nameplate'){
    const t=ctxTeam(),nb=t.number||{};
    /* Solo mode: no second party, so there is nobody to request a number FROM.
       The request/approve round trip becomes a plain input that renders on the
       jersey immediately — the same data (t.number.assigned), one less step. */
    if(soloMode){
      html+=`<p class="rp-sub">Name and number on the jersey. Your name carries across every team; the number is per-team.</p>`;
      html+=`<div class="rp-section"><div class="rp-section-title">Nameplate</div>
        <input id="nameInput" placeholder="LAST NAME" maxlength="20" style="width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:16px;font-weight:700;letter-spacing:.03em;padding:10px 12px;">
        <div style="font-size:13px;color:var(--text-faint);margin-top:6px;">A–Z, space, hyphen only · max 11 characters (NHL nameplate limit)</div>
      </div>`;
      html+=`<div class="rp-section"><div class="rp-section-title">Number — ${t.name}</div>
        <input id="soloNumberInput" type="number" min="1" max="99" placeholder="—" value="${nb.assigned||''}" style="width:110px;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:18px;font-weight:800;padding:10px 12px;">
        <div style="font-size:13px;color:var(--text-faint);margin-top:6px;">1–99 · appears on the jersey as you type.</div>
      </div>`;
      html+=`<div class="rp-section"><div class="rp-section-title">Lettering Font</div>
        <select id="fontSelect" style="width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:14px;font-weight:600;padding:10px 12px;">
          ${JERSEY_FONTS.map(f=>`<option value='${f.id}'>${f.label}</option>`).join('')}
        </select></div>`;
      rp.innerHTML=html;
      wireNameplatePanel();
      return;
    }
    html+=`<p class="rp-sub">Your name belongs to you and carries across every team. Your NUMBER is per-team — you request it, the team admin has the final say.</p>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Nameplate</div>
      <input id="nameInput" placeholder="LAST NAME" maxlength="20" style="width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:16px;font-weight:700;letter-spacing:.03em;padding:10px 12px;">
      <div style="font-size:13px;color:var(--text-faint);margin-top:6px;">A–Z, space, hyphen only · max 11 characters (NHL-style nameplate limit — tell me if your league's rule is different)</div>
    </div>`;
    const statusChip=
      nb.status==='approved'?`<span class="num-chip ok">✓ #${nb.assigned} approved</span>`:
      nb.status==='pending' ?`<span class="num-chip pend">⏳ #${nb.preferred} pending approval</span>`:
      nb.status==='rejected'?`<span class="num-chip rej">✗ #${nb.preferred} rejected${nb.assigned?` — wearing #${nb.assigned}`:''}</span>`:
      `<span class="num-chip">no number requested yet</span>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Number — ${t.name}</div>
      <div style="margin-bottom:10px;">${statusChip}</div>
      <div style="display:flex;gap:8px;">
        <input id="numberInput" type="number" min="1" max="99" placeholder="—" value="${nb.preferred||''}" style="flex:1;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:16px;font-weight:700;padding:10px 12px;">
        <div class="btn primary" id="requestNumberBtn" style="flex:none;">Request</div>
      </div>
      <div style="font-size:13px;color:var(--text-faint);margin-top:6px;" id="numberTakenHint">1–99 · taken on this roster: ${(t.numbersTaken||[]).join(', ')||'—'}</div>
    </div>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Lettering Font</div>
      <div class="rp-note">${(JERSEY_FONTS.find(f=>f.id===jerseyFont)||JERSEY_FONTS[0]).label} — part of the team's uniform design, set by the team admin (Jersey category).</div>
    </div>`;
    html+=`<div class="rp-note">Only an admin-ASSIGNED number appears on the jersey and in-game — a pending or rejected request never renders. Switch to Team Admin (top bar) to approve it yourself.</div>`;
    rp.innerHTML=html;
    wireNameplatePanel();
    return;
  }
  if(cat.group==='roster'){
    const t=ctxTeam(),nb=t.number||{};
    html+=`<p class="rp-sub">${t.name} — the admin assigns numbers; a player request is just a request until it's approved here.</p>`;
    const reqLine=
      nb.status==='pending' ?`<b>${PKIT.name||'Your player'}</b> requests <b>#${nb.preferred}</b>${(t.numbersTaken||[]).includes(+nb.preferred)?' <span class="num-chip rej">already taken!</span>':''}`:
      nb.status==='approved'?`<b>${PKIT.name||'Your player'}</b> wears <b>#${nb.assigned}</b> (approved)`:
      nb.status==='rejected'?`<b>${PKIT.name||'Your player'}</b>'s request for #${nb.preferred} was rejected${nb.assigned?` — currently wears #${nb.assigned}`:''}`:
      `No number request from ${PKIT.name||'your player'} yet.`;
    html+=`<div class="rp-section"><div class="rp-section-title">Number Request</div>
      <div style="font-size:14px;margin-bottom:10px;">${reqLine}</div>
      <div class="btn-row">
        <div class="btn primary" id="approveNumBtn"${nb.status==='pending'?'':' style="opacity:.4;pointer-events:none;"'}>✓ Approve</div>
        <div class="btn" id="rejectNumBtn"${nb.status==='pending'?'':' style="opacity:.4;pointer-events:none;"'}>✗ Reject</div>
        <div class="btn" id="assignNumBtn">✎ Assign…</div>
      </div>
      <div style="font-size:13px;color:var(--text-faint);margin-top:8px;">Assign… overrides with any number of your choosing — admin has final say.</div>
    </div>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Taken Numbers</div>
      <input id="takenNumsInput" value="${(t.numbersTaken||[]).join(', ')}" style="width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:14px;font-weight:600;padding:10px 12px;">
      <div style="font-size:13px;color:var(--text-faint);margin-top:6px;">Comma-separated 1–99 — the rest of the roster's numbers. Purely informational until a real multi-player roster exists; the Approve button warns against it but doesn't hard-block.</div>
    </div>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Team Identity</div>
      <input id="teamNameInput" value="${t.name}" maxlength="24" style="width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:14px;font-weight:700;padding:10px 12px;margin-bottom:8px;">
      <input id="teamAbbrevInput" value="${t.abbrev||''}" maxlength="3" placeholder="ABC" style="width:100px;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:14px;font-weight:700;padding:10px 12px;text-transform:uppercase;">
    </div>`;
    rp.innerHTML=html;
    wireRosterPanel();
    return;
  }
  if(cat.group==='policies'){
    const t=ctxTeam(),lg=ihtLeague(TSTORE,t);
    html+=`<p class="rp-sub">How much personal freedom players on ${t.name} get. A lock at EITHER level wins — the league can forbid what a team would allow.</p>`;
    IHT_POLICY_CATEGORIES.forEach(pc=>{
      const lgLock=lg.policy&&lg.policy[pc.id]===false;
      const tmLock=t.policy&&t.policy[pc.id]===false;
      const eff=!lgLock&&!tmLock;
      html+=`<div class="rp-section"><div class="rp-section-title">${pc.icon} ${pc.label}
          <span class="num-chip ${eff?'ok':'rej'}" style="margin-left:auto;">${eff?'players may customize':'locked for players'}</span></div>
        <div style="font-size:13px;color:var(--text-faint);margin-bottom:8px;">${pc.note}</div>
        <div class="btn-row">
          <div class="btn pol-btn${tmLock?' primary':''}" data-pol-team="${pc.id}">${tmLock?'🔒 Team: locked':'🔓 Team: allowed'}</div>
          <div class="btn pol-btn${lgLock?' primary':''}" data-pol-league="${pc.id}">${lgLock?'🔒 League: locked':'🔓 League: allowed'}</div>
        </div>
      </div>`;
    });
    html+=`<div class="rp-note">League toggles change <b>${lg.name}</b> for EVERY team in it (${TSTORE.teams.filter(x=>x.leagueId===lg.id).map(x=>x.name).join(', ')}) — that's the point of a league rule.</div>`;
    rp.innerHTML=html;
    wirePoliciesPanel();
    return;
  }
  const mgrKey=cat.group==='stick'?'stick':cat.piece;
  const mgr=mgrByKey(mgrKey);
  /* colours and paint are separate permissions — a player may be allowed to
     paint a part whose team colours are locked to them. `editable` still means
     "may change the team design", which is what the colour/material/preset
     controls below are gated on. */
  const editable=categoryColorEditable(cat);
  const paintable=categoryPaintable(cat);
  const lockSrc=cat.id==='stick'?catLockLabel('stick'):null;
  html+=`<p class="rp-sub">${cat.group==='stick'?'Independent material — shaft &amp; blade tape.':'Own material, own zones — recolors this piece only.'}</p>`;
  if(!editable){
    html+=`<div class="rp-note">${cat.group==='stick'
      ?`🔒 ${lockSrc||ctxTeam().name} does not allow personal stick customization — these are the colors you'll play with. Switch to Team Admin to change the policy.`
      :`🔒 The ${ctxTeam().name} admin decides this part's colors — you're viewing them, not editing them.${paintable?' Paint and decals for it are under Decorate and are still yours to change.':' Switch to Team Admin (top bar) to redesign it, or pick another jersey set / team above.'}`}
      <div style="margin-top:8px;">Turn <b>Solo mode</b> on in the top bar to drop the team-rules layer entirely.</div></div>`;
  }
  if(cat.note)html+=`<div class="rp-note">${cat.note}</div>`;

  html+=`<div class="rp-section"><div class="rp-section-title">Color Zones</div>`;
  mgr.zones.forEach((z,i)=>html+=zoneRowHTML(z,i,mgrKey,!editable));
  html+=`</div>`;

  if(editable&&cat.id==='jersey'){
    html+=`<div class="rp-section"><div class="rp-section-title">Lettering Font</div>
      <select id="fontSelect" style="width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:14px;font-weight:600;padding:10px 12px;">
        ${JERSEY_FONTS.map(f=>`<option value='${f.id}'>${f.label}</option>`).join('')}
      </select>
      <div style="font-size:13px;color:var(--text-faint);margin-top:6px;">Name &amp; number lettering for this jersey set — part of the team design.</div>
    </div>`;
  }

  if(editable&&cat.group==='body'){
    html+=`<div class="rp-section"><div class="rp-section-title">Team Colors</div>${paletteHTML()}
      <label class="rp-check"><input type="checkbox" id="palAllPieces" checked> Apply to the whole kit</label>
      <div style="font-size:13px;color:var(--text-faint);margin-top:4px;">Off = recolor only ${cat.label.toLowerCase()}.</div></div>`;
  }

  if(editable){
    html+=`<div class="rp-section"><div class="rp-section-title">Material</div>
      <div class="mat-slider-row"><div class="mat-slider-label"><span>Roughness</span><b id="roughVal"></b></div>
        <input type="range" id="roughSlider" min="0" max="1" step="0.01"></div>
      <div class="mat-slider-row"><div class="mat-slider-label"><span>Metallic</span><b id="metalVal"></b></div>
        <input type="range" id="metalSlider" min="0" max="1" step="0.01"></div>
    </div>`;

    html+=`<div class="rp-section"><div class="btn-row">
      <div class="btn" id="btnUndo">↶ Undo</div><div class="btn" id="btnRedo">↷ Redo</div>
    </div></div>`;
    html+=`<div class="rp-section"><div class="btn-row">
      <div class="btn" id="btnRandom">🎲 Randomize</div>${ownsDesign()?'<div class="btn primary" id="btnSavePreset">💾 Save Preset</div>':''}
    </div></div>`;
  }

  if(ownsDesign()){
    html+=`<div class="rp-section"><div class="btn-row">
      <div class="btn" id="btnExportCode">📤 Export Code</div><div class="btn" id="btnImportCode">📥 Import Code</div>
    </div>
    <div class="rp-note" style="margin-top:10px;">Exports/imports the WHOLE loadout (colors, name/number/font, paint, decals) as a text code — for sharing or backing up outside this browser, separate from the presets below which only live here.</div></div>`;

    html+=`<div class="rp-section"><div class="rp-section-title">Loadout Presets</div>${presetStripHTML()}</div>`;
  }

  /* Paint and decals are the DECORATE activity now — this is a one-line
     handoff instead of ten more sections stacked below the colour controls. */
  if(paintable){
    html+=`<div class="rp-section"><div class="btn primary" id="goDecorateBtn">🖌 Paint &amp; decals on the ${cat.label.toLowerCase()}</div>
      <div style="font-size:13px;color:var(--text-faint);margin-top:6px;">${layerCountForTarget(paintTarget)||'No'} layer${layerCountForTarget(paintTarget)===1?'':'s'} on this part right now.</div></div>`;
  }else if(cat.group==='body'&&!ownsDesign()){
    const src=catLockLabel('accents')||catLockLabel('helmetStyle')||catLockLabel('skates')||ctxTeam().name;
    html+=`<div class="rp-note">🔒 ${src} does not allow personal paint or decals on this part. The team's own layers still show on the model — they're just not yours to edit.</div>`;
  }

  rp.innerHTML=html;
  wireRightPanel(mgrKey,mgr,editable);
  const gd=document.getElementById('goDecorateBtn');
  if(gd)gd.addEventListener('click',()=>selectActivity('decorate',paintTarget));
}
/* "May I edit the team's own design?" — true in solo (you are the only party)
   and true for the admin role otherwise. Presets/export are design-level
   operations, so they hang off this rather than off the raw role. */
function ownsDesign(){return soloMode||actingRole==='admin';}

function wireRightPanel(mgrKey,mgr,editable){
  document.querySelectorAll('.zone-row').forEach(el=>{
    el.addEventListener('click',e=>{
      if(el.dataset.locked){showToast('🔒 Locked — team admin controls this');return;}
      const idx=+el.dataset.idx,m=el.dataset.mgr;
      openColorPicker(el.querySelector('.zone-swatch'),m,idx);
    });
  });
  const fontSel=document.getElementById('fontSelect');
  if(fontSel){
    fontSel.value=jerseyFont;
    fontSel.addEventListener('change',()=>{setJerseyFont(fontSel.value);showToast('Lettering font applied');});
  }
  const roughSlider=document.getElementById('roughSlider'),metalSlider=document.getElementById('metalSlider');
  if(roughSlider){
    roughSlider.value=mgr.material.roughness;
    document.getElementById('roughVal').textContent=mgr.material.roughness.toFixed(2);
    roughSlider.addEventListener('input',()=>{mgr.material.roughness=+roughSlider.value;document.getElementById('roughVal').textContent=mgr.material.roughness.toFixed(2);});
  }
  if(metalSlider){
    metalSlider.value=mgr.material.metalness;
    document.getElementById('metalVal').textContent=mgr.material.metalness.toFixed(2);
    metalSlider.addEventListener('input',()=>{mgr.material.metalness=+metalSlider.value;document.getElementById('metalVal').textContent=mgr.material.metalness.toFixed(2);});
  }
  document.querySelectorAll('#paletteStrip .preset-card').forEach(el=>{
    el.addEventListener('click',()=>{
      const p=QUICK_PALETTES[+el.dataset.palette];
      const all=document.getElementById('palAllPieces');
      /* A team colorway is a KIT-wide idea, so by default it paints every
         team piece (each piece takes as many of the three colors as it has
         zones); unchecking it makes the strip a per-piece shortcut instead. */
      const targets=(all&&all.checked)?TEAM_PIECE_IDS.map(mgrByKey).filter(Boolean):[mgr];
      targets.forEach(t=>p.colors.forEach((c,i)=>{if(t.zones[i])t.zones[i].setColor(c);}));
      refreshSwatches();pushHistory();showToast(p.name+' applied');
    });
  });
  document.querySelectorAll('#userPresetStrip .preset-card[data-preset]').forEach(el=>{
    el.addEventListener('click',()=>{applyPreset(el.dataset.preset);});
  });
  const newBtn=document.querySelector('#userPresetStrip [data-newpreset]');
  if(newBtn)newBtn.addEventListener('click',promptSavePreset);
  const rb=document.getElementById('btnRandom');
  if(rb)rb.addEventListener('click',()=>{randomizeZones(mgr);refreshSwatches();pushHistory();showToast('Randomized');});
  const sb=document.getElementById('btnSavePreset');
  if(sb)sb.addEventListener('click',promptSavePreset);
  const ub=document.getElementById('btnUndo');if(ub)ub.addEventListener('click',undo);
  const rdb=document.getElementById('btnRedo');if(rdb)rdb.addEventListener('click',redo);
  const exb=document.getElementById('btnExportCode');if(exb)exb.addEventListener('click',exportLoadoutCode);
  const imb=document.getElementById('btnImportCode');if(imb)imb.addEventListener('click',importLoadoutCode);
}
/* Every zone-editing path (panel rows, color picker, presets, undo) addresses
   a manager by KEY: 'stick', or an equipment piece id from IHC_PIECES. */
const TEAM_PIECE_IDS=IHC_PIECES.filter(p=>!p.personal).map(p=>p.id);
function mgrByKey(key){
  if(key==='stick')return stickZM;
  return (PIECES&&PIECES[key])||null;
}
function refreshSwatches(){
  TEAM_PIECE_IDS.concat(['stick','neck']).forEach(mgrKey=>{
    const mgr=mgrByKey(mgrKey);
    if(!mgr)return;
    mgr.zones.forEach((z,i)=>{
      const sw=document.getElementById('swatch-'+mgrKey+'-'+i);
      const hx=document.getElementById('hex-'+mgrKey+'-'+i);
      if(sw)sw.style.background='#'+z.color.getHexString();
      if(hx)hx.textContent='#'+z.color.getHexString().toUpperCase();
    });
  });
  redrawNameNumber(); // the name/number badge fills track Primary/Secondary/Trim
}
function wireNameplatePanel(){
  const nameInput=document.getElementById('nameInput');
  nameInput.value=jerseyName;
  nameInput.addEventListener('input',()=>{
    jerseyName=sanitizeName(nameInput.value);
    if(nameInput.value!==jerseyName)nameInput.value=jerseyName;
    redrawNameNumber();
  });
  nameInput.addEventListener('change',pushHistory);

  const fontSel=document.getElementById('fontSelect');
  if(fontSel){
    fontSel.value=jerseyFont;
    fontSel.addEventListener('change',()=>{setJerseyFont(fontSel.value);showToast('Lettering font applied');});
  }

  /* Solo: writes straight to the assigned number, which is the one field
     ihtEffectiveNumber() renders from — no request, no approval, no chips. */
  const soloNum=document.getElementById('soloNumberInput');
  if(soloNum){
    soloNum.addEventListener('input',()=>{
      const t=ctxTeam();
      t.number=t.number||{};
      const v=sanitizeNumber(soloNum.value);
      t.number.assigned=v;t.number.preferred=v;t.number.status=v?'approved':'none';
      ihtSaveStore(TSTORE);
      jerseyNumber=ihtEffectiveNumber(t);
      redrawNameNumber();
      updateContextBar();
    });
    soloNum.addEventListener('change',()=>{
      const v=sanitizeNumber(soloNum.value);
      if(soloNum.value!==v)soloNum.value=v;
      pushHistory();
    });
    return;
  }

  /* Number is a REQUEST, not a direct edit — nothing changes on the jersey
     until the team admin (Numbers & Roster panel) assigns it. */
  const numberInput=document.getElementById('numberInput');
  document.getElementById('requestNumberBtn').addEventListener('click',()=>{
    const v=sanitizeNumber(numberInput.value);
    if(!v){showToast('Enter a number 1–99 first');return;}
    numberInput.value=v;
    const t=ctxTeam();
    t.number=t.number||{};
    t.number.preferred=v;t.number.status='pending';
    ihtSaveStore(TSTORE);
    renderRightPanel();
    showToast((t.numbersTaken||[]).includes(+v)
      ?`#${v} requested — heads up, it's already taken on this roster`
      :`#${v} requested — waiting for the ${t.name} admin`);
  });
}
/* ----- Team Admin: number approvals + team identity ----- */
function afterNumberChange(msg){
  ihtSaveStore(TSTORE);
  jerseyNumber=ihtEffectiveNumber(ctxTeam());
  redrawNameNumber(); // re-renders the plate + refreshes the game loadout
  renderRightPanel();
  updateContextBar();
  if(msg)showToast(msg);
}
function wireRosterPanel(){
  const t=ctxTeam();
  document.getElementById('approveNumBtn').addEventListener('click',()=>{
    const nb=t.number;if(!nb||nb.status!=='pending')return;
    if((t.numbersTaken||[]).includes(+nb.preferred)&&!confirm('#'+nb.preferred+' is on the taken list — approve anyway?'))return;
    nb.assigned=nb.preferred;nb.status='approved';
    afterNumberChange('#'+nb.assigned+' approved — it now renders on the jersey');
  });
  document.getElementById('rejectNumBtn').addEventListener('click',()=>{
    const nb=t.number;if(!nb||nb.status!=='pending')return;
    nb.status='rejected';
    afterNumberChange('Request rejected'+(nb.assigned?' — player keeps #'+nb.assigned:''));
  });
  document.getElementById('assignNumBtn').addEventListener('click',()=>{
    const v=sanitizeNumber(prompt('Assign number (1–99):','')||'');
    if(!v)return;
    t.number=t.number||{};
    t.number.assigned=v;t.number.status='approved';
    if(!t.number.preferred)t.number.preferred=v;
    afterNumberChange('#'+v+' assigned by admin');
  });
  const taken=document.getElementById('takenNumsInput');
  taken.addEventListener('change',()=>{
    t.numbersTaken=taken.value.split(',').map(s=>parseInt(s.trim(),10))
      .filter(n=>!isNaN(n)&&n>=1&&n<=99);
    taken.value=t.numbersTaken.join(', ');
    ihtSaveStore(TSTORE);
    showToast('Roster numbers updated');
  });
  const nameIn=document.getElementById('teamNameInput');
  nameIn.addEventListener('change',()=>{
    const v=nameIn.value.trim().slice(0,24);
    if(!v){nameIn.value=t.name;return;}
    t.name=v;ihtSaveStore(TSTORE);ihtWriteGameLoadout(TSTORE,PKIT);
    updateContextBar();showToast('Team renamed');
  });
  const abbrIn=document.getElementById('teamAbbrevInput');
  abbrIn.addEventListener('change',()=>{
    t.abbrev=abbrIn.value.trim().toUpperCase().slice(0,3);
    abbrIn.value=t.abbrev;
    ihtSaveStore(TSTORE);ihtWriteGameLoadout(TSTORE,PKIT);
    updateContextBar();
  });
}
/* ----- Team Admin: the league/team policy matrix ----- */
function wirePoliciesPanel(){
  const t=ctxTeam(),lg=ihtLeague(TSTORE,t);
  document.querySelectorAll('[data-pol-team]').forEach(el=>{
    el.addEventListener('click',()=>{
      const cat=el.dataset.polTeam;
      t.policy=t.policy||{};
      t.policy[cat]=t.policy[cat]===false; // flip lock
      ihtSaveStore(TSTORE);
      renderRightPanel();
      showToast(t.policy[cat]===false?'Locked for players on '+t.name:'Allowed for players on '+t.name);
    });
  });
  document.querySelectorAll('[data-pol-league]').forEach(el=>{
    el.addEventListener('click',()=>{
      const cat=el.dataset.polLeague;
      lg.policy=lg.policy||{};
      lg.policy[cat]=lg.policy[cat]===false;
      ihtSaveStore(TSTORE);
      renderRightPanel();
      showToast(lg.policy[cat]===false?'Locked league-wide by '+lg.name:'Allowed league-wide by '+lg.name);
    });
  });
}
/* Wires the paint/decal tools now rendered inside a PART's panel. The old
   paint-target strip is gone — selectCategory points paintTarget at whatever
   part is open, so there is nothing here to pick a target with any more. */
function wireDecalsPanel(){
  /* Brush colour/size/opacity/hardness are in the floating tool-options bar
     now (see renderToolOptions) — next to the tool that uses them, not buried
     in this panel. What's left here is content and stack management. */

  const partOnly=document.getElementById('layersThisPartOnly');
  if(partOnly)partOnly.addEventListener('change',()=>{
    layersThisPartOnly=partOnly.checked;
    renderLayersList();
  });

  document.getElementById('undoStrokeBtn').addEventListener('click',()=>{
    if(!layers.length){showToast('Nothing to undo on the kit');return;}
    layers.pop();selectedLayerIdx=-1;
    redrawPaintLayer();renderLayersList();renderLayerControls();buildSidebar();pushHistory();
    showToast('Top layer removed');
  });
  /* Scoped to the part you are looking at. It used to wipe paint across the
     WHOLE kit from a button sitting inside one part's panel — and leave the
     decals, which the label didn't say either. */
  document.getElementById('clearPaintBtn').addEventListener('click',()=>{
    const n=layerCountForTarget(paintTarget);
    if(!n){showToast('Nothing on this part to clear');return;}
    if(!confirm('Delete all '+n+' layer'+(n===1?'':'s')+' on the '+paintTarget+'? Other parts are not affected.'))return;
    layers=layers.filter(L=>L.target!==paintTarget);
    selectedLayerIdx=-1;
    redrawPaintLayer();renderLayersList();renderLayerControls();buildSidebar();pushHistory();
    showToast('Cleared the '+paintTarget);
  });

  renderShapeGrid();
  renderLogoLibraryGrid();
  renderLayersList();
  renderLayerControls();
  document.getElementById('openLogoCreatorBtn').addEventListener('click',openLogoCreator);
  document.getElementById('importLogoFile').addEventListener('change',e=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        const name=file.name.replace(/\.[^.]+$/,'')||'Imported Logo';
        logoLibrary.push({id:'LG'+Date.now(),name,dataURL:ev.target.result,img});
        saveLogoLibrary();
        renderLogoLibraryGrid();
        showToast('Logo imported');
      };
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value='';
  });
}
function randomizeZones(mgr){
  mgr.zones.forEach((z,i)=>{
    const h=Math.random()*360,s=0.35+Math.random()*0.5,v=i===mgr.zones.length-1?0.82+Math.random()*0.16:0.22+Math.random()*0.55;
    const rgb=hsvToRgb(h,s,v);
    z.setColor(rgbToHex(rgb.r,rgb.g,rgb.b));
  });
}

/* ============================== COLOR PICKER ============================== */
const cpEl=document.getElementById('colorPicker');
const svCanvas=document.getElementById('svCanvas'),svCtx=svCanvas.getContext('2d');
const hueCanvas=document.getElementById('hueCanvas'),hueCtx=hueCanvas.getContext('2d');
let cpState={h:0,s:0,v:0,mgrKey:null,idx:null,anchorEl:null};

function drawHueBar(){
  const g=hueCtx.createLinearGradient(0,0,hueCanvas.width,0);
  for(let i=0;i<=6;i++)g.addColorStop(i/6,'hsl('+(i*60)+',100%,50%)');
  hueCtx.fillStyle=g;hueCtx.fillRect(0,0,hueCanvas.width,hueCanvas.height);
}
function drawSVBox(){
  const w=svCanvas.width,h=svCanvas.height;
  const rgb=hsvToRgb(cpState.h,1,1);
  svCtx.fillStyle=`rgb(${rgb.r|0},${rgb.g|0},${rgb.b|0})`;svCtx.fillRect(0,0,w,h);
  let g=svCtx.createLinearGradient(0,0,w,0);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(1,'rgba(255,255,255,0)');
  svCtx.fillStyle=g;svCtx.fillRect(0,0,w,h);
  g=svCtx.createLinearGradient(0,0,0,h);
  g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,1)');
  svCtx.fillStyle=g;svCtx.fillRect(0,0,w,h);
  // cursor
  const cx=cpState.s*w,cy=(1-cpState.v)*h;
  svCtx.beginPath();svCtx.arc(cx,cy,6,0,Math.PI*2);svCtx.strokeStyle='#fff';svCtx.lineWidth=2;svCtx.stroke();
  svCtx.beginPath();svCtx.arc(cx,cy,6,0,Math.PI*2);svCtx.strokeStyle='rgba(0,0,0,.4)';svCtx.lineWidth=1;svCtx.stroke();
}
function currentHex(){const rgb=hsvToRgb(cpState.h,cpState.s,cpState.v);return rgbToHex(rgb.r,rgb.g,rgb.b);}
function syncFieldsFromState(){
  const rgb=hsvToRgb(cpState.h,cpState.s,cpState.v);
  document.getElementById('cpR').value=Math.round(rgb.r);
  document.getElementById('cpG').value=Math.round(rgb.g);
  document.getElementById('cpB').value=Math.round(rgb.b);
  document.getElementById('cpHex').value=currentHex();
  document.getElementById('cpPreview').style.background=currentHex();
}
function applyLive(){
  if(cpState.mgrKey==='paint'){
    paintBrushColor=currentHex();
    // the brush swatch lives in the floating tool-options bar now; poke it
    // directly rather than re-rendering the bar mid-drag (that would rebuild
    // the very slider/canvas the pointer is captured on)
    const to=document.getElementById('toColorSwatch');if(to)to.style.background=paintBrushColor;
    const sw=document.getElementById('paintColorSwatch');if(sw)sw.style.background=paintBrushColor;
    if(brushRing&&brushRing.visible&&activeTool!=='erase')brushRing.material.color.set(paintBrushColor);
    return;
  }
  if(cpState.mgrKey==='neck'){
    neckZone.setColor(currentHex());
    refreshSwatches();
    return;
  }
  if(cpState.mgrKey==='lclayer'){
    const L=lcLayers[lcSelectedIdx];
    if(L){L.color=currentHex();const sw=document.getElementById('lcColorSwatch');if(sw)sw.style.background=L.color;renderLogoCreatorCanvas();}
    return;
  }
  if(cpState.mgrKey==='layercolor'||cpState.mgrKey==='layeroutline'){
    const L=layerAt(cpState.idx);
    if(L){
      const outline=cpState.mgrKey==='layeroutline';
      if(outline){(L.outline||(L.outline={on:true,width:8})).color=currentHex();}
      else L.color=currentHex();
      const sw=document.getElementById(outline?'layerOutlineSwatch':'layerColorSwatch');
      if(sw)sw.style.background=currentHex();
      redrawPaintLayer();renderLayersList();
    }
    return;
  }
  const mgr=mgrByKey(cpState.mgrKey);
  if(mgr&&mgr.zones[cpState.idx])mgr.zones[cpState.idx].setColor(currentHex());
  refreshSwatches();
}
/* Drives the open picker to a hex from outside it (the eyedropper) through the
   exact same path a slider drag takes, so the live preview, the fields and the
   undo entry all behave identically. */
function setPickerHex(hex){
  const rgb=hexToRgb(hex),hsv=rgbToHsv(rgb.r,rgb.g,rgb.b);
  cpState.h=hsv.h;cpState.s=hsv.s;cpState.v=hsv.v;
  drawSVBox();syncFieldsFromState();applyLive();commitColorHistory();
}
function openColorPicker(anchorEl,mgrKey,idx){
  cpState.mgrKey=mgrKey;cpState.idx=idx;cpState.anchorEl=anchorEl;
  let startHex='#ffffff';
  if(mgrKey==='paint')startHex=paintBrushColor;
  else if(mgrKey==='lclayer')startHex=(lcLayers[lcSelectedIdx]&&lcLayers[lcSelectedIdx].color)||'#7c5cff';
  else if(mgrKey==='layercolor')startHex=(layerAt(idx)&&layerAt(idx).color)||'#7c5cff';
  else if(mgrKey==='layeroutline')startHex=(layerAt(idx)&&layerAt(idx).outline&&layerAt(idx).outline.color)||'#000000';
  else{const m=mgrByKey(mgrKey);if(m&&m.zones[idx])startHex='#'+m.zones[idx].color.getHexString();}
  const rgb=hexToRgb(startHex);
  const hsv=rgbToHsv(rgb.r,rgb.g,rgb.b);
  cpState.h=hsv.h;cpState.s=hsv.s;cpState.v=hsv.v;
  drawHueBar();drawSVBox();syncFieldsFromState();
  renderRecentSwatches();renderFavSwatches();
  const r=anchorEl.getBoundingClientRect();
  let left=r.right+14,top=r.top-6;
  if(left+280>innerWidth)left=r.left-284;
  if(top+380>innerHeight)top=innerHeight-390;
  cpEl.style.left=Math.max(10,left)+'px';cpEl.style.top=Math.max(10,top)+'px';
  cpEl.classList.add('open');
}
function closeColorPicker(){cpEl.classList.remove('open');}
document.addEventListener('pointerdown',e=>{
  if(!cpEl.classList.contains('open'))return;
  if(cpEl.contains(e.target)||e.target.closest('.zone-row'))return;
  /* Eyedropping INTO the open picker means clicking the model — closing on
     that click would shut the panel the pick was aimed at. */
  if(isPickTool()&&e.target===renderer.domElement)return;
  closeColorPicker();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeColorPicker();});

let svDragging=false,hueDragging=false;
svCanvas.addEventListener('pointerdown',e=>{svDragging=true;svCanvas.setPointerCapture(e.pointerId);handleSVPointer(e);});
svCanvas.addEventListener('pointermove',e=>{if(svDragging)handleSVPointer(e);});
svCanvas.addEventListener('pointerup',()=>{svDragging=false;commitColorHistory();});
function handleSVPointer(e){
  const r=svCanvas.getBoundingClientRect();
  const x=clamp01((e.clientX-r.left)/r.width),y=clamp01((e.clientY-r.top)/r.height);
  cpState.s=x;cpState.v=1-y;
  drawSVBox();syncFieldsFromState();applyLive();
}
hueCanvas.addEventListener('pointerdown',e=>{hueDragging=true;hueCanvas.setPointerCapture(e.pointerId);handleHuePointer(e);});
hueCanvas.addEventListener('pointermove',e=>{if(hueDragging)handleHuePointer(e);});
hueCanvas.addEventListener('pointerup',()=>{hueDragging=false;commitColorHistory();});
function handleHuePointer(e){
  const r=hueCanvas.getBoundingClientRect();
  const x=clamp01((e.clientX-r.left)/r.width);
  cpState.h=x*360;
  drawSVBox();syncFieldsFromState();applyLive();
}
function commitFromHex(){
  const v=document.getElementById('cpHex').value.trim();
  if(!/^#?[0-9a-fA-F]{6}$/.test(v))return;
  const hex=v.startsWith('#')?v:'#'+v;
  const rgb=hexToRgb(hex);const hsv=rgbToHsv(rgb.r,rgb.g,rgb.b);
  cpState.h=hsv.h;cpState.s=hsv.s;cpState.v=hsv.v;
  drawSVBox();syncFieldsFromState();applyLive();commitColorHistory();
}
function commitFromRGB(){
  const r=+document.getElementById('cpR').value||0,g=+document.getElementById('cpG').value||0,b=+document.getElementById('cpB').value||0;
  const hsv=rgbToHsv(r,g,b);cpState.h=hsv.h;cpState.s=hsv.s;cpState.v=hsv.v;
  drawSVBox();syncFieldsFromState();applyLive();commitColorHistory();
}
document.getElementById('cpHex').addEventListener('change',commitFromHex);
document.getElementById('cpHex').addEventListener('keydown',e=>{if(e.key==='Enter')commitFromHex();});
['cpR','cpG','cpB'].forEach(id=>{
  document.getElementById(id).addEventListener('change',commitFromRGB);
  document.getElementById(id).addEventListener('keydown',e=>{if(e.key==='Enter')commitFromRGB();});
});
document.getElementById('cpFavBtn').addEventListener('click',()=>{
  addFavorite(currentHex());renderFavSwatches();showToast('Added to favorites');
});
document.querySelectorAll('.cp-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.cp-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('cpBasic').style.display=tab.dataset.tab==='basic'?'block':'none';
    document.getElementById('cpRecent').style.display=tab.dataset.tab==='recent'?'block':'none';
    document.getElementById('cpFav').style.display=tab.dataset.tab==='fav'?'block':'none';
  });
});

/* recent / favorites persistence */
function loadRecent(){try{return JSON.parse(localStorage.getItem('ihc_recent_v1')||'[]');}catch(e){return[];}}
function saveRecent(a){localStorage.setItem('ihc_recent_v1',JSON.stringify(a.slice(0,16)));}
function addRecent(hex){const a=loadRecent().filter(c=>c!==hex);a.unshift(hex);saveRecent(a);}
function loadFav(){try{return JSON.parse(localStorage.getItem('ihc_fav_v1')||'[]');}catch(e){return[];}}
function saveFav(a){localStorage.setItem('ihc_fav_v1',JSON.stringify(a));}
function addFavorite(hex){const a=loadFav();if(!a.includes(hex)){a.push(hex);saveFav(a);}}
function renderRecentSwatches(){
  const el=document.getElementById('recentSwatches');el.innerHTML='';
  loadRecent().forEach(hex=>{
    const d=document.createElement('div');d.style.background=hex;d.title=hex;
    d.addEventListener('click',()=>{const rgb=hexToRgb(hex);const hsv=rgbToHsv(rgb.r,rgb.g,rgb.b);
      cpState.h=hsv.h;cpState.s=hsv.s;cpState.v=hsv.v;drawSVBox();syncFieldsFromState();applyLive();commitColorHistory();});
    el.appendChild(d);
  });
}
function renderFavSwatches(){
  const el=document.getElementById('favSwatches');el.innerHTML='';
  loadFav().forEach(hex=>{
    const d=document.createElement('div');d.style.background=hex;d.title=hex+' (click to remove)';
    d.addEventListener('click',()=>{const rgb=hexToRgb(hex);const hsv=rgbToHsv(rgb.r,rgb.g,rgb.b);
      cpState.h=hsv.h;cpState.s=hsv.s;cpState.v=hsv.v;drawSVBox();syncFieldsFromState();applyLive();commitColorHistory();});
    el.appendChild(d);
  });
}
function commitColorHistory(){
  addRecent(currentHex());
  if(cpState.mgrKey==='paint'||cpState.mgrKey==='lclayer')return; // not part of the zone-color undo/redo history
  pushHistory();
}

/* ============================== LOGO CREATOR ============================== */
/* A small flat 2D compositor (shapes/text/imported images as independent,
   still-editable layers) — separate from the 3D scene entirely. "Save to
   Library" rasterizes the composition once into a PNG data URL; placement
   onto the model is a completely separate step (see DECAL PLACEMENT below)
   so a saved logo can be stamped onto any piece, repositioned/rescaled/
   rotated, any number of times, without re-opening the creator. */
const logoCanvasEl=document.getElementById('logoCanvasEl');
const logoCreatorCtx=logoCanvasEl.getContext('2d');
let lcLayers=[],lcSelectedIdx=-1,lcDragging=false,lcDragStart=null;

function lcNewId(){return 'L'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function lcAddLayer(layer){
  layer.id=lcNewId();
  if(layer.x===undefined)layer.x=256;
  if(layer.y===undefined)layer.y=256;
  if(layer.scale===undefined)layer.scale=1;
  if(layer.rotation===undefined)layer.rotation=0;
  lcLayers.push(layer);
  lcSelectedIdx=lcLayers.length-1;
  renderLogoCreatorUI();
}
function lcLayerRadius(L){
  if(L.type==='shape')return 80*L.scale;
  if(L.type==='text'){logoCreatorCtx.font=`bold ${L.fontSize||64}px Arial`;return Math.max(40,logoCreatorCtx.measureText(L.text||'TEXT').width/2)*L.scale;}
  if(L.type==='image'&&L.img&&L.img.complete)return Math.max(L.img.width,L.img.height)/2*0.55*L.scale;
  return 60*L.scale;
}
/* The compositor and the on-model decal replay draw from the SAME path set
   (IHC_SHAPES/ihcShapePath in core) — a second copy here is how the two would
   drift into "the logo I built isn't the shape that got stamped". */
function lcDrawShapePath(ctx,shape,r){ihcShapePath(ctx,shape,r);}
function lcRenderLayer(ctx,L){
  ctx.save();
  ctx.translate(L.x,L.y);ctx.rotate(L.rotation);ctx.scale(L.scale,L.scale);
  if(L.type==='shape'){lcDrawShapePath(ctx,L.shape,80);ctx.fillStyle=L.color;ctx.fill();}
  else if(L.type==='text'){
    ctx.font=`bold ${L.fontSize||64}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=L.color;ctx.fillText(L.text||'TEXT',0,0);
  }else if(L.type==='image'&&L.img&&L.img.complete&&L.img.naturalWidth>0){
    const maxDim=200,s=maxDim/Math.max(L.img.width,L.img.height);
    ctx.drawImage(L.img,-L.img.width*s/2,-L.img.height*s/2,L.img.width*s,L.img.height*s);
  }
  ctx.restore();
}
function renderLogoCreatorCanvas(){
  logoCreatorCtx.clearRect(0,0,512,512);
  lcLayers.forEach(L=>lcRenderLayer(logoCreatorCtx,L));
  if(lcSelectedIdx>=0&&lcLayers[lcSelectedIdx]){
    const L=lcLayers[lcSelectedIdx],r=lcLayerRadius(L);
    logoCreatorCtx.save();
    logoCreatorCtx.strokeStyle='#7c5cff';logoCreatorCtx.lineWidth=2;logoCreatorCtx.setLineDash([7,5]);
    logoCreatorCtx.beginPath();logoCreatorCtx.arc(L.x,L.y,r+10,0,Math.PI*2);logoCreatorCtx.stroke();
    logoCreatorCtx.restore();
  }
}
function lcLayerLabel(L){
  if(L.type==='text')return '🔤 "'+(L.text||'TEXT')+'"';
  if(L.type==='shape')return '◆ '+L.shape;
  return '🖼 image';
}
function renderLogoCreatorUI(){
  renderLogoCreatorCanvas();
  const list=document.getElementById('lcLayerList');
  list.innerHTML='';
  for(let i=lcLayers.length-1;i>=0;i--){
    const L=lcLayers[i];
    const row=document.createElement('div');
    row.className='lc-layer-row'+(i===lcSelectedIdx?' active':'');
    // list renders top-to-bottom = front-to-back (last array entry drawn
    // last = on top = shown first here), so "move up" in this list means
    // moving LATER in the array — same +1/-1 = up/down convention as the
    // main Layers panel's decal/paint reorder.
    row.innerHTML=`<span class="lc-layer-label">${lcLayerLabel(L)}</span>
      <span class="lc-layer-btn" data-act="up" data-i="${i}" title="Move up"${i===lcLayers.length-1?' style="opacity:.2;pointer-events:none;"':''}>↑</span>
      <span class="lc-layer-btn" data-act="down" data-i="${i}" title="Move down"${i===0?' style="opacity:.2;pointer-events:none;"':''}>↓</span>
      <span class="lc-layer-btn" data-act="dup" data-i="${i}" title="Duplicate">⧉</span>
      <span class="lc-layer-btn" data-act="del" data-i="${i}" title="Delete">🗑</span>`;
    row.addEventListener('click',e=>{if(e.target.dataset.act)return;lcSelectedIdx=i;renderLogoCreatorUI();});
    list.appendChild(row);
  }
  list.querySelectorAll('[data-act="del"]').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();const i=+b.dataset.i;lcLayers.splice(i,1);
    if(lcSelectedIdx===i)lcSelectedIdx=-1;else if(lcSelectedIdx>i)lcSelectedIdx--;
    renderLogoCreatorUI();
  }));
  list.querySelectorAll('[data-act="dup"]').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();const i=+b.dataset.i,copy=Object.assign({},lcLayers[i],{id:lcNewId(),x:lcLayers[i].x+18,y:lcLayers[i].y+18});
    lcLayers.push(copy);lcSelectedIdx=lcLayers.length-1;renderLogoCreatorUI();
  }));
  list.querySelectorAll('[data-act="up"]').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();lcReorderLayer(+b.dataset.i,1);
  }));
  list.querySelectorAll('[data-act="down"]').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();lcReorderLayer(+b.dataset.i,-1);
  }));
  renderLcLayerProps();
}
function lcReorderLayer(idx,dir){
  const j=idx+dir;
  if(j<0||j>=lcLayers.length)return;
  [lcLayers[idx],lcLayers[j]]=[lcLayers[j],lcLayers[idx]];
  if(lcSelectedIdx===idx)lcSelectedIdx=j;else if(lcSelectedIdx===j)lcSelectedIdx=idx;
  renderLogoCreatorUI();
}
function renderLcLayerProps(){
  const el=document.getElementById('lcLayerProps');
  const L=lcLayers[lcSelectedIdx];
  if(!L){el.innerHTML='<div class="rp-note">Select or add a layer to edit it.</div>';return;}
  let html='';
  if(L.type==='text'){
    html+=`<input id="lcTextInput" value="${(L.text||'').replace(/"/g,'&quot;')}" style="width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);padding:8px 10px;margin-bottom:10px;">`;
  }
  if(L.type==='text'||L.type==='shape'){
    html+=`<div class="zone-row" id="lcColorRow"><div class="zone-swatch" id="lcColorSwatch" style="background:${L.color||'#ffffff'}"></div>
      <div class="zone-info"><div class="zone-name">Color</div></div></div>`;
  }
  html+=`<div class="mat-slider-row"><div class="mat-slider-label"><span>Scale</span><b id="lcScaleVal"></b></div>
    <input type="range" id="lcScaleSlider" min="0.2" max="3" step="0.02"></div>
  <div class="mat-slider-row"><div class="mat-slider-label"><span>Rotation</span><b id="lcRotVal"></b></div>
    <input type="range" id="lcRotSlider" min="-180" max="180" step="1"></div>`;
  el.innerHTML=html;

  const textInput=document.getElementById('lcTextInput');
  if(textInput)textInput.addEventListener('input',()=>{L.text=textInput.value;renderLogoCreatorCanvas();
    // keep the layer list label in sync without losing focus on the input
    const activeRow=document.querySelector('.lc-layer-row.active .lc-layer-label');
    if(activeRow)activeRow.textContent=lcLayerLabel(L);
  });
  const colorRow=document.getElementById('lcColorRow');
  if(colorRow)colorRow.addEventListener('click',()=>openColorPicker(document.getElementById('lcColorSwatch'),'lclayer',null));

  const scaleSlider=document.getElementById('lcScaleSlider');
  scaleSlider.value=L.scale;document.getElementById('lcScaleVal').textContent=L.scale.toFixed(2)+'×';
  scaleSlider.addEventListener('input',()=>{L.scale=+scaleSlider.value;document.getElementById('lcScaleVal').textContent=L.scale.toFixed(2)+'×';renderLogoCreatorCanvas();});

  const rotSlider=document.getElementById('lcRotSlider');
  rotSlider.value=L.rotation*180/Math.PI;document.getElementById('lcRotVal').textContent=Math.round(rotSlider.value)+'°';
  rotSlider.addEventListener('input',()=>{L.rotation=(+rotSlider.value)*Math.PI/180;document.getElementById('lcRotVal').textContent=Math.round(rotSlider.value)+'°';renderLogoCreatorCanvas();});
}
function lcHitTest(px,py){
  for(let i=lcLayers.length-1;i>=0;i--){
    const L=lcLayers[i],r=lcLayerRadius(L);
    if(Math.hypot(px-L.x,py-L.y)<=r+10)return i;
  }
  return -1;
}
logoCanvasEl.addEventListener('pointerdown',e=>{
  const r=logoCanvasEl.getBoundingClientRect();
  const px=(e.clientX-r.left)*(512/r.width),py=(e.clientY-r.top)*(512/r.height);
  const hit=lcHitTest(px,py);
  if(hit>=0){lcSelectedIdx=hit;lcDragging=true;lcDragStart={px,py,ox:lcLayers[hit].x,oy:lcLayers[hit].y};renderLogoCreatorUI();}
  logoCanvasEl.setPointerCapture(e.pointerId);
});
logoCanvasEl.addEventListener('pointermove',e=>{
  if(!lcDragging||lcSelectedIdx<0)return;
  const r=logoCanvasEl.getBoundingClientRect();
  const px=(e.clientX-r.left)*(512/r.width),py=(e.clientY-r.top)*(512/r.height);
  const L=lcLayers[lcSelectedIdx];
  L.x=lcDragStart.ox+(px-lcDragStart.px);L.y=lcDragStart.oy+(py-lcDragStart.py);
  renderLogoCreatorCanvas();
});
addEventListener('pointerup',()=>{lcDragging=false;});

function openLogoCreator(){
  lcLayers=[];lcSelectedIdx=-1;
  renderLogoCreatorUI();
  document.getElementById('logoCreatorOverlay').classList.add('open');
}
function closeLogoCreator(){document.getElementById('logoCreatorOverlay').classList.remove('open');}
document.getElementById('logoCreatorClose').addEventListener('click',closeLogoCreator);
document.getElementById('lcCancelBtn').addEventListener('click',closeLogoCreator);
document.getElementById('lcAddText').addEventListener('click',()=>lcAddLayer({type:'text',text:'LOGO',color:'#ffffff',fontSize:64}));
/* Same shape set as the on-model stamper, built from the same list. */
(function(){
  const g=document.getElementById('lcShapeGrid');
  if(!g)return;
  g.innerHTML=IHC_SHAPES.map(s=>
    `<div class="lc-shape-btn" data-shape="${s.id}" title="${s.label}">${s.icon}</div>`).join('');
  g.querySelectorAll('[data-shape]').forEach(b=>{
    b.addEventListener('click',()=>lcAddLayer({type:'shape',shape:b.dataset.shape,color:'#7c5cff'}));
  });
})();
document.getElementById('lcImportFile').addEventListener('change',e=>{
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    const img=new Image();
    img.onload=()=>lcAddLayer({type:'image',img});
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value='';
});
document.getElementById('lcSaveBtn').addEventListener('click',()=>{
  if(!lcLayers.length){showToast('Add at least one layer first');return;}
  const prevSel=lcSelectedIdx;lcSelectedIdx=-1;renderLogoCreatorCanvas(); // hide selection ring for the export
  const dataURL=logoCanvasEl.toDataURL('image/png');
  lcSelectedIdx=prevSel;renderLogoCreatorCanvas();
  const name=window.prompt('Name this logo:','My Logo')||'Logo';
  logoLibrary.push({id:'LG'+Date.now(),name,dataURL,img:(()=>{const im=new Image();im.src=dataURL;return im;})()});
  saveLogoLibrary();
  renderLogoLibraryGrid();
  closeLogoCreator();
  showToast('Logo saved to library');
});

/* ============================== DECAL PLACEMENT ============================== */
/* A decal is a LAYER in the one stack (see THE LAYER STACK above), stored as a
   description and re-rendered from it every time:

     kind 'shape'  a vector path from core's IHC_SHAPES + a colour and an
                   optional outline. Stays crisp at any size and stays
                   recolourable forever, because nothing was ever rasterized.
     kind 'logo'   a bitmap from the saved-logo library (the 2D compositor's
                   output, or an imported PNG).

   Both carry the same transform — u/v position, sx/sy (independent, so a
   decal can be STRETCHED, not just scaled), rotation, flips — plus the layer
   fields every layer has: opacity, paint/erase mode, visibility, name.
   Quick-stamped shapes used to be rasterized to a 256px PNG and pushed into
   the logo library, which froze their colour and their resolution at stamp
   time and littered the library with one entry per stamp. */
let logoLibrary=[];
const DECAL_DEFAULT_SIZE=0.15;
function isDecalLayer(L){return !!L&&L.kind!=='stroke'&&!L.points;}
function loadLogoLibrary(){
  try{logoLibrary=JSON.parse(localStorage.getItem('ihc_logos_v1')||'[]');}catch(e){logoLibrary=[];}
  logoLibrary.forEach(l=>{l.img=new Image();l.img.onload=()=>redrawPaintLayer();l.img.src=l.dataURL;});
}
function saveLogoLibrary(){
  localStorage.setItem('ihc_logos_v1',JSON.stringify(logoLibrary.map(l=>({id:l.id,name:l.name,dataURL:l.dataURL}))));
}
function renderLogoLibraryGrid(){
  const grid=document.getElementById('logoLibraryGrid');
  if(!grid)return;
  grid.innerHTML='';
  if(!logoLibrary.length){grid.innerHTML='<div class="rp-note" style="grid-column:1/-1;">No saved logos yet — create one or import an image.</div>';return;}
  logoLibrary.forEach(l=>{
    const d=document.createElement('div');
    d.className='palette-swatch';
    d.style.background=`#14151c url(${l.dataURL}) center/contain no-repeat`;
    d.title=l.name+' — click to place on '+paintTarget;
    /* Start at the bitmap's OWN aspect rather than a forced square — a wide
       wordmark stamped into a square box lands pre-squashed, and "fix the
       stretch I never asked for" is a bad first move. */
    d.addEventListener('click',()=>{
      // also load ✦, so picking here then clicking the model stamps THIS logo
      stampPick={kind:'logo',id:l.id};
      const ar=(l.img&&l.img.complete&&l.img.naturalWidth)
        ?l.img.naturalHeight/l.img.naturalWidth:1;
      placeDecal({kind:'logo',logoId:l.id,name:l.name,
        sx:DECAL_DEFAULT_SIZE,sy:DECAL_DEFAULT_SIZE*ar});
    });
    grid.appendChild(d);
  });
}
function renderShapeGrid(){
  const grid=document.getElementById('shapeGrid');
  if(!grid)return;
  grid.innerHTML=IHC_SHAPES.map(s=>
    `<div class="lc-shape-btn" data-qshape="${s.id}" title="${s.label}">${s.icon}</div>`).join('');
  grid.querySelectorAll('[data-qshape]').forEach(b=>{
    b.addEventListener('click',()=>{
      stampPick={kind:'shape',id:b.dataset.qshape}; // keep ✦ in sync with the panel
      const def=ihcShape(b.dataset.qshape);
      const ar=def.ar||1;
      placeDecal({kind:'shape',shape:def.id,name:def.label,color:paintBrushColor,
        sx:DECAL_DEFAULT_SIZE*ar,sy:DECAL_DEFAULT_SIZE,
        outline:{on:false,color:'#000000',width:8}});
    });
  });
}
/* Where a freshly stamped decal lands: dead centre of the viewport, on the
   current paint target. Uses the same skinned-proxy raycast the brush does —
   without it a centre-screen drop onto the helmet missed the bind-pose
   collider and fell back to the atlas centre (0.5,0.5), which is outside the
   helmet's UV island entirely, so the decal landed on no visible surface. */
function decalDropPoint(){
  const meshes=getPaintTargetMeshes().map(skinnedPaintProxy);
  if(meshes.length){
    raycaster.setFromCamera(new THREE.Vector2(0,0),camera);
    const hits=raycaster.intersectObjects(meshes,false);
    if(hits.length&&hits[0].uv){
      return{u:hits[0].uv.x,v:hits[0].uv.y,
        side:hits[0].object.worldToLocal(hits[0].point.clone()).x>=0?1:-1,
        b:ihcMeshBothHalves(hits[0].object.name)?1:0,hit:true};
    }
  }
  return{u:0.5,v:0.5,side:1,b:0,hit:false};
}
function paintTargetLabel(){
  const d=ihcPiece(paintTarget);
  return d?d.label:'part';
}
/* Turns whatever ✦ is currently loaded with into a real layer at an explicit
   UV. Shares placeDecal's spec-building with the right-panel grids so the two
   entry points can never drift into stamping different things. */
function stampSpec(){
  if(stampPick.kind==='logo'){
    const l=logoLibrary.find(x=>x.id===stampPick.id);
    if(!l)return null;
    const ar=(l.img&&l.img.complete&&l.img.naturalWidth)
      ?l.img.naturalHeight/l.img.naturalWidth:1;
    return{kind:'logo',logoId:l.id,name:l.name,
      sx:DECAL_DEFAULT_SIZE,sy:DECAL_DEFAULT_SIZE*ar};
  }
  const def=ihcShape(stampPick.id);
  const ar=def.ar||1;
  return{kind:'shape',shape:def.id,name:def.label,color:paintBrushColor,
    sx:DECAL_DEFAULT_SIZE*ar,sy:DECAL_DEFAULT_SIZE,
    outline:{on:false,color:'#000000',width:8}};
}
function stampDecalAt(uv){
  const spec=stampSpec();
  if(!spec){showToast('That logo is gone from the library — pick another');return;}
  /* keepTool: a stamp click must NOT arm ✥ the way the panel grids do, or the
     very next click would drag the decal you just placed instead of dropping
     a second one. The pointerdown handler already put this drag in 'decal'
     mode, so dragging on from the stamp still slides it. */
  placeDecal(spec,{u:uv.x,v:uv.y,side:uv.side,b:uv.b?1:0,hit:true},true);
}
function placeDecal(spec,at,keepTool){
  const p=at||decalDropPoint();
  if(!p.hit)showToast('Turn the model so the part faces you — the decal landed off-surface');
  layers.push(Object.assign({
    id:newLayerId('D'),target:paintTarget,visible:true,opacity:1,mode:'paint',
    u:p.u,v:p.v,side:p.side,b:p.b,
    sx:DECAL_DEFAULT_SIZE,sy:DECAL_DEFAULT_SIZE,rot:0,flipX:false,flipY:false,
  },spec));
  selectedLayerIdx=layers.length-1;
  redrawPaintLayer();
  renderLayersList();renderLayerControls();
  buildSidebar();
  pushHistory();
  /* Arm the move tool on placement. Placing a decal and then hunting for a
     "Move on Model" button two panels down was the single clunkiest step in
     the old flow — the thing you want next is always to position it. Stamping
     by click is the exception: there the decal already landed where you aimed,
     so staying on ✦ lets you drop several without a round trip to the rail. */
  if(!keepTool)setActiveTool('decal',true);
  syncToolRail();
}
function moveSelectedDecal(uv){
  const d=selectedLayer();
  if(!isDecalLayer(d))return;
  d.u=uv.x;d.v=uv.y;d.side=uv.side;d.b=uv.b?1:0;d.target=paintTarget;
  redrawPaintLayer();
}
/* ---------------------------- THE LAYER PANEL ----------------------------
   One list for the whole stack, newest/topmost first — the GIMP convention,
   and the same one the logo compositor's own list uses. There used to be two
   lists (decals, then paint strokes) that could not be interleaved because
   the shader composited their two textures in a fixed order. */
function selectLayer(idx){
  selectedLayerIdx=(selectedLayerIdx===idx)?-1:idx;
  /* The move tool only means anything with a decal selected; picking a stroke
     while it is armed would otherwise leave a drag that silently does nothing. */
  if(activeTool==='decal'&&!isDecalLayer(selectedLayer()))setActiveTool('orbit',true);
  renderLayersList();renderLayerControls();syncToolRail();
}
function deleteLayer(idx){
  if(idx<0||idx>=layers.length)return;
  layers.splice(idx,1);
  if(selectedLayerIdx===idx)selectedLayerIdx=-1;
  else if(selectedLayerIdx>idx)selectedLayerIdx--;
  if(activeTool==='decal'&&!isDecalLayer(selectedLayer()))setActiveTool('orbit',true);
  redrawPaintLayer();
  renderLayersList();renderLayerControls();
  buildSidebar();
  pushHistory();
}
function duplicateLayer(idx){
  const L=layerAt(idx);
  if(!L)return;
  const copy=JSON.parse(JSON.stringify(L));
  copy.id=newLayerId(copy.kind==='stroke'?'S':'D');
  copy.name=(copy.name||'Layer')+' copy';
  // offset a duplicated decal so it isn't invisibly stacked on its original
  if(isDecalLayer(copy)){copy.u+=0.02;copy.v+=0.02;}
  layers.splice(idx+1,0,copy);
  selectedLayerIdx=idx+1;
  redrawPaintLayer();
  renderLayersList();renderLayerControls();
  buildSidebar();
  pushHistory();
  showToast('Layer duplicated');
}
/* Swaps array-adjacent entries — replay draws `layers` in array order (later =
   on top), so this is a genuine z-order change, not a list reshuffle. */
function reorderLayer(idx,dir){
  const j=idx+dir;
  if(j<0||j>=layers.length)return;
  [layers[idx],layers[j]]=[layers[j],layers[idx]];
  if(selectedLayerIdx===idx)selectedLayerIdx=j;else if(selectedLayerIdx===j)selectedLayerIdx=idx;
  redrawPaintLayer();
  renderLayersList();renderLayerControls();
  pushHistory();
}
function toggleLayerVisible(idx){
  const L=layerAt(idx);if(!L)return;
  L.visible=L.visible===false;
  redrawPaintLayer();
  renderLayersList();renderLayerControls();
  pushHistory();
}
function layerLabel(L){
  if(L.kind==='stroke')return L.name||(L.mode==='erase'?'Erase':'Stroke');
  if(L.kind==='logo'){
    const lib=logoLibrary.find(l=>l.id===L.logoId);
    return L.name||(lib?lib.name:'Logo');
  }
  return L.name||ihcShape(L.shape).label;
}
/* A real thumbnail of the layer itself, not a colour chip: for a shape that
   means the actual path, drawn at the layer's own aspect. */
function layerThumbCSS(L){
  if(L.kind==='stroke'){
    return L.mode==='erase'
      ?'background:repeating-conic-gradient(#2a2d3a 0% 25%,#1b1d27 0% 50%) 50%/10px 10px;'
      :'background:'+(L.color||'#fff')+';';
  }
  if(L.kind==='logo'){
    const lib=logoLibrary.find(l=>l.id===L.logoId);
    return 'background:#14151c'+(lib?` url(${lib.dataURL}) center/contain no-repeat`:'')+';';
  }
  const c=document.createElement('canvas');c.width=c.height=44;
  const x=c.getContext('2d');
  x.translate(22,22);
  const ar=(L.sx||1)/(L.sy||1);
  x.scale(ar>=1?1:ar,ar>=1?1/ar:1);
  ihcShapePath(x,L.shape,19);
  x.fillStyle=L.mode==='erase'?'#8a8f9e':(L.color||'#fff');
  x.fill();
  return `background:#14151c url(${c.toDataURL()}) center/contain no-repeat;`;
}
function updateLayersTotalBadge(){
  const b=document.getElementById('layersTotalBadge');
  if(b)b.textContent=layerCountForTarget(paintTarget)+' on this part · '+layers.length+' total';
}
function renderLayersList(){
  updateLayersTotalBadge();
  const el=document.getElementById('layersList');
  if(!el)return;
  if(!layers.length){
    el.innerHTML='<div class="rp-note">Nothing on the kit yet — stamp a shape above, or pick 🖌 on the tool rail (B) and drag on the model.</div>';
    return;
  }
  /* Top of the stack first. Rows are addressed by their index in the REAL
     array, so the this-part filter drops rows rather than compacting the list
     — an index off by the number of hidden rows would delete the wrong layer. */
  let shown=0,html='';
  for(let i=layers.length-1;i>=0;i--){
    const L=layers[i];
    if(layersThisPartOnly&&L.target!==paintTarget)continue;
    shown++;
    const active=i===selectedLayerIdx,hidden=L.visible===false;
    const op=L.opacity===undefined?1:L.opacity;
    const meta=[
      L.kind==='stroke'?(L.points?L.points.length+'pt':''):Math.round((L.sx||0)*100)+'×'+Math.round((L.sy||0)*100),
      L.mode==='erase'?'erase':'',
      op<1?Math.round(op*100)+'%':'',
    ].filter(Boolean).join(' · ');
    html+=`<div class="layer-row${active?' active':''}${hidden?' hidden-layer':''}" data-idx="${i}">
      <div class="layer-thumb" style="${layerThumbCSS(L)}"></div>
      <div class="layer-label">${L.mode==='erase'?'🧽 ':''}${layerLabel(L)}<span style="opacity:.55;font-weight:500;"> ${meta}</span></div>
      <div class="layer-btn" data-vis-idx="${i}" title="${hidden?'Show':'Hide'}">${hidden?'🚫':'👁'}</div>
      <div class="layer-btn" data-up-idx="${i}" title="Move up"${i===layers.length-1?' disabled':''}>↑</div>
      <div class="layer-btn" data-down-idx="${i}" title="Move down"${i===0?' disabled':''}>↓</div>
      <div class="layer-btn" data-dup-idx="${i}" title="Duplicate">⧉</div>
      <div class="layer-btn" data-del-idx="${i}" title="Delete">🗑</div>
    </div>`;
  }
  el.innerHTML=shown?html
    :'<div class="rp-note">Nothing on this part. Untick “Only show this part’s layers” to see the other '+layers.length+'.</div>';
  el.querySelectorAll('.layer-row').forEach(row=>{
    row.addEventListener('click',e=>{
      if(e.target.closest('.layer-btn'))return;
      selectLayer(+row.dataset.idx);
    });
  });
  const on=(attr,fn)=>el.querySelectorAll('['+attr+']').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();fn(+b.getAttribute(attr));
  }));
  on('data-vis-idx',toggleLayerVisible);
  on('data-up-idx',i=>reorderLayer(i,1));
  on('data-down-idx',i=>reorderLayer(i,-1));
  on('data-dup-idx',duplicateLayer);
  on('data-del-idx',deleteLayer);
}
/* Properties of the selected layer. Shape/logo decals get the full Forza
   transform set; strokes get what a replayed point path can honestly still
   change after the fact (thickness, colour, opacity). */
function renderLayerControls(){
  const el=document.getElementById('layerControls');
  if(!el)return;
  const L=selectedLayer();
  if(!L){el.innerHTML='';return;}
  const isStroke=L.kind==='stroke';
  const op=L.opacity===undefined?1:L.opacity;
  const slider=(id,label,min,max,step,val,fmt)=>
    `<div class="mat-slider-row"><div class="mat-slider-label"><span>${label}</span><b id="${id}Val">${fmt}</b></div>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
  let html=`<div class="rp-section-title" style="margin-top:14px;">Selected layer</div>
    <input id="layerNameInput" value="${(layerLabel(L)||'').replace(/"/g,'&quot;')}"
      style="width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-weight:600;padding:8px 10px;margin-bottom:10px;">`;
  /* Any layer can be a REMOVER: flipped to erase it composites destination-out
     and rubs out everything below it in its own stack instead of painting.
     That is what "paint or remove over" means for a shape — a star-shaped hole
     punched through the paint underneath, still movable and still undoable. */
  html+=`<div class="btn-row" style="margin-bottom:10px;">
      <div class="btn${L.mode!=='erase'?' primary':''}" id="layerModePaint">🖌 Paint</div>
      <div class="btn${L.mode==='erase'?' primary':''}" id="layerModeErase">🧽 Remove</div>
    </div>`;
  html+=slider('layerOpacity','Opacity',0.05,1,0.05,op,Math.round(op*100)+'%');
  if(isStroke){
    html+=slider('layerSize','Thickness',6,140,2,L.size,L.size);
  }else{
    html+=slider('layerSx','Width',0.02,0.9,0.01,L.sx,Math.round(L.sx*100)+'%');
    html+=slider('layerSy','Height',0.02,0.9,0.01,L.sy,Math.round(L.sy*100)+'%');
    html+=slider('layerRot','Rotation',-180,180,1,Math.round((L.rot||0)*180/Math.PI),Math.round((L.rot||0)*180/Math.PI)+'°');
    html+=`<div class="btn-row" style="margin-top:4px;">
        <div class="btn" id="layerFlipX">⇄ Flip H</div>
        <div class="btn" id="layerFlipY">⇅ Flip V</div>
        <div class="btn" id="layerUniform" title="Match height to width">⬜ Un-stretch</div>
      </div>`;
  }
  if(isStroke||L.kind==='shape'){
    html+=`<div class="zone-row" id="layerColorRow" style="margin-top:10px;">
        <div class="zone-swatch" id="layerColorSwatch" style="background:${L.color||'#ffffff'}"></div>
        <div class="zone-info"><div class="zone-name">${L.mode==='erase'?'Colour (unused while removing)':'Colour'}</div></div></div>`;
  }
  if(L.kind==='shape'){
    const o=L.outline||(L.outline={on:false,color:'#000000',width:8});
    html+=`<label class="rp-check" style="margin-top:10px;"><input type="checkbox" id="layerOutlineOn"${o.on?' checked':''}> Outline</label>`;
    if(o.on){
      html+=slider('layerOutlineW','Outline width',1,30,1,o.width,o.width);
      html+=`<div class="zone-row" id="layerOutlineRow"><div class="zone-swatch" id="layerOutlineSwatch" style="background:${o.color}"></div>
        <div class="zone-info"><div class="zone-name">Outline colour</div></div></div>`;
    }
  }
  html+=`<div class="btn-row" style="margin-top:10px;">
      <div class="btn" id="layerDupBtn">⧉ Duplicate</div>
      <div class="btn" id="layerDelBtn">🗑 Delete</div>
    </div>`;
  if(!isStroke)html+=`<div style="font-size:13px;color:var(--text-faint);margin-top:6px;">Pick ✥ on the tool rail (or press M) to drag this decal around on the model.</div>`;
  el.innerHTML=html;

  const live=()=>{redrawPaintLayer();};
  const commit=()=>{renderLayersList();buildSidebar();pushHistory();};
  const bind=(id,fn,fmt)=>{
    const s=document.getElementById(id);
    if(!s)return;
    s.addEventListener('input',()=>{fn(+s.value);document.getElementById(id+'Val').textContent=fmt(+s.value);live();});
    s.addEventListener('change',commit);
  };
  bind('layerOpacity',v=>L.opacity=v,v=>Math.round(v*100)+'%');
  bind('layerSize',v=>L.size=v,v=>v);
  bind('layerSx',v=>L.sx=v,v=>Math.round(v*100)+'%');
  bind('layerSy',v=>L.sy=v,v=>Math.round(v*100)+'%');
  bind('layerRot',v=>L.rot=v*Math.PI/180,v=>Math.round(v)+'°');
  bind('layerOutlineW',v=>L.outline.width=v,v=>v);

  const nameInput=document.getElementById('layerNameInput');
  nameInput.addEventListener('input',()=>{L.name=nameInput.value;});
  // rename repaints the LIST, which would blow away the focused input mid-type
  nameInput.addEventListener('change',()=>{renderLayersList();pushHistory();});

  const setMode=m=>{L.mode=m;live();renderLayerControls();renderLayersList();pushHistory();};
  document.getElementById('layerModePaint').addEventListener('click',()=>setMode('paint'));
  document.getElementById('layerModeErase').addEventListener('click',()=>setMode('erase'));

  const btn=(id,fn)=>{const b=document.getElementById(id);if(b)b.addEventListener('click',fn);};
  btn('layerFlipX',()=>{L.flipX=!L.flipX;live();commit();});
  btn('layerFlipY',()=>{L.flipY=!L.flipY;live();commit();});
  btn('layerUniform',()=>{L.sy=L.sx;live();renderLayerControls();commit();});
  btn('layerDupBtn',()=>duplicateLayer(selectedLayerIdx));
  btn('layerDelBtn',()=>deleteLayer(selectedLayerIdx));
  btn('layerColorRow',()=>openColorPicker(document.getElementById('layerColorSwatch'),'layercolor',selectedLayerIdx));
  btn('layerOutlineRow',()=>openColorPicker(document.getElementById('layerOutlineSwatch'),'layeroutline',selectedLayerIdx));
  const oc=document.getElementById('layerOutlineOn');
  if(oc)oc.addEventListener('change',()=>{L.outline.on=oc.checked;live();renderLayerControls();commit();});
}

/* ============================== HISTORY MANAGER ============================== */
const history=[];let historyIdx=-1;
function captureState(){
  return{
    pieces:capturePieceColors(),
    body:bodyZM.zones.map(z=>'#'+z.color.getHexString()),
    stick:stickZM.zones.map(z=>'#'+z.color.getHexString()),
    neck:'#'+neckZone.color.getHexString(),
    name:jerseyName,number:jerseyNumber,
    // vector data (points/transforms/style), not raw pixels — cheap enough to
    // snapshot on every history push, see redrawPaintLayer's own note.
    layers:JSON.parse(JSON.stringify(layers)),
    jerseyFont,
  };
}
function pushHistory(){
  const snap=captureState();
  history.length=historyIdx+1;
  history.push(snap);historyIdx++;
  if(history.length>60){history.shift();historyIdx--;}
  /* Decoration autosaves HERE. saveToStore's own header has always claimed
     "every edit path funnels through redrawNameNumber or pushHistory, and
     both call this" — pushHistory did not, so a session spent only painting
     (no colour, name or font change, no Save & Exit) persisted nothing.
     It also matters more now than it did: undo/presets REPLACE the `layers`
     array rather than mutating it, so the store's reference to the old one
     goes stale the moment you undo, and only a write puts it right. */
  saveToStore();
}
function applyState(s){
  // pre-per-piece snapshots only carry `body` — migrate them the same way a
  // stored team design gets migrated, so old history/presets still restore.
  applyPieceColors(s.pieces||ihtPiecesFromBody(s.body));
  s.stick.forEach((hex,i)=>stickZM.setZoneColor(i,hex));
  if(s.neck)neckZone.setColor(s.neck);
  jerseyName=s.name||'';
  // number is never undoable editor state anymore — it's whatever the team
  // admin has assigned for the current team (request/approve flow)
  jerseyNumber=ihtEffectiveNumber(ctxTeam());
  const ni=document.getElementById('nameInput');if(ni)ni.value=jerseyName;
  jerseyFont=s.jerseyFont||'Arial';
  const fs=document.getElementById('fontSelect');if(fs)fs.value=jerseyFont;
  /* Snapshots taken before the layer stack existed carry the old two-list
     shape; migrating on the way in is what keeps a preset saved last week
     restorable today. A snapshot with neither key predates decoration
     entirely and restores as an empty stack. */
  layers=JSON.parse(JSON.stringify(
    s.layers||ihcMigrateLayers(s.paintStrokes,s.placedDecals)));
  selectedLayerIdx=-1;
  if(activeTool==='decal')setActiveTool('orbit',true);
  redrawPaintLayer();
  renderLayersList();renderLayerControls();
  refreshSwatches();
}
function undo(){if(historyIdx>0){historyIdx--;applyState(history[historyIdx]);showToast('Undo');}}
function redo(){if(historyIdx<history.length-1){historyIdx++;applyState(history[historyIdx]);showToast('Redo');}}

/* ============================== EXPORT / IMPORT CODE ==============================
   A shareable text version of the whole loadout — captureState()/applyState()
   already define exactly the fields that make up "the whole loadout" (used
   for undo/redo), so this is just that same snapshot base64-encoded instead
   of kept in memory. unescape/encodeURIComponent (and its inverse) round-trip
   non-ASCII safely through btoa/atob, which only handle Latin1 natively. */
function exportLoadoutCode(){
  try{
    const json=JSON.stringify(captureState());
    const code=btoa(unescape(encodeURIComponent(json)));
    window.prompt('Your loadout code — copy it (Ctrl/Cmd+C) to share or back up. Paste it back in later with Import Code.',code);
  }catch(e){showToast('Export failed');}
}
function importLoadoutCode(){
  const code=window.prompt('Paste a loadout code:');
  if(!code)return;
  try{
    const json=decodeURIComponent(escape(atob(code.trim())));
    const s=JSON.parse(json);
    if(!s||!Array.isArray(s.body)||!Array.isArray(s.stick))throw new Error('not a loadout code');
    applyState(s);
    pushHistory();
    showToast('Loadout imported');
  }catch(e){showToast('That code isn’t a valid loadout — check you copied the whole thing');}
}
addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.shiftKey){e.preventDefault();undo();}
  if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='y'||(e.key.toLowerCase()==='z'&&e.shiftKey))){e.preventDefault();redo();}
});

/* ============================== PRESET MANAGER ============================== */
function loadPresets(){try{return JSON.parse(localStorage.getItem('ihc_presets_v1')||'[]');}catch(e){return[];}}
function savePresets(a){localStorage.setItem('ihc_presets_v1',JSON.stringify(a));}
function promptSavePreset(){
  const name=window.prompt('Name this loadout:','My Loadout');
  if(!name)return;
  const presets=loadPresets();
  presets.push({
    id:'p'+Date.now(),name,
    pieces:capturePieceColors(),
    body:bodyZM.zones.map(z=>'#'+z.color.getHexString()),
    stick:stickZM.zones.map(z=>'#'+z.color.getHexString()),
    neck:'#'+neckZone.color.getHexString(),
    jname:jerseyName,jnumber:jerseyNumber,jfont:jerseyFont,
    layers:JSON.parse(JSON.stringify(layers)),
  });
  savePresets(presets);renderRightPanel();showToast('Preset saved');
}
function applyPreset(id){
  const p=loadPresets().find(x=>x.id===id);if(!p)return;
  applyPieceColors(p.pieces||ihtPiecesFromBody(p.body)); // presets saved before per-piece colors carry only `body`
  p.stick.forEach((hex,i)=>stickZM.setZoneColor(i,hex));
  if(p.neck)neckZone.setColor(p.neck);
  jerseyName=p.jname||'';jerseyNumber=p.jnumber||'';
  jerseyFont=p.jfont||'Arial';
  nameFontSizeCache=null;numberFontSizeCache=null;
  { const fs=document.getElementById('fontSelect'); if(fs)fs.value=jerseyFont; }
  const ni=document.getElementById('nameInput');if(ni)ni.value=jerseyName;
  const nu=document.getElementById('numberInput');if(nu)nu.value=jerseyNumber;
  // presets saved before the layer stack carry the old two-list shape
  layers=JSON.parse(JSON.stringify(p.layers||ihcMigrateLayers(p.paintStrokes,p.placedDecals)));
  selectedLayerIdx=-1;
  if(activeTool==='decal')setActiveTool('orbit',true);
  redrawPaintLayer();
  renderLayersList();renderLayerControls();
  refreshSwatches();pushHistory();showToast(p.name+' loaded');
}

/* ============================== TOOL RAIL UI ==============================
   The rail is the fix for "where is the paint tool". It is always in the same
   place (top-left of the viewport), it always shows which verb is armed, and
   the armed verb's own settings sit next to it in the options bar rather than
   ten sections down a scrolling property panel. */
function toolAvailable(t){
  if(t.decorateOnly&&currentActivity!=='decorate')return false;
  // ✥ moves the SELECTED decal, so it is only meaningful with one selected
  if(t.id==='decal'&&!isDecalLayer(selectedLayer()))return false;
  return true;
}
function buildToolRail(){
  const rail=document.getElementById('toolRail');
  if(!rail)return;
  rail.innerHTML='';
  TOOLS.forEach(t=>{
    const b=document.createElement('button');
    b.className='rail-btn';
    b.dataset.tool=t.id;
    b.title=t.label+' ('+t.key+')';
    b.innerHTML=t.icon+'<span class="rail-key">'+t.key+'</span>';
    b.addEventListener('click',()=>setActiveTool(t.id));
    rail.appendChild(b);
  });
  syncToolRail();
}
function syncToolRail(){
  const rail=document.getElementById('toolRail');
  if(!rail)return;
  /* Fall back to orbit the moment the armed tool stops being offered — leaving
     a hidden tool armed is how a click that should have selected a part got
     eaten instead. Safe to assign here: setActiveTool bails BEFORE assigning
     when a tool is unavailable, so this can never bounce between the two. */
  if(!toolAvailable(toolDef(activeTool)))activeTool='orbit';
  TOOLS.forEach(t=>{
    const b=rail.querySelector('[data-tool="'+t.id+'"]');
    if(!b)return;
    b.classList.toggle('hidden-tool',!toolAvailable(t));
    b.classList.toggle('active',t.id===activeTool);
  });
  renderToolOptions();
  syncModeBanner();
  renderer.domElement.style.cursor=spaceOrbit?'grab':(toolDef(activeTool).cursor||'');
  if(!isBrushLike())hideBrushRing();
  // switching tools mid-drag would otherwise strand the preview segment on screen
  if(!isLineTool())hideLinePreview();
}
/* Arming a tool the current activity doesn't offer is a no-op rather than a
   silent illegal state — e.g. B while designing colours. */
function setActiveTool(id,quiet){
  const t=toolDef(id);
  if(!toolAvailable(t)){
    if(!quiet&&t.decorateOnly)showToast(t.label+' lives in Decorate — switch activity first');
    else if(!quiet&&t.id==='decal')showToast('Select a decal layer first, then ✥ can move it');
    return;
  }
  activeTool=t.id;
  syncToolRail();
  if(!quiet&&t.banner)showToast(t.icon+' '+t.label+' — '+t.banner);
}
function renderToolOptions(){
  const bar=document.getElementById('toolOptions');
  if(!bar)return;
  const t=toolDef(activeTool);
  if(t.stamp){renderStampOptions(bar);return;}
  if(!t.paint){bar.classList.remove('open');bar.innerHTML='';return;}
  const isErase=t.id==='erase';
  bar.innerHTML=
    (isErase?'':`<div class="to-group"><span>Colour</span>
       <div class="to-swatch" id="toColorSwatch" style="background:${paintBrushColor}" title="Brush colour"></div></div>
     <div class="to-sep"></div>`)+
    `<div class="to-group"><span>Size</span><input type="range" id="toSize" min="6" max="140" step="2" value="${paintBrushSize}"><b id="toSizeVal">${paintBrushSize}</b></div>
     <div class="to-sep"></div>
     <div class="to-group"><span>${isErase?'Strength':'Opacity'}</span><input type="range" id="toOpacity" min="0.05" max="1" step="0.05" value="${paintBrushOpacity}"><b id="toOpacityVal">${Math.round(paintBrushOpacity*100)}%</b></div>
     <div class="to-sep"></div>
     <div class="to-group"><span>Hardness</span><input type="range" id="toHardness" min="0.05" max="1" step="0.05" value="${paintBrushHardness}"><b id="toHardnessVal">${Math.round(paintBrushHardness*100)}%</b></div>`;
  bar.classList.add('open');
  const sw=document.getElementById('toColorSwatch');
  if(sw)sw.addEventListener('click',()=>openColorPicker(sw,'paint',null));
  const size=document.getElementById('toSize');
  size.addEventListener('input',()=>{
    paintBrushSize=+size.value;
    document.getElementById('toSizeVal').textContent=paintBrushSize;
  });
  const op=document.getElementById('toOpacity');
  op.addEventListener('input',()=>{
    paintBrushOpacity=+op.value;
    document.getElementById('toOpacityVal').textContent=Math.round(paintBrushOpacity*100)+'%';
  });
  const hd=document.getElementById('toHardness');
  hd.addEventListener('input',()=>{
    paintBrushHardness=+hd.value;
    document.getElementById('toHardnessVal').textContent=Math.round(paintBrushHardness*100)+'%';
  });
}
/* ✦'s own settings: WHICH decal it will drop. The shapes and the saved logos
   both live here rather than only in the right panel, so the decal system is
   fully operable from the rail — arm ✦, pick, click the model. The right
   panel's grids stay as they are (they are also the library manager) and both
   write the same stampPick, so the two views cannot disagree.
   Scrolls sideways in one row on purpose: the options bar owns a strip of the
   viewport top, and a wrapping grid of 24 shapes here would eat the model. */
function renderStampOptions(bar){
  const isShape=stampPick.kind==='shape';
  bar.innerHTML=
    `<div class="to-group"><span>Colour</span>
       <div class="to-swatch" id="toColorSwatch" style="background:${paintBrushColor}" title="Shape colour (logos keep their own)"></div></div>
     <div class="to-sep"></div>
     <div class="to-group"><span>Shape</span><div class="to-stamps" id="toShapeStrip">`+
    IHC_SHAPES.map(s=>
      `<div class="to-stamp${isShape&&stampPick.id===s.id?' on':''}" data-sshape="${s.id}" title="${s.label}">${s.icon}</div>`).join('')+
    `</div></div>`+
    (logoLibrary.length
      ?`<div class="to-sep"></div>
        <div class="to-group"><span>Logo</span><div class="to-stamps" id="toLogoStrip">`+
       logoLibrary.map(l=>
         `<div class="to-stamp img${!isShape&&stampPick.id===l.id?' on':''}" data-slogo="${l.id}" title="${l.name}"
               style="background:#14151c url(${l.dataURL}) center/contain no-repeat"></div>`).join('')+
        `</div></div>`
      :'');
  bar.classList.add('open');
  const sw=document.getElementById('toColorSwatch');
  if(sw)sw.addEventListener('click',()=>openColorPicker(sw,'paint',null));
  bar.querySelectorAll('[data-sshape]').forEach(b=>b.addEventListener('click',()=>{
    stampPick={kind:'shape',id:b.dataset.sshape};renderToolOptions();
  }));
  bar.querySelectorAll('[data-slogo]').forEach(b=>b.addEventListener('click',()=>{
    stampPick={kind:'logo',id:b.dataset.slogo};renderToolOptions();
  }));
}
/* The old paint mode announced itself with nothing but a crosshair cursor, and
   the permanent viewport hint kept claiming "Drag to rotate" while dragging
   painted. Both now say what is actually true right now. */
function syncModeBanner(){
  const el=document.getElementById('modeBanner');
  const hint=document.getElementById('viewportHint');
  const t=toolDef(activeTool);
  if(el){
    if(t.banner&&!spaceOrbit){
      el.className='mode-banner open'+(t.id==='erase'?' erase':'');
      el.innerHTML=`${t.icon} <b>${t.label.toUpperCase()}</b> <span>${t.banner} · hold Space or middle-drag to orbit · Esc to exit</span>`;
    }else el.className='mode-banner';
  }
  /* ONE status line at a time. The banner already ends with "hold Space or
     middle-drag to orbit · Esc to exit", so the hint's armed-tool text was
     saying the same thing twice — in a second box, in the same corner. The
     hint is now only the idle/orbit help, and it yields whenever the banner
     is up; they share one slot, so neither can overlap anything. */
  if(hint){
    const bannerUp=!!(el&&el.classList.contains('open'));
    hint.classList.toggle('hidden',bannerUp);
    hint.textContent='Click any part of the player to edit it · Drag to rotate · Scroll to zoom · Double-click to reset the view';
  }
}
/* Keyboard: the rail's letters, [ ] for size, Space for a held orbit, Esc out.
   Guarded so typing a team name into a text field never arms the eraser. */
function typingInField(){
  const a=document.activeElement;
  return a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.tagName==='SELECT'||a.isContentEditable);
}
addEventListener('keydown',e=>{
  if(typingInField()||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.code==='Space'&&!spaceOrbit){
    e.preventDefault();spaceOrbit=true;syncToolRail();return;
  }
  if(e.key==='Escape'){setActiveTool('orbit');return;}
  if(e.key==='['||e.key===']'){
    const step=e.key==='['?-6:6;
    paintBrushSize=Math.max(6,Math.min(140,paintBrushSize+step));
    renderToolOptions();
    showToast('Brush '+paintBrushSize);
    return;
  }
  /* Layer keys, live wherever you are in Decorate — the layer panel is a long
     scroll and reaching for its buttons to nudge a decal a few texels was the
     slowest part of placing one. Arrows move the selected decal in UV, Shift
     makes it a coarse step; Delete removes whatever layer is selected. */
  const L=selectedLayer();
  if(currentActivity==='decorate'&&L){
    if(e.key==='Delete'||e.key==='Backspace'){
      e.preventDefault();deleteLayer(selectedLayerIdx);return;
    }
    if(isDecalLayer(L)&&e.key.indexOf('Arrow')===0){
      e.preventDefault();
      const d=e.shiftKey?0.01:0.002;
      if(e.key==='ArrowLeft')L.u-=d; else if(e.key==='ArrowRight')L.u+=d;
      else if(e.key==='ArrowUp')L.v-=d; else L.v+=d;
      redrawPaintLayer();
      return;
    }
  }
  const t=TOOLS.find(x=>x.key.toLowerCase()===e.key.toLowerCase());
  if(t)setActiveTool(t.id);
});
/* An arrow-key nudge run is one undo step, the same way a drag is. */
addEventListener('keyup',e=>{
  if(currentActivity==='decorate'&&e.key.indexOf('Arrow')===0&&isDecalLayer(selectedLayer()))pushHistory();
});
addEventListener('keyup',e=>{
  if(e.code==='Space'&&spaceOrbit){spaceOrbit=false;syncToolRail();}
});
// releasing Space outside the window would otherwise leave orbit stuck on
addEventListener('blur',()=>{if(spaceOrbit){spaceOrbit=false;syncToolRail();}});

/* ============================== MISC UI ============================== */
let toastT=null;
function showToast(msg){
  const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');
  clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),1600);
}
document.getElementById('toggleReflection').addEventListener('click',e=>{
  reflectionOn=!reflectionOn;e.currentTarget.classList.toggle('active',reflectionOn);
  if(reflectionClone)reflectionClone.visible=reflectionOn;
});
/* every edit already autosaves (saveToStore runs off redrawNameNumber and
   pushHistory, which every edit path funnels through) — this button exists
   for the explicit "I'm done" moment: force one last save, confirm it, then
   hand off back to the site menu. */
/* Isolation is a VIEW setting, not part of the design — it lives in the topbar
   next to fullscreen rather than in any one part's panel, and is remembered
   across sessions so the editor opens the way you left it. */
(function(){
  const b=document.getElementById('isoBtn');
  if(!b)return;
  try{isolationOn=localStorage.getItem('ihc.isolate')!=='0';}catch(e){}
  const sync=()=>{
    b.classList.toggle('action',isolationOn);
    b.textContent=isolationOn?'🔦 Focus part: ON':'🔦 Focus part: OFF';
  };
  sync();
  b.addEventListener('click',()=>{
    isolationOn=!isolationOn;
    try{localStorage.setItem('ihc.isolate',isolationOn?'1':'0');}catch(e){}
    sync();
    applyPartIsolation();
    showToast(isolationOn?'Focus on — the rest of the skate/helmet stays visible, the rest of the kit ghosts out (all still clickable)':'Showing the whole player at full opacity');
  });
})();

/* Solo mode toggle. Everything it hides still exists and still round-trips —
   this only decides whether the team-rules layer is in your way. */
(function(){
  const b=document.getElementById('soloBtn');
  if(!b)return;
  const sync=()=>{
    b.classList.toggle('action',soloMode);
    b.textContent=soloMode?'🎨 Solo mode: ON':'🎨 Solo mode: OFF';
    const rt=document.getElementById('roleToggle');
    if(rt)rt.style.display=soloMode?'none':'';
  };
  sync();
  b.addEventListener('click',()=>{
    soloMode=!soloMode;
    try{localStorage.setItem('ihc.solo',soloMode?'1':'0');}catch(e){}
    sync();
    /* Solo acts as the admin. Coming out of solo has to land on a real role,
       and switchContext is the one path that reloads the right layer stacks
       for it — the design you were editing IS the team design, so 'admin'
       keeps editing the same data rather than silently swapping stacks. */
    if(!activitiesAvailable().some(a=>a.id===currentActivity))currentActivity='design';
    switchContext(ctxTeamId,ctxJerseyId,'admin');
    buildEditorModeTabs();
    showToast(soloMode
      ?'🎨 Solo mode — nothing is locked, no roles, no approvals'
      :'🛡️ Team rules on — roles, number approvals and league policies are back');
  });
})();

document.getElementById('saveExitBtn').addEventListener('click',()=>{
  saveToStore();
  showToast('Saved — returning to menu…');
  setTimeout(()=>{ location.href='index.html'; },550);
});

/* ============================== CONTEXT BAR ============================== */
/* Top-bar controls: which of MY teams' uniform am I in, which jersey set,
   acting as player or team admin, and the ★ favourite look (= the default
   character on the main menu and in-game). */
function updateContextBar(){
  const t=ctxTeam(),j=ctxJersey();
  const teamSel=document.getElementById('ctxTeamSel');
  teamSel.innerHTML=ihtMemberTeams(TSTORE).map(x=>
    `<option value="${x.id}"${x.id===ctxTeamId?' selected':''}>${x.id===TSTORE.favourite.teamId?'★ ':''}${x.name}</option>`).join('');
  const jerseySel=document.getElementById('ctxJerseySel');
  jerseySel.innerHTML=t.jerseys.map(x=>
    `<option value="${x.id}"${x.id===ctxJerseyId?' selected':''}>${(t.id===TSTORE.favourite.teamId&&x.id===TSTORE.favourite.jerseyId)?'★ ':''}${x.label}</option>`).join('');
  const isFav=TSTORE.favourite.teamId===ctxTeamId&&TSTORE.favourite.jerseyId===ctxJerseyId;
  const favBtn=document.getElementById('favBtn');
  favBtn.textContent=isFav?'★ Favourite look':'☆ Make favourite';
  favBtn.classList.toggle('action',isFav);
  document.querySelectorAll('.tb-role').forEach(el=>
    el.classList.toggle('active',el.dataset.role===actingRole));
  const rt=document.getElementById('roleToggle');
  if(rt)rt.style.display=soloMode?'none':'';
  const nb=t.number||{};
  document.getElementById('tbName').textContent=(PKIT.name||'—')+(nb.assigned?' #'+nb.assigned:'');
  document.getElementById('tbTeam').textContent=t.name;
}
function wireContextBar(){
  document.getElementById('ctxTeamSel').addEventListener('change',e=>{
    const t=ihtTeam(TSTORE,e.target.value);
    // keep the same jersey slot (home/away/third) across teams when it exists
    switchContext(t.id,ihtJersey(t,ctxJerseyId).id);
    showToast('Now in the '+t.name+' locker room');
  });
  document.getElementById('ctxJerseySel').addEventListener('change',e=>{
    switchContext(ctxTeamId,e.target.value);
  });
  document.getElementById('favBtn').addEventListener('click',()=>{
    TSTORE.favourite={teamId:ctxTeamId,jerseyId:ctxJerseyId};
    ihtSaveStore(TSTORE);
    ihtWriteGameLoadout(TSTORE,PKIT);
    updateContextBar();
    showToast('★ Favourite look set — this is now your default character');
  });
  document.querySelectorAll('.tb-role').forEach(el=>{
    el.addEventListener('click',()=>{
      if(el.dataset.role===actingRole)return;
      switchContext(ctxTeamId,ctxJerseyId,el.dataset.role);
      showToast(actingRole==='admin'
        ?'🛡️ Acting as TEAM ADMIN — uniform design, numbers and policies'
        :'🧑 Acting as PLAYER — your gear, within team rules');
    });
  });
}

/* ============================== BOOT ============================== */
handleResize();
buildEditorModeTabs();buildSidebar();buildToolRail();
loadCharacter(()=>{
  buildMaterialManagers();
  // first-run: remember the asset's true stick colors so contexts the player
  // never customized fall back to the real default look, not a guess
  if(!PKIT.defaultStick){
    PKIT.defaultStick=stickZM.zones.map(z=>'#'+z.color.getHexString());
    ihtSaveKit(PKIT);
  }
  loadLogoLibrary();
  wireContextBar();
  loadContext(); // pulls favourite context into the editor + first history entry
  goToPreset('full');
  document.getElementById('loadingOverlay').style.opacity='0';
  setTimeout(()=>document.getElementById('loadingOverlay').style.display='none',520);
  const clock=new THREE.Clock();
  function tick(){
    requestAnimationFrame(tick);
    const dt=Math.min(clock.getDelta(),0.05);
    paintProxyFrame++;   // invalidates the skinned raycast proxies once per frame
    updateCamera(dt);
    animateIdle(dt);
    /* A material's shaderRef only exists once it has COMPILED, and a material
       only compiles when its mesh is first RENDERED — so with part isolation
       on, a piece that has never been shown has no uniform to write yet.
       Re-asserting every frame is a few property writes and means a piece is
       correct on the first frame it appears. */
    applySplitGhostUniform();
    renderer.render(scene,camera);
  }
  tick();
});
