/* LOBBY REWORK verification — pad menu focus-nav, practice lobby (joins +
   bots + free-skate roster), P1 input lock (pad / kbm / auto).
   TWO mock pads: MP1 = P1, MP2 = joiner. Live-loop, condition-polled. */
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
  // menu edges live in MPAD.pb[padIdx] — a release must be OBSERVED there
  async function relSeenM(p,i){rel(p,i);
    await until(()=>MPAD.pb[p.index]&&MPAD.pb[p.index][i]===false,4000);await sleep(120);}
  async function relSeen1(i){rel(MP1,i);await until(()=>PAD.pb[i]===false,4000);await sleep(120);}
  function report(){
    try{RES.nan=(isFinite(player.pos.x)&&isFinite(puck.pos.x))?'OK':'NAN';}catch(e){RES.nan='ERR:'+e;}
    fetch('/LRESULT_'+encodeURIComponent(JSON.stringify(RES)).slice(0,1900)).catch(()=>{});
  }
  async function run(){
    try{
      // ---- menu focus nav: first dpad press births focus, next moves it ----
      press(MP1,13); // down
      RES.checks.lFocusBorn=await until(()=>!!MPAD.focus,3000);
      await relSeenM(MP1,13);
      const f0=MPAD.focus;
      press(MP1,12); // up: focus must MOVE somewhere else
      RES.checks.lFocusMoves=await until(()=>MPAD.focus&&MPAD.focus!==f0,3000);
      await relSeenM(MP1,12);
      // ---- Cross clicks the focused control ----
      menuSetFocus(document.getElementById('sm1v1'));
      press(MP1,0);
      RES.checks.lFocusClick=await until(()=>GAME.selMode==='1v1',3000);
      await relSeenM(MP1,0);
      menuSetFocus(document.getElementById('smPractice'));
      press(MP1,0);
      await until(()=>GAME.selMode==='practice',3000);
      await relSeenM(MP1,0);
      // ---- practice shows the lobby with TEAMMATE + OPPONENT counters ----
      RES.checks.lPracticeLobby=document.getElementById('smLobby').style.display!=='none'&&
        document.getElementById('smALbl').textContent==='TEAMMATE BOTS'&&
        document.getElementById('smBLbl').textContent==='OPPONENT BOTS';
      // ---- MP2 joins the PRACTICE lobby with Cross (team A) ----
      press(MP2,0);
      RES.checks.lJoin=await until(()=>MATCH.joined.length===1&&MATCH.padUsed[1]===true&&
        MATCH.joined[0].team==='A',4000);
      await relSeenM(MP2,0);
      // ---- Circle on the joined pad leaves ----
      press(MP2,1);
      RES.checks.lLeave=await until(()=>MATCH.joined.length===0&&!MATCH.padUsed[1],4000);
      await relSeenM(MP2,1);
      // rejoin for the free-skate test
      press(MP2,0);
      await until(()=>MATCH.joined.length===1,4000);
      await relSeenM(MP2,0);
      // ---- practice BOTS counter ----
      document.getElementById('smAp').click();
      RES.checks.lBotCounter=MATCH.botsP===1&&document.getElementById('smAn').textContent==='1';
      // ---- pad adjusts the (now visible) skill slider ----
      const sk=document.getElementById('smSkill');
      const v0=parseInt(sk.value,10);
      menuSetFocus(sk);
      press(MP1,14); // left = value down
      RES.checks.lSliderPad=await until(()=>parseInt(sk.value,10)===v0-1&&
        document.getElementById('smSkillVal').textContent===sk.value,3000);
      await relSeenM(MP1,14);
      menuSetFocus(null);
      // ---- START practice: free-skate roster spawns (P1 + P2 + 1 bot) ----
      press(MP1,0);
      await until(()=>window.__poseFrozen===false,4000);
      await relSeen1(0);
      RES.checks.lFreeSkate=await until(()=>MATCH.freeSkate===true&&GAME.mode==='practice'&&
        MATCH.skaters.length===3,90000);
      RES.checks.lNoNetB=(!MATCH.goalBGroup||MATCH.goalBGroup.visible===false)&&
        (!MATCH.goalieB||MATCH.goalieB.root.visible===false);
      const s2=MATCH.skaters.find(s=>s.ctrl===1);
      const ai=MATCH.skaters.find(s=>s.ctrl==='ai');
      RES.checks.lRoster=!!s2&&s2.team==='A'&&!!ai&&ai.team==='A'&&
        s2.ent.root.visible===true&&s2.ent.pRing&&s2.ent.pRing.visible===true;
      // ---- MP2 stick moves ONLY P2 ----
      MP2.axes[1]=-1;
      const p2Moves=await until(()=>s2.ent.vel.length()>0.8,8000);
      RES.checks.lExclusiveP2=p2Moves&&player.vel.length()<0.4;
      MP2.axes[1]=0;await sleep(400);
      // ---- the practice bot plays (P1 has the puck at start -> support) ----
      RES.checks.lBotPlays=await until(()=>ai.ent.vel.length()>0.3,10000);
      // ---- P2 shot fires at the +z net (team A attacks the real goal) ----
      puck.possessed=false;for(const s of MATCH.skaters)s.ent.hasPuck=false;
      s2.ent.pos.set(0,0,6);s2.ent.vel.set(0,0,0);s2.ent.hasPuck=true;
      await sleep(400);
      press(MP2,7);await until(()=>(s2.pctl.chargeT||0)>0,3000);rel(MP2,7);
      RES.checks.lP2Shot=await until(()=>!s2.ent.hasPuck&&puck.vel.z>4,3000);
      // ---- P1 INPUT: lock P1 to PAD 1 -> mouse/kb can't touch P1 ----
      press(MP1,9); // Options reopens the menu
      await until(()=>window.__poseFrozen===true,4000);
      await relSeen1(9);
      const padBtn=document.querySelector('#smP1Pick button[data-v="p0"]');
      RES.checks.lP1Row=!!padBtn;
      if(padBtn)padBtn.click();
      RES.checks.lP1PadPick=p1Input==='pad'&&p1PadIdx===0;
      press(MP1,0); // no focus -> START
      await until(()=>window.__poseFrozen===false,4000);
      await relSeen1(0);
      // mouse motion may not claim P1 back while locked
      window.dispatchEvent(new MouseEvent('mousemove',{clientX:200,clientY:200}));
      RES.checks.lPadLockMouse=await until(()=>PAD.on===true&&mouseCtl.active===false,4000);
      // WASD may not skate the locked P1 (park the other skaters first so
      // an AI support-skater bump can't fake P1 movement)
      for(const s of MATCH.skaters)if(s.ent!==player){s.ent.pos.set(-15,0,-15);s.ent.vel.set(0,0,0);}
      player.vel.set(0,0,0);await sleep(300);
      keys['w']=true;await sleep(1500);
      RES.checks.lPadLockKeys=player.vel.length()<0.35;
      keys['w']=false;
      // ---- P1 INPUT: KB/M -> P1's old pad becomes a free JOINER ----
      press(MP1,9);
      await until(()=>window.__poseFrozen===true,4000);
      await relSeen1(9);
      const kbmBtn=document.querySelector('#smP1Pick button[data-v="kbm"]');
      if(kbmBtn)kbmBtn.click();
      RES.checks.lKbmPick=p1Input==='kbm';
      await sleep(300);
      press(MP1,0); // MP1 is unowned now: Cross in the lobby JOINS it as P2+
      RES.checks.lKbmPadJoins=await until(()=>MATCH.padUsed[0]===true&&
        MATCH.joined.some(j=>j.pad===0),4000);
      await relSeenM(MP1,0);
      press(MP1,1); // and Circle leaves again
      await until(()=>!MATCH.padUsed[0],4000);
      await relSeenM(MP1,1);
      const autoBtn=document.querySelector('#smP1Pick button[data-v="auto"]');
      if(autoBtn)autoBtn.click();
      RES.checks.lAutoRestore=p1Input==='auto';
      // ---- solo teardown: everyone out, bots 0 -> plain practice ----
      press(MP2,1); // MP2 leaves
      await until(()=>MATCH.joined.length===0,4000);
      await relSeenM(MP2,1);
      document.getElementById('smAm').click();
      RES.checks.lBotsZero=MATCH.botsP===0;
      press(MP1,0);
      await until(()=>window.__poseFrozen===false,4000);
      rel(MP1,0);
      RES.checks.lSoloTeardown=await until(()=>MATCH.freeSkate===false&&GAME.mode==='practice'&&
        MATCH.skaters.length===0&&puck.possessed===true,8000);
    }catch(e){RES.error=String(e&&e.stack?e.stack.split('\n').slice(0,2).join('|'):e);}
    report();
  }
  let tries=0;
  const iv=setInterval(function(){
    tries++;
    if(typeof player==='undefined'||!player||!puck||!GAME.menuEl||typeof pollPad!=='function'||
       typeof MATCH==='undefined'||typeof menuPadPoll!=='function'){
      if(tries>600){clearInterval(iv);RES.error='boot-timeout';report();}
      return;}
    clearInterval(iv);run();
  },100);
})();
