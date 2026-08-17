/* handframe.js — is the GAME's hand-local frame the same frame Blender measured in?

   The stick offsets fitted in assets/anim-bake (butt and tip as two points in
   hand.L's local space) are only transplantable into the build if the build's
   `hand_l` bone carries the same local axes and the same scale as Blender's
   `hand.L` pose bone. The model is not the metarig -- clips are remapped onto
   it by remapBoneNames -- so that has to be MEASURED, never assumed.

   The test needs no stick at all. Take other bones whose positions both
   systems agree on, express them in hand_l's local frame, and compare with the
   same quantity computed in Blender for the same clip and frame. Matching
   numbers mean one frame; a permutation or a scale factor shows up immediately
   as a swapped axis or a constant ratio.

   window.HF_CLIP   payload clip name, e.g. 'IdleL'
   window.HF_PHASE  0..1 through the clip

   The handle layer is forced OFF: it re-aims the shaft by up to 91.7 deg and
   would be measuring itself rather than the clip (see gripshot.js).
*/
(function () {
  var OUT = [];
  function log(k, v) { OUT.push(k + '=' + v); }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); });
  function done() {
    var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function () {});
    setTimeout(function () { try { fetch(q); } catch (e) {} }, 300);
  }

  var tries = 0;
  (function wait() {
    var start = document.querySelector('#smStart');
    var booted = typeof player !== 'undefined' && player && player.joints &&
                 typeof puck !== 'undefined' && puck && start;
    if (booted && !wait.clicked) { wait.clicked = true; start.click(); }
    if (wait.clicked && typeof player !== 'undefined' && player &&
        player.mixer && player.actions && player.actions.idle) return run();
    if (++tries > 150) { OUT.push('WAITFAIL=' + (typeof player)); return done(); }
    setTimeout(wait, 200);
  })();

  function v3(v) { return v.x.toFixed(4) + ',' + v.y.toFixed(4) + ',' + v.z.toFixed(4); }

  function run() {
    window.requestAnimationFrame = function () { return 0; };
    clock.getDelta = function () { return 1 / 60; };
    var name = window.HF_CLIP || 'IdleL';
    var phase = window.HF_PHASE === undefined ? 0.5 : window.HF_PHASE;

    for (var i = 0; i < 40; i++) { try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); break; } }

    var clip = player.mixer._actions.map(function (a) { return a._clip; })
      .filter(function (c) { return c.name === name; })[0];
    if (!clip) { log('CLIPMISSING', name); return done(); }
    var act = player.mixer.clipAction(clip);
    var savedAuth = CONFIG.handleAuthority;
    CONFIG.handleAuthority = 0;
    function force() {
      player.mixer._actions.forEach(function (a) { if (a !== act) a.stop(); });
      act.reset(); act.play(); act.setEffectiveWeight(1);
      act.time = clip.duration * phase;
      player.mixer.time = 0;
      player.mixer.update(0);
      player.handleBlend = 0;
    }
    for (var k = 0; k < 6; k++) { force(); try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); break; } }
    force();
    try { poseStick(player, null, 1 / 60); } catch (e) { OUT.push('POSEERR=' + e.message); }

    var J = player.joints;
    player.root.updateWorldMatrix(true, true);
    var HL = J.hand_l;
    HL.updateWorldMatrix(true, false);
    var inv = new THREE.Matrix4().copy(HL.matrixWorld).invert();

    log('clip', name);
    log('phase', phase);
    log('handleBlend', (player.handleBlend || 0).toFixed(3));
    log('clipDuration', clip.duration.toFixed(4));

    /* hand_l's own world scale: if the model was imported at a different scale
       than the metarig, every local offset needs that factor and nothing else
       in this dump would reveal it. */
    var s = new THREE.Vector3();
    HL.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    log('hand_l_worldScale', v3(s));
    log('hand_l_worldPos', v3(new THREE.Vector3().setFromMatrixPosition(HL.matrixWorld)));

    /* the comparison itself: other bones, in hand_l's local frame */
    ['hand_r', 'lowerarm_l', 'upperarm_l', 'head', 'foot_r', 'spine_01'].forEach(function (bn) {
      var b = J[bn];
      if (!b) { log('local_' + bn, 'ABSENT'); return; }
      b.updateWorldMatrix(true, false);
      var p = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv);
      log('local_' + bn, v3(p));
    });

    /* and what the build currently makes of the stick, for the record */
    if (player.stickGrip) log('gameGrip', v3(player.stickGrip));
    if (player.stickVis) {
      log('gameBladeTip', v3(player.stickVis));
      log('gameBladeY', player.stickVis.y.toFixed(4));
      log('gameBladeTipLocal', v3(player.stickVis.clone().applyMatrix4(inv)));
    }
    if (player.stickDir) log('gameShaftDirLocal',
      v3(player.stickDir.clone().transformDirection(inv)));
    var cfd = (typeof ihClipStickFrame === 'function') ? ihClipStickFrame(player) : null;
    if (cfd) {
      log('authoredTipY', cfd.tip.y.toFixed(4));
      log('authoredButtY', cfd.butt.y.toFixed(4));
      log('mixerWeight', cfd.w.toFixed(3));
    }
    if (player.clipStickTip) log('tipAtUseY', player.clipStickTip.y.toFixed(4));
    if (player.dbgTipY !== undefined) log('dbgTipY', player.dbgTipY.toFixed(4));
    if (player.dbgButtY !== undefined) log('dbgButtY', player.dbgButtY.toFixed(4));
    log('clipStickW', (player.clipStickW || 0).toFixed(3));
    log('clipStickName', player.clipStickName || 'none');
    log('CONFIG_stickLen', CONFIG.stickLen);
    log('CONFIG_snapAlong', CONFIG.snapAlong);
    CONFIG.handleAuthority = savedAuth;
    done();
  }
})();
