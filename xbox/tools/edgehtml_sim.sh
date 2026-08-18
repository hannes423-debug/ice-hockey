#!/usr/bin/env bash
# Is compat/es2019.js load-bearing, or is it a comfort blanket?
#
# The Xbox WebView is EdgeHTML, which has no Array.prototype.flatMap. The game
# calls flatMap while building its settings defaults. compat/es2019.js exists to
# cover that — but "it would have crashed without this" is a CLAIM until the
# unfixed build has been run through the same probe and actually seen to fail.
# That is what this does, in one pass, on the real published game.html:
#
#   A  flatMap deleted, shim ABSENT   <- what an Xbox would have got
#   B  flatMap deleted, shim PRESENT  <- what an Xbox gets now
#
# It deletes the method in a script placed exactly where the shim tag sits, so
# the engine looks ES2018 from that point on, and it installs its error handler
# BEFORE the game's own program rather than at the end of the body — a load-time
# TypeError fires long before anything appended near </body> is parsed, which is
# precisely how this failure hides from an ordinary smoke test.
#
# Usage:  xbox/tools/edgehtml_sim.sh          (needs google-chrome)
# Exit 0 only if B boots. A's result is reported either way.
set -u
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$HERE" || exit 1
PORT="${PORT:-8146}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE"/__edgesim_*.html' EXIT

command -v google-chrome >/dev/null || { echo "google-chrome not found"; exit 2; }

python3 - "$PORT" <<'PY'
import sys
port = sys.argv[1]
src = open("game.html", encoding="utf-8").read()
TAG = '<script src="compat/es2019.js"></script>'
assert src.count(TAG) == 1, "the shim tag moved — update this script"

def head(tag):
    # Runs in the shim's own slot, i.e. before the game's program. The error
    # handler has to exist by then or the very error we are hunting is missed.
    return ("<script>"
            "delete Array.prototype.flat;delete Array.prototype.flatMap;"
            "window.__errs=[];"
            "addEventListener('error',function(e){window.__errs.push((e.message||'?')+' @'+(e.lineno||0));},true);"
            "setTimeout(function(){"
            "  var q='/RESULT?tag=" + tag + "'"
            "   +'&flatMap='+(!!Array.prototype.flatMap)"
            "   +'&startMenu='+(document.querySelector('#smStart')?'built':'MISSING')"
            "   +'&canvas='+(document.querySelector('canvas')?'yes':'no')"
            "   +'&errors='+encodeURIComponent(window.__errs.join(' | ')||'none');"
            "  fetch(q).catch(function(){});"
            "},14000);"  # cold-start headless Chrome has been seen to need >9s for the
                        # first of the two runs; a flaky prove-the-bug test is worse than none
            "</script>")

open("__edgesim_a.html", "w", encoding="utf-8").write(src.replace(TAG, head("A"), 1))
open("__edgesim_b.html", "w", encoding="utf-8").write(src.replace(TAG, head("B") + TAG, 1))
print("built A (no shim) and B (shim)")
PY

python3 -m http.server "$PORT" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1

for V in a b; do
  # swiftshader flags are mandatory: with no GL context the page reports a bare
  # "Script error. @0" and half-runs, which would be indistinguishable from the
  # failure this script is trying to observe.
  timeout 90 google-chrome \
    --headless=new --no-sandbox --disable-gpu-sandbox \
    --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
    --user-data-dir="$TMP/prof-$V" --window-size=1280,800 \
    "http://localhost:$PORT/__edgesim_$V.html" >"$TMP/chrome-$V.log" 2>&1 &
  CH=$!
  for _ in $(seq 1 70); do grep -q "GET /RESULT?tag=${V^^}" "$TMP/srv.log" && break; sleep 1; done
  kill "$CH" 2>/dev/null
done

echo
echo "== game.html on an engine with no Array.prototype.flatMap =="
OK=1
for V in A B; do
  LINE=$(grep -o "GET /RESULT?tag=$V[^ ]*" "$TMP/srv.log" | head -1)
  case "$V" in
    A) echo "-- A: shim ABSENT  (what the Xbox would have got)" ;;
    B) echo "-- B: shim PRESENT (what the Xbox gets now)" ;;
  esac
  if [ -z "$LINE" ]; then
    echo "   never reported — the page died before its own timer ran"
    [ "$V" = B ] && OK=0
    continue
  fi
  echo "$LINE" | sed 's#GET /RESULT?##' \
    | python3 -c 'import sys,urllib.parse
for kv in urllib.parse.unquote_plus(sys.stdin.read().strip()).split("&"):
    k,_,v=kv.partition("=")
    print("   %-11s %s"%(k,v))'
  echo "$LINE" | grep -q 'startMenu=built' || { [ "$V" = B ] && OK=0; }
done

echo
[ "$OK" = 1 ] && echo "PASS — the shimmed build boots on an engine without ES2019." \
             || { echo "FAIL — the shimmed build does NOT boot."; exit 1; }
