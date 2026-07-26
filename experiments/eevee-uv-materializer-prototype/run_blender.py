# SPDX-License-Identifier: MIT
"""PROTOTYPE ONLY — generate and measure an EEVEE-rendered UV canvas.

Question: is the UV-canvas mechanism deterministic and close to Blender's
Cycles emission bake for data both engines can represent, while also capturing
an EEVEE-only Shader to RGB material? This script is deliberately a single-use
fixture generator, not production bake code.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUTPUT = HERE / "output"
OUTPUT.mkdir(exist_ok=True)
sys.path.insert(0, str(ROOT / "packages" / "blendlink" / "blender"))
import bakelib  # noqa: E402 — production color/save contract, never copied here

SIZE = 256


def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.materials, bpy.data.meshes, bpy.data.cameras,
                       bpy.data.lights, bpy.data.node_groups, bpy.data.images):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def make_source_mesh():
    mesh = bpy.data.meshes.new("PROTOTYPE_SourceMesh")
    # Two differently oriented quads with separate atlas islands.
    vertices = [
        (-1.0, -0.7, 0.0), (-0.1, -0.7, 0.0), (-0.1, 0.7, 0.25), (-1.0, 0.7, 0.25),
        (0.2, -0.7, -0.2), (1.0, -0.7, 0.2), (1.0, 0.7, 0.2), (0.2, 0.7, -0.2),
    ]
    faces = [(0, 1, 2, 3), (4, 5, 6, 7)]
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("PROTOTYPE_MaterialTarget", mesh)
    bpy.context.scene.collection.objects.link(obj)

    uvs = {
        0: (0.06, 0.08), 1: (0.46, 0.08), 2: (0.46, 0.92), 3: (0.06, 0.92),
        4: (0.54, 0.08), 5: (0.94, 0.08), 6: (0.94, 0.92), 7: (0.54, 0.92),
    }
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = uvs[vertex_index]
    for edge in mesh.edges:
        edge.use_seam = True
    return obj


def make_uv_canvas_nodes(obj):
    group = bpy.data.node_groups.new("PROTOTYPE_UVCanvas", "GeometryNodeTree")
    group.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nodes = group.nodes
    links = group.links
    source = nodes.new("NodeGroupInput")
    sink = nodes.new("NodeGroupOutput")
    seam = nodes.new("GeometryNodeInputNamedAttribute")
    seam.data_type = "BOOLEAN"
    seam.inputs["Name"].default_value = "uv_seam"
    uv = nodes.new("GeometryNodeInputNamedAttribute")
    uv.data_type = "FLOAT_VECTOR"
    uv.inputs["Name"].default_value = "UVMap"
    split = nodes.new("GeometryNodeSplitEdges")
    set_position = nodes.new("GeometryNodeSetPosition")
    links.new(source.outputs["Geometry"], split.inputs["Mesh"])
    links.new(seam.outputs["Attribute"], split.inputs["Selection"])
    links.new(split.outputs["Mesh"], set_position.inputs["Geometry"])
    links.new(uv.outputs["Attribute"], set_position.inputs["Position"])
    links.new(set_position.outputs["Geometry"], sink.inputs["Geometry"])
    modifier = obj.modifiers.new("PROTOTYPE_UVCanvas", "NODES")
    modifier.node_group = group
    return modifier


def make_data_material():
    material = bpy.data.materials.new("PROTOTYPE_PortableData")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    coords = nodes.new("ShaderNodeTexCoord")
    checker = nodes.new("ShaderNodeTexChecker")
    checker.inputs["Color1"].default_value = (0.02, 0.16, 0.8, 1.0)
    checker.inputs["Color2"].default_value = (0.95, 0.22, 0.04, 1.0)
    checker.inputs["Scale"].default_value = 9.0
    separate = nodes.new("ShaderNodeSeparateXYZ")
    mix = nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 0.38
    mix.inputs[2].default_value = (0.3, 1.0, 0.55, 1.0)
    links.new(coords.outputs["UV"], checker.inputs["Vector"])
    links.new(coords.outputs["UV"], separate.inputs["Vector"])
    links.new(checker.outputs["Color"], mix.inputs[1])
    links.new(separate.outputs["X"], mix.inputs[0])
    links.new(mix.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def make_shader_to_rgb_material():
    material = bpy.data.materials.new("PROTOTYPE_EEVEE_ShaderToRGB")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    diffuse = nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (0.08, 0.35, 0.95, 1.0)
    shader_rgb = nodes.new("ShaderNodeShaderToRGB")
    rgb_to_bw = nodes.new("ShaderNodeRGBToBW")
    coords = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    modulate = nodes.new("ShaderNodeMath")
    modulate.operation = "MULTIPLY"
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].position = 0.32
    ramp.color_ramp.elements[0].color = (0.015, 0.025, 0.08, 1.0)
    ramp.color_ramp.elements[1].position = 0.58
    ramp.color_ramp.elements[1].color = (0.5, 0.85, 1.0, 1.0)
    links.new(diffuse.outputs["BSDF"], shader_rgb.inputs["Shader"])
    links.new(shader_rgb.outputs["Color"], rgb_to_bw.inputs["Color"])
    links.new(coords.outputs["UV"], separate.inputs["Vector"])
    links.new(rgb_to_bw.outputs["Val"], modulate.inputs[0])
    links.new(separate.outputs["X"], modulate.inputs[1])
    links.new(modulate.outputs["Value"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def configure_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.dither_intensity = 0.0
    scene.render.image_settings.color_mode = "RGBA"
    bakelib.force_color_management(scene)

    camera_data = bpy.data.cameras.new("PROTOTYPE_UVCamera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 1.0
    camera = bpy.data.objects.new("PROTOTYPE_UVCamera", camera_data)
    camera.location = (0.5, 0.5, 2.0)
    scene.collection.objects.link(camera)
    scene.camera = camera

    light_data = bpy.data.lights.new("PROTOTYPE_Key", "AREA")
    light_data.energy = 80.0
    light_data.shape = "DISK"
    light_data.size = 0.35
    light = bpy.data.objects.new("PROTOTYPE_Key", light_data)
    light.location = (0.18, 0.2, 1.1)
    scene.collection.objects.link(light)
    return scene


def pixels(image):
    values = list(image.pixels[:])
    print(f"PROTOTYPE_IMAGE {image.name} size={tuple(image.size)} pixels={len(values)}")
    return values


def coverage(values):
    alphas = values[3::4]
    return sum(1 for alpha in alphas if alpha > 0.99) / len(alphas)


def render_eevee(scene, obj, material, path):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.filepath = str(path)
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    elapsed = time.perf_counter() - started
    # Blender 5.2 background renders write the file correctly but expose a
    # zero-sized Render Result datablock after write_still. Reloading the saved
    # PNG gives us the exact bytes the web pipeline would consume.
    rendered = bpy.data.images.load(str(path), check_existing=False)
    values = pixels(rendered)
    return elapsed, values


def bake_cycles(scene, obj, modifier, material, path):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    target = bpy.data.images.new("PROTOTYPE_CyclesEmission", width=SIZE, height=SIZE,
                                 alpha=True, float_buffer=True)
    target.generated_color = (0.0, 0.0, 0.0, 0.0)
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    node.name = "PROTOTYPE_BakeTarget"
    node.image = target
    material.node_tree.nodes.active = node
    node.select = True
    modifier.show_render = False
    modifier.show_viewport = False
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    started = time.perf_counter()
    bpy.ops.object.bake(type="EMIT", margin=0, use_clear=True)
    elapsed = time.perf_counter() - started
    bakelib.save_dithered(target, str(path))
    # Compare the saved web-facing bytes to the saved EEVEE bytes. Comparing a
    # float bake buffer to a display-encoded PNG would measure formats, not the
    # materializer.
    saved = bpy.data.images.load(str(path), check_existing=False)
    values = pixels(saved)
    modifier.show_render = True
    modifier.show_viewport = True
    material.node_tree.nodes.remove(node)
    return elapsed, values


def interior_rmse(a, b, border=3):
    total = 0.0
    count = 0
    for y in range(SIZE):
        for x in range(SIZE):
            index = (y * SIZE + x) * 4
            if a[index + 3] < 0.99 or b[index + 3] < 0.99:
                continue
            # Ignore raster/bake edge pixels; they are a later margin experiment.
            neighborhood_ok = True
            for oy in (-border, border):
                for ox in (-border, border):
                    nx, ny = x + ox, y + oy
                    if nx < 0 or nx >= SIZE or ny < 0 or ny >= SIZE:
                        neighborhood_ok = False
                    elif a[(ny * SIZE + nx) * 4 + 3] < 0.99 or b[(ny * SIZE + nx) * 4 + 3] < 0.99:
                        neighborhood_ok = False
            if not neighborhood_ok:
                continue
            for channel in range(3):
                delta = a[index + channel] - b[index + channel]
                total += delta * delta
                count += 1
    return math.sqrt(total / count) if count else 1.0, count


def full_rmse(a, b):
    if len(a) != len(b) or not a:
        return 1.0
    return math.sqrt(sum((left - right) ** 2 for left, right in zip(a, b)) / len(a))


def flat_region_rmse(a, b):
    """Compare stable material interiors, excluding checker transitions.

    EEVEE rasterization antialiases procedural boundaries while Cycles' bake
    sampler resolves them differently. That is a real edge/padding question,
    but it should not masquerade as a color-transform error in flat regions.
    """
    total = 0.0
    count = 0
    for y in range(4, SIZE - 4):
        for x in range(4, SIZE - 4):
            index = (y * SIZE + x) * 4
            if a[index + 3] < 0.99:
                continue
            stable = True
            for values in (a, b):
                for ox, oy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    neighbor = ((y + oy) * SIZE + x + ox) * 4
                    if any(abs(values[index + channel] - values[neighbor + channel]) > 0.015
                           for channel in range(3)):
                        stable = False
            if not stable:
                continue
            for channel in range(3):
                delta = a[index + channel] - b[index + channel]
                total += delta * delta
                count += 1
    return math.sqrt(total / count) if count else 1.0, count


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    clean_scene()
    scene = configure_scene()
    obj = make_source_mesh()
    modifier = make_uv_canvas_nodes(obj)
    portable = make_data_material()
    shader_to_rgb = make_shader_to_rgb_material()

    path_a = OUTPUT / "eevee-data-a.png"
    path_b = OUTPUT / "eevee-data-b.png"
    path_cycles = OUTPUT / "cycles-emission.png"
    path_toon = OUTPUT / "eevee-shader-to-rgb.png"

    eevee_a_seconds, eevee_a = render_eevee(scene, obj, portable, path_a)
    eevee_b_seconds, eevee_b = render_eevee(scene, obj, portable, path_b)
    shader_seconds, shader_pixels = render_eevee(scene, obj, shader_to_rgb, path_toon)
    cycles_seconds, cycles_pixels = bake_cycles(scene, obj, modifier, portable, path_cycles)
    rmse, compared = interior_rmse(eevee_a, cycles_pixels)
    flat_rmse, flat_compared = flat_region_rmse(eevee_a, cycles_pixels)
    repeat_rmse = full_rmse(eevee_a, eevee_b)

    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "fixture.blend"))
    result = {
        "prototype": "eevee-uv-materializer",
        "blenderVersion": bpy.app.version_string,
        "resolution": SIZE,
        "eevee": {
            "secondsA": eevee_a_seconds,
            "secondsB": eevee_b_seconds,
            "hashA": digest(path_a),
            "hashB": digest(path_b),
            "coveredFraction": coverage(eevee_a),
        },
        "cycles": {
            "seconds": cycles_seconds,
            "coveredFraction": coverage(cycles_pixels),
        },
        "shaderToRgb": {
            "seconds": shader_seconds,
            "coveredFraction": coverage(shader_pixels),
        },
        "comparison": {
            "interiorRmse": rmse,
            "flatRegionRmse": flat_rmse,
            "flatComparedChannels": flat_compared,
            "repeatRmse": repeat_rmse,
            "comparedChannels": compared,
            "scope": "portable emission material only; raster edges excluded",
        },
        "knownUnanswered": [
            "mip-safe island margin",
            "alpha decals and superimposed geometry",
            "MikkTSpace normal detail and mirrored islands",
            "world/object-coordinate dependency diagnostics",
            "representative performance at 1K and 4K",
        ],
    }
    (OUTPUT / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("BLENDLINK_EEVEE_UV_PROTOTYPE=" + json.dumps(result, separators=(",", ":")))


main()
