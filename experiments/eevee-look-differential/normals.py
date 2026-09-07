# SPDX-License-Identifier: GPL-3.0-or-later
"""EEVEE normal outputs encoded as RGB = normal_world * .5 + .5.
No lighting or view transform; paired raw PNG16 and linear OpenEXR references.
"""

import bpy, json, math, pathlib, numpy as np
from mathutils import Vector

root = (
    pathlib.Path(__file__).resolve().parents[2] / "artifacts/verification-look/normals"
)
root.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1240
scene.render.resolution_y = 1040
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.dither_intensity = 0
scene.render.use_compositing = False
scene.view_settings.view_transform = "Raw"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.world.color = (0, 0, 0)
camera_data = bpy.data.cameras.new("Reference Camera")
camera = bpy.data.objects.new("Reference Camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 12)
camera.rotation_euler = (0, 0, 0)
camera_data.type = "ORTHO"
camera_data.ortho_scale = 12.4
scene.camera = camera
color = (0.8, 0.6, 0.9, 1)
cases = [
    {"name": "tangent-" + str(s), "kind": "normal", "space": "TANGENT", "strength": s}
    for s in (0, 0.25, 0.5, 1, 2)
]
cases += [
    {
        "name": "tangent-directx",
        "kind": "normal",
        "space": "TANGENT",
        "convention": "DIRECTX",
    },
    {"name": "tangent-uv90", "kind": "normal", "space": "TANGENT", "uvRotation": 90},
    {
        "name": "tangent-uvmirror",
        "kind": "normal",
        "space": "TANGENT",
        "uvMirror": True,
    },
    {
        "name": "tangent-negative-scale",
        "kind": "normal",
        "space": "TANGENT",
        "scale": [-1, 1, 1],
    },
    {
        "name": "tangent-backface",
        "kind": "normal",
        "space": "TANGENT",
        "rotation": [math.pi, 0, 0],
    },
    {"name": "tangent-no-uv", "kind": "normal", "space": "TANGENT", "noUV": True},
    {"name": "tangent-named-uv", "kind": "normal", "space": "TANGENT", "namedUV": True},
    {
        "name": "object-half-rotated",
        "kind": "normal",
        "space": "OBJECT",
        "strength": 0.5,
        "rotation": [0, 0.25, 0.6],
    },
    {
        "name": "object-nonuniform",
        "kind": "normal",
        "space": "OBJECT",
        "scale": [0.8, 1.1, 0.5],
        "rotation": [0, 0.25, 0.6],
    },
    {
        "name": "object-two-negative",
        "kind": "normal",
        "space": "OBJECT",
        "strength": 2,
        "scale": [-1, 1, 0.7],
        "rotation": [0, 0.25, 0.6],
    },
    {
        "name": "world-half-rotated",
        "kind": "normal",
        "space": "WORLD",
        "strength": 0.5,
        "rotation": [0, 0.25, 0.6],
    },
    {
        "name": "world-one-rotated",
        "kind": "normal",
        "space": "WORLD",
        "strength": 1,
        "rotation": [0, 0.25, 0.6],
    },
    {
        "name": "world-two-rotated",
        "kind": "normal",
        "space": "WORLD",
        "strength": 2,
        "rotation": [0, 0.25, 0.6],
    },
    {"name": "bump-quarter", "kind": "bump", "strength": 0.25},
    {"name": "bump-one", "kind": "bump"},
    {"name": "bump-two", "kind": "bump", "strength": 2},
    {"name": "bump-invert", "kind": "bump", "invert": True},
    {"name": "bump-negative-scale", "kind": "bump", "scale": [-1, 1, 1]},
    {"name": "bump-backface", "kind": "bump", "rotation": [math.pi, 0, 0]},
    {"name": "bump-world-position", "kind": "bump", "height": "worldX"},
    {"name": "bump-double-uv", "kind": "bump", "uvScale": 2},
    {"name": "bump-custom-normal", "kind": "bump", "normal": [0.3, 0.4, 0.8]},
    {
        "name": "bump-unlinked-height",
        "kind": "bump",
        "unlinked": True,
        "normal": [0.3, 0.4, 0.8],
    },
    {"name": "normal-then-bump", "kind": "bump", "chain": True},
    {"name": "bump-filter-width-two", "kind": "bump", "filterWidth": 2},
]


def node(tree, kind):
    return tree.nodes.new(kind)


def normal_node(tree, case):
    n = node(tree, "ShaderNodeNormalMap")
    n.space = case.get("space", "TANGENT")
    n.inputs["Color"].default_value = color
    n.inputs["Strength"].default_value = case.get("strength", 1)
    if case.get("convention"):
        n.convention = case["convention"]
    if case.get("namedUV"):
        n.uv_map = "RotatedUV"
    return n


records = []
for index, case in enumerate(cases):
    col = index % 6
    row = index // 6
    bpy.ops.mesh.primitive_plane_add(size=1.6, location=(-5 + 2 * col, 4 - 2 * row, 0))
    obj = bpy.context.object
    obj.name = case["name"]
    obj.scale = case.get("scale", (1, 1, 1))
    obj.rotation_euler = case.get("rotation", (0, 0, 0))
    mesh = obj.data
    if case.get("noUV"):
        mesh.uv_layers.remove(mesh.uv_layers.active)
    else:
        for uvloop in mesh.uv_layers.active.data:
            uv = uvloop.uv.copy()
            if case.get("uvRotation"):
                uv = Vector((1 - uv.y, uv.x))
            if case.get("uvMirror"):
                uv.x = 1 - uv.x
            uvloop.uv = uv * case.get("uvScale", 1)
        if case.get("namedUV"):
            alternate = mesh.uv_layers.new(name="RotatedUV")
            for uvloop in alternate.data:
                uvloop.uv = Vector((1 - uvloop.uv.y, uvloop.uv.x))
    material = bpy.data.materials.new(case["name"])
    material.use_nodes = True
    material.use_backface_culling = False
    tree = material.node_tree
    tree.nodes.clear()
    obj.data.materials.append(material)
    if case["kind"] == "normal":
        output = normal_node(tree, case).outputs["Normal"]
    else:
        bump = node(tree, "ShaderNodeBump")
        bump.invert = case.get("invert", False)
        bump.inputs["Distance"].default_value = 0.2
        bump.inputs["Filter Width"].default_value = case.get("filterWidth", 0.1)
        # Value node permits strengths beyond the socket's UI soft range.
        strength = node(tree, "ShaderNodeValue")
        strength.outputs[0].default_value = case.get("strength", 1)
        tree.links.new(strength.outputs[0], bump.inputs["Strength"])
        if not case.get("unlinked"):
            if case.get("height") == "worldX":
                coordinate = node(tree, "ShaderNodeNewGeometry").outputs["Position"]
            else:
                coordinate = node(tree, "ShaderNodeTexCoord").outputs["UV"]
            separate = node(tree, "ShaderNodeSeparateXYZ")
            tree.links.new(coordinate, separate.inputs[0])
            tree.links.new(separate.outputs["X"], bump.inputs["Height"])
        if case.get("normal"):
            vector = node(tree, "ShaderNodeCombineXYZ")
            for channel, v in zip(vector.inputs, case["normal"]):
                channel.default_value = v
            tree.links.new(vector.outputs[0], bump.inputs["Normal"])
        if case.get("chain"):
            tree.links.new(
                normal_node(tree, {"space": "TANGENT"}).outputs["Normal"],
                bump.inputs["Normal"],
            )
        output = bump.outputs["Normal"]
    scale = node(tree, "ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = 0.5
    tree.links.new(output, scale.inputs[0])
    add = node(tree, "ShaderNodeVectorMath")
    add.operation = "ADD"
    add.inputs[1].default_value = (0.5, 0.5, 0.5)
    tree.links.new(scale.outputs["Vector"], add.inputs[0])
    emission = node(tree, "ShaderNodeEmission")
    tree.links.new(add.outputs["Vector"], emission.inputs["Color"])
    emission.inputs["Strength"].default_value = 1
    sink = node(tree, "ShaderNodeOutputMaterial")
    tree.links.new(emission.outputs[0], sink.inputs["Surface"])
    bpy.context.view_layer.update()
    tangents = []
    if mesh.uv_layers:
        mesh.calc_tangents(
            uvmap="RotatedUV" if case.get("namedUV") else mesh.uv_layers.active.name
        )
        tangents = [list(loop.tangent) + [loop.bitangent_sign] for loop in mesh.loops]
    records.append(
        {
            **case,
            "color": list(color),
            "distance": 0.2 if case["kind"] == "bump" else None,
            "centerPixel": [120 + 200 * col, 120 + 200 * row],
            "matrixWorld": [list(r) for r in obj.matrix_world],
            "vertices": [list(v.co) for v in mesh.vertices],
            "loops": [l.vertex_index for l in mesh.loops],
            "loopNormals": [list(n.vector) for n in mesh.corner_normals],
            "tangents": tangents,
            "uvLayers": {
                layer.name: [list(v.uv) for v in layer.data] for layer in mesh.uv_layers
            },
        }
    )
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "16"
scene.render.filepath = str(root / "world-normals-raw.png")
bpy.ops.wm.save_as_mainfile(filepath=str(root / "world-normal-fixture.blend"))
bpy.ops.render.render(write_still=True)
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_depth = "32"
bpy.data.images["Render Result"].save_render(
    str(root / "world-normals-linear.exr"), scene=scene
)
loaded = bpy.data.images.load(
    str(root / "world-normals-linear.exr"), check_existing=False
)
pixels = np.array(loaded.pixels[:], dtype=np.float32).reshape(1040, 1240, 4)
for record in records:
    x, y = record["centerPixel"]
    rgb = pixels[1039 - y, x, :3]
    record["referenceRGB"] = rgb.tolist()
    record["referenceWorldNormal"] = (rgb * 2 - 1).tolist()
(root / "fixture.json").write_text(
    json.dumps(
        {
            "blenderVersion": bpy.app.version_string,
            "resolution": [1240, 1040],
            "camera": {
                "position": [0, 0, 12],
                "rotationEuler": [0, 0, 0],
                "orthoScale": 12.4,
                "near": camera_data.clip_start,
                "far": camera_data.clip_end,
            },
            "normalEncoding": "Blender world normal * 0.5 + 0.5; EXR scene linear; PNG Raw display; alpha1",
            "threeWorldToBlenderWorld": "[x,-z,y] after standard glTF axis conversion",
            "cases": records,
        },
        indent=2,
    )
)
print("NORMAL_FIXTURE_READY", len(records), flush=True)
