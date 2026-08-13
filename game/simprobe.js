/* simprobe.js — headless check of the SIMULATION-FIRST contract.
 * Appended to a copy of ice_hockey.html by simprobe.sh; reports back through
 * fetch('/PROBE?...') so the numbers land in the python http.server access log
 * (see armtest/probe.sh for the same trick).
 *
 * It asserts the four things the architecture is supposed to guarantee:
 *   1  input moves the SIM on the very first frame, with no animation gating
 *   2  the indicator and the model are both exactly at player.pos
 *   3  the gameplay stick target is input-derived, and the rendered blade is
 *      free to disagree (that gap is measured, not eliminated)
 *   4  possession is a spectrum: it builds, weakens under load, and breaks
 *      into free-puck physics without a teleport
 */
(function(){
  const OUT=[];
  const log=(k,v)=>OUT.push(k+'='+v);
  const fail=[];
  const chk=(name,ok,detail)=>{OUT.push((ok?'PASS ':'FAIL ')+name+(detail?' :: '+detail:''));if(!ok)fail.push(name);};
  const num=n=>(Math.round(n*1000)/1000);

  /* A per-frame throw inside tick() used to be fatal to the whole probe, in the
     most misleading way possible: frame() catches it and pushes a TICKERR line,
     so 1200+ swept frames pushed 1200+ lines, the report URL blew past the
     server's request-line limit, and the run reported NOTHING AT ALL — which
     reads exactly like "the page never booted" rather than "the game threw on
     every frame". So collapse repeats and hard-cap the payload. */
  function tickErr(msg){
    const k='TICKERR='+msg;
    if(!tickErr.seen)tickErr.seen={};
    if(tickErr.seen[k]===undefined){tickErr.seen[k]=0;OUT.push(k);}
    tickErr.seen[k]++;
  }
  function report(){
    if(tickErr.seen)for(const k in tickErr.seen)
      if(tickErr.seen[k]>1)OUT.push(k.replace('TICKERR=','TICKERR x'+tickErr.seen[k]+'='));
    OUT.push('FAILURES='+fail.length);
    let body=OUT.join('\n');
    if(body.length>5000)body=body.slice(0,2500)+'\n...[TRUNCATED]...\n'+body.slice(-2500);
    const q='/PROBE?'+encodeURIComponent(body);
    fetch(q).catch(()=>{});
    setTimeout(()=>{try{fetch(q);}catch(e){}},300);
  }
  window.addEventListener('error',e=>{OUT.push('JSERROR='+e.message+' @'+e.lineno);report();});

  /* ---- drive the game deterministically ------------------------------
     headless rAF is throttled to ~3fps, so the page's own tick() loop is
     useless as a clock. Kill the rAF chain, pin the delta, and step tick()
     by hand: one call == one frame at exactly 1/60 s. */
  let stepping=false;
  function takeOverClock(){
    if(stepping)return;stepping=true;
    window.requestAnimationFrame=function(){return 0;};
    clock.getDelta=function(){return 1/60;};
  }
  const frame=()=>{try{tick();}catch(e){tickErr(e.message);}};
  const run=n=>{for(let i=0;i<n;i++)frame();};

  const K=(k,v)=>{keys[k]=v;};
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

  boot(function(){
    /* ============ 1. INPUT -> SIMULATION, SAME FRAME ==================== */
    clearKeys();run(40);
    const h0=player.heading,v0=player.vel.length();
    K('w',true);K('a',true);
    frame();                               // exactly ONE frame of input
    const dH=Math.abs(player.heading-h0),dV=player.vel.length()-v0;
    log('firstFrame.dHeading',num(dH));
    log('firstFrame.dSpeed',num(dV));
    chk('input turns the sim on frame 1',dH>1e-4,'dHeading='+num(dH)+' rad');
    chk('input accelerates the sim on frame 1',dV>1e-4,'dSpeed='+num(dV)+' m/s');

    /* nothing may gate that on an animation: force the mixer to a state where
       no action is playing and confirm the sim still responds identically */
    clearKeys();run(30);
    const savedMixer=player.mixer;player.mixer=null;
    const h1=player.heading;K('w',true);K('a',true);frame();
    const dHnoAnim=Math.abs(player.heading-h1);
    player.mixer=savedMixer;clearKeys();run(20);
    log('noAnim.dHeading',num(dHnoAnim));
    chk('sim response is independent of the animation system',
        dHnoAnim>1e-4&&Math.abs(dHnoAnim-dH)<Math.max(1e-3,dH*0.35),
        'withAnim='+num(dH)+' withoutAnim='+num(dHnoAnim));

    /* ============ 2. INDICATOR == SIMULATION =========================== */
    K('w',true);run(90);
    const modelErr=player.root.position.distanceTo(player.pos);
    const ringErr=Math.hypot(reachRing.position.x-player.pos.x,reachRing.position.z-player.pos.z);
    log('modelErr',num(modelErr));log('ringErr',num(ringErr));
    chk('model root is AT the simulation position',modelErr<1e-6,num(modelErr)+' m');
    chk('indicator ring is AT the simulation position',ringErr<1e-6,num(ringErr)+' m');
    log('speed.atSample',num(player.vel.length()));

    /* ============ 3. STICK: SIM TARGET vs RENDERED BLADE =============== */
    /* horizontally identical; the tip is lifted to puck height so every range
       gate measures against a puck sitting on the ice rather than 6 cm under it */
    const tgtErr=Math.hypot(player.stickTip.x-player.stickTarget.x,
                            player.stickTip.z-player.stickTarget.z);
    log('stickTip.vs.stickTarget.horiz',num(tgtErr));
    log('stickTip.yLift',num(player.stickTip.y-player.stickTarget.y));
    chk('gameplay stick tip IS the input-derived target',tgtErr<1e-6,num(tgtErr)+' m');
    /* the target must sit at the configured reach, not wherever the clip put
       the fists — that is the whole point of the split */
    const F=fwd(player.heading);
    const fwdReach=player.stickTarget.clone().sub(player.pos).dot(F);
    log('target.fwdReach',num(fwdReach));log('CONFIG.iceBaseFwd',CONFIG.iceBaseFwd);
    chk('neutral target sits at iceBaseFwd',Math.abs(fwdReach-CONFIG.iceBaseFwd)<0.25,
        num(fwdReach)+' vs '+CONFIG.iceBaseFwd);
    log('stickVisErr',num(player.stickVisErr||0));
    chk('rendered blade is measured, not asserted',typeof player.stickVisErr==='number',
        'presentation debt '+num(player.stickVisErr||0)+' m');

    /* ---- how well does the PRESENTATION track the sim target? -----------
       Sweep the skill stick across the whole reach envelope and record the
       gap at each stop, for both neutral references. This is the animation's
       debt to the simulation; it is allowed to be non-zero, but it is the
       number that says whether the puck looks like it is on the blade. */
    /* Driven through the REAL anchored-skill-stick path — cursor offset from
       the anchor, exactly what a player's hand produces — not by writing
       currentAim, which updatePlayer would overwrite from input on the very
       next frame anyway. ssHoldT is pinned to 0 so the anchor's idle drift
       cannot creep the deflection away mid-sample. */
    function sweep(){
      const errs=[];
      const saveSS=skillStickOn,saveMouse=mouseCtl.active;
      skillStickOn=true;mouseCtl.active=true;
      const R=Math.max(40,CONFIG.ssRadiusFrac*Math.min(innerWidth,innerHeight));
      ssAnchor.x=innerWidth/2;ssAnchor.y=innerHeight/2;
      clearKeys();player.vel.set(0,0,0);run(20);player.vel.set(0,0,0);
      let uNow=0;
      for(let i=0;i<=8;i++){
        const u=-1+i*0.25;
        /* EASE the cursor across, do not teleport it. A 70 px jump in one
           frame is a swipe as far as the gesture/deke detectors are concerned,
           and a probe that trips the systems it is measuring reports its own
           artifacts. 40 frames of ramp, then 30 parked. */
        for(let f=0;f<40;f++){
          uNow+=(u-uNow)*0.12;
          mouseClientX=ssAnchor.x+uNow*R;mouseClientY=ssAnchor.y;
          ssHoldT=0;player.vel.set(0,0,0);frame();
        }
        for(let f=0;f<30;f++){
          uNow=u;
          mouseClientX=ssAnchor.x+u*R;mouseClientY=ssAnchor.y;
          ssHoldT=0;player.vel.set(0,0,0);frame();
        }
        errs.push({u:u,e:player.stickVisErr||0,
          st:(player.shotType||'none')+'/'+num(player.handleBlend||0)
            +'/td'+num(player.toeDragT||0)+'/rb'+num(reachBoostMul)});
      }
      skillStickOn=saveSS;mouseCtl.active=saveMouse;
      const vals=errs.map(x=>x.e);
      return{max:Math.max.apply(null,vals),
             mean:vals.reduce((a,b)=>a+b,0)/vals.length,
             per:errs.map(x=>x.u.toFixed(2)+':'+num(x.e)).join(' '),
             state:errs.map(x=>x.u.toFixed(2)+'['+x.st+']').join(' ')};
    }
    const wasNeutral=CONFIG.handleNeutralClip;
    CONFIG.handleNeutralClip=1;const A=sweep();
    CONFIG.handleNeutralClip=0;const B=sweep();
    CONFIG.handleNeutralClip=wasNeutral;
    log('sweep.clipNeutral.mean',num(A.mean));log('sweep.clipNeutral.max',num(A.max));
    log('sweep.clipNeutral.per',A.per);
    log('sweep.clipNeutral.state',A.state);
    log('sweep.oldNeutral.mean',num(B.mean));log('sweep.oldNeutral.max',num(B.max));
    log('sweep.oldNeutral.per',B.per);
    chk('clip-referenced neutral closes the sim/visual gap',A.mean<B.mean,
        'mean '+num(B.mean)+' -> '+num(A.mean)+' m');
    /* and the animation must NOT be able to move gameplay: freeze the sim
       target, hand-move the rendered blade, confirm nothing gameplay-side moves */
    const tipBefore=player.stickTip.clone();
    player.stickVis.x+=5;
    const tipAfter=player.stickTip.clone();
    chk('moving the rendered blade does not move gameplay',
        tipBefore.distanceTo(tipAfter)<1e-9,'stickTip unmoved');

    /* ============ 4. POSSESSION AS A SPECTRUM ========================== */
    clearKeys();player.vel.set(0,0,0);run(40);player.vel.set(0,0,0);
    /* control just above ctrlMin — NOT 0: updatePuck's normaliser reads a
       zero control under possessed as "granted externally" and hands back a
       full carry, which is correct for faceoffs and wrong for this test */
    puck.possessed=true;puck.control=0.15;puck.noPickupT=0;
    puck.pos.copy(player.stickTip);puck.pos.y=CONFIG.puckRadius;puck.vel.set(0,0,0);
    const cLow=puck.control;
    run(90);player.vel.set(0,0,0);run(30);
    const cHigh=puck.control;
    log('control.settled',num(cHigh));
    log('puckOffset.settled',num(puck.pos.distanceTo(player.stickTip)));
    chk('control BUILDS toward a tight carry at rest',cHigh>cLow&&cHigh>0.9,
        num(cLow)+' -> '+num(cHigh));

    /* under load — full speed into a hard carve — the bond must weaken */
    K('w',true);run(120);
    K('a',true);run(45);
    const cTurn=puck.control,offTurn=puck.pos.distanceTo(player.stickTip);
    log('control.hardTurn',num(cTurn));log('puckOffset.hardTurn',num(offTurn));
    log('yawRate.hardTurn',num(Math.abs(player.skate.angVel)));
    chk('control weakens under speed + carve',cTurn<cHigh,
        num(cHigh)+' -> '+num(cTurn));
    chk('the puck actually lags the target while loose',offTurn>0.05,num(offTurn)+' m');

    /* an extreme event breaks it, and the puck stays a real object */
    clearKeys();run(40);
    puck.possessed=true;puck.control=1;puck.noPickupT=0;
    puck.pos.copy(player.stickTip);puck.pos.y=CONFIG.puckRadius;
    const pv=player.vel.clone();
    /* shove it well past ctrlBreakDist — no teleport is allowed on the break */
    puck.pos.addScaledVector(fwd(player.heading),CONFIG.ctrlBreakDist+0.6);
    const posBefore=puck.pos.clone();
    frame();
    const broke=!puck.possessed;
    const jump=puck.pos.distanceTo(posBefore);
    log('break.jump',num(jump));log('break.controlAfter',num(puck.control));
    chk('an out-of-range puck breaks possession',broke,'possessed='+puck.possessed);
    chk('the break does not teleport the puck',jump<0.6,num(jump)+' m in one frame');
    run(60);
    chk('a broken puck runs on free physics',!puck.possessed||puck.control<1,
        'possessed='+puck.possessed+' control='+num(puck.control));

    /* reception opens WEAK, it does not snap to a full carry */
    clearKeys();
    puck.possessed=false;puck.control=0;puck.noPickupT=0;puck.outOfPlay=false;
    puck.pos.copy(player.pos).addScaledVector(fwd(player.heading),0.6);
    puck.pos.y=CONFIG.puckRadius;
    puck.vel.copy(fwd(player.heading)).multiplyScalar(-CONFIG.pickupSpeed*0.8);
    let caught=0;
    for(let i=0;i<30&&!puck.possessed;i++){frame();caught++;}
    const cCatch=puck.control;
    log('control.onCatch',num(cCatch));log('framesToCatch',caught);
    chk('a hard reception starts LOW on the spectrum',
        !puck.possessed||(cCatch>0&&cCatch<0.6),num(cCatch));

    /* ============ 5. RELEASE IMPARTS VELOCITY, IT DOES NOT MOVE THE PUCK ===
       The carry deliberately lets the puck lag the target, so the release point
       has to be the puck's OWN position. Park a carry, drag the puck off the
       target by hand, shoot, and confirm the puck left from where it was rather
       than being snapped onto the blade point first. */
    clearKeys();player.vel.set(0,0,0);run(40);player.vel.set(0,0,0);
    puck.possessed=true;puck.control=1;puck.noPickupT=0;puck.outOfPlay=false;
    puck.pos.copy(player.stickTip);puck.pos.y=CONFIG.puckRadius;puck.vel.set(0,0,0);
    run(30);player.vel.set(0,0,0);
    /* offset well inside ctrlBreakDist so the bond is intact and this is a
       genuine shot off a loose carry, not a shot after a break */
    const lag=fwd(player.heading).multiplyScalar(-0.7);
    puck.pos.add(lag);
    const shotFrom=puck.pos.clone();
    const tgtAtShot=player.stickTip.clone();
    const gap=shotFrom.distanceTo(tgtAtShot);
    log('shot.puckLagAtRelease',num(gap));
    let fired=false;
    try{fireShot('wrist');fired=true;}catch(e){OUT.push('SHOOTERR='+e.message);}
    log('shot.fired',String(fired));
    if(fired){
      const jumpOnRelease=puck.pos.distanceTo(shotFrom);
      log('shot.posJumpOnRelease',num(jumpOnRelease));
      log('shot.speed',num(puck.vel.length()));
      log('shot.possessedAfter',String(puck.possessed));
      log('shot.controlAfter',num(puck.control));
      chk('the shot does not teleport the puck onto the blade',
          jumpOnRelease<0.05,num(jumpOnRelease)+' m (lag was '+num(gap)+' m)');
      chk('the shot actually imparts velocity',puck.vel.length()>5,
          num(puck.vel.length())+' m/s');
      chk('shooting ends the possession relationship',
          !puck.possessed&&puck.control===0,
          'possessed='+puck.possessed+' control='+num(puck.control));
      chk('the puck stays on the ice through the release',
          puck.pos.y>=CONFIG.puckRadius-1e-9,num(puck.pos.y)+' m');
    }

    /* the puck's own indicator tracks its true ground projection.
       MEASURE IT AFTER A FRAME. The shadow is written from puck.pos at the end
       of updatePuck, so it is a readout of the last SIMULATED frame — and the
       section above deliberately teleports puck.pos by hand (the 0.7 m release
       lag) without stepping one. Measuring straight after that hand-move scored
       a 0.7 m "shadow error" that was exactly the injected lag: the probe
       reading its own artifact, not a presentation bug. Both numbers are
       reported so the staleness stays visible rather than being asserted away —
       if `afterFrame` is ever non-zero, THAT is a real defect. */
    const shErrStale=Math.hypot(puck.shadow.position.x-puck.pos.x,puck.shadow.position.z-puck.pos.z);
    frame();
    const shErr=Math.hypot(puck.shadow.position.x-puck.pos.x,puck.shadow.position.z-puck.pos.z);
    log('puckShadowErr.staleSameFrame',num(shErrStale));
    log('puckShadowErr.afterFrame',num(shErr));
    chk('puck shadow is the exact ground projection',shErr<1e-6,num(shErr)+' m');

    report();
  });
})();
