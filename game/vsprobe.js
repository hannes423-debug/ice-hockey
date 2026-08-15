/* vsprobe.js — headless check of VS MODE and PLAYER SWITCHING.
 * Appended to a copy of ice_hockey.html by vsprobe.sh; reports back through
 * fetch('/PROBE?...') so the result lands in the python http.server access log
 * (same trick as simprobe.sh).
 *
 * What it asserts, and why each one is worth a test rather than a read of the
 * code:
 *
 *   1  THE LINEUP IS REAL. Five slots a side, C/LW/RW/LD/RD, and the wings and
 *      D actually START on the side of the ice their key names — the switch
 *      keys are a map of the ice and are worthless if the map is wrong. Both
 *      sides, because left/right MIRRORS with the direction a team attacks and
 *      that is exactly the kind of sign that gets written once and never
 *      checked (see the project's own sign-convention scars).
 *   2  A SWITCH ACTUALLY MOVES CONTROL — `player` is a different entity, the
 *      body you left is back on the AI, and the two STICKS changed hands. The
 *      stick is a separate object from the body, so "control moved" and "the
 *      sticks moved" are two different claims.
 *   3  THE POSSESSION LOCK. Carrying kills the switch keys; playing the puck
 *      away brings them back.
 *   4  AUTO-SWITCH KEEPS THE PUCK. A teammate wins it and you become him
 *      WITH the puck — the two rigs spell possession differently
 *      (puck.possessed vs ent.hasPuck) and a swap that forgets to translate
 *      drops the puck on the ice under the new man's skates.
 *   5  THE GOALIE IS THE THIRD CASE. Our goalie holding it neither locks the
 *      keys nor drags control onto a goalie nobody can play.
 *   6  IT IS INERT EVERYWHERE ELSE. Every other mode is one-body on purpose.
 *   7  LEAVING VS GIVES P1 HIS OWN BODY BACK — otherwise you walk out of the
 *      match still driving a pool bot that teardown is about to hide.
 *   8  NOTHING THROWS for a hundred frames after control has changed hands.
 */
(function(){
  const OUT=[];
  const fail=[];
  const chk=(name,ok,detail)=>{OUT.push((ok?'PASS ':'FAIL ')+name+(detail?' :: '+detail:''));if(!ok)fail.push(name);};
  const num=n=>(Math.round(n*1000)/1000);

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
  /* A probe that throws inside its own body reports NOTHING and reads like a
     hung browser — every step is wrapped. */
  const step=(name,fn)=>{try{fn();}catch(e){OUT.push('PROBEERR '+name+'='+e.message);fail.push(name);}};

  let stepping=false;
  function takeOverClock(){
    if(stepping)return;stepping=true;
    window.requestAnimationFrame=function(){return 0;};
    clock.getDelta=function(){return 1/60;};
  }
  const frame=()=>{try{tick();}catch(e){tickErr(e.message);}};
  const run=n=>{for(let i=0;i<n;i++)frame();};
  const press=k=>document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true}));

  /* ---- phase 0: prime the FRONT-END HANDOFF and reload ----------------
     index.html does not open the in-game menu at all — it writes a one-shot
     `ihAutoStart` key and jumps to the game, which is a completely different
     path into VS from clicking the card, and the only one a player who came
     from the main menu will ever take. It can only be tested from BEFORE the
     page boots, hence the reload: phase 0 writes the key, phase 1 is the real
     run and never touches the menu buttons. */
  const PHASE_KEY='__vsprobePhase';
  let phase=0;
  try{phase=parseInt(sessionStorage.getItem(PHASE_KEY)||'0',10)||0;}catch(e){}
  const AUTOSTART_SKILL=88;
  if(phase===0){
    try{
      sessionStorage.setItem(PHASE_KEY,'1');
      localStorage.setItem('ihAutoStart',JSON.stringify({mode:'vs',skill:AUTOSTART_SKILL,party:[]}));
    }catch(e){OUT.push('PHASE0ERR='+e.message);report();return;}
    location.reload();
    return;
  }
  try{sessionStorage.removeItem(PHASE_KEY);}catch(e){}

  /* VS is async twice over (goalie body, then nine skater bodies), so the
     boot waits on the STATE the mode sets, never on a timeout. */
  let autostarted=false;
  function boot(cb){
    let tries=0;
    (function wait(){
      const startBtn=document.querySelector('#smStart'),vsBtn=document.querySelector('#smVs');
      /* the handoff hides the card the instant it fires — if it already has,
         clicking anything here would start a SECOND game on top of it */
      if(typeof GAME!=='undefined'&&GAME.menuEl&&GAME.menuEl.style.display==='none')autostarted=true;
      if(player&&puck&&startBtn&&vsBtn&&!boot.clicked&&!autostarted){
        boot.clicked=true;vsBtn.click();startBtn.click();
      }
      if((boot.clicked||autostarted)&&MATCH.vs&&MATCH.active&&MATCH.skaters.length>=10){
        takeOverClock();run(5);cb();return;
      }
      if(++tries>300){OUT.push('BOOT TIMEOUT vs='+MATCH.vs+' active='+MATCH.active+' n='+MATCH.skaters.length);report();return;}
      setTimeout(wait,50);
    })();
  }

  const teamOf=t=>MATCH.skaters.filter(s=>s.team===t);
  const slotOf=(t,n)=>MATCH.skaters.find(s=>s.team===t&&s.slot===n);

  boot(function(){
    /* ---- 0. the front-end handoff ------------------------------------ */
    step('autostart',()=>{
      chk('autostart: index.html starts VS with no menu at all',autostarted===true,
          'the card was still open — the handoff did not fire');
      chk('autostart: VS is live',MATCH.vs===true&&MATCH.active===true);
      chk('autostart: the mode string stays "match"',GAME.mode==='match',GAME.mode);
      chk('autostart: bot skill carried across the jump',
          Math.abs(GAME.botSkill-AUTOSTART_SKILL/99)<1e-6,'botSkill='+num(GAME.botSkill));
      let leftover=null;try{leftover=localStorage.getItem('ihAutoStart');}catch(e){}
      chk('autostart: the one-shot key was consumed',leftover===null,'still set: '+leftover);
    });

    /* ---- 1. the lineup ---------------------------------------------- */
    step('lineup',()=>{
      const A=teamOf('A'),B=teamOf('B');
      chk('lineup: five a side',A.length===5&&B.length===5,'A='+A.length+' B='+B.length);
      const slots=t=>teamOf(t).map(s=>s.slot).sort().join('');
      chk('lineup: slots 1-5 both sides',slots('A')==='12345'&&slots('B')==='12345',
          'A='+slots('A')+' B='+slots('B'));
      const me=MATCH.skaters.find(s=>s.ent===player);
      chk('lineup: you start at centre',!!me&&me.slot===1&&me.team==='A','slot='+(me&&me.slot));
      /* left/right must MIRROR with the attacking direction. Team A attacks
         +z, so its left wing starts at -x; team B attacks -z, so its left
         wing starts at +x. A sign written once and never checked is exactly
         how "2 gives you the right winger" ships. */
      const ax=n=>slotOf('A',n).ent.pos.x, bx=n=>slotOf('B',n).ent.pos.x;
      chk('lineup: A LW is -x, RW is +x',ax(2)<-1&&ax(3)>1,'LW='+num(ax(2))+' RW='+num(ax(3)));
      chk('lineup: A LD is -x, RD is +x',ax(4)<-1&&ax(5)>1,'LD='+num(ax(4))+' RD='+num(ax(5)));
      chk('lineup: B mirrors A',bx(2)>1&&bx(3)<-1&&bx(4)>1&&bx(5)<-1,
          'B LW='+num(bx(2))+' RW='+num(bx(3))+' LD='+num(bx(4))+' RD='+num(bx(5)));
      /* the D start behind the forwards, on their own side of the draw */
      const az=n=>slotOf('A',n).ent.pos.z;
      chk('lineup: D start behind the forwards',az(4)<az(2)&&az(5)<az(3),
          'LD z='+num(az(4))+' LW z='+num(az(2)));
    });

    /* ---- 2. a switch moves control, the AI, and both sticks ---------- */
    step('switch',()=>{
      puck.possessed=false;puck.control=0;
      const before=player,beforeS=MATCH.skaters.find(s=>s.ent===before);
      const target=slotOf('A',3);
      press('3');
      chk('switch: player is the new body',player===target.ent&&player!==before,
          'slot now '+(MATCH.skaters.find(s=>s.ent===player)||{}).slot);
      chk('switch: the new body is ctrl p1',target.ctrl==='p1',target.ctrl);
      chk('switch: the body you left went back to the AI',beforeS.ctrl==='ai',beforeS.ctrl);
      chk('switch: the body you left has an ai brief',!!(beforeS.ai&&beforeS.ai.pos),
          JSON.stringify(beforeS.ai||null));
      /* the crude prop and the real GLB stick are different objects and both
         have to change hands, or one skater carries two and one carries none */
      chk('switch: you dropped the crude stick',!!target.ent.botStick&&target.ent.botStick.visible===false,
          String(target.ent.botStick&&target.ent.botStick.visible));
      chk('switch: the man you left got one',!!before.botStick&&before.botStick.visible===true,
          String(before.botStick&&before.botStick.visible));
      const armed=MATCH.skaters.filter(s=>s.ent.botStick&&s.ent.botStick.visible).length;
      chk('switch: exactly one skater is stickless',armed===MATCH.skaters.length-1,
          armed+' of '+MATCH.skaters.length+' hold a prop stick');
    });

    /* ---- 2b. control is INPUT, not a pointer -------------------------
       Everything above proves `player` points somewhere new. This proves the
       human input stack actually drives it: hold forward and the body you
       switched to has to be the one that accelerates. */
    step('drives',()=>{
      /* Park the puck on the OPPOSITION first. Left loose it is a live
         faceoff puck, a teammate wins it inside thirty frames and the
         auto-switch correctly takes the body out from under the test — which
         is the feature working, and would read here as the test failing. */
      const opp=slotOf('B',1);opp.ent.hasPuck=true;puck.possessed=false;puck.control=0;
      const me=player,left=slotOf('A',1).ent;
      me.vel.set(0,0,0);
      const startPos=me.pos.clone(),leftStart=left.pos.clone();
      keys['w']=true;run(30);keys['w']=false;
      const moved=me.pos.distanceTo(startPos);
      chk('drives: the body you switched to answers the keys',moved>0.5,
          'moved '+num(moved)+' m in 30 frames');
      chk('drives: it is still the body you took',player===me);
      /* and the body you handed back is being SKATED by the AI, not parked */
      chk('drives: the body you left is on the AI, not frozen',
          left.pos.distanceTo(leftStart)>0.05,'moved '+num(left.pos.distanceTo(leftStart))+' m');
      opp.ent.hasPuck=false;
    });

    /* ---- 3. the possession lock -------------------------------------- */
    step('lock',()=>{
      const held=player;
      puck.possessed=true;puck.control=1;
      chk('lock: carrying blocks the switch keys',vsCanSwitch()===false,'canSwitch='+vsCanSwitch());
      press('5');
      chk('lock: the key really did nothing',player===held,'player changed while carrying');
      /* an AI teammate carrying it locks you too — you would BE him */
      puck.possessed=false;puck.control=0;
      const mate=slotOf('A',4);mate.ent.hasPuck=true;
      chk('lock: a teammate carrying locks it too',vsCanSwitch()===false);
      mate.ent.hasPuck=false;
      chk('lock: playing it away unlocks',vsCanSwitch()===true);
    });

    /* ---- 4. auto-switch, and the puck comes with it ------------------ */
    step('auto',()=>{
      puck.possessed=false;puck.control=0;
      const mate=slotOf('A',5),before=player;
      chk('auto: precondition — not already him',before!==mate.ent);
      mate.ent.hasPuck=true;
      vsAutoSwitch();
      chk('auto: you became the man who won it',player===mate.ent);
      chk('auto: and you have the puck',puck.possessed===true,'possessed='+puck.possessed);
      chk('auto: the AI flag was consumed, not left set',mate.ent.hasPuck===false,
          'hasPuck='+mate.ent.hasPuck);
      chk('auto: the body you left is not carrying it',before.hasPuck===false,
          'hasPuck='+before.hasPuck);
      /* the opposition winning it must NOT drag control anywhere */
      puck.possessed=false;puck.control=0;
      const opp=slotOf('B',1),mine=player;
      opp.ent.hasPuck=true;vsAutoSwitch();
      chk('auto: an opponent winning it changes nothing',player===mine);
      opp.ent.hasPuck=false;
    });

    /* ---- 5. the goalie is the third case ----------------------------- */
    step('goalie',()=>{
      puck.possessed=false;puck.control=0;
      goalie.coverT=1.0;
      chk('goalie: our goalie holding it reads as held',vsGoalieHoldsPuck()===true);
      chk('goalie: it does NOT lock the switch keys',vsCanSwitch()===true);
      const before=player;
      vsAutoSwitch();
      chk('goalie: auto-switch never targets the goalie',player===before&&player!==goalie);
      const target=slotOf('A',2);
      press('2');
      chk('goalie: you can still take a skater',player===target.ent);
      const held=player;
      press('6');
      chk('goalie: key 6 is prepared but inert',player===held,'control moved onto the goalie');
      goalie.coverT=0;
    });

    /* ---- 6. inert outside VS ----------------------------------------- */
    step('inert',()=>{
      MATCH.vs=false;
      const held=player;
      chk('inert: vsActive is false off VS',vsActive()===false);
      chk('inert: the switch call refuses',vsSwitchToSlot(1)===false);
      press('1');
      chk('inert: and the key does nothing',player===held);
      MATCH.vs=true;
    });

    /* ---- 7. leaving VS hands P1 his own body back -------------------- */
    step('restore',()=>{
      const target=slotOf('A',4);
      puck.possessed=false;puck.control=0;
      press('4');
      chk('restore: precondition — driving a pool body',player===target.ent&&player!==p1Body);
      matchTeardown();
      chk('restore: you are back in P1 own body',player===p1Body,'player!==p1Body');
      chk('restore: and it is holding the real stick',p1Body.botStick?p1Body.botStick.visible===false:true);
      chk('restore: MATCH.vs cleared',MATCH.vs===false);
    });

    /* ---- 8. a hundred frames after all that, nothing throws ---------- */
    step('frames',()=>{
      const errsBefore=tickErr.seen?Object.keys(tickErr.seen).length:0;
      run(100);
      const errsAfter=tickErr.seen?Object.keys(tickErr.seen).length:0;
      chk('frames: 100 clean frames after the swaps',errsAfter===errsBefore,
          (errsAfter-errsBefore)+' new tick errors');
    });

    report();
  });
})();
