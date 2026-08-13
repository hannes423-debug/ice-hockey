# Sim-First Architecture — progress & checkpoints

Task: rebuild `ice_hockey.html` around the "simulation is authoritative,
animation is presentation" spec (9 sections: sim authority, model-as-skin,
player indicator, puck-always-an-entity, semi-lock possession, possession as a
spectrum, puck shadow, visual hierarchy, design goal).

**This task has crashed the session 3 times. Checkpoint after every landed
change. Never hold the whole 3.4 MB file in context — grep, don't read.**

## Backups (game/)

| File | What it is |
|------|-----------|
| `ice_hockey.html.bak_pre_simfirst` | state BEFORE this task began (Aug 10 19:19) |
| `ice_hockey.html.bak_simfirst_wip_recovered` | session-2 recovery point (19:52) |
| `ice_hockey.html.bak_simfirst_ckpt2` | session-3 checkpoint (20:03) |
| `ice_hockey.html.bak_session4_start` | session-4 start = current (Aug 10) |

`diff ice_hockey.html.bak_pre_simfirst ice_hockey.html` is the whole feature,
~405 diff lines. Read that before assuming anything is missing.

## Verification harness (already built, in game/)

- `shotsrv.py` — GET like http.server + POST /shot writes a PNG. Needed because
  headless `--screenshot` stalls on a live WebGL page.
- `simprobe.sh` + `simprobe.js` — the numeric sim/presentation probe. Injects
  itself before `</body>`, drives the real game, reports via `fetch('/PROBE?…')`
  into the server access log. **This is the acceptance test.**
- `simprobe3.sh` + `simprobe3.js` — visual/animation-state probe, writes
  skating.png / carry.png the same way.

Run: `./simprobe.sh` from `game/`. Needs the swiftshader flags (already in the
script) or Chrome reports a bare `Script error. @:0`.

## What is DONE (landed, in the current file)

- **§1/§8 stick target is committed from INPUT, before any pose runs.** End of
  `updatePlayer`: `player.stickTarget` / `player.stickTip` = `poseAimPt`, built
  from the skill stick / cursor / RS through `clampToReachEnvelope` plus the
  scripted branches. Reversed the old order, where `poseStick` re-derived
  `stickTip` off the two animated fists — i.e. the clip decided where gameplay
  thought the stick was, and `handleBlend` falls to 0 during every windup.
- **§2 the posed blade became presentation** — lands in `ent.stickVis`;
  `player.stickVisErr` measures the gap. Nothing gameplay-side reads stickVis.
- **§3 indicator is the simulation drawn** — ring from `player.pos`/`heading`,
  unsmoothed; opacity rides `puck.control`.
- **§4 the puck is never parented**; §5/§6 **possession is a spectrum**:
  `puck.control` 0..1 rebuilt each frame from offset / yaw rate / carrier speed
  / backhand stance, and control IS the spring rate (`carryRateMin..Max`).
  Breaking the bond never teleports or impulses the puck.
- **Pickup opens the relationship WEAK** (`ctrlCatch` scaled by arrival speed) —
  the free → nearby → recoverable → controlled ramp.
- **Shooting imparts velocity and no longer repositions the puck** (was
  `puck.pos.copy(player.stickTip)` — a teleport onto the blade).
- **§7 puck shadow** is the exact ground projection, opacity rises with air time.
- **F2 debug overlay** prints `modelErr` / `stickErr` / `control` / `puck off` —
  the simulation → indicator → model → animation chain, top to bottom.

## Deliberately NOT done (decided, don't silently "fix")

- `ctrlRelVelPenalty` (control lost per m/s of puck-relative speed) was added at
  ckpt2 and **deliberately reverted** at 20:07. Reason is in the comment at the
  carry spring: the branch ends with `puck.vel = player.vel + spring`, so
  relative velocity is just the offset term re-measured — double-counting behind
  a knob that looks like it means something else. Making it real requires the
  carry spring to become an ACCELERATION on the puck's own velocity rather than
  an assignment. That is the more spec-faithful physics and is the **named next
  step**, but it changes carry feel and must not be done silently.

## Open / next

1. ~~Run `./simprobe.sh` and record the numbers.~~ **DONE, 20/20 PASS.**
2. **Close the presentation debt in the skill-stick sweep** — the headline
   number, see "Presentation debt" below. ← current step
3. Consider the acceleration-based carry spring (see above).

## Session log

- **Session 5 (Aug 11).** Verified `ice_hockey.html` is byte-identical
  (md5 `45e6690f…`) to `ice_hockey.html.bak_session4_start`, so session 4
  crashed before landing anything and that backup IS the session-5 restore
  point — no new 3.4 MB copy was made. Disk 14 G free, tmpfs 1 % — the crashes
  were not the tmpfs trap. Started at step 1, running the probe.

## Probe results — Aug 11, session 5: **20/20 PASS, FAILURES=0**

Full log: re-runnable with `./simprobe.sh` (takes ~2 min). Key numbers:

| Contract | Number |
|---|---|
| input turns sim on frame 1 | dHeading 0.236 rad, dSpeed 0.125 m/s |
| sim response without the mixer | dHeading 0.165 rad (see caveat) |
| model root at sim position | `modelErr` **0** |
| indicator ring at sim position | `ringErr` **0** |
| gameplay tip IS the input target | `0` horiz; neutral reach 1.49 = `iceBaseFwd` |
| control builds at rest | 0.15 → **1.0**, offset 0 |
| control weakens under speed+carve | 1.0 → **0.795**, puck lags 0.106 m |
| break is clean | no possession, jump 0.102 m, control 0 |
| reception opens weak | `control.onCatch` **0.138** |
| shot | no teleport (jump **0** on a 0.7 m lag), 28.5 m/s, ends the bond |
| puck shadow | `afterFrame` **0** |

### Two things the numbers say that the PASS/FAIL does not

**a) Presentation debt is the real remaining work (§9).** `stickVisErr` is 0.415 m
at a normal skating sample but **mean 1.59 m / max 2.08 m** across the
skill-stick sweep. That is roughly a stick length — visually the puck will not
read as being on the blade during deflection. The architecture is fine (gameplay
never reads `stickVis`), this is exactly the animation debt §9 says to keep
paying down. Note the shape: the gap is **largest at neutral** (u=0.00 → 2.078)
and **smallest at u=+0.75** (0.643), which is not how a blade that tracks its
target behaves — it is consistent with the rendered blade being near-stationary
while the sim target sweeps past it. Start there.

**b) The "independent of animation" PASS is thinner than it looks.** 0.236 vs
0.165 rad is a 30 % difference; it passes only because the tolerance is
`dH*0.35`. It may well be an artifact — the two samples are taken at different
speeds (`run(40)` vs `run(30)`) and turn rate is speed-dependent, so this is not
apples-to-apples. **Not a known defect, but it needs a speed-matched retest
before anyone trusts that check.**

### Probe fix landed this session

`simprobe.js` measured the puck shadow immediately after hand-teleporting
`puck.pos` by 0.7 m, without stepping a frame, and reported a 0.7 m shadow
error — the probe reading its own artifact. It now measures **both** sides:
`staleSameFrame` 0.7 / `afterFrame` 0. The game was never wrong. The stale
number is kept in the report deliberately so the artifact stays visible.
