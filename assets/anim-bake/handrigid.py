"""Is the two-hand grip RIGID in the non-IK blend?

The animator's claim (2026-08-16): the non-IK clips carry no stick, but the
stick "can be locked in to the top arm" because the poses were authored around
a stick that is already there in the idle.

That claim is falsifiable and this is the test. If the animator really posed
both fists on one shaft, then hand.L expressed in hand.R's local frame is a
CONSTANT for the whole clip -- a rigid two-hand grip is exactly a constant
relative transform. If instead the arms swing independently, the relative
transform wanders and no rigidly-locked stick can keep both fists on it.

    blender -b '<nonIK>.blend' -P handrigid.py

Reports, per clip:
  spacing      wrist-to-wrist distance, min/max/spread  (a rigid grip: spread~0)
  posSpread    |max-min| of hand.L's position in hand.R's frame, per axis
  rotSpread    worst angle between the per-frame relative rotation and the
               clip's mean relative rotation
and then the same statistics ACROSS clips, which decides whether one global
stick offset serves the whole pack or each clip needs its own.

Nothing here is compared against anything this script produced: both hands come
from the animator's raw fcurves and the two are independent limbs of the rig.
See feedback-tautological-verification.
"""
import bpy
import numpy as np
from mathutils import Quaternion

sc = bpy.context.scene
mr = bpy.data.objects['metarig']
SKIP = ('FK',)
clips = sorted(a.name for a in bpy.data.actions
               if not a.name.startswith(SKIP))


def qang(a, b):
    """angle in degrees between two rotations given as mathutils Quaternions"""
    d = abs(a.dot(b))
    d = max(-1.0, min(1.0, d))
    return np.degrees(2.0 * np.arccos(d))


def relmats(act):
    """hand.L in hand.R's local frame, every frame of `act`"""
    mr.animation_data.action = act
    f0, f1 = [int(round(x)) for x in act.frame_range]
    out = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = mr.evaluated_get(dg)
        MW = ev.matrix_world
        MR = MW @ ev.pose.bones['hand.R'].matrix
        ML = MW @ ev.pose.bones['hand.L'].matrix
        out.append(MR.inverted() @ ML)
    return out


def stats(mats):
    pos = np.array([[m.translation.x, m.translation.y, m.translation.z]
                    for m in mats])
    quats = [m.to_quaternion() for m in mats]
    ref = quats[0]
    quats = [q if q.dot(ref) >= 0 else Quaternion((-q.w, -q.x, -q.y, -q.z))
             for q in quats]
    acc = np.mean([[q.w, q.x, q.y, q.z] for q in quats], axis=0)
    mean = Quaternion(acc)
    mean.normalize()
    spac = np.linalg.norm(pos, axis=1)
    return dict(pos=pos, mean_pos=pos.mean(0), mean_q=mean,
                spac_min=spac.min(), spac_max=spac.max(),
                pos_spread=float(np.linalg.norm(pos.max(0) - pos.min(0))),
                rot_spread=max(qang(q, mean) for q in quats))


print('%-30s %6s %6s %7s %8s   %s'
      % ('clip', 'spcMin', 'spcMax', 'posSprd', 'rotSprd', 'verdict'))
allst = {}
for cn in clips:
    act = bpy.data.actions[cn]
    if act.frame_range[1] - act.frame_range[0] < 0.5:
        continue                      # 0Idle: a single static key
    st = stats(relmats(act))
    allst[cn] = st
    rigid = st['pos_spread'] < 0.05 and st['rot_spread'] < 10.0
    print('%-30s %6.3f %6.3f %7.3f %8.2f   %s'
          % (cn, st['spac_min'], st['spac_max'], st['pos_spread'],
             st['rot_spread'], 'RIGID' if rigid else 'hands move apart'))

# ---- across clips: does one global offset serve the whole pack? -------------
names = list(allst)
P = np.array([allst[n]['mean_pos'] for n in names])
gpos = P.mean(0)
print('\nacross %d clips: mean grip offset (hand.R frame) %s'
      % (len(names), np.round(gpos, 4)))
print('  per-clip mean position spread across the pack: %.4f m'
      % float(np.linalg.norm(P.max(0) - P.min(0))))
ref = allst[names[0]]['mean_q']
worst = max((qang(allst[n]['mean_q'], ref), n) for n in names)
print('  worst per-clip mean rotation vs %s: %.2f deg (%s)'
      % (names[0], worst[0], worst[1]))
print('  spacing over the whole pack: %.3f - %.3f m'
      % (min(allst[n]['spac_min'] for n in names),
         max(allst[n]['spac_max'] for n in names)))
