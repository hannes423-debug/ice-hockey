/* 1v1 (Swedish style) + collision-fix verification — stepped physics. */
(function(){
  const RES={checks:{}};
  function step(n){for(let i=0;i<n;i++){window.__simT=(window.__simT||0)+1/60;
    updatePlayer(1/60);if(bot)updateBot(1/60);updatePuck(1/60);updateDummy(1/60);
    if(goalie)updateGoalie(1/60);updateGameMode(1/60);updateGoalCheck();}}
  function report(){
    try{RES.nan=(isFinite(player.pos.x)&&isFinite(bot.pos.x)&&isFinite(puck.pos.x)&&isFinite(goalie.pos.x))?'OK':'NAN';}catch(e){RES.nan='ERR:'+e;}
    fetch('/V1RESULT_'+encodeURIComponent(JSON.stringify(RES)).slice(0,1900)).catch(()=>{});
  }
  let tries=0;
  const iv=setInterval(function(){
    tries++;
    if(typeof player==='undefined'||!player||!goalie||!bot||!puck||!GAME.menuEl){
      if(tries>600){clearInterval(iv);RES.error='boot-timeout';report();}
      return;}
    clearInterval(iv);
    try{
      RES.checks.menuShownAtBoot=GAME.menuEl.style.display!=='none'&&window.__poseFrozen===true;
      // start 1v1 via the real menu controls
      document.getElementById('sm1v1').click();
      document.getElementById('smStart').click();
      RES.checks.started1v1=GAME.mode==='1v1'&&puck.possessed===true;
      window.__poseFrozen=true; // reclaim the sim clock from tick
      /* the bot's live defense steals the puck from the scripted test player,
         so rule-isolation phases run with its brain off (park + no pokes) */
      const origAI=updateBotAI;let aiOff=false;
      updateBotAI=function(dt){if(aiOff){bot.vel.set(0,0,0);return;}origAI(dt);};
      aiOff=true;bot.pos.set(-10,0,-26); // parked once, not teleported per-frame
      // A: carry across the blue line -> attack live
      player.pos.set(0,0,-1);player.vel.set(0,0,0);player.heading=0;
      keys['w']=true;
      let ok=false;for(let i=0;i<600;i++){step(1);if(GAME.attacker==='p'){ok=true;break;}}
      keys['w']=false;
      RES.checks.attackLiveAfterCarryIn=ok&&player.pos.z>CONFIG.blueLineZ;
      // B: bot steals in-zone -> must clear, then its AI clears + re-enters
      puck.possessed=false;bot.hasPuck=true;bot.pos.set(2,0,12);bot.vel.set(0,0,0);
      step(3);
      RES.checks.stealDemandsClear=GAME.needClear.b===true;
      aiOff=false;bot.pos.set(2,0,12); // brain back on for the clear+re-enter test
      let cleared=false,botLive=false;
      for(let i=0;i<1800;i++){step(1);
        if(!GAME.needClear.b)cleared=true;
        if(GAME.attacker==='b'){botLive=true;break;}
        if(!bot.hasPuck&&!puck.possessed&&puck.vel.length()<0.5&&i>300)break; // lost it dead somewhere
      }
      RES.checks.botClears=cleared;RES.checks.botReenters=botLive;
      // C: let the bot attack — does it get a shot off at the goalie?
      const faced0=goalScore+saveScore;
      for(let i=0;i<2400;i++){step(1);if(goalScore+saveScore>faced0)break;}
      RES.checks.botGetsShotOff=(goalScore+saveScore)>faced0;
      RES.botAttackInfo={faced:goalScore+saveScore-faced0,scoreB:GAME.scoreB};
      // D: forced goal while bot attack live -> loser's ball to player
      aiOff=true;
      /* C may have ended on a bot GOAL: let its whistle+resetCenter resolve
         instead of cancelling them (cancelling leaves a dirty mid-whistle state) */
      for(let i=0;i<200&&(GAME.whistleT>0||GAME.whistleFn);i++)step(1);
      GAME.attacker='b';
      bot.hasPuck=false;puck.possessed=false;
      /* rules test, not a goalie-beating test: park the goalie out of the
         lane so the forced shot's outcome is deterministic */
      if(goalie){goalie.pos.set(6,0,GOAL_ZONE.z-1);goalie.bf=0;goalie.bfTarget=0;}
      puck.pos.set(0,0.2,GOAL_ZONE.z-3);puck.vel.set(0,1.5,20);
      const sb0=GAME.scoreB;
      for(let i=0;i<240;i++){step(1);}
      RES.checks.goalCounted=GAME.scoreB===sb0+1;
      RES.checks.losersBall=puck.possessed===true&&Math.abs(player.pos.z+1)<1.5&&GAME.attacker===null;
      // E: uncleared shot = no goal
      GAME.attacker=null;GAME.lastOwner='p';puck.possessed=false;
      if(goalie){goalie.pos.set(6,0,GOAL_ZONE.z-1);goalie.bf=0;goalie.bfTarget=0;}
      puck.pos.set(0,0.2,GOAL_ZONE.z-3);puck.vel.set(0,1.5,20);
      const sp0=GAME.scoreP,sb1=GAME.scoreB;
      for(let i=0;i<240;i++){step(1);}
      RES.checks.unclearedNoGoal=GAME.scoreP===sp0&&GAME.scoreB===sb1;
      // F: net collision — puck fired at the back of the net from behind stays out
      GAME.whistleT=0;GAME.whistleFn=null;puck.possessed=false;if(bot)bot.hasPuck=false;
      puck.pos.set(0,0.1,GOAL_ZONE.z+2.5);puck.vel.set(0,0,-24);
      for(let i=0;i<60;i++){step(1);}
      RES.checks.netBlocksFromBehind=puck.pos.z>GOAL_ZONE.z+0.5;
      // G: skater can't stand inside the net box
      player.pos.set(0,0,GOAL_ZONE.z+0.3);player.vel.set(0,0,0);
      collideGoal(player.pos,CONFIG.playerR,player.vel,false,1/60);
      RES.checks.netSolidToSkater=Math.abs(player.pos.z-(GOAL_ZONE.z+0.3))>0.2||Math.abs(player.pos.x)>GOAL_ZONE.halfW;
      // H: board tunnel fix — 45 m/s point-blank into two walls
      player.pos.set(0,0,0);
      puck.outOfPlay=false;puck.pos.set(0,0.11,-25);puck.vel.set(0,0,-45);
      for(let i=0;i<40;i++){step(1);}
      const inZ=Math.abs(puck.pos.z)<=CONFIG.roomHalfD&&!puck.outOfPlay;
      puck.pos.set(10,0.11,0);puck.vel.set(45,0,0);
      for(let i=0;i<40;i++){step(1);}
      RES.checks.noBoardTunnel=inZ&&Math.abs(puck.pos.x)<=CONFIG.roomHalfW&&!puck.outOfPlay;
      // I: back to practice via menu — bot hidden, puck on stick
      document.getElementById('menuBtn2')||0; // (menu button has no id; open directly)
      GAME.menuEl.style.display='flex';
      document.getElementById('smPractice').click();
      document.getElementById('smStart').click();
      window.__poseFrozen=true;step(5);
      RES.checks.practiceRestores=GAME.mode==='practice'&&bot.root.visible===false&&puck.possessed===true;
    }catch(e){RES.error=String(e&&e.stack?e.stack.split('\n').slice(0,2).join('|'):e);}
    report();
  },100);
})();
