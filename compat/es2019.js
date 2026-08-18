/* The one file every target loads FIRST, and the only concession the game
 * makes to a browser that is not Chromium.
 *
 * WHY IT EXISTS
 *   The Xbox Developer Mode build (xbox/) hosts this game in a UWP WebView.
 *   That control is EdgeHTML/Chakra, not Chromium — WebView2 does not exist on
 *   Xbox — and Chakra stopped getting language features in 2018, one year
 *   before Array.prototype.flatMap. The game calls flatMap twice, at the very
 *   end of the 10,783-line inline script that is its whole program.
 *
 * WHAT IT ACTUALLY COSTS TO OMIT — measured, not assumed
 *   xbox/tools/edgehtml_sim.sh runs the published game.html twice on an engine
 *   with flatMap deleted, once with this file and once without. Without it:
 *
 *       Uncaught TypeError: groups.flatMap is not a function @14282
 *
 *   and the last 347 lines of that script never run. The game still boots —
 *   menu, rink, skaters, puck, all fine — but the in-game tuning panel is
 *   never built, and `applyVals(loadSaved())` never runs, so every setting the
 *   player saved is silently discarded at startup and the game comes up on
 *   defaults every single time.
 *
 *   That is the shape of bug worth fifteen lines: not a crash anyone can
 *   report, but a console that quietly forgets your settings and is missing a
 *   panel, with a stack trace nobody sees because there is no F12 on a TV.
 *
 * WHY IT IS A SEPARATE FILE AND NOT AN INJECTION FROM THE HOST
 *   EdgeHTML's WebView has no AddScriptToExecuteOnDocumentCreated (that is a
 *   WebView2 API), so the Xbox host CANNOT run anything before the page's own
 *   inline scripts. The shim has to be in the page, in every page, ahead of
 *   everything else.
 *
 * WHAT IT MUST NOT BECOME
 *   Not a polyfill library. It defines only what this game actually calls and
 *   a real engine actually lacks, each behind a feature test, so on Chrome,
 *   Firefox, Safari and Electron it defines nothing and costs one cached
 *   request. Do not add speculative polyfills — add one when xbox/probe.html,
 *   run on the real console, says that console is missing it.
 */
(function () {
  'use strict';

  /* ES2019. Chrome 69, Firefox 62, Safari 12 — and no EdgeHTML at all.
     flat() first: flatMap() is defined in terms of a depth-1 flatten. */
  if (!Array.prototype.flat) {
    Object.defineProperty(Array.prototype, 'flat', {
      configurable: true, writable: true,
      value: function flat(depth) {
        var d = depth === undefined ? 1 : Math.floor(depth) || 0;
        var out = [];
        for (var i = 0; i < this.length; i++) {
          if (!(i in this)) continue;            // holes stay holes
          var v = this[i];
          if (d > 0 && Array.isArray(v)) out.push.apply(out, flat.call(v, d - 1));
          else out.push(v);
        }
        return out;
      },
    });
  }

  if (!Array.prototype.flatMap) {
    Object.defineProperty(Array.prototype, 'flatMap', {
      configurable: true, writable: true,
      value: function flatMap(fn, thisArg) {
        if (typeof fn !== 'function') throw new TypeError(fn + ' is not a function');
        var out = [];
        for (var i = 0; i < this.length; i++) {
          if (!(i in this)) continue;
          var v = fn.call(thisArg, this[i], i, this);
          if (Array.isArray(v)) out.push.apply(out, v);
          else out.push(v);
        }
        return out;
      },
    });
  }

  /* A marker, and the only reason anything here touches `window`.
     "Did the shim actually run?" has no other answer on a device with no
     developer console, and it is not answerable from resource timing either:
     under Electron's app:// scheme Chromium records no resource entries at
     all, so a smoke test cannot see the request. Non-enumerable, so it does
     not show up in any walk of window. NOTHING IN THE GAME MAY READ THIS —
     the game must behave identically whether or not this file exists. */
  try {
    Object.defineProperty(window, '__ihCompat', { value: 'es2019', configurable: true });
  } catch (e) { /* frozen window, or no window at all — the shim still worked */ }
})();
