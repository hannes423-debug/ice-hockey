/* Screenshot the locked 2.5D view and report what the camera actually did.

   Render and read back in ONE synchronous block: a headless page's rAF is
   throttled to a few fps, so a screenshot taken "a moment later" catches an
   unrendered or half-cleared buffer and reads exactly like a black build.
   Drive tick() by hand with a fixed dt, then render + toDataURL back to back.

   Set window.IH25_SHOT_ZOOM before load to shoot a zoomed view. */
(function () {
  var OUT = [];
  function log(k, v) { OUT.push(k + '=' + v); }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); });

  function post(name, url) {
    return fetch('/shot?' + name, { method: 'POST', body: url }).catch(function () {});
  }

  var tries = 0;
  (function wait() {
    var b = document.querySelector('#smStart');
    /* `puck` is a `let` global: it is NOT on window, but it IS visible to a
       later <script>. window.puck would be undefined forever and the probe
       would just sit here. */
    if (typeof player === 'undefined' || !player ||
        typeof puck === 'undefined' || !puck || !b) {
      if (++tries > 60) { OUT.push('WAITFAIL=' + (typeof player) + ',' + (typeof puck) + ',' + !!b);
        return fetch('/PROBE?' + OUT.map(encodeURIComponent).join('&')).catch(function () {}); }
      return setTimeout(wait, 200);
    }
    b.click();
    setTimeout(function () {
      window.requestAnimationFrame = function () { return 0; };
      clock.getDelta = function () { return 1 / 60; };
      if (window.IH25_SHOT_ZOOM !== undefined) IH25.zoom = window.IH25_SHOT_ZOOM;
      for (var i = 0; i < 90; i++) {
        try { tick(); } catch (e) { OUT.push('TICKERR=' + e.message); break; }
        if (window.IH25_SHOT_ZOOM !== undefined) IH25.zoom = window.IH25_SHOT_ZOOM;
      }
      /* IH25_SHOT_OVERLAY: put the build's own painted markings back on top of
         a half-strength photo. If the 3-D geometry really was fitted to this
         picture the two sets of lines sit on each other; anywhere they do not,
         the puck crosses a line that is not where it is painted. Un-hidden on
         the LAST frame, because hidePaintedMarkings sweeps once a second. */
      if (window.IH25_SHOT_OVERLAY) {
        IH25.maskOpacity = 0.55;
        scene.traverse(function (o) {
          if (o.isMesh && o.position.y >= 0.008 && o.position.y <= 0.0135) o.visible = true;
        });
        scene.traverse(function (o) {
          if (o.isMesh && o.material && o.material.map &&
              o.geometry && o.geometry.type === 'PlaneGeometry') {
            o.material.opacity = IH25.maskOpacity;
          }
        });
      }
      var url;
      try {
        renderer.render(scene, camera);
        url = renderer.domElement.toDataURL('image/png');
      } catch (e) { OUT.push('SHOTERR=' + e.message); }

      log('rink', (IH25.halfW * 2).toFixed(2) + 'x' + (IH25.halfD * 2).toFixed(2));
      log('camPitchDeg', IH25.camPitchDeg.toFixed(3));
      log('camFovDeg', IH25.camFovDeg.toFixed(3));
      log('camDistCfg', IH25.camDist.toFixed(3));
      log('camPos', [camera.position.x, camera.position.y, camera.position.z]
        .map(function (v) { return v.toFixed(2); }).join(','));
      log('camDistActual', camera.position.length().toFixed(3));
      log('camPitchActual',
        (Math.atan2(camera.position.y, Math.hypot(camera.position.x, camera.position.z))
          * 180 / Math.PI).toFixed(3));
      log('camFovActual', camera.fov.toFixed(3));
      log('aspect', camera.aspect.toFixed(4));
      log('canvas', renderer.domElement.width + 'x' + renderer.domElement.height);
      log('shotBytes', url ? url.length : 0);
      log('zoom', IH25.zoom);
      log('GOAL_ZONE', typeof GOAL_ZONE !== 'undefined' && GOAL_ZONE
        ? GOAL_ZONE.z.toFixed(3) : 'MISSING');
      log('GOAL_B', typeof GOAL_B !== 'undefined' && GOAL_B
        ? GOAL_B.z.toFixed(3) : 'MISSING');
      log('netPartsAdded', (IH25._netParts || []).length);
      var nplanes = 0, restyled = 0;
      scene.traverse(function (o) {
        if (o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry' &&
            o.material && o.material.color) {
          if (o.material.color.getHex() === 0xe8f4ff) nplanes++;
          if (o.material.color.getHex() === 0x8fa8c4) restyled++;
        }
      });
      log('netPlanesStillWhite', nplanes);
      log('netPlanesRestyled', restyled);
      log('maskDeclaredSRGB', IH25._maskSRGB);
      log('arenaTagged', IH25._arenaTagged);
      var hid = 0, shown = 0;
      scene.traverse(function (o) {
        if (o.userData && o.userData.ih25Arena) { o.visible ? shown++ : hid++; }
      });
      log('arenaHidden', hid + '/' + (hid + shown));
      log('backdropVisible', !!(window.IH25_BACKDROP && IH25._bdVis));

      var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
      var nm = window.IH25_SHOT_NAME || 'ih25_shot';
      if (url) post(nm, url).then(function () { fetch(q).catch(function () {}); });
      else fetch(q).catch(function () {});
    }, 700);
  })();
})();
