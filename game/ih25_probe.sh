#!/bin/bash
# Run one of the 2.5D acceptance probes against ice_hockey_25d.html.
#
#   ./ih25_probe.sh ih25_contact_probe.js
#   TARGET=ice_hockey.html ./ih25_probe.sh ih25_collide_probe.js   # the original
#   WINDOW=780,1688 DSF=2 ./ih25_probe.sh ih25_menu_probe.js      # a phone
#     (headless refuses to make a window narrower than ~500 px, so a phone
#      viewport has to be reached through the device scale factor instead)
#
# The swiftshader flags are not optional: with no GL context the page reports a
# bare "Script error. @:0" and half-executes, which reads exactly like a broken
# build. No --virtual-time-budget either: it stalls on a live WebGL page.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PROBE="${1:?usage: ih25_probe.sh <probe.js>}"
TARGET="${TARGET:-ice_hockey_25d.html}"
PORT="${PORT:-8135}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${SRVPID:-}" ] && kill "$SRVPID" 2>/dev/null; rm -f "$HERE/_ih25probe.html"' EXIT

cd "$HERE" || exit 1
sed "s#</body>#<script src=\"$PROBE\"></script>\n</body>#" "$TARGET" > _ih25probe.html
grep -q "$PROBE" _ih25probe.html || { echo "could not inject the probe (no </body>?)"; exit 1; }

python3 -m http.server "$PORT" >"$TMP/srv.log" 2>&1 &
SRVPID=$!
sleep 1

timeout 180 google-chrome \
  --headless=new --disable-gpu-sandbox --no-sandbox \
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --user-data-dir="$TMP/prof" --window-size="${WINDOW:-1280,800}" \
  --force-device-scale-factor="${DSF:-1}" \
  "http://localhost:$PORT/_ih25probe.html" >"$TMP/chrome.log" 2>&1 &
CHROME=$!

for _ in $(seq 1 150); do
  grep -q 'GET /PROBE' "$TMP/srv.log" && break
  sleep 1
done
kill "$CHROME" 2>/dev/null

if grep -q 'GET /PROBE' "$TMP/srv.log"; then
  echo "== $PROBE on $TARGET"
  grep -o 'GET /PROBE?[^ ]*' "$TMP/srv.log" | head -1 | sed 's#GET /PROBE?##' \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote_plus(sys.stdin.read().strip()).replace("&","\n"))'
else
  echo "NO RESULT — probe never reported. server log tail:"
  tail -5 "$TMP/srv.log"
  echo "chrome log tail:"
  tail -20 "$TMP/chrome.log"
fi
