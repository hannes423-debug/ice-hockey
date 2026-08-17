#!/bin/bash
# Can the Locker Room editor's name, number and exit actually be REACHED?
#
#   tools/editor_probe.sh 1280x800
#   tools/editor_probe.sh 500x700
#   TOUCH=1 tools/editor_probe.sh 500x700
#
# The user's report was "there is no way to edit the player's name or number,
# or exit back to the main menu". All three controls EXIST in the source
# (`nameInput`, `soloNumberInput`/`numberInput`, `saveExitBtn`), so the thing
# worth measuring is whether a person can get to them: is the category in the
# sidebar, does clicking it build the panel, is the panel's input on screen and
# hit-testable, and does the exit button lead anywhere that exists.
#
# See feedback-measure-panel-height-before-believing-missing and
# feedback-transparent-overlay-swallows-clicks: "the button does nothing" and
# "the button isn't there" are usually reachability, not a missing handler.
#
# Swiftshader flags for the usual reason (no GL context reads as a broken
# build). Headless will not go narrower than ~500 px.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SIZE="${1:-1280x800}"
# The SOURCE by default, not the published root copy -- editing customizer/ and
# probing the root copy silently measures the last deploy instead of the change.
PAGE="${2:-customizer/ice-hockey-customize.html}"
PORT="${PORT:-8141}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE/_editorprobe.html" "$HERE/customizer/_editorprobe.html"' EXIT
cd "$HERE" || exit 1

cat > "$TMP/probe.js" <<'PROBE'
(function(){
  var OUT=[];
  function log(k,v){OUT.push(k+'='+v);}
  function report(){var q='/PROBE?'+OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function(){});setTimeout(function(){try{fetch(q);}catch(e){}},300);}
  addEventListener('error',function(e){OUT.push('JSERROR='+e.message);report();});

  /* Scroll it into view FIRST, then hit-test. Without that step "off screen"
     conflates a control you merely have to scroll to (fine) with one the
     layout has pushed outside a clipped box (broken), and those need
     completely different fixes. Reported as CLIPPED only when scrolling its
     own ancestors cannot bring it back. */
  function hit(el){
    if(!el)return'ABSENT';
    var r0=el.getBoundingClientRect();
    if(r0.width<1||r0.height<1)return'zero size';
    try{el.scrollIntoView({block:'center',inline:'center'});}catch(e){}
    var r=el.getBoundingClientRect();
    var moved=Math.round(Math.abs(r.left-r0.left)+Math.abs(r.top-r0.top));
    var cx=r.left+r.width/2,cy=r.top+r.height/2;
    if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)
      return'CLIPPED at '+Math.round(r.left)+','+Math.round(r.top)
            +' (viewport '+innerWidth+'x'+innerHeight+', scrolling moved it '
            +moved+'px)';
    var h=document.elementFromPoint(cx,cy);
    if(!(h===el||el.contains(h)||h&&h.contains(el)))
      return'COVERED by '+(h?h.tagName+(h.id?'#'+h.id:''):'nothing');
    return'ok '+Math.round(r.width)+'x'+Math.round(r.height)
           +(moved>4?' (after scrolling '+moved+'px)':'');
  }
  function box(sel){
    var e=document.querySelector(sel);
    if(!e)return sel+' ABSENT';
    var r=e.getBoundingClientRect();
    return sel+' x'+Math.round(r.left)+'..'+Math.round(r.right)
      +' w'+Math.round(r.width)
      +(e.scrollWidth>e.clientWidth+2?' scrollW '+e.scrollWidth
        +' > clientW '+e.clientWidth+' OVERFLOWS-X':'');
  }
  function sidebar(){
    return [].slice.call(document.querySelectorAll('#sbList .sb-item'))
      .map(function(e){return (e.dataset.cat||'?')+'['+hit(e)+']';}).join(' | ');
  }

  setTimeout(function(){
    log('viewport',innerWidth+'x'+innerHeight);
    log('pointer',matchMedia('(pointer:coarse)').matches?'coarse':'fine');
    log('soloMode',(typeof soloMode!=='undefined')?soloMode:'?');
    log('activity',(typeof currentActivity!=='undefined')?currentActivity:'?');

    // --- 0. where are the containers? --------------------------------------
    var de=document.documentElement;
    log('documentScroll','scrollW '+de.scrollWidth+' clientW '+de.clientWidth
        +(de.scrollWidth>de.clientWidth+2?' PAGE OVERFLOWS-X':' no page overflow'));
    log('boxes',[box('#app'),box('#topbar'),box('#main'),box('#sidebar'),
                 box('#rightpanel')].join(' | '));

    // --- 1. EXIT -----------------------------------------------------------
    var ex=document.getElementById('saveExitBtn');
    log('exitButton',hit(ex));
    log('exitTarget','index.html');

    // --- 2. is Name & Number even listed? ----------------------------------
    log('sidebarItems',sidebar()||'NONE');
    var np=document.querySelector('#sbList .sb-item[data-cat=nameplate]');
    log('nameplateRow',hit(np));

    // --- 3. open it and look for the fields --------------------------------
    if(np){
      np.click();
      setTimeout(function(){
        var ni=document.getElementById('nameInput');
        var sn=document.getElementById('soloNumberInput');
        var nu=document.getElementById('numberInput');
        log('nameInput',hit(ni));
        log('numberInput_solo',hit(sn));
        log('numberInput_request',hit(nu));
        log('requestBtn',hit(document.getElementById('requestNumberBtn')));
        var panel=document.getElementById('rightPanel')||document.querySelector('.rp');
        if(panel){
          var r=panel.getBoundingClientRect();
          log('panelBox',Math.round(r.width)+'x'+Math.round(r.height)
              +' scrollH '+panel.scrollHeight+' clientH '+panel.clientHeight
              +(panel.scrollHeight>panel.clientHeight+2?' OVERFLOWS':' fits'));
        }
        report();
      },700);
    } else { report(); }
  },1800);
})();
PROBE

python3 - "$TMP/probe.js" "$PAGE" <<'PY'
import sys,pathlib
probe=pathlib.Path(sys.argv[1]).read_text()
src=pathlib.Path(sys.argv[2])
html=src.read_text(encoding='utf-8')
if html.count('</body>')!=1: sys.exit('expected exactly one </body>')
# written NEXT TO the source so its sibling .js files still resolve
(src.parent/'_editorprobe.html').write_text(
    html.replace('</body>','<script>'+probe+'</script>\n</body>',1),encoding='utf-8')
PY
# a PAGE with no directory part must not become "page.html/_editorprobe.html"
case "$PAGE" in */*) PDIR="${PAGE%/*}";; *) PDIR=".";; esac
URLPATH="_editorprobe.html"; [ "$PDIR" != "." ] && URLPATH="$PDIR/_editorprobe.html"
[ -f "$PDIR/_editorprobe.html" ] || exit 1

python3 -m http.server "$PORT" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1
timeout 120 google-chrome \
  --headless=new --disable-gpu-sandbox --no-sandbox \
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --user-data-dir="$TMP/prof" --window-size="${SIZE/x/,}" \
  ${TOUCH:+--touch-events=enabled} \
  "http://localhost:$PORT/$URLPATH" >"$TMP/chrome.log" 2>&1 &
CHROME=$!
for _ in $(seq 1 60); do grep -q 'GET /PROBE' "$TMP/srv.log" && break; sleep 1; done
kill "$CHROME" 2>/dev/null

if grep -q 'GET /PROBE' "$TMP/srv.log"; then
  echo "== Locker Room editor ($PAGE) at $SIZE"
  grep -o 'GET /PROBE?[^ ]*' "$TMP/srv.log" | head -1 | sed 's#GET /PROBE?##' \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote_plus(sys.stdin.read().strip()).replace("&","\n"))'
else
  echo "NO RESULT — probe never reported."; tail -5 "$TMP/srv.log"; tail -20 "$TMP/chrome.log"
fi
