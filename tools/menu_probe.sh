#!/bin/bash
# Can a page's menu actually be OPERATED at a given window size?
#
#   tools/menu_probe.sh index.html 500x700
#   tools/menu_probe.sh index.html 800x400 '.menu-item,.tab,button'
#   TOUCH=1 tools/menu_probe.sh index.html 500x700    # a COARSE pointer
#   CLICK='#menuList .menu-item' tools/menu_probe.sh index.html 500x700
#     — clicks that first, so a panel built on demand (the mode-confirm
#       overlay) is measured instead of reported as "0 controls, all fine"
#
# TOUCH=1 matters: headless reports pointer:fine, so every @media
# (pointer:coarse) rule is inert and the page measures as if a mouse were
# driving it — which is exactly the configuration that does not need testing.
#
# Same three measures as game/ih25_menu_probe.js, against any page in the
# repo root: is anything scrollable when the content overflows, is every
# control reachable once scrolled to, is it hit-testable at its own centre,
# and is it at least 40 px on its short side.
#
# The swiftshader flags are here for the same reason as everywhere else in
# this repo: with no GL context a page reports a bare "Script error. @:0" and
# half-executes, which reads exactly like a broken build. Headless will not
# make a window narrower than ~500 px, so 500x700 is the narrowest real test.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PAGE="${1:?usage: menu_probe.sh <page.html> [WxH] [selector]}"
SIZE="${2:-500x700}"
SEL="${3:-button,input,select,[role=option],.menu-item,.tab,a[href]}"
PORT="${PORT:-8137}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE/_menuprobe.html"' EXIT

cd "$HERE" || exit 1
cat > "$TMP/probe.js" <<'PROBE'
(function(){
  var OUT=[];
  function log(k,v){OUT.push(k+'='+v);}
  function report(){var q='/PROBE?'+OUT.map(encodeURIComponent).join('&');
    fetch(q).catch(function(){});setTimeout(function(){try{fetch(q);}catch(e){}},300);}
  addEventListener('error',function(e){OUT.push('JSERROR='+e.message);report();});
  function tappable(el){
    var r=el.getBoundingClientRect();
    if(r.width<1||r.height<1)return{ok:false,why:'zero size'};
    var cx=r.left+r.width/2,cy=r.top+r.height/2;
    if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)
      return{ok:false,why:'off screen at '+Math.round(r.left)+','+Math.round(r.top)};
    var hit=document.elementFromPoint(cx,cy);
    var owned=hit===el||(hit&&(el.contains(hit)||hit.contains(el)));
    if(!owned){
      /* A MODAL COVERING THE PAGE BEHIND IT IS THE MODAL WORKING. Without
         this every control on the page underneath reports "covered", which
         buries the two that actually matter — the modal's own BACK and START
         being off the bottom of a landscape phone. */
      for(var a=hit;a;a=a.parentElement)
        if(getComputedStyle(a).position==='fixed'&&!a.contains(el))
          return{ok:true,behindModal:true};
      return{ok:false,why:'covered by '+(hit?(hit.tagName+(hit.id?'#'+hit.id:'')):'nothing')};
    }
    return{ok:true};
  }
  function measure(){
    log('viewport',innerWidth+'x'+innerHeight);
    log('pointer',matchMedia('(pointer:coarse)').matches?'coarse':'fine');
    var de=document.documentElement;
    log('pageScrollsHorizontally',de.scrollWidth>de.clientWidth+2
      ? 'YES by '+(de.scrollWidth-de.clientWidth)+' px' : 'no');
    var ctrls=[].slice.call(document.querySelectorAll(window.__SEL));
    var shown=ctrls.filter(function(el){return el.offsetParent||getComputedStyle(el).position==='fixed';});
    log('controlsVisible',shown.length+'/'+ctrls.length);
    var off=[],small=[],cov=[],behind=0;
    shown.forEach(function(el){
      var id=el.id||el.className||el.tagName;
      id=(''+id).slice(0,26)+':'+(el.textContent||'').trim().slice(0,12);
      el.scrollIntoView({block:'center'});
      var t=tappable(el),r=el.getBoundingClientRect();
      if(t.behindModal){behind++;return;}   // not this screen's problem
      if(!t.ok){ if(/off screen/.test(t.why))off.push(id); else cov.push(id+' ('+t.why+')'); }
      var minSide=el.tagName==='INPUT'?r.height:Math.min(r.width,r.height);
      if(minSide<40)small.push(id+' '+Math.round(r.width)+'x'+Math.round(r.height));
    });
    log('behindAnOpenModal',behind);
    log('unreachableEvenWhenScrolledTo',off.length?off.join(' | '):'none');
    log('coveredBySomething',cov.length?cov.join(' | '):'none');
    log('tapTargetsUnder40px',small.length?small.length+': '+small.slice(0,10).join(' | '):'none');
    var ok=off.length===0&&cov.length===0&&small.length===0
      &&!(de.scrollWidth>de.clientWidth+2);
    log('VERDICT',ok?'MENU IS OPERABLE':'MENU IS NOT OPERABLE');
    report();
  }
  /* Optional: click something first, so a panel that is built on demand — the
     mode-confirm overlay, a popover — is measured too rather than being
     reported as "0 controls, all fine". */
  setTimeout(function(){
    if(window.__CLICK){
      var t=document.querySelector(window.__CLICK);
      log('preClick',window.__CLICK+(t?' ok':' NOT FOUND'));
      if(t)t.click();
    }
    setTimeout(measure,600);
  },1500);
})();
PROBE

python3 - "$PAGE" "$SEL" "$TMP/probe.js" <<'PY'
import sys,pathlib,json,os
page,sel,probe=sys.argv[1],sys.argv[2],sys.argv[3]
html=pathlib.Path(page).read_text(encoding='utf-8')
inject='<script>window.__SEL='+json.dumps(sel)+';window.__CLICK='+json.dumps(os.environ.get('CLICK') or None)+';</script>\n<script>'+pathlib.Path(probe).read_text()+'</script>\n</body>'
if html.count('</body>')!=1: sys.exit('expected exactly one </body> in '+page)
pathlib.Path('_menuprobe.html').write_text(html.replace('</body>',inject,1),encoding='utf-8')
PY
[ -f _menuprobe.html ] || exit 1

python3 -m http.server "$PORT" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1

timeout 120 google-chrome \
  --headless=new --disable-gpu-sandbox --no-sandbox \
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --user-data-dir="$TMP/prof" --window-size="${SIZE/x/,}" \
  ${TOUCH:+--touch-events=enabled --enable-features=TouchpadAndWheelScrollLatching} \
  "http://localhost:$PORT/_menuprobe.html" >"$TMP/chrome.log" 2>&1 &
CHROME=$!
for _ in $(seq 1 60); do grep -q 'GET /PROBE' "$TMP/srv.log" && break; sleep 1; done
kill "$CHROME" 2>/dev/null

if grep -q 'GET /PROBE' "$TMP/srv.log"; then
  echo "== $PAGE at $SIZE"
  grep -o 'GET /PROBE?[^ ]*' "$TMP/srv.log" | head -1 | sed 's#GET /PROBE?##' \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote_plus(sys.stdin.read().strip()).replace("&","\n"))'
else
  echo "NO RESULT — probe never reported."; tail -5 "$TMP/srv.log"; tail -20 "$TMP/chrome.log"
fi
