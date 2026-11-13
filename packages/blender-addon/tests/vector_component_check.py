# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual Get Vector Component schema, fixed selection, refusals and packed source."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import zipfile

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blendlink/blender"))
import tsl_ir
import vector_component_ir
import material_compiler as compiler

contexts = []
for kind in ("ShaderNodeTree", "CompositorNodeTree", "GeometryNodeTree"):
    tree = bpy.data.node_groups.new("Private component schema", kind)
    record = {"tree": kind}
    try:
        node = tree.nodes.new("FunctionNodeGetVectorComponent")
    except RuntimeError as error:
        record.update(available=False, reason=str(error).strip())
    else:
        record.update(available=True, inputs=[(socket.identifier, socket.type) for socket in node.inputs],
            outputs=[(socket.identifier, socket.type) for socket in node.outputs])
        assert record["inputs"] == [("Vector", "VECTOR"), ("Index", "INT")], record
        assert record["outputs"] == [("Value", "VALUE")], record
        for index in (-2147483648, -1, 0, 1, 2, 3, 2147483647):
            node.inputs["Index"].default_value = index
            assert node.inputs["Index"].default_value == index
    contexts.append(record)
    bpy.data.node_groups.remove(tree)

checks = {"native": bpy.app.version_string, "version": list(bpy.app.version), "hash": bpy.app.build_hash.decode(),
    "contexts": contexts, "numericalCases": 0}
if not contexts[0]["available"]:
    assert bpy.app.version[:3] in ((4, 2, 0), (5, 2, 0)), checks
    assert all(not context["available"] for context in contexts), checks
    checks["status"] = "native-node-absent"
else:
    assert bpy.app.version[:3] == (5, 3, 0)
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    mesh = bpy.data.meshes.new("Component owner mesh")
    mesh.from_pydata([(-1, -1, 0), (1, -1, 0), (0, 1, 0)], [], [(0, 1, 2)]); mesh.update()
    uv = mesh.uv_layers.new(name="Component authored UV")
    for item, value in zip(uv.data, [(0, 0), (1, 0), (.5, 1)]): item.uv = value
    owner = bpy.data.objects.new("Component actual owner", mesh); bpy.context.scene.collection.objects.link(owner)
    material = bpy.data.materials.new("Native component material"); material.use_nodes = True; mesh.materials.append(material)
    tree = material.node_tree; surface = next(node for node in tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
    component = tree.nodes.new("FunctionNodeGetVectorComponent"); tree.links.new(component.outputs[0], surface.inputs["Base Color"])
    component.inputs["Vector"].default_value = (-2, .25, 8)
    def emit(): return tsl_ir.emit_channel(surface.inputs["Base Color"])
    def refused(phrase):
        try: emit()
        except tsl_ir.TslIrRefusal as error: assert phrase in str(error), str(error)
        else: raise AssertionError("Unqualified component selection silently admitted: " + phrase)
    def state():
        return (repr([(node.bl_idname, node.name, [(socket.identifier, repr(getattr(socket, "default_value", None))) for socket in node.inputs]) for node in tree.nodes]),
            tuple((link.from_node.name, link.from_socket.identifier, link.to_node.name, link.to_socket.identifier) for link in tree.links),
            len(bpy.data.materials), len(bpy.data.images), len(bpy.data.node_groups))
    def plan():
        before = state(); result = compiler.plan_materials([owner], purpose="final", automatic_programs=True)
        assert state() == before, "Planning changed the authored source"
        return result
    before = (len(tree.nodes), len(tree.links), len(bpy.data.images), len(bpy.data.node_groups))
    for index in range(3):
        component.inputs["Index"].default_value = index
        assert emit()["output"] == {"op": "separate", "channel": "xyz"[index], "input": {"op": "const_vec3", "value": [-2, .25, 8]}}, emit()
    assert before == (len(tree.nodes), len(tree.links), len(bpy.data.images), len(bpy.data.node_groups))
    original = vector_component_ir._source_version
    versions = [(4, 2, 0), (5, 2, 0), (5, 3, 1), (5, 4, 0), (6, 0, 0)]
    try:
        for version in versions:
            vector_component_ir._source_version = lambda: version
            refused("qualified Blender 5.3.0")
    finally: vector_component_ir._source_version = original
    # Mutation tests at the lowering boundary supplement the actual RNA probe;
    # they are not described as additional native node schemas.
    schemas = [([("Vector", "RGBA"), ("Index", "INT")], [("Value", "VALUE")]),
        ([("Vector", "VECTOR"), ("Index", "VALUE")], [("Value", "VALUE")]),
        ([("Vector", "VECTOR"), ("Index", "INT")], [("Result", "VALUE")]),
        ([("Vector", "VECTOR"), ("Index", "INT"), ("Future", "INT")], [("Value", "VALUE")])]
    for inputs, outputs in schemas:
        changed = SimpleNamespace(inputs=[SimpleNamespace(identifier=name, type=kind) for name, kind in inputs],
            outputs=[SimpleNamespace(identifier=name, type=kind) for name, kind in outputs])
        def fail(message): raise tsl_ir.TslIrRefusal(message)
        try: vector_component_ir.emit_vector_component(changed, component.outputs[0], lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("Schema bypassed validation")), fail)
        except tsl_ir.TslIrRefusal as error: assert "socket schema" in str(error), error
        else: raise AssertionError("Unmeasured socket schema silently admitted")
    for index in (-2147483648, -1, 3, 2147483647):
        component.inputs["Index"].default_value = index; refused("out-of-range")
    literal = tree.nodes.new("FunctionNodeInputInt")
    tree.links.new(literal.outputs[0], component.inputs["Index"])
    for index in range(3):
        literal.integer = index; assert emit()["output"]["channel"] == "xyz"[index]
    reroute = tree.nodes.new("NodeReroute"); tree.links.new(literal.outputs[0], reroute.inputs[0]); tree.links.new(reroute.outputs[0], component.inputs["Index"])
    for index in range(3):
        literal.integer = index; assert emit()["output"]["channel"] == "xyz"[index]
    scalar = tree.nodes.new("ShaderNodeValue"); scalar.outputs[0].default_value = 1
    tree.links.new(scalar.outputs[0], component.inputs["Index"]); refused("dynamic or computed")
    boolean = tree.nodes.new("FunctionNodeInputBool"); boolean.boolean = True
    tree.links.new(boolean.outputs[0], component.inputs["Index"]); refused("dynamic or computed")
    arithmetic = tree.nodes.new("FunctionNodeIntegerMath"); arithmetic.operation = "ADD"
    arithmetic.inputs[0].default_value = 1; arithmetic.inputs[1].default_value = 1
    tree.links.new(arithmetic.outputs[0], component.inputs["Index"]); refused("dynamic or computed")
    coordinate = tree.nodes.new("ShaderNodeTexCoord"); separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coordinate.outputs["UV"], separate.inputs[0]); tree.links.new(separate.outputs[0], component.inputs["Index"])
    refused("dynamic or computed")
    tree.links.remove(component.inputs["Index"].links[0]); component.inputs["Index"].default_value = 1
    tree.links.new(coordinate.outputs["UV"], component.inputs["Vector"])
    result = plan(); assert not result.errors, result.as_dict()
    assert any("tslIr" in channel and '"channel": "y"' in json.dumps(channel["tslIr"])
        for channel in result.decisions[0].channel_plan["channels"]), result.as_dict()
    for index in range(3):
        literal.integer = index
        for output in (literal.outputs[0], reroute.outputs[0]):
            tree.links.new(output, component.inputs["Index"])
            result = plan(); assert not result.errors, result.as_dict()
            assert any("tslIr" in channel for channel in result.decisions[0].channel_plan["channels"]), result.as_dict()
    group = bpy.data.node_groups.new("Component fixed selector group", "ShaderNodeTree")
    group.interface.new_socket(name="Vector", in_out="INPUT", socket_type="NodeSocketVector")
    group.interface.new_socket(name="Index", in_out="INPUT", socket_type="NodeSocketInt")
    group.interface.new_socket(name="Value", in_out="OUTPUT", socket_type="NodeSocketFloat")
    incoming = group.nodes.new("NodeGroupInput"); outgoing = group.nodes.new("NodeGroupOutput")
    nested = group.nodes.new("FunctionNodeGetVectorComponent")
    group.links.new(incoming.outputs["Vector"], nested.inputs["Vector"]); group.links.new(incoming.outputs["Index"], nested.inputs["Index"])
    group.links.new(nested.outputs[0], outgoing.inputs[0]); instance = tree.nodes.new("ShaderNodeGroup"); instance.node_tree = group
    tree.links.new(coordinate.outputs["UV"], instance.inputs["Vector"]); tree.links.new(instance.outputs[0], surface.inputs["Base Color"])
    for index in range(3):
        instance.inputs["Index"].default_value = index
        assert emit()["output"] == {"op": "separate", "channel": "xyz"[index], "input": {"op": "uv_active"}}, emit()
        result = plan(); assert not result.errors, result.as_dict()
        assert any("tslIr" in channel for channel in result.decisions[0].channel_plan["channels"]), result.as_dict()
        literal.integer = index; tree.links.new(literal.outputs[0], instance.inputs["Index"])
        assert emit()["output"]["channel"] == "xyz"[index]
        result = plan(); assert not result.errors, result.as_dict()
        assert any("tslIr" in channel for channel in result.decisions[0].channel_plan["channels"]), result.as_dict()
        tree.links.remove(instance.inputs["Index"].links[0])
    tree.links.new(separate.outputs[0], instance.inputs["Index"]); refused("dynamic or computed")
    tree.links.remove(instance.inputs["Index"].links[0])
    instance.inputs["Index"].default_value = 1
    instance.inputs["Index"].keyframe_insert(data_path="default_value", frame=1)
    refused("animation or drivers"); tree.animation_data_clear()
    literal.integer = 1; tree.links.new(literal.outputs[0], instance.inputs["Index"])
    source = os.environ.get("BLENDLINK_VECTOR_COMPONENT_PACKAGED_ADDON")
    if source:
        with tempfile.TemporaryDirectory(prefix="blendlink-component-packed-") as temporary:
            root = Path(temporary); archive = root / "blendlink.zip"; installed = root / "isolated_component_addon"
            with zipfile.ZipFile(archive, "w") as bundle:
                for path in Path(source).rglob("*"):
                    if path.is_file() and "__pycache__" not in path.parts: bundle.write(path, path.relative_to(source))
            with zipfile.ZipFile(archive) as bundle: bundle.extractall(installed)
            assert (installed / "vector_component_ir.py").is_file()
            spec = importlib.util.spec_from_file_location("isolated_component_addon", installed / "__init__.py", submodule_search_locations=[str(installed)])
            package = importlib.util.module_from_spec(spec); sys.modules[spec.name] = package; spec.loader.exec_module(package)
            packed = __import__("isolated_component_addon.tsl_ir", fromlist=["emit_channel"])
            assert Path(packed.__file__).resolve().is_relative_to(installed.resolve())
            assert packed.emit_channel(surface.inputs["Base Color"]) == emit()
            packed_compiler = __import__("isolated_component_addon.material_compiler", fromlist=["plan_materials"])
            before = state(); result = packed_compiler.plan_materials([owner], purpose="final", automatic_programs=True)
            assert before == state(), "Packed-source planning changed the authored source"
            assert not result.errors, result.as_dict()
            assert any("tslIr" in channel for channel in result.decisions[0].channel_plan["channels"]), result.as_dict()
            checks["packedSourcePlan"] = "qualified"
    checks["status"] = "qualified-source-selection"
    checks.update(fixedIndices=[0, 1, 2], fixedSelectorTransport=["unlinked", "typed-int", "reroute", "group-default", "group-typed-int"],
        sourcePreserved=True, refusals={"invalidIndices": [-2147483648, -1, 3, 2147483647], "computed": True,
            "dynamic": True, "float": True, "boolean": True, "groupDynamic": True, "animation": True,
            "unmeasuredVersions": [list(version) for version in versions], "socketSchemaMutations": len(schemas)})
destination = os.environ.get("BLENDLINK_VECTOR_COMPONENT_SCHEMA")
if destination:
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    Path(destination).write_text(json.dumps(checks, indent=2))
print("BLENDLINK_VECTOR_COMPONENT_SOURCE " + json.dumps(checks))
print("BLENDLINK_VECTOR_COMPONENT_CHECK_PASSED")
