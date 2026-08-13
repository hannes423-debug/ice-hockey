/* Does possession only break on CONTACT?

   The first version of this probe carved hard at speed and reported "0
   losses" — but the UNFIXED build scored 0 losses too (minControl only fell
   to 0.625), so it proved nothing. It never reached either break condition.
   This version drives the two break conditions in updatePuck directly:

     offLen > CONFIG.ctrlBreakDist     puck 2.5 m off the blade
     puck.control < CONFIG.ctrlMin     control pinned near zero

   Expected: the original breaks on both; the 2.5D build keeps the puck when
   nobody is near and breaks only once an opponent is on the carrier. */
(function () {
  var OUT = [];
  function log(k, v) { OUT.push(k + '=' + v); }
  function report() {
    var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function () { });
    setTimeout(function () { try { fetch(q); } catch (e) { } }, 300);
  }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); report(); });

  function takeOverClock() {
    window.requestAnimationFrame = function () { return 0; };
    clock.getDelta = function () { return 1 / 60; };
  }
  function frame() { try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); } }
  function run(n) { for (var i = 0; i < n; i++) frame(); }

  function others() {
    var o = [];
    if (typeof bot !== 'undefined' && bot) o.push(bot);
    if (typeof goalie !== 'undefined' && goalie) o.push(goalie);
    try { if (MATCH && MATCH.skaters) MATCH.skaters.forEach(function (s) { if (s.ent !== player) o.push(s.ent); }); } catch (e) { }
    return o;
  }
  function park(near) {
    others().forEach(function (e) {
      if (!e.pos) return;
      if (near) { e.pos.x = player.pos.x + 0.5; e.pos.z = player.pos.z; }
      else { e.pos.x = 60; e.pos.z = 60; }
      if (e.stickTip) { e.stickTip.x = e.pos.x; e.stickTip.z = e.pos.z; }
    });
  }
  function give() { puck.possessed = true; puck.control = 1; puck.noPickupT = 0; puck.outOfPlay = false; }

  /* push the puck `d` metres off the blade, then step ONE frame */
  function offsetTest(d, near) {
    give(); park(near); run(1); give(); park(near);
    var t = player.stickTip;
    puck.pos.set(t.x + d, CONFIG.puckRadius, t.z);
    frame();
    return puck.possessed;
  }
  /* pin control below ctrlMin, then step ONE frame */
  function controlTest(near) {
    give(); park(near); run(1); give(); park(near);
    puck.control = 0.01;
    frame();
    return { held: puck.possessed, ctrl: puck.control };
  }

  var tries = 0;
  (function wait() {
    var b = document.querySelector('#smStart');
    if (typeof player !== 'undefined' && player && puck && b) {
      b.click();
      setTimeout(function () {
       /* Anything thrown in here used to kill the callback and the probe
          reported NOTHING, which reads like a hung browser rather than a
          failed assertion. Report the exception instead. */
       try {
        takeOverClock(); run(30);
        var is25 = !!window.IH25;
        log('build', is25 ? '25d' : 'original');
        log('ctrlBreakDist', CONFIG.ctrlBreakDist);

        park(false); run(5);
        log('contestedWhenAlone', is25 ? IH25.contested() : 'n/a');
        log('ALONE.heldAfter2.5mOffset', offsetTest(2.5, false));
        var c1 = controlTest(false);
        log('ALONE.heldAfterZeroControl', c1.held);
        log('ALONE.controlAfter', c1.ctrl.toFixed(3));

        park(true); run(5);
        log('CONTACT.contested', is25 ? IH25.contested() : 'n/a');
        log('CONTACT.heldAfter2.5mOffset', offsetTest(2.5, true));
        var c2 = controlTest(true);
        log('CONTACT.heldAfterZeroControl', c2.held);
        report();
       } catch (err) {
         OUT.push('PROBEERR=' + (err && err.message ? err.message : err));
         report();
       }
      }, 300);
      return;
    }
    if (++tries > 200) { OUT.push('BOOT TIMEOUT'); report(); return; }
    setTimeout(wait, 50);
  })();
})();
