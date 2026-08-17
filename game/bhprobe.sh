#!/bin/bash
# Does a backhand shot play the animator's backhand clip?
#   ./bhprobe.sh [WxH] [page]
# See bhprobe.js. Same harness as stickprobe.sh; swiftshader flags are not
# optional (no GL context reads as a broken build).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SIZE="${1:-600x600}"
# optional: probe a DIFFERENT build (a backup) to prove the probe can fail
PAGE="${2:-ice_hockey.html}"
PORT="${PORT:-8147}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE/_bhprobe.html"' EXIT
cd "$HERE" || exit 1
sed "s#</body>#<script src=\"bhprobe.js\"></script>\n</body>#" \
  "$PAGE" > _bhprobe.html
grep -q 'bhprobe.js' _bhprobe.html || { echo "inject failed"; exit 1; }
python3 -m http.server "$PORT" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1
timeout 240 google-chrome --headless=new --disable-gpu-sandbox --no-sandbox \
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --user-data-dir="$TMP/prof" --window-size="${SIZE/x/,}" \
  "http://localhost:$PORT/_bhprobe.html" >"$TMP/chrome.log" 2>&1 &
CHROME=$!
for _ in $(seq 1 200); do grep -q 'GET /PROBE' "$TMP/srv.log" && break; sleep 1; done
kill "$CHROME" 2>/dev/null
if grep -q 'GET /PROBE' "$TMP/srv.log"; then
  echo "== clip-owned stick sweep"
  grep -o 'GET /PROBE?[^ ]*' "$TMP/srv.log" | head -1 | sed 's#GET /PROBE?##' \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote_plus(sys.stdin.read().strip()).replace("&","\n"))'
else
  echo "NO RESULT"; tail -5 "$TMP/srv.log"; tail -20 "$TMP/chrome.log"
fi
