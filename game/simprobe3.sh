#!/bin/bash
# Visual + animation-state probe. Same shape as simprobe.sh, but the server is
# shotsrv.py (GET like http.server, plus POST /shot which writes a PNG), because
# the page hands back its own canvas pixels instead of relying on
# --screenshot (which stalls on a live WebGL page).
#
#   ./simprobe3.sh          -> prints the numbers, writes skating.png / carry.png
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8133}"
TMP="$(mktemp -d)"
PROF="$TMP/chromeprofile"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE/_simprobe.html"' EXIT

cd "$HERE" || exit 1
sed 's#</body>#<script src="simprobe3.js"></script>\n</body>#' ice_hockey.html > _simprobe.html
grep -q 'simprobe3.js' _simprobe.html || { echo "could not inject the probe (no </body>?)"; exit 1; }

python3 shotsrv.py "$PORT" "$HERE" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1

timeout 180 google-chrome \
  --headless=new --disable-gpu-sandbox --no-sandbox \
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --user-data-dir="$PROF" \
  --window-size=1280,800 \
  "http://localhost:$PORT/_simprobe.html" >"$TMP/chrome.log" 2>&1 &
CHROME=$!

for _ in $(seq 1 150); do
  grep -q 'GET /PROBE' "$TMP/srv.log" && break
  sleep 1
done
kill "$CHROME" 2>/dev/null

echo "=== written PNGs ==="
grep -o 'WROTE [^ ]*' "$TMP/srv.log" || echo "(none)"
echo "=== probe ==="
if grep -q 'GET /PROBE' "$TMP/srv.log"; then
  grep -o 'GET /PROBE?[^ ]*' "$TMP/srv.log" | tail -1 | sed 's#GET /PROBE?##' \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote_plus(sys.stdin.read().strip()))'
else
  echo "NO RESULT — probe never reported. server log tail:"
  tail -8 "$TMP/srv.log"
  echo "chrome log tail:"
  tail -20 "$TMP/chrome.log"
fi
