# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual fixed compositor component selections and independent XYZ controls."""
import hashlib
import json
import os
import sys
import tempfile
from types import SimpleNamespace
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference
import compositor_graph


def state(tree):
    def plain(value):
        if value is None or isinstance(value, (str, bool, int, float)):
            return value
        if isinstance(value, bpy.types.ID):
            return [value.bl_rna.identifier, value.name_full]
        return list(value)
    return repr(([(node.name, node.bl_idname,
        [[(socket.identifier, plain(getattr(socket, "default_value", None))) for socket in sockets] for sockets in [node.inputs, node.outputs]],
        [(name, plain(getattr(node, name))) for name in ("vector", "integer", "operation") if hasattr(node, name)])
        for node in tree.nodes], [(link.from_node.name, link.from_socket.identifier,
        link.to_node.name, link.to_socket.identifier) for link in tree.links]))


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    probe = bpy.data.node_groups.new("Actual compositor component availability", "CompositorNodeTree")
    available = True
    try:
        probe.nodes.new("FunctionNodeGetVectorComponent")
    except RuntimeError as error:
        available = False
        absence = str(error)
    bpy.data.node_groups.remove(probe)
    qualification = {"schemaVersion": 1, "kind": "blendlink-compositor-vector-component-v1", "native": bpy.app.version_string, "hash": bpy.app.build_hash.decode(),
        "sourceVersion": list(bpy.app.version[:3]), "device": os.environ.get("BLENDLINK_COMPOSITOR_COMPONENT_DEVICE", "CPU"),
        "available": available, "selectionCases": 0, "pairedSeparateCases": 0, "controlCases": 0}
    source_files = [Path(__file__), Path(compositor_graph.__file__),
        Path(compositor_graph._sibling("compositor_vector_component").__file__), Path(__file__).with_name("compositor_component_packaged.py")]
    qualification["sourceSha256"] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in source_files}
    if not available:
        assert bpy.app.version[:3] in {(4, 2, 0), (5, 2, 0)}, qualification
        qualification.update(status="native-node-absent", reason=absence)
        (output / "index.json").write_text("[]\n")
        print("BLENDLINK_COMPOSITOR_COMPONENT_NATIVE_ABSENT numericalComponentCases=0")
    else:
        assert bpy.app.version[:3] == (5, 3, 0), qualification
        pixels = np.random.default_rng(725351).uniform(-4, 8, (7, 13, 4)).astype(np.float32)
        pixels[0, :4, :3] = [[2**-120, -2**-120, 2**-126], [2**80, -2**80, .125],
            [-0., 0., -.33333334], [2**-130, -2**-130, 2**-149]]
        oracle = NativeCompositorReference(output, device=qualification["device"], pixels=pixels,
            name="Native fixed component", image_only_scene=True)
        tree = oracle.tree
        pairs = []
        def save(label, source):
            before = state(tree), [(group.name, state(group)) for group in bpy.data.node_groups]
            program = compositor_graph.extract(oracle.scene)
            assert program["status"] == "extracted", program
            assert before == (state(tree), [(group.name, state(group)) for group in bpy.data.node_groups]), "Extraction changed the source"
            oracle.save(label, source, exact_alpha=True)
            return json.loads((output / (oracle.rows[-1]["case"] + ".json")).read_text())
        sink, source = oracle.reset(); tree.links.new(source.outputs["Image"], sink.inputs[0])
        save("component-independent-image", source)
        sink, source = oracle.reset(); tree.links.new(oracle.color((.25, .5, .75, 1)), sink.inputs[0])
        save("component-independent-constant", source)
        def graph(vector, index, transport, separate=False, amplify=False):
            sink, source = oracle.reset()
            if separate:
                node = tree.nodes.new("ShaderNodeSeparateXYZ")
                target, result = node.inputs[0], node.outputs["XYZ"[index]]
            elif transport.startswith("group"):
                group = bpy.data.node_groups.new("Fixed component transport", "CompositorNodeTree")
                group.interface.new_socket(name="Vector", in_out="INPUT", socket_type="NodeSocketVector")
                group.interface.new_socket(name="Index", in_out="INPUT", socket_type="NodeSocketInt")
                group.interface.new_socket(name="Value", in_out="OUTPUT", socket_type="NodeSocketFloat")
                incoming, outgoing = group.nodes.new("NodeGroupInput"), group.nodes.new("NodeGroupOutput")
                nested = group.nodes.new("FunctionNodeGetVectorComponent")
                group.links.new(incoming.outputs["Vector"], nested.inputs["Vector"])
                group.links.new(incoming.outputs["Index"], nested.inputs["Index"])
                group.links.new(nested.outputs[0], outgoing.inputs[0])
                node = tree.nodes.new("CompositorNodeGroup"); node.node_tree = group
                target, result = node.inputs["Vector"], node.outputs[0]
            else:
                node = tree.nodes.new("FunctionNodeGetVectorComponent")
                target, result = node.inputs["Vector"], node.outputs[0]
            if not separate:
                node.inputs["Index"].default_value = index
                if transport in {"literal", "group-literal", "reroute"}:
                    literal = tree.nodes.new("FunctionNodeInputInt"); literal.integer = index
                    selected = literal.outputs[0]
                    if transport == "reroute":
                        reroute = tree.nodes.new("NodeReroute"); tree.links.new(selected, reroute.inputs[0]); selected = reroute.outputs[0]
                    tree.links.new(selected, node.inputs["Index"])
            if vector == "field":
                tree.links.new(source.outputs["Image"], target)
            else:
                target.default_value = vector
            if amplify:
                multiply = tree.nodes.new("ShaderNodeMath"); multiply.operation = "MULTIPLY"
                tree.links.new(result, multiply.inputs[0]); multiply.inputs[1].default_value = 2**100
                result = multiply.outputs[0]
            tree.links.new(result, sink.inputs[0])
            return source
        for v, vector in enumerate([(-2, .33333334, 8), (2**-120, -2**-120, 2**-126), (2**80, -2**80, .125), "field"]):
            for index in range(3):
                for transport in ["default", "literal", "reroute", "group-default", "group-literal"]:
                    label = f"component-{v}-{index}-{transport}"
                    selected = save(label, graph(vector, index, transport))
                    control = save(label + "-separate", graph(vector, index, transport, separate=True))
                    a, b = (np.asarray(record["expected"], np.float32).view(np.uint32) for record in [selected, control])
                    assert np.array_equal(a, b), label
                    pairs.append({"selection": selected["case"], "separate": control["case"], "nativeWordMismatches": 0})
        for index in range(3):
            label = f"component-amplified-{index}"
            vector = (2**-120, -2**-120, 2**-126)
            selected = save(label, graph(vector, index, "default", amplify=True))
            control = save(label + "-separate", graph(vector, index, "default", separate=True, amplify=True))
            assert selected["expected"] == control["expected"], label
            pairs.append({"selection": selected["case"], "separate": control["case"], "nativeWordMismatches": 0})
        refusals = []
        for index in [-2147483648, -1, 3, 2147483647]:
            graph((.25, .5, .75), 0, "default")
            node = next(node for node in tree.nodes if node.bl_idname == "FunctionNodeGetVectorComponent")
            node.inputs["Index"].default_value = index
            before = state(tree)
            program = compositor_graph.extract(oracle.scene)
            assert program["status"] == "unsupported" and state(tree) == before, program
            assert program["diagnostics"][-1]["code"] == "unsupported-vector-component", program
            refusals.append({"index": index, "program": program})
        for selector_kind in ["float", "boolean", "computed", "field", "group-field", "animated", "version"]:
            source = graph((.25, .5, .75), 0, "group-default" if selector_kind == "group-field" else "default")
            node = next(node for node in tree.nodes if node.bl_idname in {"FunctionNodeGetVectorComponent", "CompositorNodeGroup"})
            if selector_kind in {"float", "group-field"}:
                value = oracle.value(1)
            elif selector_kind == "boolean":
                literal = tree.nodes.new("FunctionNodeInputBool"); literal.boolean = True; value = literal.outputs[0]
            elif selector_kind == "computed":
                arithmetic = tree.nodes.new("FunctionNodeIntegerMath"); arithmetic.operation = "ADD"
                arithmetic.inputs[0].default_value = arithmetic.inputs[1].default_value = 1
                value = arithmetic.outputs[0]
            elif selector_kind == "field":
                value = oracle.separate(source.outputs["Image"]).outputs["Red"]
            else:
                value = None
            if value is not None:
                tree.links.new(value, node.inputs["Index"])
            if selector_kind == "animated":
                node.inputs["Index"].keyframe_insert(data_path="default_value", frame=1)
            helper = compositor_graph._sibling("compositor_vector_component")
            original_version = helper._source_version
            try:
                if selector_kind == "version": helper._source_version = lambda: (5, 3, 1)
                before = state(tree)
                program = compositor_graph.extract(oracle.scene)
                assert program["status"] == "unsupported" and state(tree) == before, (selector_kind, program)
            finally:
                helper._source_version = original_version
            if tree.animation_data is not None: tree.animation_data_clear()
            refusals.append({"selector": selector_kind, "program": program})
        # Independent schema mutations exercise the pre-read guard, without
        # presenting these artificial schemas as native availability evidence.
        for inputs, outputs in [([], [("Value", "VALUE")]),
                ([("Vector", "RGBA"), ("Index", "INT")], [("Value", "VALUE")]),
                ([("Vector", "VECTOR"), ("Index", "VALUE")], [("Value", "VALUE")]),
                ([("Vector", "VECTOR"), ("Index", "INT")], [("Result", "VALUE")])]:
            fake = SimpleNamespace(inputs=[SimpleNamespace(identifier=name, type=kind) for name, kind in inputs],
                outputs=[SimpleNamespace(identifier=name, type=kind) for name, kind in outputs])
            def refuse(_socket, message): raise ValueError(message)
            try:
                helper.normalize_vector_component(fake, SimpleNamespace(identifier="Value"), {},
                    lambda _socket: (_ for _ in ()).throw(AssertionError("Schema guard read an input")), [], refuse)
            except ValueError as error:
                assert "socket schema" in str(error)
            else:
                raise AssertionError("Unknown compositor component schema admitted")
        from compositor_component_packaged import verify_packaged_component
        packaged = os.environ.get("BLENDLINK_COMPOSITOR_COMPONENT_PACKAGED_ADDON")
        if packaged is None:
            packaged = str(Path(__file__).resolve().parents[2] / "blendlink/dist/addon")
        package_proof = verify_packaged_component(packaged, oracle.scene, graph,
            lambda: (state(tree), [(group.name, state(group)) for group in bpy.data.node_groups]), compositor_graph)
        (output / "refusals.json").write_text(json.dumps(refusals, indent=2))
        oracle.finish("BLENDLINK_COMPOSITOR_COMPONENT_NATIVE_COMPLETE")
        qualification.update(status="qualified-fixed-selection", selectionCases=len(pairs), pairedSeparateCases=len(pairs), controlCases=2,
            pairs=pairs, sourcePreserved=True, nativeWordMismatches=0, schemaRefusalCases=4, packedSource=package_proof,
            sourceEngine=oracle.scene.render.engine, nativeGpuProfile=compositor_graph._sibling("compositor_difference_key").native_gpu_profile(),
            sourceSha256={path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in [Path(__file__),
                Path(compositor_graph.__file__), Path(compositor_graph._sibling("compositor_vector_component").__file__), Path(__file__).with_name("compositor_component_packaged.py")]})
    (output / "qualification.json").write_text(json.dumps(qualification, indent=2))
    print("BLENDLINK_COMPOSITOR_VECTOR_COMPONENT_PASSED", json.dumps({key: value for key, value in qualification.items() if key != "pairs"}))


destination = os.environ.get("BLENDLINK_COMPOSITOR_COMPONENT_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-component-") as directory:
        main(Path(directory))
