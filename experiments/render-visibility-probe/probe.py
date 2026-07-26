"""Blender 5.2 render-visibility differential for Blendlink/Needle research.

Run with::

    blender --background --factory-startup --python probe.py

The fixture renders emissive geometry instead of inferring render visibility
from viewport state.  It intentionally covers collection multi-linking,
active View Layer exclusion, viewport-only flags, and Collection Instances.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "blender-addon"))
import weblights  # noqa: E402


RESULTS: list[dict] = []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 32
    scene.render.resolution_y = 32
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    world = bpy.data.worlds.new("Black World")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs[0].default_value = (0.0, 0.0, 0.0, 1.0)
    background.inputs[1].default_value = 0.0
    scene.world = world

    camera_data = bpy.data.cameras.new("Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 4.0
    camera = bpy.data.objects.new("Camera", camera_data)
    camera.location = (0.0, 0.0, 5.0)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return scene


def emission_plane(name: str):
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        [(-1.0, -1.0, 0.0), (1.0, -1.0, 0.0),
         (1.0, 1.0, 0.0), (-1.0, 1.0, 0.0)],
        [],
        [(0, 1, 2, 3)],
    )
    obj = bpy.data.objects.new(name, mesh)
    material = bpy.data.materials.new(f"{name} Emission")
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
    emission.inputs[1].default_value = 1.0
    tree.links.new(emission.outputs[0], output.inputs[0])
    mesh.materials.append(material)
    return obj


def diffuse_plane(name: str):
    obj = emission_plane(name)
    material = obj.data.materials[0]
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
    principled.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    principled.inputs["Roughness"].default_value = 1.0
    tree.links.new(principled.outputs[0], output.inputs[0])
    return obj


def point_light(name: str):
    data = bpy.data.lights.new(f"{name} Data", "POINT")
    data.energy = 400.0
    data.color = (1.0, 1.0, 1.0)
    obj = bpy.data.objects.new(name, data)
    obj.location = (0.0, 0.0, 2.0)
    return obj


def render_luminance(scene) -> float:
    bpy.context.view_layer.update()
    path = str(Path(tempfile.gettempdir()) / "blendlink-render-visibility-probe.png")
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    bpy.ops.render.render(scene=scene.name, write_still=True)
    image = bpy.data.images.load(path, check_existing=False)
    width, height = image.size
    index = 4 * ((height // 2) * width + width // 2)
    rgba = image.pixels[index:index + 4]
    luminance = max(float(rgba[0]), float(rgba[1]), float(rgba[2]))
    bpy.data.images.remove(image)
    os.remove(path)
    return luminance


def layer_path(view_layer, *names):
    current = view_layer.layer_collection
    for name in names:
        current = next(
            child for child in current.children
            if child.collection.name == name
        )
    return current


def direct_record(label, scene, obj, expected_rendered: bool):
    luminance = render_luminance(scene)
    rendered = luminance > 0.1
    decision = weblights.render_visibility(
        obj, scene, view_layer=bpy.context.view_layer,
    )
    in_view_layer = bpy.context.view_layer.objects.get(obj.name) is obj
    visible_get = obj.visible_get(view_layer=bpy.context.view_layer)
    RESULTS.append({
        "case": label,
        "rendered": rendered,
        "luminance": round(luminance, 6),
        "renderVisibility": decision.exported,
        "renderVisibilityCode": decision.code,
        "inViewLayer": in_view_layer,
        "visibleGet": visible_get,
    })
    assert rendered is expected_rendered, (label, luminance, expected_rendered)
    assert decision.exported is rendered, (label, decision, luminance)


def probe_direct_multilink():
    scene = reset_scene()
    hidden_parent = bpy.data.collections.new("Hidden Parent")
    visible_parent = bpy.data.collections.new("Visible Parent")
    shared = bpy.data.collections.new("Shared Receiver")
    scene.collection.children.link(hidden_parent)
    scene.collection.children.link(visible_parent)
    hidden_parent.children.link(shared)
    visible_parent.children.link(shared)
    receiver = emission_plane("Multi-path Receiver")
    shared.objects.link(receiver)
    bpy.context.view_layer.update()

    hidden_layer = layer_path(bpy.context.view_layer, "Hidden Parent")
    visible_layer = layer_path(bpy.context.view_layer, "Visible Parent")

    direct_record("multi-path baseline", scene, receiver, True)
    hidden_parent.hide_render = True
    direct_record("one render-hidden parent", scene, receiver, True)
    visible_parent.hide_render = True
    direct_record("all render-hidden parents", scene, receiver, False)
    hidden_parent.hide_render = False
    visible_parent.hide_render = False

    hidden_layer.exclude = True
    direct_record("one excluded View Layer path", scene, receiver, True)
    visible_layer.exclude = True
    direct_record("all excluded View Layer paths", scene, receiver, False)
    hidden_layer.exclude = False
    visible_layer.exclude = False

    hidden_parent.hide_render = True
    visible_layer.exclude = True
    direct_record("hidden path plus excluded path", scene, receiver, False)


def probe_viewport_flags():
    scene = reset_scene()
    host = bpy.data.collections.new("Viewport Flags")
    scene.collection.children.link(host)
    receiver = emission_plane("Viewport Receiver")
    host.objects.link(receiver)
    host_layer = layer_path(bpy.context.view_layer, "Viewport Flags")

    direct_record("viewport baseline", scene, receiver, True)
    receiver.hide_render = True
    direct_record("object hide_render", scene, receiver, False)
    receiver.hide_render = False

    receiver.hide_viewport = True
    direct_record("object hide_viewport", scene, receiver, True)
    receiver.hide_viewport = False
    receiver.hide_set(True, view_layer=bpy.context.view_layer)
    direct_record("object hide_set", scene, receiver, True)
    receiver.hide_set(False, view_layer=bpy.context.view_layer)

    host.hide_viewport = True
    direct_record("Collection hide_viewport", scene, receiver, True)
    host.hide_viewport = False
    host_layer.hide_viewport = True
    direct_record("LayerCollection hide_viewport", scene, receiver, True)


def light_record(label, scene, light, expected_lit: bool):
    luminance = render_luminance(scene)
    lit = luminance > 0.1
    decision = weblights.render_visibility(
        light, scene, view_layer=bpy.context.view_layer,
    )
    RESULTS.append({
        "case": label,
        "lit": lit,
        "luminance": round(luminance, 6),
        "renderVisibility": decision.exported,
        "renderVisibilityCode": decision.code,
    })
    assert lit is expected_lit, (label, luminance, expected_lit)
    assert decision.exported is lit, (label, decision, luminance)


def probe_multilink_light():
    scene = reset_scene()
    receiver = diffuse_plane("Light Receiver")
    scene.collection.objects.link(receiver)
    hidden_parent = bpy.data.collections.new("Hidden Light Parent")
    visible_parent = bpy.data.collections.new("Visible Light Parent")
    shared = bpy.data.collections.new("Shared Light Collection")
    scene.collection.children.link(hidden_parent)
    scene.collection.children.link(visible_parent)
    hidden_parent.children.link(shared)
    visible_parent.children.link(shared)
    light = point_light("Multi-path Point")
    shared.objects.link(light)

    light_record("multi-path light baseline", scene, light, True)
    hidden_parent.hide_render = True
    light_record("multi-path light one hidden parent", scene, light, True)
    visible_parent.hide_render = True
    light_record("multi-path light all hidden parents", scene, light, False)


def probe_layer_contribution_modes():
    """Record non-binary View Layer roles the visibility seam must not erase."""
    scene = reset_scene()
    special_parent = bpy.data.collections.new("Special Contribution Parent")
    normal_parent = bpy.data.collections.new("Normal Contribution Parent")
    shared = bpy.data.collections.new("Shared Contribution Receiver")
    scene.collection.children.link(special_parent)
    scene.collection.children.link(normal_parent)
    special_parent.children.link(shared)
    normal_parent.children.link(shared)
    receiver = emission_plane("Contribution Receiver")
    shared.objects.link(receiver)
    special_layer = layer_path(
        bpy.context.view_layer, "Special Contribution Parent",
        "Shared Contribution Receiver",
    )
    normal_layer = layer_path(
        bpy.context.view_layer, "Normal Contribution Parent",
        "Shared Contribution Receiver",
    )

    special_layer.holdout = True
    RESULTS.append({
        "case": "one holdout path plus one normal path",
        "holdoutGet": receiver.holdout_get(view_layer=bpy.context.view_layer),
        "rendered": render_luminance(scene) > 0.1,
    })
    normal_layer.holdout = True
    RESULTS.append({
        "case": "all holdout paths",
        "holdoutGet": receiver.holdout_get(view_layer=bpy.context.view_layer),
        "rendered": render_luminance(scene) > 0.1,
    })
    special_layer.holdout = False
    normal_layer.holdout = False

    special_layer.indirect_only = True
    RESULTS.append({
        "case": "one indirect-only path plus one normal path",
        "indirectOnlyGet": receiver.indirect_only_get(
            view_layer=bpy.context.view_layer,
        ),
    })
    normal_layer.indirect_only = True
    RESULTS.append({
        "case": "all indirect-only paths",
        "indirectOnlyGet": receiver.indirect_only_get(
            view_layer=bpy.context.view_layer,
        ),
    })


def instance_record(label, scene, instance, source_obj, expected_rendered: bool):
    luminance = render_luminance(scene)
    rendered = luminance > 0.1
    occurrences = weblights.collect_instance_source_occurrences(
        scene, view_layer=bpy.context.view_layer,
    )
    record = occurrences.get(source_obj.as_pointer())
    source_visible = bool(record) and any(
        item["visible"] for item in record["occurrences"]
    )
    root_decision = weblights.render_visibility(
        instance, scene, view_layer=bpy.context.view_layer,
    )
    RESULTS.append({
        "case": label,
        "rendered": rendered,
        "luminance": round(luminance, 6),
        "rootRenderVisibility": root_decision.exported,
        "instanceSourceVisibility": source_visible,
    })
    assert rendered is expected_rendered, (label, luminance, expected_rendered)
    assert source_visible is rendered, (label, record, luminance)


def probe_collection_instances():
    scene = reset_scene()
    host = bpy.data.collections.new("Instance Host")
    scene.collection.children.link(host)
    source = bpy.data.collections.new("External Source")
    source_obj = emission_plane("Instanced Receiver")
    source.objects.link(source_obj)
    instance = bpy.data.objects.new("Collection Instance", None)
    instance.instance_type = "COLLECTION"
    instance.instance_collection = source
    host.objects.link(instance)
    host_layer = layer_path(bpy.context.view_layer, "Instance Host")

    instance_record("instance baseline", scene, instance, source_obj, True)
    source.hide_render = True
    instance_record("instance source Collection hide_render", scene, instance, source_obj, False)
    source.hide_render = False
    source_obj.hide_render = True
    instance_record("instance source object hide_render", scene, instance, source_obj, False)
    source_obj.hide_render = False

    source_obj.hide_viewport = True
    instance_record("instance source object hide_viewport", scene, instance, source_obj, True)
    source_obj.hide_viewport = False
    instance.hide_render = True
    instance_record("instance root object hide_render", scene, instance, source_obj, False)
    instance.hide_render = False
    instance.hide_viewport = True
    instance_record("instance root object hide_viewport", scene, instance, source_obj, True)
    instance.hide_viewport = False

    host_layer.exclude = True
    instance_record("instance root excluded path", scene, instance, source_obj, False)


probe_direct_multilink()
probe_viewport_flags()
probe_multilink_light()
probe_layer_contribution_modes()
probe_collection_instances()
print("BLENDLINK_RENDER_VISIBILITY_PROBE=" + json.dumps(RESULTS, indent=2))
