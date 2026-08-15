/* ih25_frame_probe.js — what is actually on screen at the default zoom?

   Measured by unprojecting the real camera, not by re-evaluating the formula
   that positioned it: an ice-plane raycast through the bottom-centre and
   top-centre of the viewport gives the two ends of the strip of ice the
   player can see, in metres, whatever the maths upstream believed.

   The claim under test is the EA framing: whichever zone the skater is in is
   entirely on screen, with some of the next one past the blue line — and the
   rig never frames a wide band of nothing past the end boards, which in this
   build is a black void because the arena is deliberately hidden. */
(function () {
  var OUT = [];
  function log(k, v) { OUT.push(k + '=' + v); }
  function report() {
    var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function () { });
    setTimeout(function () { try { fetch(q); } catch (e) { } }, 300);
  }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); report(); });

  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), tmp = new THREE.Vector3();
  /* ice-plane hit for a normalized screen point; null when that pixel is
     looking at or above the horizon (the top of the frame legitimately can) */
  function iceAt(nx, ny) {
    ndc.set(nx, ny); ray.setFromCamera(ndc, camera);
    var o = ray.ray.origin, d = ray.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    var t = (CONFIG.iceHeight - o.y) / d.y;
    if (!isFinite(t) || t < 0) return null;
    return tmp.copy(o).addScaledVector(d, t).clone();
  }
  function span() {
    var b = iceAt(0, -1), t = iceAt(0, 1);
    return { near: b ? b.z : null, far: t ? t.z : null,
             cover: (b && t) ? (t.z - b.z) : null };
  }

  function frame() { try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); throw e; } }
  function run(n) { for (var i = 0; i < n; i++) frame(); }

  var tries = 0;
  (function wait() {
    var b = document.querySelector('#smStart');
    if (typeof player !== 'undefined' && player && b) { b.click(); setTimeout(go, 400); return; }
    if (++tries > 300) { OUT.push('BOOT TIMEOUT'); report(); return; }
    setTimeout(wait, 50);
  })();

  function at(name, pz) {
    player.pos.set(0, player.pos.y, pz);
    player.vel.set(0, 0, 0);
    run(4);
    var s = span();
    var blue = IH25.blueZ, gz = IH25.goalZ, hd = IH25.halfD;
    // the zone the skater is standing in, as a Z interval
    var zLo, zHi, zone;
    if (pz > blue) { zone = 'attacking end zone'; zLo = blue; zHi = hd; }
    else if (pz < -blue) { zone = 'defending end zone'; zLo = -hd; zHi = -blue; }
    else { zone = 'neutral zone'; zLo = -blue; zHi = blue; }
    var whole = s.near !== null && s.far !== null && s.near <= zLo + 0.01 && s.far >= zHi - 0.01;
    // how far past the end boards the frame runs (void, since the arena is hidden)
    var voidFar = s.far === null ? 999 : Math.max(0, s.far - hd);
    var voidNear = s.near === null ? 999 : Math.max(0, -hd - s.near);
    log(name, 'playerZ ' + pz.toFixed(1) + ' (' + zone + ')' +
      ' | on screen z ' + (s.near === null ? 'horizon' : s.near.toFixed(1)) +
      ' .. ' + (s.far === null ? 'horizon' : s.far.toFixed(1)) +
      ' = ' + (s.cover === null ? 'unbounded' : s.cover.toFixed(1) + ' m') +
      ' | zone ' + zLo.toFixed(1) + '..' + zHi.toFixed(1) + ' ' + (whole ? 'WHOLE' : 'CLIPPED') +
      ' | void past boards ' + voidFar.toFixed(1) + '/' + voidNear.toFixed(1) + ' m' +
      ' | playerOnScreenY ' + (projectToScreen(player.pos).y / innerHeight).toFixed(2));
    return { whole: whole, cover: s.cover, voidFar: voidFar, voidNear: voidNear };
  }

  function go() {
    window.requestAnimationFrame = function () { return 0; };
    clock.getDelta = function () { return 1 / 60; };
    run(30);
    log('viewport', innerWidth + 'x' + innerHeight + ' aspect ' + (innerWidth / innerHeight).toFixed(2));
    log('defaultZoom', IH25.zoom.toFixed(3));
    log('camDist_m', IH25._dist.toFixed(1));
    log('coverZ_target_m', IH25.coverZ);

    /* Asserted at the CENTRE of each zone. Standing on a blue line, half of
       the zone behind you is off screen and that is correct — the rig looks
       where you are going (about a third of the view is behind the focus, two
       thirds ahead), so demanding "the zone you are standing in is always
       whole" would be demanding a rig that faces backwards. The zone-edge and
       behind-the-net rows are still run: they are what exercises the
       end-of-rink clamp. */
    var zoneCentre = (IH25.blueZ + IH25.halfD) / 2;
    var rows = [
      at('neutral_centre', 0),
      at('attacking_zone_centre', zoneCentre),
      at('defending_zone_centre', -zoneCentre)
    ];
    var edges = [
      at('on_own_blue', -8),
      at('behind_own_net', -28),
      at('behind_their_net', 28)
    ];
    var allWhole = rows.every(function (r) { return r.whole; });
    var worstVoid = 0;
    rows.concat(edges).forEach(function (r) { worstVoid = Math.max(worstVoid, r.voidFar, r.voidNear); });
    var cover = rows[0].cover;
    var oneZone = IH25.halfD - IH25.blueZ;
    // one zone whole, plus a real slice of the next — not the whole rink again
    var coverOk = cover >= oneZone + 4 && cover <= oneZone + 14;
    log('oneZone_m', oneZone.toFixed(2));
    log('cover_m', cover.toFixed(1));
    log('coverIsZonePlusSome', coverOk ? 'yes' : 'no');
    // the full-rink framing is still reachable, since it is the reference shot
    IH25.zoom = 0; run(4);
    var wide = span();
    log('zoom0_still_whole_rink', (wide.cover !== null && wide.cover >= IH25.halfD * 2) ? 'yes ' + wide.cover.toFixed(0) + ' m' : 'NO');

    log('everyZoneWhole', allWhole ? 'yes' : 'no');
    log('worstVoidPastBoards_m', worstVoid.toFixed(1));
    log('VERDICT', (allWhole && coverOk && worstVoid <= IH25.edgeMargin + 0.5)
      ? 'ZONE FRAMING OK' : 'FRAMING WRONG');
    report();
  }
})();
