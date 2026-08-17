/* stickprobe.js — does the clip-owned stick land where Blender says it should?

   The seven stance clips in IH_CLIP_GRIP now carry the animator's raw arms
   (assets/anim-bake/merge_raw.py) and take their shaft from his own grip
   (IH_GRIP_FRAMES). This sweeps each clip end to end in the real build and
   compares the rendered blade's height against the range measured independently
   in Blender by assets/anim-bake/sticklock.py.

   NOT a self-check: the expected ranges come out of the .blend through a
   different program in a different language, and the number compared against
   them is read off the rendered stick mesh (stickVis), not off the offsets that
   were fed in. See feedback-tautological-verification.

   Controls matter as much as the subjects, so IdleL (authored arms, no clip
   stick) and WalkForward (still the 08-01 bake) are swept too and must be
   UNCHANGED — this feature is not allowed to touch them.

   The handle layer is forced off: it re-aims the shaft by up to 91.7 deg and
   would be measuring itself (gripshot.js).
*/
(function () {
  var OUT = [], FAIL = 0;
  function log(k, v) { OUT.push(k + '=' + v); }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); report(); });
  function report() {
    var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function () {});
    setTimeout(function () { try { fetch(q); } catch (e) {} }, 300);
  }

  /* min,max blade height in metres, from assets/anim-bake/sticklock.py run on
     'hasa1992 - 3D Low Poly with Rig.blend'.

     THESE ARE BLENDER METRES AND THE BUILD IS BIGGER. hand_l's world scale here
     is 0.9744 against the metarig's own 0.901369, so the character carries an
     extra 1.081 on top and every world height in the game is 1.081x the same
     height in the blend. Comparing raw gave a uniform 8% overshoot on all seven
     clips, which reads exactly like a systematic bug and is a unit mismatch.
     The factor is DERIVED from the running build below, never typed in, so it
     cannot quietly absorb a real error. */
  var EXPECT = {
    IdleForeHandPulledBack: [0.081, 0.084],
    IdleBackHandToForeHand: [0.024, 0.140],
    IdleForeHandToBackHand: [0.024, 0.136],
    SpinoramaL:             [0.007, 0.257],
    SpinoramaR:             [0.007, 0.223],
    WindmillDekeL:          [0.017, 0.967],
    WindmillDekeR:          [0.024, 0.997]
  };
  var CONTROLS = ['IdleL', 'WalkForward'];
  var TOL = 0.02;
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

  /* Sample at the clip's OWN 24 fps frame times, which is where sticklock.py
     sampled in Blender. Sampling some other count reads peaks between the
     animator's keys: at 17 phases the windmills' fast blade sweep came out
     0.011 m above the Blender maximum and looked like a defect. Compare like
     with like rather than widening a tolerance until it passes. */
  function sweep(name) {
    var clip = player.mixer._actions.map(function (a) { return a._clip; })
      .filter(function (c) { return c.name === name; })[0];
    if (!clip) return null;
    var nphase = Math.max(2, Math.round(clip.duration * 24) + 1);
    var act = player.mixer.clipAction(clip);
    var lo = 1e9, hi = -1e9, wmin = 1e9, wmax = -1e9;
    for (var i = 0; i < nphase; i++) {
      var ph = i / (nphase - 1);
      player.mixer._actions.forEach(function (a) { if (a !== act) a.stop(); });
      act.reset(); act.play(); act.setEffectiveWeight(1);
      act.time = clip.duration * ph;
      player.mixer.time = 0;
      player.mixer.update(0);
      player.handleBlend = 0;
      try { poseStick(player, null, 1 / 60); } catch (e) { OUT.push('POSEERR=' + e.message); return null; }
      var y = player.stickVis ? player.stickVis.y : NaN;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
      var w = player.clipStickW || 0;
      if (w < wmin) wmin = w;
      if (w > wmax) wmax = w;
    }
    return { lo: lo, hi: hi, wmin: wmin, wmax: wmax };
  }

  function run() {
    window.requestAnimationFrame = function () { return 0; };
    clock.getDelta = function () { return 1 / 60; };
    for (var i = 0; i < 40; i++) { try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); break; } }
    var savedAuth = CONFIG.handleAuthority;
    CONFIG.handleAuthority = 0;

    var hs = new THREE.Vector3();
    player.joints.hand_l.updateWorldMatrix(true, false);
    player.joints.hand_l.matrixWorld.decompose(
      new THREE.Vector3(), new THREE.Quaternion(), hs);
    var K = hs.x / METARIG_SCALE;
    log('blenderToGameScale', K.toFixed(4));

    Object.keys(EXPECT).forEach(function (nm) {
      var r = sweep(nm);
      if (!r) { log('MISSING_' + nm, 'clip not in payload'); FAIL++; return; }
      var e = [EXPECT[nm][0] * K, EXPECT[nm][1] * K];
      var ok = (r.lo > e[0] - TOL) && (r.hi < e[1] + TOL) && r.wmax > 0.9;
      if (!ok) FAIL++;
      log(nm, 'blade ' + r.lo.toFixed(3) + '..' + r.hi.toFixed(3) +
             ' expect ' + e[0].toFixed(3) + '..' + e[1].toFixed(3) +
             ' clipW ' + r.wmax.toFixed(2) + ' ' + (ok ? 'PASS' : 'FAIL'));
    });

    CONTROLS.forEach(function (nm) {
      var r = sweep(nm);
      if (!r) { log('MISSING_' + nm, 'clip not in payload'); FAIL++; return; }
      /* a control must NOT have taken a clip stick */
      var ok = r.wmax < 0.001;
      if (!ok) FAIL++;
      log('control_' + nm, 'blade ' + r.lo.toFixed(3) + '..' + r.hi.toFixed(3) +
          ' clipW ' + r.wmax.toFixed(3) + ' ' +
          (ok ? 'PASS (untouched)' : 'FAIL (took a clip stick)'));
    });

    CONFIG.handleAuthority = savedAuth;
    log('FAILURES', FAIL);
    log('VERDICT', FAIL === 0 ? 'CLIP STICK OK' : 'CLIP STICK BROKEN');
    report();
  }
})();
