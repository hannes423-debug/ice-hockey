"""Dump every action's RAW fcurves from a .blend to JSON, for blend-vs-blend diff.

    blender -b '<blend>' -P dump_fcurves.py -- out.json

Raw curves, not a sampled export: a sampled export cannot tell a source
duplicate from an IK/constraint collapse, and cannot tell "the animator
re-authored this clip" from "the exporter rounded differently". Keys are
(data_path, array_index) -> [[frame, value], ...] with the keyframe
co-ordinates exactly as stored.
"""
import bpy, sys, json

OUT = sys.argv[sys.argv.index('--') + 1]

data = {}
for a in bpy.data.actions:
    curves = {}
    for fc in a.fcurves:
        key = '%s[%d]' % (fc.data_path, fc.array_index)
        curves[key] = [[round(float(k.co[0]), 6), round(float(k.co[1]), 9)]
                       for k in fc.keyframe_points]
    data[a.name] = {
        'frame_range': [float(a.frame_range[0]), float(a.frame_range[1])],
        'n_fcurves': len(a.fcurves),
        'curves': curves,
    }

with open(OUT, 'w') as f:
    json.dump(data, f)
print('WROTE %s  actions=%d' % (OUT, len(data)))
