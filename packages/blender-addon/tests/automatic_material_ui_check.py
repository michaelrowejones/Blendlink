# SPDX-License-Identifier: GPL-3.0-or-later
"""Artist diagnostics match automatic native-node compilation, without baking."""
import copy
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

import bpy


class RecordingLayout:
    def __init__(self, events=None):
        self.events = events if events is not None else []

    def box(self):
        return RecordingLayout(self.events)

    def row(self, **kwargs):
        return RecordingLayout(self.events)

    def label(self, *, text="", **kwargs):
        self.events.append(("label", text))

    def operator(self, name, *, text="", **kwargs):
        self.events.append(("operator", name, text))
        return SimpleNamespace()


bpy.ops.wm.read_factory_settings(use_empty=False)
addon_root = Path(__file__).resolve().parents[1]
name = "blendlink_automatic_material_ui_check"
spec = importlib.util.spec_from_file_location(
    name, addon_root / "__init__.py", submodule_search_locations=[str(addon_root)],
)
addon = importlib.util.module_from_spec(spec)
sys.modules[name] = addon
spec.loader.exec_module(addon)
addon.register()

try:
    bpy.ops.blendlink.setup_website_export()
    project = bpy.context.scene.blendlink_project
    assert project.atlases[0].bake_output == "LIGHTING"
    obj = bpy.data.objects["Cube"]
    material = bpy.data.materials.new("Native automatic graph")
    material.use_nodes = True
    obj.data.materials.clear()
    obj.data.materials.append(material)
    tree = material.node_tree
    principled = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    uv = tree.nodes.new("ShaderNodeTexCoord")
    brick = tree.nodes.new("ShaderNodeTexBrick")
    tree.links.new(uv.outputs["UV"], brick.inputs["Vector"])
    tree.links.new(brick.outputs["Color"], principled.inputs["Base Color"])
    math_node = tree.nodes.new("ShaderNodeMath")
    math_node.operation = "MULTIPLY"
    math_node.inputs[0].default_value = 0.4
    math_node.inputs[1].default_value = 0.5
    tree.links.new(math_node.outputs[0], principled.inputs["Roughness"])
    original = len(tree.nodes), len(tree.links), tuple(material.keys())

    expected = addon.material_compiler.plan_materials(
        [obj], purpose="inspect", automatic_programs=True,
    ).decisions[0].as_dict()
    assert expected["channels"]["automatic"]
    routes = {entry["channel"]: entry["route"] for entry in expected["channels"]["channels"]}
    assert routes["Base Color"] == "program", routes
    assert routes["Roughness"] == "program", routes
    addon.validation.recompute(bpy.context.scene)
    record = addon.validation.result().material_compatibility[material.name]
    assert record["materialCompilation"] == expected, record
    fidelity = [entry for entry in addon.validation.result().fidelity if entry.source == f"Material: {material.name}"]
    assert fidelity and "Native shader graph compiles automatically" in fidelity[0].detail
    assert "Web Color" not in fidelity[0].detail

    layout = RecordingLayout()
    # Native inspection is cached/debounced; drawing may only consume it.
    with patch.object(addon.material_compiler, "plan_materials", side_effect=AssertionError("Graph inspection ran during draw")):
        addon.ui._draw_material_compatibility(layout, record)
        addon.ui._draw_web_material_source(layout, record)
    text = " ".join(event[-1] for event in layout.events)
    assert "Native shader graph" in text and "automatic" in text
    assert "Base Color: Live node translation" in text
    assert "Roughness: Live node translation" in text
    assert "WebGPU or WebGL2" in text
    assert "Website Color override (optional)" in text
    assert "Website Color ready to compile" not in text
    assert "Disable TSL Program" not in text and "Disable Material Bake" not in text
    assert "does not guarantee identical Blender lighting or shading" in text

    refused = copy.deepcopy(record)
    refused["materialCompilation"]["outcome"] = "preserved"
    refused["materialCompilation"]["channels"]["channels"] = [{
        "channel": "Emission", "route": "refused", "tslIrRefusal": "Named unsupported native output",
    }]
    refused["materialCompilation"]["issues"] = [{
        "code": "material.tsl-program-unproven", "problem": "No live channel is proven.",
        "fix": "Clear the TSL Program intent.",
    }]
    layout = RecordingLayout()
    addon.ui._draw_material_compatibility(layout, refused)
    text = " ".join(event[-1] for event in layout.events)
    assert "Native shader inputs need attention" in text
    assert "Named unsupported native output" in text
    assert "Clear the TSL Program intent" not in text

    material["blendlink_live_translation"] = False
    addon.validation.recompute(bpy.context.scene)
    opted_out = addon.validation.result().material_compatibility[material.name]["materialCompilation"]
    assert opted_out["intent"] == "automatic" and opted_out["outcome"] == "preserved"
    del material["blendlink_live_translation"]
    project.atlases[0].bake_output = "APPEARANCE"
    addon.validation.recompute(bpy.context.scene)
    captured = addon.validation.result().material_compatibility[material.name]
    assert captured["appearanceBakeObjects"] == [obj.name]
    layout = RecordingLayout()
    addon.ui._draw_material_compatibility(layout, captured)
    text = " ".join(event[-1] for event in layout.events)
    assert "Native shader surface" in text and "Appearance bake" in text
    assert "static appearance" in text and "No separate node graph" in text
    assert not any(event[0] == "operator" for event in layout.events), layout.events
    blocked_capture = {**captured, "cyclesAppearance": {
        "status": "blocked", "blockers": ["EEVEE-only Shader to RGB cannot run in Cycles"],
    }}
    layout = RecordingLayout()
    addon.ui._draw_material_compatibility(layout, blocked_capture)
    text = " ".join(event[-1] for event in layout.events)
    assert "Appearance bake needs attention" in text and "EEVEE-only" in text
    assert "cannot evaluate" in text and "No separate node graph" not in text
    assert (len(tree.nodes), len(tree.links), tuple(material.keys())) == original
    # Exercise Object Info through the installed package namespace as well
    # as standalone headless imports. Its helper and animation inspection
    # must resolve siblings without relying on the addon folder in sys.path.
    project.atlases[0].bake_output = "LIGHTING"
    object_info = tree.nodes.new("ShaderNodeObjectInfo")
    tree.links.new(object_info.outputs["Color"], principled.inputs["Base Color"])
    addon.validation.recompute(bpy.context.scene)
    planned = addon.material_compiler.plan_materials([obj], purpose="inspect", automatic_programs=True)
    decision = planned.decisions[0]
    assert decision.outcome == "lowered", decision.as_dict()
    entry = addon.material_compiler._tsl_runtime_mesh_entry(decision, obj)
    assert entry["objectInfoOwner"]["color"] == list(obj.color), entry
    obj.keyframe_insert("color", frame=1)
    refused = addon.material_compiler.plan_materials([obj], purpose="inspect", automatic_programs=True)
    assert any(issue.code == "material.object-info-context-unproven" for issue in refused.errors), refused.as_dict()
finally:
    addon.unregister()

print("BLENDLINK_AUTOMATIC_MATERIAL_UI_CHECK_PASSED")
