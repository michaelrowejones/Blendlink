"""Visual proof for object-context preservation in a shared Cycles atlas.

Run with Blender 5.2+ in background mode. The left output uses Blender's
multi-object bake path (the Needle Engine approach); the right output joins the
same geometry first. Both source objects share one material whose Object
Attribute color differs per object.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

import bpy


def make_plane(name: str, uv_min: float, uv_max: float, tint) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name}.Mesh")
    mesh.from_pydata(
        [(-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (1.0, 1.0, 0.0), (-1.0, 1.0, 0.0)],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    coordinates = (
        (uv_min, 0.1), (uv_max, 0.1), (uv_max, 0.9), (uv_min, 0.9),
    )
    for loop in mesh.loops:
        uv.data[loop.index].uv = coordinates[loop.vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj["Tint"] = list(tint)
    return obj


def make_material() -> bpy.types.Material:
    material = bpy.data.materials.new("Shared Object Attribute Material")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    attribute = nodes.new("ShaderNodeAttribute")
    attribute.attribute_type = "OBJECT"
    attribute.attribute_name = "Tint"
    target = nodes.new("ShaderNodeTexImage")
    target.name = "Prototype Bake Target"
    links.new(attribute.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def new_target(name: str) -> bpy.types.Image:
    return bpy.data.images.new(name, width=128, height=64, alpha=True, float_buffer=True)


def select(objects) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def bake(objects, material, image, output: Path) -> tuple:
    target = material.node_tree.nodes["Prototype Bake Target"]
    target.image = image
    target.select = True
    material.node_tree.nodes.active = target
    select(objects)
    bpy.ops.object.bake(
        type="EMIT",
        target="IMAGE_TEXTURES",
        margin=4,
        margin_type="EXTEND",
        use_clear=True,
        uv_layer="UVMap",
    )
    image.filepath_raw = str(output)
    image.file_format = "PNG"
    image.save()
    pixels = list(image.pixels)

    def sample(x, y):
        index = (y * image.size[0] + x) * 4
        return tuple(round(pixels[index + channel], 4) for channel in range(4))

    return sample(32, 32), sample(96, 32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    script_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(script_args)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_adaptive_sampling = False

    material = make_material()
    # margin=4 below requires a 12px inter-object gutter (2m + 4). Place the
    # two receiver islands exactly 12 pixels apart in this 128px atlas.
    red = make_plane("Red Object", 8 / 128, 52 / 128, (1.0, 0.0, 0.0, 1.0))
    green = make_plane("Green Object", 64 / 128, 108 / 128, (0.0, 1.0, 0.0, 1.0))
    red.data.materials.append(material)
    green.data.materials.append(material)

    separate = new_target("Separate Object Bake")
    separate_samples = bake(
        [red, green], material, separate, output / "individual-objects.png",
    )

    joined_red = red.copy()
    joined_red.data = red.data.copy()
    scene.collection.objects.link(joined_red)
    joined_green = green.copy()
    joined_green.data = green.data.copy()
    scene.collection.objects.link(joined_green)
    red.hide_render = True
    green.hide_render = True
    select([joined_red, joined_green])
    bpy.context.view_layer.objects.active = joined_red
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = "Joined Proxy"

    joined_image = new_target("Joined Object Bake")
    joined_samples = bake(
        [joined], material, joined_image, output / "joined-proxy.png",
    )

    print("BLENDLINK_OBJECT_CONTEXT_PROTOTYPE", {
        "individual": separate_samples,
        "joined": joined_samples,
        "output": str(output),
    })
    if not (
        separate_samples[0][0] > 0.9
        and separate_samples[0][1] < 0.1
        and separate_samples[1][1] > 0.9
        and separate_samples[1][0] < 0.1
    ):
        raise RuntimeError(f"individual-object bake lost object context: {separate_samples}")
    if joined_samples[0] != joined_samples[1]:
        raise RuntimeError(f"joined control unexpectedly retained two object values: {joined_samples}")


if __name__ == "__main__":
    main()
