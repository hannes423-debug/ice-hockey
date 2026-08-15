#!/bin/bash
# Screenshot the 2.5D build's locked view.
#
#   ./ih25_shot.sh [name] [zoom] [WxH]
#
# Uses shotsrv.py, which serves the folder AND accepts the POSTed data: URL —
# headless --screenshot stalls on a live WebGL page. The swiftshader flags are
# not optional: with no GL context the page reports a bare "Script error. @:0"
# and half-executes, which reads exactly like a broken build.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="${1:-ih25_shot}"
ZOOM="${2:-0}"
SIZE="${3:-1280x800}"
PORT="${PORT:-8136}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE/_ih25vsshot.html"' EXIT

cd "$HERE" || exit 1
sed "s#</body>#<script>window.IH25_SHOT_ZOOM=$ZOOM;window.IH25_SHOT_NAME='$NAME';window.IH25_SHOT_OVERLAY=${OVERLAY:-0};window.IH25_VS_SLOT=${SLOT:-3};</script><script src=\"ih25_vsshot.js\"></script>\n</body>#" \
  ice_hockey_25d.html > _ih25vsshot.html
grep -q 'ih25_vsshot.js' _ih25vsshot.html || { echo "could not inject the probe (no </body>?)"; exit 1; }

python3 shotsrv.py "$PORT" "$HERE" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1

timeout 180 google-chrome \
  --headless=new --disable-gpu-sandbox --no-sandbox \
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --user-data-dir="$TMP/prof" \
  --window-size="${SIZE/x/,}" \
  "http://localhost:$PORT/_ih25vsshot.html" >"$TMP/chrome.log" 2>&1 &
CHROME=$!

for _ in $(seq 1 150); do
  grep -q 'GET /PROBE' "$TMP/srv.log" && break
  sleep 1
done
kill "$CHROME" 2>/dev/null

if grep -q 'GET /PROBE' "$TMP/srv.log"; then
  grep -o 'GET /PROBE?[^ ]*' "$TMP/srv.log" | head -1 | sed 's#GET /PROBE?##' \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote_plus(sys.stdin.read().strip()).replace("&","\n"))'
  grep -o 'WROTE [^ ]*' "$TMP/srv.log" | head -1
else
  echo "NO RESULT — probe never reported. server log tail:"
  tail -5 "$TMP/srv.log"
  echo "chrome log tail:"
  tail -20 "$TMP/chrome.log"
fi
