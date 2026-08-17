#!/bin/bash
# Photograph one clip's grip in the real build.
#
#   ./gripshot.sh <clip> [phase] [handle 0|1] [WxH]
#
# Same machinery as ih25_shot.sh: shotsrv.py serves the folder AND takes the
# POSTed data: URL, because headless --screenshot stalls on a live WebGL page.
# The swiftshader flags are not optional -- with no GL context the page reports
# a bare "Script error. @:0" and half-executes, which reads like a broken build.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CLIP="${1:-IdleN}"
PHASE="${2:-0.5}"
HANDLE="${3:-1}"
SIZE="${4:-900x900}"
NAME="grip_${CLIP}_p${PHASE}_h${HANDLE}"
PORT="${PORT:-8137}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE/_gripshot.html"' EXIT

cd "$HERE" || exit 1
sed "s#</body>#<script>window.GRIP_CLIP='$CLIP';window.GRIP_PHASE=$PHASE;window.GRIP_HANDLE=$HANDLE;window.GRIP_SHOT_NAME='$NAME';</script><script src=\"gripshot.js\"></script>\n</body>#" \
  ice_hockey.html > _gripshot.html
grep -q 'gripshot.js' _gripshot.html || { echo "could not inject the probe (no </body>?)"; exit 1; }

mkdir -p "$HERE/gripshots"
python3 shotsrv.py "$PORT" "$HERE/gripshots" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1

timeout 240 google-chrome \
  --headless=new --disable-gpu-sandbox --no-sandbox \
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --user-data-dir="$TMP/prof" \
  --window-size="${SIZE/x/,}" \
  "http://localhost:$PORT/_gripshot.html" >"$TMP/chrome.log" 2>&1 &
CHROME=$!

for _ in $(seq 1 200); do
  grep -q 'GET /PROBE' "$TMP/srv.log" && break
  sleep 1
done
kill "$CHROME" 2>/dev/null

if grep -q 'GET /PROBE' "$TMP/srv.log"; then
  grep -o 'GET /PROBE?[^ ]*' "$TMP/srv.log" | head -1 | sed 's#GET /PROBE?##' \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote_plus(sys.stdin.read().strip()).replace("&"," "))'
  grep -o 'WROTE [^ ]*' "$TMP/srv.log" | head -1
else
  echo "NO RESULT -- probe never reported. server log tail:"
  tail -5 "$TMP/srv.log"
  echo "chrome log tail:"
  tail -20 "$TMP/chrome.log"
fi
