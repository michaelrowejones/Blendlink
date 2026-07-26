# SPDX-License-Identifier: MIT
"""PROTOTYPE: generate one animation/deformation parity fixture and oracle.

Run only through run.mjs. The fixture intentionally combines the three core
glTF animation paths in one .blend:

* ordinary object translation + quaternion rotation;
* a two-bone armature deforming one mesh;
* one relative shape key animated on that same skinned mesh.

The JSON oracle is sampled from Blender's evaluated dependency graph. World
points and transforms are converted from Blender coordinates to glTF/Three
coordinates with C = Rx(-90 degrees): (x, y, z) -> (x, z, -y).
"""

from __future__ import annotations

import hashlib
import inspect
import json
import math
import sys
from pathlib import Path

import bpy
import io_scene_gltf2
from mathutils import Matrix, Quaternion, Vector


def output_directory() -> Path:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) != 1:
        raise SystemExit("expected: -- <output-directory>")
    result = Path(args[0]).resolve()
    result.mkdir(parents=True, exist_ok=True)
    return result


OUTPUT = output_directory()
BLEND_PATH = OUTPUT / "animation-deformation-fixture.blend"
REFERENCE_PATH = OUTPUT / "blender-reference.json"
REFERENCE_IMAGE_PATH = OUTPUT / "blender-reference-frame13.png"
KEY_FRAMES = (1, 7, 13, 19, 25)
SAMPLE_FRAMES = (1.0, 4.5, 7.0, 10.5, 13.0, 16.5, 19.0, 22.5, 25.0)

# Blender Z-up -> glTF/Three Y-up. This is a proper rotation (determinant +1).
BLENDER_TO_GLTF = Matrix((
    (1.0, 0.0, 0.0),
    (0.0, 0.0, 1.0),
    (0.0, -1.0, 0.0),
))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def vec3(value: Vector) -> list[float]:
    return [float(value.x), float(value.y), float(value.z)]


def quat_xyzw(value: Quaternion) -> list[float]:
    normalized = value.normalized()
    return [
        float(normalized.x),
        float(normalized.y),
        float(normalized.z),
        float(normalized.w),
    ]


def gltf_point(value: Vector) -> Vector:
    return BLENDER_TO_GLTF @ value


def gltf_world_transform(matrix: Matrix) -> tuple[Vector, Quaternion]:
    location, rotation, _scale = matrix.decompose()
    converted_rotation = (
        BLENDER_TO_GLTF
        @ rotation.to_matrix()
        @ BLENDER_TO_GLTF.transposed()
    ).to_quaternion()
    return gltf_point(location), converted_rotation


def look_at(object_: bpy.types.Object, target: Vector) -> None:
    object_.rotation_euler = (target - object_.location).to_track_quat("-Z", "Y").to_euler()


def material(name: str, color: tuple[float, float, float]) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Roughness"].default_value = 0.55
    return result


def set_linear_interpolation(action: bpy.types.Action | None) -> None:
    if action is None:
        raise RuntimeError("fixture keyframes did not create an Action")
    # Blender 5.2 layered Actions expose FCurves through channelbags, while
    # legacy Actions expose action.fcurves. Cover both without mutating any
    # project-owned data.
    curves = list(getattr(action, "fcurves", ()))
    for layer in getattr(action, "layers", ()):
        for strip in getattr(layer, "strips", ()):
            for channelbag in getattr(strip, "channelbags", ()):
                curves.extend(channelbag.fcurves)
    seen = set()
    for curve in curves:
        if curve.as_pointer() in seen:
            continue
        seen.add(curve.as_pointer())
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"


def create_transform_driver(scene: bpy.types.Scene) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=0.55)
    result = bpy.context.active_object
    result.name = "TransformDriver"
    result["blendlink_id"] = "transform-driver-id"
    result.data.materials.append(material("TransformBlue", (0.08, 0.32, 0.95)))
    result.rotation_mode = "QUATERNION"
    locations = (
        (-1.7, -0.20, 0.45),
        (-1.45, -0.05, 0.72),
        (-1.2, 0.15, 1.00),
        (-0.95, 0.05, 0.72),
        (-0.7, -0.20, 0.45),
    )
    angles = (0.0, 0.25, 0.65, 1.05, 1.35)
    axes = (
        Vector((0.0, 0.0, 1.0)),
        Vector((0.0, 1.0, 1.0)).normalized(),
        Vector((1.0, 1.0, 1.0)).normalized(),
        Vector((1.0, 0.0, 1.0)).normalized(),
        Vector((0.0, 1.0, 0.0)),
    )
    for frame, location, angle, axis in zip(KEY_FRAMES, locations, angles, axes):
        result.location = location
        result.rotation_quaternion = Quaternion(axis, angle)
        result.keyframe_insert("location", frame=frame, group="Transform")
        result.keyframe_insert("rotation_quaternion", frame=frame, group="Transform")
    result.animation_data.action.name = "TransformMotion"
    set_linear_interpolation(result.animation_data.action)
    return result


def create_deformer(
    scene: bpy.types.Scene,
) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.ShapeKey]:
    armature_data = bpy.data.armatures.new("ParityRig")
    armature = bpy.data.objects.new("ParityRig", armature_data)
    armature["blendlink_id"] = "parity-rig-id"
    armature.location = (0.8, 0.0, 0.0)
    scene.collection.objects.link(armature)

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    root = armature_data.edit_bones.new("Root")
    root.head = (0.0, 0.0, 0.0)
    root.tail = (0.0, 0.0, 1.0)
    tip = armature_data.edit_bones.new("Tip")
    tip.head = root.tail
    tip.tail = (0.0, 0.0, 2.0)
    tip.parent = root
    tip.use_connect = True
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.select_set(False)

    mesh_data = bpy.data.meshes.new("DeformationRibbonMesh")
    mesh_data.from_pydata(
        [
            (-0.30, 0.0, 0.0),
            (0.30, 0.0, 0.0),
            (-0.30, 0.0, 1.0),
            (0.30, 0.0, 1.0),
            (-0.30, 0.0, 2.0),
            (0.30, 0.0, 2.0),
        ],
        [],
        [(0, 1, 3, 2), (2, 3, 5, 4)],
    )
    mesh_data.update()
    mesh = bpy.data.objects.new("SkinnedDeformer", mesh_data)
    mesh["blendlink_id"] = "skinned-deformer-id"
    mesh.data.materials.append(material("DeformerOrange", (0.95, 0.22, 0.04)))
    scene.collection.objects.link(mesh)
    mesh.parent = armature

    root_group = mesh.vertex_groups.new(name="Root")
    tip_group = mesh.vertex_groups.new(name="Tip")
    root_group.add([0, 1], 1.0, "REPLACE")
    root_group.add([2, 3], 0.5, "REPLACE")
    tip_group.add([2, 3], 0.5, "REPLACE")
    tip_group.add([4, 5], 1.0, "REPLACE")

    mesh.shape_key_add(name="Basis")
    bulge = mesh.shape_key_add(name="Bulge")
    bulge.data[2].co.x -= 0.12
    bulge.data[3].co.x += 0.12
    bulge.data[4].co.x -= 0.42
    bulge.data[5].co.x += 0.42

    modifier = mesh.modifiers.new(name="ParityArmature", type="ARMATURE")
    modifier.object = armature

    root_pose = armature.pose.bones["Root"]
    tip_pose = armature.pose.bones["Tip"]
    root_pose.rotation_mode = "QUATERNION"
    tip_pose.rotation_mode = "QUATERNION"
    root_angles = (0.0, 0.12, 0.30, 0.48, 0.62)
    tip_angles = (0.0, -0.18, -0.42, -0.15, 0.28)
    morph_values = (0.0, 0.25, 1.0, 0.55, 0.1)
    for frame, root_angle, tip_angle, morph_value in zip(
        KEY_FRAMES, root_angles, tip_angles, morph_values
    ):
        root_pose.rotation_quaternion = Quaternion((0.0, 1.0, 0.0), root_angle)
        tip_pose.rotation_quaternion = Quaternion((1.0, 0.0, 0.0), tip_angle)
        root_pose.keyframe_insert("rotation_quaternion", frame=frame, group="Root")
        tip_pose.keyframe_insert("rotation_quaternion", frame=frame, group="Tip")
        bulge.value = morph_value
        bulge.keyframe_insert("value", frame=frame)

    armature.animation_data.action.name = "RigMotion"
    mesh.data.shape_keys.animation_data.action.name = "MorphMotion"
    set_linear_interpolation(armature.animation_data.action)
    set_linear_interpolation(mesh.data.shape_keys.animation_data.action)
    return mesh, armature, bulge


def create_reference_camera(scene: bpy.types.Scene) -> None:
    camera_data = bpy.data.cameras.new("ReferenceCamera")
    camera = bpy.data.objects.new("ReferenceCamera-noimp", camera_data)
    camera.location = (4.1, -6.4, 3.2)
    look_at(camera, Vector((-0.2, 0.0, 0.9)))
    scene.collection.objects.link(camera)
    scene.camera = camera

    key_data = bpy.data.lights.new("ReferenceKey", type="AREA")
    key_data.energy = 800.0
    key_data.shape = "DISK"
    key_data.size = 4.0
    key = bpy.data.objects.new("ReferenceKey-noimp", key_data)
    key.location = (-2.5, -3.5, 5.0)
    look_at(key, Vector((0.0, 0.0, 0.8)))
    scene.collection.objects.link(key)

    fill_data = bpy.data.lights.new("ReferenceFill", type="AREA")
    fill_data.energy = 450.0
    fill_data.size = 3.0
    fill = bpy.data.objects.new("ReferenceFill-noimp", fill_data)
    fill.location = (4.0, -1.0, 2.5)
    look_at(fill, Vector((0.0, 0.0, 1.0)))
    scene.collection.objects.link(fill)


def evaluated_points(
    mesh: bpy.types.Object, depsgraph: bpy.types.Depsgraph
) -> list[list[float]]:
    evaluated = mesh.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    try:
        return [
            vec3(gltf_point(evaluated.matrix_world @ vertex.co))
            for vertex in evaluated_mesh.vertices
        ]
    finally:
        evaluated.to_mesh_clear()


def evaluated_transform(object_: bpy.types.Object) -> dict:
    location, rotation = gltf_world_transform(object_.matrix_world)
    return {
        "position": vec3(location),
        "quaternion": quat_xyzw(rotation),
    }


def sample_oracle(
    scene: bpy.types.Scene,
    transform: bpy.types.Object,
    mesh: bpy.types.Object,
    armature: bpy.types.Object,
    bulge: bpy.types.ShapeKey,
) -> list[dict]:
    samples = []
    for frame in SAMPLE_FRAMES:
        whole_frame = math.floor(frame)
        scene.frame_set(whole_frame, subframe=frame - whole_frame)
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        depsgraph.update()
        transform_evaluated = transform.evaluated_get(depsgraph)
        armature_evaluated = armature.evaluated_get(depsgraph)
        bones = {}
        for name in ("Root", "Tip"):
            bone_matrix = (
                armature_evaluated.matrix_world
                @ armature_evaluated.pose.bones[name].matrix
            )
            location, rotation = gltf_world_transform(bone_matrix)
            bones[name] = {
                "position": vec3(location),
                "quaternion": quat_xyzw(rotation),
            }
        samples.append({
            "frame": frame,
            # Blendlink's production exporter deliberately uses Blender's
            # stock Actions mode here. Blender 5.2 emits positive source frame
            # numbers directly, so frame 1 is 1/fps rather than time zero.
            "timeSeconds": frame / scene.render.fps,
            "transform": evaluated_transform(transform_evaluated),
            "morphInfluence": float(bulge.value),
            "deformedWorldPoints": evaluated_points(mesh, depsgraph),
            "bones": bones,
        })
    return samples


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "AnimationDeformationParity"
    scene.frame_start = KEY_FRAMES[0]
    scene.frame_end = KEY_FRAMES[-1]
    scene.render.fps = 24
    scene.render.fps_base = 1.0
    # Blender 5.2 renamed the RNA enum back to BLENDER_EEVEE.
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(REFERENCE_IMAGE_PATH)
    bpy.context.preferences.filepaths.save_version = 0
    scene.world = bpy.data.worlds.new("ReferenceWorld")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.025, 0.035, 0.06, 1.0)
    background.inputs["Strength"].default_value = 0.35

    transform = create_transform_driver(scene)
    mesh, armature, bulge = create_deformer(scene)
    create_reference_camera(scene)
    scene.frame_set(13)
    bpy.context.view_layer.update()

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)
    bpy.ops.render.render(write_still=True)

    oracle = {
        "schemaVersion": 1,
        "coordinateContract": {
            "source": "Blender right-handed Z-up",
            "target": "glTF/Three right-handed Y-up",
            "mapping": "[x, y, z] -> [x, z, -y]",
            "matrixRowMajor": [list(row) for row in BLENDER_TO_GLTF],
        },
        "blender": {
            "version": bpy.app.version_string,
            "buildHash": (
                bpy.app.build_hash.decode()
                if isinstance(bpy.app.build_hash, bytes)
                else str(bpy.app.build_hash)
            ),
            "buildDate": (
                bpy.app.build_date.decode()
                if isinstance(bpy.app.build_date, bytes)
                else str(bpy.app.build_date)
            ),
            "binaryPath": bpy.app.binary_path,
        },
        "gltfExporter": {
            "version": list(io_scene_gltf2.bl_info["version"]),
            "modulePath": str(Path(inspect.getfile(io_scene_gltf2)).resolve()),
        },
        "fixture": {
            "fps": scene.render.fps,
            "frameStart": scene.frame_start,
            "frameEnd": scene.frame_end,
            "animationTimeOrigin": (
                "Blender frame / fps; stock Blender 5.2 Actions export does "
                "not force the first positive frame to zero"
            ),
            "transformObject": {
                "name": transform.name,
                "blendlinkId": transform["blendlink_id"],
            },
            "skinnedMesh": {
                "name": mesh.name,
                "blendlinkId": mesh["blendlink_id"],
                "sourceVertexCount": len(mesh.data.vertices),
                "boneNames": ["Root", "Tip"],
                "morphTarget": bulge.name,
            },
        },
        "samples": sample_oracle(scene, transform, mesh, armature, bulge),
    }
    REFERENCE_PATH.write_text(json.dumps(oracle, indent=2) + "\n", encoding="utf-8")
    # The save happened before rendering so repeat it only to restore the
    # artist-facing fixture to the first frame, not to persist any render state.
    scene.frame_set(scene.frame_start)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)
    oracle["artifacts"] = {
        "blendSha256": sha256(BLEND_PATH),
        "referenceImageSha256": sha256(REFERENCE_IMAGE_PATH),
    }
    REFERENCE_PATH.write_text(json.dumps(oracle, indent=2) + "\n", encoding="utf-8")
    print(
        "BLENDLINK_ANIMATION_DEFORMATION_FIXTURE_GENERATED",
        f"samples={len(oracle['samples'])}",
        f"vertices={len(mesh.data.vertices)}",
        f"blender={bpy.app.version_string}",
        f"gltfExporter={'.'.join(map(str, io_scene_gltf2.bl_info['version']))}",
    )


main()
