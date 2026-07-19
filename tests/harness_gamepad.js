/* GAMEPAD layer verification v3 — face-button rework + gesture toe drag.
   Mock DS4 drives the LIVE loop; every check is condition-polled (headless
   swiftshader = few FPS + clamped dt, sim time << wall time). */
(function(){
  const RES={checks:{}};
  const MP={axes:[0,0,0,0],
    buttons:Array.from({length:18},()=>({pressed:false,value:0})),
    connected:true,index:0,mapping:'standard',id:'MockDS4',
    vibrationActuator:{playEffect:function(){window.__rumbles=(window.__rumbles||0)+1;return Promise.resolve('complete');}}};
  navigator.getGamepads=function(){return [MP];};
  const press=i=>{MP.buttons[i].pressed=true;MP.buttons[i].value=1;};
  const rel=i=>{MP.buttons[i].pressed=false;MP.buttons[i].value=0;};
  const ax=(i,v)=>{MP.axes[i]=v;};
  const clearAll=()=>{for(let i=0;i<18;i++)rel(i);ax(0,0);ax(1,0);ax(2,0);ax(3,0);};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function until(fn,ms){const t0=performance.now();
    while(performance.now()-t0<ms){try{if(fn())return true;}catch(e){}await sleep(50);}
    try{return !!fn();}catch(e){return false;}}
  const aimDist=()=>Math.hypot(currentAim.x-player.pos.x,currentAim.z-player.pos.z);
  function report(){
    try{RES.nan=(isFinite(player.pos.x)&&isFinite(puck.pos.x))?'OK':'NAN';}catch(e){RES.nan='ERR:'+e;}
    fetch('/PADRESULT_'+encodeURIComponent(JSON.stringify(RES)).slice(0,1900)).catch(()=>{});
  }
  async function run(){
    try{
      // ---- menu nav ----
      press(15);
      const oneSel=await until(()=>document.getElementById('sm1v1').classList.contains('sel'),2500);
      rel(15);await sleep(300);
      press(14);
      const pracSel=await until(()=>document.getElementById('smPractice').classList.contains('sel'),2500);
      rel(14);await sleep(300);
      press(0);
      const started=await until(()=>window.__poseFrozen===false,2500);
      rel(0);
      RES.checks.menuNav=oneSel&&pracSel&&started&&GAME.mode==='practice';
      RES.checks.padClaims=PAD.on===true;
      // ---- skating / stance ----
      ax(1,-1);
      RES.checks.lsSkates=await until(()=>player.vel.length()>1.2,6000);
      ax(1,0);await sleep(400);
      puck.possessed=true;puck.vel.set(0,0,0);
      ax(2,-1);
      RES.checks.rsStance=await until(()=>(player.lastLat||0)>0.12,4000);
      // expo sensitivity: half deflection must NOT pin the stick at the rim
      ax(2,-0.5);await until(()=>true,1500);await sleep(600);
      const dHalf=aimDist();
      ax(2,-0.95);
      RES.checks.fineStick=await until(()=>aimDist()>dHalf*1.25,3000);
      RES.dHalf=Math.round(dHalf*100)/100;RES.dFull=Math.round(aimDist()*100)/100;
      ax(2,0);
      // ---- R2 windup, net aim, release ----
      player.pos.set(0,0,GOAL_ZONE.z-8);player.heading=0;player.vel.set(0,0,0);
      puck.possessed=true;puck.vel.set(0,0,0);
      await until(()=>Math.abs(player.lastLat||0)<0.12,4000);
      press(7);
      await until(()=>player.shotType!=='none',2500);
      RES.checks.wristWindup=player.shotType==='wrist'&&shootHeld===true;
      ax(2,-0.95);ax(3,-0.95);
      RES.checks.netAim=await until(()=>currentAim.x>0.45&&currentAim.y>0.7&&Math.abs(currentAim.z-GOAL_ZONE.z)<0.6,4000);
      window.__rumbles=0;
      rel(7);
      await until(()=>!puck.possessed,2500);
      RES.checks.shotFired=!puck.possessed&&puck.vel.z>4&&puck.vel.x>-0.1;
      RES.checks.rumbleOnShot=await until(()=>(window.__rumbles||0)>0,1500);
      ax(2,0);ax(3,0);await sleep(300);
      // ---- slapshot ----
      puck.possessed=true;puck.vel.set(0,0,0);player.pos.set(0,0,GOAL_ZONE.z-9);player.vel.set(0,0,0);
      await sleep(300);
      press(5);press(7);
      RES.checks.slapWindup=await until(()=>player.shotType==='slap',2500);
      await sleep(500);
      rel(7);
      await until(()=>!puck.possessed,2500);
      RES.checks.slapFired=!puck.possessed&&Math.hypot(puck.vel.x,puck.vel.z)>12;
      rel(5);await sleep(300);
      // ---- Cross/A hold = protect (offense) ----
      puck.possessed=true;puck.vel.set(0,0,0);
      press(0);
      RES.checks.protect=await until(()=>player.protectActive===true,4000);
      rel(0);
      await until(()=>player.protectActive===false,2000);
      // ---- Circle/B tap = reverse hit (offense) ----
      press(1);
      RES.checks.reverseHit=await until(()=>player.hitType==='reverse'&&((player.hitT||0)>0||(player.hitCd||0)>0),2500);
      rel(1);
      // ---- R3 = fake shot ----
      puck.possessed=true;puck.vel.set(0,0,0);player.pos.set(0,0,GOAL_ZONE.z-8);player.vel.set(0,0,0);
      await sleep(300);
      press(7);
      await until(()=>player.shotType!=='none',2500);
      press(11);
      const fakeKilled=await until(()=>player.shotType==='none'&&puck.possessed===true,2000);
      rel(11);rel(7);await sleep(900);
      RES.checks.fakeShot=fakeKilled&&puck.possessed===true;
      // ---- toe drag GESTURE: forehand rim + sweep along the rim ----
      puck.possessed=true;puck.vel.set(0,0,0);
      player.toeDragT=0;player.toeDragCd=0;
      ax(2,-0.95);ax(3,0);await sleep(500); // reach the forehand rim first
      for(let k=0;k<=20;k++){const t=k/20;
        ax(2,-Math.cos(t*Math.PI*0.9)*0.95);ax(3,-Math.sin(t*Math.PI*0.9)*0.95);
        await sleep(45);}
      RES.checks.toeDragGesture=await until(()=>(player.toeDragT||0)>0,2500);
      if(!RES.checks.toeDragGesture)RES.dbgTD={acc:TDG.acc,live:TDG.live,lat:player.lastLat,st:player.shotType,pos:puck.possessed};
      ax(2,0);ax(3,0);await sleep(300);
      // ---- saucer circle during a pass windup ----
      puck.possessed=true;puck.vel.set(0,0,0);player.pos.set(0,0,-2);player.vel.set(0,0,0);
      await sleep(300);
      press(5);
      await until(()=>player.shotType==='pass',2500);
      for(let k=0;k<=48;k++){const a=k/48*Math.PI*4;
        ax(2,Math.cos(a)*0.95);ax(3,Math.sin(a)*0.95);await sleep(70);}
      RES.checks.saucerArmed=!!(gest.fire&&gest.fire.curved===true);
      rel(5);
      await until(()=>!puck.possessed,2500);
      RES.checks.saucerFired=!puck.possessed&&puck.vel.y>0.7;
      ax(2,0);ax(3,0);
      // ---- defense block: banish the puck ----
      puck.possessed=false;puck.pos.set(-20,0.11,-20);puck.vel.set(0,0,0);
      player.pos.set(0,0,0);player.vel.set(0,0,0);
      RES.checks.autoDefense=await until(()=>defenseMode===true,3000);
      // R1 = sustained poke sweep
      press(5);
      RES.checks.padPoke=await until(()=>player.holdPokeActive===true,2500);
      rel(5);
      await until(()=>player.holdPokeActive===false&&lmbHeld===false,3000);
      // Cross/A = stick-lift jab
      await until(()=>(player.pokeT||0)<=0&&(player.pokeCd||0)<=0,8000);
      press(0);
      RES.checks.stickLift=await until(()=>(player.pokeT||0)>0||(player.pokeCd||0)>0,2500);
      rel(0);
      // Circle/B = charge hit (EA Hybrid), release fires
      await until(()=>(player.hitCd||0)<=0&&(player.hitT||0)<=0&&(player.diveT||0)<=0&&(player.diveCd||0)<=0,15000);
      press(1);
      RES.checks.hitCharge=await until(()=>(player.hitChargeT||0)>0.2,4000);
      rel(1);
      RES.checks.hitReleased=await until(()=>(player.hitT||0)>0||(player.hitCd||0)>0,2000);
      // L1 during a fresh B-charge = knee block
      await until(()=>(player.hitCd||0)<=0&&(player.hitT||0)<=0&&(player.diveT||0)<=0&&(player.diveCd||0)<=0,15000);
      press(1);
      await until(()=>(player.hitChargeT||0)>0.05,3000);
      press(4);
      RES.checks.kneeBlock=await until(()=>player.kneelActive===true,2500);
      rel(4);rel(1);await sleep(300);
      // ---- Triangle/Y = tie-up next to the practice dummy ----
      player.pos.set(dummy.pos.x+0.9,0,dummy.pos.z);player.vel.set(0,0,0);
      player.tieCd=0;
      await sleep(200);
      press(3);
      RES.checks.tieUp=await until(()=>PAD.tieTarget!==null&&(player.tieT||0)>0,3000);
      rel(3);
      RES.checks.tieCooldown=await until(()=>PAD.tieTarget===null&&(player.tieCd||0)>0,2000);
      player.pos.set(0,0,0);player.vel.set(0,0,0);
      // ---- R2 alone while puckless = one-timer windup, returns to defense ----
      await until(()=>(player.tieCd||0)<=0,4000);
      press(7);
      RES.checks.oneTimerWindup=await until(()=>player.shotType!=='none'&&!puck.possessed,3000);
      rel(7);
      RES.checks.oneTimerReturns=await until(()=>player.shotType==='none'&&defenseMode===true,3000);
      // ---- Square/X = layer override toggle, auto-clears on possession ----
      press(2);await until(()=>PAD.forceOffense===true,2000);rel(2);
      RES.checks.xToggleOn=PAD.forceOffense===true&&await until(()=>defenseMode===false,2000);
      puck.possessed=true;
      RES.checks.xToggleAutoClear=await until(()=>PAD.forceOffense===false,2000);
      puck.possessed=false;puck.pos.set(-20,0.11,-20);puck.vel.set(0,0,0);
      // ---- L2 brake, L3 sprint ----
      press(6);
      RES.checks.brakeKey=await until(()=>keys[' ']===true,2000);
      rel(6);
      await until(()=>keys[' ']!==true,2000);
      const s0=!!player.sprintOn;
      press(10);
      RES.checks.sprintToggle=await until(()=>(!!player.sprintOn)!==s0,2000);
      rel(10);await sleep(200);
      if(player.sprintOn){press(10);await until(()=>!player.sprintOn,2000);rel(10);}
      // ---- dpad FP, Options menu, mouse reclaim ----
      const fp0=!!CONFIG.firstPerson;
      press(12);
      RES.checks.dpadFP=await until(()=>(!!CONFIG.firstPerson)!==fp0,2000);
      rel(12);await sleep(200);
      if(!!CONFIG.firstPerson!==fp0)setFP(fp0);
      press(9);
      RES.checks.optionsMenu=await until(()=>window.__poseFrozen===true&&GAME.menuEl.style.display!=='none',2500);
      rel(9);await sleep(200);
      // ---- CLASSIC scheme: pick it in the open menu, restart practice ----
      document.getElementById('smCla').click();
      document.getElementById('smPractice').click();
      document.getElementById('smStart').click();
      await until(()=>window.__poseFrozen===false,2500);
      RES.checks.claScheme=padScheme==='classic';
      puck.possessed=true;puck.vel.set(0,0,0);
      player.pos.set(0,0,GOAL_ZONE.z-8);player.heading=0;player.vel.set(0,0,0);
      await until(()=>Math.abs(player.lastLat||0)<0.12,4000); // stance recenters
      press(2); // Square = wrist windup, auto-aimed at the net
      await until(()=>player.shotType!=='none',2500);
      RES.checks.claWrist=player.shotType==='wrist';
      RES.checks.claAutoAim=await until(()=>Math.abs(currentAim.x)<0.45&&Math.abs(currentAim.z-GOAL_ZONE.z)<0.6,3000);
      rel(2);
      await until(()=>!puck.possessed,2500);
      RES.checks.claFire=!puck.possessed&&puck.vel.z>4;
      await sleep(300);
      puck.possessed=true;puck.vel.set(0,0,0);
      press(1); // Circle = slap
      RES.checks.claSlap=await until(()=>player.shotType==='slap',2500);
      rel(1);await until(()=>!puck.possessed,2500);await sleep(200);
      puck.possessed=true;puck.vel.set(0,0,0);player.pos.set(0,0,-2);player.vel.set(0,0,0);
      await sleep(200);
      press(5); // R1 = saucer pass (curved flag pre-armed, no gesture)
      RES.checks.claSaucer=await until(()=>player.shotType==='pass'&&gest.fire&&gest.fire.curved===true,2500);
      rel(5);await until(()=>!puck.possessed,2500);
      puck.possessed=true;puck.vel.set(0,0,0);
      press(3); // Triangle hold = protect
      RES.checks.claProtect=await until(()=>player.protectActive===true,4000);
      rel(3);await until(()=>player.protectActive===false,2000);
      // classic defense: Square tap = one-timer swat at a nearby loose puck
      puck.possessed=false;puck.vel.set(0,0,0);puck.noPickupT=6;
      puck.pos.set(player.pos.x,0.11,player.pos.z+0.7);
      await until(()=>defenseMode===true,3000);
      press(2);
      RES.checks.claOneTimer=await until(()=>puck.vel.length()>3,2500);
      rel(2);puck.noPickupT=0;
      // ---- mouse reclaims ----
      clearAll();await sleep(400);
      mouseCtl.active=true;
      RES.checks.mouseReclaim=await until(()=>PAD.on===false&&lmbHeld===false,2000);
    }catch(e){RES.error=String(e&&e.stack?e.stack.split('\n').slice(0,2).join('|'):e);}
    report();
  }
  let tries=0;
  const iv=setInterval(function(){
    tries++;
    if(typeof player==='undefined'||!player||!puck||!GAME.menuEl||typeof pollPad!=='function'){
      if(tries>600){clearInterval(iv);RES.error='boot-timeout';report();}
      return;}
    clearInterval(iv);run();
  },100);
})();
