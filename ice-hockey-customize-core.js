/* ==========================================================================
   ICE HOCKEY — SHARED CUSTOMIZE CORE
   ==========================================================================
   Everything in here is used by BOTH the Locker Room editor
   (ice-hockey-customize-app.js) and the main-menu player preview
   (menu-player.js). It was extracted out of the editor precisely so the two
   can never drift apart on the load/recolor/name-plate pipeline — if you
   change how a jersey renders, change it HERE, not in a copy.
   (game.html keeps its own self-contained ih* port of the name/number
   renderer on purpose — the game must stay a single file — so that one copy
   DOES have to be updated by hand to match ihcDrawNameNumber.)

   Sections:
     Asset Loader     — b64 -> ArrayBuffer, bone-name remap
     Recolor Pipeline — palette extraction, mask texture, zone shader
     Jersey Decals    — name/number plate draw, stroke + logo replay
     Team Store       — leagues/teams/jerseys, policy matrix, number
                        approvals, favourite look, effective loadout
   ========================================================================== */

/* ============================== ASSET LOADER ============================== */
function b64ToBuf(b64){const bin=atob(b64);const buf=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i);return buf.buffer;}

/* hasa1992's Blender human-metarig bone names don't matter for static viewing
   (no IK), but we still normalize them for the idle-sway bones (spine_03,
   head) and so these loaders stay consistent with the main game's. */
/* three.js frustum-culls against geometry.boundingSphere, which is built from
   the BIND POSE — but posed skinned meshes render wherever the bones drag
   them. On the stick that drift is over a metre while the tape wraps' spheres
   are only ~0.1 radius, so both tape meshes fail the test and never draw.
   These are a handful of always-on-screen character meshes; skip the test. */
function ihcNoCull(root){root.traverse(o=>{if(o.isMesh)o.frustumCulled=false;});}

function remapBoneNames(root){
  const RENAME_EXACT={'spine':'spine_01','spine1':'spine_02','spine2':'spine_03','neck1':'neck_01'};
  const RENAME_SIDED={'upper_arm':'upperarm','forearm':'lowerarm','hand':'hand','thigh':'thigh','shin':'calf','foot':'foot'};
  root.traverse(o=>{
    const n=o.name;if(!n)return;
    if(RENAME_EXACT[n]){o.name=RENAME_EXACT[n];return;}
    for(const base in RENAME_SIDED){
      if(n===base+'L'||n===base+'.L'){o.name=RENAME_SIDED[base]+'_l';return;}
      if(n===base+'R'||n===base+'.R'){o.name=RENAME_SIDED[base]+'_r';return;}
    }
  });
}

/* ============================== RECOLOR PIPELINE ============================== */
function getImageDataFromTexture(tex){
  const img=tex.image;
  const cvs=document.createElement('canvas');cvs.width=img.width;cvs.height=img.height;
  const ctx=cvs.getContext('2d');ctx.drawImage(img,0,0);
  return ctx.getImageData(0,0,cvs.width,cvs.height);
}
function extractPalette(imgData,maxClusters,sampleStride){
  const data=imgData.data;const buckets=new Map();const Q=20;
  for(let i=0;i<data.length;i+=4*sampleStride){
    const a=data[i+3];if(a<20)continue;
    const r=data[i],g=data[i+1],b=data[i+2];
    const key=(Math.round(r/Q)*Q)+','+(Math.round(g/Q)*Q)+','+(Math.round(b/Q)*Q);
    let e=buckets.get(key);if(!e){e={count:0,r:0,g:0,b:0};buckets.set(key,e);}
    e.count++;e.r+=r;e.g+=g;e.b+=b;
  }
  let arr=Array.from(buckets.values()).map(e=>({count:e.count,color:[e.r/e.count,e.g/e.count,e.b/e.count]}));
  arr.sort((a,b)=>b.count-a.count);
  const merged=[];
  for(const c of arr){
    const dupe=merged.find(m=>{const dr=m.color[0]-c.color[0],dg=m.color[1]-c.color[1],db=m.color[2]-c.color[2];return dr*dr+dg*dg+db*db<1600;});
    if(dupe)dupe.count+=c.count;else merged.push({count:c.count,color:c.color});
    if(merged.length>=maxClusters*4)break;
  }
  merged.sort((a,b)=>b.count-a.count);
  const total=merged.reduce((s,c)=>s+c.count,0)||1;
  return merged.map(c=>({color:c.color,share:c.count/total}));
}
function buildMaskTexture(imgData,recolor,fixed){
  const w=imgData.width,h=imgData.height,src=imgData.data;
  const out=new Uint8Array(w*h*4);
  const all=recolor.map((c,i)=>({color:c.color,idx:i})).concat(fixed.map(c=>({color:c.color,idx:-1})));
  for(let p=0;p<w*h;p++){
    const o=p*4,a=src[o+3];
    if(a<20)continue;
    const r=src[o],g=src[o+1],b=src[o+2];
    let best=all[0],bestD=Infinity;
    for(const c of all){const dr=r-c.color[0],dg=g-c.color[1],db=b-c.color[2];const d=dr*dr+dg*dg+db*db;if(d<bestD){bestD=d;best=c;}}
    if(best.idx===0)out[o]=255;else if(best.idx===1)out[o+1]=255;else if(best.idx===2)out[o+2]=255;
    out[o+3]=255;
  }
  const tex=new THREE.DataTexture(out,w,h,THREE.RGBAFormat);
  tex.flipY=false;tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;tex.needsUpdate=true;
  return tex;
}
function installRecolorShader(material,maskTexture,zoneColors,decals,split){
  /* three.js's WebGLProgram cache doesn't factor onBeforeCompile's own logic
     into its cache key by default — two materials that look identical on
     "standard" properties (same map, same skinning/defines) can silently
     share one compiled program, so whichever material's onBeforeCompile
     didn't "win" the cache silently loses its extra uniforms (this is
     exactly what was happening: nameNumberMap/paintMap were declared and
     wired correctly but never got uploaded, because a cached program
     compiled from a different onBeforeCompile call — one without those
     samplers — was being reused for this material's draw calls). A unique
     customProgramCacheKey per material instance forces its own cache entry. */
  material.customProgramCacheKey=()=>'zoneMaterial_'+material.uuid+(decals?'_decals':'');
  material.onBeforeCompile=(shader)=>{
    shader.uniforms.maskMap={value:maskTexture};
    shader.uniforms.zoneColor0={value:zoneColors[0]};
    shader.uniforms.zoneColor1={value:zoneColors[1]};
    shader.uniforms.zoneColor2={value:zoneColors[2]};
    /* SPLIT PIECE: two equipment pieces that live on ONE mesh (pants and
       socks are a single continuous leg mesh on this rig) get a second set
       of zone colors, selected per-fragment by the raw bind-pose height —
       the same trick vIhSide already uses for left/right, one axis over.
       They deliberately SHARE the mask/palette: both halves are painted
       from the same three texture colors, so a shared classification is
       correct and only the color triples differ. */
    shader.uniforms.splitZone0={value:(split?split.colors[0]:zoneColors[0])};
    shader.uniforms.splitZone1={value:(split?split.colors[1]:zoneColors[1])};
    shader.uniforms.splitZone2={value:(split?split.colors[2]:zoneColors[2])};
    shader.uniforms.uSplitY={value:split?split.y:-999.0};
    let extraUniforms='\nuniform vec3 splitZone0;\nuniform vec3 splitZone1;\nuniform vec3 splitZone2;\nuniform float uSplitY;\nvarying float vIhY;',extraCode='';
    if(decals){
      shader.uniforms.logoMap={value:decals.logoMap};
      shader.uniforms.paintMap={value:decals.paintMap};
      shader.uniforms.uMirrorPaint={value:1.0};
      extraUniforms+='\nuniform sampler2D logoMap;\nuniform sampler2D paintMap;\nuniform float uMirrorPaint;';
      /* The name/number PLATE only exists on the jersey's own UV region, so
         only the jersey's material samples it — every other piece would just
         be paying for a sampler that can never contribute a pixel (and could
         stamp a stray letter if some other island happened to overlap the
         plate rect). */
      if(decals.nameNumberMap){
        shader.uniforms.nameNumberMap={value:decals.nameNumberMap};
        extraUniforms+='\nuniform sampler2D nameNumberMap;';
      }
      /* Mirror ON (default, unchanged behavior): sample logoMap/paintMap at
         the raw (shared/mirrored) UV — whatever's painted/placed on one leg
         shows on both, same as it always has. Mirror OFF: the canvas is
         packed into left/right HALVES by ihcPaintCanvasXY() (see its own
         comment) — sample whichever half matches this fragment's real side
         (vIhSide, the per-fragment counterpart to the JS-side raycast hit
         test used while painting/placing) instead of the raw shared UV.
         Logos share the exact same mirrored-UV problem paint had (confirmed:
         a decal placed once showed up on both legs) so they use the exact
         same remap/uniform — no separate "mirror decals" toggle. */
      extraCode=(decals.nameNumberMap?`
          vec4 nn = texture2D( nameNumberMap, vUv );
          diffuseColor.rgb = mix( diffuseColor.rgb, nn.rgb, nn.a );`:'')+`
          vec2 pUv = vUv;
          if(uMirrorPaint<0.5){ pUv.x = pUv.x*0.5+(vIhSide>=0.0?0.5:0.0); }
          vec4 lg = texture2D( logoMap, pUv );
          diffuseColor.rgb = mix( diffuseColor.rgb, lg.rgb, lg.a );
          vec4 pt = texture2D( paintMap, pUv );
          diffuseColor.rgb = mix( diffuseColor.rgb, pt.rgb, pt.a );`;
      extraUniforms+='\nvarying float vIhSide;';
    }
    /* vIhSide / vIhY: which real-world side (x) and which bind-pose height (y)
       a fragment belongs to, from the raw pre-skin `position` attribute —
       vIhSide was verified with a forced hard-override render (solid red/blue
       split cleanly down the anatomical midline) before trusting it, and vIhY
       the same way (the pants/socks boundary lands exactly on the shorts hem
       at 0.62). Both require patching the VERTEX shader. */
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying float vIhSide;\nvarying float vIhY;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvIhSide = position.x;\nvIhY = position.y;');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform sampler2D maskMap;\nuniform vec3 zoneColor0;\nuniform vec3 zoneColor1;\nuniform vec3 zoneColor2;'+extraUniforms)
      .replace('#include <map_fragment>',`#include <map_fragment>
        {
          vec4 zmask = texture2D( maskMap, vUv );
          vec3 zc0 = zoneColor0, zc1 = zoneColor1, zc2 = zoneColor2;
          if( vIhY < uSplitY ){ zc0 = splitZone0; zc1 = splitZone1; zc2 = splitZone2; }
          vec3 recolored = zc0*zmask.r + zc1*zmask.g + zc2*zmask.b;
          float rw = clamp(zmask.r+zmask.g+zmask.b, 0.0, 1.0);
          diffuseColor.rgb = mix( diffuseColor.rgb, recolored, rw );${extraCode}
        }`);
    material.userData.shaderRef=shader;
  };
  material.needsUpdate=true;
}
function setupZoneMaterial(material,maxZones,labels,decals){
  const imgData=getImageDataFromTexture(material.map);
  const clusters=extractPalette(imgData,maxZones+2,4);
  const recolor=clusters.slice(0,maxZones);
  const fixed=clusters.slice(maxZones);
  const mask=buildMaskTexture(imgData,recolor,fixed);
  const zoneColors=recolor.map(c=>new THREE.Color(c.color[0]/255,c.color[1]/255,c.color[2]/255));
  while(zoneColors.length<3)zoneColors.push(new THREE.Color(0,0,0));
  installRecolorShader(material,mask,zoneColors,decals);
  const zones=recolor.map((c,i)=>{
    const colorObj=zoneColors[i];
    return{
      label:(labels&&labels[i])||('Zone '+(i+1)),
      color:colorObj,
      original:'#'+colorObj.getHexString(),
      share:c.share,
      setColor(hex){colorObj.set(hex);},
    };
  });
  return{
    material,
    fixedShare:fixed.reduce((s,c)=>s+c.share,0),
    zones,
    setZoneColor(i,hex){ if(this.zones[i])this.zones[i].setColor(hex); },
  };
}
/* ====================== PER-PIECE EQUIPMENT ZONES ======================
   The whole kit is ONE 2048² texture atlas and — until this pass — one
   material shared by all nine body meshes, so "Socks · Primary" and
   "Jersey · Primary" were literally the same slider: the mask classified
   the ATLAS by color, and every piece painted with that color moved
   together. Each piece now gets its OWN cloned material, and its own zone
   palette clustered from ONLY the atlas pixels that piece's UV triangles
   actually cover (rasterized below) — so the boot's palette is boot black
   + lace white, the jersey's is its own three colors, and they move
   independently.
   Mesh identity was confirmed by rendering each mesh in a flat distinct
   color: Cube=neck, Cube001=jersey, Cube002=pants+socks (one continuous
   leg mesh — split by height, see IHC_SPLIT_Y), Cube003=gloves,
   Cube004=helmet shell, Cube005=cage, Cube006=skate boots, Cube007=blade
   steel, Plane004=skate LACES (16 little strap shells across the boot). */
const IHC_SPLIT_Y=0.62; // bind-pose local Y of the shorts hem (render-verified)
const IHC_PIECES=[
  {id:'jersey',label:'Jersey',      icon:'🏒',mesh:'Cube001', zones:3,zoneLabels:['Primary','Secondary','Trim'],nameplate:true},
  {id:'pants', label:'Pants',       icon:'🩳',mesh:'Cube002', zones:3,zoneLabels:['Primary','Secondary','Trim'],splitSide:'above'},
  {id:'socks', label:'Socks',       icon:'🧦',mesh:'Cube002', zones:3,zoneLabels:['Primary','Secondary','Trim'],splitSide:'below'},
  {id:'gloves',label:'Gloves',      icon:'🧤',mesh:'Cube003', zones:3,zoneLabels:['Primary','Secondary','Trim']},
  {id:'helmet',label:'Helmet',      icon:'⛑️',mesh:'Cube004', zones:3,zoneLabels:['Shell','Secondary','Trim']},
  {id:'cage',  label:'Cage',        icon:'🥅',mesh:'Cube005', zones:2,zoneLabels:['Cage','Padding']},
  {id:'skates',label:'Skate Boots', icon:'⛸️',mesh:'Cube006', zones:2,zoneLabels:['Boot','Accent']},
  {id:'laces', label:'Laces',       icon:'🪢',mesh:'Plane004',zones:2,zoneLabels:['Laces','Eyelets']},
  {id:'blades',label:'Blade Steel', icon:'🔪',mesh:'Cube007', zones:2,zoneLabels:['Steel','Holder']},
  /* Not team equipment — the neck/collar sliver is this rig's only stand-in
     for exposed skin (helmet+cage cover the whole head, there is no face
     texture) and belongs to the PLAYER. It rides the same pipeline purely so
     it gets a coverage-restricted classification like everything else. */
  {id:'neck',  label:'Skin',        icon:'🧑',mesh:'Cube',     zones:1,zoneLabels:['Skin'],personal:true},
];
function ihcPiece(id){return IHC_PIECES.find(p=>p.id===id);}
/* Fills `cov` (1 byte per texel) with 1 wherever this mesh's UV triangles
   land. Triangles are expanded ~1.5px outward from their centroid so the
   island EDGES (where the texture's own antialiasing/bleed lives) count as
   covered — without that, seam pixels fall outside every piece and read as
   an un-recolored fringe. `filter` selects a sub-piece (pants vs socks). */
function ihcRasterTri(cov,w,h,ax,ay,bx,by,cx,cy){
  const gx=(ax+bx+cx)/3,gy=(ay+by+cy)/3,GROW=1.5;
  const ex=(x,y)=>{const dx=x-gx,dy=y-gy,l=Math.hypot(dx,dy)||1;return[x+dx/l*GROW,y+dy/l*GROW];};
  [[ax,ay],[bx,by],[cx,cy]]=[ex(ax,ay),ex(bx,by),ex(cx,cy)];
  const minX=Math.max(0,Math.floor(Math.min(ax,bx,cx))),maxX=Math.min(w-1,Math.ceil(Math.max(ax,bx,cx)));
  const minY=Math.max(0,Math.floor(Math.min(ay,by,cy))),maxY=Math.min(h-1,Math.ceil(Math.max(ay,by,cy)));
  const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
  if(Math.abs(den)<1e-9)return;
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const px=x+0.5,py=y+0.5;
    const l1=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/den;
    const l2=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/den;
    const l3=1-l1-l2;
    if(l1>=0&&l2>=0&&l3>=0)cov[y*w+x]=1;
  }
}
/* UV v maps straight to texel row (no 1-v flip): glTF textures and the mask
   DataTexture are both flipY=false, so v=0 is the FIRST row of pixel data,
   which is the top row of the source image — the same row getImageData()
   returns first. Verified by overlaying a rasterized coverage map on the
   atlas and confirming the laces landed on the lace pixels. */
function ihcMeshCoverage(meshes,w,h,filter){
  const cov=new Uint8Array(w*h);
  meshes.forEach(mesh=>{
    const g=mesh.geometry,uv=g.attributes.uv,pos=g.attributes.position,idx=g.index;
    if(!uv)return;
    const n=idx?idx.count:pos.count;
    for(let t=0;t<n;t+=3){
      const a=idx?idx.getX(t):t,b=idx?idx.getX(t+1):t+1,c=idx?idx.getX(t+2):t+2;
      if(filter&&!filter(pos,a,b,c))continue;
      ihcRasterTri(cov,w,h,uv.getX(a)*w,uv.getY(a)*h,uv.getX(b)*w,uv.getY(b)*h,uv.getX(c)*w,uv.getY(c)*h);
    }
  });
  return cov;
}
function ihcClusterBuckets(buckets,maxClusters){
  let arr=Array.from(buckets.values()).map(e=>({count:e.count,color:[e.r/e.count,e.g/e.count,e.b/e.count]}));
  arr.sort((a,b)=>b.count-a.count);
  const merged=[];
  for(const c of arr){
    const dupe=merged.find(m=>{const dr=m.color[0]-c.color[0],dg=m.color[1]-c.color[1],db=m.color[2]-c.color[2];return dr*dr+dg*dg+db*db<1600;});
    if(dupe)dupe.count+=c.count;else merged.push({count:c.count,color:c.color});
    if(merged.length>=maxClusters*4)break;
  }
  merged.sort((a,b)=>b.count-a.count);
  const total=merged.reduce((s,c)=>s+c.count,0)||1;
  return merged.map(c=>({color:c.color,share:c.count/total}));
}
/* ONE shared 2048² mask for the whole kit, not one per piece: every piece
   owns a disjoint set of atlas texels (its own UV islands), so their
   classifications can live side by side in a single texture — nine separate
   masks would have cost ~150MB of texture memory for zero extra information.
   Each piece's material samples this same mask but multiplies it by its OWN
   three zone colors, which is exactly what makes the pieces independent.
   Built in two passes over the atlas (bucket colors per piece, then classify)
   plus the UV rasterization, and cached for the whole session — the result
   depends only on the shared atlas + shared geometry, never on an entity. */
let _ihcKitCache=null;
function ihcBuildKitMask(visual){
  if(_ihcKitCache)return _ihcKitCache;
  const meshNames=[...new Set(IHC_PIECES.map(p=>p.mesh))];
  const first=meshNames.map(n=>visual.getObjectByName(n)).find(m=>m&&m.material&&m.material.map);
  if(!first)return null;
  const imgData=getImageDataFromTexture(first.material.map);
  const w=imgData.width,h=imgData.height,src=imgData.data;
  /* owner[p] = 1-based index into meshNames, or 0 for "no piece" */
  const owner=new Uint8Array(w*h);
  let overlaps=0;
  meshNames.forEach((name,mi)=>{
    const mesh=visual.getObjectByName(name);
    if(!mesh)return;
    const cov=ihcMeshCoverage([mesh],w,h,null);
    for(let p=0;p<cov.length;p++){
      if(!cov[p])continue;
      if(owner[p]&&owner[p]!==mi+1)overlaps++;
      owner[p]=mi+1;
    }
  });
  const Q=20,buckets=meshNames.map(()=>new Map());
  for(let p=0;p<owner.length;p++){
    const m=owner[p];if(!m)continue;
    const i=p*4;if(src[i+3]<20)continue;
    const r=src[i],g=src[i+1],b=src[i+2];
    const key=(Math.round(r/Q)*Q)+','+(Math.round(g/Q)*Q)+','+(Math.round(b/Q)*Q);
    const bm=buckets[m-1];
    let e=bm.get(key);if(!e){e={count:0,r:0,g:0,b:0};bm.set(key,e);}
    e.count++;e.r+=r;e.g+=g;e.b+=b;
  }
  /* A piece with only one real color in the atlas (the helmet shell, the
     laces, the blade steel) gets ONE zone, not three empty sliders — trailing
     clusters under 1% of the piece are dust (antialiased island edges) and
     stay unrecolored, exactly like `fixed` colors always have. */
  const palettes=meshNames.map((name,mi)=>{
    const def=IHC_PIECES.find(p=>p.mesh===name&&p.splitSide!=='below');
    const clusters=ihcClusterBuckets(buckets[mi],def.zones+2);
    const recolor=clusters.slice(0,def.zones).filter((c,i)=>i===0||c.share>=0.01);
    const fixed=clusters.slice(recolor.length);
    return{recolor,fixed,fixedShare:fixed.reduce((s,c)=>s+c.share,0)};
  });
  const out=new Uint8Array(w*h*4);
  for(let p=0;p<owner.length;p++){
    const m=owner[p];if(!m)continue;
    const o=p*4;if(src[o+3]<20)continue;
    const pal=palettes[m-1];
    const r=src[o],g=src[o+1],b=src[o+2];
    let bestIdx=-1,bestD=Infinity;
    pal.recolor.forEach((c,i)=>{const dr=r-c.color[0],dg=g-c.color[1],db=b-c.color[2];const d=dr*dr+dg*dg+db*db;if(d<bestD){bestD=d;bestIdx=i;}});
    pal.fixed.forEach(c=>{const dr=r-c.color[0],dg=g-c.color[1],db=b-c.color[2];const d=dr*dr+dg*dg+db*db;if(d<bestD){bestD=d;bestIdx=-1;}});
    if(bestIdx===0)out[o]=255;else if(bestIdx===1)out[o+1]=255;else if(bestIdx===2)out[o+2]=255;
    out[o+3]=255;
  }
  const mask=new THREE.DataTexture(out,w,h,THREE.RGBAFormat);
  mask.flipY=false;mask.wrapS=mask.wrapT=THREE.ClampToEdgeWrapping;mask.needsUpdate=true;
  _ihcKitCache={mask,palettes,meshNames,overlaps};
  return _ihcKitCache;
}
/* Builds every body piece's own material + zone list on one loaded player
   visual. `decals` (the shared name/logo/paint atlas textures) is wired into
   EVERY piece, not just the jersey — that's what lets paint and decals show
   up on pants/gloves/skates now that they no longer share the jersey's
   material. Returns {pieceId:{def,zones,material}}. */
function ihcBuildPieceKit(visual,decals){
  const kit=ihcBuildKitMask(visual);
  if(!kit)return{};
  const out={};
  const byMesh={};
  IHC_PIECES.forEach(def=>{(byMesh[def.mesh]=byMesh[def.mesh]||[]).push(def);});
  kit.meshNames.forEach((meshName,mi)=>{
    const mesh=visual.getObjectByName(meshName);
    if(!mesh||!mesh.material)return;
    mesh.material=mesh.material.clone(); // detach from the atlas-wide shared material
    const pal=kit.palettes[mi];
    const defs=byMesh[meshName];
    const primary=defs.find(d=>d.splitSide!=='below')||defs[0];
    const mkZones=def=>{
      const colors=pal.recolor.map(c=>new THREE.Color(c.color[0]/255,c.color[1]/255,c.color[2]/255));
      const zones=pal.recolor.map((c,i)=>({
        label:(def.zoneLabels&&def.zoneLabels[i])||('Zone '+(i+1)),
        color:colors[i],original:'#'+colors[i].getHexString(),share:c.share,
        setColor(hex){colors[i].set(hex);},
      }));
      while(colors.length<3)colors.push(new THREE.Color(0,0,0)); // shader always reads 3
      return{def,zones,colors,material:mesh.material,fixedShare:pal.fixedShare};
    };
    const above=mkZones(primary);
    out[primary.id]=above;
    const belowDef=defs.find(d=>d.splitSide==='below');
    const below=belowDef?mkZones(belowDef):null;
    if(below)out[belowDef.id]=below;
    const pieceDecals=decals?(primary.nameplate?decals
      :{logoMap:decals.logoMap,paintMap:decals.paintMap}):null;
    installRecolorShader(mesh.material,kit.mask,above.colors,pieceDecals,
      below?{y:IHC_SPLIT_Y,colors:below.colors}:null);
  });
  return out;
}

/* Simple single-color tint zone for small dedicated-mesh parts (stick tape) —
   no mask/classification needed since the whole mesh IS the zone; material.color
   multiplies the existing map, so any tape-pattern detail baked into the texture
   still shows through the tint (matches how real tape striping looks). */
/* ============================== STICK ZONES ==============================
   Local-Y (pre-skin, unscaled) below which Plane001 is the BLADE paddle and
   above which it is the bare composite shaft. See IH_STICK_BLADE_Y in
   game.html — same constant, same derivation, keep them in sync.

   Why this is NOT clustered from the texture like every other piece:
   Plane001 and the two tape wraps SHARE one texture, and that texture does
   contain both a black region and a white region — so clustering the whole
   image happily reports a "51% white" cluster and a black one. But Plane001's
   own UVs only ever sample the BLACK region (verified by reading the atlas
   through this mesh's UVs: #010101 at every single vertex, in every band along
   the shaft). The white cluster belongs to the tape meshes. So the "Blade"
   zone got a colour no Plane001 fragment could ever match, its mask coverage
   was empty, and one zone silently owned the entire stick — which is why the
   Blade swatch moved nothing while the Shaft swatch repainted blade and all.

   Geometry decides it instead, reusing the same uSplitY machinery that keeps
   pants and socks independent on the single leg mesh. Profiling Plane001's
   2989 verts in bands along its own axis shows a sharp transition at y~=0.09:
   below it the mesh is dense and irregular (100-136 verts/band, radial std
   0.028-0.074 — the paddle), above it a sparse near-round tube (12-49
   verts/band, std 0.002-0.021). Render-verified: at 0.09 the split lands
   exactly on the heel, by 0.11 it has crept visibly up the shaft. */
const IHC_STICK_BLADE_Y=0.09;
function setupStickZones(material){
  const imgData=getImageDataFromTexture(material.map);
  const src=imgData.data,w=imgData.width,h=imgData.height,out=new Uint8Array(w*h*4);
  for(let p=0;p<w*h;p++){
    const o=p*4;if(src[o+3]<20)continue;
    out[o]=255;out[o+3]=255;             // one zone; geometry does the splitting
  }
  const mask=new THREE.DataTexture(out,w,h,THREE.RGBAFormat);
  mask.flipY=false;mask.wrapS=mask.wrapT=THREE.ClampToEdgeWrapping;mask.needsUpdate=true;
  const shaft=new THREE.Color('#101014'),blade=new THREE.Color('#101014'),unused=new THREE.Color(0,0,0);
  installRecolorShader(material,mask,[shaft,unused,unused],null,
    {y:IHC_STICK_BLADE_Y,colors:[blade,unused,unused]});
  const mk=(label,c)=>({label,color:c,original:'#'+c.getHexString(),share:0.5,
                        setColor(hex){c.set(hex);}});
  return {material,shaft:mk('Shaft',shaft),blade:mk('Blade',blade)};
}

function setupTintZone(material,label){
  return{
    label,
    color:material.color,
    original:'#'+material.color.getHexString(),
    share:1,
    setColor(hex){material.color.set(hex);},
  };
}

/* ============================== JERSEY DECALS ============================== */
const DECAL_SIZE=2048;
const NAME_RECT={x:200,y:1400,w:400,h:150};
const NUMBER_RECT={x:240,y:1530,w:340,h:230};
/* Only web-safe/OS-level font families — no @font-face loading, so no
   network dependency, load-time delay, or licensing question. Canvas text
   silently falls back to a default sans-serif if a name isn't actually
   installed, so these are deliberately common cross-platform choices. */
const JERSEY_FONTS=[
  {id:'Arial',label:'Arial — Standard'},
  {id:'Impact',label:'Impact — Bold Block'},
  {id:'"Arial Narrow",sans-serif',label:'Arial Narrow — Condensed'},
  {id:'"Courier New",monospace',label:'Courier — Retro Blocky'},
  {id:'Georgia,serif',label:'Georgia — Classic Serif'},
  {id:'"Trebuchet MS",sans-serif',label:'Trebuchet — Modern'},
];
function ihcFillRoundedRect(ctx,x,y,w,h,r,color){
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();ctx.fill();
}
function ihcFitText(ctx,text,maxWidth,startSize,minSize,font){
  let size=startSize;
  ctx.font=`bold ${size}px ${font}`;
  while(ctx.measureText(text).width>maxWidth&&size>minSize){size-=4;ctx.font=`bold ${size}px ${font}`;}
  return size;
}
/* Constant letter height regardless of name length — real jerseys never
   shrink the letters for a longer name, they CONDENSE them. Height is 2x the
   11-W worst-case fit (the 1x version made every real name render ~35px —
   unreadably small, per user report); names too wide for the plate at this
   height get squeezed horizontally via ctx.scale instead of dropping the
   font size. Caches are keyed by font since each family has its own metrics. */
const _ihcNameSize={},_ihcNumberSize={};
function ihcFixedNameSize(ctx,maxWidth,font){
  if(_ihcNameSize[font]==null)_ihcNameSize[font]=Math.min(ihcFitText(ctx,'W'.repeat(11),maxWidth,96,22,font)*2,110);
  return _ihcNameSize[font];
}
function ihcFixedNumberSize(ctx,maxWidth,font){
  if(_ihcNumberSize[font]==null)_ihcNumberSize[font]=ihcFitText(ctx,'99',maxWidth,220,40,font);
  return _ihcNumberSize[font];
}
/* One shared draw for the back-of-jersey name/number plate. game.html carries
   a hand-synced ih* copy of this (single-file constraint) — keep them equal. */
function ihcDrawNameNumber(ctx,o){
  ctx.clearRect(0,0,DECAL_SIZE,DECAL_SIZE);
  const font=o.font||'Arial';
  if(o.name){
    const r=NAME_RECT;
    ihcFillRoundedRect(ctx,r.x,r.y,r.w,r.h,18,o.secondary);
    ctx.textAlign='center';ctx.textBaseline='middle';
    const size=ihcFixedNameSize(ctx,r.w-40,font);
    ctx.font=`bold ${size}px ${font}`;
    const squeeze=Math.min(1,(r.w-40)/Math.max(1,ctx.measureText(o.name).width));
    ctx.save();
    ctx.translate(r.x+r.w/2,r.y+r.h/2+2);
    ctx.scale(squeeze,1);
    ctx.lineJoin='round';ctx.lineWidth=Math.max(4,size*0.09);ctx.strokeStyle=o.primary;
    ctx.strokeText(o.name,0,0);
    ctx.fillStyle=o.trim;ctx.fillText(o.name,0,0);
    ctx.restore();
  }
  if(o.number){
    const r=NUMBER_RECT;
    ctx.fillStyle=o.primary;ctx.fillRect(r.x,r.y,r.w,r.h);
    ctx.textAlign='center';ctx.textBaseline='middle';
    const maxSize=ihcFixedNumberSize(ctx,r.w-30,font);
    const size=ihcFitText(ctx,o.number,r.w-30,maxSize,40,font);
    ctx.font=`bold ${size}px ${font}`;
    ctx.lineJoin='round';ctx.lineWidth=Math.max(6,size*0.09);ctx.strokeStyle=o.secondary;
    ctx.strokeText(o.number,r.x+r.w/2,r.y+r.h/2+4);
    ctx.fillStyle=o.trim;ctx.fillText(o.number,r.x+r.w/2,r.y+r.h/2+4);
  }
}

/* ----- stroke / logo replay (shared by editor redraw + menu preview) -----
   A straight line between two consecutive drag samples is only valid when
   the UV mapping is CONTINUOUS between them — crossing a UV seam means two
   3D-adjacent points land far apart in texture space, and connecting them
   painted streaks across unrelated parts of the model. Any UV jump bigger
   than a small fraction of the atlas is treated as a seam crossing and the
   point is stamped in isolation instead of connected. */
const SEAM_JUMP_UV=0.08;
function stampSegment(ctx,x,y,px,py,size,color,opacity,seamJump){
  ctx.globalAlpha=opacity;
  ctx.fillStyle=color;ctx.strokeStyle=color;
  ctx.lineWidth=size;ctx.lineCap='round';ctx.lineJoin='round';
  if(px!=null&&!seamJump){
    ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();
  }else{
    ctx.beginPath();ctx.arc(x,y,size/2,0,Math.PI*2);ctx.fill();
  }
}
/* Where a UV point actually lands on the paint canvas. Mirror ON (default):
   raw UV, unchanged — both sides share the same canvas region, which is
   exactly what makes the mirroring happen "for free" via the mesh's own
   mirrored UV layout. Mirror OFF: the canvas is split into left/right
   HALVES by u — a point's real side decides which half it lands in. The
   shader's pUv remap (installRecolorShader) must stay in exact agreement. */
function ihcPaintCanvasXY(uv,side,mirrorOn){
  if(mirrorOn)return{x:uv.x*DECAL_SIZE,y:uv.y*DECAL_SIZE};
  return{x:(uv.x*0.5+(side>=0?0.5:0))*DECAL_SIZE,y:uv.y*DECAL_SIZE};
}
/* Replays stored stroke lists in order onto ctx (does NOT clear — callers
   clear once, then replay team layers under personal layers). */
function ihcReplayStrokes(ctx,strokes,mirrorOn){
  (strokes||[]).forEach(s=>{
    if(s.visible===false)return;
    let prevXY=null,prev=null;
    s.points.forEach(p=>{
      const xy=ihcPaintCanvasXY(p,p.side,mirrorOn);
      const seamJump=(prev&&Math.hypot(p.x-prev.x,p.y-prev.y)>SEAM_JUMP_UV)||
        (!mirrorOn&&prev&&prev.side!==p.side);
      stampSegment(ctx,xy.x,xy.y,prevXY?prevXY.x:null,prevXY?prevXY.y:null,
        s.size,s.color,s.opacity,seamJump);
      prevXY=xy;prev=p;
    });
  });
  ctx.globalAlpha=1;
}
/* Same idea for placed logo/shape decals; logoLib entries need a loaded .img. */
function ihcReplayDecals(ctx,decals,logoLib,mirrorOn){
  (decals||[]).forEach(d=>{
    if(d.visible===false)return;
    const lib=(logoLib||[]).find(l=>l.id===d.logoId);
    if(!lib||!lib.img||!lib.img.complete||lib.img.naturalWidth===0)return;
    const xy=ihcPaintCanvasXY({x:d.u,y:d.v},d.side,mirrorOn);
    const size=DECAL_SIZE*d.scale;
    ctx.save();
    ctx.translate(xy.x,xy.y);ctx.rotate(d.rotation||0);
    ctx.drawImage(lib.img,-size/2,-size/2,size,size);
    ctx.restore();
  });
}

/* ============================== TEAM STORE ============================== */
/* Local-only team administration: the same person plays both roles (there is
   no server/account system in this game). TEAM data — jersey set designs,
   customization policies, number assignments — lives in ihTeams_v1 and is
   only writable while acting as Team Admin in the Locker Room. PLAYER data —
   name, skin, per-team-per-jersey personal gear tweaks — lives in
   ihPlayerKit_v1. The game itself keeps reading the flat ihGameLoadout_v1
   snapshot it always has; ihtWriteGameLoadout() recomputes that snapshot
   from the favourite team+style whenever anything relevant changes, so
   game.html needs zero knowledge of any of this. */
const IHT_KEY='ihTeams_v1';
const IHT_KIT_KEY='ihPlayerKit_v1';
const IHT_GAME_KEY='ihGameLoadout_v1';
/* The policy matrix: every category a player COULD personalize. League admins
   and team admins can each lock any of them (a lock at either level wins) —
   different teams/leagues genuinely differ on how much individuality they
   tolerate. `false` = locked; absent/true = allowed. */
const IHT_POLICY_CATEGORIES=[
  {id:'stick',      label:'Stick colors & tape',        icon:'🏑',
   note:'Shaft, blade, grip- and blade-tape colors.'},
  {id:'accents',    label:'Personal accent paint & decals',icon:'🎨',
   note:'Small freehand paint/decal accents on pants & gloves. The jersey body, logo and numbers always stay team-controlled.'},
  {id:'helmetStyle',label:'Helmet & visor style',       icon:'⛑️',
   note:'Personal helmet accents today; visor/helmet model choice once alternate assets exist. Helmet base color always follows team colors.'},
  {id:'skates',     label:'Skates & laces',             icon:'⛸️',
   note:'Personal skate accents today; boot/lace colors once the skates get their own colorable zones.'},
];
/* Order matches the editor's stick zone managers: Shaft, Blade, Grip Tape,
   Blade Tape. Only used for contexts the player never opened in the editor. */
const IHT_DEFAULT_STICK=['#101014','#e8e4da','#15161a','#f5f2e8'];

/* A jersey design is per-EQUIPMENT-PIECE now (see IHC_PIECES). `body` — the
   old single Primary/Secondary/Trim triple that used to drive the entire kit
   at once — is still written and read as the jersey's own triple so older
   saves (and anything still reading the flat loadout's `body`) keep working.
   Migration mirrors what the old atlas-wide mask actually did: the helmet
   followed Secondary, the cage/laces/blades followed Trim, and the boots were
   their own baked black — so a pre-per-piece kit comes back looking the same. */
function ihtPiecesFromBody(b){
  const body=(b&&b.length===3)?b:['#020c3d','#4c0a16','#ffffff'];
  return{jersey:body.slice(),pants:body.slice(),socks:body.slice(),
    gloves:[body[0],body[1]],helmet:[body[1]],cage:[body[2]],
    skates:['#000000'],laces:[body[2]],blades:[body[2]]};
}
function ihtDesignPieces(design){
  if(design.pieces)return design.pieces;
  design.pieces=ihtPiecesFromBody(design.body);
  return design.pieces;
}
function ihtDesign(body,font){
  return{body,pieces:ihtPiecesFromBody(body),font:font||'Arial',
    paintStrokes:[],decals:[],paintMirrorOn:true};
}
function ihtSeedStore(){
  /* Migration: whatever look the player had already built in the editor
     becomes their favourite team's home jersey + their personal kit, so
     nothing they made before the team system existed gets lost. */
  let old=null;try{old=JSON.parse(localStorage.getItem(IHT_GAME_KEY));}catch(e){}
  const homeBody=(old&&old.body&&old.body.length===3)?old.body.slice():['#020c3d','#4c0a16','#ffffff'];
  const homeFont=(old&&old.font)||'Arial';
  const oldNumber=(old&&old.number)||'92';
  return{
    v:1,
    leagues:[
      {id:'etela',name:'Etelän Liiga',policy:{}},
    ],
    teams:[
      {id:'wolves',name:'Helsinki Wolves',abbrev:'HEL',leagueId:'etela',
       policy:{},
       jerseys:[
         {id:'home', label:'Home', design:ihtDesign(homeBody,homeFont)},
         {id:'away', label:'Away', design:ihtDesign(['#f2f2f2','#0c2340','#a6192e'])},
         {id:'third',label:'Third',design:ihtDesign(['#0d3b66','#3fa9e6','#ffffff'])},
       ],
       numbersTaken:[4,10,27,63],
       number:{preferred:oldNumber,status:'approved',assigned:oldNumber}},
      /* Bears ship with real locks so the policy system is visible out of the
         box: no personal accents, no helmet personalization on this roster. */
      {id:'bears',name:'Espoo Bears',abbrev:'ESP',leagueId:'etela',
       policy:{accents:false,helmetStyle:false},
       jerseys:[
         {id:'home', label:'Home', design:ihtDesign(['#3b2409','#0f0c08','#e3a72f'])},
         {id:'away', label:'Away', design:ihtDesign(['#efe9dc','#3b2409','#e3a72f'])},
         {id:'third',label:'Third',design:ihtDesign(['#101010','#e3a72f','#ffffff'])},
       ],
       numbersTaken:[9,21,33],
       number:{preferred:'',status:'none',assigned:''}},
      {id:'kings',name:'Tampere Kings',abbrev:'TAM',leagueId:'etela',
       policy:{},
       jerseys:[
         {id:'home', label:'Home', design:ihtDesign(['#26063a','#c0c3cc','#f5f5f7'])},
         {id:'away', label:'Away', design:ihtDesign(['#f4f4f6','#26063a','#b78a2e'])},
         {id:'third',label:'Third',design:ihtDesign(['#0a0a0c','#b78a2e','#26063a'])},
       ],
       numbersTaken:[7,88],
       number:{preferred:'',status:'none',assigned:''}},
    ],
    membership:['wolves','bears','kings'],
    favourite:{teamId:'wolves',jerseyId:'home'},
  };
}
function ihtSeedKit(){
  let old=null;try{old=JSON.parse(localStorage.getItem(IHT_GAME_KEY));}catch(e){}
  const kit={v:1,name:(old&&old.name)||'',skin:(old&&old.neck)||'#c68863',
    defaultStick:(old&&old.stick&&old.stick.length)?old.stick.slice():null,
    contexts:{}};
  if(old&&old.stick&&old.stick.length)kit.contexts['wolves/home']={stick:old.stick.slice()};
  return kit;
}
function ihtSaveStore(s){try{localStorage.setItem(IHT_KEY,JSON.stringify(s));}catch(e){}}
function ihtSaveKit(k){try{localStorage.setItem(IHT_KIT_KEY,JSON.stringify(k));}catch(e){}}
function ihtLoad(){
  let s=null;try{s=JSON.parse(localStorage.getItem(IHT_KEY));}catch(e){}
  if(!s||s.v!==1){s=ihtSeedStore();ihtSaveStore(s);}
  return s;
}
function ihtLoadKit(){
  let k=null;try{k=JSON.parse(localStorage.getItem(IHT_KIT_KEY));}catch(e){}
  if(!k||k.v!==1){k=ihtSeedKit();ihtSaveKit(k);}
  return k;
}
function ihtTeam(s,id){return s.teams.find(t=>t.id===id)||s.teams[0];}
function ihtJersey(t,jid){return t.jerseys.find(j=>j.id===jid)||t.jerseys[0];}
function ihtLeague(s,t){return s.leagues.find(l=>l.id===t.leagueId)||s.leagues[0];}
function ihtMemberTeams(s){return s.membership.map(id=>ihtTeam(s,id));}
/* A category is allowed only if NEITHER the league NOR the team locks it. */
function ihtAllowed(s,t,catId){
  const lg=ihtLeague(s,t);
  if(lg&&lg.policy&&lg.policy[catId]===false)return false;
  if(t.policy&&t.policy[catId]===false)return false;
  return true;
}
function ihtLockSource(s,t,catId){
  const lg=ihtLeague(s,t);
  if(lg&&lg.policy&&lg.policy[catId]===false)return lg.name+' (league)';
  if(t.policy&&t.policy[catId]===false)return t.name+' (team)';
  return null;
}
/* What actually renders on the jersey: only an admin-assigned number. A
   pending/rejected request never shows up on the uniform — team has final say. */
function ihtEffectiveNumber(t){return (t.number&&t.number.assigned)||'';}
function ihtContextKey(teamId,jerseyId){return teamId+'/'+jerseyId;}
/* Merge of team design + player kit for one team+jersey context, in the exact
   flat shape game.html's ihGameLoadout_v1 reader has always consumed (the
   extra team* fields ride along harmlessly for the menu's use). */
function ihtEffectiveLoadout(s,kit,teamId,jerseyId){
  const t=ihtTeam(s,teamId),j=ihtJersey(t,jerseyId);
  const ctx=(kit.contexts&&kit.contexts[ihtContextKey(t.id,j.id)])||{};
  return{
    v:1,
    body:j.design.body.slice(),
    pieces:JSON.parse(JSON.stringify(ihtDesignPieces(j.design))),
    paint:{strokes:j.design.paintStrokes||[],decals:j.design.decals||[],
           accStrokes:ctx.accStrokes||[],accDecals:ctx.accDecals||[],
           mirror:j.design.paintMirrorOn!==false},
    neck:kit.skin||'#c68863',
    stick:(ctx.stick||kit.defaultStick||IHT_DEFAULT_STICK).slice(),
    name:kit.name||'',
    number:ihtEffectiveNumber(t),
    font:j.design.font||'Arial',
    teamId:t.id,teamName:t.name,teamAbbrev:t.abbrev,
    jerseyId:j.id,jerseyLabel:j.label,
  };
}
function ihtWriteGameLoadout(s,kit){
  try{
    localStorage.setItem(IHT_GAME_KEY,
      JSON.stringify(ihtEffectiveLoadout(s,kit,s.favourite.teamId,s.favourite.jerseyId)));
  }catch(e){}
}
