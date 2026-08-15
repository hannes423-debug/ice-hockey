/* ih25_loft_probe.js — with the camera locked overhead, does aiming AT the
   net still send the puck at the net?

   mouseTPSPoint derives shot elevation from how far ABOVE the player's chest
   the cursor sits ON SCREEN. Under the retired chase camera that is "aim
   higher". Under a rig looking down the ice at 58.6 deg, screen-up is
   DOWN-ICE: the further away you aim, the higher up the screen the reticle
   sits, so distance silently buys loft. This measures the consequence the
   only way that settles it — fire at the goal from a range of distances and
   report the puck's height as it crosses the goal line, against the 1.22 m
   crossbar. */
(function () {
  var OUT = [];
  function log(k, v) { OUT.push(k + '=' + v); }
  function report() {
    var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function () { });
    setTimeout(function () { try { fetch(q); } catch (e) { } }, 300);
  }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); report(); });
  function frame() { try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); throw e; } }
  function run(n) { for (var i = 0; i < n; i++) frame(); }

  var tries = 0;
  (function wait() {
    var b = document.querySelector('#smStart');
    if (typeof player !== 'undefined' && player && b) { b.click(); setTimeout(go, 400); return; }
    if (++tries > 300) { OUT.push('BOOT TIMEOUT'); report(); return; }
    setTimeout(wait, 50);
  })();

  function shotFrom(range) {
    var gz = IH25.goalZ, bar = IH25.goalHeight;
    player.pos.set(0, player.pos.y, gz - range);
    player.heading = 0; player.vel.set(0, 0, 0);
    player.turnShot = null; player.shotType = 'none'; player.shotSuppressed = false;
    lmbHeld = false; mouseCtl.active = true;
    puck.possessed = true; puck.control = 1; puck.outOfPlay = false; puck.noPickupT = 0;
    puck.pos.copy(player.stickTip || player.pos); puck.pos.y = CONFIG.puckRadius; puck.vel.set(0, 0, 0);
    run(6);
    // aim at the middle of the goal mouth, on the ice
    var sp = projectToScreen(new THREE.Vector3(0, CONFIG.iceHeight, gz));
    var launch = null;
    var oldFire = aimViz.fire.bind(aimViz);
    aimViz.fire = function (info) { launch = info; return oldFire(info); };
    mouseClientX = sp.x; mouseClientY = sp.y + 200;
    lmbHeld = true; run(2);
    for (var i = 1; i <= 6; i++) {
      mouseClientX = sp.x; mouseClientY = sp.y + 200 * (1 - i / 6);
      mouseCtl.ndc.x = (mouseClientX / innerWidth) * 2 - 1;
      mouseCtl.ndc.y = -(mouseClientY / innerHeight) * 2 + 1;
      frame();
    }
    frame();
    lmbHeld = false; frame();
    aimViz.fire = oldFire;
    if (!launch) return null;
    // fly it to the goal line and read the height there
    var prevZ = puck.pos.z, prevY = puck.pos.y, hAtLine = null;
    for (var f = 0; f < 200; f++) {
      frame();
      if (puck.pos.z >= gz && prevZ < gz) {
        var u = (gz - prevZ) / Math.max(1e-6, puck.pos.z - prevZ);
        hAtLine = prevY + (puck.pos.y - prevY) * u;
        break;
      }
      prevZ = puck.pos.z; prevY = puck.pos.y;
      if (puck.possessed || puck.outOfPlay) break;
    }
    return { launchDeg: launch.launchAngle * 180 / Math.PI, speed: launch.speed,
             h: hAtLine, bar: bar };
  }

  function go() {
    window.requestAnimationFrame = function () { return 0; };
    clock.getDelta = function () { return 1 / 60; };
    run(20); mouseCtl.active = true;
    var over = 0, n = 0, worst = 0;
    [5, 10, 15, 20, 25].forEach(function (r) {
      var s = shotFrom(r);
      if (!s) { log('range' + r, 'no shot'); return; }
      n++;
      var txt = 'launch ' + s.launchDeg.toFixed(1) + ' deg  speed ' + s.speed.toFixed(1) +
        '  height at the goal line ' + (s.h === null ? 'never got there' : s.h.toFixed(2) + ' m') +
        '  crossbar ' + s.bar.toFixed(2) + ' m';
      if (s.h !== null && s.h > s.bar) { over++; txt += '  OVER THE BAR'; worst = Math.max(worst, s.h - s.bar); }
      log('range' + r + 'm', txt);
    });
    log('shotsOverTheBar', over + '/' + n);
    log('worstOverBy_m', worst.toFixed(2));
    log('VERDICT', over === 0 ? 'AIMING AT THE NET HITS THE NET' : 'DISTANCE IS BUYING LOFT');
    report();
  }
})();
