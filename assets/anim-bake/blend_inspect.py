import bpy, sys, json

out = {"objects": [], "armatures": [], "actions": []}

for ob in bpy.data.objects:
    out["objects"].append({"name": ob.name, "type": ob.type,
                           "scale": list(ob.scale),
                           "action": (ob.animation_data.action.name
                                      if ob.animation_data and ob.animation_data.action else None)})
for arm in bpy.data.armatures:
    out["armatures"].append({"name": arm.name, "nbones": len(arm.bones),
                             "bones": [b.name for b in arm.bones]})

for a in bpy.data.actions:
    fr = a.frame_range
    bones = set()
    paths = set()
    for fc in a.fcurves:
        paths.add(fc.data_path.split('"')[-1] if '"' not in fc.data_path else fc.data_path)
        if fc.data_path.startswith('pose.bones["'):
            bones.add(fc.data_path.split('"')[1])
    # count keys to spot static/flat clips
    nkeys = sum(len(fc.keyframe_points) for fc in a.fcurves)
    out["actions"].append({
        "name": a.name,
        "frame_range": [fr[0], fr[1]],
        "fcurves": len(a.fcurves),
        "nkeys": nkeys,
        "nbones": len(bones),
        "users": a.users,
        "fake_user": a.use_fake_user,
        "bones": sorted(bones),
    })

print("###JSON###")
print(json.dumps(out, indent=1))
