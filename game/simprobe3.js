/* simprobe3.js — is the 2.08 m stick gap REAL, or is it a probe artifact?
 *
 * simprobe2 established the mesh sampling is exact (logicalTip.vs.meshBlade = 0)
 * and that the shaft sits 93.3 deg off the target direction, which is
 * handleMaxAngle (1.60 rad) — i.e. the correction is being clamped and the raw
 * requirement is ~185 deg. Before believing the game looks that broken, rule out
 * the obvious harness explanation: that the base64 clips had not finished
 * loading/binding, leaving the arms in bind pose.
 *
 * So this reports the ANIMATION STATE alongside the geometry, and posts a real
 * screenshot. Render + toDataURL happen in ONE synchronous block, which is what
 * makes a WebGL canvas hand back actual pixels.
 */
(function(){
  const OUT=[];
  const log=(k,v)=>OUT.push(k+'='+v);
  const num=n=>(Math.round(n*1000)/1000);
  function report(){
    fetch('/PROBE?'+encodeURIComponent(OUT.join('\n'))).catch(()=>{});
    setTimeout(()=>{try{fetch('/PROBE?'+encodeURIComponent(OUT.join('\n')));}catch(e){}},300);
  }
  window.addEventListener('error',e=>{OUT.push('JSERROR='+e.message+' @'+e.lineno);report();});

  let stepping=false;
  function takeOverClock(){
    if(stepping)return;stepping=true;
    window.requestAnimationFrame=function(){return 0;};
    clock.getDelta=function(){return 1/60;};
  }
  const frame=()=>{try{tick();}catch(e){OUT.push('TICKERR='+e.message);}};
  const run=n=>{for(let i=0;i<n;i++)frame();};
  function clearKeys(){for(const k in keys)keys[k]=false;}

  /* ---- what is the animation system actually doing right now? ---- */
  function animState(tag){
    log(tag+'.mixer',String(!!player.mixer));
    let acts=0,live=[],bound=0;
    try{
      if(player.mixer&&player.mixer._actions){
        acts=player.mixer._actions.length;
        for(const a of player.mixer._actions){
          const w=a.getEffectiveWeight();
          if(w>0.001)live.push((a._clip&&a._clip.name||'?')+'@w'+num(w)+'t'+num(a.time));
        }
      }
      if(typeof A!=='undefined'&&A){
        for(const k in A)if(A[k])bound++;
      }
    }catch(e){log(tag+'.animErr',e.message);}
    log(tag+'.actions',acts);
    log(tag+'.clipsBound',bound);
    log(tag+'.playing',live.length?live.join(' | '):'NONE');
  }

  /* is the arm actually posed, or sitting at bind? compare a hand bone's world
     position against the rest/bind position of the same bone */
  function armState(tag){
    try{
      const names=['hand_r','handR','hand_l','handL','forearmR','lowerarm_r'];
      let found=0;
      player.root.traverse(o=>{
        if(!o.isBone)return;
        if(names.indexOf(o.name)<0)return;
        found++;
        const w=new THREE.Vector3();o.getWorldPosition(w);
        const rel=w.clone().sub(player.pos);
        const F=fwd(player.heading),R=right(player.heading);
        log(tag+'.bone.'+o.name+'.fwd',num(rel.dot(F)));
        log(tag+'.bone.'+o.name+'.lat',num(rel.dot(R)));
        log(tag+'.bone.'+o.name+'.up',num(rel.y));
      });
      log(tag+'.bonesFound',found);
    }catch(e){log(tag+'.armErr',e.message);}
  }

  /* geometry of the shaft vs the target, and the angle between them */
  function shaftState(tag){
   try{
    const F=fwd(player.heading),R=right(player.heading);
    const grip=player.stickGrip.clone();
    const tip=grip.clone().addScaledVector(player.stickDir,CONFIG.stickLen-CONFIG.snapAlong);
    const toTip=tip.clone().sub(grip).normalize();
    const toTgt=player.stickTip.clone().sub(grip).normalize();
    const ang=Math.acos(Math.max(-1,Math.min(1,toTip.dot(toTgt))));
    log(tag+'.shaftVsTarget.deg',num(ang*180/Math.PI));
    log(tag+'.shaftVsTarget.rad',num(ang));
    log(tag+'.handleMaxAngle',CONFIG.handleMaxAngle);
    log(tag+'.handleBlend',num(player.handleBlend||0));
    log(tag+'.tip.up',num(tip.y));
    log(tag+'.err',num(player.stickVisErr||0));
   }catch(e){log(tag+'.shaftErr',e.message);}
  }

  function shoot(name,cb){
    /* render and read back in ONE synchronous block */
    let url=null;
    try{
      log('shot.'+name+'.attempt','1');
      renderer.render(scene,camera);
      url=renderer.domElement.toDataURL('image/png');
    }catch(e){log('shotErr.'+name,e.message);}
    if(!url){log('shot.'+name,'NO URL');report();cb();return;}
    log('shot.'+name+'.bytes',url.length);
    report();
    /* never let a failed/slow POST strand the rest of the run */
    let done=false;
    const go=()=>{if(!done){done=true;cb();}};
    setTimeout(go,8000);
    fetch('/shot?'+name,{method:'POST',body:url})
      .then(()=>{log('shot.'+name,'POSTED');go();})
      .catch(e=>{log('postErr.'+name,e.message);go();});
  }

  function boot(cb){
    let tries=0;
    (function wait(){
      const btn=document.querySelector('#smStart');
      if(player&&puck&&btn){btn.click();setTimeout(()=>{takeOverClock();run(30);cb();},250);return;}
      if(++tries>200){OUT.push('BOOT TIMEOUT');report();return;}
      setTimeout(wait,50);
    })();
  }

  /* report after EVERY phase. The first attempt at this probe hung somewhere
     between boot and the first screenshot and reported nothing at all, which
     said only "it died". simprobe.sh takes the LAST /PROBE line, so reporting
     incrementally costs nothing and the final line is still the complete run —
     but if it dies again, the last line names the phase it reached. */
  function phase(n,fn){
    OUT.push('--- phase '+n+' ---');
    try{fn();}catch(e){log('phase'+n+'.threw',e.message);}
    report();
  }

  boot(function(){
    phase('1-early',function(){
      /* EARLY: same moment simprobe2 sampled */
      clearKeys();player.vel.set(0,0,0);run(60);player.vel.set(0,0,0);run(10);
      animState('early');armState('early');shaftState('early');
    });

    /* LATE: give the async base64 clip load every chance to land, in real time
       (not stepped frames — loading is not driven by tick()) */
    setTimeout(function(){
      phase('2-late',function(){
        run(60);player.vel.set(0,0,0);run(10);
        animState('late');armState('late');shaftState('late');
      });
      phase('3-skating',function(){
        /* while actually skating, which is when a clip is certainly playing */
        clearKeys();keys['w']=true;run(120);
        animState('skating');shaftState('skating');
        log('skating.speed',num(player.vel.length()));
      });
      shoot('skating',function(){
        phase('4-carry',function(){
          clearKeys();player.vel.set(0,0,0);run(60);player.vel.set(0,0,0);
          /* carrying, standing still — the readable "is the puck on the blade" shot */
          puck.possessed=true;puck.control=1;puck.noPickupT=0;
          puck.pos.copy(player.stickTip);puck.pos.y=CONFIG.puckRadius;puck.vel.set(0,0,0);
          run(60);player.vel.set(0,0,0);run(20);
          animState('carry');shaftState('carry');
          log('carry.puck.to.visBlade',num(puck.pos.distanceTo(player.stickVis)));
        });
        shoot('carry',function(){OUT.push('DONE');report();});
      });
    },3000);
  });
})();
