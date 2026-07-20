# Headless test harnesses

Verified suites for ice_hockey.html (`index.html`). Each is appended to a copy
of the game before `</body>` and run in real-time headless Chrome; results are
fetched into the `python3 -m http.server` log.

- `harness_1v1.js` — 1v1 Swedish-style rules + bot brain + net/board physics (14 checks, stepped physics under `__poseFrozen`)
- `harness_gamepad.js` — P1 gamepad layer, Hybrid + Classic schemes (42 checks, live loop, mock DS4)
- `harness_match.js` — MATCH mode: lobby join, device exclusivity, two nets, team AI tactics, P2 controls, colors (20 checks, two mock pads)
- `harness_lobby.js` — lobby rework: pad menu focus-nav, practice lobby (join/leave, BOTS counter, free-skate roster), P1 input lock pad/kbm/auto (23 checks, two mock pads)

## Running one

```bash
python3 - <<'PY'
src=open('index.html').read()
h=open('tests/harness_match.js').read()
open('/tmp/ih_TEST.html','w').write(src.replace('</body>','<script>\n'+h+'\n</script>\n</body>',1))
PY
cd /tmp && python3 -m http.server 8791 > server.log 2>&1 &
timeout 230 google-chrome --headless=new --no-sandbox --mute-audio \
  --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=640,360 \
  "http://localhost:8791/ih_TEST.html" > /dev/null 2>&1
rm -rf /tmp/com.google.Chrome.scoped_dir.*   # each killed Chrome leaks ~130M
for i in $(seq 1 40); do curl -s -o /dev/null "http://localhost:8791/FLUSH_$(printf 'x%.0s' {1..180})_$i"; done
grep -a -o "MRESULT_[^ \"]*" server.log | tail -1   # PADRESULT_/V1RESULT_ for the others
```

Gotchas that will bite you (learned the hard way):
- Headless swiftshader runs ~2-5 fps with clamped dt: condition-POLL every check
  (`until(fn,timeout)`), hold inputs until the state change is observed, and
  make sure a mock button RELEASE is seen (PAD.pb) before the next press.
- The server log is block-buffered — pump dummy curls before reading it.
- Rules-test shots must park the goalie out of the lane first, or saves flake the test.
