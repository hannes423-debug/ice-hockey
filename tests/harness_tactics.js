/* POSITIONAL AI (v3) + PRACTICE OPPONENTS verification — no pads needed:
   scenarios are staged by teleporting skaters/puck directly.
   MATCH: A=[C,D] vs B=[C,W,D] checks point/net-front/F1/high-slot/net-side
   structure, D trailer, breakout up-pass, point shot, D dump retrieval +
   half-wall outlet. PRACTICE: 2 opponent bots defend the lone net and play
   keep-away with the puck. Live-loop, condition-polled. */
(function(){
  const RES={checks:{}};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function until(fn,ms){const t0=performance.now();
    while(performance.now()-t0<ms){try{if(fn())return true;}catch(e){}await sleep(60);}
    try{return !!fn();}catch(e){return false;}}
  const team=(t,p)=>MATCH.skaters.find(s=>s.ctrl==='ai'&&s.team===t&&s.ai&&s.ai.pos===p);
  const clearPuck=()=>{puck.possessed=false;for(const s of MATCH.skaters)s.ent.hasPuck=false;};
  function report(){
    try{RES.nan=(isFinite(player.pos.x)&&isFinite(puck.pos.x))?'OK':'NAN';}catch(e){RES.nan='ERR:'+e;}
    fetch('/TRESULT_'+encodeURIComponent(JSON.stringify(RES)).slice(0,1900)).catch(()=>{});
  }
  async function run(){
    try{
      // ---- start a 1(+2) vs 3 match: A gets [C,D], B gets [C,W,D] ----
      document.getElementById('smMatch').click();
      document.getElementById('smAp').click();document.getElementById('smAp').click();
      document.getElementById('smBp').click();document.getElementById('smBp').click();
      document.getElementById('smStart').click();
      RES.checks.tStart=await until(()=>MATCH.active===true,150000);
      const aC=team('A','C'),aD=team('A','D'),bC=team('B','C'),bW=team('B','W'),bD=team('B','D');
      RES.checks.tPositions=!!(aC&&aD&&bC&&bW&&bD);
      // ---- O-zone structure, both teams at once: P1 carries deep ----
      // (pre-position everyone near center: short treks, less fps flake)
      clearPuck();
      aC.ent.pos.set(-2,0,2);aD.ent.pos.set(2,0,2);
      bC.ent.pos.set(0,0,5);bW.ent.pos.set(-2,0,5);bD.ent.pos.set(2,0,7);
      for(const s of[aC,aD,bC,bW,bD])s.ent.vel.set(0,0,0);
      player.pos.set(4,0,14);player.vel.set(0,0,0);
      puck.possessed=true;player.protectActive=true; // protect blocks F1 steals during the measurement
      // D now walks ITS OWN assigned side (pSide) rather than the carrier's
      // side (the deliberate multi-D split fix) — team A's roster gives the
      // lone D index 1 -> side=-1, so its point is at x<0, not x>0 as the
      // old carrier-relative behavior produced.
      RES.checks.tPointD=await until(()=>aD.ent.pos.x<-1&&Math.abs(aD.ent.pos.z-8.6)<3.0,24000);
      RES.checks.tNetFrontC=await until(()=>aC.ent.pos.z>15&&Math.abs(aC.ent.pos.x)<3.5,20000);
      RES.checks.tF1Pressure=await until(()=>bC.ent.pos.distanceTo(player.pos)<3.5,20000);
      // net sits at z≈27.1 — the collapsed W's high slot is own.z−10.5≈16.6
      RES.checks.tWHighSlot=await until(()=>bW.ent.pos.z>13.5&&bW.ent.pos.z<20&&Math.abs(bW.ent.pos.x)<5,20000);
      RES.checks.tDNetSide=await until(()=>bD.ent.pos.z>14,20000);
      // ---- transition: carrier in his own half -> D trails, C leads ----
      // (pre-position the AIs at neutral ice: the check is about their
      // TARGETS, not a 25m skate against SwiftShader's clock)
      player.pos.set(0,0,-10);player.vel.set(0,0,0);
      aD.ent.pos.set(2,0,2);aD.ent.vel.set(0,0,0);
      aC.ent.pos.set(-2,0,2);aC.ent.vel.set(0,0,0);
      RES.checks.tTrailerD=await until(()=>aD.ent.pos.z-player.pos.z<-2,26000);
      RES.checks.tLaneC=await until(()=>aC.ent.pos.z-player.pos.z>3,26000);
      player.protectActive=false;
      // ---- breakout: D deep in his own zone passes UP to the open C ----
      clearPuck();
      bC.ent.pos.set(10,0,15);bW.ent.pos.set(-10,0,15);bD.ent.pos.set(10,0,10);
      for(const s of[bC,bW,bD])s.ent.vel.set(0,0,0);
      player.pos.set(12,0,-5);player.vel.set(0,0,0);
      aC.ent.pos.set(-2,0,-5);aC.ent.vel.set(0,0,0);
      aD.ent.pos.set(0,0,-16);aD.ent.vel.set(0,0,0);aD.ent.hasPuck=true;
      if(aD.ai)aD.ai.passCd=0;
      const rel=await until(()=>!aD.ent.hasPuck,9000);
      RES.checks.tBreakoutUp=rel&&puck.vel.z>3;
      // ---- point shot: open lane at the point fires on net ----
      await until(()=>GAME.whistleT<=0,8000);
      clearPuck();
      goalie.pos.set(6,0,GOAL_ZONE.z-CONFIG.gDepthBase); // out of the lane
      bC.ent.pos.set(10,0,-15);bW.ent.pos.set(-10,0,-15);bD.ent.pos.set(10,0,-10);
      aC.ent.pos.set(-9,0,0);aC.ent.vel.set(0,0,0); // far enough that a low feed isn't the pick
      aD.ent.pos.set(-4,0,8.8);aD.ent.vel.set(0,0,0);aD.ent.hasPuck=true;aD.ent.attackT=0;
      if(aD.ai)aD.ai.passCd=5;
      const pshot=await until(()=>!aD.ent.hasPuck,9000);
      RES.checks.tPointShot=pshot&&puck.vel.z>6;
      await until(()=>GAME.whistleT<=0,9000); // ride out a possible goal whistle
      // ---- loose puck deep in A's end: D retrieves, C posts the outlet ----
      clearPuck();
      puck.pos.set(0,0.03,-16);puck.vel.set(0,0,0);puck.noPickupT=0;
      bC.ent.pos.set(10,0,15);bW.ent.pos.set(-10,0,15);bD.ent.pos.set(10,0,10);
      aC.ent.pos.set(-2,0,-4);aC.ent.vel.set(0,0,0);
      aD.ent.pos.set(2,0,-4);aD.ent.vel.set(0,0,0);
      player.pos.set(12,0,5);player.vel.set(0,0,0);
      let outletSeen=false,retrSeen=false;
      await until(()=>{
        if(!outletSeen&&aC.ent.pos.z<-6&&Math.abs(aC.ent.pos.x)>3)outletSeen=true;
        if(!retrSeen&&(aD.ent.hasPuck||aD.ent.pos.distanceTo(puck.pos)<3))retrSeen=true;
        return outletSeen&&retrSeen;},22000);
      RES.checks.tDRetrieves=retrSeen;
      RES.checks.tOutletC=outletSeen;
      // ---- PRACTICE with 2 OPPONENT bots ----
      window.__openMenu();
      await until(()=>window.__poseFrozen===true,3000);
      document.getElementById('smPractice').click();
      RES.checks.pLobbyLabels=document.getElementById('smBLbl').textContent==='OPPONENT BOTS'&&
        document.getElementById('smALbl').textContent==='TEAMMATE BOTS';
      document.getElementById('smBp').click();document.getElementById('smBp').click();
      RES.checks.pBotsOCounter=MATCH.botsO===2&&document.getElementById('smBn').textContent==='2'&&MATCH.botsB===3;
      document.getElementById('smStart').click();
      RES.checks.pFreeSkate=await until(()=>MATCH.freeSkate===true&&MATCH.skaters.length===3,25000);
      const oC=team('B','C'),oD=team('B','D');
      RES.checks.pOppPositions=!!(oC&&oD)&&MATCH.skaters.every(s=>s.ent===player||s.team==='B');
      // they DEFEND the lone net: C forechecks P1, D holds the gap goal-side
      clearPuck();
      player.pos.set(0,0,2);player.vel.set(0,0,0);
      puck.possessed=true;player.protectActive=true;
      RES.checks.pF1=await until(()=>oC.ent.pos.distanceTo(player.pos)<3.5,18000);
      // gap target with the puck outside their zone = own.z−13≈14.1
      RES.checks.pDGap=await until(()=>oD.ent.pos.z>11&&oD.ent.pos.z<17&&Math.abs(oD.ent.pos.x)<4.5,18000);
      // KEEP-AWAY: opponent with the puck flees/protects/passes, never shoots
      player.protectActive=false;clearPuck();
      oC.ent.pos.set(0,0,0);oC.ent.vel.set(0,0,0);oC.ent.hasPuck=true;
      if(oC.ai)oC.ai.passCd=0.5;
      player.pos.set(0,0,-2);player.vel.set(0,0,0);
      const g0=goalScore;
      const fled=await until(()=>{
        const c=MATCH.skaters.find(s=>s.team==='B'&&s.ent.hasPuck);
        return !!c&&c.ent.pos.distanceTo(player.pos)>4.5;},20000);
      RES.checks.pKeepAway=fled&&goalScore===g0;
      RES.checks.pNoShotFlag=goalScore===g0;
    }catch(e){RES.error=String(e&&e.stack?e.stack.split('\n').slice(0,2).join('|'):e);}
    report();
  }
  let tries=0;
  const iv=setInterval(function(){
    tries++;
    if(typeof player==='undefined'||!player||!puck||!GAME.menuEl||typeof matchAI!=='function'||
       typeof MATCH==='undefined'){
      if(tries>600){clearInterval(iv);RES.error='boot-timeout';report();}
      return;}
    clearInterval(iv);run();
  },100);
})();
