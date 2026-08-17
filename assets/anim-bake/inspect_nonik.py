"""What is in the non-IK blend? Objects, armatures, bone names, actions.

    blender -b '<nonIK>.blend' -P inspect_nonik.py

Pure reconnaissance -- names only, no measurement. The measurement that matters
(is the two-hand relative transform rigid?) is handrigid.py.
"""
import bpy

print('=== objects ===')
for o in bpy.data.objects:
    extra = ''
    if o.type == 'ARMATURE':
        extra = '  bones=%d' % len(o.data.bones)
    print('%-28s %-10s%s' % (o.name, o.type, extra))

for o in bpy.data.objects:
    if o.type != 'ARMATURE':
        continue
    names = [b.name for b in o.data.bones]
    print('\n=== %s: %d bones ===' % (o.name, len(names)))
    print(' '.join(names))
    hits = [n for n in names
            if any(k in n.lower() for k in ('hand', 'stick', 'forearm', 'palm'))]
    print('hand/stick-ish: %s' % ' '.join(hits))
    cons = []
    if o.pose:
        for pb in o.pose.bones:
            for c in pb.constraints:
                cons.append('%s <- %s(%s)' % (pb.name, c.type,
                                              getattr(c, 'subtarget', '')))
    print('constraints (%d): %s' % (len(cons), '; '.join(cons) if cons else 'none'))

print('\n=== actions (%d) ===' % len(bpy.data.actions))
for a in sorted(bpy.data.actions, key=lambda x: x.name):
    fr = a.frame_range
    print('%-34s frames %7.1f -> %7.1f  fcurves %4d  groups %s'
          % (a.name, fr[0], fr[1], len(a.fcurves),
             ','.join(sorted({g.name for g in a.groups})[:6])))
