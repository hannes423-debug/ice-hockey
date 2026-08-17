#!/bin/bash
# Dump the build's hand-local frame for one clip, to compare against Blender.
#   ./handframe.sh <clip> [phase] [WxH]
# See handframe.js. Same harness as gripshot.sh; swiftshader flags are not
# optional (no GL context reads as a broken build).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CLIP="${1:-IdleL}"; PHASE="${2:-0.5}"; SIZE="${3:-600x600}"
PORT="${PORT:-8139}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE/_handframe.html"' EXIT
cd "$HERE" || exit 1
sed "s#</body>#<script>window.HF_CLIP='$CLIP';window.HF_PHASE=$PHASE;</script><script src=\"handframe.js\"></script>\n</body>#" \
  ice_hockey.html > _handframe.html
grep -q 'handframe.js' _handframe.html || { echo "inject failed"; exit 1; }
python3 -m http.server "$PORT" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1
timeout 240 google-chrome --headless=new --disable-gpu-sandbox --no-sandbox \
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --user-data-dir="$TMP/prof" --window-size="${SIZE/x/,}" \
  "http://localhost:$PORT/_handframe.html" >"$TMP/chrome.log" 2>&1 &
CHROME=$!
for _ in $(seq 1 200); do grep -q 'GET /PROBE' "$TMP/srv.log" && break; sleep 1; done
kill "$CHROME" 2>/dev/null
if grep -q 'GET /PROBE' "$TMP/srv.log"; then
  echo "== $CLIP phase $PHASE"
  grep -o 'GET /PROBE?[^ ]*' "$TMP/srv.log" | head -1 | sed 's#GET /PROBE?##' \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote_plus(sys.stdin.read().strip()).replace("&","\n"))'
else
  echo "NO RESULT"; tail -5 "$TMP/srv.log"; tail -20 "$TMP/chrome.log"
fi
