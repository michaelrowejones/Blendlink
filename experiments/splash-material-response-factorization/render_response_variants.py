"""Render bounded DPM.002 lowering candidates in the retained Eevee scene.

Only the active DPM.002 Surface link changes in memory.  The source .blend is
never saved.  All other scene, material, camera, compositor, and color state is
retained through the existing source-control helper.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import bpy


SCRIPT_PATH = Path(__file__).resolve()
REPOSITORY_ROOT = SCRIPT_PATH.parents[2]
OUTPUT_DIRECTORY = SCRIPT_PATH.parent / "output"
CONTROL_PATH = (
    REPOSITORY_ROOT
    / "experiments"
    / "splash-visual-fidelity-differential"
    / "render-source-controls.py"
)


def load_control_module():
    spec = importlib.util.spec_from_file_location("blendlink_splash_source_control", CONTROL_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not import source-control helper from {CONTROL_PATH}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def linked_source(tree, socket):
    links = [link for link in tree.links if link.is_valid and link.to_socket == socket]
    if len(links) != 1:
        raise RuntimeError(
            f'Expected one link into "{socket.node.name}.{socket.name}", found {len(links)}.'
        )
    return links[0].from_socket


def active_surface(material):
    outputs = [
        node
        for node in material.node_tree.nodes
        if node.bl_idname == "ShaderNodeOutputMaterial" and node.is_active_output
    ]
    if len(outputs) != 1:
        raise RuntimeError(
            f'Expected one active output on "{material.name}", found {len(outputs)}.'
        )
    output = outputs[0]
    return output, output.inputs["Surface"]


def create_principled(tree, intrinsic, *, with_static_floor: bool):
    principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
    principled.name = "PROTOTYPE Blendlink portable carrier"
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["Roughness"].default_value = 0.5
    tree.links.new(intrinsic, principled.inputs["Base Color"])
    created = [principled]

    if with_static_floor:
        group = next(
            node
            for node in tree.nodes
            if node.bl_idname == "ShaderNodeGroup"
            and node.outputs.get("Emission") is not None
            and node.inputs.get("input") is not None
        )
        shade_color = linked_source(tree, group.inputs["Shade Color"])
        shade_value = float(group.inputs["Shade Value"].default_value)

        floor_factor = tree.nodes.new("ShaderNodeMixRGB")
        floor_factor.name = "PROTOTYPE static shade floor"
        floor_factor.blend_type = "MIX"
        floor_factor.inputs["Fac"].default_value = shade_value
        floor_factor.inputs["Color1"].default_value = (1.0, 1.0, 1.0, 1.0)
        tree.links.new(shade_color, floor_factor.inputs["Color2"])

        floor_color = tree.nodes.new("ShaderNodeMixRGB")
        floor_color.name = "PROTOTYPE intrinsic times shade floor"
        floor_color.blend_type = "MULTIPLY"
        floor_color.inputs["Fac"].default_value = 1.0
        tree.links.new(intrinsic, floor_color.inputs["Color1"])
        tree.links.new(floor_factor.outputs["Color"], floor_color.inputs["Color2"])
        tree.links.new(floor_color.outputs["Color"], principled.inputs["Emission Color"])
        principled.inputs["Emission Strength"].default_value = 1.0
        created.extend((floor_factor, floor_color))

    return principled.outputs["BSDF"], created


def create_unlit(tree, intrinsic):
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.name = "PROTOTYPE Blendlink complete intrinsic"
    tree.links.new(intrinsic, emission.inputs["Color"])
    return emission.outputs["Emission"], [emission]


def main() -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    control_module = load_control_module()
    source = bpy.context.scene
    control, copy_report = control_module.create_control_scene(source)
    material = bpy.data.materials.get("DPM.002")
    if material is None or material.node_tree is None:
        raise RuntimeError("DPM.002 is missing.")
    tree = material.node_tree
    output, surface = active_surface(material)
    source_shader = linked_source(tree, surface)
    group = source_shader.node
    if group.bl_idname != "ShaderNodeGroup" or group.inputs.get("input") is None:
        raise RuntimeError("DPM.002 active Surface is no longer the expected DPM group.")
    intrinsic = linked_source(tree, group.inputs["input"])
    if intrinsic.node.name != "Mix.001":
        raise RuntimeError(
            f'Expected DPM.002 intrinsic closure at "Mix.001", got "{intrinsic.node.name}".'
        )

    renders = {}
    renders["source"] = control_module.render_control(
        control, OUTPUT_DIRECTORY / "source.png"
    )

    variants = (
        ("complete-intrinsic-unlit", lambda: create_unlit(tree, intrinsic)),
        (
            "complete-intrinsic-pbr",
            lambda: create_principled(tree, intrinsic, with_static_floor=False),
        ),
        (
            "complete-intrinsic-pbr-static-floor",
            lambda: create_principled(tree, intrinsic, with_static_floor=True),
        ),
    )
    for name, build in variants:
        generated_shader, created = build()
        tree.links.new(generated_shader, surface)
        renders[name] = control_module.render_control(
            control, OUTPUT_DIRECTORY / f"{name}.png"
        )
        tree.links.remove(next(link for link in tree.links if link.to_socket == surface))
        for node in reversed(created):
            tree.nodes.remove(node)
        tree.links.new(source_shader, surface)

    evidence = {
        "schemaVersion": 1,
        "kind": "blendlink-splash-dpm002-response-factorization-prototype",
        "status": "prototype",
        "scope": (
            "Only DPM.002 changes. All other source behavior remains authored Eevee. "
            "This isolates the dominant building material and does not validate a "
            "general compiler lowering."
        ),
        "source": {
            "blend": str(Path(bpy.data.filepath).resolve()),
            "material": material.name,
            "activeGroup": group.node_tree.name,
            "currentSelectedField": "Color Attribute.001.Color",
            "completeIntrinsicCandidate": f"{intrinsic.node.name}.{intrinsic.name}",
        },
        "variants": {
            "source": "Unchanged authored Eevee graph.",
            "complete-intrinsic-unlit": (
                "Mix.001 Result through Emission; proves intrinsic pattern without "
                "lighting response."
            ),
            "complete-intrinsic-pbr": (
                "Mix.001 Result through Principled metallic=0 roughness=0.5."
            ),
            "complete-intrinsic-pbr-static-floor": (
                "Same Principled carrier plus a lighting-independent emissive floor "
                "factored exactly from DPM.002 Shade Value and Shade Color."
            ),
        },
        "copyReport": copy_report,
        "renders": renders,
    }
    (OUTPUT_DIRECTORY / "evidence.json").write_text(
        json.dumps(evidence, indent=2) + "\n", encoding="utf-8"
    )
    print(f"BLENDLINK_SPLASH_RESPONSE_PROTOTYPE={OUTPUT_DIRECTORY / 'evidence.json'}")


if __name__ == "__main__":
    main()
