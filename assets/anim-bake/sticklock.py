"""Apply the measured grip offset to the non-IK pack, and test it on hand.R.

Step C of "lock the stick to the arm" (animator, 2026-08-16).

gripfit.py fitted the shaft as two points in hand.L's local frame off the clips
where the animator posed his own stick, and leave-one-out showed the three
neutral-grip clips (TurnTightL/R, TurnPunchR) rebuild each other to 0.011 m and
0.03 deg. This script carries that offset onto the 31-action non-IK pack, which
has no stick at all.

    blender -b '<nonIK>.blend' -P sticklock.py

THE TEST IS hand.R, AND IT IS NOT CIRCULAR. The offset is measured from hand.L
in one blend; hand.R comes from the recipient clip's own raw fcurves in the
other. If the animator really posed these clips around a stick that is already
there, the shaft reconstructed from the LOWER hand must pass through the TOP
fist on its own. Nothing here fits anything to hand.R.

Reported per clip:
  gripOff   distance from hand.R's wrist to the reconstructed shaft LINE
  alongPct  where hand.R falls along butt->tip (a real top hand is near the butt)
  tipZ      blade tip height, min/max. The posed clips in the IK blend read
            0.016-0.063 m with the toe at ~0.10, so that is the target band.
"""
import json
import bpy
import numpy as np
from mathutils import Vector

sc = bpy.context.scene
mr = bpy.data.objects['metarig']
G = json.load(open('gripfit.json'))
ENDS = G['ends']

# rest-matrix agreement: the offset is expressed in hand.L's frame, so if the
# two rigs disagree about that frame the number means nothing.
for bn in ('hand.L', 'hand.R'):
    here = np.array([list(r) for r in mr.data.bones[bn].matrix_local])
    there = np.array(G['rest'][bn])
    print('rest %s agrees to %.9f' % (bn, np.abs(here - there).max()))

# world spacing per posed donor, to choose an offset by grip rather than by name
DONOR_SPACING = {c: G['spacing'][c][1] for c in ENDS}
BROKEN = ['1WalkForward', '1WalkBackward', '2Acceleration', '2GlideForward',
          '2Stop', '2StopHockey']


def pick_donor(sp):
    return min(DONOR_SPACING, key=lambda c: abs(DONOR_SPACING[c] - sp))


print('\n%-30s %-22s %7s %7s %8s %8s  %s'
      % ('clip', 'donor', 'gripOff', 'along%', 'tipZmin', 'tipZmax', 'note'))
rows = []
for cn in sorted(a.name for a in bpy.data.actions):
    act = bpy.data.actions[cn]
    if act.frame_range[1] - act.frame_range[0] < 0.5:
        continue
    mr.animation_data.action = act
    f0, f1 = [int(round(x)) for x in act.frame_range]
    # spacing first, to choose the donor grip
    sp = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        me = mr.evaluated_get(dg)
        sp.append(((me.matrix_world @ me.pose.bones['hand.L'].matrix).translation
                   - (me.matrix_world @ me.pose.bones['hand.R'].matrix).translation
                   ).length)
    donor = pick_donor(float(np.mean(sp)))
    bL = Vector(ENDS[donor]['butt'])
    tL = Vector(ENDS[donor]['tip'])

    off, along, tz = [], [], []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        me = mr.evaluated_get(dg)
        HL = me.matrix_world @ me.pose.bones['hand.L'].matrix
        HR = me.matrix_world @ me.pose.bones['hand.R'].matrix
        butt, tip = HL @ bL, HL @ tL
        d = (tip - butt).normalized()
        v = HR.translation - butt
        t = v.dot(d)
        off.append((v - t * d).length)
        along.append(100.0 * t / (tip - butt).length)
        tz.append(tip.z)
    note = ''
    if cn in BROKEN:
        note = '<- carries the 08-01 bake today'
    rows.append((cn, max(off), min(tz)))
    print('%-30s %-22s %7.4f %7.1f %8.3f %8.3f  %s'
          % (cn, donor, max(off), float(np.mean(along)), min(tz), max(tz), note))

wr = max(rows, key=lambda r: r[1])
print('\nworst top-fist-to-shaft distance over the pack: %.4f m (%s)'
      % (wr[1], wr[0]))
bad = [r for r in rows if r[0] in BROKEN]
print('the six broken clips: worst gripOff %.4f m, worst tipZmin %.3f m'
      % (max(r[1] for r in bad), max(r[2] for r in bad)))
