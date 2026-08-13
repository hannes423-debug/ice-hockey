/* simprobe2.js — decompose the sim/visual stick gap.
 * simprobe.js reports stickVisErr as one number (mean 1.59 m over the reach
 * sweep, but only 0.415 m on a plain standing sample). That difference has two
 * very different explanations and they need separating, because since the split
 * the TARGET is gameplay truth:
 *   a) the target is sane and the ARMS cannot follow it   -> presentation debt
 *   b) the skill-stick path is throwing the target somewhere absurd -> that is
 *      now a GAMEPLAY bug (poke reach, pickup and shot gates all measure it)
 * So log both radii from the pelvis at every stop, not just the distance
 * between them.
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

  function boot(cb){
    let tries=0;
    (function wait(){
      const btn=document.querySelector('#smStart');
      if(player&&puck&&btn){btn.click();setTimeout(()=>{takeOverClock();run(30);cb();},250);return;}
      if(++tries>200){OUT.push('BOOT TIMEOUT');report();return;}
      setTimeout(wait,50);
    })();
  }

  /* one sample, fully described, in the player's own frame.
     Logs the LOGICAL tip (grip + dir*shaft, what the handle layer aimed) next
     to the MESH blade (what stickVis samples). If those two disagree the fault
     is in the mesh placement / blade anchor; if they agree, the handle layer
     genuinely aimed the shaft there and it is a posing fault. */
  function sample(tag){
    const F=fwd(player.heading),R=right(player.heading);
    const t=player.stickTarget.clone().sub(player.pos);
    const v=player.stickVis?player.stickVis.clone().sub(player.pos):new THREE.Vector3();
    if(player.stickDir&&player.stickGrip){
      const lg=player.stickGrip.clone().sub(player.pos);
      const lt=player.stickGrip.clone()
        .addScaledVector(player.stickDir,CONFIG.stickLen-CONFIG.snapAlong).sub(player.pos);
      log(tag+'.grip.fwd',num(lg.dot(F)));
      log(tag+'.grip.lat',num(lg.dot(R)));
      log(tag+'.grip.up',num(lg.y));
      log(tag+'.logicalTip.fwd',num(lt.dot(F)));
      log(tag+'.logicalTip.lat',num(lt.dot(R)));
      log(tag+'.logicalTip.up',num(lt.y));
      log(tag+'.logicalTip.vs.meshBlade',
        num(player.stickGrip.clone()
          .addScaledVector(player.stickDir,CONFIG.stickLen-CONFIG.snapAlong)
          .distanceTo(player.stickVis)));
      log(tag+'.logicalTip.vs.target',
        num(player.stickGrip.clone()
          .addScaledVector(player.stickDir,CONFIG.stickLen-CONFIG.snapAlong)
          .distanceTo(player.stickTip)));
    }
    log(tag+'.target.fwd',num(t.dot(F)));
    log(tag+'.target.lat',num(t.dot(R)));
    log(tag+'.target.r',num(Math.hypot(t.dot(F),t.dot(R))));
    log(tag+'.vis.fwd',num(v.dot(F)));
    log(tag+'.vis.lat',num(v.dot(R)));
    log(tag+'.vis.r',num(Math.hypot(v.dot(F),v.dot(R))));
    log(tag+'.err',num(player.stickVisErr||0));
  }

  boot(function(){
    log('CONFIG.iceBaseFwd',CONFIG.iceBaseFwd);
    log('CONFIG.reachRadius',CONFIG.reachRadius);
    log('CONFIG.pickupRadius',CONFIG.pickupRadius);
    log('CONFIG.stickLen',CONFIG.stickLen);
    log('CONFIG.handleMaxAngle',CONFIG.handleMaxAngle);
    log('CONFIG.handleAuthority',CONFIG.handleAuthority);

    /* ---- A: standing still, no skill stick, nothing touched ---- */
    clearKeys();player.vel.set(0,0,0);run(60);player.vel.set(0,0,0);run(10);
    log('A.skillStickOn',String(typeof skillStickOn!=='undefined'&&skillStickOn));
    log('A.mouseActive',String(mouseCtl&&mouseCtl.active));
    log('A.handleBlend',num(player.handleBlend||0));
    sample('A');

    /* ---- B: the exact sweep conditions simprobe uses, at u=0 ---- */
    const saveSS=skillStickOn,saveMouse=mouseCtl.active;
    skillStickOn=true;mouseCtl.active=true;
    const Rpx=Math.max(40,CONFIG.ssRadiusFrac*Math.min(innerWidth,innerHeight));
    ssAnchor.x=innerWidth/2;ssAnchor.y=innerHeight/2;
    for(let f=0;f<70;f++){
      mouseClientX=ssAnchor.x;mouseClientY=ssAnchor.y;
      ssHoldT=0;player.vel.set(0,0,0);frame();
    }
    log('B.handleBlend',num(player.handleBlend||0));
    log('B.ssMag',num(typeof ssMag!=='undefined'?ssMag:-1));
    sample('B');

    /* ---- C: full lateral sweep, both radii at every stop ---- */
    let uNow=0;
    for(let i=0;i<=8;i++){
      const u=-1+i*0.25;
      for(let f=0;f<40;f++){
        uNow+=(u-uNow)*0.12;
        mouseClientX=ssAnchor.x+uNow*Rpx;mouseClientY=ssAnchor.y;
        ssHoldT=0;player.vel.set(0,0,0);frame();
      }
      for(let f=0;f<30;f++){
        uNow=u;mouseClientX=ssAnchor.x+u*Rpx;mouseClientY=ssAnchor.y;
        ssHoldT=0;player.vel.set(0,0,0);frame();
      }
      sample('C'+u.toFixed(2));
    }
    skillStickOn=saveSS;mouseCtl.active=saveMouse;

    /* ---- D: is the puck visually ON the rendered blade while carrying? ----
       This is the question the player actually sees. The carry spring pulls the
       puck to the TARGET, so if the rendered blade is elsewhere the puck rides
       next to a stick that is not touching it. */
    clearKeys();player.vel.set(0,0,0);run(40);player.vel.set(0,0,0);
    puck.possessed=true;puck.control=1;puck.noPickupT=0;
    puck.pos.copy(player.stickTip);puck.pos.y=CONFIG.puckRadius;puck.vel.set(0,0,0);
    run(90);player.vel.set(0,0,0);run(20);
    log('D.control',num(puck.control));
    log('D.puck.to.target',num(puck.pos.distanceTo(player.stickTip)));
    log('D.puck.to.visBlade',num(player.stickVis?puck.pos.distanceTo(player.stickVis):-1));
    sample('D');

    report();
  });
})();
