"""Export the authored stick as a FRAME in hand.L's local space, for the build.

handframe_cmp.py + game/handframe.js proved the build's `hand_l` bone carries
the same local axes and scale as Blender's `hand.L` (six bones agree to 3 mm),
so these numbers go straight into ice_hockey.html with no conversion.

Three vectors per grip, not two: butt and tip fix the shaft, and `up` fixes the
ROLL. A hand-to-hand line has no roll at all, which is why the build had to
guess the blade face from the top wrist plus a stickRollCal constant and a
per-zone stickRotX/Y/Z fudge. The animator's own stick answers it directly.

    blender -b '<IK>.blend' -P stickframe.py

Emits a JS literal for IH_CLIP_STICK. Only clips where the animator POSED the
stick can be donors -- stickpose.py's list -- and the stance pack inherits a
donor by grip, which sticklock.py chose by measured fist spacing.
"""
import json
import bpy
import numpy as np

sc = bpy.context.scene
mr = bpy.data.objects['metarig']
ar = bpy.data.objects['Armature']
ROOT, TIPB = 'stick\\', 'stick5'

# donor grips: the posed clips whose grip the stance pack inherits
DONORS = {'forehand': '1IdleL', 'backhand': '1IdleR',
          'withpuck': '1WalkForwardWithPuck', 'neutral': '2TurnTightL'}


def frame_of(cn, phase=0.0):
    act = bpy.data.actions[cn]
    mr.animation_data.action = act
    f0, f1 = [int(round(x)) for x in act.frame_range]
    f = int(round(f0 + (f1 - f0) * phase))
    sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    return ar.evaluated_get(dg), mr.evaluated_get(dg)


out = {}
for grip, cn in DONORS.items():
    aev, mev = frame_of(cn)
    HL = (mev.matrix_world @ mev.pose.bones['hand.L'].matrix)
    inv = HL.inverted()
    S = aev.matrix_world @ aev.pose.bones[ROOT].matrix
    butt = inv @ (aev.matrix_world @ aev.pose.bones[ROOT].head)
    tip = inv @ (aev.matrix_world @ aev.pose.bones[TIPB].tail)
    # roll reference: the stick root's own local X, as a DIRECTION in hand space
    ux = (S.to_3x3() @ __import__('mathutils').Vector((1, 0, 0))).normalized()
    up = (inv.to_3x3() @ ux).normalized()
    out[grip] = {'donor': cn,
                 'butt': [round(v, 5) for v in butt],
                 'tip': [round(v, 5) for v in tip],
                 'up': [round(v, 5) for v in up],
                 'len': round((tip - butt).length, 5)}
    print('%-9s donor %-22s butt %s tip %s up %s len %.4f'
          % (grip, cn, np.round(np.array(butt), 4), np.round(np.array(tip), 4),
             np.round(np.array(up), 4), (tip - butt).length))

json.dump(out, open('stickframe.json', 'w'), indent=1)
print('\n-> stickframe.json')
print('\n/* paste into ice_hockey.html */')
print('const IH_GRIP_FRAMES={')
for g, d in out.items():
    print("  %s:{butt:[%s],tip:[%s],up:[%s]},   // %s"
          % (g, ','.join('%.5f' % v for v in d['butt']),
             ','.join('%.5f' % v for v in d['tip']),
             ','.join('%.5f' % v for v in d['up']), d['donor']))
print('};')
