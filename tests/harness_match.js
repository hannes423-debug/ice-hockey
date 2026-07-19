/* MATCH MODE verification — TWO mock pads: MP1 = P1, MP2 joins as P2.
   Live-loop, condition-polled (low-fps headless). */
(function(){
  const RES={checks:{}};
  function mkPad(idx){return{axes:[0,0,0,0],
    buttons:Array.from({length:18},()=>({pressed:false,value:0})),
    connected:true,index:idx,mapping:'standard',id:'MockDS4_'+idx,
    vibrationActuator:{playEffect:function(){return Promise.resolve('complete');}}};}
  const MP1=mkPad(0),MP2=mkPad(1);
  navigator.getGamepads=function(){return [MP1,MP2];};
  const press=(p,i)=>{p.buttons[i].pressed=true;p.buttons[i].value=1;};
  const rel=(p,i)=>{p.buttons[i].pressed=false;p.buttons[i].value=0;};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function until(fn,ms){const t0=performance.now();
    while(performance.now()-t0<ms){try{if(fn())return true;}catch(e){}await sleep(60);}
    try{return !!fn();}catch(e){return false;}}
  async function tap(p,i,hold){press(p,i);await sleep(hold||350);rel(p,i);await sleep(250);}
  // MP1 edges are sampled into PAD.pb — a release must be OBSERVED there
  // before the next press can produce an edge at low fps
  async function relSeen1(i){rel(MP1,i);await until(()=>PAD.pb[i]===false,4000);await sleep(120);}
  function report(){
    try{RES.nan=(isFinite(player.pos.x)&&isFinite(puck.pos.x))?'OK':'NAN';}catch(e){RES.nan='ERR:'+e;}
    fetch('/MRESULT_'+encodeURIComponent(JSON.stringify(RES)).slice(0,1900)).catch(()=>{});
  }
  async function run(){
    try{
      // claim P1 on MP1, cycle menu to MATCH — press until each step is SEEN
      press(MP1,15);await until(()=>document.getElementById('sm1v1').classList.contains('sel'),5000);await relSeen1(15);
      press(MP1,15);await until(()=>document.getElementById('smMatch').classList.contains('sel'),5000);await relSeen1(15);
      RES.checks.mMenuMatch=GAME.selMode==='match'&&document.getElementById('smLobby').style.display!=='none';
      // MP2 presses a button -> joins as P2 on pad 2
      press(MP2,0);
      RES.checks.mJoin=await until(()=>MATCH.joined.length===1&&MATCH.padUsed[1]===true,3000);
      rel(MP2,0);await sleep(250);
      // add one TEAM A bot via the lobby counter
      document.getElementById('smAp').click();
      RES.checks.mBotCounter=MATCH.botsA===1;
      // default 1 team-B bot; start (Cross on P1's pad, held until seen)
      press(MP1,0);await until(()=>PAD.pb[0]===true,4000);await relSeen1(0);
      RES.checks.mStart=await until(()=>MATCH.active===true,90000);
      RES.checks.mRoster=MATCH.skaters.length===4&&!!GOAL_B&&!!MATCH.goalieB&&MATCH.goalieB.root.visible===true;
      const s2=MATCH.skaters.find(s=>s.ctrl===1);
      RES.checks.mP2Exists=!!s2&&s2.team==='B';
      // EA player colors: P1 ring red, P2 ring blue
      RES.checks.mColors=s2.ent.pRing&&s2.ent.pRing.visible===true&&
        s2.ent.pRing.material.color.getHex()===P_COLORS[1]&&
        reachRing.material.color.getHex()===P_COLORS[0];
      // device exclusivity: MP2 stick moves ONLY P2
      await until(()=>GAME.whistleT<=0,4000);
      MP2.axes[1]=-1;
      const p2Moves=await until(()=>s2.ent.vel.length()>0.8,8000);
      RES.checks.mExclusiveP2=p2Moves&&player.vel.length()<0.4;
      MP2.axes[1]=0;await sleep(400);
      // MP1 stick moves ONLY P1
      MP1.axes[1]=-1;
      const p1Moves=await until(()=>player.vel.length()>0.8,8000);
      const s2v=s2.ent.vel.length();
      RES.checks.mExclusiveP1=p1Moves;
      RES.s2VelDuringP1=Math.round(s2v*100)/100;
      MP1.axes[1]=0;await sleep(300);
      // TEAM B goal: fire into the -z net (goalie B parked out of the lane)
      puck.possessed=false;for(const s of MATCH.skaters)s.ent.hasPuck=false;
      MATCH.goalieB.pos.set(6,0,GOAL_ZONE.z-CONFIG.gDepthBase);
      puck.noPickupT=1;puck.pos.set(0,0.2,GOAL_B.z+3);puck.vel.set(0,1.5,-20);
      RES.checks.mGoalB=await until(()=>MATCH.scoreB===1,4000);
      // whistle -> faceoff reset
      RES.checks.mFaceoff=await until(()=>GAME.whistleT<=0&&Math.abs(puck.pos.x)<1&&Math.abs(puck.pos.z)<1&&Math.abs(player.pos.z+2.5)<1.2,6000);
      // TEAM A goal at the +z net (goalie A parked)
      puck.possessed=false;for(const s of MATCH.skaters)s.ent.hasPuck=false;
      goalie.pos.set(6,0,GOAL_ZONE.z-CONFIG.gDepthBase);
      puck.noPickupT=1;puck.pos.set(0,0.2,GOAL_ZONE.z-3);puck.vel.set(0,1.5,20);
      RES.checks.mGoalA=await until(()=>MATCH.scoreA===1,4000);
      await until(()=>GAME.whistleT<=0,6000);
      // the AI skater plays (chases the faceoff puck)
      const ai=MATCH.skaters.find(s=>s.ctrl==='ai');
      RES.checks.mAIMoves=await until(()=>ai.ent.vel.length()>0.3,8000);
      // ---- tactics: overload support, defensive pressure, AI pass ----
      const botA=MATCH.skaters.find(s=>s.ctrl==='ai'&&s.team==='A');
      const botB=MATCH.skaters.find(s=>s.ctrl==='ai'&&s.team==='B');
      // P1 carries deep -> team A bot takes an O-zone overload spot (net-front)
      await until(()=>GAME.whistleT<=0,6000);
      for(const s of MATCH.skaters)s.ent.hasPuck=false;
      botB.ent.pos.set(-10,0,-20);botB.ent.vel.set(0,0,0);
      player.pos.set(4,0,14);player.vel.set(0,0,0);puck.possessed=true;
      RES.checks.mOverloadSupport=await until(()=>botA.ent.pos.z>9,14000);
      // team B carries at center -> team A bot pressures the carrier
      puck.possessed=false;for(const s of MATCH.skaters)s.ent.hasPuck=false;
      s2.ent.hasPuck=true;s2.ent.pos.set(0,0,2);s2.ent.vel.set(0,0,0);
      player.pos.set(0,0,-15);player.vel.set(0,0,0);
      RES.checks.mDefPressure=await until(()=>botA.ent.pos.distanceTo(s2.ent.pos)<3.5,14000);
      // pressured AI carrier passes to the OPEN teammate, not at the net
      puck.possessed=false;for(const s of MATCH.skaters)s.ent.hasPuck=false;
      botB.ent.pos.set(7,0,-10);botB.ent.vel.set(0,0,0);botB.ent.hasPuck=true;
      if(botB.ai)botB.ai.passCd=0;
      player.pos.set(7,0,-8.6);player.vel.set(0,0,0);
      s2.ent.pos.set(-4,0,-6);s2.ent.vel.set(0,0,0);
      botA.ent.pos.set(0,0,-2);botA.ent.vel.set(0,0,0);
      const released=await until(()=>!botB.ent.hasPuck,9000);
      let passDot=-9;
      if(released){
        const v=Math.hypot(puck.vel.x,puck.vel.z)||1;
        const tx=(-4-7),tz=(-6+10),tl=Math.hypot(tx,tz);
        passDot=(puck.vel.x/v)*(tx/tl)+(puck.vel.z/v)*(tz/tl);
      }
      RES.checks.mAIPass=released&&passDot>0.6;
      RES.passDot=Math.round(passDot*100)/100;
      // P2 shot: attacks -z, so release must send the puck -z
      puck.possessed=false;for(const s of MATCH.skaters)s.ent.hasPuck=false;
      s2.ent.pos.set(0,0,-6);s2.ent.vel.set(0,0,0);s2.ent.hasPuck=true;
      await sleep(400);
      press(MP2,7);await until(()=>(s2.pctl.chargeT||0)>0,3000);rel(MP2,7);
      RES.checks.mP2Shot=await until(()=>!s2.ent.hasPuck&&puck.vel.z<-4,3000);
      // P2 pass releases the puck at pass speed
      await until(()=>GAME.whistleT<=0,6000);
      puck.possessed=false;for(const s of MATCH.skaters)s.ent.hasPuck=false;
      s2.ent.pos.set(2,0,4);s2.ent.vel.set(0,0,0);s2.ent.hasPuck=true;
      await sleep(400);
      press(MP2,0);await until(()=>!s2.ent.hasPuck,3000);rel(MP2,0);
      RES.checks.mP2Pass=await until(()=>!s2.ent.hasPuck&&Math.hypot(puck.vel.x,puck.vel.z)>3,3000);
      // back to practice: menu, cycle left twice, start -> full teardown
      press(MP1,9);
      await until(()=>window.__poseFrozen===true,4000);
      await relSeen1(9);
      press(MP1,14);await until(()=>document.getElementById('sm1v1').classList.contains('sel'),5000);await relSeen1(14);
      press(MP1,14);await until(()=>document.getElementById('smPractice').classList.contains('sel'),5000);await relSeen1(14);
      press(MP1,0);await until(()=>PAD.pb[0]===true,4000);await relSeen1(0);
      RES.checks.mTeardown=await until(()=>GAME.mode==='practice'&&MATCH.active===false&&
        MATCH.goalBGroup.visible===false&&MATCH.goalieB.root.visible===false&&
        (typeof dummy==='undefined'||!dummy||dummy.group.visible===true)&&puck.possessed===true,8000);
    }catch(e){RES.error=String(e&&e.stack?e.stack.split('\n').slice(0,2).join('|'):e);}
    report();
  }
  let tries=0;
  const iv=setInterval(function(){
    tries++;
    if(typeof player==='undefined'||!player||!puck||!GAME.menuEl||typeof pollPad!=='function'||typeof MATCH==='undefined'){
      if(tries>600){clearInterval(iv);RES.error='boot-timeout';report();}
      return;}
    clearInterval(iv);run();
  },100);
})();
