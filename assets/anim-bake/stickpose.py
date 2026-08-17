"""Which IK clips did the animator actually POSE the stick in?

Ground truth, straight out of Blender: evaluate the 6-bone stick armature (it is
CHILD_OF the metarig's `stick` bone) and read the world height of the blade tip
on every frame. The ice is z~0.0 and the skater's toe rides at z~0.10.

    blender -b '<IK>.blend' -P stickpose.py

A clip whose tip sits ~1.0 m up for its whole length is a clip where the `stick`
control was never keyed: it stays at its rest transform, held out horizontally
at chest height, and both fists ride it there because handIK.L/R are CHILD_OF
it. Those clips must NOT be taken from the IK export -- see merge_ik.py.
"""
import bpy
import numpy as np

sc = bpy.context.scene
mr = bpy.data.objects['metarig']
ar = bpy.data.objects['Armature']
clips = [a.name for a in bpy.data.actions
         if not a.name.startswith('FK') and a.name != '0Pose']

print('%-24s %8s %8s %8s %8s %9s  %s'
      % ('clip', 'tipZmin', 'tipZmax', 'buttZ', 'toeZ', 'tipTravel', 'verdict'))
posed, unposed = [], []
for cn in sorted(clips):
    act = bpy.data.actions[cn]
    mr.animation_data.action = act
    f0, f1 = [int(x) for x in act.frame_range]
    tz, bz, tips, toe = [], [], [], 0.0
    for f in range(f0, f1+1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        ae, me = ar.evaluated_get(dg), mr.evaluated_get(dg)
        tip = ae.matrix_world @ ae.pose.bones['stick5'].tail
        butt = ae.matrix_world @ ae.pose.bones['stick\\'].head
        tz.append(tip.z)
        bz.append(butt.z)
        tips.append([tip.x, tip.y, tip.z])
        toe = (me.matrix_world @ me.pose.bones['toe.R'].head).z
    tips = np.array(tips)
    # a posed stick touches the ice at some point in the clip
    on_ice = min(tz) < 0.20
    (posed if on_ice else unposed).append(cn)
    print('%-24s %8.3f %8.3f %8.3f %8.3f %9.3f  %s'
          % (cn, min(tz), max(tz), np.mean(bz), toe,
             float(np.linalg.norm(tips.max(0)-tips.min(0))),
             'posed' if on_ice else 'NEVER KEYED (rest stick)'))

print('\nposed   (%d): %s' % (len(posed), ' '.join(posed)))
print('unposed (%d): %s' % (len(unposed), ' '.join(unposed)))
