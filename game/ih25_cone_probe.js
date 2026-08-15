/* ih25_cone_probe.js — is the drawn aim ribbon the shot you actually take?

   Three claims, measured separately, because they have different causes and
   only one of them is the d20:

     aimGapDeg     the previewed centreline vs the direction the shot was
                   actually launched on with the roll's yaw error taken back
                   out. Non-zero = the preview lied about DIRECTION.
     originGapLat  how far the puck sat, ACROSS the aim line, from the origin
                   the ribbon is drawn from. The ribbon starts at player.pos;
                   the puck leaves from puck.pos, so the drawn line and the
                   flown line are parallel but not the same line.
     outsideCone   the puck's worst angle off the previewed centreline (seen
                   from the previewed origin) minus the previewed cone half
                   angle. > 0 means the puck flew outside its own ribbon.
                   Measured only up to the first DEFLECTION — a puck that
                   rings off a post is allowed to leave the cone.

   Plus spread prev/fire, which is the "the cone goes from regular to wide
   right at the moment of release" report.

   TWO TRAPS, both of which produced confident wrong numbers first time:
   - fireShot rotates d by yawErr as x'=x*cos-z*sin, z'=x*sin+z*cos, which in
     the atan2(x,z) convention here is a NEGATIVE turn. Taking the roll back
     out therefore ADDS it. Backwards, it doubles every gap and a perfectly
     clean shot reads 3 deg off.
   - _writePath uses the module temporary _avA as its scratch vector, and
     _avA IS the vector aimViz.tick passes in as `aim`. Read `aim` AFTER
     calling updateAiming and you get the ribbon's last path sample, not the
     aim point — which reads as "the preview is aiming at the far boards". */
(function () {
  var OUT = [], TRIALS = [];
  function log(k, v) { OUT.push(k + '=' + v); }
  function report() {
    var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function () { });
    setTimeout(function () { try { fetch(q); } catch (e) { } }, 300);
  }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); report(); });

  var DEG = 180 / Math.PI;
  function ang(x, z) { return Math.atan2(x, z) * DEG; }
  function wrap(d) { d = (d + 180) % 360; if (d < 0) d += 360; return d - 180; }

  function frame() { try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); throw e; } }
  function run(n) { for (var i = 0; i < n; i++) frame(); }

  var tries = 0;
  (function wait() {
    var b = document.querySelector('#smStart');
    if (typeof player !== 'undefined' && player && typeof puck !== 'undefined' && puck && b) {
      b.click(); setTimeout(go, 400); return;
    }
    if (++tries > 300) { OUT.push('BOOT TIMEOUT'); report(); return; }
    setTimeout(wait, 50);
  })();

  function giveThePuck() {
    puck.possessed = true; puck.control = 1; puck.outOfPlay = false;
    puck.noPickupT = 0;
    puck.pos.copy(player.stickTip || player.pos);
    puck.pos.y = CONFIG.puckRadius;
    puck.vel.set(0, 0, 0);
  }

  /* opt: {pre, curve, flick, maxFrames} */
  function trial(name, px, pz, heading, aimX, aimZ, opt) {
    opt = opt || {};
    var T = { name: name };
    player.pos.set(px, player.pos.y, pz);
    player.heading = heading;
    player.vel.set(0, 0, 0);
    player.turnShot = null; player.turnShotErr = 0; player.forcedAim = null;
    player.shotType = 'none'; player.shotSuppressed = false;
    lmbHeld = false; rmbHeld = false;
    mouseCtl.active = true;
    giveThePuck(); run(6); giveThePuck();
    if (opt.pre) opt.pre();

    var aimW = new THREE.Vector3(aimX, CONFIG.iceHeight, aimZ);
    var sp = projectToScreen(aimW);
    var startSp = { x: sp.x, y: sp.y + 220 };

    var lastAim = null, fired = null;
    var oldUpd = aimViz.updateAiming.bind(aimViz), oldFire = aimViz.fire.bind(aimViz);
    aimViz.updateAiming = function (type, aim) {
      /* READ FIRST — updateAiming clobbers `aim` (it is _avA, _writePath's
         scratch). And measure the centreline from the ORIGIN THE PREVIEW USES
         (shotAimFrame -> the puck), not from the body: measuring the drawn
         line against the wrong origin invents a degree of error that is not
         on screen, and hides the one that is. */
      /* On the UNFIXED build there is no shotAimFrame and the ribbon is drawn
         from the body — so measure it the way THAT build draws it, or the
         comparison scores the fix against a ruler only the fix owns. */
      var fr = { x: 0, z: 0, ox: 0, oz: 0 }, dl;
      if (typeof shotAimFrame === 'function') dl = shotAimFrame(aim.x, aim.z, fr);
      else {
        var ux = aim.x - player.pos.x, uz = aim.z - player.pos.z;
        dl = Math.hypot(ux, uz) || 1;
        fr.x = ux / dl; fr.z = uz / dl; fr.ox = player.pos.x; fr.oz = player.pos.z;
      }
      var snap = {
        ox: fr.ox, oz: fr.oz,
        ax: aim.x, az: aim.z, ay: aim.y,
        mx: mouseClientX, my: mouseClientY,
        dir: ang(fr.x, fr.z), dl: dl,
        pow: gestPow(), type: type
      };
      var r = oldUpd(type, aim);
      // the cone actually drawn; the unfixed build has no shownErr to publish
      snap.errDeg = (aimViz.shownErr != null ? aimViz.shownErr : computeAimError(dl)) * DEG;
      snap.spread = aimViz.lastSpread || 0;
      snap.endx = aimViz.endPt.x; snap.endz = aimViz.endPt.z;
      lastAim = snap;
      return r;
    };
    aimViz.fire = function (info) {
      var hl = Math.hypot(info.dir.x, info.dir.z) || 1;
      var fresh = new THREE.Vector3(); mouseTPSPoint(fresh);
      var preAtFire = lastAim;      // the ribbon that was ON SCREEN when it went
      var r = oldFire(info);
      fired = {
        pre: preAtFire,
        ax: fresh.x, az: fresh.z,
        forced: !!player.forcedAim, turning: !!player.turnShot,
        turnErrDeg: (player.turnShotErr || 0) * DEG,
        dir: ang(info.dir.x / hl, info.dir.z / hl),
        errDeg: (info.errMax || 0) * DEG,
        roll: info.roll, type: info.type,
        yawErrDeg: ((info.roll - 10.5) / 9.5) * (info.errMax || 0) * DEG,
        speed: info.speed, launchDeg: (info.launchAngle || 0) * DEG,
        spread: aimViz.lastSpread || 0, endx: aimViz.endPt.x, endz: aimViz.endPt.z,
        px: puck.pos.x, pz: puck.pos.z, plx: player.pos.x, plz: player.pos.z
      };
      return r;
    };

    mouseClientX = startSp.x; mouseClientY = startSp.y;
    lmbHeld = true;
    run(2);
    var STEPS = 6, i, f;
    for (i = 1; i <= STEPS; i++) {
      // flick: ease-IN, so nearly all the pointer speed lands in the last frame
      f = opt.flick ? Math.pow(i / STEPS, 3) : i / STEPS;
      mouseClientX = startSp.x + (sp.x - startSp.x) * f;
      mouseClientY = startSp.y + (sp.y - startSp.y) * f;
      // curve: bow the stroke sideways so gestureAnalyze calls it curved
      if (opt.curve) mouseClientX += Math.sin(f * Math.PI) * 190;
      mouseCtl.ndc.x = (mouseClientX / innerWidth) * 2 - 1;
      mouseCtl.ndc.y = -(mouseClientY / innerHeight) * 2 + 1;
      frame();
    }
    frame();                      // settle a frame on the target
    lmbHeld = false;
    frame();                      // release fires here (or starts a turn shot)
    // a turn-into-the-shot fires up to turnShotMaxDur later
    for (i = 0; i < 40 && !fired; i++) frame();

    aimViz.updateAiming = oldUpd; aimViz.fire = oldFire;
    /* the preview to judge against is the last one DRAWN BEFORE THE SHOT, not
       the one showing when the button came up: a turn-into-the-shot keeps
       previewing through the pivot and fires up to 0.42 s later. */
    var pre = fired && fired.pre;
    if (!pre || !fired) { T.err = 'no ' + (!pre ? 'preview' : 'fire'); TRIALS.push(T); return T; }

    T.prevAim = pre.ax.toFixed(2) + ',' + pre.az.toFixed(2);
    T.fireAim = fired.ax.toFixed(2) + ',' + fired.az.toFixed(2);
    T.types = pre.type + '->' + fired.type;
    T.prevDir = pre.dir; T.prevErr = pre.errDeg; T.prevSpread = pre.spread;
    T.fireErr = fired.errDeg; T.fireSpread = fired.spread;
    T.turnErr = fired.turnErrDeg; T.roll = fired.roll;
    T.prevR = Math.hypot(pre.endx - pre.ox, pre.endz - pre.oz);
    T.fireR = Math.hypot(fired.endx - fired.px, fired.endz - fired.pz);
    T.launch = fired.launchDeg; T.speed = fired.speed;
    T.preRollDir = wrap(fired.dir + fired.yawErrDeg);
    T.aimGap = wrap(T.preRollDir - pre.dir);
    var adx = Math.sin(pre.dir / DEG), adz = Math.cos(pre.dir / DEG);
    T.originGapLat = (fired.px - pre.ox) * adz - (fired.pz - pre.oz) * adx;

    /* fly it. Stop at the first DEFLECTION — a post, a body, a board — since
       the ribbon is only claiming to bound the FLIGHT. Detected as an abrupt
       turn in the puck's own horizontal velocity, which is what every one of
       those does and nothing in free flight does. */
    /* IS THE PUCK INSIDE THE DRAWN RIBBON — in metres, not degrees. An
       angular test explodes in the first metre (0.2 m off the line is 16 deg
       at 0.7 m and 0.4 deg at 30 m) and reports a catastrophe where the eye
       sees a puck sitting on its own ribbon. The ribbon is a tube: half-width
       at distance s along the centreline is its base radius plus the cone,
       which is exactly what is drawn (uRadiusStart -> uRadiusEnd). */
    var adx2 = Math.sin(pre.dir / DEG), adz2 = Math.cos(pre.dir / DEG);
    var worstM = -99, wd = 0, lastVDir = null, deflected = 0;
    var coneTan = Math.tan(pre.errDeg / DEG);
    for (f = 0; f < 120; f++) {
      frame();
      if (puck.possessed || puck.outOfPlay) break;
      var vl = Math.hypot(puck.vel.x, puck.vel.z);
      if (vl > 0.5) {
        var vd = ang(puck.vel.x / vl, puck.vel.z / vl);
        if (lastVDir !== null && Math.abs(wrap(vd - lastVDir)) > 3) { deflected = 1; break; }
        lastVDir = vd;
      }
      var qx = puck.pos.x - pre.ox, qz = puck.pos.z - pre.oz;
      var along = qx * adx2 + qz * adz2;
      if (along < 0.05) continue;
      var lat = Math.abs(qx * adz2 - qz * adx2);
      var halfW = 0.14 + coneTan * along;          // AVZ_R + the cone
      if (lat - halfW > worstM) { worstM = lat - halfW; wd = along; }
    }
    T.deflected = deflected;
    T.puckWorstOff = worstM; T.puckWorstDist = wd;
    T.outsideCone = worstM;
    TRIALS.push(T);
    return T;
  }

  function go() {
    window.requestAnimationFrame = function () { return 0; };
    clock.getDelta = function () { return 1 / 60; };
    run(20);
    mouseCtl.active = true;
    try {
      trial('still', 0, -10, 0, 0, 12);
      trial('offaxis', -6, 0, 0, 5, 14);
      trial('moving', 0, -6, 0, 0, 12, { pre: function () { player.vel.set(0, 0, CONFIG.moveSpeed * 0.9); } });
      trial('flick', 0, -10, 0, 0, 12, { flick: 1 });
      trial('curveswipe', 0, -10, 0, 0, 12, { curve: 1 });
      trial('turnshot', 0, 0, Math.PI, 0, 14);      // target ~180 deg behind
    } catch (e) { OUT.push('TRIALERR=' + e.message); }

    log('trials', TRIALS.length);
    var maxAim = 0, maxOut = -999, maxJump = 0, maxCone = 0;
    TRIALS.forEach(function (T) {
      if (T.err) { log(T.name, 'FAILED ' + T.err); return; }
      log(T.name,
        T.types + ' | aimGap ' + T.aimGap.toFixed(2) + ' deg' +
        ' | cone prev ' + T.prevErr.toFixed(2) + ' fire ' + T.fireErr.toFixed(2) +
        (T.turnErr > 0.01 ? ' (turnErr ' + T.turnErr.toFixed(2) + ')' : '') +
        ' | spread prev ' + T.prevSpread.toFixed(2) + ' fire ' + T.fireSpread.toFixed(2) +
        ' | R prev ' + T.prevR.toFixed(2) + ' fire ' + T.fireR.toFixed(2) +
        ' | originLat ' + T.originGapLat.toFixed(3) + ' m' +
        ' | outsideRibbon ' + T.outsideCone.toFixed(3) + ' m at ' + T.puckWorstDist.toFixed(1) + ' m' +
        (T.deflected ? ' (stopped at deflection)' : '') +
        ' | roll ' + T.roll + ' launch ' + T.launch.toFixed(1) + ' speed ' + T.speed.toFixed(1));
      maxAim = Math.max(maxAim, Math.abs(T.aimGap));
      maxOut = Math.max(maxOut, T.outsideCone);
      maxJump = Math.max(maxJump, Math.abs(T.fireSpread - T.prevSpread));
      maxCone = Math.max(maxCone, Math.abs(T.fireErr - T.prevErr));
    });
    log('maxAimGapDeg', maxAim.toFixed(3));
    log('maxOutsideRibbon_m', maxOut.toFixed(3));
    log('maxConeJumpDeg', maxCone.toFixed(3));
    /* The residual spread jump is NOT a cone jump: the ribbon ends where the
       flight ends, so as the aim drifts across the goal mouth the end snaps
       between the net and the boards behind it, and the drawn half-width at
       that end moves with it. That is the ribbon being honest about a
       genuinely different flight, so it is reported, not asserted. */
    log('spreadJump_m_endSnap', maxJump.toFixed(3));
    log('VERDICT', (maxAim < 0.5 && maxOut < 0 && maxCone < 0.01)
      ? 'RIBBON IS THE SHOT' : 'RIBBON DISAGREES WITH THE SHOT');
    report();
  }
})();
