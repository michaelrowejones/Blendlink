# SPDX-License-Identifier: GPL-3.0-or-later
"""MTLX-TSL-001 scene stage: the compiler against real corpus materials.

Opens one corpus .blend read-only (never saved, autoexec disabled by the
CLI flag), attempts IR emission for every Principled channel of every
node-tree material — including group-wrapped Principled surfaces via
``tsl_ir.find_principled_root`` — and, for a bounded sample of compiled
channels, bakes the 0..1 reference tile and writes the IR so the browser
side can render and diff the real authored graph. Every compiled channel
is UV/constant-driven by construction (the emitter refuses every other
coordinate space), so the flat tile is a valid domain. Coverage refusals
are tallied by reason: they are the compiler's honest to-do list.

Sampling a group-fed channel taps it through PRIVATE copies of each group
tree along the instance path — shared group trees are never mutated.

Invoked per scene by run.mjs:
    blender --background --factory-startup --disable-autoexec \
        --python-exit-code 1 --python scene_coverage.py -- \
        <scene.blend> <sceneId> <outputDir> <sampleCap>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "packages" / "blendlink" / "blender"))
sys.path.insert(0, str(REPO / "packages" / "blender-addon"))

import bakelib  # noqa: E402
import procedural  # noqa: E402
import tsl_ir  # noqa: E402

SIZE = 64
CHANNELS = (
    "Base Color", "Metallic", "Roughness", "Alpha",
    "Emission Color", "Emission Strength",
)


def parse_args():
    marker = sys.argv.index("--")
    scene_path, scene_id, output_dir, sample_cap = sys.argv[marker + 1:marker + 5]
    return Path(scene_path), scene_id, Path(output_dir), int(sample_cap)


def _active_group_output(tree):
    return next(
        (item for item in tree.nodes
         if item.type == "GROUP_OUTPUT"
         and getattr(item, "is_active_output", True)),
        None,
    )


def _thread_tap(tree, inner_socket, private_stack):
    """Thread a socket's value out through privatized group levels via a
    ``TSL_TAP`` output per level; returns the root-level socket."""
    for instance in reversed(private_stack):
        inner_tree = instance.node_tree
        inner_tree.interface.new_socket(
            "TSL_TAP", in_out="OUTPUT", socket_type="NodeSocketColor",
        )
        group_output = _active_group_output(inner_tree)
        if group_output is None:
            group_output = inner_tree.nodes.new("NodeGroupOutput")
        tap_input = group_output.inputs.get("TSL_TAP")
        if tap_input is None:
            raise RuntimeError("group output did not gain the tap socket")
        inner_tree.links.new(inner_socket, tap_input)
        tap_output = instance.outputs.get("TSL_TAP")
        if tap_output is None:
            raise RuntimeError("group instance did not expose the tap")
        inner_socket = tap_output
    return inner_socket


def _emission_surface(tree, source_socket):
    """Replace every Material Output with a fresh Emission surface fed by
    the tapped socket."""
    for output in [
        item for item in tree.nodes
        if item.bl_idname == "ShaderNodeOutputMaterial"
    ]:
        tree.nodes.remove(output)
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    if hasattr(output, "is_active_output"):
        output.is_active_output = True
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(source_socket, emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])


def tap_channel_proxy(material, channel_name):
    """Private material copy whose surface emits one channel's value.

    For a root-level Principled the channel source rewires straight into a
    fresh Emission surface.  For a group-wrapped Principled, every group
    tree along the instance path is replaced by a private copy (shared
    trees are never touched) and a ``TSL_TAP`` output threads the channel's
    value out to the root, where the Emission consumes it.
    """
    copy = material.copy()
    copy.name = f"TSL_SCENE_PROXY.{material.name}.{channel_name}"
    tree = bakelib.active_shader_node_tree(copy)
    root, stack = tsl_ir.find_principled_root(tree)

    # Privatize each group tree along the path, re-resolving the chain as
    # each level is copied (the next instance node lives inside the copy).
    current_tree = tree
    private_stack = []
    for instance in stack:
        located = next(
            (node for node in current_tree.nodes
             if node.bl_idname == "ShaderNodeGroup"
             and node.name == instance.name),
            None,
        )
        if located is None:
            raise RuntimeError(
                f"instance {instance.name!r} disappeared in the proxy copy"
            )
        located.node_tree = located.node_tree.copy()
        private_stack.append(located)
        current_tree = located.node_tree
    root = next(
        node for node in current_tree.nodes
        if node.bl_idname == "ShaderNodeBsdfPrincipled"
    )
    socket = procedural._node_input(root, channel_name)
    if socket is None or not socket.is_linked:
        raise RuntimeError("proxy channel is not linked")
    source_socket = _thread_tap(
        tree, socket.links[0].from_socket, private_stack,
    )
    _emission_surface(tree, source_socket)
    return copy


def _privatize_groups(tree):
    """Give every reachable group instance its own private tree copy so
    any mutation of the proxy can never touch shared group trees."""
    for node in tree.nodes:
        nested = getattr(node, "node_tree", None)
        if node.bl_idname == "ShaderNodeGroup" and nested is not None:
            node.node_tree = nested.copy()
            _privatize_groups(node.node_tree)


def tap_surface_channel_proxy(material):
    """Private proxy emitting a mixed surface's RADIANCE channel.

    Handles the single-leaf classes (coerced color, Emission leaf) whose
    Emission Color document is the only non-constant surface channel —
    the dominant resolved population (the splash outline/paint class).
    Multi-leaf mixes raise; the caller tallies them by name.
    """
    copy = material.copy()
    copy.name = f"TSL_SURF_PROXY.{material.name}"
    tree = bakelib.active_shader_node_tree(copy)
    _privatize_groups(tree)
    expression = tsl_ir.resolve_surface(tree)

    def radiance_source(expr):
        kind = expr.get("kind")
        if kind == "coerced_color":
            return expr["socket"], list(expr["stack"])
        if kind == "emission":
            node = expr["node"]
            strength = node.inputs["Strength"]
            if strength.is_linked or abs(
                float(strength.default_value) - 1.0
            ) > 1e-9:
                raise RuntimeError(
                    "surface tap v1 requires Emission strength 1"
                )
            color_socket = node.inputs["Color"]
            if not color_socket.is_linked:
                raise RuntimeError(
                    "surface tap needs a linked Emission color"
                )
            return color_socket.links[0].from_socket, list(expr["stack"])
        if kind == "mix":
            # Transparent branches contribute only coverage: the radiance
            # document IS the visible branch unchanged, so the tap
            # recurses to it (the splash color-over-transparent class,
            # nested or flat).
            a, b = expr["a"], expr["b"]
            if b.get("kind") == "transparent":
                return radiance_source(a)
            if a.get("kind") == "transparent":
                return radiance_source(b)
            raise RuntimeError(
                "surface tap v1: a lit-lit mix radiance needs a "
                "projection graph"
            )
        raise RuntimeError(
            f"surface tap v1 has no radiance source for {kind!r}"
        )

    source_socket, stack = radiance_source(expression)
    source_socket = _thread_tap(tree, source_socket, stack)
    _emission_surface(tree, source_socket)
    return copy


def remove_proxy(material):
    if material is None:
        return
    tree = bakelib.active_shader_node_tree(material)
    private_trees = []
    if tree is not None:
        stack = [tree]
        seen = set()
        while stack:
            current = stack.pop()
            if current.as_pointer() in seen:
                continue
            seen.add(current.as_pointer())
            for node in current.nodes:
                nested = getattr(node, "node_tree", None)
                if nested is not None and nested.users <= 1:
                    private_trees.append(nested)
                    stack.append(nested)
    if bpy.data.materials.get(material.name) is material:
        bpy.data.materials.remove(material, do_unlink=True)
    for private in private_trees:
        if private.name in bpy.data.node_groups and private.users == 0:
            bpy.data.node_groups.remove(private)


def _walk_ir(expression):
    if isinstance(expression, dict):
        yield expression
        for value in expression.values():
            yield from _walk_ir(value)
    elif isinstance(expression, list):
        for item in expression:
            yield from _walk_ir(item)


def main():
    import numpy as np

    scene_path, scene_id, output_dir, sample_cap = parse_args()
    if not scene_path.is_file():
        print(f"TSL_SCENE_SKIPPED {scene_id} missing {scene_path}")
        return
    bpy.ops.wm.open_mainfile(filepath=str(scene_path), load_ui=False)
    # Opened production files can sit in Edit/Pose mode, which fails the
    # bake operator's selection polling.
    if bpy.context.mode != "OBJECT":
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except RuntimeError as error:
            print(f"scene {scene_id}: could not enter object mode: {error}")

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "ir").mkdir(exist_ok=True)

    coverage = {
        "sceneId": scene_id,
        "materials": 0,
        "principledRoots": 0,
        "groupWrappedRoots": 0,
        "channels": {"linked": 0, "constant": 0},
        "irCompiled": 0,
        "irCompiledViewDependent": 0,
        "refusals": {},
        "surface": {
            "resolved": 0,
            "channelsCompiled": 0,
            "viewDependent": 0,
            "refusals": {},
        },
        "sampled": [],
    }
    candidates = []

    def tally_surface(tree):
        """The surface-expression fallback for non-Principled roots:
        emit_surface either compiles all six channels or refuses with
        one named reason for the whole surface.  Returns the surface
        document on success so radiance channels can be sampled."""
        surface = coverage["surface"]
        try:
            document = tsl_ir.emit_surface(tree)
        except tsl_ir.TslIrRefusal as refusal:
            reason = str(refusal)
            surface["refusals"][reason] = (
                surface["refusals"].get(reason, 0) + 1
            )
            return None
        except RecursionError:
            reason = "surface emission exceeded the recursion bound"
            surface["refusals"][reason] = (
                surface["refusals"].get(reason, 0) + 1
            )
            return None
        surface["resolved"] += 1
        for channel_document in document["channels"].values():
            surface["channelsCompiled"] += 1
            if channel_document.get("viewDependent"):
                surface["viewDependent"] += 1
        return document

    for material in sorted(bpy.data.materials, key=lambda m: m.name):
        tree = bakelib.active_shader_node_tree(material)
        if tree is None:
            continue
        coverage["materials"] += 1
        try:
            root, stack = tsl_ir.find_principled_root(tree)
        except tsl_ir.TslIrRefusal as refusal:
            reason = str(refusal)
            coverage["refusals"][reason] = (
                coverage["refusals"].get(reason, 0) + len(CHANNELS)
            )
            if reason == "no root-level single Principled surface":
                surface_document = tally_surface(tree)
                if surface_document is not None:
                    # The radiance channel is the one worth diffing on
                    # single-leaf surfaces (every other channel of that
                    # class is constant); the tap builder decides whether
                    # this surface's shape is sampleable.
                    radiance = surface_document["channels"]["Emission Color"]
                    encoded_radiance = json.dumps(radiance)
                    if radiance.get("viewDependent"):
                        pass
                    elif '"vertex_color"' in encoded_radiance:
                        coverage["irCompiledAttributeDriven"] = (
                            coverage.get("irCompiledAttributeDriven", 0) + 1
                        )
                    elif radiance.get("output", {}).get("op") not in {
                        "const_vec3", "const_float",
                    }:
                        candidates.append((
                            material.name, "Emission Color", radiance,
                            "surface",
                        ))
            continue
        coverage["principledRoots"] += 1
        if stack:
            coverage["groupWrappedRoots"] += 1
        for channel_name in CHANNELS:
            socket = procedural._node_input(root, channel_name)
            if socket is None:
                continue
            if not socket.is_linked:
                coverage["channels"]["constant"] += 1
                continue
            coverage["channels"]["linked"] += 1
            try:
                document = tsl_ir.emit_channel(socket, stack)
            except tsl_ir.TslIrRefusal as refusal:
                reason = str(refusal)
                coverage["refusals"][reason] = (
                    coverage["refusals"].get(reason, 0) + 1
                )
                continue
            coverage["irCompiled"] += 1
            encoded = json.dumps(document)
            if document.get("viewDependent"):
                # Faithfully transportable only by the TSL runtime; the flat
                # tile bake cannot reference a view-dependent field.
                coverage["irCompiledViewDependent"] += 1
                continue
            if '"vertex_color"' in encoded:
                # Mesh-attribute data has no tile-domain representation; the
                # vertex-color cell proves the formula against controlled
                # attributes on both sides.
                coverage["irCompiledAttributeDriven"] = (
                    coverage.get("irCompiledAttributeDriven", 0) + 1
                )
                continue
            candidates.append((
                material.name, channel_name, document, "principled",
            ))

    manifest = {"schemaVersion": 1, "size": SIZE, "cells": {}}
    for material_name, channel_name, document, kind in candidates[:sample_cap]:
        cell_id = f"{material_name}--{channel_name}".replace(" ", "_")
        if kind == "surface":
            cell_id += ".surface"
        material = bpy.data.materials[material_name]
        proxy_material = None
        proxy = None
        # Named UV maps referenced by the graph exist on the tile proxy as
        # identity layers, so the reference samples them instead of a
        # missing-layer zero fallback; on the identity tile they coincide
        # with the uv(0) the TSL side samples.
        uv_names = sorted({
            item.get("uvMap")
            for item in _walk_ir(document)
            if item.get("op") == "uv" and item.get("uvMap")
        })
        try:
            proxy_material = (
                tap_surface_channel_proxy(material)
                if kind == "surface"
                else tap_channel_proxy(material, channel_name)
            )
            proxy = bakelib.uv_tile_proxy(
                uv_names, window=(0.0, 0.0, 1.0, 1.0),
            )
            proxy.data.materials.append(proxy_material)
            result = bakelib.bake_channel_field_pixels(
                [proxy], size=SIZE, margin_px=0,
                uv_layer="BLENDLINK_TILE_BAKE",
                label=f"scene {scene_id} {cell_id}",
                allow_hdr=True,
            )
        except RuntimeError as error:
            coverage["sampled"].append({
                "cell": cell_id, "status": "reference-skipped",
                "reason": str(error)[:300],
            })
            continue
        finally:
            if proxy is not None:
                bakelib.remove_uv_tile_proxy(proxy)
            remove_proxy(proxy_material)
        pixels = np.asarray(result["pixels"], dtype=np.float32)
        pixels.tofile(output_dir / f"{cell_id}.f32")
        (output_dir / "ir" / f"{cell_id}.json").write_text(
            json.dumps(document, indent=2) + "\n", encoding="utf8",
        )
        manifest["cells"][cell_id] = {
            "path": f"{cell_id}.f32",
            "material": material_name,
            "channel": channel_name,
            "kind": kind,
            "rgbMin": list(result["rgbMin"]),
            "rgbMax": list(result["rgbMax"]),
        }
        coverage["sampled"].append({"cell": cell_id, "status": "baked"})
        print(f"scene {scene_id}: baked {cell_id}")

    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf8",
    )
    (output_dir / "coverage.json").write_text(
        json.dumps(coverage, indent=2) + "\n", encoding="utf8",
    )
    print(f"TSL_SCENE_COVERAGE_DONE {scene_id}")


if __name__ == "__main__":
    main()
