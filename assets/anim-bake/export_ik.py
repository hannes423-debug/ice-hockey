"""Export the IK blend's AUTHORED (non-FK) actions with every constraint baked.

The animator's IK blend is the SOURCE of truth for the arms: `handIK.L` and
`handIK.R` are CHILD_OF the metarig's `stick` bone, so both fists ride the
authored shaft exactly. The FK-prefixed duplicates are only the animator's
conversion step to the non-IK rig -- they are dropped here on purpose (his
words: "ignore the FK ones as I only use that to convert into non IK rig").

The exporter is forced to SAMPLE the evaluated pose so the IK/COPY_ROTATION/
CHILD_OF chain resolves into plain FK rotation tracks. The `stick` bone rides
along in the export: it is what finally gives the payload a moving stick.

    blender -b '<IK>.blend' -P export_ik.py -- ik_anim.glb
"""
import bpy, sys, os

OUT = sys.argv[sys.argv.index('--') + 1]

# 1. drop the FK conversion actions and the static pose; keep the authored ones
DROP_PREFIX = ('FK',)
DROP_EXACT = {'0Pose'}
for a in list(bpy.data.actions):
    if a.name.startswith(DROP_PREFIX) or a.name in DROP_EXACT:
        bpy.data.actions.remove(a)

# 2. bones only: the payload carries no meshes/skins. The stick's own 6-bone
#    armature is CHILD_OF metarig's `stick` bone, so dropping it loses nothing
#    -- the shaft is fully described by that one bone.
arm = bpy.data.objects['metarig']
for ob in list(bpy.data.objects):
    if ob is not arm:
        bpy.data.objects.remove(ob, do_unlink=True)

bpy.context.view_layer.update()
for ob in bpy.context.view_layer.objects:
    ob.select_set(ob is arm)
bpy.context.view_layer.objects.active = arm

for a in bpy.data.actions:
    a.use_fake_user = True

print("SCENE fps=%s/%s" % (bpy.context.scene.render.fps,
                           bpy.context.scene.render.fps_base))
print("EXPORTING actions:", sorted(a.name for a in bpy.data.actions))

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_bake_animation=True,           # sample every frame, no curve fitting
    export_optimize_animation_size=False, # keep constant channels intact
    export_anim_single_armature=True,
    export_force_sampling=True,           # <- what resolves the IK constraints
    export_frame_range=False,
    export_apply=False,
    export_yup=True,
    export_skins=False,
    export_morph=False,
    export_materials='NONE',
    export_def_bones=False,
    export_rest_position_armature=True,
)
print("WROTE", OUT, os.path.getsize(OUT))
