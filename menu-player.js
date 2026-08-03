/* ==========================================================================
   MAIN MENU — 3D PLAYER PREVIEW
   ==========================================================================
   Mounts a live WebGL render of YOUR player — wearing the ★ favourite
   team + jersey look chosen in the Locker Room — into the main menu's
   #player-placeholder (the mount point index.html always reserved for
   exactly this). Shown from behind, name + number visible, like a player
   standing in the tunnel: the same framing as the concept art this menu
   was built from.

   Everything jersey-related comes from ice-hockey-customize-core.js — the
   exact same recolor pipeline, plate renderer and layer replay the Locker
   Room editor uses — so what you built there is pixel-for-pixel what stands
   on the menu. NOT loaded here: script.js knows nothing about this file and
   vice versa; if WebGL or any asset fails, the menu simply keeps its empty
   stage (graceful no-op, never an error popup on the menu).
   ========================================================================== */
(function(){
'use strict';
const mount=document.getElementById('player-placeholder');
if(!mount||typeof THREE==='undefined'||typeof PLAYER_B64==='undefined')return;

/* ----- favourite look (team store, shared with the editor) ----- */
const TST=ihtLoad(),KIT=ihtLoadKit();
const FAV=TST.favourite;
const team=ihtTeam(TST,FAV.teamId);
const jersey=ihtJersey(team,FAV.jerseyId);
const kctx=(KIT.contexts&&KIT.contexts[ihtContextKey(team.id,jersey.id)])||{};
const lo=ihtEffectiveLoadout(TST,KIT,FAV.teamId,FAV.jerseyId);

/* ----- profile chip: real identity instead of the old hardcoded mock ----- */
(function(){
  const nameEl=document.querySelector('.profile-chip .profile-id .name');
  const roleEl=document.querySelector('.profile-chip .profile-id .role');
  if(nameEl&&(lo.name||lo.number))nameEl.textContent=(lo.name||'PLAYER')+(lo.number?' #'+lo.number:'');
  if(roleEl)roleEl.textContent=lo.jerseyLabel+' kit · '+lo.teamName;
})();

/* ----- renderer (transparent — the CSS locker-room backdrop shows through) ----- */
let renderer;
try{
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
}catch(e){return;} // no WebGL → keep the empty stage
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
if(THREE.sRGBEncoding)renderer.outputEncoding=THREE.sRGBEncoding;
renderer.domElement.style.cssText='width:100%;height:100%;display:block;';
mount.appendChild(renderer.domElement);

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(30,1,0.05,40);
/* tunnel-light look: cool key from high front-left (the "rink door"),
   warm-ish fill, strong cool rim so the silhouette pops off the dark bg */
scene.add(new THREE.HemisphereLight(0x51618f,0x0a0a10,0.75));
const key=new THREE.DirectionalLight(0xdfe8ff,1.15);key.position.set(1.8,3.2,2.4);scene.add(key);
const fill=new THREE.DirectionalLight(0x8899cc,0.35);fill.position.set(-2.2,1.6,1.2);scene.add(fill);
const rim=new THREE.DirectionalLight(0xa9c4ff,1.25);rim.position.set(0,2.6,-3.0);scene.add(rim);

function resize(){
  const w=mount.clientWidth||1,h=mount.clientHeight||1;
  renderer.setSize(w,h,false);
  camera.aspect=w/h;camera.updateProjectionMatrix();
}
if(typeof ResizeObserver!=='undefined')new ResizeObserver(resize).observe(mount);
addEventListener('resize',resize);
resize();

/* ----- decal canvases (same DataTexture path as the editor — see the
   CanvasTexture-never-uploads note in the editor) ----- */
function makeDecalTex(w,h){
  const t=new THREE.DataTexture(new Uint8Array(w*h*4),w,h,THREE.RGBAFormat);
  t.flipY=false;return t;
}
function makeCanvas(w,h){
  const c=document.createElement('canvas');c.width=w;c.height=h;
  return c;
}
const nnCanvas=makeCanvas(DECAL_SIZE,DECAL_SIZE),nnCtx=nnCanvas.getContext('2d'),nnTex=makeDecalTex(DECAL_SIZE,DECAL_SIZE);
/* ONE decoration canvas — the editor's whole layer stack flattens into it, so
   decals and strokes keep the z-order the layer panel gave them. It is
   PAINT_W x PAINT_H (the atlas twice over, once per body side), not square. */
const paintCanvas=makeCanvas(PAINT_W,PAINT_H),paintCtx=paintCanvas.getContext('2d'),paintTex=makeDecalTex(PAINT_W,PAINT_H);
function syncTex(ctx,canvas,tex){
  tex.image.data.set(ctx.getImageData(0,0,canvas.width,canvas.height).data);
  tex.needsUpdate=true;
}

function drawPlate(){
  ihcDrawNameNumber(nnCtx,{
    name:lo.name,number:lo.number,font:lo.font,
    primary:lo.body[0],secondary:lo.body[1],trim:lo.body[2],
  });
  syncTex(nnCtx,nnCanvas,nnTex);
}
/* logo bitmaps decode async — redraw as each finishes. Vector shape layers
   carry their own geometry and are correct immediately. */
let logoLib=[];
function drawPaint(){
  paintCtx.clearRect(0,0,PAINT_W,PAINT_H);
  /* Stacked, not sequential: replaying both into one context lets a personal
     ERASE layer rub out the team design underneath it, which would make the
     menu preview disagree with the editor. Bottom first. */
  ihcReplayStackedLayers(paintCtx,[
    ihcDesignLayers(jersey.design,'paintStrokes','decals'),
    ihcDesignLayers(kctx,'accStrokes','accDecals'),
  ],logoLib);
  syncTex(paintCtx,paintCanvas,paintTex);
}
try{logoLib=JSON.parse(localStorage.getItem('ihc_logos_v1')||'[]');}catch(e){logoLib=[];}
logoLib.forEach(l=>{l.img=new Image();l.img.onload=drawPaint;l.img.src=l.dataURL;});

/* ----- character ----- */
const gltfLoader=new THREE.GLTFLoader();
let visual=null,stickGroup=null,swayBones=null,idleT=0,started=false;

function placeStickRest(){
  /* editor's resting-stick math, but in SCENE space (stick is a scene child
     here, not part of the rotated player root): leaning at the player's
     right on the camera side, blade on the floor */
  const stickLen=1.45,mn=-0.005528158973902464,mx=1.204079031944275,flip=true;
  const scale=stickLen/(mx-mn);
  const axisSign=flip?-1:1,posSign=flip?1:-1;
  const localAxis=new THREE.Vector3(0,axisSign,0);
  const dir=new THREE.Vector3(0.20,-1,-0.04).normalize();
  const tip=new THREE.Vector3(0.36,0.01,0.10);
  stickGroup.scale.setScalar(scale);
  stickGroup.quaternion.setFromUnitVectors(localAxis,dir);
  stickGroup.position.copy(tip).addScaledVector(dir,posSign*mn*scale);
  stickGroup.rotateY(1.5708);
}
/* No animation clips ship in this GLB (verified: `animations:[]` in its JSON
   chunk — the game poses everything procedurally too), so the raw bind pose
   is a T-pose. Bring the arms down with the same bone-aiming technique the
   game's IK uses: align each bone's child-direction with a desired world
   direction. Called AFTER root rotation is final so world dirs are stable. */
function poseArmsDown(){
  ['l','r'].forEach(s=>{
    const upper=visual.getObjectByName('upperarm_'+s);
    const fore=visual.getObjectByName('lowerarm_'+s);
    const hand=fore&&visual.getObjectByName('hand_'+s);
    if(!upper||!fore)return;
    upper.updateWorldMatrix(true,true);
    const shoulderW=new THREE.Vector3();upper.getWorldPosition(shoulderW);
    const rootW=new THREE.Vector3();root.getWorldPosition(rootW);
    const out=Math.sign(shoulderW.x-rootW.x)||1; // which side this arm is on
    const restU=fore.position.clone().normalize();
    const desU=new THREE.Vector3(out*0.24,-0.96,0.03).normalize();
    const pq=new THREE.Quaternion();upper.parent.getWorldQuaternion(pq);pq.invert();
    upper.quaternion.setFromUnitVectors(restU,desU.applyQuaternion(pq));
    upper.updateWorldMatrix(true,true);
    if(hand){
      const restF=hand.position.clone().normalize();
      // slight forward elbow bend so it reads relaxed, not pinned
      const desF=new THREE.Vector3(out*0.14,-0.92,-0.22).normalize();
      const pq2=new THREE.Quaternion();fore.parent.getWorldQuaternion(pq2);pq2.invert();
      fore.quaternion.setFromUnitVectors(restF,desF.applyQuaternion(pq2));
    }
  });
}

function applyLoadout(){
  // exact same per-piece pipeline the Locker Room builds the preview with —
  // shared in core precisely so the menu and the editor can't drift apart
  const pieces=ihcBuildPieceKit(visual,{nameNumberMap:nnTex,paintMap:paintTex});
  const pieceColors=lo.pieces||ihtPiecesFromBody(lo.body);
  Object.keys(pieceColors).forEach(id=>{
    const p=pieces[id];
    if(!p)return;
    (pieceColors[id]||[]).forEach((h,i)=>{if(p.zones[i])p.zones[i].setColor(h);});
  });
  if(pieces.neck)pieces.neck.zones[0].setColor(lo.neck);

  // stick: same 3-mesh / cloned-tape-materials split as the editor
  const meshMain=stickGroup.getObjectByName('Plane001');
  const meshBladeTape=stickGroup.getObjectByName('Plane002');
  const meshGripTape=stickGroup.getObjectByName('Plane005');
  meshBladeTape.material=meshBladeTape.material.clone();
  meshGripTape.material=meshGripTape.material.clone();
  const shaftBladeMgr=setupZoneMaterial(meshMain.material,2,['Blade','Shaft']);
  // lo.stick order: [Shaft, Blade, Grip Tape, Blade Tape]
  shaftBladeMgr.zones[1].setColor(lo.stick[0]);
  shaftBladeMgr.zones[0].setColor(lo.stick[1]);
  setupTintZone(meshGripTape.material,'Grip Tape').setColor(lo.stick[2]);
  setupTintZone(meshBladeTape.material,'Blade Tape').setColor(lo.stick[3]);

  drawPlate();drawPaint();
}

function setupSway(v){
  const spine=v.getObjectByName('spine_03'),head=v.getObjectByName('head');
  if(spine)spine.userData.baseQ=spine.quaternion.clone();
  if(head)head.userData.baseQ=head.quaternion.clone();
  swayBones={spine,head};
}
function animateSway(dt){
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

const root=new THREE.Group();scene.add(root);
let mixer=null;
let loaded=0;const done=()=>{if(++loaded===2)start();};
gltfLoader.parse(b64ToBuf(PLAYER_B64),'',gltf=>{
  remapBoneNames(gltf.scene);
  visual=gltf.scene;
  ihcNoCull(visual);
  let box=new THREE.Box3().setFromObject(visual),size=new THREE.Vector3();box.getSize(size);
  visual.scale.setScalar(1.75/(size.y||1));
  box=new THREE.Box3().setFromObject(visual);visual.position.y=-box.min.y;
  root.add(visual);
  /* the GLB ships its own Idle_Loop (the same clip the game plays) — a real
     standing pose instead of the raw T-pose bind. Fall back to the editor's
     spine/head sway if the clip is ever missing. */
  if(gltf.animations&&gltf.animations.length){
    mixer=new THREE.AnimationMixer(visual);
    const clip=gltf.animations.find(a=>a.name==='Idle_Loop')||gltf.animations[0];
    mixer.clipAction(clip).play();
  }else{
    setupSway(visual);
  }
  done();
},e=>{console.warn('menu player load failed',e);});
gltfLoader.parse(b64ToBuf(STICK_B64),'',gltf=>{
  stickGroup=gltf.scene;scene.add(stickGroup);ihcNoCull(stickGroup);placeStickRest();done();
},e=>{console.warn('menu stick load failed',e);});

function start(){
  if(started)return;started=true;
  applyLoadout();
  /* Seen from BEHIND (name + number to camera) like the tunnel shot the
     menu design is based on; slight angle so it's not a flat back view. */
  root.rotation.y=Math.PI+0.22;
  poseArmsDown();
  // framed so the FLOOR is in shot — feet planted, stick blade grounded
  camera.position.set(0,1.0,4.0);
  camera.lookAt(0,0.92,0);
  const clock=new THREE.Clock();
  let breatheT=0;
  (function tick(){
    requestAnimationFrame(tick);
    const dt=Math.min(clock.getDelta(),0.05);
    breatheT+=dt;
    if(mixer)mixer.update(dt);else animateSway(dt);
    // barely-there drift so he reads as alive, not a statue
    root.rotation.y=Math.PI+0.22+Math.sin(breatheT*0.23)*0.05;
    renderer.render(scene,camera);
  })();
}
})();
