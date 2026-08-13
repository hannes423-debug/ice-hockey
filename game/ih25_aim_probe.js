/* The defect was: the camera used to UNPROJECT the aim ray was not the camera
   used to RENDER. Measure exactly that — snapshot camera.position when
   Raycaster.setFromCamera runs (the aim), and again at renderer.render, and
   report the gap. Also report how far the retired chase rig would have put
   the camera from the locked rig, which is the size of the old error. */
(function(){
  var OUT=[],maxGap=0,seen=0,atRay=null;
  function log(k,v){OUT.push(k+'='+v);}
  function report(){var q='/PROBE?'+OUT.map(encodeURIComponent).join('&');fetch(q).catch(function(){});setTimeout(function(){try{fetch(q);}catch(e){}},300);}
  addEventListener('error',function(e){OUT.push('JSERROR='+e.message);report();});
  function frame(){try{tick();}catch(e){OUT.push('TICKERR='+e.message);}}
  function run(n){for(var i=0;i<n;i++)frame();}
  var tries=0;
  (function wait(){
    var b=document.querySelector('#smStart');
    if(typeof player!=='undefined'&&player&&puck&&b){ b.click();
      setTimeout(function(){
        window.requestAnimationFrame=function(){return 0;}; clock.getDelta=function(){return 1/60;};
        // hook BOTH ends of the frame
        var sfc=THREE.Raycaster.prototype.setFromCamera;
        THREE.Raycaster.prototype.setFromCamera=function(ndc,cam){
          if(cam===camera){atRay=camera.position.clone();seen++;}
          return sfc.call(this,ndc,cam);
        };
        var inner=renderer.render.bind(renderer);
        renderer.render=function(sc,cam){
          if(cam===camera&&atRay){var d=atRay.distanceTo(camera.position); if(d>maxGap)maxGap=d; atRay=null;}
          return inner(sc,cam);
        };
        run(20);
        mouseCtl.active=true;
        for(var i=0;i<40;i++){
          var sx=(0.3+0.4*(i%5)/4)*innerWidth, sy=(0.3+0.4*((i/5|0)%5)/4)*innerHeight;
          try{mouseClientX=sx;mouseClientY=sy;}catch(e){}
          mouseCtl.ndc.x=(sx/innerWidth)*2-1; mouseCtl.ndc.y=-(sy/innerHeight)*2+1;
          frame();
        }
        log('build',window.IH25?'25d':'original');
        log('camYaw',(typeof camYaw!=='undefined'?camYaw.toFixed(4):'?'));
        log('aimRaycastsSeen',seen);
        log('camGap_rayVsRender_m',maxGap.toFixed(4));
        // how far off the RETIRED chase rig would have been
        var chase=new THREE.Vector3(player.pos.x,CONFIG.camHeight,player.pos.z-CONFIG.camDist);
        log('retiredChaseRigWouldBe_m_away',chase.distanceTo(camera.position).toFixed(1));
        log('VERDICT',maxGap<0.001?'ONE CAMERA PER FRAME':'CAMERA MOVES MID-FRAME');
        report();
      },300); return; }
    if(++tries>200){OUT.push('BOOT TIMEOUT');report();return;} setTimeout(wait,50);
  })();
})();
