#!/bin/bash
# Does a page still work with the whole internet unplugged?
#
#   tools/offline_probe.sh index.html
#   tools/offline_probe.sh game.html
#
# The site used to pull three.js, GLTFLoader and two Google fonts from CDNs.
# Those are now vendored (vendor/, fonts/) so the SAME files work on GitHub
# Pages and inside the packaged desktop build, which has no network at all.
# This is the test that says so: Chrome is started with DNS failing for every
# host except localhost, so anything still reaching out simply does not arrive.
#
# It reports what the page got, not just that it did not crash — a page whose
# three.js failed to load still paints its DOM and would pass a screenshot.
#
# The swiftshader flags are not optional here for the same reason as everywhere
# else in this repo: with no GL context a page reports a bare "Script error.
# @:0" and half-executes, which reads exactly like a broken build.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PAGE="${1:-index.html}"
PORT="${PORT:-8145}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE/_offline.html"' EXIT

cd "$HERE" || exit 1
cat > "$TMP/probe.js" <<'PROBE'
(function(){
  var OUT=[],ext=[];
  function log(k,v){OUT.push(k+'='+v);}
  function report(){
    var q='/PROBE?'+OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function(){});setTimeout(function(){try{fetch(q);}catch(e){}},300);
  }
  addEventListener('error',function(e){OUT.push('JSERROR='+e.message+' @'+e.lineno);},true);
  setTimeout(function(){
    /* every resource the page actually pulled, and whether any of it was
       off-box — the whole point of the exercise */
    var res=(performance.getEntriesByType?performance.getEntriesByType('resource'):[])||[];
    res.forEach(function(r){ if(!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(r.name)) ext.push(r.name); });
    log('resources',res.length);
    log('offBoxRequests',ext.length?ext.join(' | '):'none');
    var bad=res.filter(function(r){return r.responseStatus>=400;})
               .map(function(r){return r.name.replace(/^https?:\/\/[^/]+/,'')+' ('+r.responseStatus+')';});
    log('failedResources',bad.length?bad.join(' | '):'none');
    log('THREE',typeof THREE);
    log('threeRevision',(typeof THREE!=='undefined'&&THREE.REVISION)||'-');
    log('GLTFLoader',(typeof THREE!=='undefined'&&THREE.GLTFLoader)?'yes':'no');
    /* fonts: document.fonts.check answers "would this render in that family",
       which is the only question that matters. A missing webfont silently
       falls back and looks merely wrong. */
    if(document.fonts&&document.fonts.check){
      log('fontBarlow',document.fonts.check('700 16px "Barlow Condensed"'));
      log('fontInter',document.fonts.check('400 16px "Inter"'));
      log('fontsLoaded',document.fonts.size);
    }
    /* page-specific liveness */
    var canvas=document.querySelector('canvas');
    log('canvas',canvas?(canvas.width+'x'+canvas.height):'none');
    log('menuItems',document.querySelectorAll('#menuList .menu-item').length);
    log('startMenu',document.querySelector('#smStart')?'built':'-');
    log('bgImage',(function(){
      var b=document.querySelector('.bg-locker .base');
      if(!b)return '-';
      var u=getComputedStyle(b).backgroundImage||'';
      var m=u.match(/url\(["']?([^"')]+)/);
      return m?m[1].replace(/^https?:\/\/[^/]+/,''):'none';
    })());
    report();
  },5000);
})();
PROBE
cp "$TMP/probe.js" ./_offline_probe.js
sed "s#</body>#<script src=\"_offline_probe.js\"></script>\n</body>#" "$PAGE" > _offline.html
grep -q '_offline_probe.js' _offline.html || { echo "could not inject the probe (no </body>?)"; exit 1; }

python3 -m http.server "$PORT" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1

timeout 120 google-chrome \
  --headless=new --disable-gpu-sandbox --no-sandbox \
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --user-data-dir="$TMP/prof" \
  --window-size=1280,800 \
  --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE localhost" \
  "http://localhost:$PORT/_offline.html" >"$TMP/chrome.log" 2>&1 &
CHROME=$!

for _ in $(seq 1 60); do
  grep -q 'GET /PROBE' "$TMP/srv.log" && break
  sleep 1
done
kill "$CHROME" 2>/dev/null
rm -f ./_offline_probe.js

echo "== $PAGE with DNS blackholed (localhost only)"
if grep -q 'GET /PROBE' "$TMP/srv.log"; then
  grep -o 'GET /PROBE?[^ ]*' "$TMP/srv.log" | head -1 | sed 's#GET /PROBE?##' \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote_plus(sys.stdin.read().strip()).replace("&","\n"))'
else
  echo "NO RESULT — probe never reported."; tail -5 "$TMP/srv.log"; tail -20 "$TMP/chrome.log"
fi
