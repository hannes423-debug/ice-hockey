GRIP BAKE — how ANIM_B64 in game/ice_hockey.html was produced (2026-08-01)
==========================================================================
The animation pack as delivered does NOT hold a stick: measured on the original
payload, the left hand sat 0.40-0.67 m off any shaft through the right hand, and
in IdleN the two hands were on opposite sides of the body at equal height (arms
at the sides). The animator DID curl the fingers around a 0.020 m cylinder --
they just never placed the arms on one.

These scripts solve, per clip per frame, the shaft that puts the blade on the
ice with both wrists in reach while staying as close as possible to the authored
hand positions, then re-solve both arms onto it and write the result back into
the 6 arm/hand rotation tracks. Everything else in the pack is untouched.

RUN ORDER (from this directory, needs numpy + scipy):
    python3 bake3.py       # solve the grip per frame        -> sol.pkl
    python3 bake4.py       # IK both arms, build tracks      -> tracks.pkl
    python3 write_anim.py  # rewrite the payload             -> anim_new.b64
    python3 verify_new.py  # prove both fists are on one shaft
then paste anim_new.b64 over the ANIM_B64 string literal in game/ice_hockey.html.

fk.py         forward kinematics over PLAYER_B64 + ANIM_B64
grip_axis.py  measures the grip tunnel from the curled fingers (IH_GRIP_CTR_*)
solve.py      feasibility study: is a two-handed grip reachable at all?

TRAPS THAT COST TIME, ALL FIXED IN THESE SCRIPTS
  * three.js GLTFLoader SANITIZES node names at load ('thumb.01.R' -> 'thumb01R').
    The anim payload uses the sanitized form, PLAYER_B64 the dotted one. Match
    them or 44 of 64 tracks silently fail to bind -- including both shoulders.
  * The PLAYER_B64 armature root ('metarig') carries a uniform 0.90137 scale
    that every bone inherits. mat2quat() MUST strip scale, and a hand-LOCAL
    offset becomes scale*R*offset in world.
  * The hand's +Y runs wrist->fingers, so it must point TOWARD the shaft; get
    that sign backwards and the wrist lands 2*|GRIP_CTR| too far out and the IK
    clamps (measured 32-72 mm of hand-off-shaft error).
  * Constrain the reach on the WRIST, not the grip point -- they differ by
    |GRIP_CTR| (~0.15), which is enough to hand the IK an unreachable target.
  * Do NOT verify by measuring the grip points' distance to the shaft: the shaft
    is DEFINED as the line through them, so that check is tautological and
    always returns 0. Measure the FINGER BONES instead (should sit ~one shaft
    radius out), which is what verify_new.py and the in-game probe do.

==========================================================================
ADDING A NEW PACK  (the 2026-08-04 run: 9 clips, RAR -> shipped)
==========================================================================
The scripts above bake the GRIP. These add clips in the first place. The whole
run, in order, from this directory:

    unar '~/Lataukset/<pack>.rar'            # RAR5: 7z CANNOT decompress it
    blender -b '<FK>.blend' -P blend_inspect.py     # list actions, spot the FK rig
    blender -b '<FK>.blend' -P export.py -- new_anim.glb
    python3 measure_new.py    # do the new clips hold a stick? (usually: no)
    python3 merge.py          # append ONLY the new clips  -> anim_merged.b64
    python3 splice.py anim_merged.b64               # into game/ice_hockey.html
    python3 bake3.py && python3 bake4.py            # solve grip, IK the arms
    python3 write_anim.py && python3 splice.py anim_new.b64
    python3 verify_new.py     # both fists on one shaft?

Set CLIPS/CYCLIC in bake3.py and NEW in merge.py to the new clip names ONLY.
write_anim.py rewrites just the clips in tracks.pkl, so everything already in
the payload keeps the grip bake it was shipped with — never re-export the lot.
If a clip needs re-baking, re-splice anim_merged.b64 FIRST: running write_anim
twice over its own output leaves the old accessors orphaned in the buffer.

RIG COMPATIBILITY IS A MEASUREMENT, NOT AN ASSUMPTION. Export an existing clip
from the new blend and diff it against the payload: non-arm bones must agree to
~0.05 deg. The 6 arm bones will differ by 50-140 deg — that is the grip bake,
and it means the shipped clips must be preserved.

MORE TRAPS (on top of the four above)
  * The pack ships an IK blend too. Its rig has 73 bones, 10 of which do not
    exist in PLAYER_B64, and its 1*/2* actions are sparse constraint curves.
    Export the FK blend.
  * Blender scene fps is 30, the payload convention is 24 (merge.py retimes).
    Mixing rates inside one payload makes the new clips 25% faster than the old.
  * add_acc() takes accessor.count from len(arr): pass the 2D (n,4) quaternion
    array, never a flattened one, or every rotation accessor claims 4x its data
    and reads run into the NEXT accessor's bytes. Only the last accessor in the
    buffer is short enough to actually raise — the rest fail silently.
  * bake4's smoothing window is per-clip (SMOOTH_W). A 5-frame box filter makes
    the shaft lag a fast body reversal and that lag, not the hand spacing, is
    what puts the wrist out of reach. Widening SP_MIN/SP_MAX does nothing.
  * The bake pins the blade to the ice on EVERY frame, so an overhead windup
    (slap shot) comes out as a low sweep. Known, and true of Shooting too.

==========================================================================
THE GRIP IS EXACT AT EVERY KEY AND STILL WRONG BETWEEN THEM (2026-08-04)
==========================================================================
bake4's per-key error is a TAUTOLOGY CHECK: the grip is constructed at each
solved key, so it reads 0.0001 mm even when the clip is visibly broken. Every
real defect found in this pack was invisible to it and only showed up when the
FINAL PAYLOAD was resampled BETWEEN keys. Always verify that way.

Four separate causes, all fixed here, all of which read as "the hand comes off
the stick" and none of which the per-key error can see:

 1. ARM FOLD LIMIT. ik_arm clamps shoulder->wrist to a MINIMUM of |lu-lf|
    (31.2 mm on this rig) — a two-bone arm cannot fold tighter. bake3 had a
    max-reach constraint but no min, and parked the wrist 17.3 mm from the
    shoulder; the clamped triangle then has |wrist-elbow| != lf and the forearm
    overshoots by exactly the 16.4 mm that showed up as off-shaft error.
    Fix: MINREACH in bake.py, constrained in bake3 AND in its acceptance test.

 2. MIS-CLASSIFIED LOOPS. bake4 closes a cyclic clip by repeating frame 0's arm
    pose at t=dur. TurnPunchL/R do NOT loop (measured end-to-end: spine 15.7
    deg, thigh 72.3 deg apart), so that pinned the arms to frame 0 while the
    body ended elsewhere — a 15.1 deg error AT a key. Only GlideForward and
    TurnTightL/R actually loop. MEASURE it, do not guess from the name.

 3. HAND ROLL FLIP. The roll about the shaft comes from `away` (the component of
    grip-shoulder perpendicular to the shaft). Rolling the fist around the shaft
    leaves the grip perfectly valid, so a flip is FREE at a key and catastrophic
    between: measured 168.6 deg of roll between adjacent 8 ms keys while the
    shoulder moved 7.9 deg. Fix: carry the previous `away` and never flip.
    NOTE it moves the wrist by up to 2*|GRIP_CTR|, so bake3's reach constraint
    and bake4 MUST use the same reference or the solve is checked against a
    wrist that is never built (measured: 19 unreachable frames, 66 mm).

 4. ELBOW POLE SNAP. The elbow's orbit comes from the authored elbow's
    perpendicular. Guarding only on CONDITIONING is not enough — the authored
    hint can sit 90+ deg from the held pole while perfectly well conditioned,
    and the guard then snaps to it the instant it crosses the hold test (150 deg
    of upper arm in ONE 8 ms key, with the hand's world orientation smooth to
    0.14 deg). Fix: a SLEW LIMIT, POLE_SLEW_DPS. 360 deg/s measured best;
    tightening to 90 made SlapShot worse, so re-sweep if a pack misbehaves.
    The pole only picks which way the elbow points — the grip is exact either
    way — so rate-limiting it costs nothing physical and cannot snap.

 5. SOLVER BRANCH JUMP. The objective has several basins — the shaft can reach
    the same authored hands from more than one azimuth — and nothing tied a
    frame to its predecessor. Worse, when the warm start FAILED the old code
    fell back to a cold 6-way psi sweep, i.e. it threw continuity away exactly
    when it mattered most. Measured on SlapShot: the grip moved 0.203 m in
    8.3 ms (24 m/s) and psi swung 19.1 deg, against p99 figures of 0.038 m and
    3.5 deg. Fix: TRUST_RATE in bake3 bounds the per-frame step (rates, so the
    bound means the same at any sample rate), relaxed in stages if infeasible,
    with the cold sweep demoted to a true last resort.

 6. WRIST JAMMED INTO THE SHOULDER. `ik_arm` divides by the shoulder->wrist
    distance to get its axis, so the pure fold limit of |lu-lf| is not a tight
    enough floor: at 10% of full reach the axis is ill-conditioned and a
    sub-millimetre wrist move swings the whole arm (measured: shaft perfectly
    smooth at 0.025 m/frame and psi < 1.7 deg, right arm still flipping 66-80
    deg in one 4 ms key). A quarter of all frames wanted to sit there, because
    the objective pulls the top grip toward an authored hand that is in the REST
    pose. MINREACH is now max(fold limit, 0.28 * reach) — a normal folded elbow.

ONCE THE CONSTRUCTION IS CONTINUOUS, DENSITY CONVERGES. It could not before:
subdividing a true discontinuity just samples it more finely. With 5 and 6 fixed,
raising the fast clips to 240 Hz took SlapShot 8.7 -> 0.22 deg and TurnPunchR
7.8 -> 0.001. That ordering matters — fix continuity FIRST, then add keys.

RESULT on this pack: all 9 clips worst-case <= 0.61 deg, mean <= 0.03, and 0.00%
of every clip above 2 deg — each of them now cleaner than the Shooting clip that
has been shipping since 08-01 (1.315 deg worst). Blade sits at 0.020 m on every
clip.

ALSO: write_anim.py appends to whatever payload is in the HTML. Re-splice
anim_merged.b64 BEFORE every write_anim run or each pass leaves its predecessor's
accessors orphaned in the buffer — that silently added 136 KB per iteration here.

==========================================================================
THE 2026-08-15 PACK  (stance graph + dekes/spinoramas, 11 clips)
==========================================================================
New scripts, because the old ones bake a DIFFERENT SHAPE of clip and the
shipped payload had to keep working: bakepack3.py (shared setup + the clip
table), bakepack_solve.py, bakepack_tracks.py, mergepack.py, writepack.py,
bakepack_verify.py. bake3.py/bake4.py are preserved as *.shipped.

    unar '~/Lataukset/hasa1992 - 3D Low Poly with Rig(1).rar'
    blender -b '<FK>.blend' -P export.py -- ../new_anim.glb
    python3 grip_axis.py                 # -> gripaxis.npy
    python3 bakepack_solve.py            # -> sol_new.pkl   (~35 min, 14 clips)
    python3 bakepack_tracks.py           # -> tracks_new.pkl
    python3 mergepack.py                 # -> anim_merged.b64  (11 NEW clips)
    python3 splice.py anim_merged.b64
    python3 writepack.py                 # -> anim_new.b64   (14 clips' arms)
    python3 splice.py anim_new.b64
    python3 bakepack_verify.py           # resampled BETWEEN the keys
bakepack_solve.py takes clip names as argv to re-solve a subset into an
existing sol_new.pkl.

WHAT WAS ACTUALLY IN THE RAR, all measured before anything was written:
  * NO STICK ANIMATION. The blend has a 6-bone stick armature with stick
    geometry, but ZERO animation curves on it, no constraint to the player and
    no action touching its bones. (The OLD *IK* blend does animate a `stick`
    bone, but that blend is byte-identical to the 08-04 one and has none of the
    new clips.) The grip still has to be synthesised.
  * 3 OF THE 14 "NEW" CLIPS ARE RENAMES. 0IdleNeutral/0IdleForeHand/
    0IdleBackHand are BYTE-IDENTICAL (maxabs 0.000000) to the shipped IdleN/
    IdleL/IdleR. Importing them would duplicate the clips and throw away their
    grip bake. ForeHand == IdleL, BackHand == IdleR.
  * The rig is unchanged: old vs new blend rest pose and all 17 shared clips
    agree to 0.064 deg. Purely additive.

THE OLD BAKE'S BLADE MODEL IS WRONG FOR THIS PACK
bake3's `dirv` solved the shaft elevation FROM tip.y == ICE, so the blade was
pinned to the ice on every frame, and TIP_FWD/TIP_LAT pulled it to one fixed
spot on the forehand side. Under that model ForeHand and BackHand are the SAME
stance, the windmill's 0.83 m lift is flattened, and the spinorama cannot sweep.
Now: the shaft carries a free elevation (psi, theta), the tip is pulled to a
PER-FRAME target, and `tip.y >= ICE` is a constraint instead of a definition.

THE TARGET COMES FROM THE AUTHORED HANDS (user decision, 08-15). Extend the
line through the two measured grip tunnels out to blade length. The hands are
not on a common shaft — that is what the bake is for — but the LINE carries the
intent, and for this pack it is demonstrably good: ForeHand reads tip y 0.00-
0.02 / lat +0.71, BackHand y 0.00-0.05 / lat -0.34, PulledBack fwd -0.50,
Windmill y 0.00 -> 0.85. It is NOT good on the old pack (IdleN reads y 0.91,
arms at the sides), which is why the old bake used constants.

NEUTRAL HAS NO VALID STICK POSE IN EITHER SOURCE, and this is the one place the
bake invents something: the authored hands put the blade 0.91 m in the air and
the shipped IdleN bake put it 0.56 m up and behind the hip. Neutral is the graph
node BETWEEN ForeHand and BackHand, so its blade is DERIVED as their midpoint
dropped onto the ice (fwd 0.378, lat 0.186) rather than being a magic constant.
ICE is an ABSOLUTE height — applying it to a root-relative offset puts the blade
0.02 m above the PELVIS. See resolve_endpoint.

THE THREE STANCES WERE RE-BAKED IN PLACE (user decision, 08-15) so a transition
solved to the authored path lands on a stance solved the same way. This is a
GRIP re-bake; it is not the arm-lengthening re-bake played and rejected on 08-04.

TWO TRAPS THIS RUN ADDED
 7. RETIME THE SOLVED ARM TRACKS. bake3 sampled the PAYLOAD, already retimed to
    24 fps. bakepack_solve samples the RAW 30 fps export, so its times must be
    multiplied by 30/24 before they are written next to body tracks that already
    were, or the arms run 25 % fast against their own clip's legs.
 8. MEASURE THE THING THE `cyclic` FLAG CONTROLS, not the clip. The spinoramas'
    BODIES loop (end-to-end 0.03 deg, endpoints on the BackHand stance within
    0.05 deg), so every loop test says "cyclic". But `cyclic` means "repeat
    frame 0's ARM pose at t=dur", and the solved arms do NOT come back: the
    shaft sweeps a full turn and the hand roll and elbow pole end elsewhere.
    Every solved key moved <= 3.75 deg and then the appended closure jumped
    hand_l 176 deg in ONE key. Per-key error saw nothing; the between-keys
    verify caught it as a 350 m/s blade jump. They are one-shots — not cyclic.

RESULT (bakepack_verify.py, final payload, resampled 12x between keys):
worst grip-axis error 1.565 deg across all 14 clips and every sample, grip
spacing 0.31-0.44 m throughout, stances' blades on the ice at 0.02, windmills
lifting to 0.83/0.91. THE SHIPPED PAYLOAD MEASURES 52-89 DEG ON THAT SAME
METRIC with grip spacings of 0.48-0.63 m — the old bake is present (its arm
bones differ 138-179 deg from raw while every other bone agrees to 0.00) but it
does not satisfy its own SP_MIN/SP_MAX constraint. The 11 remaining old clips
still carry it and were deliberately not touched.

==========================================================================
THE GRIP WAS NEVER MISSING — IT WAS IN THE IK BLEND (2026-08-16)
==========================================================================
Everything above solves a problem the source did not have. The animator, on
the delivery of 'Hoki animations/':

    "If you want to export from the ik blend file itself, there are 2 versions
     of the animations, one with FK at the start and one without. Ignore the FK
     ones as I only use that to convert into non IK rig thus why it's there."

He is right, and the FK note is the smaller half of it. THE IK RIG HAS A STICK.
`metarig` carries a 73rd bone named `stick`, the 6-bone stick armature is
CHILD_OF it, and -- the whole point -- `handIK.L` and `handIK.R` are CHILD_OF
it too. Both fists therefore ride the authored shaft by construction. The
conversion to the non-IK rig (63 bones, no `stick`, no constraints) is what
threw the shaft away, and every "the pack does not hold a stick" note in this
file is really "the CONVERSION does not hold a stick".

Measured, ik_anim.glb vs the shipped payload (cmp_ik.py): rest poses identical
to 0.000000 m, every non-arm bone agrees to <= 0.038 deg, and the six arm bones
differ by 125-180 deg. That difference is the grip: his on one side, ours on
the other.

    blender -b '<IK>.blend' -P export_ik.py -- ik_anim.glb   # drops FK*, bakes
    blender -b '<IK>.blend' -P stickpose.py                  # who posed a stick?
    python3 cmp_ik.py          # rig compatibility, measured not assumed
    python3 measure_ik.py      # fists vs the animator's OWN stick bone
    python3 merge_ik.py        # -> anim_ik.b64 (+ anim_ik.clips.json)
    python3 splice.py anim_ik.b64
    python3 verify_ik.py

ONLY 9 OF THE 16 AUTHORED CLIPS ARE USABLE, and that is a measurement.
stickpose.py evaluates the stick armature in Blender and reads the blade tip's
world height every frame (ice z~0.0, toe rides at z~0.10):

  posed, blade reaches the ice   IdleL IdleR Shooting WalkForwardWithPuck
                                 SlapShot TurnPunchL/R TurnTightL/R
  `stick` bone NEVER KEYED       IdleN WalkForward WalkBackward Acceleration
                                 GlideForward Stop StopHockey

In those seven the control sits at its rest transform -- horizontal, at chest
height -- and because the fists are CHILD_OF it they ride it up there: tip
0.75-1.24 m off the ice for the entire clip. They are the earliest batch, from
before the stick control existed. They keep the old bake. `IKSET=all` takes
them anyway, for an A/B only.

HOW TO CHECK A GRIP, now that there are two kinds of clip in the payload
 * axR (top fist knuckle line vs the shaft) is NOT a defect metric on authored
   clips. A top hand on the knob is rotated 30-45 deg off the shaft -- anatomy.
   It reads ~0 on baked clips only because bake4 built the shaft along
   GRIP_AX_R, which makes it a tautology there. Read axL, the lower fist.
 * The independent check is measure_ik.py, against the animator's own `stick`
   bone, which nothing in this pipeline touches: grip tunnels 0.02-0.06 m off
   it (one shaft radius), shaft line 2-7 deg off it, hand spacing constant
   within a clip -- which is exactly what CHILD_OF predicts.

WHAT THE AUTHORED GRIP IS, against what the bake assumed
 * hand spacing 0.45-0.65 m. SP_MIN/SP_MAX (0.26-0.44) was invented here and is
   too narrow: a real hockey grip has the lower hand a third of the way down a
   1.5 m stick. The baked clips look cramped next to the authored ones.
 * the top hand is rotated on the knob; the bake rolled it onto the shaft.

STILL BROKEN, AND NOT FIXABLE FROM THIS SOURCE: six of the seven unposed clips
(WalkForward WalkBackward Acceleration GlideForward Stop StopHockey) carry the
ORIGINAL 08-01/08-04 bake, which measures 82-88 deg on the LOWER fist and puts
the blade 0.45-0.55 m above the ice. IdleN is the seventh and is fine (0.01
deg, blade at 0.018) because the 08-15 pass re-baked it. Two ways out, in order
of preference: (a) the animator keys the `stick` control in those six, which
costs us nothing and makes them authored like the rest; (b) re-bake them with
the fixed 08-15 solver against an ice-pinned tip target -- bakepack3's
authored_tip() explicitly does NOT work on this pack (IdleN reads tip y 0.91,
arms at the sides), which is why the old bake used constants.

gripshot.sh / gripshot.js photograph one clip's grip in the real build
(./gripshot.sh <clip> <phase> <handle 0|1>). Pass handle=0: the skill-stick
layer re-aims the shaft by up to 91.7 deg and hides exactly the defect you are
looking for. Do NOT trust its handle=1 numbers -- it calls poseStick a second
time in the same frame, outside mixerUpdateClean, so the procedural arm writes
apply twice and the fists squeeze together.

==========================================================================
LOCKING THE STICK TO THE HAND (2026-08-16, second pass)
==========================================================================
The animator, on the two blends:

    "the IK blend has animations with the stick on but we have to ignore the
     FK animations, those were just for the animator himself. The other blend
     has more animations but the stick isn't included -- the stick can be
     locked in to the top arm, and I believe the animations start from idle
     poses where the stick already is included."

Measured end to end. He is right about the mechanism and right that the poses
carry a stick -- but it is the LOWER fist the shaft is welded to, not the top
one, and the six clips that still carry the 08-01 bake are exactly the ones his
"starts from an idle that already has the stick" does NOT cover.

    blender -b '<nonIK>' -P handrigid.py     is the two-hand grip rigid?
    blender -b '<IK>'    -P knob.py          which fist owns the shaft?
    blender -b '<IK>'    -P gripfit.py       fit the offset + leave-one-out
    blender -b '<nonIK>' -P sticklock.py     carry it onto the 31-clip pack
    blender -b '<nonIK>' -P gripsolve.py     does ANY rigid grip reach the ice?
    blender -b '<nonIK>' -P gripverdict.py   calibrate the fit, then judge

1. THE GRIP IS RIGID, AND IT IS THE LOWER HAND THAT HOLDS IT.
hand.L expressed in hand.R's frame is constant to 0.000 m / 0.04 deg in 18 of
the 30 clips -- a rigid two-hand grip is exactly a constant relative transform.
Going the other way, the whole shaft is constant in hand.L's frame (spread
0.0000 m) including Shooting and SlapShot, while in hand.R's frame the TIP
swings 0.78-0.91 m on those same clips. So hand.L is welded to the shaft and
hand.R is a hinge on the knob. Lock to hand.L; locking to the top hand throws
away the one frame the stick is actually rigid in.

2. THE OFFSET IS RECOVERABLE TO 11 mm, AND THAT IS A LEAVE-ONE-OUT NUMBER.
Expressed as two POINTS (butt, tip) in hand.L's local frame, per grip:
    neutral    butt [ 0.0104  0.1417 -0.7067]  tip [ 0.1551 -0.0342  0.8709]
    forehand   butt [ 0.0619  0.1410 -0.6117]  tip [ 0.0785 -0.0518  0.9704]
    backhand   butt [ 0.0233  0.1332 -0.6125]  tip [ 0.1552  0.0289  0.9726]
    with puck  butt [-0.0240  0.1198 -0.5393]  tip [ 0.2967  0.0859  1.0217]
shaft length 1.594 m. TurnTightL, TurnTightR and TurnPunchR share the neutral
grip and rebuild each other's stick to 0.000-0.011 m and 0.03 deg. TurnPunchL
is the one clip whose lower hand SLIDES (spacing 0.519-0.640, rigidL 0.121), so
it rebuilds to 0.216 m -- a real slide, not fit error.

Points, never a decomposed matrix. hand.L and hand.R are mirrored on this rig
(their rest rows differ only in sign) and the stick armature does not carry
metarig's 0.901369 world scale, so to_quaternion() on HL^-1 @ S comes back
exactly 180 deg out. That cost a full measurement pass.

3. IT TRANSPLANTS, AND THAT IS WHAT UNLOCKS THE 08-15 STANCE PACK.
Carried onto the non-IK pack, the offset reproduces the IK blend's own blade
heights on every clip that exists in both files (IdleL 0.063, IdleR 0.016,
WalkForwardWithPuck 0.042, TurnTightL 0.039, TurnTightR 0.026 -- identical).
The 12 stance-pack clips have no authored-grip version to take, because the IK
blend is dated Aug 4 and stops at 17 actions. They do not need one: their hands
already hold the stick, so the offset alone gives them an authored grip.
    on the ice   0IdleForeHand 0.063  0IdleBackHand 0.016  PulledBack 0.081
                 ForeHand<->BackHand transitions 0.024-0.140
                 SpinoramaL/R 0.007  WindmillDekeL/R 0.017 (lifting to 0.97,
                 which is the deke and is correct)
    NOT on ice   0IdleNeutral and 1IdleN, 1.039-1.064 m up, plus the four
                 transitions that touch Neutral at their neutral end.
That is the same finding as before by a new route: NEUTRAL HAS NO VALID STICK
POSE IN EITHER SOURCE. It is a stickless arms-at-the-sides pose.

4. THE SIX BROKEN CLIPS ARE STILL BROKEN, AND NOW IT IS THE ARMS.
WalkForward WalkBackward Acceleration GlideForward Stop StopHockey hold their
fists at 0.640 m -- the SAME spacing as the neutral grip -- so they look like
they should take the neutral offset. They do not: it puts their blade 0.55-1.24 m
in the air. Same spacing, different hand ORIENTATION.

Fitting a grip to them instead of transplanting one finds a direction that
grazes the ice (worst 0.6-97 mm), which looks like a rescue and is not:
  * the six fitted grips disagree with each other by 4-112 deg, median 71. A
    stick that swings 71 deg between GlideForward and Stop is not one stick,
    and every crossfade between them would show it.
  * one offset fitted jointly to all six fails at 0.263 m.
  * calibrated on clips where the answer is known, the same fit recovers the
    real grip only where the blade truly stays down all clip -- TurnTightR
    0.2 deg, TurnTightL 2.0, WalkForwardWithPuck 3.7 -- and is 89-95 deg out on
    Shooting, SlapShot and TurnPunchR, whose blades legitimately LIFT. The
    objective is "blade on the ice every frame"; where that is false the fit is
    meaningless, and for Acceleration it is probably false too.
So the fit cannot be trusted for the six, and the transplant says they hold no
stick. Both readings agree: the ARMS are wrong there, not the grip.

THE ASK BACK TO THE ANIMATOR, corrected. The 08-16 note said "key the `stick`
control in those six". That is not enough -- keying the control moves the stick
to the hands, and in those six the hands are not holding one. What is needed is
the same thing he already did for the 08-15 pack: RE-POSE THE ARMS in
WalkForward, WalkBackward, Acceleration, GlideForward, Stop and StopHockey
starting from a stance idle that already holds the stick. Anything he delivers
that way needs no bake at all -- the offset above reads the grip straight off
hand.L.

TRAP. Measure hand spacing in ONE space. handrigid.py reports 0.710 m and
gripfit.py 0.640 m for the same grip: a relative transform (HL^-1 @ HR) cancels
metarig's 0.901369 world scale and a difference of two world positions does not.
scalecheck.py proves the two blends are identical -- same bone lengths, same
rest, same 0.901369 -- so any size difference between them is your own frame.

==========================================================================
WIRING THE CLIP-OWNED STICK INTO THE BUILD (2026-08-17)
==========================================================================
The seven stance clips measured good in the section above now take their shaft
from the animator's own grip in the shipping build. Probe: game/stickprobe.sh,
7/7 PASS against Blender's own numbers, 7/7 FAIL on the pre-change build.

WHAT WENT IN
 * IH_GRIP_FRAMES in ice_hockey.html -- butt, tip and an `up` for the ROLL, as
   three vectors in hand_l's local space, one set per grip. Roll is the thing a
   hand-to-hand LINE can never carry, which is why the build previously guessed
   the blade face from the top wrist plus stickRollCal.
 * IH_CLIP_GRIP -- which clips may own a stick. Seven, deliberately: the four
   Neutral transitions, IdleN and the six broken skating clips are excluded for
   the reasons measured above, and the nine IK-splice clips are left alone
   because they are already correct.
 * ihClipStickFrame() + a blend by the mixer's own weight in poseStick.
 * CONFIG.clipStickAuthority (1) and CONFIG.animReachLimit (0.55 m).

NO CONVERSION WAS NEEDED, AND THAT IS MEASURED. handframe_cmp.py (Blender) and
game/handframe.js (the build) put six bones expressed in hand_l's local frame
within 3 mm of each other, so the build's `hand_l` IS the metarig's `hand.L`:
same axes, same scale. Do not "fix" these numbers with an axis swap.

THE ARMS HAD TO COME BACK FIRST, and this cost the most time. Wiring the grip
up and measuring gave a blade 1.56 m in the air. The offsets were fine; the
payload's stance clips were not carrying the animator's arms at all. The 08-15
pass re-baked them, so in IdleForeHandPulledBack the other fist sits at
(0.125, 0.007, +0.449) in hand_l's frame where the blend has
(0.031, 0.016, -0.616) -- opposite side, 0.15 m closer. merge_raw.py rebuilds
the payload taking those seven clips wholesale from assets/new_anim.glb (the
raw 31-action export, 15:23, hours before the 19:37 bake solve). RETIME comes
out 1.25 and is DERIVED per clip and cross-checked, not assumed.
After that, hand_r in hand_l's frame reads (0.031, 0.016, -0.615) in the build
against Blender's (0.031, 0.016, -0.616).

THREE TRAPS THIS RUN ADDED
 9. handleBlend IS NOT "the player is steering". It means the skill-stick layer
    is ENABLED, and it sits at 1 nearly all the time; with no input the layer's
    rotation is identity because it is a delta from neutral. Fading the clip
    stick out by (1-handleBlend) therefore switched the whole feature off in
    normal play, and the probe still showed 0.85 only because it starts the
    blend at 0. Nothing is needed in its place: the offset is in hand-local
    space, and applyStickHandle steers by bending the arms, so the authored
    grip rides the hand wherever the layer puts it.
10. stickVis IS READ OFF THE RENDERED MESH, not off `tip`
    (ent.stickVis.copy(stickGroup.localToWorld(IH_STICK_BLADE))). The mesh was
    still being scaled to CONFIG.stickLen 1.45 while the authored shaft is
    1.594, so the shaft resolved correctly and the drawn stick stopped 9% short
    of it -- a flat 0.059 m error on every clip that no amount of staring at
    the offsets would explain. Scale the mesh to butt.distanceTo(tip).
11. THE BUILD IS 1.081x BLENDER. hand_l's world scale is 0.9744 against the
    metarig's own 0.901369, so every world height in game is 1.081x the same
    height in the blend. Comparing raw gives a uniform 8% overshoot on all seven
    clips, which reads exactly like a systematic bug. stickprobe.js DERIVES the
    factor from the running build rather than typing it in, so it cannot absorb
    a real error.

GAMEPLAY: "WITHIN THE ANIMATION'S LIMITS" (user-authorised, 2026-08-17)
A deliberate partial reversal of the sim-first rule that a large stickVisErr
"may never again be closed by moving gameplay". poseAimPt is still built from
INPUT ALONE; one step was added before it is committed, which pulls the request
back toward the clip's own blade when it is further than CONFIG.animReachLimit
from it. The player still steers, he just cannot be commanded past what the
animation can reach. Inert on every clip that owns no stick, and at
animReachLimit 0 the old behaviour returns exactly.
