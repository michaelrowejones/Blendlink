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


def tap_surface_channel_proxy(material, channel_name="Emission Color"):
    """Private proxy emitting one channel of a mixed surface.

    "Emission Color" handles the single-leaf classes (coerced color,
    Emission leaf) whose radiance is the only non-constant surface
    channel. "Alpha" handles the flat outline class: one Mix Shader with
    exactly one transparent branch over a non-Principled leaf, whose
    alpha fold is clamp01(fac) or 1 - clamp01(fac) -- realized here with
    a single clamped Math node (clamp01(1 - fac) == 1 - clamp01(fac) for
    every real fac). Principled lit branches raise: their leaf Alpha is a
    live socket, not the constant 1 the fold relies on. Other shapes
    raise; the caller tallies them by name.
    """
    copy = material.copy()
    copy.name = f"TSL_SURF_PROXY.{material.name}"
    tree = bakelib.active_shader_node_tree(copy)
    _privatize_groups(tree)
    expression = tsl_ir.resolve_surface(tree)

    if channel_name == "Alpha":
        if expression.get("kind") != "mix":
            raise RuntimeError(
                "surface tap v2: Alpha sampling needs a transparent mix"
            )
        a, b = expression["a"], expression["b"]
        transparent_a = a.get("kind") == "transparent"
        transparent_b = b.get("kind") == "transparent"
        if transparent_a == transparent_b:
            raise RuntimeError(
                "surface tap v2: Alpha needs exactly one transparent branch"
            )
        lit = b if transparent_a else a
        if lit.get("kind") in {"mix", "principled"}:
            raise RuntimeError(
                "surface tap v2: Alpha over a nested or Principled lit "
                "branch has no tap yet"
            )
        fac_socket = expression["fac_socket"]
        if not fac_socket.is_linked:
            raise RuntimeError(
                "surface tap v2: a constant Alpha factor has nothing to "
                "measure"
            )
        source = _thread_tap(
            tree, fac_socket.links[0].from_socket,
            list(expression["fac_stack"]),
        )
        math = tree.nodes.new("ShaderNodeMath")
        math.use_clamp = True
        if transparent_a:
            # fac weights branch b (the lit one): alpha = clamp01(fac).
            math.operation = "ADD"
            math.inputs[1].default_value = 0.0
            tree.links.new(source, math.inputs[0])
        else:
            math.operation = "SUBTRACT"
            math.inputs[0].default_value = 1.0
            tree.links.new(source, math.inputs[1])
        _emission_surface(tree, math.outputs["Value"])
        return copy

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


def _fixture_vertex_colors(proxy, document):
    """Create the document's color attribute on the tile proxy.

    Linear in UV -- (u, v, 0.25), the exact fixture the vertex-color cell
    proves against the TSL side's quad attribute -- so any triangulation
    interpolates it identically. The runtime resolves every layer name to
    the one 'color' geometry attribute, so a document referencing more
    than one DISTINCT layer cannot be represented; it raises and the
    caller records the named skip."""
    layers = sorted({
        str(item.get("layer") or "")
        for item in _walk_ir(document)
        if item.get("op") == "vertex_color"
    })
    if not layers:
        return
    if len(layers) > 1:
        raise RuntimeError(
            f"vertex-color fixture: {len(layers)} distinct layers "
            f"{layers!r} but the TSL side has one color attribute"
        )
    mesh = proxy.data
    layer = mesh.color_attributes.new(
        layers[0] or "Col", "FLOAT_COLOR", "CORNER",
    )
    # An empty layer name means the ACTIVE color attribute (DP-SkyPaint's
    # authoring); creation alone does not make the fixture active, so the
    # bake would silently read something else. Force both actives.
    mesh.color_attributes.active_color = layer
    mesh.color_attributes.active = layer
    source = mesh.uv_layers[0]
    for index, item in enumerate(source.data):
        u, v = item.uv
        layer.data[index].color = (u, v, 0.25, 1.0)


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
        "limits": [
            "surface tap v2 samples radiance, or Alpha when the surface "
            "is a flat transparent mix over a non-Principled leaf (the "
            "outline class); lit-lit mixes, Principled-leaf alphas and "
            "the remaining fold channels stay unsampled by name",
            "vertex-color documents sample against the linear-in-UV tile "
            "fixture the vertex-color cell proves; documents referencing "
            "more than one distinct color layer skip by name",
            "scene bakes hide all other render geometry so ray-traced "
            "nodes (Ambient Occlusion) evaluate the same unoccluded tile "
            "the runtime's declared default carries; real-scene "
            "occlusion stays the declared geometryDependent non-carriage",
        ],
    }
    candidates = []

    def tally_surface(tree):
        """The surface-expression fallback for non-Principled roots:
        emit_surface either compiles all six channels or refuses with
        one named reason for the whole surface.  Returns the surface
        document on success so radiance channels can be sampled."""
        surface = coverage["surface"]
        tsl_ir.drain_approximations()
        try:
            document = tsl_ir.emit_surface(tree)
        except tsl_ir.TslIrRefusal as refusal:
            tsl_ir.drain_approximations()
            reason = str(refusal)
            surface["refusals"][reason] = (
                surface["refusals"].get(reason, 0) + 1
            )
            return None, []
        except RecursionError:
            tsl_ir.drain_approximations()
            reason = "surface emission exceeded the recursion bound"
            surface["refusals"][reason] = (
                surface["refusals"].get(reason, 0) + 1
            )
            return None, []
        # Surface-wide, mirroring material_compiler's per-surface drain:
        # emit_surface emits all six channels in one call, so a sampled
        # chain may inherit an approximation declared by a sibling
        # channel -- a looser gate than strictly needed, never a tighter
        # one, and always reported.
        approximations = tsl_ir.drain_approximations()
        if approximations:
            surface["approximate"] = surface.get("approximate", 0) + 1
        surface["resolved"] += 1
        for channel_document in document["channels"].values():
            surface["channelsCompiled"] += 1
            # Surface-compiled channels ARE compiled channels: they must
            # reach the same top-level figure the principled route feeds,
            # or a scene of stylized materials reads as compiling nothing.
            coverage["irCompiled"] += 1
            if channel_document.get("viewDependent"):
                surface["viewDependent"] += 1
        return document, approximations

    for material in sorted(bpy.data.materials, key=lambda m: m.name):
        tree = bakelib.active_shader_node_tree(material)
        if tree is None:
            continue
        coverage["materials"] += 1
        try:
            root, stack = tsl_ir.find_principled_root(tree)
        except tsl_ir.TslIrRefusal as refusal:
            reason = str(refusal)
            # Tallied once per MATERIAL, not once per channel: the first
            # corpus sweep multiplied this by len(CHANNELS) and splash
            # read '270 refused / 0 compiled' while 84 channels compiled
            # through the surface route below -- an accounting lie that
            # misdirected a whole diagnosis toward a routing hole that
            # did not exist.
            coverage["refusals"][reason] = (
                coverage["refusals"].get(reason, 0) + 1
            )
            if reason == "no root-level single Principled surface":
                surface_document, surface_approximations = (
                    tally_surface(tree)
                )
                if surface_document is not None:
                    def _sampleable(channel_document):
                        # Captured-lighting documents need the light
                        # contract's EEVEE oracle, not a tile emission
                        # bake, exactly like view-dependent ones need a
                        # camera.
                        if channel_document.get("viewDependent"):
                            return False
                        if channel_document.get("lightDependent"):
                            return False
                        encoded = json.dumps(channel_document)
                        # vertex_color counts as varying: it samples the
                        # tile fixture, no longer a dead end.
                        return any(
                            f'"{op}"' in encoded
                            for op in (
                                "uv", "generated", "object_coords",
                                "tex_image", "tex_checker", "tex_gradient",
                                "tex_magic", "tex_wave", "tex_voronoi",
                                "tex_white_noise", "noise", "vertex_color",
                            )
                        )

                    radiance = surface_document["channels"]["Emission Color"]
                    alpha_document = surface_document["channels"]["Alpha"]
                    if '"vertex_color"' in json.dumps(radiance):
                        coverage["irCompiledAttributeDriven"] = (
                            coverage.get("irCompiledAttributeDriven", 0) + 1
                        )
                    # One candidate per surface: radiance when it varies,
                    # else Alpha (the outline class: constant-black
                    # radiance, varying coverage). The tap builder decides
                    # whether the surface's SHAPE is sampleable and raises
                    # a named skip otherwise.
                    if _sampleable(radiance):
                        candidates.append((
                            material.name, "Emission Color", radiance,
                            "surface", surface_approximations,
                        ))
                    elif _sampleable(alpha_document):
                        candidates.append((
                            material.name, "Alpha", alpha_document,
                            "surface", surface_approximations,
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
            tsl_ir.drain_approximations()
            try:
                document = tsl_ir.emit_channel(socket, stack)
            except tsl_ir.TslIrRefusal as refusal:
                tsl_ir.drain_approximations()
                reason = str(refusal)
                coverage["refusals"][reason] = (
                    coverage["refusals"].get(reason, 0) + 1
                )
                continue
            channel_approximations = tsl_ir.drain_approximations()
            if channel_approximations:
                coverage["irCompiledApproximate"] = (
                    coverage.get("irCompiledApproximate", 0) + 1
                )
            coverage["irCompiled"] += 1
            encoded = json.dumps(document)
            if document.get("viewDependent"):
                # Faithfully transportable only by the TSL runtime; the flat
                # tile bake cannot reference a view-dependent field.
                coverage["irCompiledViewDependent"] += 1
                continue
            if document.get("lightDependent"):
                # Captured lighting: the tile emission bake has no light
                # contract; the shader-to-rgb cells own that oracle.
                continue
            if '"vertex_color"' in encoded:
                # Tallied for the scoreboard, but no longer excluded: the
                # bake fixtures the tile proxy with the linear-in-UV
                # attribute the vertex-color cell proves on both sides.
                coverage["irCompiledAttributeDriven"] = (
                    coverage.get("irCompiledAttributeDriven", 0) + 1
                )
            candidates.append((
                material.name, channel_name, document, "principled",
                channel_approximations,
            ))

    manifest = {"schemaVersion": 1, "size": SIZE, "cells": {}}
    for candidate in candidates[:sample_cap]:
        material_name, channel_name, document, kind = candidate[:4]
        candidate_approximations = (
            list(candidate[4]) if len(candidate) > 4 else []
        )
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
        # Geometry isolation snapshot: the bake must see ONLY the tile,
        # or ray-traced nodes (Ambient Occlusion) measure the opened
        # scene's real occlusion while the runtime carries the declared
        # unoccluded default -- the tile-domain oracle is about the
        # material field, never scene ray effects.
        saved_visibility = [
            (obj, obj.hide_render) for obj in bpy.context.scene.objects
        ]
        try:
            proxy_material = (
                tap_surface_channel_proxy(material, channel_name)
                if kind == "surface"
                else tap_channel_proxy(material, channel_name)
            )
            proxy = bakelib.uv_tile_proxy(
                uv_names, window=(0.0, 0.0, 1.0, 1.0),
            )
            _fixture_vertex_colors(proxy, document)
            # The reference bakes on THIS proxy, so attribute-driven
            # channels must fixture the proxy's values for the TSL side:
            # a custom property the proxy lacks bakes as zero (fixture
            # [0,0,0] -- a valid formula check, weaker than real values),
            # and Object Info Random is the hash of the PROXY's name,
            # computed with the production helper so the scene stage
            # inherits the objectinfo-random cell's gate.
            cell_object_attributes = {}
            for item in _walk_ir(document):
                if item.get("op") != "attribute_object":
                    continue
                attribute_name = str(item.get("name") or "")
                if not attribute_name:
                    continue
                if attribute_name == tsl_ir.OBJECT_RANDOM_PROPERTY:
                    value = tsl_ir.object_random_number(proxy.name)
                    cell_object_attributes[attribute_name] = [
                        value, value, value,
                    ]
                    continue
                raw = proxy.get(attribute_name)
                if raw is None:
                    cell_object_attributes[attribute_name] = [0.0, 0.0, 0.0]
                elif hasattr(raw, "__len__"):
                    values = [float(v) for v in raw][:3]
                    while len(values) < 3:
                        values.append(0.0)
                    cell_object_attributes[attribute_name] = values
                else:
                    cell_object_attributes[attribute_name] = [
                        float(raw), float(raw), float(raw),
                    ]
            proxy.data.materials.append(proxy_material)
            for scene_object in bpy.context.scene.objects:
                if scene_object is not proxy:
                    scene_object.hide_render = True
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
            for scene_object, hidden in saved_visibility:
                scene_object.hide_render = hidden
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
            **(
                {"objectAttributes": cell_object_attributes}
                if cell_object_attributes else {}
            ),
            **(
                {"approximations": candidate_approximations}
                if candidate_approximations else {}
            ),
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
