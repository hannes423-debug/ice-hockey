"""Fit the stick's rigid offset in the hands' frames, and LEAVE-ONE-OUT test it.

Step B of "lock the stick to the arm" (animator, 2026-08-16).

knob.py showed the shaft is rigid in hand.L's local frame within a clip (spread
0.0000 m on most, including Shooting and SlapShot) while hand.R merely pivots on
the knob -- so the LOWER hand is what the stick is welded to, and the top hand
is a hinge. Across clips the lower hand slides ALONG the shaft with the stance,
which is why there is no single global offset.

What makes this transplantable to the six unposed clips is that they are not a
new grip: WalkForward/WalkBackward/Acceleration/GlideForward/Stop/StopHockey all
hold their fists 0.710 m apart, the same spacing as TurnTightL, TurnTightR and
TurnPunchR -- three clips where the animator DID pose the stick.

    blender -b '<IK>.blend' -P gripfit.py

Two things are measured here and neither is compared against its own source:
 1. per-clip full 4x4 of the stick root in hand.L's frame (and hand.R's), and
 2. LEAVE-ONE-OUT: rebuild each 0.710-family clip's stick from ANOTHER clip's
    offset and compare against the stick the animator actually posed. That is
    the honest test of the transplant -- see feedback-tautological-verification.

Writes gripfit.json for sticklock.py to apply to the non-IK blend.
"""
import json
import bpy
import numpy as np
from mathutils import Matrix, Vector

sc = bpy.context.scene
mr = bpy.data.objects['metarig']
ar = bpy.data.objects['Armature']

POSED = ['1IdleL', '1IdleR', '1Shooting', '1WalkForwardWithPuck', '2SlapShot',
         '2TurnPunchL', '2TurnPunchR', '2TurnTightL', '2TurnTightR']
UNPOSED = ['1IdleN', '1WalkForward', '1WalkBackward', '2Acceleration',
           '2GlideForward', '2Stop', '2StopHockey']
ROOT = 'stick\\'      # head = butt of the shaft
TIPB = 'stick5'       # tail = blade tip

print('stick armature has its own action: %s'
      % bool(ar.animation_data and ar.animation_data.action))
print('\n=== rest matrices (must match the non-IK rig or the offset is void) ===')
rest = {}
for bn in ('hand.L', 'hand.R'):
    M = mr.data.bones[bn].matrix_local
    rest[bn] = [list(r) for r in M]
    print('%s\n%s' % (bn, np.round(np.array(rest[bn]), 5)))


def frames(act):
    f0, f1 = [int(round(x)) for x in act.frame_range]
    return range(f0, f1 + 1)


def sample(cn):
    """per frame: stick-root 4x4 in hand.L and hand.R frames, plus world tip"""
    act = bpy.data.actions[cn]
    mr.animation_data.action = act
    outL, outR, tips = [], [], []
    for f in frames(act):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        ae, me = ar.evaluated_get(dg), mr.evaluated_get(dg)
        S = ae.matrix_world @ ae.pose.bones[ROOT].matrix
        HL = me.matrix_world @ me.pose.bones['hand.L'].matrix
        HR = me.matrix_world @ me.pose.bones['hand.R'].matrix
        outL.append(HL.inverted() @ S)
        outR.append(HR.inverted() @ S)
        tips.append(ae.matrix_world @ ae.pose.bones[TIPB].tail)
    return outL, outR, tips


def mean_mat(mats):
    """average of rigid transforms: mean translation, quaternion-averaged rot"""
    t = np.mean([list(m.translation) for m in mats], axis=0)
    qs = [m.to_quaternion() for m in mats]
    ref = qs[0]
    Q = np.array([[q.w, q.x, q.y, q.z] if q.dot(ref) >= 0
                  else [-q.w, -q.x, -q.y, -q.z] for q in qs])
    from mathutils import Quaternion
    q = Quaternion(Q.mean(0))
    q.normalize()
    M = q.to_matrix().to_4x4()
    M.translation = t
    return M


data, spac = {}, {}
print('\n%-24s %9s %9s %8s   spacing' % ('clip', 'rigidL', 'rigidR', 'tipZmin'))
for cn in POSED:
    outL, outR, tips = sample(cn)
    mL, mR = mean_mat(outL), mean_mat(outR)
    # rigidity = worst deviation of the stick ROOT position in that hand's frame
    devL = max((m.translation - mL.translation).length for m in outL)
    devR = max((m.translation - mR.translation).length for m in outR)
    # hand spacing, for the family grouping
    act = bpy.data.actions[cn]
    sp = []
    for f in frames(act):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        me = mr.evaluated_get(dg)
        sp.append(((me.matrix_world @ me.pose.bones['hand.L'].matrix).translation
                   - (me.matrix_world @ me.pose.bones['hand.R'].matrix).translation
                   ).length)
    spac[cn] = (min(sp), max(sp))
    data[cn] = {'L': [list(r) for r in mL], 'R': [list(r) for r in mR],
                'rigidL': devL, 'rigidR': devR, 'spacing': [min(sp), max(sp)],
                'tipZmin': min(t.z for t in tips)}
    print('%-24s %9.4f %9.4f %8.3f   %.3f-%.3f'
          % (cn, devL, devR, min(t.z for t in tips), min(sp), max(sp)))

for cn in UNPOSED:
    act = bpy.data.actions[cn]
    mr.animation_data.action = act
    sp = []
    for f in frames(act):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        me = mr.evaluated_get(dg)
        sp.append(((me.matrix_world @ me.pose.bones['hand.L'].matrix).translation
                   - (me.matrix_world @ me.pose.bones['hand.R'].matrix).translation
                   ).length)
    spac[cn] = (min(sp), max(sp))
    print('%-24s %9s %9s %8s   %.3f-%.3f  (unposed)'
          % (cn, '-', '-', '-', min(sp), max(sp)))

# ---- leave-one-out over the neutral-spacing family -------------------------
# 0.640 m WORLD, which is the same grip handrigid.py reports as 0.710: that
# script's relative transform cancels metarig's 0.901369 world scale and this
# one's world-space difference does not. Same rig, two spaces -- the blends are
# identical (scalecheck.py: same bone lengths, same rest, same scale).
NEUTRAL = 0.640
FAM = [c for c in POSED if abs(spac[c][1] - NEUTRAL) < 0.01]
print('\n%.3f-spacing family among the POSED clips: %s'
      % (NEUTRAL, ' '.join(FAM)))
print('unposed clips in that same family: %s'
      % ' '.join(c for c in UNPOSED if abs(spac[c][1] - NEUTRAL) < 0.01))

def endpoints_in_hand(cn, only_first=False):
    """butt & tip of the authored stick as POINTS in hand.L's frame, per frame.

    Points, not a decomposed matrix. mean_mat() cannot be used for the offset:
    hand.L's and hand.R's bone matrices are mirrored on this rig (their rest
    rows differ only in sign) and the stick armature carries metarig's 0.901369
    world scale relative to it, so to_quaternion() on HL^-1 @ S returns a
    rotation that is exactly 180 deg out. Two points carry no such ambiguity.
    """
    act = bpy.data.actions[cn]
    mr.animation_data.action = act
    ff = list(frames(act))
    if only_first:
        ff = ff[:1]
    out = []
    for f in ff:
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        aev, mev = ar.evaluated_get(dg), mr.evaluated_get(dg)
        H = (mev.matrix_world @ mev.pose.bones['hand.L'].matrix).inverted()
        butt = aev.matrix_world @ aev.pose.bones[ROOT].head
        tip = aev.matrix_world @ aev.pose.bones[TIPB].tail
        out.append((H @ butt, H @ tip, butt, tip))
    return out


print('\n--- LEAVE ONE OUT: build clip X\'s stick from clip Y\'s offset ---')
print('%-24s %-24s %9s %9s %9s' %
      ('rebuild', 'using offset from', 'buttErr', 'tipErr', 'axisDeg'))
worst = 0.0
offsets = {c: endpoints_in_hand(c, only_first=True)[0][:2] for c in FAM}
for cn in FAM:
    truth = endpoints_in_hand(cn)
    act = bpy.data.actions[cn]
    mr.animation_data.action = act
    ff = list(frames(act))
    for src in FAM:
        if src == cn:
            continue
        bL, tL = offsets[src]
        be, te, ax = [], [], []
        for i, f in enumerate(ff):
            sc.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            mev = mr.evaluated_get(dg)
            HL = mev.matrix_world @ mev.pose.bones['hand.L'].matrix
            b_rec, t_rec = HL @ bL, HL @ tL
            _, _, b_true, t_true = truth[i]
            be.append((b_rec - b_true).length)
            te.append((t_rec - t_true).length)
            d_true = (t_true - b_true).normalized()
            d_rec = (t_rec - b_rec).normalized()
            ax.append(np.degrees(np.arccos(max(-1, min(1, d_true.dot(d_rec))))))
        worst = max(worst, max(te))
        print('%-24s %-24s %9.4f %9.4f %9.3f'
              % (cn, src, max(be), max(te), max(ax)))
print('\nworst leave-one-out tip error in the 0.710 family: %.4f m' % worst)

# the offset sticklock.py actually applies: two points in hand.L's frame, one
# pair per posed clip. Frame 0 is exact wherever rigidL is 0.0000.
ends = {}
for cn in POSED:
    b, t = endpoints_in_hand(cn, only_first=True)[0][:2]
    ends[cn] = {'butt': list(b), 'tip': list(t),
                'len': (t - b).length, 'rigidL': data[cn]['rigidL']}
    print('offset %-24s butt %s tip %s len %.3f'
          % (cn, np.round(np.array(list(b)), 4),
             np.round(np.array(list(t)), 4), (t - b).length))

json.dump({'rest': rest, 'clips': data, 'ends': ends,
           'spacing': {k: list(v) for k, v in spac.items()},
           'family_neutral': FAM, 'loo_worst_tip': worst},
          open('gripfit.json', 'w'), indent=1)
print('-> gripfit.json')
