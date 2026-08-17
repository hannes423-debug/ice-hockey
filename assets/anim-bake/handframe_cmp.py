"""Blender side of the hand-frame comparison. Pair with game/handframe.js.

The stick offsets are expressed in hand.L's local frame. Transplanting them
into the build is only valid if the build's `hand_l` bone has the SAME local
axes and scale -- and the build's model is not this metarig, clips are remapped
onto it, so that is a measurement, not an assumption.

Prints the same six bones the game probe prints, in hand.L's local frame, for
one clip and phase. Matching numbers mean one frame. A permutation shows up as
a swapped axis, a scale difference as a constant ratio, and a roll difference
as a rotation of the x/y pair with z left alone.

    blender -b '<nonIK>.blend' -P handframe_cmp.py -- 1IdleL 0.5
"""
import sys
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
CLIP = argv[0] if argv else '1IdleL'
PHASE = float(argv[1]) if len(argv) > 1 else 0.5

# game joint name -> metarig bone name
PAIRS = [('hand_r', 'hand.R'), ('lowerarm_l', 'forearm.L'),
         ('upperarm_l', 'upper_arm.L'), ('head', 'head'),
         ('foot_r', 'foot.R'), ('spine_01', 'spine')]

sc = bpy.context.scene
mr = bpy.data.objects['metarig']
act = bpy.data.actions[CLIP]
mr.animation_data.action = act
f0, f1 = [int(round(x)) for x in act.frame_range]
f = int(round(f0 + (f1 - f0) * PHASE))
sc.frame_set(f)
dg = bpy.context.evaluated_depsgraph_get()
me = mr.evaluated_get(dg)
MW = me.matrix_world

HL = MW @ me.pose.bones['hand.L'].matrix
inv = HL.inverted()
print('clip=%s phase=%.3f frame=%d (range %d..%d)' % (CLIP, PHASE, f, f0, f1))
print('hand_l_worldPos=%s'
      % np.round(np.array(HL.translation), 4))
print('metarig world scale=%.6f' % MW.to_scale()[0])
for game, bone in PAIRS:
    p = inv @ (MW @ me.pose.bones[bone].matrix).translation
    print('local_%-12s %s   |%.4f|'
          % (game, np.round(np.array(p), 4), p.length))
