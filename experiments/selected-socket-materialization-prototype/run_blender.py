# SPDX-License-Identifier: MIT
"""PROTOTYPE ONLY — selected socket -> private Emit bake -> stock GLB."""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUTPUT = HERE / "output"
OUTPUT.mkdir(exist_ok=True)
SIZE = 256
UV_NAME = "UVMap"

sys.path.insert(0, str(ROOT / "packages" / "blendlink" / "blender"))
sys.path.insert(0, str(ROOT / "packages" / "blender-addon"))
import bakelib  # noqa: E402 — the one canonical bake implementation
import material_compiler  # noqa: E402


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def material_fingerprint(material):
    digest = hashlib.sha256()
    bakelib._fingerprint_material(digest, material, set())
    return digest.hexdigest()


def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.materials,
        bpy.data.meshes,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.node_groups,
        bpy.data.images,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def make_source_object():
    mesh = bpy.data.meshes.new("PROTOTYPE_SelectedSocket Mesh")
    mesh.from_pydata(
        ((-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)),
        (),
        ((0, 1, 2, 3),),
    )
    mesh.update()
    uv = mesh.uv_layers.new(name=UV_NAME)
    uv.active_render = True
    mesh.uv_layers.active = uv
    authored = {
        0: (0.08, 0.08),
        1: (0.92, 0.08),
        2: (0.92, 0.92),
        3: (0.08, 0.92),
    }
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            uv.data[loop_index].uv = authored[mesh.loops[loop_index].vertex_index]
    obj = bpy.data.objects.new("PROTOTYPE_SelectedSocket", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_source_material():
    material = bpy.data.materials.new("PROTOTYPE_ArtistMaterial")
    material.use_nodes = True
    tree = material.node_tree
    nodes = tree.nodes
    links = tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.name = "Artist Output"
    emission = nodes.new("ShaderNodeEmission")
    emission.name = "Artist Eevee Presentation"
    shader_to_rgb = nodes.new("ShaderNodeShaderToRGB")
    shader_to_rgb.name = "Artist Eevee Shader to RGB"
    diffuse = nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.name = "Artist Lit Surface"
    coords = nodes.new("ShaderNodeUVMap")
    coords.name = "Artist UV"
    coords.uv_map = UV_NAME
    checker = nodes.new("ShaderNodeTexChecker")
    checker.name = "Artist Intrinsic Color"
    checker.inputs["Color1"].default_value = (0.025, 0.12, 0.82, 1.0)
    checker.inputs["Color2"].default_value = (0.92, 0.08, 0.025, 1.0)
    checker.inputs["Scale"].default_value = 7.0

    links.new(coords.outputs["UV"], checker.inputs["Vector"])
    links.new(checker.outputs["Color"], diffuse.inputs["Color"])
    links.new(diffuse.outputs["BSDF"], shader_to_rgb.inputs["Shader"])
    links.new(shader_to_rgb.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])

    material_compiler.set_web_source(
        material,
        checker,
        checker.outputs["Color"].identifier,
        "COLOR",
    )
    return material


def selected_source(material):
    markers = material_compiler.marker_nodes(material)
    expect(len(markers) == 1, "private material lost the Web Color marker")
    socket = markers[0].inputs[material_compiler.COLOR_INPUT]
    expect(socket.is_linked, "private Web Color marker is unlinked")
    link = socket.links[0]
    return link.from_node, link.from_socket


def upstream_node_types(node):
    found = set()
    stack = [node]
    while stack:
        current = stack.pop()
        pointer = current.as_pointer()
        if pointer in found:
            continue
        found.add(pointer)
        for socket in current.inputs:
            for link in socket.links:
                stack.append(link.from_node)
    return {
        item.bl_idname
        for item in node.id_data.nodes
        if item.as_pointer() in found
    }


def private_bake_material(source):
    material = source.copy()
    material.name = "PROTOTYPE_PRIVATE_BAKE"
    node, socket = selected_source(material)
    tree = material.node_tree
    for output in [
        item for item in tree.nodes if item.bl_idname == "ShaderNodeOutputMaterial"
    ]:
        tree.nodes.remove(output)
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.name = "PROTOTYPE_PRIVATE_OUTPUT"
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.name = "PROTOTYPE_PRIVATE_SELECTED_FIELD"
    tree.links.new(socket, emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material, node, socket


def stock_unlit_material(image):
    material = bpy.data.materials.new("PROTOTYPE_PUBLISHED_MATERIAL")
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    background = tree.nodes.new("ShaderNodeBackground")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.name = "PROTOTYPE_PUBLISHED_TEXTURE"
    texture.image = image
    texture.interpolation = "Linear"
    texture.extension = "REPEAT"
    texture.projection = "FLAT"
    uv = tree.nodes.new("ShaderNodeUVMap")
    uv.uv_map = UV_NAME
    tree.links.new(uv.outputs["UV"], texture.inputs["Vector"])
    tree.links.new(texture.outputs["Color"], background.inputs["Color"])
    tree.links.new(background.outputs["Background"], output.inputs["Surface"])
    return material


def white_coverage_material():
    material = bpy.data.materials.new("PROTOTYPE_PRIVATE_COVERAGE")
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def embedded_image_payload(document, binary, material_index):
    material = document["materials"][material_index]
    texture_index = material["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    image_index = document["textures"][texture_index]["source"]
    image = document["images"][image_index]
    view = document["bufferViews"][image["bufferView"]]
    start = int(view.get("byteOffset", 0))
    end = start + int(view["byteLength"])
    return material, image, binary[start:end]


def covered_color_range(image, covered):
    values = list(image.pixels[:])
    samples = []
    width, height = image.size
    for y in range(height):
        for x in range(width):
            if covered[y][x]:
                offset = (y * width + x) * 4
                samples.append(values[offset:offset + 3])
    expect(samples, "saved material texture has no covered samples")
    minimum = [min(sample[channel] for sample in samples) for channel in range(3)]
    maximum = [max(sample[channel] for sample in samples) for channel in range(3)]
    return minimum, maximum


def main():
    clean_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    source_obj = make_source_object()
    source_material = make_source_material()
    source_obj.data.materials.append(source_material)
    source_mesh = source_obj.data
    source_binding = source_obj.material_slots[0].material
    source_fingerprint = material_fingerprint(source_material)

    fixture_path = OUTPUT / "source-fixture.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(fixture_path), check_existing=False)
    fixture_hash = sha256(fixture_path)

    private_obj = source_obj.copy()
    private_obj.name = "PROTOTYPE_PRIVATE_OBJECT"
    private_obj.data = source_obj.data.copy()
    private_obj.data.name = "PROTOTYPE_PRIVATE_MESH"
    scene.collection.objects.link(private_obj)
    bake_material, selected_node, selected_socket = private_bake_material(
        source_material,
    )
    private_obj.data.materials.clear()
    private_obj.data.materials.append(bake_material)

    selected_dependencies = upstream_node_types(selected_node)
    expect(
        "ShaderNodeShaderToRGB" not in selected_dependencies,
        "downstream Shader to RGB entered selected-field dependencies",
    )
    expect(
        any(
            item.bl_idname == "ShaderNodeShaderToRGB"
            for item in source_material.node_tree.nodes
        ),
        "fixture lost its downstream Eevee-only branch",
    )

    target = bpy.data.images.new(
        "PROTOTYPE_SELECTED_FIELD_FLOAT",
        width=SIZE,
        height=SIZE,
        alpha=True,
        float_buffer=True,
    )
    target.generated_color = (0.0, 0.0, 0.0, 0.0)
    coverage_target = bpy.data.images.new(
        "PROTOTYPE_SELECTED_FIELD_COVERAGE",
        width=SIZE,
        height=SIZE,
        alpha=True,
        float_buffer=True,
    )
    coverage_target.generated_color = (0.0, 0.0, 0.0, 0.0)
    output_png = OUTPUT / "selected-field.png"
    output_coverage = OUTPUT / "selected-field-coverage.png"
    output_glb = OUTPUT / "selected-field.glb"

    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    coverage_material = white_coverage_material()
    private_obj.data.materials.clear()
    private_obj.data.materials.append(coverage_material)
    bakelib.bake_objects_to_image(
        [private_obj],
        coverage_target,
        bake_type="EMIT",
        margin_px=8,
        uv_layer=UV_NAME,
    )
    coverage = bakelib.image_signal_coverage(
        coverage_target,
        "selected-socket materialization prototype",
    )
    bakelib.save_dithered(coverage_target, str(output_coverage))

    private_obj.data.materials.clear()
    private_obj.data.materials.append(bake_material)
    bakelib.bake_objects_to_image(
        [private_obj],
        target,
        bake_type="EMIT",
        margin_px=8,
        uv_layer=UV_NAME,
    )
    coverage_rows = coverage.tolist()
    clipped_fraction = bakelib.clipped_fraction(target, coverage)
    expect(
        clipped_fraction == 0.0,
        f"selected field clipped {clipped_fraction:.6%} of covered texels",
    )
    bakelib.save_resolved(
        target,
        str(output_png),
        SIZE,
        denoise=False,
        delivery_sizes=[],
        coverage=coverage,
    )

    published_image = bpy.data.images.load(str(output_png), check_existing=False)
    published_image.name = "PROTOTYPE_SELECTED_FIELD_TEXTURE"
    published_material = stock_unlit_material(published_image)
    private_obj.data.materials.clear()
    private_obj.data.materials.append(published_material)

    selected_before = list(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active
    try:
        bpy.ops.object.select_all(action="DESELECT")
        private_obj.select_set(True)
        bpy.context.view_layer.objects.active = private_obj
        export_result = bpy.ops.export_scene.gltf(
            filepath=str(output_glb),
            export_format="GLB",
            export_apply=True,
            export_yup=True,
            export_texcoords=True,
            export_materials="EXPORT",
            export_extras=True,
            export_image_format="AUTO",
            use_selection=True,
            use_active_scene=True,
        )
        expect("FINISHED" in export_result, f"glTF export failed: {export_result}")
    finally:
        bpy.ops.object.select_all(action="DESELECT")
        for item in selected_before:
            if bpy.context.scene.objects.get(item.name) is item:
                item.select_set(True)
        bpy.context.view_layer.objects.active = active_before

    document, binary = material_compiler._read_glb(str(output_glb))
    expect(len(document.get("materials", ())) == 1, "fixture did not emit one material")
    material_doc, image_doc, image_payload = embedded_image_payload(
        document,
        binary,
        0,
    )
    minimum, maximum = covered_color_range(published_image, coverage_rows)
    payload_hash = hashlib.sha256(image_payload).hexdigest()
    png_hash = sha256(output_png)

    source_restored = (
        source_obj.data == source_mesh
        and source_obj.material_slots[0].material == source_binding
        and material_fingerprint(source_material) == source_fingerprint
        and sha256(fixture_path) == fixture_hash
    )
    stock_gltf = (
        "KHR_materials_unlit" in material_doc.get("extensions", {})
        and image_doc.get("mimeType") == "image/png"
        and payload_hash == png_hash
        and material_doc.get("alphaMode", "OPAQUE") == "OPAQUE"
        and document["materials"][0]["pbrMetallicRoughness"]
        .get("baseColorTexture", {})
        .get("texCoord", 0) == 0
    )
    no_private_contract = (
        "Blendlink Web Color" not in json.dumps(document)
        and "PROTOTYPE_PRIVATE_BAKE" not in json.dumps(document)
        and all(
            not semantic.startswith(material_compiler.PRIVATE_COLOR_PREFIX)
            for mesh in document.get("meshes", ())
            for primitive in mesh.get("primitives", ())
            for semantic in (primitive.get("attributes") or {})
        )
    )
    meaningful_texture = (
        all(math.isfinite(value) for value in (*minimum, *maximum))
        and maximum[0] - minimum[0] > 0.6
        and maximum[2] - minimum[2] > 0.6
        and 0.5 < float(coverage.sum()) / float(coverage.size) < 0.99
    )

    result = {
        "prototype": "selected-socket-materialization",
        "blenderVersion": bpy.app.version_string,
        "selectedField": {
            "material": source_material.name,
            "node": selected_node.name,
            "socket": selected_socket.name,
            "dependencies": sorted(selected_dependencies),
            "downstreamEeveeShaderToRgbPresent": True,
        },
        "texture": {
            "width": SIZE,
            "height": SIZE,
            "sha256": png_hash,
            "embeddedSha256": payload_hash,
            "coveredFraction": float(coverage.sum()) / float(coverage.size),
            "coveredRgbMin": minimum,
            "coveredRgbMax": maximum,
            "clippedFraction": clipped_fraction,
        },
        "gltf": {
            "extensionsUsed": document.get("extensionsUsed", []),
            "materialExtensions": sorted(material_doc.get("extensions", {})),
            "imageMimeType": image_doc.get("mimeType"),
            "alphaMode": material_doc.get("alphaMode", "OPAQUE"),
        },
        "checks": {
            "selectedDependencyBoundary": (
                "ShaderNodeShaderToRGB" not in selected_dependencies
            ),
            "sourceRestored": source_restored,
            "meaningfulTexture": meaningful_texture,
            "stockGltf": stock_gltf,
            "noPrivateRuntimeContract": no_private_contract,
        },
        "scope": [
            "one opaque static binding",
            "top-level selected Color socket",
            "authored UV map",
            "fixed 256px experiment resolution",
            "Cycles-compatible intrinsic dependency path",
        ],
    }
    (OUTPUT / "result.json").write_text(
        json.dumps(result, indent=2) + "\n",
        encoding="utf-8",
    )
    print("BLENDLINK_SELECTED_SOCKET_PROTOTYPE=" + json.dumps(
        result,
        separators=(",", ":"),
    ))

    expect(all(result["checks"].values()), f"prototype checks failed: {result}")


main()
