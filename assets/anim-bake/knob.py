"""Where does the top fist hold the shaft? Measure the knob grip in the IK blend.

Step A of the "lock the stick to the top arm" plan (animator, 2026-08-16).

handrigid.py showed the six broken clips hold a perfectly rigid two-hand grip in
the non-IK blend, so a stick locked to hand.R keeps both fists on it -- IF we
know where the shaft sits in hand.R's frame. That offset is not invented here:
it is measured off the 9 clips where the animator POSED his own stick.

    blender -b '<IK>.blend' -P knob.py

The shaft is read as two world points from the 6-bone stick armature (butt =
head of `stick\\`, tip = tail of `stick5`, same as stickpose.py) and expressed
in the local frame of each hand. If the top fist really grips the knob, those
two points are a CONSTANT in hand.R's frame, per clip and across clips.

Writes knob.json: the canonical butt/tip offsets, for stickfromhand.py to apply
to the non-IK clips. Prints hand.L's numbers too -- locking to the lower hand is
the alternative and it should be measured, not assumed away.
"""
import json
import bpy
import numpy as np

sc = bpy.context.scene
mr = bpy.data.objects['metarig']
ar = bpy.data.objects['Armature']

# stickpose.py's verdict, restated so this script stands alone
POSED = ['1IdleL', '1IdleR', '1Shooting', '1WalkForwardWithPuck', '2SlapShot',
         '2TurnPunchL', '2TurnPunchR', '2TurnTightL', '2TurnTightR']
# the seven the animator never keyed `stick` in, kept here so the contrast can
# be printed rather than remembered
UNPOSED = ['1IdleN', '1WalkForward', '1WalkBackward', '2Acceleration',
           '2GlideForward', '2Stop', '2StopHockey']


def local_shaft(hand):
    """butt & tip of the authored stick, in `hand`'s local frame, per clip"""
    out = {}
    for cn in POSED:
        act = bpy.data.actions.get(cn)
        if act is None:
            print('  !! no action %r' % cn)
            continue
        mr.animation_data.action = act
        f0, f1 = [int(round(x)) for x in act.frame_range]
        rows = []
        for f in range(f0, f1 + 1):
            sc.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            ae, me = ar.evaluated_get(dg), mr.evaluated_get(dg)
            H = (me.matrix_world @ me.pose.bones[hand].matrix).inverted()
            butt = ae.matrix_world @ ae.pose.bones['stick\\'].head
            tip = ae.matrix_world @ ae.pose.bones['stick5'].tail
            rows.append([*(H @ butt), *(H @ tip)])
        out[cn] = np.array(rows)
    return out


for hand in ('hand.R', 'hand.L'):
    print('\n================ shaft in %s local frame ================' % hand)
    per = local_shaft(hand)
    print('%-24s %9s %9s   %s' % ('clip', 'buttSprd', 'tipSprd', 'butt(local)'))
    for cn, A in per.items():
        b, t = A[:, :3], A[:, 3:]
        print('%-24s %9.4f %9.4f   %s'
              % (cn, float(np.linalg.norm(b.max(0) - b.min(0))),
                 float(np.linalg.norm(t.max(0) - t.min(0))),
                 np.round(b.mean(0), 4)))
    means = {cn: A.mean(0) for cn, A in per.items()}
    M = np.array(list(means.values()))
    print('ACROSS CLIPS  butt spread %.4f m   tip spread %.4f m'
          % (float(np.linalg.norm(M[:, :3].max(0) - M[:, :3].min(0))),
             float(np.linalg.norm(M[:, 3:].max(0) - M[:, 3:].min(0)))))
    if hand == 'hand.R':
        canon = M.mean(0)
        json.dump({'hand': hand,
                   'butt': list(canon[:3]), 'tip': list(canon[3:]),
                   'per_clip': {k: list(map(float, v)) for k, v in means.items()}},
                  open('knob.json', 'w'), indent=1)
        print('canonical butt %s  tip %s  -> knob.json'
              % (np.round(canon[:3], 4), np.round(canon[3:], 4)))
        print('shaft length %.3f m' % np.linalg.norm(canon[3:] - canon[:3]))
