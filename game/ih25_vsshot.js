/* ih25_vsshot.js — screenshot VS MODE in the 2.5D build, and report what the
   switch actually did to the scene.

   Same one-synchronous-block rule as ih25_shot.js: a headless page's rAF is
   throttled to a few fps, so render + toDataURL go back to back or the buffer
   comes back unrendered and reads like a black build.

   Unlike ih25_shot.js it has to WAIT: VS parses ten bodies before the match
   exists, so it polls MATCH.active rather than sleeping a fixed 700 ms.

   window.IH25_VS_SLOT (default 3) picks the position to switch to before the
   frame is taken, so the picture is of a skater the human just took over — a
   shot of the centre you start as would prove nothing about switching. */
(function () {
  var OUT = [];
  function log(k, v) { OUT.push(k + '=' + v); }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); });
  function post(name, url) {
    return fetch('/shot?' + name, { method: 'POST', body: url }).catch(function () {});
  }
  function done(url) {
    var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
    var nm = window.IH25_SHOT_NAME || 'ih25_vsshot';
    if (url) post(nm, url).then(function () { fetch(q).catch(function () {}); });
    else fetch(q).catch(function () {});
  }

  var tries = 0;
  (function wait() {
    var start = document.querySelector('#smStart'), vs = document.querySelector('#smVs');
    /* `player`/`puck` are `let` globals — not on window, but visible to a
       later <script>. window.player would be undefined forever. */
    var booted = typeof player !== 'undefined' && player &&
                 typeof puck !== 'undefined' && puck && start && vs;
    if (booted && !wait.clicked) { wait.clicked = true; vs.click(); start.click(); }
    if (wait.clicked && MATCH.vs && MATCH.active && MATCH.skaters.length >= 10) return shoot();
    if (++tries > 150) {
      OUT.push('WAITFAIL=' + (typeof player) + ',' + (booted ? 'booted' : 'noboot') +
               ',vs=' + (typeof MATCH !== 'undefined' && MATCH.vs));
      return done(null);
    }
    setTimeout(wait, 200);
  })();

  function shoot() {
    window.requestAnimationFrame = function () { return 0; };
    clock.getDelta = function () { return 1 / 60; };
    if (window.IH25_SHOT_ZOOM !== undefined) IH25.zoom = window.IH25_SHOT_ZOOM;
    var slot = window.IH25_VS_SLOT === undefined ? 3 : window.IH25_VS_SLOT;
    /* Hold the puck on the opposition so the auto-switch does not take the
       body back out from under the shot — that is the feature working, but it
       would make the picture be of a different skater than the one named. */
    var opp = MATCH.skaters.filter(function (s) { return s.team === 'B' && s.slot === 1; })[0];
    function holdOff() {
      /* Every frame, not once: a teammate WILL steal it back inside a second
         and the auto-switch will correctly take the body out from under the
         shot. Keeping it on the opposition for the whole run is the only way
         to photograph the man the shot is named after. */
      if (opp) opp.ent.hasPuck = true;
      puck.possessed = false; puck.control = 0;
    }
    /* Settle the lineup out of the faceoff FIRST, then take the man — a
       picture of the draw shows nothing about switching. */
    holdOff();
    for (var i = 0; i < 90; i++) {
      holdOff();
      try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); break; }
      if (window.IH25_SHOT_ZOOM !== undefined) IH25.zoom = window.IH25_SHOT_ZOOM;
    }
    holdOff();
    var switched = vsSwitchToSlot(slot);
    for (var j = 0; j < 20; j++) {
      holdOff();
      try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); break; }
      if (window.IH25_SHOT_ZOOM !== undefined) IH25.zoom = window.IH25_SHOT_ZOOM;
    }
    var url;
    try {
      renderer.render(scene, camera);
      url = renderer.domElement.toDataURL('image/png');
    } catch (e) { OUT.push('SHOTERR=' + e.message); }

    var me = MATCH.skaters.filter(function (s) { return s.ent === player; })[0];
    log('switched', switched);
    log('controlledSlot', me ? me.slot + ' ' + vsSlotLabel(me.slot) : 'NONE');
    log('skaters', MATCH.skaters.length);
    /* the real GLB stick follows `player` only, so this is the one number
       that says the two sticks changed hands in the rendered scene */
    log('stickGroupVisible', !!(stickGroup && stickGroup.visible));
    log('propSticksVisible', MATCH.skaters.filter(function (s) {
      return s.ent.botStick && s.ent.botStick.visible; }).length + '/' + MATCH.skaters.length);
    log('hudVisible', !!(document.querySelector('#vsHud') &&
        document.querySelector('#vsHud').style.display !== 'none'));
    log('hudCells', document.querySelector('#vsHud')
        ? document.querySelector('#vsHud').children.length : 0);
    /* The HUD is DOM, so it is NOT in the WebGL readback above — the picture
       can never show it. Measure it instead: a strip that exists but lays out
       at zero size, or off the bottom of the viewport, is invisible in exactly
       the way a screenshot of the canvas would never reveal. */
    var hud = document.querySelector('#vsHud');
    if (hud) {
      var r = hud.getBoundingClientRect();
      log('hudRect', [r.left, r.top, r.width, r.height].map(function (v) {
        return Math.round(v); }).join(','));
      log('hudOnScreen', r.width > 100 && r.height > 10 &&
          r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth);
      log('viewport', innerWidth + 'x' + innerHeight);
      /* and it must be the TOP element where it is drawn — this project has
         been bitten by a transparent inset:0 overlay eating a visible control */
      var pe = hud.style.pointerEvents;
      hud.style.pointerEvents = 'auto'; // it ships hit-transparent on purpose:
      // a readout must never eat a click. Turn it on only for the hit test,
      // or elementFromPoint answers "the canvas" and looks like a stacking bug.
      var mid = document.elementFromPoint(Math.round(r.left + r.width / 2),
                                          Math.round(r.top + r.height / 2));
      hud.style.pointerEvents = pe;
      log('hudTopElement', mid ? (mid.id || mid.tagName) + '/' +
          (mid.closest && mid.closest('#vsHud') ? 'inHud' : 'COVERED') : 'none');
    }
    log('canSwitch', vsCanSwitch());
    log('canvas', renderer.domElement.width + 'x' + renderer.domElement.height);
    log('shotBytes', url ? url.length : 0);
    done(url);
  }
})();
