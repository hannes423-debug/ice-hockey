# ice_hockey.html — baked-clip / idle-stance fix progress
Running log so a crash never loses the thread. Session 2fba8772 (2026-07-30).

Backups: `ice_hockey.html.bak_pre_anims` (before clips), `.bak_pre_animfix2`
(before the crashed session's fixes), `.bak_pre_animfix3` (before THIS session).

## STAGE 1 — DONE: recovered the crashed session's work
All 8 edits from session 7a3b8135 are present in the file and it parses clean
(node --check on both inline script blocks: 96550 + 2204827 chars, OK).
Recovered from its transcript, not redone. What those edits were:

1. **Clip-selection dithering fixed.** `locoAction` thresholds were bare
   comparisons, so a signal parked on a boundary flipped the clip every few
   frames, and `setLoco` called `want.reset()` on each flip. Measured in the
   crashed session: IdleL/IdleN swapped **8 times in 140 frames**, every switch
   reading `@t0.00` — the 3.33s idle clips never played past ~0.4s, so the
   authored idle stance was effectively never seen and each restart was a visible
   upper-body jerk. Now: hysteresis on every threshold (`idleLeanRelease`,
   `clipMoveEnter/Exit`, `clipBackRelease`), a `clipDwell:0.22` floor between any
   two switches (`ent.clipHoldT`, ticked in applyJointFlex), and **phase
   carry-over instead of reset()** — the incoming clip inherits the outgoing
   clip's normalised phase, so legs keep going round instead of snapping to t0.
2. **THE SPIN — root cause was IK pole degeneracy, not the body.** `solveArm`
   needs the component of `pole` perpendicular to the shoulder->target axis. The
   pole is rotated about the stick shaft by handRoll/lat, so aiming across the
   body sweeps it right through that axis and the perpendicular cancels
   (measured |n| down to 0.040 = 96% cancelled) — the elbow's orbit was then
   decided by numerical leftovers, with only a hard `|n|<0.003 -> (0,-1,0)`
   trapdoor that jumps the elbow to an unrelated side. Measured **103 deg in ONE
   frame** and sustained 25-37 deg/frame forearm buzz. Fix: `arm._ik` persists
   the last well-conditioned perpendicular per arm, re-orthogonalised against the
   current axis and blended in over the marginal band (`_ikPoleMin=0.35`), never
   flipping side.

NOTE the earlier 07-29 finding still stands and is a different thing: the
"spin" the user saw ALSO had a component from the clips swinging the torso while
the stick stayed pinned to the aim (fixed then by `freeArmSkate`, bottom arm
only). The pole degeneracy is the remaining, sharper one.

## STAGE 2 — DONE: audit of the whole player pose path

Audited every joint-write site in the player path (not just applyJointFlex).
`flexBone` early-returns on a zero angle, so every LP-zeroed term is a true
no-op, not a small residue.

**Already correctly gated under clip drive (no action needed):** base spine/neck/
head lean (fSpine1-3, fNeck, fHead), shot weight-transfer stagger, ready-stance
hips/knees/ankles, stanceWiden, hipTurnout — all via `LP=clipDrive?0:1`. The
procedural stride and the weight/hip/shoulder sway it drives are killed by
`strideSuppress=max(...,clipDrive?1:0)` making `strideAmp` (and therefore
`swAmp` and `ent.swayLat`) exactly 0. `CONFIG.stanceSink` is gated inline at the
root composition. Clip phase is read back off the active clip's playhead so the
stick sway / carry pump / weight sway stay in step with the animated legs.

**Kept deliberately (situational, no clip covers them — per the user's "those
that dont interfere can stay"):** hockey stop, soft stop, crossover, mohawk,
stumble wobble/lean, kneel, dive, protect, plus the whole stick IK + finger grip
chain and the aim-driven spine twist / head look-at. Each sits behind its own
blend factor that is 0 unless the move is active.

**Dead code, harmless, left alone:** `gripOrient:1` makes the
`else if(ent.mixer&&ent.joints)flexBone(hand_r/l,...,fWristR/L)` branches in
poseStick unreachable. No old clip names (Idle_Loop/Walk_Loop/Sprint_Loop) remain
anywhere. The static single-frame `Idle` action in the GLB is intentionally not
mapped (`A.idle` is `IdleN`).

### THE REAL REMAINING RELIC — `lat` wrapped through +-PI (FIXED this session)
This is the one the earlier passes missed, and it explains "spins **in some
positions**" better than anything else found so far.

`lat` (poseStick) is the shaft's horizontal angle off the facing, measured from
the **grip anchor**, not from `ent.pos`. `CONFIG.minAimFwd:0.2` only keeps the
aim 0.2 m in front of *ent.pos*, while the anchor sits `gripFwd:0.54` ahead of it
(plus up to 0.14 m of grip excursion). So with the puck tucked in tight the
shaft's horizontal component points **backward**, and the bare
`atan2(across, along)` returned a value near +-PI that **flipped sign the moment
the lateral component crossed zero** — a 2*PI discontinuity on one frame.

Everything that signal feeds jumped at once:
- spine twist — snapped ~120 deg in one frame (clamped 2*1.05 rad)
- hand roll — snapped ~160 deg, and it orients **both IK elbow poles**, driving
  them straight through the degenerate parallel case (the `solveArm` bug fixed in
  stage 1 — so these two bugs were compounding each other)
- `zoneOf(stanceLat)` — a tucked puck silently flipped forehand/backhand shot type
- the deke / toe-drag swing detector, and `toeDragSide`
- **`idleLeanLat` — the L/R idle-stance choice**, i.e. it was directly
  destabilising the very new stances this work is meant to force

**Fix:** new `latAngle(v,F)` helper floors the forward component at
`CONFIG.latMinFwd:0.05` before the atan2. The angle stays continuous through
zero and is bounded to about +-87 deg; every consumer clamps well inside that
(spineTwistMax 1.05, handRoll 1.4) so the usable range is unchanged. Applied to
both `lat` and the sway-corrected `stanceLat` (which had its own copy of the
same wrapping atan2). Syntax verified.

## STAGE 3 — DONE: found and fixed the ACTUAL residual spin (antipodal roll)

The lat fix alone did NOT stop the arm whipping, and measuring instead of
assuming is what found the real one. Instrumented `solveArm` first: the stage-1
pole fix is working (only **1 orbit turn >45 deg in 1440 calls**), and crucially
the worst ARM step was at a **different frame** than the worst orbit turn — so a
third mechanism was left.

Per-frame trace of the spike frames showed something that looks impossible until
you see it: `upperarm_r` rotating **153-167 deg in ONE frame** while the **elbow
and hand moved 1.2 cm**, parent chain only 4 deg, orbit stable. Nothing about the
IK triangle changed — it was a **pure twist about the bone's own axis**, with the
forearm counter-twisting to keep the hand on the shaft.

**Root cause: the antipodal singularity of `setFromUnitVectors`.** It builds the
minimal rotation from the bone's rest direction to the desired one, and its AXIS
is their cross product. Logged the rotation angle: `upperarm_r` sits at
**169.2-178.7 deg** right through an ordinary aim sweep — the rig is parked
permanently ON the antipode, where that cross product is tiny and its direction
is decided by noise. Both branches aim at the same elbow and differ by ~180 deg
of roll, so it flips constantly. It surfaced with the baked clips because they
swing the torso far more than the tuned procedural stance did, sweeping the
desired direction further in PARENT space and crossing the branch line often.

**Fix:** new `aimBone()` — inside the antipodal band the roll is no longer taken
from the ill-conditioned cross product. Any twist about the aim direction
preserves the aim, so the valid solutions are a one-parameter family and we take
the member closest to the previous call's quaternion, in closed form (A=dot(q,prev),
B=dot(u*q,prev), optimum at t=2*atan2(B,A) — no search). Blended by depth into
the band, so at the band edge the result is bit-for-bit the old behaviour and the
normal pose is unchanged. Applied to both the upper arm and the forearm.
Also raised `latMinFwd` 0.05 -> 0.30: the floor doubles as the gradient limiter
(~1/floor), and 0.05 removed the wrap but left a 20x near-singular ramp.

### MEASURED, before -> after (real game, fixed dt 1/60, frame-counted)
| metric | before | after |
|---|---|---|
| max abs d lat per frame (tucked sweep) | **353.51 deg** (full 2*PI wrap) | **21.59 deg** |
| lat range | -178.6 .. +179.9 | -72.5 .. +71.0 (as designed) |
| spine_03 max step, tucked sweep | 120.32 deg | **18.35 deg** |
| head max step, tucked sweep | 93.31 deg | **15.04 deg** |
| upperarm_r max step, tucked sweep | 158.05 deg | **43.43 deg** |
| lowerarm_r max step, tucked sweep | 171.73 deg | **45.09 deg** |
| upperarm_r worst step, isolated idle sweep | 166.94 deg | **34.86 deg** |
| upperarm_r frames over 45 deg / 299 | **12** | **0** |
| upperarm_r mean step | 8.15 deg | **5.37 deg** (07-29 baseline 4.8-6.5) |
| upperarm_l over 45 deg / 299 | - | 0 (max 25.59, mean 0.93) |
| idle clip max playhead reached | ~0.4 s (dither-capped) | **3.32 s of 3.33 s** |

Smoke test, no JS errors in any mode: clips ON max 9.43 deg / mean 1.28; `J`
toggle to procedural works (`clipDrive=false`, max 0.19 deg); toggle back on
works; goalie present at y=-0.300, which is its documented standing stance sink
(-0.30), not a regression. `node --check` clean on both inline blocks throughout.

### Still open / watch on the next real playtest
- **`lowerarm_l` shows ONE 55.6 deg step per 299 frames, at `fab=0.718`,
  `dfab=0.070`** — that is the deliberate free-arm handover ramping in
  (`freeArmBlendRate:3.0`, ~0.33 s), not a spin. Mean is 1.68 deg. If it reads as
  a flick on screen, lower `freeArmBlendRate` rather than touching the IK.
- The clip selector now switches ~8 times per 240-frame aim sweep, but each one is
  a genuine threshold crossing of a slowly sweeping signal (the sweep crosses
  `idleLeanLat` about 4x per period), NOT the old dithering. Verified by the
  playhead reaching 3.32 s.
- 9 action keys are reported (`...,pose,sprint`) because some are ALIASES of the
  same action object; the log picks the last matching key. Not a second clip set.
- Everything here is `~/Lataukset/` only. **NOT deployed** and **NOT
  user-playtested.** Deploying needs `game.html` AND `ice-hockey-customize-data.js`
  shipped together (see the 07-28 note in the project memory).

## STAGE 4 (2026-07-30, after user playtest of base ice_hockey.html)
User: "top hand is way too up", arms in the wrong position vs the clips they have
seen, and the upper body still spins at times.

### MEASURED: the clips vs what is actually rendered (root-local, y = above skates)
Hooked `mixer.update` to snapshot the RAW authored clip pose before any IK, and
compared against the final rendered pose (mean of 30 frames):

| state | clip top hand y | rendered | drift | handSep clip -> rendered |
|---|---|---|---|---|
| idle_carry  | 0.950 | **1.386** | **+0.436** | 0.771 -> 0.376 |
| skate_carry | 1.148 | **1.392** | **+0.243** | 0.605 -> 0.406 |
| idle_nopuck | 0.990 | **1.389** | **+0.399** | 0.658 -> 0.853 |

Shoulder sits at y=1.398, so `gripUp:1.38` pins the top hand **level with the
shoulder**. That IS the user's complaint, and it is NOT a clip/procedural
blending bug — it is the grip anchor constant, which is ground-relative and was
tuned against the old procedural stance.

**The geometry is a hard trilemma** (verified against the live numbers, model
reproduces the current build to 2 cm): the blade sits on the ice only while
`|aim - anchor| == stickLen - snapAlong == 1.39`. With anchor height
h = gripUp - iceHeight, the blade's distance in front of the player is
`gripFwd + sqrt(1.39^2 - h^2)`:
- gripUp 1.38 -> blade 0.93  (matches iceBaseFwd 0.95 today)
- gripUp 1.20 -> blade 1.31
- gripUp 1.05 -> blade 1.50
So hands-low + blade-on-ice + short-carry cannot all hold. Lowering the hands
REQUIRES the puck to ride further ahead (iceBaseFwd), which is gameplay reach.
Raising `snapAlong` instead keeps the reach but puts 25-36 cm of shaft above the
top hand, which looks wrong. **This needs a user decision — asked.**
(Hand separation is separately capped by this rig's 0.48 m shoulder->wrist reach,
already documented in the 07-26 note; botFrac changes do nothing.)

### TRIED AND REJECTED: give the clips authority over the arm ROLL
Snapshotted the clip's arm quaternions before the IK and resolved aimBone's
one-parameter roll family toward THEM instead of toward last frame. Sounds
strictly better; measurably worse, and reverted. The clip's arm pose is not
reachable by this IK (the hand must be on the stick, the clip's arm isn't holding
one), so the reference often sits nearly orthogonal to the family's great circle,
A^2+B^2 collapses and it becomes a fresh degeneracy. Measured full-strength vs
frame-to-frame: lowerarm_r idle_nopuck 16.1 -> 137.6 deg/frame, protect
17.0 -> 122.7, aimsweep_wide 101.2 -> 171.7. The rejection note is in the code
above aimBone. Don't retry without a confidence gate on A^2+B^2 AND a way to make
the clip pose reachable.

### 15-STATE SPIN SWEEP (with the accepted fixes only; frames whose worst
### upper-body bone stepped >45 deg, out of N)
clean: pivot_pump 0/150, idle_nopuck 0/150, tuck_sweep 1/180, crossover 1/150,
skate_nopuck 2/150, skate_carry 2/150, brake_hard 3/120, protect 5/150,
sprint_carry 6/150, idle_carry 8/150, aimsweep_wide 13/180
**worst by far: brake_soft 22/120, with spine_03 stepping 149.2 deg (mean 10.7
vs 1.5-2.6 everywhere else). spine_03 is NOT IK-driven, so that one is a pure
procedural brake-pose bug, separate from the IK singularities.**

### THE DEEPER FINDING, for whoever picks this up
`UAmax` (how close upperarm_r's rotation sits to the 180 deg antipode) is
**179-180 deg in EVERY ONE of the 15 states.** The rig is not occasionally near
the singularity, it lives on it, so every roll-continuity patch is treating a
symptom. The principled fix is to stop deriving the arm's orientation from
`setFromUnitVectors` (a minimal rotation, roll undefined) and instead build it
from a FULL frame using the already-stabilised elbow-orbit normal `n` as the
secondary axis — that makes the roll a deterministic function of well-conditioned
inputs instead of something to be kept continuous. Needs the bone's rest
secondary axis measured on the rig first (do not guess the sign — see the
project memory's rig-sign lesson).

## STAGE 5 — grip geometry lowered (user chose the "puck rides further ahead" option)
Applied: `gripUp` 1.38 -> **1.05**, `iceBaseFwd` 0.95 -> **1.49** (solved, not
guessed), and the two forced knock-ons `pickupRadius` 1.15 -> **1.69** and
`reachRadius` 1.3 -> **1.84** (both are measured from ent.pos, so without them a
puck resting on your own blade sits outside pickup range). Debug slider maxima
raised to match.

### Measured after (fixed dt, mean of last 30 frames, puck carried)
| | before | after | clip authored |
|---|---|---|---|
| top hand y | 1.386 | **1.084** | 0.948 |
| blade tip y (ice = 0.045) | - | **0.059** (1.4 cm high) | - |
| tip miss vs aim | - | **0.020 m** | - |
| puck carry distance | 0.95 | **1.477** | - |
So the primary complaint is fixed: the top hand drops 30 cm, off the shoulder
(1.398) and near the authored range, while the blade still sits on the ice and the
tip still lands on the aim. The compensation formula is validated.

### TWO SIDE EFFECTS, both measured, both need a judgement call
1. **Hand separation got WORSE, not better: 0.376 -> 0.106 m** (hands nearly
   touching). The clips author 0.61-0.77 and the game's own target is only
   `stickLen*botFrac` ~= 0.348, so the left arm is failing to reach its target
   even before my change — this is the pre-existing defect documented in the
   07-26 note (the binding constraint is this rig's **0.48 m shoulder->wrist
   reach**, which is why botFracMin/Max changes did nothing). Lowering the anchor
   made the shaft more horizontal and pushed the bottom-hand target further from
   the left shoulder, so it degraded. It is monotonic in gripUp (1.38 -> 0.376,
   1.05 -> 0.106), so **gripUp ~1.20 would recover roughly half the separation
   at the cost of ~15 cm of hand height**. Genuinely fixing it means longer arm
   bones on the rig, which is out of scope here.
2. **The blade is only exactly on the ice at ONE distance** — inherent to the
   model (`tip = butt + dir*stickLen`, a fixed 1.39 from the anchor toward an aim
   that lies on the ice), not something this change introduced. That sweet spot
   has MOVED from ~0.93 to 1.49, so the "blade under the ice" zone is now aims
   CLOSER than 1.49 (measured: aim 1.10 -> tip 10.5 cm below ice; aim 1.90 ->
   20 cm above). Previously the sweet spot sat near the low end of the envelope,
   so more of the reach range had the blade above the ice rather than through it.
   Worth a look on screen; if it reads badly, the fix is a tip-to-ice clamp, not
   a grip retune.

## NOT DONE — carried over
**`brake_soft` still spins: 22/120 frames over 45 deg, spine_03 stepping 149.2
deg (mean 10.7 vs 1.5-2.6 in every other state).** spine_03 is NOT IK-driven, so
this is a procedural brake-pose bug and is independent of everything above — most
likely `brakeYawCur`/`brakeSide` or the soft-stop blend snapping on the first
brake frame. Untouched this session. Reproduce with the mkpose.py harness,
`brake_soft` phase (note that phase holds W and Space together — clear keys[w]
first if you want Space alone).

## 2026-08-01 — ARCHITECTURE PASS (session 49ef04a1). Backup `ice_hockey.html.bak_pre_animarch`

### THE ROOT CAUSE OF "THE UPPER BODY SPINS" — found and fixed
three.js r128 `PropertyMixer.apply()` ends with
`for(let t=e,r=e+e;t!==r;++t) if(n[t]!==n[t+e]){ a.setValue(n,i); break }` —
it **skips writing a bone whose accumulated value is unchanged from last frame**.
`build_payload.py` collapsed 390 never-moving channels to single keyframes, so
every one of those bones silently stops being driven after frame 1 while
`applyJointFlex`'s ADDITIVE flexBone keeps writing.

MEASURED on a soft stop: `neck_01` drifting **exactly 6.42 deg/frame**
(= `softStopSpine*0.8`, its only procedural term) for ~90 frames, then
**snapping back 157.3 deg in ONE frame** when the next crossfade finally changed
the accumulated value. That snap is the spin. Not the IK, not the antipode —
those were already fixed and were a different (real) bug.

FIX: `mixerUpdateClean(ent,dt)` brackets the update — restore last frame's clip
pose, run the mixer, re-snapshot. Applied to player + bot + match pool. The
goalie calls `resetPoseJoints` unconditionally and is immune.

| | before | after |
|---|---|---|
| brake_soft frames >45 deg/frame | 2/150 | **0/200** |
| neck_01 max step, brake_soft | 156.7 | **0.9** |
| spine_02 max step | 52.3 | **0.6** |
| brake_hard frames >45 deg | 4/150 | **0/200** |

### "ODD ANIMATION IN NEUTRAL STANCE WITH PUCK" — two causes, both fixed
1. `locoAction` picked the idle clip off `lastLat` (which INCLUDES the cosmetic
   cradle sweep) instead of `stanceLat`, breaking the rule poseStick's own
   header states. The cradle alone swung lastLat **29.0 deg**, across the
   17.2/9.5 deg enter/release band -> **IdleN<->IdleL flipped 13x in 300
   frames**. Now reads stanceLat: **0 switches**, lat range 29.0 -> 10.2 deg.
2. The cradle is at FULL amplitude standing still (it scales DOWN with speed).
   Added `cradleIdleMul:0.3` / `cradleIdleRamp:1.2`. Blade lateral excursion
   0.287 -> 0.104 m. Also `clipOwnsCradle()` kills it entirely once an authored
   stickhandling idle exists.

### ARCHITECTURE (user asked for cleanup, not another patch). Decisions taken:
delete the procedural fallback + J toggle; situational poses stay as named
providers; design the graph open-ended.

**DONE**
- **S2 (legacy procedural skater) DELETED**: `legStridePose`, the stride cycle,
  the weight/hip/shoulder sway, base spine/neck/head lean, ready-stance
  hips/knees/ankles, stanceWiden, hipTurnout, the wrist-shot weight-transfer
  stagger, `swayLat`, `stanceSink`, `setAnimClips`, `eachSkater`, the J key,
  `CONFIG.animClips`, `ent.clipDrive`, 38 CONFIG keys, 28 debug sliders and
  their doc blocks. **-300 lines / -21 KB.** All of it was already inert
  (`LP = clipDrive?0:1`, `strideSuppress` pinned to 1).
- **Anim graph**: declarative `LOWER_STATES` table (14 rows, first match wins,
  hysteretic predicates, rows with a missing clip are skipped so the table can
  name clips that do not exist yet), `lowerCtx`, `lowerState`, rewritten
  `setLoco` (dwell + phase carry-over for cyclic states, rewind for one-shots),
  and `animGraphTick` which **stops** fully-faded actions and asserts that
  nothing but curAction/fadingOut holds weight.
- Clip slots declared for every requested state (startClip/stopClip/turnL/turnR/
  pivotClip + uStickhandle/uPass/uReceive/uSlap/uPoke/uCheck) — all null today.
- Dead `A.pose` and the fake `A.sprint` alias removed.

**BUG I INTRODUCED AND THE HARNESS CAUGHT** — `want.setEffectiveWeight(0)`
before `fadeIn()`. three.js computes effective weight as
`action.weight * fadeInterpolant(t)`, so weight is the fade's TARGET, not its
start; zeroing it pinned every locomotion clip at weight 0 forever. Symptom:
legs stopped animating (15.56 -> 0.02 deg/frame) with **no error anywhere**.
Comment left at the call site. DO NOT "tidy" that 1 to a 0.

**ALSO**: never run blind comma-tidy regexes over this file — `,,`->`,` and
`[,`->`[` destroyed two array-DESTRUCTURING HOLES in the debug panel
(`groups.flatMap(([,,rows])=>rows)`), which parses fine and silently reads the
wrong element. Caught by diffing against the backup.

### VERIFIED (10-state sweep, fixed dt, frame-counted)
No JS errors; zero animGraph assert warnings; exactly ONE action weighted in
steady state (`carry@1.00`) and exactly two summing to 1.00 mid-crossfade
(`idle@0.65,carry@0.35`); leg motion 15.56 deg/f skating vs 0.14 idle (clips
driving); rootY 0.000 idle / -0.120 in a stop.

### NOT DONE — next steps, in order
1. **POSE_PROVIDERS registry + bone-group arbiter.** The situational blocks
   (hockey stop, soft stop, mohawk, crossover, stumble, kneel) are still loose
   additive flexBone blocks in applyJointFlex. They do not currently fight —
   each is gated by its own blend scalar that is 0 unless active — but the rule
   is enforced by convention, not by code. The comment in applyJointFlex says
   exactly this; keep it honest.
2. **UPPER_STATES.** Stickhandling/Pass/Receive/WristShot/Slap/Poke/BodyCheck.
   These must emit a **stick target for the IK**, never bone rotations: the arms
   belong to the IK permanently because `ent.stickTip` is GAMEPLAY state (24
   references — poke hit tests, shot range gates, pickup, shot origin, carry
   spring). Two attempts to give the clips the arms are documented above
   poseStick and aimBone; both measured worse.
3. **11 of the 15 requested states have no clip.** Present: IdleN/L/R,
   WalkForward, WalkBackward, WalkForwardWithPuck, Shooting. Missing: Start,
   Turn L/R, Stop, Pivot, Stickhandling, Pass, Receive, Slap, Poke, BodyCheck.

### WATCH (pre-existing, NOT introduced by this pass)
`backskate` shows 2/150 frames >45 deg, worst `lowerarm_l` 62.5 deg — identical
before and after the graph rewrite. Arm IK handover, same family as the
documented `freeArmBlendRate` flick.

**~/Lataukset ONLY. NOT deployed. NOT user-playtested.**
Harness: scratchpad `mkpose.py` + `harness.js` + `run.sh` (isolated port+profile
per run). Never `pkill -f` a pattern that appears in your own command — exit 144.

---

## 2026-08-01 — THE PUCK CRADLE IS GONE

User report after the architecture pass: "there is still old procedural
animations taking place.. such as idle stickhandling." Correct, and it was not
an S2 remnant — it was a separate system the S2 deletion never touched.

**What it was.** `updateAutoStick` carried two motions. (1) the stride sway,
still there. (2) the CRADLE — a figure-eight on `cradleSide/cradleFwd/cradleHz`
that ran whenever the player carried the puck, damped to `cradleIdleMul` at a
standstill. Standing still it was the ONLY thing moving the blade, and both
arms, the spine twist and the head look-at all IK onto the blade, so it read as
the whole upper body working a puck procedurally.

**Why the stand-down gate never fired.** `clipOwnsCradle(ent)` was written to
switch the cradle off as soon as an authored stickhandling idle took over. It
returns true only if `A.carryIdle` resolved, i.e. only if ANIM_B64 contains one
of `IdleCarry` / `IdleStickhandle` / `IdleNWithPuck` / `IdleWithPuck`. Decoding
the payload, it ships exactly eight clips:

    Idle, IdleL, IdleN, IdleR, Shooting, WalkBackward, WalkForward,
    WalkForwardWithPuck

None handles a puck at a standstill. So the gate was structurally dead and the
cradle ran unconditionally. The same null clips also make the `idle_puck`,
`idle_puck_l` and `idle_puck_r` rows of LOWER_STATES unreachable (`lowerState`
skips rows whose clip is absent), so a skater standing with the puck plays the
plain no-puck `IdleN` in the legs while the arms cradle. That mismatch is what
was visible.

**Cut, not damped** (user's call). Removed: the cradle block in
`updateAutoStick`, `clipOwnsCradle` itself (that block was its only caller), the
six `cradle*` CONFIG fields, and their six sliders in the debug panel — leaving
the sliders would have left six controls silently driving nothing, the exact
dead-UI-slider bug class already logged on Flag Raid. Stale comments in
`attachSkaterClips`, `lowerCtx` and `poseStick`'s stanceLat header updated;
`stanceLat` STAYS, the stride sway still contaminates `lastLat` and an authored
clip will move the blade harder still.

Saved tuning in localStorage is unaffected: `applyVals` iterates KEYS derived
from the slider defs, so a stored `cradleSide` is now simply ignored — no zombie
CONFIG value comes back.

**Verified**, `ice_hockey.html.bak_pre_cradlecut` vs. the new file, same probe,
same headless run (player standing, `puck.possessed` forced true, 78 sampled
frames):

| | before | after |
|---|---|---|
| `autoSway.z` | 0.03450 | **0.00900** |
| `CONFIG.cradle*` | `{side:0.2, idleMul:0.3}` | `{}` |
| `updateAutoStick` calls | 89 | 89 |
| JS errors | none | none |

0.00900 is exactly the stride term alone (`stickFwd 0.06 x strideAmp 0.15`); the
cradle's 0.0255 m contribution is gone, blade tip moved 2 mm. `node --check` on
all three script blocks passes.

CAVEAT on that measurement: headless runs at ~0.5 fps and the stride/cradle
phases barely advance, so this proves the cradle's AMPLITUDE is gone, not that
its oscillation over time stopped. The oscillation follows from the deletion.

**Consequence, deliberate:** the blade is now STILL while carrying the puck at
idle. That is the honest state of the rig — puck handling belongs to a clip
that does not exist yet. Do not put a procedural sweep back in
`updateAutoStick`. The two legitimate homes are an authored `IdleCarry` clip
(the `idle_puck*` rows and the `A.carryIdle` lookup are already waiting for it,
zero code changes needed) or UPPER_STATES, which emits a stick TARGET for the IK
rather than bone rotations.

This makes the missing-clip list the top priority, ahead of the POSE_PROVIDERS
arbiter: the graph is now honest but visibly incomplete.

**~/Lataukset ONLY. NOT deployed. NOT user-playtested.**

---

# 2026-08-04 — NEW ANIMATION PACK (9 clips) BAKED IN

Source: `~/Lataukset/hasa1992 - 3D Low Poly with Rig.rar` (RAR5 — 7z cannot
decompress it, use `unar`). Two blends inside; the FK one
(`hasa1992 - 3D Low Poly with Rig.blend`, 63-bone `metarig`, all actions densely
baked) is the one to export. The IK blend's `1*`/`2*` actions are sparse
constraint-driven curves and its `FK*` set is the same motion re-baked onto a
73-bone rig — do not use it, the extra bones do not exist in `PLAYER_B64`.

**9 new clips**, all previously missing from the payload:
`Acceleration, GlideForward, SlapShot, Stop, StopHockey, TurnPunchL/R,
TurnTightL/R`. (The blend's `1*` actions are the 8 already shipped.)

## The rig is unchanged — measured, not assumed
Re-exported an EXISTING clip from the new blend and diffed it against the
shipped payload channel by channel:

| bone group | max angular difference |
|---|---|
| all 17 non-arm bones | **0.048 deg** |
| the 6 arm bones | 57-139 deg |

Rest pose, hierarchy and the 0.90137 `metarig` scale are bit-identical. The arm
gap is the 2026-08-01 GRIP BAKE, which lives only in the payload — those 6
tracks also carry 101 keys where every other bone has 81. So the new clips drop
into the same space, and the existing 8 had to be preserved rather than
re-exported. They were: the merge appends only the 9 new animations, and
`write_anim.py` only rewrites clips present in `tracks.pkl`. IdleN/Shooting
still verify at 0.001/0.150 deg, exactly their pre-existing values.

## The new pack does NOT hold a stick either
Same measurement as 2026-08-01, run against the raw export, with raw `1IdleN`
as a known-bad control:

    clip            hand sep    R-axis off shaft
    1IdleN (control)  0.645 m        41.7 deg
    2Stop             0.645 m        41.7 deg     <- identical to control
    2TurnTightL       0.645 m        41.7 deg     <- identical to control
    2SlapShot         0.545 m        61.1 deg

Several clips return the control's numbers to 2 decimal places: their arms were
left in the REST pose, never animated. So all 9 needed the same grip bake. After
it, average off-shaft is 0.0-1.4 deg (was 41-61) with the blade at 0.018-0.033 m.

**bake4's smoothing window had to become per-clip.** The 5-frame box filter
makes the solved shaft LAG the body through a fast reversal, and the lag is what
pushes the wrist out of reach — not the hand spacing (widening `SP_MIN/SP_MAX`
to 0.20/0.50 changed nothing except pushing the turn clips onto the new bound).
`SMOOTH_W={'SlapShot':1,'StopHockey':1}`, 3 elsewhere: SlapShot went from 7
unreachable frames to 0, Acceleration to a perfect solve.

RESIDUAL, known: `StopHockey` still has ~5 frames of 48 above 5 deg (worst 41
deg at one frame), `SlapShot` and `TurnPunchL` one blip each. Everything else is
under 2.6 deg. The bake also pins the blade to the ice on EVERY frame, so the
slap-shot windup is a low sweep rather than an overhead backswing — the same
compromise the shipped `Shooting` clip already makes.

## Format notes for the next pack
* Payload convention is **24 fps**; the blend's scene is 30. The export is
  retimed by 1.25 so the new clips do not run 25% faster than the old ones —
  the graph's `clipFade`/`clipDwell` are tuned against the 24 fps durations.
* One channel set per clip: rotation on all 63 bones + translation on `root`
  only. No scale, no per-bone translation. Constant channels collapse to one key
  (`mixerUpdateClean` exists to cope with that).
* Node names are the game's RUNTIME names: strip dots (GLTFLoader sanitization)
  THEN `remapBoneNames`. Renaming bones in Blender instead still bakes flat.
* **Trap that cost a rebuild:** the accessor helper takes `count` from
  `len(arr)`, so a FLATTENED (n*4,) quaternion array claims 4x its own data.
  Reads then land in the next accessor's bytes and only the last one in the
  buffer is short enough to raise. Pass the 2D (n,4) array.

## Wiring
Five LOWER_STATES rows had been dead since they were written — their clips were
null, so `lowerState` skipped them and the graph collapsed to
idle/walk/carry/back. `stop`, `start`, `turn_l` and `turn_r` now run for the
first time. Added: `stop_hockey` (splits `brakeBlend` from `stopSoftBlend`),
`turn_punch_l/r` (a second, harder turn tier above `clipTurnPunch`) and `glide`.
`ctx.accel` is now an EMA — the raw per-frame delta is mostly noise at 60 fps and
the glide row strobed on it. `A.uSlap` finally resolves and `fireShot` picks it
for `type==='slap'`; it was assigned-but-never-read before.

Still null: `pivotClip`, `carryIdle*`, and the rest of the `A.u*` slots —
`UPPER_STATES` is referenced in three comments but **has never existed as a
table**.

## Verified
Headless Chrome, real GL (swiftshader), three.js vendored locally:
* 17 clips parse; **1088/1088 tracks bind** to real bones, 0 unbound.
* 12/12 lower-state cases select the intended row and clip.
* 60 mixer updates on GlideForward: 0 non-finite quaternions across 63 bones.
* Rendered stills for GlideForward / StopHockey / TurnTightL / Acceleration /
  SlapShot — poses sane, no exploded rig.

NOT playtested by a human. Deployed 2026-08-04.

---

# 2026-08-04 (later) — "the hand comes off the stick on StopHockey"

Reported against the build shipped earlier today. Fixed; **StopHockey worst-case
went 40.9 deg -> 9.6 deg and its mean 0.924 -> 0.126 deg**, and 7 of the 9 new
clips are now clean outright.

## The per-key error was measuring nothing
`bake4`'s error is computed at the frames it solved, where the grip was
CONSTRUCTED — so it read 0.0001 mm through every one of the defects below. All
four were invisible until the FINAL PAYLOAD was resampled between keys. This is
the tautological-verification trap again, in a new place: verify the shipped
artefact by sampling it, not the solver by asking the solver.

## Four independent causes, all reading as "hand off the stick"
1. **Arm fold limit.** `ik_arm` clamps shoulder->wrist to a minimum of
   `|lu-lf|` = 31.2 mm — an arm cannot fold tighter. `bake3` constrained max
   reach but not min, and parked the wrist **17.3 mm** from the shoulder. The
   clamped triangle no longer has `|wrist-elbow| == lf`, so the forearm
   overshot by exactly the 16.4 mm seen as off-shaft error. Added `MINREACH`.
2. **TurnPunchL/R are not loops.** Measured end to end: spine 15.7 deg, thigh
   72.3 deg apart. `bake4` was closing their loop anyway, pinning the arms to
   frame 0 while the body ended elsewhere — 15.1 deg AT a key. Only
   GlideForward and TurnTightL/R actually loop.
3. **Hand roll flip.** Roll about the shaft is free — it leaves the grip valid,
   so it costs nothing at a key. Measured **168.6 deg of roll between adjacent
   8 ms keys** while the shoulder moved 7.9 deg. Now carried frame to frame.
   It moves the wrist by up to 2*|GRIP_CTR|, so bake3 and bake4 had to share the
   reference; giving it to bake4 alone produced 19 unreachable frames.
4. **Elbow pole snap — my own first fix caused this one.** Guarding on
   CONDITIONING alone leaves a cliff: the authored elbow can sit 90+ deg from
   the held pole while perfectly well conditioned (sin 0.98), and the guard then
   snaps to it the moment it crosses the hold test — **150 deg of upper arm in
   one 8 ms key, with the hand's world orientation smooth to 0.14 deg**. Fixed
   with a slew limit (`POLE_SLEW_DPS=360`). Swept: 180 and 90 deg/s are both
   worse overall (SlapShot degrades), so 360 is not arbitrary.

Solve density also went 30 -> 60 Hz (120 for the three fastest clips).

## Where it stands
    clip            mean     worst   % of clip >2 deg
    Acceleration   0.059     0.351      0.00%
    GlideForward   0.012     1.505      0.00%
    Stop           0.012     0.133      0.00%
    StopHockey     0.126     9.616      1.55%   (16.1 ms)
    SlapShot       0.174     7.518      1.70%   (19.8 ms)
    TurnPunchL     0.012     0.171      0.00%
    TurnPunchR     0.070     1.574      0.00%
    TurnTightL     0.009     0.051      0.00%
    TurnTightR     0.004     0.020      0.00%
    (Shooting, shipped since 08-01, for scale: 0.178 / 1.315 / 0.00%)

**KNOWN REMAINING:** SlapShot and StopHockey each keep one ~16-20 ms window —
roughly a single frame at 60 fps. Cause is identified and is NOT the IK: the
bake3 SOLVE jumps shaft branch between adjacent frames (`psi` 1.196 -> 1.530 in
8 ms, blade height 1.194 -> 1.146). Fixing it needs a continuity term in the
solver's objective, which has not been written.

Re-verified headless: 1088/1088 tracks bind, 0 non-finite quaternions, 12/12
lower-state cases. Still not playtested by a human.

---

# 2026-08-04 (third pass) — solver branch jump fixed; all 9 clips clean

Two more causes on top of the four above. Both had to be fixed BEFORE key
density could help — subdividing a true discontinuity only samples it finer.

5. **Solver branch jump.** The objective has several basins (the shaft reaches
   the same authored hands from more than one azimuth) and nothing tied a frame
   to its predecessor. Worse: when the warm start FAILED, the old code fell back
   to a cold 6-way `psi` sweep — it discarded continuity exactly when it
   mattered. Measured on SlapShot: **the grip moved 0.203 m in 8.3 ms (24 m/s)
   and `psi` swung 19.1 deg**, against p99 figures of 0.038 m and 3.5 deg.
   Fix: `TRUST_RATE` bounds the per-frame step (expressed as rates, so it means
   the same at 60/120/240 Hz), relaxed in stages if infeasible, with the cold
   sweep demoted to a last resort.

6. **Wrist jammed into the shoulder.** `ik_arm` divides by the shoulder->wrist
   distance, so the pure fold limit `|lu-lf|` is not a tight enough floor. At
   10% of full reach that axis is ill-conditioned: measured with the shaft
   perfectly smooth (0.025 m/frame, psi < 1.7 deg) the right arm still flipped
   **66-80 deg in one 4 ms key**. A quarter of all frames wanted to sit there,
   because the objective pulls the top grip toward an authored hand that is in
   the REST pose and carries no information. `MINREACH` is now
   `max(fold limit, 0.28*reach)` — a normal folded elbow, numerically stable.

Then the fast clips went to 240 Hz, which NOW converges:

    clip           worst deg (08-04 am -> pass2 -> now)   % of clip >2 deg
    Acceleration        1.06  ->  0.35  ->  0.021              0.00%
    GlideForward        0.01  ->  1.51  ->  0.010              0.00%
    SlapShot           39.34  ->  7.52  ->  0.406              0.00%
    Stop                0.11  ->  0.13  ->  0.150              0.00%
    StopHockey         40.87  ->  9.62  ->  0.605              0.00%
    TurnPunchL         15.10  ->  0.17  ->  0.001              0.00%
    TurnPunchR          1.58  ->  1.57  ->  0.001              0.00%
    TurnTightL          0.15  ->  0.05  ->  0.000              0.00%
    TurnTightR          9.47  ->  0.02  ->  0.110              0.00%
    (Shooting, shipping since 08-01, for scale: 1.315 deg worst)

**Every new clip is now cleaner than the Shooting clip that has been live for
three days**, and the blade sits at 0.020 m on all nine (SlapShot and TurnPunchL
previously read 0.033/0.030 — that was the bad frames dragging the mean).

Poses re-checked visually after the MINREACH change (it moves the grip away from
the authored hand): StopHockey and SlapShot render unchanged.

Re-verified: 1088/1088 tracks bind, 0 non-finite quaternions, 12/12 lower-state
cases. Payload 903 KB (was 766 KB) for the extra keys. Still not human-playtested.

---

# 2026-08-04 (fourth pass) — the SlapShot clip is now two halves

User report: "the slapshot animation contains both the wind up and release —
break it down; the windup should happen when both buttons are pressed, hold =
the stance stays, and the release only fires when the buttons are released.
Same for pad."

Correct diagnosis, and the "before" state is worse than it sounds: **no slap
animation played during the windup at all.** `fireShot` fired the whole
1.167 s clip as a one-shot at the moment of RELEASE, so the backswing was
animated after the puck had already left the blade — and the held stance was
whatever locomotion clip happened to be running.

## The split
`playHold` / `releaseHold` / `cancelHold` (next to `playOnce`). A paused
three.js action keeps applying its pose at full weight — pause only stops time
advancing — so the frozen frame IS the held stance. No hold pose, no second
clip, and the release continues from where the windup stopped.

    press  ->  play [0 .. slapClipApex] at slapClipApex/slapWindupTime, freeze
    hold   ->  frozen (oneShot=999 keeps setLoco off)
    release->  run on to slapClipEnd, oneShot = what's left, graph resumes
    cancel ->  oneShot=0, setLoco crossfades back next frame

The freeze itself lives in `animGraphTick` (the one place guaranteed to run
right after every `mixer.update`).

## The two constants are measured, not guessed
FK the shipped payload's `hand_l`/`hand_r` through the clip and take the
draw-back metric (hands pulled back and across, `(x-z)` summed over both hands):

    apex        t = 0.208 s   hand_r (0.262, 1.384, 0.011)   <- slapClipApex
    contact     t = 0.523 s   metric bottoms out
    after ~0.55 s: settle only                               -> slapClipEnd 0.72

The tail is deliberately not played; the locomotion graph does a settle better
than a clamped one-shot. Re-measure both with the same FK if SlapShot is ever
rebaked — and note the grip bake pins the blade to the ice on every frame, so
this backswing is a low draw-back sweep, NOT the overhead load `slapBackHeight`
describes.

## Wiring
Windup starts in the shot state machine at the same point that resets the
gesture (press / slap-upgrade). Release goes through `fireShot`, which now
tests **the held action, not the shot type** — so a slap windup turned into a
slap PASS (`eaSlapPass`) releases the same swing instead of cutting to the
wrist clip. `cancelHold` on all five cancel paths: reticle-in-circle fake,
pad RS-to-center fake, pad layer/mod flip, R3 fake shot, defense-mode toggle.

Pad needed no separate path and got none: every scheme synthesizes `lmbHeld`/
`rmbHeld` into this one machine (`PAD.eaShot==='slap'` holds both true while
the RS is down; Circle/B does the same on classic/all-star), which is exactly
what the probe injects.

## Verified — headless Chrome, real GL (swiftshader), three.js vendored
Probe drives the real inputs and samples the real action. Both builds through
the same probe, because the criterion is that something now HAPPENS:

    measurement          pre-fix build        this build
    during hold: curAction is SlapShot   no          YES
    during hold: clip time               0.0000      0.2080  (= slapClipApex)
    during hold: paused                  n/a         true
    thigh_l drift while frozen           n/a         0.0000 deg
    oneShot at release (clip left)       0.995       0.512   (= 0.72 - 0.208)
    clip advances after release          n/a         +0.0500 in 1 frame @ ts 1
    charge at freeze                     -           0.464 s (slapWindupTime .45)
    puck speed on release                29.87       29.87   (unchanged)

The charge topping out as the pose reaches the apex is the `slapClipApex/
slapWindupTime` rate doing its job. Headless runs ~5 fps under swiftshader —
read the frame counters in the probe, not wall-clock, before believing a "it
didn't move" result.

**KNOWN COST, stated in the code:** a held windup owns the WHOLE body — one
`curAction` per skater, and the clips drive all 64 bones — so the legs stop
striding while the button is down. The fix is the additive upper-body layer
(`UPPER_STATES`, still never written), not a tweak to this.

NOT human-playtested. Not deployed.

---

# 2026-08-04 — NAMED CLUBS (Cock-Cola Heroes) + DEVA #88

`IH_CLUBS` turns "a team" from two letters and a hue into a named identity a
side can wear: a fixed three-zone kit (navy `#111f45` / red `#c8102e` / white
`#f2f5fa`, read off the club's kit sheet) and an optional named roster handed
to that side's AI skaters in order. Either side can wear any club — that IS the
"play as or against them" feature; the picker is a row per side in the start
menu lobby. A side left GENERIC behaves exactly as before.

* `ihSetTeamIdentity` drops everything derived from the old identity EXCEPT the
  eight shared non-jersey piece materials, which are recolored **in place** —
  every skater already on that side holds those exact material instances, so
  swapping them would leave people in the old pants and gloves.
* The re-tint skip test is now a KEY (`team|identity|rosterSpot`), not the team
  letter: the same letter can be wearing a different club than last game, and
  pool bodies are recycled between sides.
* `ihDrawNumberToCanvas` takes an optional name and draws the same nameplate
  the human player's jersey uses (same `IH_NAME_RECT`), so DEVA reads as a real
  jersey rather than an anonymous number.
* A roster spot may carry `ovr`, which `botShootG` uses instead of the menu's
  BOT OVERALL for that skater alone (DEVA shoots like a 99 whatever the slider
  says). Always written, never left over on a recycled pool body.
* Humans on a club side wear the kit but keep their own Locker Room name and
  number — you can play FOR the club without being one of its listed players.

Verified in the same headless run: scoreboard reads `TEAM A 0 — 0 HEROES`,
team B's bots come out `DEVA#88` + one anonymous teammate in the same kit,
`skillMul` 0.99, jersey zones exactly `#111f45,#c8102e,#f2f5fa`, nameplate
present. The club CREST from the reference art is not embedded — colors only.

## 2026-08-04 (later) — the crest on the jersey

`IH_CREST_COCKCOLA` — the shield cut off its reference render (gray plate and
red outer glow gone; alpha is the shield silhouette, grown 33 px out from the
navy body to cover the crisp red border, 2 px feather), 384x359, quantized to
96 colours = 21 KB. `IH_CREST_RECT={x:810,y:1112,w:272,h:196}`.

**The rect is measured off the rig, not eyeballed.** Rasterize Cube001's
front-facing chest triangles into the 2048 atlas to get the front torso island;
every vertex at x=0 in that band maps to **u=946 px exactly**, and that is the
chest centreline the rect is centred on — 60 px of margin to the island edge at
its narrowest row, verified 100 % inside (a decal that runs off the island
lands on some other body part).

**The aspect is deliberately wrong.** The island is anisotropic: 1177 px/m
across the chest, 911 px/m down it (both measured from the same vertices), so a
square drawn here renders 1.29x too tall. 272x196 texture px = 23.1 x 21.5 cm
on the body, i.e. the crest's true 1.07 proportion once the stretch is undone.

**Handedness checked, not assumed.** du/dx is +1177 px/m on the front island and
-1129 on the back. The back is where the (correctly readable) nameplate lives,
which fixes the convention: canvas +u = viewer's right. A viewer in front has
their right at world +x, so the front island needs a POSITIVE du/dx — it has
one, and the crest is therefore drawn unmirrored. The render confirms it.

Drawn by `ihDrawCrest` from both jersey paths: bots/goalies via
`ihDrawNumberToCanvas`, P1 via `ihRedrawNameNumber`. P1 wears the crest of
whichever club their side plays for but **keeps their own Locker Room colours**
— the loadout is personal. `ihRefreshPlayerJersey()` re-stamps it when the menu
changes clubs. The `Image` decodes once per session; a canvas that wants the
crest before it is ready registers a redraw and gets it on load (otherwise the
jersey stays blank until something unrelated redraws it).

**Verified by rendering, not by asserting.** The probe puts the game camera on
DEVA's chest, renders and reads back the pixels in ONE synchronous block (the
game's own tick owns the camera otherwise) and POSTs the PNG to the test
server. Front: crest centred on the chest, upright, unmirrored. Back: DEVA / 88
untouched. Same for P1 with side A set to the club.

Re-measure ALL of the above if the model or its UVs are ever rebaked.

---

# 2026-08-04 (fifth pass) — "the arms are way too close to the body"

User report, with a diagnosis attached: "the arms might be a bit too short in
the model... can you edit the mesh and skeleton to make the arms somewhat
longer and then correct the stick and animations if needed".

**The diagnosis is right, and it is not marginal.** Model is 1.796 m:

    segment          model              real (x stature)   short by
    upper arm        0.2249 (0.125 H)   0.334 (0.186 H)    33 %
    forearm          0.1904 (0.106 H)   0.262 (0.146 H)    27 %
    shoulder->wrist  0.4154             0.5963             0.18 m

Two independent, table-free confirmations (the anthropometric table is a weak
ruler for a stylized rig — see the pose-normalization note in the project
memory): arms hanging down, this rig's FINGERTIPS stop at y=0.97, ABOVE the hip
joint at 0.938, where a real arm reaches mid-thigh; and arm span / height is
0.884 against 1.00-1.05 for a real athlete. x1.30 puts the span at 1.021, which
is how the factor was chosen rather than by eye.

**NOT SHIPPED. The working copy was reverted to the deployed build.** Tools,
renders and the full write-up are in `tools/armlen/`.

## What is finished and verified
* Skeleton + skin: `tools/armlen/armlen_model.py` scales the elbow/wrist local
  translations, moves every vertex by the skin-weighted bone delta and rebuilds
  `inverseBindMatrices` — a real re-bind, not a bone nudge with the mesh left
  behind. Verified: forearm mesh translated AND lengthened (0.159 -> 0.200 m),
  legs and stature bit-identical, UVs untouched so the Locker Room paint/decal
  pipeline is unaffected.
* Clip re-solve: `armlen_anim.py` rewrites the 6 arm rotation tracks across all
  17 clips with minimal-arc deltas off the authored rotations (preserves roll
  and continuity). Sampled at 240 Hz from the WRITTEN payload, between the keys:
  wrists pinned to 0.9 mm / 0.31 deg over 13 130 samples; in shaft-slide mode
  the top grip slides exactly 0.1200 m along the shaft line and 0.2 mm off it,
  line direction 0.06 deg mean; blade within 3 mm of its authored spot once
  `snapAlong` takes the matching +0.12.

## Why it still cannot ship — three findings
1. **The authored arms are 98.8 % extended** (d/L = 0.41/0.415) with the wrists
   almost directly under the shoulders. The animator had to straighten them to
   reach the stick at all — that IS the short-arm symptom. Lengthening with the
   wrists pinned forces the entire extra 0.125 m into elbow flare (0.035 ->
   0.171 m) and it comes out sideways at shoulder height: a chicken wing.
2. **The elbow pole has to use WORLD down, not chest down.** A skater leans
   40-50 deg, so the chest's own -Y points FORWARD in world and an elbow poled
   along it lands in front of the ribs. Real fix, real improvement, does not
   solve (1): with the wrist under the shoulder the shoulder-wrist axis is
   near-vertical, so the flare is horizontal whatever the pole says.
3. **Sliding the hands along the shaft is free but insufficient.** It is
   provably side-effect-free (numbers above) because `dir` comes from
   (bottom grip - top grip) and the anchor slide is cancelled by `snapAlong` —
   but the shaft is steep, so sliding moves the hand DOWN rather than away from
   the chest.

The fix therefore needs the hands well away from the torso, and **the hands ARE
the stick**: poseStick takes the shaft direction from the two grips and anchors
the stick at the top one. Moving them freely lifts the blade off the ice and
moves `ent.stickTip`, which is gameplay state. So the arms have to be solved TO
a target stick pose per frame — bake3/bake4 with a continuity objective. That
is a project, not a parameter.

**Good news for whoever picks it up:** solving arms to a GIVEN shaft is far
better conditioned than the original bake, because the shaft becomes an input
instead of an unknown with several basins. Everything in `tools/armlen/` is
reusable; only the target-choosing step is missing.

## 2026-08-04 (fifth pass, continued) — the re-bake works

User picked option 2: solve the arms TO the shaft. Done, and the stance is
fixed. `armlen_anim.py` now chooses a target shaft = the authored shaft
translated rigidly by 0.13 m along the skater's own horizontal forward, and
solves both arms to it. Identical vector for both grips => shaft direction
untouched; horizontal => blade keeps its height, so `snapAlong` stays 0.06.
`armlen_feas.py` picked 0.13 from the payload itself (tightest frame,
SlapShot/left at t=0.1, allows 0.161).

Three things had to be right, all of them already on this rig's record:
1. `v0`, the reference for the minimal-arc forearm rotation, must be the
   AUTHORED forearm direction, not the moved one — 9 deg of shaft error.
2. The two arms do NOT pose the same. Per `reference/nhl25/.../idle_neutral`,
   the TOP hand's elbow rides UP AND BACK, the BOTTOM arm hangs DOWN and out.
   One symmetric pole = both elbows sideways at shoulder height = the wing.
3. Pole slew limit (`POLE_SLEW_DPS=360`, the grip bake's own number): per-hand
   poles let the elbow flip between keys, invisible AT the keys (0.08 deg) and
   33.8 deg BETWEEN them.

Verified on the written payload between keys: shaft direction 0.042 deg mean /
1.02 max, both grips move by the same vector to 0.34 mm, push vertical
component 0.10 mm, magnitude 0.1300 m, hand orientation 0.021 deg, blade at
0.0190 m in game (authored 0.0197). Slapshot hold/release and the club/DEVA
work unchanged in the same run.

**Gameplay:** `ent.stickTip` is 0.13 m further out along the facing — the point
of the change, but it is the reach envelope (pickup, poke, carry spring) and
nothing was retuned for it.

IN THE WORKING COPY, NOT DEPLOYED — awaiting a human look.

## 2026-08-04 — USER VERDICT ON THE RE-BAKE: REJECTED

Played locally. "The player looks even more dismorphed than before, slapshot
wind up is also incorrect." **The re-baked clips are reverted.** Do not re-run
that solve expecting a different result — the numbers were clean (shaft rigid to
0.04 deg, blade within 3 mm, wrists exact) and it still read worse in motion
than the authored clips do. The metrics were measuring the constraint, not the
look.

### Where the working copy actually stands
* `PLAYER_B64` = the x1.30 arms (skeleton + re-bound skin). KEPT — the user
  wants to see the long arms with NO animation correction.
* `ANIM_B64` = the AUTHORED clips, byte-for-byte the shipped ones. Restored.
* `CONFIG.snapAlong` = 0.06, untouched.
* `customizer/ice-hockey-customize-data.js` `PLAYER_B64` = the same long-arm
  model, so the Locker Room and the menu player match the game.
* Slapshot hold/release re-verified on this exact combination: freezes at
  0.2080, 0.0000 deg stance drift, fires at 29.87 m/s. Club + DEVA #88 fine.

### THE ONE OPEN ARTIFACT
`ent.stickTip.y = -0.101` on the idle — the blade sits 10.1 cm UNDER the ice.
Cause is not a bug: the clips rotate the arms, the longer bones carry the hands
further along those same directions, and poseStick builds the stick FROM the
hands, so it follows them down.

Physical reading, and the proposed fix: a longer-armed player holding the SAME
stick in the same grip pose drives the blade deeper, so shorten the effective
stick rather than correct the arms. One constant, no re-solve:
`snapAlong` 0.06 -> ~0.18 (shifts the whole stick back up its own axis), or trim
`stickLen`. **Not applied yet.** -0.101 was measured on the idle only; the depth
is pose-dependent, so sample it across all 17 clips and pick a value that keeps
the blade planted without floating it in the crouched poses.

NOT DEPLOYED. Live is still 55ae7c4 (slapshot split + Cock-Cola Heroes + crest,
original short arms).
