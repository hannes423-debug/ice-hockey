/* packprobe.js — headless check of the 2026-08-15 animation pack.
 * Injected into a copy of ice_hockey.html by packprobe.sh; reports through
 * fetch('/PROBE?...') so the result lands in the http.server access log.
 *
 * Asserts, in order:
 *   1  the payload carries all 28 clips and every new one has real keys
 *   2  every new binding in attachSkaterClips resolved to an action
 *   3  stanceWanted's hysteresis holds a lean parked on the boundary
 *   4  a lean crossing the band plays the CORRECT transition clip, and the
 *      stance machine ends up in the destination stance
 *   5  a transition is not re-fired while one is already running
 *   6  the swing tiers pick windmill vs spinorama, on the correct side
 *   7  the moves hand the arms to the clip (handleBlend falls to 0)
 */
(function(){
  const OUT=[];const fail=[];
  const chk=(n,ok,d)=>{OUT.push((ok?'PASS ':'FAIL ')+n+(d?' :: '+d:''));if(!ok)fail.push(n);};
  const num=n=>(Math.round(n*1000)/1000);
  function report(){
    OUT.push('FAILURES='+fail.length);
    let b=OUT.join('\n');
    if(b.length>5000)b=b.slice(0,2500)+'\n...[TRUNCATED]...\n'+b.slice(-2500);
    const q='/PROBE?'+encodeURIComponent(b);
    fetch(q).catch(()=>{});setTimeout(()=>{try{fetch(q);}catch(e){}},300);
  }
  window.addEventListener('error',e=>{OUT.push('JSERROR='+e.message+' @'+e.lineno);report();});

  let stepping=false;
  function takeOverClock(){
    if(stepping)return;stepping=true;
    window.requestAnimationFrame=function(){return 0;};
    clock.getDelta=function(){return 1/60;};
  }
  const frame=()=>{try{tick();}catch(e){OUT.push('TICKERR='+e.message);}};

  const NEW11=['IdleForeHandPulledBack','IdleNeutralToForeHand','IdleNeutralToBackHand',
    'IdleForeHandToNeutral','IdleForeHandToBackHand','IdleBackHandToNeutral',
    'IdleBackHandToForeHand','WindmillDekeL','WindmillDekeR','SpinoramaL','SpinoramaR'];

  /* `player`, `puck` and `SKATER_CLIPS` are `let` globals — they are NOT on
     window, so window.player waits forever. Test them bare, and click the
     start menu, exactly as simprobe.js does. */
  function boot(cb){
    let tries=0;
    (function wait(){
      const btn=document.querySelector('#smStart');
      if(typeof player!=='undefined'&&player&&typeof puck!=='undefined'&&puck&&btn){
        btn.click();setTimeout(()=>{takeOverClock();for(let i=0;i<30;i++)frame();cb();},250);return;
      }
      if(++tries>200){OUT.push('BOOT TIMEOUT');report();return;}
      setTimeout(wait,50);
    })();
  }

  function go(){
    if(!player.mixer){OUT.push('NO MIXER — payload did not attach');report();return;}

    /* ---- 1  payload ---- */
    const clips=(typeof SKATER_CLIPS!=='undefined'&&SKATER_CLIPS)?SKATER_CLIPS:[];
    const names=clips.map(c=>c.name);
    chk('payload_28_clips',clips.length===28,'got '+clips.length);
    let missing=NEW11.filter(n=>names.indexOf(n)<0);
    chk('payload_has_all_11_new',missing.length===0,'missing '+missing.join(','));
    /* every new clip must carry real animation, not a single static key. The
       08-04 lesson: "duration 0.000 + 1 key is a static pose, not a clip". */
    let statics=[];
    for(const n of NEW11){
      const c=clips.find(x=>x.name===n);
      if(!c)continue;
      const keys=c.tracks.reduce((a,t)=>a+t.times.length,0);
      if(!(c.duration>0.1)||keys<64)statics.push(n+'(d='+num(c.duration)+',k='+keys+')');
    }
    chk('new_clips_are_not_static',statics.length===0,statics.join(' '));
    /* the three stances were RE-BAKED in place, so they must still exist and
       still be the durations the graph's dwell constants are tuned against */
    const idn=clips.find(c=>c.name==='IdleN');
    chk('IdleN_still_3.33s',!!idn&&Math.abs(idn.duration-3.333)<0.02,idn?num(idn.duration):'absent');

    /* ---- 2  bindings ---- */
    const A=player.actions;
    const WANT=['xferNtoF','xferNtoB','xferFtoN','xferFtoB','xferBtoN','xferBtoF',
                'idleFPulled','windmillL','windmillR','spinL','spinR'];
    const unbound=WANT.filter(k=>!A[k]);
    chk('all_new_bindings_resolved',unbound.length===0,'unbound '+unbound.join(','));

    /* ---- 3  hysteresis ---- */
    const E=CONFIG.idleLeanLat,R=E*CONFIG.idleLeanRelease;
    chk('hyst_holds_backhand_in_band',stanceWanted('B',(E+R)/2)==='B','mid-band should hold B');
    chk('hyst_holds_forehand_in_band',stanceWanted('F',-(E+R)/2)==='F','mid-band should hold F');
    chk('hyst_neutral_needs_full_enter',stanceWanted('N',(E+R)/2)==='N','mid-band must not enter from N');
    chk('hyst_enters_backhand',stanceWanted('N',E*1.2)==='B');
    chk('hyst_enters_forehand',stanceWanted('N',-E*1.2)==='F');
    chk('hyst_releases_backhand',stanceWanted('B',R*0.5)==='N');

    /* ---- 4/5  the machine plays the right transition ---- */
    function stance(from,lean){
      player.oneShot=0;player.lowerState='idle';player.stance=from;
      player.stanceLat=lean/CONFIG.idleLeanSign;
      const before=player.curAction;
      stanceTick(player,1/60);
      return {act:player.curAction,changed:player.curAction!==before,st:player.stance};
    }
    let r=stance('N',E*1.2);
    chk('N_to_B_plays_xferNtoB',r.act===A.xferNtoB&&r.st==='B',r.st+' '+(r.act?r.act.getClip().name:'null'));
    r=stance('N',-E*1.2);
    chk('N_to_F_plays_xferNtoF',r.act===A.xferNtoF&&r.st==='F',r.st+' '+(r.act?r.act.getClip().name:'null'));
    r=stance('F',E*1.2);
    chk('F_to_B_plays_xferFtoB',r.act===A.xferFtoB&&r.st==='B',r.st+' '+(r.act?r.act.getClip().name:'null'));
    r=stance('B',-E*1.2);
    chk('B_to_F_plays_xferBtoF',r.act===A.xferBtoF&&r.st==='F',r.st+' '+(r.act?r.act.getClip().name:'null'));
    r=stance('B',R*0.5);
    chk('B_to_N_plays_xferBtoN',r.act===A.xferBtoN&&r.st==='N',r.st+' '+(r.act?r.act.getClip().name:'null'));
    /* parked on the boundary: no transition at all */
    r=stance('B',(E+R)/2);
    chk('boundary_fires_nothing',!r.changed&&r.st==='B','changed='+r.changed+' st='+r.st);
    /* already committed: a second call must not restart or redirect it */
    player.oneShot=0;player.lowerState='idle';player.stance='N';
    player.stanceLat=(E*1.2)/CONFIG.idleLeanSign;
    stanceTick(player,1/60);
    const committed=player.curAction;
    player.stanceLat=(-E*1.2)/CONFIG.idleLeanSign;   // signal reverses mid-transition
    stanceTick(player,1/60);
    chk('no_retrigger_during_transition',player.curAction===committed&&player.oneShot>0,
        'oneShot='+num(player.oneShot));
    /* at speed there is no stance, so nothing fires */
    player.oneShot=0;player.lowerState='forward';player.stance='B';
    player.stanceLat=(-E*1.2)/CONFIG.idleLeanSign;
    const b4=player.curAction;stanceTick(player,1/60);
    chk('no_stance_while_skating',player.curAction===b4&&player.stance===null,'st='+player.stance);

    /* ---- 6  swing tiers ---- */
    const realHas=window.entHasPuck;
    window.entHasPuck=function(){return true;};
    function deke(swing){
      player.oneShot=0;player.lowerState='idle';player.stance='N';
      const a=ihTryDekeClip(player,swing);
      return {a:a,st:player.stance};
    }
    let d=deke(CONFIG.dekeMinSwing+0.01);
    chk('small_swing_is_boost_only',d.a===null,'fired '+(d.a?d.a.getClip().name:''));
    d=deke(CONFIG.windmillSwing+0.05);
    chk('mid_swing_backhand_is_windmillL',d.a===A.windmillL&&d.st==='B',
        (d.a?d.a.getClip().name:'null')+' '+d.st);
    d=deke(-(CONFIG.windmillSwing+0.05));
    chk('mid_swing_forehand_is_windmillR',d.a===A.windmillR&&d.st==='F',
        (d.a?d.a.getClip().name:'null')+' '+d.st);
    d=deke(CONFIG.spinoramaSwing+0.05);
    chk('big_swing_is_spinorama',d.a===A.spinR&&d.st==='B',
        (d.a?d.a.getClip().name:'null')+' '+d.st);
    d=deke(-(CONFIG.spinoramaSwing+0.05));
    chk('big_swing_other_way_is_spinorama',d.a===A.spinL&&d.st==='B',
        (d.a?d.a.getClip().name:'null')+' '+d.st);
    /* no puck, no move */
    window.entHasPuck=function(){return false;};
    d=deke(CONFIG.spinoramaSwing+0.05);
    chk('no_move_without_puck',d.a===null,'fired '+(d.a?d.a.getClip().name:''));
    window.entHasPuck=realHas;

    /* ---- 7  the move owns the arms ---- */
    window.entHasPuck=function(){return true;};
    player.oneShot=0;player.lowerState='idle';player.handleBlend=1;
    ihTryDekeClip(player,CONFIG.windmillSwing+0.05);
    window.entHasPuck=realHas;
    const hb0=player.handleBlend;
    for(let i=0;i<30;i++)frame();
    chk('move_hands_arms_to_clip',player.handleBlend<hb0*0.5,
        'handleBlend '+num(hb0)+' -> '+num(player.handleBlend));

    /* the graph must come back afterwards rather than sticking on the move */
    for(let i=0;i<150;i++)frame();
    chk('graph_resumes_after_move',player.oneShot<=0,'oneShot='+num(player.oneShot));

    report();
  }
  boot(go);
})();
