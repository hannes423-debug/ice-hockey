(function(){
  var OUT=[];function log(k,v){OUT.push(k+'='+v);}
  function report(){var q='/PROBE?'+OUT.map(encodeURIComponent).join('&');fetch(q).catch(function(){});setTimeout(function(){try{fetch(q);}catch(e){}},300);}
  addEventListener('error',function(e){OUT.push('JSERROR='+e.message);report();});
  function frame(){try{tick();}catch(e){OUT.push('TICKERR='+e.message);}}
  function run(n){for(var i=0;i<n;i++)frame();}
  function target(){ if(typeof bot!=='undefined'&&bot)return bot; if(typeof goalie!=='undefined'&&goalie)return goalie; return null; }
  var tries=0;
  (function wait(){
    var b=document.querySelector('#smStart');
    if(typeof player!=='undefined'&&player&&puck&&b){ b.click();
      setTimeout(function(){
        window.requestAnimationFrame=function(){return 0;}; clock.getDelta=function(){return 1/60;};
        run(30);
        var is25=!!window.IH25; log('build',is25?'25d':'original');
        var T=target();
        player.pos.set(-14,0,-14); if(player.vel)player.vel.set(0,0,0);
        // ---- puck fired straight at a stationary skater ----
        T.pos.set(0,0,4); if(T.vel)T.vel.set(0,0,0); if(T.stickTip)T.stickTip.set(0,0,4);
        puck.possessed=false; puck.control=0; puck.outOfPlay=false; puck.noPickupT=99; puck.noPickupBotT=99;
        puck.pos.set(0,CONFIG.puckRadius,0); puck.vel.set(0,0,14);
        var minD=99, passed=false;
        for(var i=0;i<70;i++){ T.pos.set(0,0,4); if(T.vel)T.vel.set(0,0,0);
          frame(); puck.noPickupT=99; puck.noPickupBotT=99;
          var d=Math.hypot(puck.pos.x-0,puck.pos.z-4); if(d<minD)minD=d;
          if(puck.pos.z>4.5)passed=true; }
        log('BODY.minDistance',minD.toFixed(3));
        log('BODY.puckPassedThrough',passed);
        log('BODY.vzAfter',puck.vel.z.toFixed(2));
        // ---- puck fired at a goal post ----
        var gz=is25?IH25.goalZ:(CONFIG.roomHalfD-11*0.3048), gx=is25?IH25.goalHalfW:3*0.3048;
        puck.pos.set(gx,CONFIG.puckRadius,gz-3); puck.vel.set(0,0,10);
        var minP=99;
        for(var j=0;j<60;j++){ frame(); puck.noPickupT=99; puck.noPickupBotT=99;
          var dp=Math.hypot(puck.pos.x-gx,puck.pos.z-gz); if(dp<minP)minP=dp; }
        log('POST.minDistance',minP.toFixed(3));
        log('POST.vzAfter',puck.vel.z.toFixed(2));
        report();
      },300); return; }
    if(++tries>200){OUT.push('BOOT TIMEOUT');report();return;} setTimeout(wait,50);
  })();
})();
