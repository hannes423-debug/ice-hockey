"""Are the two blends the same size? Run on BOTH and compare.

gripfit.py measured hand spacing 0.640 m in the IK blend for the neutral family;
handrigid.py measured 0.710 m for the SAME clips in the non-IK blend. Every
stance came out in the same ratio (0.710/0.640 = 1.1097, 0.617/0.556 = 1.110,
0.576/0.519 = 1.110), which is a uniform scale, not a re-pose. An offset carried
between the files without that factor lands 6 cm wrong.

    blender -b '<blend>' -P scalecheck.py
"""
import bpy
import numpy as np

for o in bpy.data.objects:
    if o.type == 'ARMATURE':
        print('%-12s matrix_world scale %s   loc %s'
              % (o.name, np.round(np.array(o.matrix_world.to_scale()), 6),
                 np.round(np.array(o.matrix_world.translation), 4)))

mr = bpy.data.objects['metarig']
print('\nrest bone lengths (armature space, metarig):')
for bn in ('upper_arm.L', 'forearm.L', 'hand.L', 'spine', 'thigh.L', 'shin.L'):
    b = mr.data.bones.get(bn)
    if b:
        print('  %-14s %.6f' % (bn, b.length))
print('rest hand.L head (armature space): %s'
      % np.round(np.array(mr.data.bones['hand.L'].head_local), 6))
print('rest wrist-to-wrist (armature space): %.6f'
      % (mr.data.bones['hand.L'].head_local
         - mr.data.bones['hand.R'].head_local).length)

ar = bpy.data.objects.get('Armature')
if ar:
    print('\nstick armature rest length (butt->tip, armature space): %.6f'
          % (ar.data.bones['stick5'].tail_local
             - ar.data.bones['stick\\'].head_local).length)
    print('stick world length: %.6f'
          % ((ar.matrix_world @ ar.data.bones['stick5'].tail_local)
             - (ar.matrix_world @ ar.data.bones['stick\\'].head_local)).length)
