/* ih25_menu_probe.js — can the start menu actually be OPERATED on a phone?

   Not "does it render" — every one of these failures renders perfectly. The
   three things that make a menu unusable on a small screen are all
   measurable, and all invisible on a desktop window:

     1. the card is taller than the viewport and nothing scrolls, so the rows
        past the fold — including START — cannot be reached at all;
     2. a control is on screen but under something else, so tapping it does
        nothing (hit-test with elementFromPoint, never by reading handlers);
     3. tap targets below ~40 px, which are hit-or-miss with a thumb.

   Run it at a phone size: WINDOW=390,844 ./ih25_probe.sh ih25_menu_probe.js */
(function () {
  var OUT = [];
  function log(k, v) { OUT.push(k + '=' + v); }
  function report() {
    var q = '/PROBE?' + OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function () { });
    setTimeout(function () { try { fetch(q); } catch (e) { } }, 300);
  }
  addEventListener('error', function (e) { OUT.push('JSERROR=' + e.message); report(); });

  var tries = 0;
  (function wait() {
    if (document.querySelector('#smStart') && document.querySelector('#startMenu')) {
      setTimeout(go, 500); return;
    }
    if (++tries > 400) { OUT.push('BOOT TIMEOUT'); report(); return; }
    setTimeout(wait, 50);
  })();

  /* is this element the thing a tap at its own centre would actually hit? */
  function tappable(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, why: 'zero size' };
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight)
      return { ok: false, why: 'off screen at ' + Math.round(r.left) + ',' + Math.round(r.top),
               r: r };
    var hit = document.elementFromPoint(cx, cy);
    var owned = hit === el || (hit && (el.contains(hit) || hit.contains(el)));
    if (!owned) return { ok: false, why: 'covered by ' + (hit ? (hit.tagName + (hit.id ? '#' + hit.id : '')) : 'nothing'), r: r };
    return { ok: true, r: r };
  }

  function go() {
    var wrap = document.querySelector('#startMenu');
    var card = wrap.firstElementChild;
    var wr = wrap.getBoundingClientRect(), cr = card.getBoundingClientRect();
    log('viewport', innerWidth + 'x' + innerHeight);
    log('card', Math.round(cr.width) + 'x' + Math.round(cr.height) +
      ' at ' + Math.round(cr.left) + ',' + Math.round(cr.top));
    var overflowY = Math.round(cr.height - innerHeight);
    log('cardTallerThanScreenBy_px', overflowY);

    /* Does anything actually scroll? A card that overflows is fine IF the
       overlay scrolls it. scrollHeight > clientHeight is not enough on its
       own — the computed overflow has to allow it, or the content is simply
       clipped and unreachable. */
    var wS = getComputedStyle(wrap), cS = getComputedStyle(card);
    var scroller = null;
    [[wrap, wS], [card, cS]].forEach(function (pair) {
      var el = pair[0], st = pair[1];
      var can = /auto|scroll/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 2;
      if (can && !scroller) scroller = el === wrap ? 'overlay' : 'card';
    });
    log('overflowY', 'overlay ' + wS.overflowY + ' / card ' + cS.overflowY);
    log('scrollableBy', scroller || 'NOTHING');

    /* REACHABILITY, tested the way a thumb tests it: scroll the control into
       view and then hit-test it. Checking only the top and the bottom of the
       scroll marks everything in the MIDDLE unreachable, which is a fault in
       the ruler and not in the menu — and a point outside the viewport makes
       elementFromPoint return null, which reads as "covered by nothing". */
    var ctrls = [].slice.call(wrap.querySelectorAll('button,input'));
    log('controls', ctrls.length);
    var unreachable = [], small = [], covered = [];
    ctrls.forEach(function (el) {
      if (!el.offsetParent) return;         // in a row this mode does not show
      var id = el.id || (el.className + ':' + (el.textContent || '').trim().slice(0, 14));
      el.scrollIntoView({ block: 'center' });
      var t = tappable(el);
      var r = el.getBoundingClientRect();
      if (!t.ok) {
        if (/off screen/.test(t.why)) unreachable.push(id + ' (' + t.why + ')');
        else covered.push(id + ' (' + t.why + ')');
      }
      // a range input is dragged, not tapped; judge it on height only
      var minSide = el.tagName === 'INPUT' ? r.height : Math.min(r.width, r.height);
      if (minSide < 40) small.push(id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    var sc = scroller === 'card' ? card : wrap;
    log('scrollRange_px', (sc.scrollHeight - sc.clientHeight));
    var stillOff = unreachable;

    var start = document.querySelector('#smStart');
    start.scrollIntoView({ block: 'center' });
    var st = tappable(start);
    log('START_reachable_after_scroll', st.ok ? 'yes' : 'NO — ' + st.why);
    log('unreachableEvenWhenScrolledTo', stillOff.length ? stillOff.join(' ') : 'none');
    log('coveredBySomething', covered.length ? covered.join(' ') : 'none');
    log('tapTargetsUnder40px', small.length ? small.length + ': ' + small.slice(0, 8).join(' ') : 'none');

    var ok = st.ok && stillOff.length === 0 && covered.length === 0 && small.length === 0;
    log('VERDICT', ok ? 'MENU IS OPERABLE' : 'MENU IS NOT OPERABLE');
    report();
  }
})();
