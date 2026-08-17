/* bhprobe.js — does a BACKHAND actually play the backhand clip?

   `type==='backhand'` has been a first-class shot in the sim for a long time
   (its own speed range, follow duration and HUD label) but there was no
   backhand ANIMATION, so it fired the forehand wrist-shot clip. The animator's
   2026-08-17 IK delivery adds one; assets/anim-bake/merge_ik2.py appends it to
   the payload and fireShot picks it.

   Every assertion here is written to FAIL on the pre-change build:
     ./bhprobe.sh 600x600 ice_hockey.html.bak_pre_ik2_0817
   The clip is absent there, so binding, selection and geometry all fail — that
   is the point (see feedback-verify-with-real-repro).

   The geometry check is not a self-check: the expected blade range comes out of
   the .blend through assets/anim-bake/stickpose.py, in another language, and is
   compared against the height read off the RENDERED stick mesh (stickVis). The
   Blender-to-game scale factor is derived from the running build the same way
   stickprobe.js derives it, never typed in.
*/
(function () {
  var OUT = [], FAIL = 0;
  function log(k, v) { OUT.push(k + '=' + v); }
  function chk(k, ok, detail) { if (!ok) FAIL++; log(k, detail + ' ' + (ok ? 'PASS' : 'FAIL')); }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); report(); });
  function report() {
    var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function () {});
    setTimeout(function () { try { fetch(q); } catch (e) {} }, 300);
  }

  /* stickpose.py on 'hasa1992 - 3D Low Poly with IK Rig only.blend':
     3BackHandShot blade tip -0.061 .. 0.878 m — it reaches the ice and lifts
     into a follow-through. That SHAPE is the assertion: the six clips the
     animator has not re-posed never come below 0.55 m, so a clip that touches
     the ice cannot be one of them or a floating rest stick. */
  var BLEND_LO = -0.061, BLEND_HI = 0.878;
  var ON_ICE = 0.15;          // must come at least this close to the sheet
  var METARIG_SCALE = 0.901369;   // scalecheck.py, identical in both blends

  var tries = 0;
  (function wait() {
    var start = document.querySelector('#smStart');
    var booted = typeof player !== 'undefined' && player && player.joints &&
                 typeof puck !== 'undefined' && puck && start;
    if (booted && !wait.clicked) { wait.clicked = true; start.click(); }
    if (wait.clicked && typeof player !== 'undefined' && player &&
        player.mixer && player.actions && player.actions.idle) return run();
    if (++tries > 150) { OUT.push('WAITFAIL=' + (typeof player)); return report(); }
    setTimeout(wait, 200);
  })();

  function clipNamed(name) {
    return player.mixer._actions.map(function (a) { return a._clip; })
      .filter(function (c) { return c.name === name; })[0] || null;
  }

  /* Same sampling rule as stickprobe.js: the clip's OWN 24 fps frame times, so
     we read the animator's keys rather than peaks between them. */
  function sweep(name) {
    var clip = clipNamed(name);
    if (!clip) return null;
    var nphase = Math.max(2, Math.round(clip.duration * 24) + 1);
    var act = player.mixer.clipAction(clip);
    var lo = 1e9, hi = -1e9;
    for (var i = 0; i < nphase; i++) {
      player.mixer._actions.forEach(function (a) { if (a !== act) a.stop(); });
      act.reset(); act.play(); act.setEffectiveWeight(1);
      act.time = clip.duration * (i / (nphase - 1));
      player.mixer.time = 0;
      player.mixer.update(0);
      player.handleBlend = 0;
      try { poseStick(player, null, 1 / 60); } catch (e) { OUT.push('POSEERR=' + e.message); return null; }
      var y = player.stickVis ? player.stickVis.y : NaN;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    return { lo: lo, hi: hi };
  }

  /* Which clip does a shot of this type actually start? Read off curAction
     after fireShot, which is the thing the player sees — not off the binding
     table, which is what we are trying to prove is wired up. */
  function firedClip(type) {
    player.oneShot = 0; player.holdAct = null;
    puck.pos.copy(player.pos); puck.pos.y = 0.03;
    puck.possessed = player; player.hasPuck = true;
    /* fireShot(type, oneTimerInSpeed, gestInfo) — it takes the TYPE first and
       acts on the global `player`, it does not take an entity. Passing an
       entity makes `type` a truthy non-string, so every branch falls through
       to the wrist clip and all three shot types report 'Shooting'. */
    try { fireShot(type); } catch (e) { OUT.push('FIREERR=' + e.message); return '(threw)'; }
    return (player.curAction && player.curAction._clip) ? player.curAction._clip.name : '(none)';
  }

  function run() {
    window.requestAnimationFrame = function () { return 0; };
    clock.getDelta = function () { return 1 / 60; };
    for (var i = 0; i < 40; i++) { try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); break; } }

    /* 1. the clip is in the payload at all */
    chk('payloadHasClip', !!clipNamed('BackHandShot'),
        'clips=' + player.mixer._actions.length);

    /* 2. it is bound */
    chk('bound', !!player.actions.backhandShot,
        'actions.backhandShot=' + (player.actions.backhandShot ? 'set' : 'null'));

    /* 3. selection — a backhand plays it, and the other two are UNCHANGED */
    var bh = firedClip('backhand'), wr = firedClip('wrist'), sl = firedClip('slap');
    chk('backhandPlaysBackhand', bh === 'BackHandShot', 'fired=' + bh);
    chk('wristUnchanged', wr === 'Shooting', 'fired=' + wr);
    chk('slapUnchanged', sl === 'SlapShot', 'fired=' + sl);

    /* 4. geometry — the rendered blade against Blender */
    var savedAuth = CONFIG.handleAuthority;
    CONFIG.handleAuthority = 0;
    var hs = new THREE.Vector3();
    player.joints.hand_l.updateWorldMatrix(true, false);
    player.joints.hand_l.matrixWorld.decompose(
      new THREE.Vector3(), new THREE.Quaternion(), hs);
    var K = hs.x / METARIG_SCALE;
    log('blenderToGameScale', K.toFixed(4));

    var r = sweep('BackHandShot');
    if (!r) { chk('blade', false, 'clip not in payload'); }
    else {
      log('bladeRange', r.lo.toFixed(3) + '..' + r.hi.toFixed(3) +
          ' blender ' + (BLEND_LO * K).toFixed(3) + '..' + (BLEND_HI * K).toFixed(3));
      chk('bladeReachesIce', r.lo < ON_ICE * K, 'min=' + r.lo.toFixed(3));
      chk('bladeLifts', r.hi > 0.5 * K, 'max=' + r.hi.toFixed(3));
    }
    CONFIG.handleAuthority = savedAuth;

    log('FAILURES', FAIL);
    log('VERDICT', FAIL === 0 ? 'BACKHAND CLIP OK' : 'BACKHAND CLIP BROKEN');
    report();
  }
})();
