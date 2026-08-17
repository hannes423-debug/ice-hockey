/* gripshot.js — photograph ONE clip's own grip in the real build.

   The question this answers is the only one a number cannot: does the skater
   look like he is holding the stick. So it forces a single clip onto the
   player, parks the camera on him, renders and reads back in ONE synchronous
   block (a headless page's rAF is throttled to ~3 fps, so anything split
   across frames comes back unrendered and reads like a black build).

   window.GRIP_CLIP   payload clip name, e.g. 'TurnTightL'
   window.GRIP_PHASE  0..1 through the clip
   window.GRIP_HANDLE 1 keeps the skill-stick handle layer on (what ships),
                      0 turns it off so the picture is the CLIP's own pose --
                      the handle layer re-aims the shaft up to 91.7 deg, which
                      would hide exactly the defect being looked for.
*/
(function () {
  var OUT = [];
  function log(k, v) { OUT.push(k + '=' + v); }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); });
  function done(url) {
    var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
    var nm = window.GRIP_SHOT_NAME || 'gripshot';
    if (url) fetch('/shot?' + nm, { method: 'POST', body: url })
      .catch(function () {}).then(function () { fetch(q).catch(function () {}); });
    else fetch(q).catch(function () {});
  }

  var tries = 0;
  (function wait() {
    var start = document.querySelector('#smStart');
    var booted = typeof player !== 'undefined' && player && player.joints &&
                 typeof puck !== 'undefined' && puck && start;
    if (booted && !wait.clicked) { wait.clicked = true; start.click(); }
    if (wait.clicked && typeof player !== 'undefined' && player &&
        player.mixer && player.actions && player.actions.idle) return shoot();
    if (++tries > 150) { OUT.push('WAITFAIL=' + (typeof player)); return done(null); }
    setTimeout(wait, 200);
  })();

  function shoot() {
    window.requestAnimationFrame = function () { return 0; };
    clock.getDelta = function () { return 1 / 60; };

    var name = window.GRIP_CLIP || 'IdleN';
    var phase = window.GRIP_PHASE === undefined ? 0.5 : window.GRIP_PHASE;
    var handle = window.GRIP_HANDLE === undefined ? 1 : window.GRIP_HANDLE;

    /* let the boot settle so the rig, the stick GLB and the ice all exist */
    for (var i = 0; i < 40; i++) { try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); break; } }

    var clip = player.mixer._actions.map(function (a) { return a._clip; })
      .filter(function (c) { return c.name === name; })[0];
    if (!clip) { log('CLIPMISSING', name); return done(null); }

    /* Own the pose outright: stop the locomotion graph writing over it, then
       drive the mixer by hand. setLoco/stanceTick run inside tick(), so the
       clip has to be re-asserted every frame, not once. */
    var act = player.mixer.clipAction(clip);
    function force() {
      player.mixer._actions.forEach(function (a) { if (a !== act) a.stop(); });
      act.reset(); act.play(); act.setEffectiveWeight(1);
      act.time = clip.duration * phase;
      player.mixer.time = 0;
      player.mixer.update(0);
      if (!handle) player.handleBlend = 0;
    }
    var savedAuth = CONFIG.handleAuthority;
    if (!handle) CONFIG.handleAuthority = 0;
    for (var k = 0; k < 6; k++) { force(); try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); break; } }
    /* tick() re-runs the locomotion graph, so the last word has to be ours:
       re-assert the clip, then pose the stick off THAT pose by hand. With the
       handle layer off `aim` is unread, which is why null is safe here. */
    force();
    /* `poseAimPt` is a let inside updatePlayer, invisible here -- but
       updatePlayer copies it to player.stickTarget on the way past, so that is
       the same point the shipping frame aimed at. */
    try { poseStick(player, handle ? player.stickTarget.clone() : null, 1 / 60); }
    catch (e) { OUT.push('POSEERR=' + e.message); }

    /* camera: 3.2 m out, slightly above the waist, three-quarter front */
    var p = player.pos.clone();
    var h = player.heading || 0;
    camera.position.set(p.x + Math.sin(h + 2.2) * 3.2, p.y + 1.35, p.z + Math.cos(h + 2.2) * 3.2);
    camera.lookAt(p.x, p.y + 0.75, p.z);
    camera.updateMatrixWorld(true);

    var url;
    try {
      renderer.render(scene, camera);
      url = renderer.domElement.toDataURL('image/png');
    } catch (e) { OUT.push('SHOTERR=' + e.message); }
    CONFIG.handleAuthority = savedAuth;

    /* the numbers the picture cannot carry: where the rendered blade actually
       is, straight off the posed stick, and how far apart the fists ended up */
    log('clip', name);
    log('phase', phase);
    log('handleLayer', handle ? 'on' : 'off');
    log('handleBlend', (player.handleBlend || 0).toFixed(3));
    /* player.stickVis is what poseStick itself measured off the rendered
       stick -- the presentation blade, the thing in the picture. */
    if (player.stickVis) {
      log('bladeY', player.stickVis.y.toFixed(3));
      log('bladeFwdOfBody',
          player.stickVis.clone().sub(player.pos).dot(fwd(player.heading)).toFixed(3));
    }
    log('stickGroupVisible', !!(stickGroup && stickGroup.visible));
    if (stickGroup) {
      stickGroup.updateMatrixWorld(true);
      var wb = IH_STICK_BLADE.clone().applyMatrix4(stickGroup.matrixWorld);
      log('renderedBlade', [wb.x, wb.y, wb.z].map(function (v) { return v.toFixed(2); }).join(','));
      log('stickGroupPos', [stickGroup.position.x, stickGroup.position.y,
        stickGroup.position.z].map(function (v) { return v.toFixed(2); }).join(','));
      log('stickGroupParent', stickGroup.parent ? stickGroup.parent.type : 'none');
    }
    /* every OTHER stick in the scene, so a picture of the wrong one is caught */
    var others = 0, oy = [];
    scene.traverse(function (o) {
      if (o !== stickGroup && o.name === 'botStick' && o.visible) { others++; }
    });
    log('otherVisibleSticks', others);
    log('playerPos', [player.pos.x, player.pos.y, player.pos.z]
      .map(function (v) { return v.toFixed(2); }).join(','));
    var J = player.joints;
    if (J && J.hand_l && J.hand_r) {
      J.hand_l.updateWorldMatrix(true, false); J.hand_r.updateWorldMatrix(true, false);
      var gl = IH_GRIP_CTR_L.clone().applyMatrix4(J.hand_l.matrixWorld);
      var gr = IH_GRIP_CTR_R.clone().applyMatrix4(J.hand_r.matrixWorld);
      log('handSep', gl.distanceTo(gr).toFixed(3));
      log('handLy', gl.y.toFixed(3)); log('handRy', gr.y.toFixed(3));
    }
    log('canvas', renderer.domElement.width + 'x' + renderer.domElement.height);
    log('shotBytes', url ? url.length : 0);
    done(url);
  }
})();
