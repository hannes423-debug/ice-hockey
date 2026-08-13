#!/bin/bash
# Headless check of the simulation-first contract in ice_hockey.html.
# Builds _simprobe.html = ice_hockey.html + simprobe.js, serves this folder,
# drives a REAL-TIME headless Chrome, and reads the result back out of the
# python http.server access log (the fetch('/PROBE?...') line).
#
#   ./simprobe.sh
#
# The swiftshader flags are not optional: with no GL context the page reports a
# bare "Script error. @:0" and half-executes, which reads exactly like a broken
# build. No --virtual-time-budget either: it stalls on a live WebGL page.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8127}"
TMP="$(mktemp -d)"
PROF="$TMP/chromeprofile"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE/_simprobe.html"' EXIT

cd "$HERE" || exit 1
sed 's#</body>#<script src="simprobe.js"></script>\n</body>#' ice_hockey.html > _simprobe.html
grep -q 'simprobe.js' _simprobe.html || { echo "could not inject the probe (no </body>?)"; exit 1; }

python3 -m http.server "$PORT" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1

timeout 120 google-chrome \
  --headless=new --disable-gpu-sandbox --no-sandbox \
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --user-data-dir="$PROF" \
  --window-size=1280,800 \
  "http://localhost:$PORT/_simprobe.html" >"$TMP/chrome.log" 2>&1 &
CHROME=$!

for _ in $(seq 1 100); do
  grep -q 'GET /PROBE' "$TMP/srv.log" && break
  sleep 1
done
kill "$CHROME" 2>/dev/null

if grep -q 'GET /PROBE' "$TMP/srv.log"; then
  grep -o 'GET /PROBE?[^ ]*' "$TMP/srv.log" | head -1 | sed 's#GET /PROBE?##' \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote_plus(sys.stdin.read().strip()))'
else
  echo "NO RESULT — probe never reported. server log tail:"
  tail -5 "$TMP/srv.log"
  echo "chrome log tail:"
  tail -20 "$TMP/chrome.log"
fi
