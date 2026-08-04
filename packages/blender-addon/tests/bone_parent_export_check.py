# SPDX-License-Identifier: GPL-3.0-or-later
"""Objects parented to bones survive the deform-only joint contract, or say so.

Blendlink exports deforming joints only, because a control rig's mechanism
bones produce a skin whose matrix buffer no web backend can bind. Blender's
exporter keeps a non-deform BONE that parents an object, but it gathers the
OBJECT only when that bone resolves to a joint reachable from the
deform-filtered root set - so an object parented to a control bone with no
deforming ancestor is dropped together with its whole subtree, with no log
line. On a rig that is exactly where sockets, hotspots and props live.

This suite measures the mechanism rather than trusting a source reading:

  1. the drop reproduces on the stock exporter with the flag Blendlink sets;
  2. enabling Deform on the parent bone is sufficient to publish the object;
  3. doing so is joint-set neutral - byte-identical joints, inverse bind
     matrices, and skin weights - which is what makes it safe to do for the
     artist rather than only to refuse;
  4. the audit refuses by name, with the artist remedy, when it happens.

Run headless:
    blender --background --factory-startup --python-exit-code 1 \
        --python packages/blender-addon/tests/bone_parent_export_check.py
"""
from __future__ import annotations

import importlib.util
import json
import struct
import sys
import tempfile
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
EXPORTER_PATH = ADDON_DIR.parent / "blendlink" / "blender" / "export_scene.py"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def load_exporter():
    spec = importlib.util.spec_from_file_location(
        "blendlink_bone_parent_exporter", EXPORTER_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def read_glb(path):
    raw = Path(path).read_bytes()
    expect(raw[:4] == b"glTF", "GLB magic missing")
    json_length = struct.unpack_from("<I", raw, 12)[0]
    document = json.loads(raw[20:20 + json_length])
    binary = raw[20 + json_length:]
    expect(binary[4:8] == b"BIN\x00", "GLB binary chunk missing")
    return document, binary[8:]


def accessor_bytes(document, binary, index):
    accessor = document["accessors"][index]
    view = document["bufferViews"][accessor["bufferView"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return bytes(binary[start:start + view["byteLength"]])


def build_rig():
    """One deforming bone, one control bone, a weighted mesh, a bone-parented empty."""
    armature_data = bpy.data.armatures.new("RIG-Jaw")
    rig = bpy.data.objects.new("RIG-Jaw", armature_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    deform = armature_data.edit_bones.new("DEF-Jaw")
    deform.head = (0.0, 0.0, 0.0)
    deform.tail = (0.0, 0.0, 1.0)
    control = armature_data.edit_bones.new("CTRL-Jaw")
    control.head = (1.0, 0.0, 0.0)
    control.tail = (1.0, 0.0, 1.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    armature_data.bones["CTRL-Jaw"].use_deform = False

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.5))
    mesh = bpy.context.active_object
    mesh.name = "GEO-jaw"
    group = mesh.vertex_groups.new(name="DEF-Jaw")
    group.add(range(len(mesh.data.vertices)), 1.0, "REPLACE")
    modifier = mesh.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = rig
    mesh.parent = rig

    anchor = bpy.data.objects.new("SOCKET-jaw_prop", None)
    bpy.context.scene.collection.objects.link(anchor)
    anchor.parent = rig
    anchor.parent_type = "BONE"
    anchor.parent_bone = "CTRL-Jaw"
    return rig, mesh, anchor


def export(exporter, path):
    kwargs, _dropped = exporter.gltf_export_contract(str(path), {})
    result = bpy.ops.export_scene.gltf(**kwargs)
    expect("FINISHED" in result, f"stock export failed: {result}")
    return read_glb(path)


def node_names(document):
    return {
        node.get("name") for node in document.get("nodes", [])
        if isinstance(node.get("name"), str)
    }


def skin_evidence(document, binary):
    skin = document["skins"][0]
    joints = tuple(
        document["nodes"][index].get("name") for index in skin["joints"]
    )
    matrices = accessor_bytes(document, binary, skin["inverseBindMatrices"])
    weights = []
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            attributes = primitive.get("attributes", {})
            for name in ("JOINTS_0", "WEIGHTS_0"):
                if name in attributes:
                    weights.append(
                        accessor_bytes(document, binary, attributes[name]),
                    )
    return joints, matrices, tuple(weights)


def main():
    exporter = load_exporter()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig, mesh, anchor = build_rig()
    scene = bpy.context.scene
    view_layer = bpy.context.view_layer

    with tempfile.TemporaryDirectory(prefix="blendlink-bone-parent-") as tmp:
        # 1. The drop reproduces. If a future Blender fixes this upstream,
        #    this assertion fails loudly and the audit can be retired rather
        #    than kept forever out of superstition.
        dropped_document, dropped_binary = export(
            exporter, Path(tmp) / "dropped.glb",
        )
        names = node_names(dropped_document)
        expect(
            anchor.name not in names,
            "Blender's exporter no longer drops an object parented to a "
            "non-deforming bone; re-check whether this contract is still needed",
        )
        expect(mesh.name in names, f"the weighted mesh must still export: {names}")

        # 4. The audit refuses that exact loss, by name, with the remedy.
        try:
            exporter.bone_parented_export_audit(
                scene, names, view_layer=view_layer, export_kwargs=None,
            )
        except RuntimeError as error:
            refusal = str(error)
        else:
            raise AssertionError(
                "the audit accepted a GLB that silently dropped a bone-parented object"
            )
        for fragment in (anchor.name, "CTRL-Jaw", rig.name, "Enable Deform"):
            expect(
                fragment in refusal,
                f"the refusal must name {fragment!r}: {refusal}",
            )

        # 2 + 3. Promotion is sufficient AND joint-set neutral. The neutrality
        #        measurement is the whole reason this can be offered as a fix
        #        rather than only as a refusal: the bone is already a joint
        #        (the exporter retains a non-deform bone that parents an
        #        object), so use_deform only decides whether the object is
        #        gathered.
        bpy.data.armatures["RIG-Jaw"].bones["CTRL-Jaw"].use_deform = True
        promoted_document, promoted_binary = export(
            exporter, Path(tmp) / "promoted.glb",
        )
        promoted_names = node_names(promoted_document)
        expect(
            anchor.name in promoted_names,
            f"enabling Deform must publish the bone-parented object: {promoted_names}",
        )
        exporter.bone_parented_export_audit(
            scene, promoted_names, view_layer=view_layer, export_kwargs=None,
        )

        before = skin_evidence(dropped_document, dropped_binary)
        after = skin_evidence(promoted_document, promoted_binary)
        expect(
            before[0] == after[0],
            f"promotion changed the joint list: {before[0]} -> {after[0]}",
        )
        expect(
            before[1] == after[1],
            "promotion changed the inverse bind matrices",
        )
        expect(
            before[2] == after[2],
            "promotion changed skin weights or joint indices",
        )
        bpy.data.armatures["RIG-Jaw"].bones["CTRL-Jaw"].use_deform = False

        # The production path promotes for the duration of the export, so the
        # object publishes and the artist's rig is restored exactly.
        expect(
            bpy.data.armatures["RIG-Jaw"].bones["CTRL-Jaw"].use_deform is False,
            "the fixture must start from a non-deforming control bone",
        )
        reported = []
        with exporter.promoted_bone_parents(
            scene, view_layer=view_layer, export_kwargs=None,
            log=reported.append,
        ):
            expect(
                bpy.data.armatures["RIG-Jaw"].bones["CTRL-Jaw"].use_deform is True,
                "promotion must enable Deform for the duration of the export",
            )
            promoted_names = node_names(
                export(exporter, Path(tmp) / "auto-promoted.glb")[0],
            )
        expect(
            bpy.data.armatures["RIG-Jaw"].bones["CTRL-Jaw"].use_deform is False,
            "promotion must restore the artist's rig exactly",
        )
        expect(
            anchor.name in promoted_names,
            f"the promoted export must publish the anchor: {promoted_names}",
        )
        expect(
            reported and anchor.name in reported[0] and "CTRL-Jaw" in reported[0],
            f"the promotion must be reported, never silent: {reported}",
        )

        # A failing export must still restore, because scene_state_transaction
        # releases on the way out however the body ends.
        class Boom(RuntimeError):
            pass

        try:
            with exporter.promoted_bone_parents(
                scene, view_layer=view_layer, export_kwargs=None,
                log=lambda _message: None,
            ):
                raise Boom("export failed")
        except Boom:
            pass
        expect(
            bpy.data.armatures["RIG-Jaw"].bones["CTRL-Jaw"].use_deform is False,
            "a failing export must still restore the rig",
        )

        # The audit stays quiet about ordinary objects: an object parented to
        # the armature OBJECT rather than to a bone is never at risk.
        anchor.parent_type = "OBJECT"
        object_parented_document, _ = export(
            exporter, Path(tmp) / "object-parented.glb",
        )
        exporter.bone_parented_export_audit(
            scene, node_names(object_parented_document),
            view_layer=view_layer, export_kwargs=None,
        )
        anchor.parent_type = "BONE"

    # The owned exporter contract refuses an override of either half, because
    # Blender silently disables deform-only export when sampling is off.
    for key in ("export_def_bones", "export_force_sampling"):
        try:
            exporter.gltf_export_contract("out.glb", {
                "exporterOverrides": {key: False},
            })
        except ValueError as error:
            expect(
                "joint-budget contract" in str(error) and key in str(error),
                f"the {key} refusal must name the contract: {error}",
            )
        else:
            raise AssertionError(
                f"exporterOverrides silently replaced Blendlink's {key} contract"
            )

    # The joint-budget preflight reads the shared registry, not a local number.
    budget_issues = exporter.skin_joint_budget_issues([mesh])
    expect(
        budget_issues == [],
        f"a two-bone rig must not report a joint-budget issue: {budget_issues}",
    )

    print("BLENDLINK_BONE_PARENT_EXPORT_CHECK_PASSED")


main()
