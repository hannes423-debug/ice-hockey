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
let autoRotate=true,dragMode=null,lastPX=0,lastPY=0,currentPresetName='full';

function goToPreset(name){
  const p=CAM_PRESETS[name]||CAM_PRESETS.full;
  camGoal.yaw=p.yaw;camGoal.pitch=p.pitch;camGoal.dist=p.dist;
  camGoal.target.set(p.target[0],p.target[1],p.target[2]);
  currentPresetName=name;
  document.querySelectorAll('#camPresets .cam-btn').forEach(b=>b.classList.toggle('active',b.dataset.cam===name));
}
function updateCamera(dt){
  const k=1-Math.pow(0.0015,Math.min(dt,0.1));
  camState.yaw+=(camGoal.yaw-camState.yaw)*k;
  camState.pitch+=(camGoal.pitch-camState.pitch)*k;
  camState.dist+=(camGoal.dist-camState.dist)*k;
  camState.target.lerp(camGoal.target,k);
  if(autoRotate&&!dragMode)camGoal.yaw+=dt*0.16;
  const p=Math.max(-0.2,Math.min(0.58,camState.pitch));
  const x=camState.target.x+Math.sin(camState.yaw)*Math.cos(p)*camState.dist;
  const y=camState.target.y+Math.sin(p)*camState.dist;
  const z=camState.target.z+Math.cos(camState.yaw)*Math.cos(p)*camState.dist;
  camera.position.set(x,y,z);
  camera.lookAt(camState.target);
}
/* dragMode tracks which single interaction is active for THIS drag, decided
   once on pointerdown, so pointermove never has to guess. Middle mouse is
   reserved for camera control ALWAYS — it forces dragMode='orbit' even
   while Paint Mode / decal Move Mode is on, before either of them gets a
   chance to claim the drag. (Previously the paint/decal checks ran first
   and unconditionally captured every pointerdown regardless of button, so
   a middle-click while Paint Mode was on painted instead of orbiting — and
   because pointermove checked `paintModeOn`/`decalMoveModeOn` rather than
   "is THIS drag actually a paint/decal drag", a middle-drag would silently
   do nothing at all once those modes were on, since it fell into the
   paint/decal branch without ever setting their per-drag flag.) */
renderer.domElement.addEventListener('pointerdown',e=>{
  renderer.domElement.setPointerCapture(e.pointerId);
  if(e.button===1){
    dragMode='orbit';lastPX=e.clientX;lastPY=e.clientY;
    e.preventDefault();
    return;
  }
  if(paintModeOn){
    dragMode='paint';
    // one drag = one layer: points accumulate on currentStroke (drawn live,
    // fast, exactly like before) and only land in the persisted paintStrokes
    // list on pointerup — see redrawPaintLayer() for why storing POINTS
    // instead of raw pixels is what makes strokes individually deletable/
    // reorderable/hideable and finally savable into presets+undo.
    currentStroke={id:'PS'+Date.now(),target:paintTarget,color:paintBrushColor,size:paintBrushSize,opacity:paintBrushOpacity,visible:true,points:[]};
    const uv=raycastUV(e.clientX,e.clientY);
    if(uv){currentStroke.points.push({x:uv.x,y:uv.y,side:uv.side});paintStamp(uv,null);lastPaintUV=uv;}
    return;
  }
  if(decalMoveModeOn&&selectedDecalIdx>=0){
    dragMode='decal';
    const uv=raycastUV(e.clientX,e.clientY);
    if(uv)moveSelectedDecal(uv);
    return;
  }
  dragMode='orbit';lastPX=e.clientX;lastPY=e.clientY;
});
renderer.domElement.addEventListener('pointermove',e=>{
  if(dragMode==='paint'){
    const uv=raycastUV(e.clientX,e.clientY);
    if(uv){if(currentStroke)currentStroke.points.push({x:uv.x,y:uv.y,side:uv.side});paintStamp(uv,lastPaintUV);lastPaintUV=uv;}
  }else if(dragMode==='decal'){
    const uv=raycastUV(e.clientX,e.clientY);
    if(uv)moveSelectedDecal(uv);
  }else if(dragMode==='orbit'){
    const dx=e.clientX-lastPX,dy=e.clientY-lastPY;lastPX=e.clientX;lastPY=e.clientY;
    camGoal.yaw-=dx*0.0068;camGoal.pitch+=dy*0.005;
    camState.yaw=camGoal.yaw;camState.pitch=camGoal.pitch; // direct while dragging, no lag
  }
});
addEventListener('pointerup',()=>{
  if(dragMode==='paint'&&currentStroke&&currentStroke.points.length){
    paintStrokes.push(currentStroke);
    renderPaintLayersList();
    pushHistory();
  }
  currentStroke=null;dragMode=null;lastPaintUV=null;
});
renderer.domElement.addEventListener('wheel',e=>{
  e.preventDefault();
  if(paintModeOn||decalMoveModeOn){
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
    setupIdleSway(v);
    buildReflectionClone(v);
    done();
  },undefined,e=>{console.error('player load failed',e);done();});
  gltfLoader.parse(b64ToBuf(STICK_B64),'',gltf=>{
    stickGroup=gltf.scene;scene.add(stickGroup);placeStickRest();done();
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
let logoCanvas,logoCtx,logoTexture;
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
function makeDecalDataTexture(){
  const tex=new THREE.DataTexture(new Uint8Array(DECAL_SIZE*DECAL_SIZE*4),DECAL_SIZE,DECAL_SIZE,THREE.RGBAFormat);
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
  nameNumberTexture=makeDecalDataTexture();

  logoCanvas=document.createElement('canvas');
  logoCanvas.width=logoCanvas.height=DECAL_SIZE;
  logoCtx=logoCanvas.getContext('2d');
  logoTexture=makeDecalDataTexture();

  paintCanvas=document.createElement('canvas');
  paintCanvas.width=paintCanvas.height=DECAL_SIZE;
  paintCtx=paintCanvas.getContext('2d');
  paintTexture=makeDecalDataTexture();
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
   TEAM-owned state (jersey colors, lettering font, team paint/decal layers,
   mirror convention) round-trips with the team store; PLAYER-owned state
   (name, skin, stick, personal accent layers) round-trips with the player
   kit. The game keeps reading the same flat ihGameLoadout_v1 snapshot it
   always has — ihtWriteGameLoadout() (core) recomputes it from the FAVOURITE
   context on every save, so editing a non-favourite team never changes what
   you wear in-game until you star it. */
let TSTORE=ihtLoad(),PKIT=ihtLoadKit();
let ctxTeamId=TSTORE.favourite.teamId,ctxJerseyId=TSTORE.favourite.jerseyId;
let actingRole='player';
/* the OTHER party's layers for the current role: replayed underneath (team
   design) or on top (player accents) but never selectable/editable */
let basePaintStrokes=[],baseDecals=[];
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
   number, font via refreshSwatches) or pushHistory (paint, decals, mirror),
   and both call this — one save covers every edit site. Written back by
   ASSIGNMENT (not shared array references) because applyState/undo replaces
   the live arrays wholesale. */
function saveToStore(){
  if(suppressStore||!bodyZM||!stickZM||!neckZone)return;
  const j=ctxJersey(),kctx=ctxKit();
  if(actingRole==='admin'){
    j.design.body=bodyZM.zones.map(z=>'#'+z.color.getHexString());
    j.design.font=jerseyFont;
    j.design.paintStrokes=paintStrokes;
    j.design.decals=placedDecals;
    j.design.paintMirrorOn=paintMirrorOn;
  }else{
    PKIT.name=jerseyName;
    PKIT.skin='#'+neckZone.color.getHexString();
    kctx.stick=stickZM.zones.map(z=>'#'+z.color.getHexString());
    kctx.accStrokes=paintStrokes;
    kctx.accDecals=placedDecals;
  }
  ihtSaveStore(TSTORE);ihtSaveKit(PKIT);
  ihtWriteGameLoadout(TSTORE,PKIT);
}
/* Pull one context's stored state into the live editor (zones, plate, layer
   stacks), pointing the editable stacks at whichever party the role owns. */
function loadContext(){
  const t=ctxTeam(),j=ctxJersey(),kctx=ctxKit();
  suppressStore=true;
  j.design.body.forEach((h,i)=>bodyZM.setZoneColor(i,h));
  const stick=kctx.stick||PKIT.defaultStick||IHT_DEFAULT_STICK;
  stick.forEach((h,i)=>stickZM.setZoneColor(i,h));
  neckZone.setColor(PKIT.skin||'#c68863');
  jerseyName=PKIT.name||'';
  jerseyFont=j.design.font||'Arial';
  jerseyNumber=ihtEffectiveNumber(t);
  paintMirrorOn=j.design.paintMirrorOn!==false;
  applyPaintMirrorUniform();
  if(actingRole==='admin'){
    paintStrokes=j.design.paintStrokes||[];
    placedDecals=j.design.decals||[];
    basePaintStrokes=kctx.accStrokes||[];
    baseDecals=kctx.accDecals||[];
  }else{
    paintStrokes=kctx.accStrokes||(kctx.accStrokes=[]);
    placedDecals=kctx.accDecals||(kctx.accDecals=[]);
    basePaintStrokes=j.design.paintStrokes||[];
    baseDecals=j.design.decals||[];
  }
  selectedStrokeIdx=-1;selectedDecalIdx=-1;paintModeOn=false;decalMoveModeOn=false;
  redrawPaintLayer();redrawLogoLayer();
  suppressStore=false;
  refreshSwatches(); // also redraws the plate + saves the store once
  history.length=0;historyIdx=-1;pushHistory();
  updateContextBar();
  buildEditorModeTabs();buildSidebar();
  selectCategory(categoriesForMode(currentEditorMode)[0].id);
}
function switchContext(teamId,jerseyId,role){
  ctxTeamId=teamId;ctxJerseyId=jerseyId;
  if(role)actingRole=role;
  const modes=editorModesForRole();
  if(!modes.some(m=>m.id===currentEditorMode))currentEditorMode=modes[0].id;
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

/* ----- freehand paint (raycast screen -> UV -> canvas brush stamp) ----- */
let paintModeOn=false,lastPaintUV=null;
/* paintStrokes: one entry per completed drag ("layer"), each storing its own
   UV point path + the brush settings it was drawn with — NOT raw pixels.
   That's what makes strokes individually deletable/reorderable/hideable
   (redrawPaintLayer replays only the visible ones, in order) and, as a
   bonus, small enough to round-trip through JSON — so paint finally saves
   into presets and undo/redo instead of living only in the live canvas. */
let paintStrokes=[],currentStroke=null,selectedStrokeIdx=-1;
let paintBrushColor='#ffffff',paintBrushSize=44,paintBrushOpacity=1;
/* Global, not per-stroke: the shader's uMirrorPaint uniform is a single
   value, so ALL strokes on the canvas have to agree on the same packing
   convention (see paintCanvasXY) at any given moment — a per-stroke flag
   would mean two strokes disagreeing about what a given canvas half means,
   which the shader has no way to resolve per-pixel. Flipping this toggle
   re-packs every existing stroke under the new convention (see its wiring
   in wireDecalsPanel), which is the one honest trade-off of keeping this
   simple: old strokes don't remember their own original mirror setting. */
let paintMirrorOn=true;
function applyPaintMirrorUniform(){
  const ref=bodyZM&&bodyZM.material&&bodyZM.material.userData.shaderRef;
  if(ref&&ref.uniforms.uMirrorPaint)ref.uniforms.uMirrorPaint.value=paintMirrorOn?1:0;
}
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
  if(actingRole==='admin')return PAINT_TARGET_LIST;
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
function raycastUV(clientX,clientY){
  const meshes=getPaintTargetMeshes();
  if(!meshes.length)return null;
  const r=renderer.domElement.getBoundingClientRect();
  pointerNDC.x=((clientX-r.left)/r.width)*2-1;
  pointerNDC.y=-((clientY-r.top)/r.height)*2+1;
  raycaster.setFromCamera(pointerNDC,camera);
  const hits=raycaster.intersectObjects(meshes,false);
  if(!hits.length||!hits[0].uv)return null;
  const uv=hits[0].uv;
  // JS-side counterpart to the shader's vIhSide: which real-world side of
  // the body this hit landed on, used by the independent-sides paint
  // feature below. Local space (not world) so it agrees with the shader's
  // own local-space `position.x` regardless of camera orbit.
  uv.side=hits[0].object.worldToLocal(hits[0].point.clone()).x>=0?1:-1;
  return uv;
}
/* stampSegment/ihcPaintCanvasXY/SEAM_JUMP_UV + stroke/decal replay moved to
   core (the menu preview replays the exact same stored layers). */
function paintStamp(uv,prevUV){
  const xy=ihcPaintCanvasXY(uv,uv.side,paintMirrorOn);
  const prevXY=prevUV?ihcPaintCanvasXY(prevUV,prevUV.side,paintMirrorOn):null;
  // a side change mid-drag (e.g. dragging across the crotch from one leg to
  // the other) is ALWAYS a seam crossing when unmirrored, even if the raw
  // UV looks continuous — the two sides land on opposite canvas halves.
  const seamJump=(prevUV&&Math.hypot(uv.x-prevUV.x,uv.y-prevUV.y)>SEAM_JUMP_UV)||
    (!paintMirrorOn&&prevUV&&prevUV.side!==uv.side);
  stampSegment(paintCtx,xy.x,xy.y,prevXY?prevXY.x:null,prevXY?prevXY.y:null,
    paintBrushSize,paintBrushColor,paintBrushOpacity,seamJump);
  syncCanvasToDataTexture(paintCtx,paintCanvas,paintTexture);
}
/* Full reconstruction from the stored stroke lists — needed any time a STACK
   changes shape (delete/reorder/hide/undo), as opposed to live dragging which
   just stamps incrementally onto the existing canvas. Draw order is fixed by
   OWNERSHIP, not by who's editing: team design strokes first, the player's
   personal accents on top of them — so both roles see the same jersey. */
function paintStackOrder(active,base){
  return actingRole==='admin'?[active,base]:[base,active];
}
function redrawPaintLayer(){
  if(!paintCtx)return;
  paintCtx.clearRect(0,0,DECAL_SIZE,DECAL_SIZE);
  paintStackOrder(paintStrokes,basePaintStrokes)
    .forEach(list=>ihcReplayStrokes(paintCtx,list,paintMirrorOn));
  syncCanvasToDataTexture(paintCtx,paintCanvas,paintTexture);
}

let bodyZM=null,stickZM=null,neckZone=null;
function buildMaterialManagers(){
  const bodyMat=player.visual.getObjectByName('Cube001').material; // jersey mesh; shared by pants/gloves/helmet/cage/skates/blades too
  setupDecalCanvases();
  bodyZM=setupZoneMaterial(bodyMat,3,['Primary','Secondary','Trim'],{nameNumberMap:nameNumberTexture,logoMap:logoTexture,paintMap:paintTexture});

  /* "Neck" (mesh "Cube") is the only exposed-skin-adjacent geometry this
     model has — there is NO separate face/skin texture anywhere: the color
     histogram of the whole atlas has zero skin-tone clusters, and an
     untextured clay render of the head shows an empty/dark cavity behind
     the cage bars, not a face. The helmet+cage cover the whole head, so
     "head skin color" genuinely has nothing to attach to on this asset —
     Neck is the closest honest, real, independently-colorable stand-in. */
  const meshNeck=player.visual.getObjectByName('Cube');
  meshNeck.material=meshNeck.material.clone();
  neckZone=setupZoneMaterial(meshNeck.material,1,['Skin']).zones[0];
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
  // labels are ['Blade','Shaft'], not frequency order ['Shaft','Blade'] — the
  // more-frequent cluster in this texture is the lighter blade-paint color,
  // confirmed by an offline render (the "51% cluster" is white, not black).
  const shaftBladeMgr=setupZoneMaterial(meshMain.material,2,['Blade','Shaft']);
  const gripTapeZone=setupTintZone(meshGripTape.material,'Grip Tape');
  const bladeTapeZone=setupTintZone(meshBladeTape.material,'Blade Tape');
  const zones=[shaftBladeMgr.zones[1],shaftBladeMgr.zones[0],gripTapeZone,bladeTapeZone];
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
const EDITOR_MODES=[
  {id:'team',  label:'Team Uniform',icon:'🎽'},
  {id:'player',label:'Player',      icon:'🧑'},
  {id:'admin', label:'Team Admin',  icon:'🛡️'},
];
/* Acting as PLAYER you see the uniform (mostly view-only, per policy) and
   your personal tab; acting as TEAM ADMIN you edit the uniform and run the
   team (numbers, policies) — but you never touch the player's personal gear. */
function editorModesForRole(){
  return actingRole==='admin'
    ?EDITOR_MODES.filter(m=>m.id!=='player')
    :EDITOR_MODES.filter(m=>m.id!=='admin');
}
let currentEditorMode='team';
const CATEGORIES=[
  {id:'jersey',label:'Jersey', icon:'🏒',cam:'upper', group:'body',mode:'team',
   note:'This low-poly rig shares one uniform texture across jersey, pants, gloves and helmet — Primary / Secondary / Trim recolor the whole kit at once. Independent per-piece textures are the next asset pass.'},
  {id:'decals',label:'Decals & Paint', icon:'🎨',cam:'upper',group:'decals',mode:'team'},
  {id:'helmet',label:'Helmet', icon:'⛑️',cam:'helmet',group:'body',mode:'team'},
  {id:'gloves',label:'Gloves', icon:'🧤',cam:'gloves',group:'body',mode:'team'},
  {id:'pants', label:'Pants',  icon:'🩳',cam:'pants', group:'body',mode:'team'},
  {id:'socks', label:'Socks',  icon:'🧦',cam:'skates',group:'body',mode:'team'},
  {id:'skates',label:'Skates', icon:'⛸️',cam:'skates',group:'fixed',mode:'team',
   note:'Boots, laces and blades are baked as a fixed dark finish in this pass — not yet on a colorable zone.'},
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
  {id:'roster',  label:'Numbers & Roster', icon:'🔢',cam:'upper',group:'roster',  mode:'admin'},
  {id:'policies',label:'Player Freedom',   icon:'⚖️',cam:'full', group:'policies',mode:'admin'},
];
const SKIN_TONES=['#3d2314','#5c3a21','#8d5a34','#c68863','#e0ac69','#f1c27d','#ffdbac','#f5dbc5'];
const QUICK_PALETTES=[
  {name:'Original',  colors:['#020c3d','#4c0a16','#ffffff']},
  {name:'Away',      colors:['#f2f2f2','#0c2340','#a6192e']},
  {name:'Blackout',  colors:['#0a0a0c','#1c1c22','#3a3a44']},
  {name:'Ice Blue',  colors:['#0d3b66','#3fa9e6','#ffffff']},
  {name:'Alternate', colors:['#4b3a52','#3f7a6e','#f0f0f0']},
  {name:'Sunrise',   colors:['#7a1224','#ff9a3c','#111319']},
];
let currentCategory=CATEGORIES.find(c=>c.mode==='team');

function categoriesForMode(mode){return CATEGORIES.filter(c=>c.mode===mode);}
function buildEditorModeTabs(){
  const wrap=document.getElementById('editorModeTabs');
  wrap.innerHTML='';
  editorModesForRole().forEach(m=>{
    const el=document.createElement('div');
    el.className='editor-mode-tab'+(m.id===currentEditorMode?' active':'');
    el.dataset.mode=m.id;
    el.innerHTML=`<span class="em-icon">${m.icon}</span>${m.label}`;
    el.addEventListener('click',()=>selectEditorMode(m.id));
    wrap.appendChild(el);
  });
}
function selectEditorMode(mode){
  if(mode===currentEditorMode)return;
  currentEditorMode=mode;
  document.querySelectorAll('.editor-mode-tab').forEach(el=>el.classList.toggle('active',el.dataset.mode===mode));
  document.getElementById('sbHeading').textContent=
    mode==='team'?'Team Uniform':mode==='admin'?'Team Admin':'Player';
  buildSidebar();
  selectCategory(categoriesForMode(mode)[0].id);
}
/* Is this category actually editable in the current role/policy context? */
function categoryEditable(cat){
  if(actingRole==='admin')return cat.mode==='team'||cat.mode==='admin';
  if(cat.mode==='player'){
    if(cat.id==='stick')return catAllowed('stick');
    return true; // skin + nameplate are always the player's own
  }
  if(cat.id==='decals')return availablePaintTargets().length>0;
  return false; // uniform design is team-controlled
}
function buildSidebar(){
  const list=document.getElementById('sbList');
  list.innerHTML='';
  categoriesForMode(currentEditorMode).forEach(cat=>{
    const el=document.createElement('div');
    el.className='sb-item'+(cat.id===currentCategory.id?' active':'');
    el.dataset.cat=cat.id;
    const chip=categoryEditable(cat)?'':'<div class="sb-chip">🔒</div>';
    el.innerHTML=`<div class="sb-icon">${cat.icon}</div><div class="sb-label">${cat.label}</div>${chip}`;
    el.addEventListener('click',()=>selectCategory(cat.id));
    list.appendChild(el);
  });
}
function buildCamPresetButtons(){
  const wrap=document.getElementById('camPresets');
  wrap.innerHTML='';
  [['full','Full Body'],['upper','Upper Body'],['helmet','Helmet'],['gloves','Gloves'],
   ['pants','Legs'],['skates','Skates'],['stick','Stick'],['free','Free Cam']].forEach(([id,label])=>{
    const b=document.createElement('div');
    b.className='cam-btn';b.dataset.cam=id;b.textContent=label;
    b.addEventListener('click',()=>goToPreset(id));
    wrap.appendChild(b);
  });
}
function selectCategory(id){
  currentCategory=CATEGORIES.find(c=>c.id===id)||CATEGORIES[0];
  document.querySelectorAll('.sb-item').forEach(el=>el.classList.toggle('active',el.dataset.cat===id));
  goToPreset(currentCategory.cam);
  renderRightPanel();
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

function renderRightPanel(){
  const rp=document.getElementById('rightpanel');
  const cat=currentCategory;
  let html=`<h2 class="rp-title">${cat.icon} ${cat.label}</h2>`;
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
  if(cat.group==='decals'){
    const targets=availablePaintTargets();
    if(!targets.length){
      // player role, everything locked out by league/team policy
      const src=catLockLabel('accents')||catLockLabel('helmetStyle')||catLockLabel('skates')||ctxTeam().name;
      html+=`<p class="rp-sub">Personal accents</p>
        <div class="rp-note">🔒 ${src} does not allow personal paint or decals on this uniform. The team's own design layers still show on the model — they're just not yours to edit. Switch to Team Admin (top bar) to change the policy.</div>`;
      rp.innerHTML=html;return;
    }
    if(!targets.some(t=>t.id===paintTarget))paintTarget=targets[0].id;
    if(actingRole==='admin'){
      html+=`<p class="rp-sub">TEAM design layers — every player on the roster wears these. The player's own accents (if policy allows any) draw on top and aren't editable from here.</p>`;
    }else{
      html+=`<p class="rp-sub">YOUR personal accent layers — they draw on top of the team's design, which stays locked underneath. Allowed surfaces are set by team/league policy.</p>`;
    }
    html+=`<div class="rp-section"><div class="rp-section-title">Paint Target</div>
      <div class="preset-strip" id="paintTargetStrip" style="flex-wrap:wrap;">${targets.map(t=>
        `<div class="cam-btn paint-target-btn" data-ptarget="${t.id}" style="flex:none;">${t.icon} ${t.label}</div>`).join('')}
      </div>
      <div style="font-size:13px;color:var(--text-faint);margin-top:6px;">Paint only affects the selected piece — pick one before you drag.${actingRole!=='admin'?' The jersey itself is team-controlled and never paintable by players.':''}</div>
    </div>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Freehand Paint</div>
      <div class="zone-row" id="paintColorRow"><div class="zone-swatch" id="paintColorSwatch" style="background:${paintBrushColor}"></div>
        <div class="zone-info"><div class="zone-name">Brush Color</div></div></div>
      <div class="mat-slider-row"><div class="mat-slider-label"><span>Brush Size</span><b id="brushSizeVal"></b></div>
        <input type="range" id="brushSizeSlider" min="6" max="140" step="2"></div>
      <div class="mat-slider-row"><div class="mat-slider-label"><span>Opacity</span><b id="brushOpVal"></b></div>
        <input type="range" id="brushOpSlider" min="0.05" max="1" step="0.05"></div>
      ${actingRole==='admin'?`<div class="btn-row" style="margin-bottom:8px;"><div class="btn" id="mirrorPaintBtn">🪞 Mirror Paint & Decals: ON</div></div>`:''}
      <div class="btn-row" style="margin-bottom:8px;"><div class="btn" id="paintModeBtn">🖌 Enable Paint Mode</div></div>
      <div class="btn-row"><div class="btn" id="undoStrokeBtn">↶ Undo Last Stroke</div><div class="btn" id="clearPaintBtn">🗑 Clear All Paint</div></div>
      <div class="rp-note" style="margin-top:10px;" id="paintNote">While Paint Mode is on, dragging on the model paints instead of rotating the camera — scroll still rotates the view. Each drag is its own layer below (reorder/hide/delete individually), and paint now saves into presets and undo. Mirror Paint & Decals mirrors both freehand strokes AND placed logos across symmetric parts (pants, gloves) — turn it off to decorate each side independently; flipping it re-splits every existing stroke/decal, so it's simplest to decide before you start a side. With Mirror off, a logo placed right at dead-center (near a belt/waistband seam) can land in an odd spot — drag it onto the leg/arm proper with "Move on Model" and it'll behave.</div>
    </div>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Quick Shape Decals</div>
      <div class="lc-shape-grid" id="quickShapeGrid">
        <div class="lc-shape-btn" data-qshape="circle" title="Circle">●</div>
        <div class="lc-shape-btn" data-qshape="square" title="Square">■</div>
        <div class="lc-shape-btn" data-qshape="triangle" title="Triangle">▲</div>
        <div class="lc-shape-btn" data-qshape="star" title="Star">★</div>
        <div class="lc-shape-btn" data-qshape="hexagon" title="Hexagon">⬡</div>
        <div class="lc-shape-btn" data-qshape="shield" title="Shield">🛡</div>
      </div>
      <div style="font-size:13px;color:var(--text-faint);margin-top:6px;">Stamps a Forza-style decal straight onto the selected paint target — drag/scale/rotate it below, just like a placed logo. Use the Logo Creator for multi-layer text+shape combos.</div>
    </div>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Logos<span class="btn ghost" id="openLogoCreatorBtn" style="flex:none;padding:5px 10px;font-size:12.5px;">+ Create Logo</span></div>
      <div class="palette-grid" id="logoLibraryGrid"></div>
      <div class="btn-row" style="margin-top:10px;"><label class="btn" style="flex:1;text-align:center;cursor:pointer;">📁 Import Image<input type="file" id="importLogoFile" accept="image/*" style="display:none;"></label></div>
    </div>`;
    html+=`<div class="rp-section"><div class="rp-section-title">Layers<span class="sb-chip" style="font-weight:600;" id="layersTotalBadge">${(paintStrokes.length+placedDecals.length)} total</span></div>
      <div style="font-size:13px;color:var(--text-faint);margin-bottom:8px;">Decals (logos/shapes) and paint strokes are separate stacks — within each, later = drawn on top; paint always renders above decals overall. Reorder/hide/delete either independently.</div>
      <div class="rp-section-title" style="margin-top:2px;">🖼 Decals</div>
      <div id="placedDecalsList"></div>
      <div id="placedDecalControls"></div>
      <div class="rp-section-title" style="margin-top:14px;">🖌 Paint Strokes</div>
      <div id="paintLayersList"></div>
      <div id="paintLayerControls"></div>
    </div>`;
    rp.innerHTML=html;
    wireDecalsPanel();
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
  const mgrKey=cat.group==='stick'?'stick':'body';
  const mgr=cat.group==='stick'?stickZM:bodyZM;
  const editable=categoryEditable(cat);
  const lockSrc=cat.id==='stick'?catLockLabel('stick'):null;
  html+=`<p class="rp-sub">${cat.group==='stick'?'Independent material — shaft &amp; blade tape.':'Realtime color &amp; material — changes apply instantly, no Apply button.'}</p>`;
  if(!editable){
    html+=`<div class="rp-note">${cat.group==='stick'
      ?`🔒 ${lockSrc||ctxTeam().name} does not allow personal stick customization — these are the colors you'll play with. Switch to Team Admin to change the policy.`
      :`🔒 Uniform design is decided by the ${ctxTeam().name} admin — you're viewing it, not editing it. Switch to Team Admin (top bar) to redesign it, or pick another jersey set / team above.`}</div>`;
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

  if(editable&&mgrKey==='body'){
    html+=`<div class="rp-section"><div class="rp-section-title">Team Colors</div>${paletteHTML()}</div>`;
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
      <div class="btn" id="btnRandom">🎲 Randomize</div>${actingRole==='admin'?'<div class="btn primary" id="btnSavePreset">💾 Save Preset</div>':''}
    </div></div>`;
  }

  if(actingRole==='admin'){
    html+=`<div class="rp-section"><div class="btn-row">
      <div class="btn" id="btnExportCode">📤 Export Code</div><div class="btn" id="btnImportCode">📥 Import Code</div>
    </div>
    <div class="rp-note" style="margin-top:10px;">Exports/imports the WHOLE loadout (colors, name/number/font, paint, decals) as a text code — for sharing or backing up outside this browser, separate from the presets below which only live here.</div></div>`;

    html+=`<div class="rp-section"><div class="rp-section-title">Loadout Presets</div>${presetStripHTML()}</div>`;
  }

  rp.innerHTML=html;
  wireRightPanel(mgrKey,mgr,editable);
}

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
      p.colors.forEach((c,i)=>bodyZM.setZoneColor(i,c));
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
function refreshSwatches(){
  ['body','stick'].forEach(mgrKey=>{
    const mgr=mgrKey==='body'?bodyZM:stickZM;
    mgr.zones.forEach((z,i)=>{
      const sw=document.getElementById('swatch-'+mgrKey+'-'+i);
      const hx=document.getElementById('hex-'+mgrKey+'-'+i);
      if(sw)sw.style.background='#'+z.color.getHexString();
      if(hx)hx.textContent='#'+z.color.getHexString().toUpperCase();
    });
  });
  if(neckZone){
    const sw=document.getElementById('swatch-neck-0'),hx=document.getElementById('hex-neck-0');
    if(sw)sw.style.background='#'+neckZone.color.getHexString();
    if(hx)hx.textContent='#'+neckZone.color.getHexString().toUpperCase();
  }
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
function wireDecalsPanel(){
  document.querySelectorAll('.paint-target-btn').forEach(el=>{
    el.classList.toggle('active',el.dataset.ptarget===paintTarget);
    el.addEventListener('click',()=>{
      paintTarget=el.dataset.ptarget;
      document.querySelectorAll('.paint-target-btn').forEach(b=>b.classList.toggle('active',b.dataset.ptarget===paintTarget));
      const t=PAINT_TARGET_LIST.find(x=>x.id===paintTarget);
      if(t)goToPreset(t.cam);
    });
  });

  document.getElementById('paintColorRow').addEventListener('click',e=>{
    openColorPicker(document.getElementById('paintColorSwatch'),'paint',null);
  });
  const sizeSlider=document.getElementById('brushSizeSlider');
  sizeSlider.value=paintBrushSize;
  document.getElementById('brushSizeVal').textContent=paintBrushSize;
  sizeSlider.addEventListener('input',()=>{paintBrushSize=+sizeSlider.value;document.getElementById('brushSizeVal').textContent=paintBrushSize;});

  const opSlider=document.getElementById('brushOpSlider');
  opSlider.value=paintBrushOpacity;
  document.getElementById('brushOpVal').textContent=Math.round(paintBrushOpacity*100)+'%';
  opSlider.addEventListener('input',()=>{paintBrushOpacity=+opSlider.value;document.getElementById('brushOpVal').textContent=Math.round(paintBrushOpacity*100)+'%';});

  /* admin-only control (absent from the player-role panel): the mirror
     convention is part of the TEAM design — one shader uniform governs both
     the team layers and any player accents, so the admin decides it. */
  const mirrorBtn=document.getElementById('mirrorPaintBtn');
  if(mirrorBtn){
    const syncMirrorBtn=()=>{
      mirrorBtn.classList.toggle('primary',paintMirrorOn);
      mirrorBtn.textContent=paintMirrorOn?'🪞 Mirror Paint & Decals: ON':'🪞 Mirror Paint & Decals: OFF';
    };
    syncMirrorBtn();
    mirrorBtn.addEventListener('click',()=>{
      paintMirrorOn=!paintMirrorOn;
      syncMirrorBtn();
      applyPaintMirrorUniform();
      // re-pack every existing stroke AND decal under the new convention
      redrawPaintLayer();redrawLogoLayer();
      pushHistory();
      showToast(paintMirrorOn?'Mirror ON — both sides match':'Mirror OFF — sides decorated independently');
    });
  }

  const modeBtn=document.getElementById('paintModeBtn');
  const syncModeBtn=()=>{
    modeBtn.classList.toggle('primary',paintModeOn);
    modeBtn.textContent=paintModeOn?'🖌 Paint Mode: ON':'🖌 Enable Paint Mode';
    renderer.domElement.style.cursor=paintModeOn?'crosshair':'';
  };
  syncModeBtn();
  modeBtn.addEventListener('click',()=>{
    paintModeOn=!paintModeOn;
    if(paintModeOn)decalMoveModeOn=false;
    syncModeBtn();
  });

  document.getElementById('undoStrokeBtn').addEventListener('click',()=>{
    if(paintStrokes.length){paintStrokes.pop();selectedStrokeIdx=-1;redrawPaintLayer();renderPaintLayersList();renderPaintLayerControls();pushHistory();showToast('Stroke undone');}
    else showToast('No strokes to undo');
  });
  document.getElementById('clearPaintBtn').addEventListener('click',()=>{
    paintStrokes=[];selectedStrokeIdx=-1;redrawPaintLayer();renderPaintLayersList();renderPaintLayerControls();pushHistory();showToast('Paint cleared');
  });

  document.querySelectorAll('#quickShapeGrid .lc-shape-btn').forEach(b=>{
    b.addEventListener('click',()=>quickStampShape(b.dataset.qshape));
  });
  renderLogoLibraryGrid();
  renderPlacedDecalsList();
  renderPlacedDecalControls();
  renderPaintLayersList();
  renderPaintLayerControls();
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
    mgr.setZoneColor(i,rgbToHex(rgb.r,rgb.g,rgb.b));
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
    const sw=document.getElementById('paintColorSwatch');if(sw)sw.style.background=paintBrushColor;
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
  if(cpState.mgrKey==='paintstroke'){
    const s=paintStrokes[cpState.idx];
    if(s){s.color=currentHex();const sw=document.getElementById('strokeColorSwatch');if(sw)sw.style.background=s.color;redrawPaintLayer();renderPaintLayersList();}
    return;
  }
  const mgr=cpState.mgrKey==='body'?bodyZM:stickZM;
  mgr.setZoneColor(cpState.idx,currentHex());
  refreshSwatches();
}
function openColorPicker(anchorEl,mgrKey,idx){
  cpState.mgrKey=mgrKey;cpState.idx=idx;cpState.anchorEl=anchorEl;
  let startHex='#ffffff';
  if(mgrKey==='paint')startHex=paintBrushColor;
  else if(mgrKey==='neck')startHex='#'+neckZone.color.getHexString();
  else if(mgrKey==='lclayer')startHex=(lcLayers[lcSelectedIdx]&&lcLayers[lcSelectedIdx].color)||'#7c5cff';
  else if(mgrKey==='paintstroke')startHex=(paintStrokes[idx]&&paintStrokes[idx].color)||'#7c5cff';
  else startHex='#'+(mgrKey==='body'?bodyZM:stickZM).zones[idx].color.getHexString();
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
  if(cpEl.classList.contains('open')&&!cpEl.contains(e.target)&&!e.target.closest('.zone-row')){
    closeColorPicker();
  }
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
function lcDrawShapePath(ctx,shape,r){
  ctx.beginPath();
  if(shape==='circle'){ctx.arc(0,0,r,0,Math.PI*2);}
  else if(shape==='square'){ctx.rect(-r,-r,r*2,r*2);}
  else if(shape==='triangle'){ctx.moveTo(0,-r);ctx.lineTo(r*0.87,r*0.5);ctx.lineTo(-r*0.87,r*0.5);ctx.closePath();}
  else if(shape==='star'){
    const spikes=5,outer=r,inner=r*0.45;
    for(let i=0;i<spikes*2;i++){const ang=i*Math.PI/spikes-Math.PI/2,rad=i%2===0?outer:inner;
      const x=Math.cos(ang)*rad,y=Math.sin(ang)*rad;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
    ctx.closePath();
  }else if(shape==='hexagon'){
    for(let i=0;i<6;i++){const ang=i*Math.PI/3-Math.PI/2,x=Math.cos(ang)*r,y=Math.sin(ang)*r;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
    ctx.closePath();
  }else if(shape==='shield'){
    ctx.moveTo(-r,-r*0.7);ctx.lineTo(r,-r*0.7);ctx.lineTo(r,r*0.15);
    ctx.quadraticCurveTo(r,r*0.9,0,r);ctx.quadraticCurveTo(-r,r*0.9,-r,r*0.15);ctx.closePath();
  }
}
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
document.querySelectorAll('.lc-shape-btn').forEach(b=>{
  b.addEventListener('click',()=>lcAddLayer({type:'shape',shape:b.dataset.shape,color:'#7c5cff'}));
});
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
/* Saved logos get stamped onto the model as independently-transformable
   instances (position/scale/rotation), composited on their own texture
   layer (see logoMap in the Material Manager) — separate from freehand
   paint so a placed logo stays editable instead of being baked in. */
let logoLibrary=[],placedDecals=[],selectedDecalIdx=-1,decalMoveModeOn=false;
function loadLogoLibrary(){
  try{logoLibrary=JSON.parse(localStorage.getItem('ihc_logos_v1')||'[]');}catch(e){logoLibrary=[];}
  logoLibrary.forEach(l=>{l.img=new Image();l.img.onload=()=>redrawLogoLayer();l.img.src=l.dataURL;});
}
function saveLogoLibrary(){
  localStorage.setItem('ihc_logos_v1',JSON.stringify(logoLibrary.map(l=>({id:l.id,name:l.name,dataURL:l.dataURL}))));
}
function redrawLogoLayer(){
  if(!logoCtx)return;
  logoCtx.clearRect(0,0,DECAL_SIZE,DECAL_SIZE);
  // same ownership order as paint: team design decals under player accents
  paintStackOrder(placedDecals,baseDecals)
    .forEach(list=>ihcReplayDecals(logoCtx,list,logoLibrary,paintMirrorOn));
  syncCanvasToDataTexture(logoCtx,logoCanvas,logoTexture);
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
    d.addEventListener('click',()=>placeDecal(l.id));
    grid.appendChild(d);
  });
}
function placeDecal(logoId){
  const meshes=getPaintTargetMeshes();
  let uv={x:0.5,y:0.5},side=1;
  if(meshes.length){
    raycaster.setFromCamera(new THREE.Vector2(0,0),camera);
    const hits=raycaster.intersectObjects(meshes,false);
    if(hits.length&&hits[0].uv){
      uv=hits[0].uv;
      side=hits[0].object.worldToLocal(hits[0].point.clone()).x>=0?1:-1;
    }
  }
  placedDecals.push({id:'D'+Date.now(),logoId,u:uv.x,v:uv.y,side,scale:0.15,rotation:0,target:paintTarget,visible:true});
  selectedDecalIdx=placedDecals.length-1;
  redrawLogoLayer();
  renderPlacedDecalsList();
  renderPlacedDecalControls();
  pushHistory();
  showToast('Logo placed — drag on the model or use the sliders');
}
/* one-click Forza-style shape stamp: skips the Logo Creator round-trip
   entirely — rasterizes a single shape straight to the library (reusing the
   same shape paths) using the current brush color, then places it exactly
   like any other saved logo (drag/scale/rotate below). */
function quickStampShape(shape){
  const cvs=document.createElement('canvas');cvs.width=cvs.height=256;
  const ctx=cvs.getContext('2d');
  ctx.save();ctx.translate(128,128);
  lcDrawShapePath(ctx,shape,104);
  ctx.fillStyle=paintBrushColor;ctx.fill();
  ctx.restore();
  const dataURL=cvs.toDataURL('image/png');
  const img=new Image();
  const entry={id:'LG'+Date.now(),name:'Shape: '+shape,dataURL,img};
  img.onload=()=>{
    logoLibrary.push(entry);
    saveLogoLibrary();
    renderLogoLibraryGrid();
    placeDecal(entry.id);
  };
  img.src=dataURL;
}
function moveSelectedDecal(uv){
  const d=placedDecals[selectedDecalIdx];if(!d)return;
  d.u=uv.x;d.v=uv.y;d.side=uv.side;d.target=paintTarget;
  redrawLogoLayer();
}
/* selectedDecalIdx used to only ever get set by placeDecal() — once you'd
   placed a second logo, or reopened this category, the first one had no
   surviving handle: the "Selected Logo" panel only ever showed the most
   recently placed decal, so anything placed earlier couldn't be reached to
   delete. This list shows every placed decal with its own delete button,
   independent of which one (if any) is currently selected. */
function selectDecal(idx){
  selectedDecalIdx=(selectedDecalIdx===idx)?-1:idx;
  renderPlacedDecalsList();
  renderPlacedDecalControls();
}
function deleteDecal(idx){
  if(idx<0||idx>=placedDecals.length)return;
  placedDecals.splice(idx,1);
  if(selectedDecalIdx===idx)selectedDecalIdx=-1;
  else if(selectedDecalIdx>idx)selectedDecalIdx--;
  decalMoveModeOn=false;
  redrawLogoLayer();
  renderPlacedDecalsList();
  renderPlacedDecalControls();
  pushHistory();
}
/* Swaps array-adjacent entries — since redrawLogoLayer draws placedDecals in
   array order (later = on top), this is a genuine z-order reorder within
   the decal stack, not just a list-display reshuffle. */
function reorderDecal(idx,dir){
  const j=idx+dir;
  if(j<0||j>=placedDecals.length)return;
  [placedDecals[idx],placedDecals[j]]=[placedDecals[j],placedDecals[idx]];
  if(selectedDecalIdx===idx)selectedDecalIdx=j;else if(selectedDecalIdx===j)selectedDecalIdx=idx;
  redrawLogoLayer();
  renderPlacedDecalsList();
  renderPlacedDecalControls();
  pushHistory();
}
function toggleDecalVisible(idx){
  const d=placedDecals[idx];if(!d)return;
  d.visible=d.visible===false;
  redrawLogoLayer();
  renderPlacedDecalsList();
  pushHistory();
}
function updateLayersTotalBadge(){
  const b=document.getElementById('layersTotalBadge');
  if(b)b.textContent=(paintStrokes.length+placedDecals.length)+' total';
}
function renderPlacedDecalsList(){
  updateLayersTotalBadge();
  const el=document.getElementById('placedDecalsList');
  if(!el)return;
  if(!placedDecals.length){el.innerHTML='<div class="rp-note">No logos placed on the model yet — click one above to stamp it on.</div>';return;}
  el.innerHTML=placedDecals.map((d,i)=>{
    const lib=logoLibrary.find(l=>l.id===d.logoId);
    const thumb=lib?lib.dataURL:'';
    const active=i===selectedDecalIdx,hidden=d.visible===false;
    return`<div class="layer-row${active?' active':''}${hidden?' hidden-layer':''}" data-idx="${i}">
      <div class="layer-thumb" style="background:#14151c url(${thumb}) center/contain no-repeat;"></div>
      <div class="layer-label">${lib?lib.name:'Logo'} — ${d.target}</div>
      <div class="layer-btn" data-vis-idx="${i}" title="${hidden?'Show':'Hide'}">${hidden?'🚫':'👁'}</div>
      <div class="layer-btn" data-up-idx="${i}" title="Move up"${i===placedDecals.length-1?' disabled':''}>↑</div>
      <div class="layer-btn" data-down-idx="${i}" title="Move down"${i===0?' disabled':''}>↓</div>
      <div class="layer-btn" data-del-idx="${i}" title="Delete">🗑</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.layer-row').forEach(row=>{
    row.addEventListener('click',e=>{
      if(e.target.closest('.layer-btn'))return;
      selectDecal(+row.dataset.idx);
    });
  });
  el.querySelectorAll('[data-vis-idx]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();toggleDecalVisible(+btn.dataset.visIdx);}));
  el.querySelectorAll('[data-up-idx]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();reorderDecal(+btn.dataset.upIdx,1);}));
  el.querySelectorAll('[data-down-idx]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();reorderDecal(+btn.dataset.downIdx,-1);}));
  el.querySelectorAll('[data-del-idx]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();deleteDecal(+btn.dataset.delIdx);}));
}
/* ----- paint-stroke layers (same list/reorder/hide/delete pattern as decals above) ----- */
function selectStroke(idx){
  selectedStrokeIdx=(selectedStrokeIdx===idx)?-1:idx;
  renderPaintLayersList();
  renderPaintLayerControls();
}
function deleteStroke(idx){
  if(idx<0||idx>=paintStrokes.length)return;
  paintStrokes.splice(idx,1);
  if(selectedStrokeIdx===idx)selectedStrokeIdx=-1;
  else if(selectedStrokeIdx>idx)selectedStrokeIdx--;
  redrawPaintLayer();
  renderPaintLayersList();
  renderPaintLayerControls();
  pushHistory();
}
function reorderStroke(idx,dir){
  const j=idx+dir;
  if(j<0||j>=paintStrokes.length)return;
  [paintStrokes[idx],paintStrokes[j]]=[paintStrokes[j],paintStrokes[idx]];
  if(selectedStrokeIdx===idx)selectedStrokeIdx=j;else if(selectedStrokeIdx===j)selectedStrokeIdx=idx;
  redrawPaintLayer();
  renderPaintLayersList();
  renderPaintLayerControls();
  pushHistory();
}
function toggleStrokeVisible(idx){
  const s=paintStrokes[idx];if(!s)return;
  s.visible=s.visible===false;
  redrawPaintLayer();
  renderPaintLayersList();
  pushHistory();
}
function renderPaintLayersList(){
  updateLayersTotalBadge();
  const el=document.getElementById('paintLayersList');
  if(!el)return;
  if(!paintStrokes.length){el.innerHTML='<div class="rp-note">No paint strokes yet — enable Paint Mode above and drag on the model.</div>';return;}
  el.innerHTML=paintStrokes.map((s,i)=>{
    const active=i===selectedStrokeIdx,hidden=s.visible===false;
    return`<div class="layer-row${active?' active':''}${hidden?' hidden-layer':''}" data-idx="${i}">
      <div class="layer-thumb" style="background:${s.color};"></div>
      <div class="layer-label">Stroke — ${s.target} · ${s.points.length}pt</div>
      <div class="layer-btn" data-vis-idx="${i}" title="${hidden?'Show':'Hide'}">${hidden?'🚫':'👁'}</div>
      <div class="layer-btn" data-up-idx="${i}" title="Move up"${i===paintStrokes.length-1?' disabled':''}>↑</div>
      <div class="layer-btn" data-down-idx="${i}" title="Move down"${i===0?' disabled':''}>↓</div>
      <div class="layer-btn" data-del-idx="${i}" title="Delete">🗑</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.layer-row').forEach(row=>{
    row.addEventListener('click',e=>{
      if(e.target.closest('.layer-btn'))return;
      selectStroke(+row.dataset.idx);
    });
  });
  el.querySelectorAll('[data-vis-idx]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();toggleStrokeVisible(+btn.dataset.visIdx);}));
  el.querySelectorAll('[data-up-idx]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();reorderStroke(+btn.dataset.upIdx,1);}));
  el.querySelectorAll('[data-down-idx]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();reorderStroke(+btn.dataset.downIdx,-1);}));
  el.querySelectorAll('[data-del-idx]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();deleteStroke(+btn.dataset.delIdx);}));
}
function renderPaintLayerControls(){
  const el=document.getElementById('paintLayerControls');
  if(!el)return;
  const s=paintStrokes[selectedStrokeIdx];
  if(!s){el.innerHTML='';return;}
  el.innerHTML=`<div class="rp-section-title" style="margin-top:14px;">Selected Stroke</div>
    <div class="mat-slider-row"><div class="mat-slider-label"><span>Thickness</span><b id="strokeSizeVal"></b></div>
      <input type="range" id="strokeSizeSlider" min="6" max="140" step="2"></div>
    <div class="mat-slider-row"><div class="mat-slider-label"><span>Opacity</span><b id="strokeOpVal"></b></div>
      <input type="range" id="strokeOpSlider" min="0.05" max="1" step="0.05"></div>
    <div class="zone-row" id="strokeColorRow"><div class="zone-swatch" id="strokeColorSwatch" style="background:${s.color}"></div>
      <div class="zone-info"><div class="zone-name">Recolor Stroke</div></div></div>
    <div class="btn-row" style="margin-top:8px;"><div class="btn" id="strokeDeleteBtn">🗑 Delete Stroke</div></div>`;
  const sizeSlider=document.getElementById('strokeSizeSlider');
  sizeSlider.value=s.size;document.getElementById('strokeSizeVal').textContent=s.size;
  sizeSlider.addEventListener('input',()=>{s.size=+sizeSlider.value;document.getElementById('strokeSizeVal').textContent=s.size;redrawPaintLayer();});
  sizeSlider.addEventListener('change',pushHistory);
  const opSlider=document.getElementById('strokeOpSlider');
  opSlider.value=s.opacity;document.getElementById('strokeOpVal').textContent=Math.round(s.opacity*100)+'%';
  opSlider.addEventListener('input',()=>{s.opacity=+opSlider.value;document.getElementById('strokeOpVal').textContent=Math.round(s.opacity*100)+'%';redrawPaintLayer();});
  opSlider.addEventListener('change',pushHistory);
  document.getElementById('strokeColorRow').addEventListener('click',()=>{
    openColorPicker(document.getElementById('strokeColorSwatch'),'paintstroke',selectedStrokeIdx);
  });
  document.getElementById('strokeDeleteBtn').addEventListener('click',()=>{
    deleteStroke(selectedStrokeIdx);
  });
}
function renderPlacedDecalControls(){
  const el=document.getElementById('placedDecalControls');
  if(!el)return;
  const d=placedDecals[selectedDecalIdx];
  if(!d){el.innerHTML='';return;}
  el.innerHTML=`<div class="rp-section-title" style="margin-top:14px;">Selected Logo</div>
    <div class="mat-slider-row"><div class="mat-slider-label"><span>Scale</span><b id="decalScaleVal"></b></div>
      <input type="range" id="decalScaleSlider" min="0.03" max="0.6" step="0.01"></div>
    <div class="mat-slider-row"><div class="mat-slider-label"><span>Rotation</span><b id="decalRotVal"></b></div>
      <input type="range" id="decalRotSlider" min="-180" max="180" step="1"></div>
    <div class="btn-row" style="margin-bottom:8px;"><div class="btn" id="decalMoveBtn">✥ Move on Model</div></div>
    <div class="btn-row"><div class="btn" id="decalDeleteBtn">🗑 Delete Logo</div></div>`;
  const scaleSlider=document.getElementById('decalScaleSlider');
  scaleSlider.value=d.scale;document.getElementById('decalScaleVal').textContent=Math.round(d.scale*100)+'%';
  scaleSlider.addEventListener('input',()=>{d.scale=+scaleSlider.value;document.getElementById('decalScaleVal').textContent=Math.round(d.scale*100)+'%';redrawLogoLayer();});

  const rotSlider=document.getElementById('decalRotSlider');
  rotSlider.value=(d.rotation||0)*180/Math.PI;document.getElementById('decalRotVal').textContent=Math.round(rotSlider.value)+'°';
  rotSlider.addEventListener('input',()=>{d.rotation=(+rotSlider.value)*Math.PI/180;document.getElementById('decalRotVal').textContent=Math.round(rotSlider.value)+'°';redrawLogoLayer();});

  const moveBtn=document.getElementById('decalMoveBtn');
  const syncMoveBtn=()=>{
    moveBtn.classList.toggle('primary',decalMoveModeOn);
    moveBtn.textContent=decalMoveModeOn?'✥ Move Mode: ON':'✥ Move on Model';
    renderer.domElement.style.cursor=decalMoveModeOn?'move':'';
  };
  syncMoveBtn();
  moveBtn.addEventListener('click',()=>{
    decalMoveModeOn=!decalMoveModeOn;
    if(decalMoveModeOn){paintModeOn=false;renderer.domElement.style.cursor='move';}
    syncMoveBtn();
  });
  document.getElementById('decalDeleteBtn').addEventListener('click',()=>{
    deleteDecal(selectedDecalIdx);
  });
}

/* ============================== HISTORY MANAGER ============================== */
const history=[];let historyIdx=-1;
function captureState(){
  return{
    body:bodyZM.zones.map(z=>'#'+z.color.getHexString()),
    stick:stickZM.zones.map(z=>'#'+z.color.getHexString()),
    neck:'#'+neckZone.color.getHexString(),
    name:jerseyName,number:jerseyNumber,
    // vector data (points/target/style), not raw pixels — cheap enough to
    // snapshot on every history push, see redrawPaintLayer's own note.
    paintStrokes:JSON.parse(JSON.stringify(paintStrokes)),
    placedDecals:JSON.parse(JSON.stringify(placedDecals)),
    // captured alongside the strokes so undo/redo can't land the mirror
    // toggle and the stroke data out of sync with each other — see
    // paintCanvasXY's note on why they have to agree.
    paintMirrorOn,
    jerseyFont,
  };
}
function pushHistory(){
  const snap=captureState();
  history.length=historyIdx+1;
  history.push(snap);historyIdx++;
  if(history.length>60){history.shift();historyIdx--;}
}
function applyState(s){
  s.body.forEach((hex,i)=>bodyZM.setZoneColor(i,hex));
  s.stick.forEach((hex,i)=>stickZM.setZoneColor(i,hex));
  if(s.neck)neckZone.setColor(s.neck);
  jerseyName=s.name||'';
  // number is never undoable editor state anymore — it's whatever the team
  // admin has assigned for the current team (request/approve flow)
  jerseyNumber=ihtEffectiveNumber(ctxTeam());
  const ni=document.getElementById('nameInput');if(ni)ni.value=jerseyName;
  jerseyFont=s.jerseyFont||'Arial';
  const fs=document.getElementById('fontSelect');if(fs)fs.value=jerseyFont;
  // ||[] guards presets/history saved before paint/decal layers existed;
  // ??true guards history/presets saved before the mirror toggle existed
  paintStrokes=JSON.parse(JSON.stringify(s.paintStrokes||[]));
  placedDecals=JSON.parse(JSON.stringify(s.placedDecals||[]));
  paintMirrorOn=s.paintMirrorOn??true;
  applyPaintMirrorUniform();
  const mb=document.getElementById('mirrorPaintBtn');
  if(mb){mb.classList.toggle('primary',paintMirrorOn);mb.textContent=paintMirrorOn?'🪞 Mirror Paint & Decals: ON':'🪞 Mirror Paint & Decals: OFF';}
  selectedStrokeIdx=-1;selectedDecalIdx=-1;
  redrawPaintLayer();redrawLogoLayer();
  renderPlacedDecalsList();renderPlacedDecalControls();
  renderPaintLayersList();renderPaintLayerControls();
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
    body:bodyZM.zones.map(z=>'#'+z.color.getHexString()),
    stick:stickZM.zones.map(z=>'#'+z.color.getHexString()),
    neck:'#'+neckZone.color.getHexString(),
    jname:jerseyName,jnumber:jerseyNumber,jfont:jerseyFont,
    paintStrokes:JSON.parse(JSON.stringify(paintStrokes)),
    placedDecals:JSON.parse(JSON.stringify(placedDecals)),
    paintMirrorOn,
  });
  savePresets(presets);renderRightPanel();showToast('Preset saved');
}
function applyPreset(id){
  const p=loadPresets().find(x=>x.id===id);if(!p)return;
  p.body.forEach((hex,i)=>bodyZM.setZoneColor(i,hex));
  p.stick.forEach((hex,i)=>stickZM.setZoneColor(i,hex));
  if(p.neck)neckZone.setColor(p.neck);
  jerseyName=p.jname||'';jerseyNumber=p.jnumber||'';
  jerseyFont=p.jfont||'Arial';
  nameFontSizeCache=null;numberFontSizeCache=null;
  { const fs=document.getElementById('fontSelect'); if(fs)fs.value=jerseyFont; }
  const ni=document.getElementById('nameInput');if(ni)ni.value=jerseyName;
  const nu=document.getElementById('numberInput');if(nu)nu.value=jerseyNumber;
  paintStrokes=JSON.parse(JSON.stringify(p.paintStrokes||[]));
  placedDecals=JSON.parse(JSON.stringify(p.placedDecals||[]));
  paintMirrorOn=p.paintMirrorOn??true;
  applyPaintMirrorUniform();
  const mb=document.getElementById('mirrorPaintBtn');
  if(mb){mb.classList.toggle('primary',paintMirrorOn);mb.textContent=paintMirrorOn?'🪞 Mirror Paint & Decals: ON':'🪞 Mirror Paint & Decals: OFF';}
  selectedStrokeIdx=-1;selectedDecalIdx=-1;
  redrawPaintLayer();redrawLogoLayer();
  renderPlacedDecalsList();renderPlacedDecalControls();
  renderPaintLayersList();renderPaintLayerControls();
  refreshSwatches();pushHistory();showToast(p.name+' loaded');
}

/* ============================== MISC UI ============================== */
let toastT=null;
function showToast(msg){
  const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');
  clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),1600);
}
document.getElementById('toggleRotate').addEventListener('click',e=>{
  autoRotate=!autoRotate;e.currentTarget.classList.toggle('active',autoRotate);
});
document.getElementById('toggleReflection').addEventListener('click',e=>{
  reflectionOn=!reflectionOn;e.currentTarget.classList.toggle('active',reflectionOn);
  if(reflectionClone)reflectionClone.visible=reflectionOn;
});
/* every edit already autosaves (saveToStore runs off redrawNameNumber and
   pushHistory, which every edit path funnels through) — this button exists
   for the explicit "I'm done" moment: force one last save, confirm it, then
   hand off back to the site menu. */
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
buildEditorModeTabs();buildSidebar();buildCamPresetButtons();
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
    updateCamera(dt);
    animateIdle(dt);
    renderer.render(scene,camera);
  }
  tick();
});
