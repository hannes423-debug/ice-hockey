import bpy, sys, os

OUT = sys.argv[sys.argv.index('--') + 1]

# Keep ONLY the metarig armature: the payload is bones-only (no meshes/skins).
arm = bpy.data.objects['metarig']
for ob in list(bpy.data.objects):
    if ob is not arm:
        bpy.data.objects.remove(ob, do_unlink=True)

bpy.context.view_layer.update()
for ob in bpy.context.view_layer.objects:
    ob.select_set(ob is arm)
bpy.context.view_layer.objects.active = arm

# Every action must be exported, so give them all a fake user and make sure the
# NLA is empty (ACTIONS mode walks bpy.data.actions for the armature).
for a in bpy.data.actions:
    a.use_fake_user = True

print("EXPORTING actions:", sorted(a.name for a in bpy.data.actions))

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_bake_animation=True,          # sample every frame, no curve fitting
    export_optimize_animation_size=False,# keep constant channels intact
    export_anim_single_armature=True,
    export_force_sampling=True,
    export_frame_range=False,            # use each action's own range
    export_apply=False,
    export_yup=True,
    export_skins=False,
    export_morph=False,
    export_materials='NONE',
    export_def_bones=False,
    export_rest_position_armature=True,
)
print("WROTE", OUT, os.path.getsize(OUT))
