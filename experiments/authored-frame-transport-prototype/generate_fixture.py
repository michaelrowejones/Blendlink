# SPDX-License-Identifier: MIT
"""PROTOTYPE: generate an authored-frame transport differential.

The saved scene is deliberately at frame 10 while its animation starts at
frame 0.  It combines:

* an unkeyed object following a keyed target through Copy Location;
* an animated camera whose orientation comes from Track To;
* an object transform driven by an animated custom property;
* a one-bone skinned mesh whose current pose differs from its rest pose; and
* a Principled roughness driver, which core glTF animation cannot represent.

The dependency graph is the oracle.  Run this file only through ``run.mjs``.
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


KEY_FRAMES = (0, 10, 20)
SAVED_FRAME = 10
FPS = 10
BLENDER_TO_GLTF = Matrix(
    (
        (1.0, 0.0, 0.0),
        (0.0, 0.0, 1.0),
        (0.0, -1.0, 0.0),
    )
)


def output_directory() -> Path:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) != 1:
        raise SystemExit("expected: -- <output-directory>")
    result = Path(args[0]).resolve()
    result.mkdir(parents=True, exist_ok=True)
    return result


OUTPUT = output_directory()
BLEND_PATH = OUTPUT / "authored-frame-fixture.blend"
REFERENCE_PATH = OUTPUT / "blender-reference.json"
REFERENCE_IMAGE_PATH = OUTPUT / "blender-authored-frame.png"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def vector(value: Vector) -> list[float]:
    return [float(value.x), float(value.y), float(value.z)]


def gltf_vector(value: Vector) -> Vector:
    return BLENDER_TO_GLTF @ value


def quaternion(value: Quaternion) -> list[float]:
    normalized = value.normalized()
    return [
        float(normalized.x),
        float(normalized.y),
        float(normalized.z),
        float(normalized.w),
    ]


def gltf_world_transform(matrix: Matrix) -> dict:
    location, rotation, scale = matrix.decompose()
    converted_rotation = (
        BLENDER_TO_GLTF @ rotation.to_matrix() @ BLENDER_TO_GLTF.transposed()
    ).to_quaternion()
    return {
        "position": vector(gltf_vector(location)),
        "quaternion": quaternion(converted_rotation),
        "scale": vector(scale),
    }


def material(
    name: str, color: tuple[float, float, float], *, emission: float = 0.0
) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Roughness"].default_value = 0.45
    if emission > 0.0:
        principled.inputs["Emission Color"].default_value = (*color, 1.0)
        principled.inputs["Emission Strength"].default_value = emission
    return result


def cube(
    name: str,
    location: tuple[float, float, float],
    size: float,
    color: tuple[float, float, float],
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=size, location=location)
    result = bpy.context.active_object
    result.name = name
    result.data.materials.append(material(f"{name}Material", color))
    return result


def set_linear_interpolation(action: bpy.types.Action | None) -> None:
    if action is None:
        raise RuntimeError("fixture keyframes did not create an Action")
    curves = list(getattr(action, "fcurves", ()))
    for layer in getattr(action, "layers", ()):
        for strip in getattr(layer, "strips", ()):
            for channelbag in getattr(strip, "channelbags", ()):
                curves.extend(channelbag.fcurves)
    seen: set[int] = set()
    for curve in curves:
        pointer = curve.as_pointer()
        if pointer in seen:
            continue
        seen.add(pointer)
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"


def add_driver(
    owner,
    data_path: str,
    controller: bpy.types.Object,
    controller_path: str,
    *,
    index: int | None = None,
    expression: str = "value",
) -> None:
    curve = (
        owner.driver_add(data_path)
        if index is None
        else owner.driver_add(data_path, index)
    )
    driver = curve.driver
    driver.type = "SCRIPTED"
    variable = driver.variables.new()
    variable.name = "value"
    variable.type = "SINGLE_PROP"
    variable.targets[0].id = controller
    variable.targets[0].data_path = controller_path
    driver.expression = expression


def create_motion(scene: bpy.types.Scene) -> dict[str, bpy.types.Object]:
    target = cube("MotionTarget", (-2.0, 0.0, 0.65), 0.35, (0.08, 0.55, 1.0))
    target_positions = (
        (-2.0, 0.0, 0.65),
        (0.0, 0.0, 1.45),
        (2.0, 0.0, 0.65),
    )
    for frame, position in zip(KEY_FRAMES, target_positions):
        target.location = position
        target.keyframe_insert("location", frame=frame, group="Motion")
    target.animation_data.action.name = "TargetMotion"
    set_linear_interpolation(target.animation_data.action)

    constrained = cube(
        "ConstrainedCube", (0.0, 1.15, 0.0), 0.8, (1.0, 0.24, 0.08)
    )
    copy_location = constrained.constraints.new("COPY_LOCATION")
    copy_location.name = "Follow MotionTarget"
    copy_location.target = target
    copy_location.use_offset = True

    controller = bpy.data.objects.new("DriverController", None)
    controller.empty_display_type = "PLAIN_AXES"
    controller["drive"] = 0.0
    controller["material_drive"] = 0.15
    scene.collection.objects.link(controller)
    for frame, drive, roughness in zip(
        KEY_FRAMES,
        (0.0, 1.8, 3.6),
        (0.15, 0.55, 0.9),
    ):
        controller["drive"] = drive
        controller["material_drive"] = roughness
        controller.keyframe_insert('["drive"]', frame=frame, group="Drivers")
        controller.keyframe_insert(
            '["material_drive"]', frame=frame, group="Drivers"
        )
    controller.animation_data.action.name = "ControllerMotion"
    set_linear_interpolation(controller.animation_data.action)

    driven = cube("DrivenCube", (-2.25, -1.35, 0.45), 0.65, (0.72, 0.12, 0.92))
    add_driver(
        driven,
        "location",
        controller,
        '["drive"]',
        index=0,
        expression="value - 2.25",
    )

    roughness_socket = driven.active_material.node_tree.nodes[
        "Principled BSDF"
    ].inputs["Roughness"]
    add_driver(
        roughness_socket,
        "default_value",
        controller,
        '["material_drive"]',
    )

    camera_data = bpy.data.cameras.new("AuthoredCamera")
    camera_data.lens = 46.0
    camera = bpy.data.objects.new("AuthoredCamera", camera_data)
    scene.collection.objects.link(camera)
    camera_positions = (
        (6.2, -8.4, 4.1),
        (5.0, -7.1, 3.4),
        (6.8, -6.3, 4.7),
    )
    for frame, position in zip(KEY_FRAMES, camera_positions):
        camera.location = position
        camera.keyframe_insert("location", frame=frame, group="Camera")
    camera.animation_data.action.name = "CameraMotion"
    set_linear_interpolation(camera.animation_data.action)
    track_to = camera.constraints.new("TRACK_TO")
    track_to.name = "Aim at ConstrainedCube"
    track_to.target = constrained
    track_to.track_axis = "TRACK_NEGATIVE_Z"
    track_to.up_axis = "UP_Y"
    scene.camera = camera

    return {
        "target": target,
        "constrained": constrained,
        "controller": controller,
        "driven": driven,
        "camera": camera,
    }


def create_skinned_ribbon(
    scene: bpy.types.Scene,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    armature_data = bpy.data.armatures.new("AuthoredRig")
    armature = bpy.data.objects.new("AuthoredRig", armature_data)
    armature.location = (0.0, 0.0, 0.0)
    scene.collection.objects.link(armature)

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bone = armature_data.edit_bones.new("DeformBone")
    bone.head = (0.0, 0.0, 0.0)
    bone.tail = (0.0, 0.0, 2.2)
    bone_name = bone.name
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.select_set(False)

    mesh_data = bpy.data.meshes.new("SkinnedRibbonMesh")
    mesh_data.from_pydata(
        [
            (-0.35, 0.0, 0.0),
            (0.35, 0.0, 0.0),
            (-0.35, 0.0, 1.1),
            (0.35, 0.0, 1.1),
            (-0.35, 0.0, 2.2),
            (0.35, 0.0, 2.2),
        ],
        [],
        [(0, 1, 3, 2), (2, 3, 5, 4)],
    )
    mesh_data.update()
    mesh = bpy.data.objects.new("SkinnedRibbon", mesh_data)
    mesh.location = (2.75, 0.4, 0.0)
    mesh.data.materials.append(material("RibbonMaterial", (0.1, 0.95, 0.35)))
    scene.collection.objects.link(mesh)
    mesh.parent = armature

    group = mesh.vertex_groups.new(name=bone_name)
    group.add(list(range(len(mesh_data.vertices))), 1.0, "REPLACE")
    modifier = mesh.modifiers.new("AuthoredRig", "ARMATURE")
    modifier.object = armature

    pose_bone = armature.pose.bones[bone_name]
    pose_bone.rotation_mode = "QUATERNION"
    for frame, angle in zip(KEY_FRAMES, (0.0, math.radians(38.0), math.radians(-24.0))):
        pose_bone.rotation_quaternion = Quaternion((0.0, 1.0, 0.0), angle)
        pose_bone.keyframe_insert(
            "rotation_quaternion", frame=frame, group=bone_name
        )
    armature.animation_data.action.name = "RigMotion"
    set_linear_interpolation(armature.animation_data.action)
    return mesh, armature


def add_presentation(scene: bpy.types.Scene) -> None:
    ground = cube("Ground", (0.0, 0.0, -0.12), 8.0, (0.08, 0.1, 0.15))
    ground.scale.z = 0.025

    key_data = bpy.data.lights.new("KeyLight", "AREA")
    key_data.energy = 900.0
    key_data.shape = "DISK"
    key_data.size = 5.0
    key = bpy.data.objects.new("KeyLight", key_data)
    key.location = (-3.0, -4.0, 7.0)
    scene.collection.objects.link(key)

    fill_data = bpy.data.lights.new("FillLight", "AREA")
    fill_data.energy = 500.0
    fill_data.size = 4.0
    fill_data.color = (0.45, 0.65, 1.0)
    fill = bpy.data.objects.new("FillLight", fill_data)
    fill.location = (5.0, -1.0, 4.0)
    scene.collection.objects.link(fill)

    scene.world = bpy.data.worlds.new("AuthoredWorld")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.025, 0.035, 0.065, 1.0)
    background.inputs["Strength"].default_value = 0.35


def evaluated_points(
    mesh: bpy.types.Object, depsgraph: bpy.types.Depsgraph
) -> list[list[float]]:
    evaluated = mesh.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh(
        preserve_all_data_layers=True, depsgraph=depsgraph
    )
    try:
        return [
            vector(gltf_vector(evaluated.matrix_world @ vertex.co))
            for vertex in evaluated_mesh.vertices
        ]
    finally:
        evaluated.to_mesh_clear()


def camera_reference(camera: bpy.types.Object) -> dict:
    transform = gltf_world_transform(camera.matrix_world)
    forward = camera.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0))
    transform["forward"] = vector(gltf_vector(forward).normalized())
    return transform


def sample(
    scene: bpy.types.Scene,
    objects: dict[str, bpy.types.Object],
    mesh: bpy.types.Object,
) -> list[dict]:
    result = []
    for frame in KEY_FRAMES:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        depsgraph.update()
        constrained = objects["constrained"].evaluated_get(depsgraph)
        driven = objects["driven"].evaluated_get(depsgraph)
        camera = objects["camera"].evaluated_get(depsgraph)
        roughness = (
            objects["driven"]
            .active_material.node_tree.nodes["Principled BSDF"]
            .inputs["Roughness"]
            .default_value
        )
        result.append(
            {
                "frame": frame,
                "timeSeconds": frame / FPS,
                "constrained": gltf_world_transform(constrained.matrix_world),
                "driven": gltf_world_transform(driven.matrix_world),
                "camera": camera_reference(camera),
                "skinnedWorldPoints": evaluated_points(mesh, depsgraph),
                "unsupportedMaterialRoughness": float(roughness),
            }
        )
    return result


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "AuthoredFrameTransport"
    scene.frame_start = KEY_FRAMES[0]
    scene.frame_end = KEY_FRAMES[-1]
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 800
    scene.render.resolution_y = 500
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(REFERENCE_IMAGE_PATH)
    bpy.context.preferences.filepaths.save_version = 0

    objects = create_motion(scene)
    mesh, armature = create_skinned_ribbon(scene)
    add_presentation(scene)
    samples = sample(scene, objects, mesh)

    scene.frame_set(SAVED_FRAME)
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)
    source_hash = sha256(BLEND_PATH)
    bpy.ops.render.render(write_still=True)

    reference = {
        "schemaVersion": 1,
        "classification": "prototype dependency-graph oracle; not production Blendlink behavior",
        "blender": {
            "version": bpy.app.version_string,
            "buildHash": (
                bpy.app.build_hash.decode()
                if isinstance(bpy.app.build_hash, bytes)
                else str(bpy.app.build_hash)
            ),
            "binaryPath": bpy.app.binary_path,
        },
        "gltfExporter": {
            "version": list(io_scene_gltf2.bl_info["version"]),
            "modulePath": str(Path(inspect.getfile(io_scene_gltf2)).resolve()),
        },
        "fixture": {
            "fps": FPS,
            "frameStart": KEY_FRAMES[0],
            "frameEnd": KEY_FRAMES[-1],
            "savedFrame": SAVED_FRAME,
            "objectNames": {
                key: value.name for key, value in objects.items()
            },
            "skinnedMesh": mesh.name,
            "armature": armature.name,
            "bone": "DeformBone",
            "unsupportedDriver": {
                "owner": objects["driven"].active_material.name,
                "path": 'nodes["Principled BSDF"].inputs["Roughness"].default_value',
                "reason": (
                    "core glTF animation has no material-property target; "
                    "KHR_animation_pointer is intentionally disabled"
                ),
            },
        },
        "coordinateContract": {
            "source": "Blender right-handed Z-up",
            "target": "glTF/Three right-handed Y-up",
            "mapping": "[x, y, z] -> [x, z, -y]",
        },
        "samples": samples,
        "artifacts": {
            "blendSha256": source_hash,
            "referenceImageSha256": sha256(REFERENCE_IMAGE_PATH),
        },
    }
    REFERENCE_PATH.write_text(
        json.dumps(reference, indent=2) + "\n", encoding="utf-8"
    )
    if scene.frame_current != SAVED_FRAME:
        raise RuntimeError(
            f"fixture did not preserve saved frame {SAVED_FRAME}: "
            f"{scene.frame_current}"
        )
    print(
        "BLENDLINK_AUTHORED_FRAME_FIXTURE_GENERATED",
        f"savedFrame={scene.frame_current}",
        f"sourceSha256={source_hash}",
        f"gltfExporter={'.'.join(map(str, io_scene_gltf2.bl_info['version']))}",
    )


main()
