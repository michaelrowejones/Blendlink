# SPDX-License-Identifier: GPL-3.0-or-later
"""Exercise real Blender group links and bypass rules through the shipped extractor."""

import sys
from pathlib import Path
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blendlink/blender"))
import compositor_graph

scene = bpy.context.scene
scene.render.use_compositing = True
modern = hasattr(scene, "compositing_node_group")
if modern:
    tree = bpy.data.node_groups.new("Graph structure", "CompositorNodeTree")
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    scene.compositing_node_group = tree
    sink = tree.nodes.new("NodeGroupOutput")
else:
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    sink = tree.nodes.new("CompositorNodeComposite")
source = tree.nodes.new("CompositorNodeRLayers")
mix = tree.nodes.new("ShaderNodeMixRGB" if modern else "CompositorNodeMixRGB")
tree.links.new(source.outputs["Image"], mix.inputs[1])
tree.links.new(source.outputs["Image"], mix.inputs[2])
tree.links.new(mix.outputs[0], sink.inputs[0])
tree.nodes.new(
    "CompositorNodeLensdist"
)  # Disconnected unsupported nodes do not matter.
program = compositor_graph.extract(scene)
assert program["status"] == "extracted", program
assert [op["kind"] for op in program["ops"]] == ["render-pass", "mix-rgb"], program
assert len(program["passes"]) == 1
assert (
    program["ops"][1]["inputs"]["Color1"]["value"]
    == program["ops"][1]["inputs"]["Color2"]["value"]
)

group = bpy.data.node_groups.new("Nested bypass", "CompositorNodeTree")
group.interface.new_socket(name="Image", in_out="INPUT", socket_type="NodeSocketColor")
group.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
incoming = group.nodes.new("NodeGroupInput")
outgoing = group.nodes.new("NodeGroupOutput")
reroute = group.nodes.new("NodeReroute")
gamma = group.nodes.new("ShaderNodeGamma" if modern else "CompositorNodeGamma")
gamma.mute = True
group.links.new(incoming.outputs[0], reroute.inputs[0])
group.links.new(reroute.outputs[0], gamma.inputs[0])
group.links.new(gamma.outputs[0], outgoing.inputs[0])
instance = tree.nodes.new("CompositorNodeGroup")
instance.node_tree = group
tree.links.new(mix.outputs[0], instance.inputs[0])
tree.links.new(instance.outputs[0], sink.inputs[0])
grouped = compositor_graph.extract(scene)
assert grouped["status"] == "extracted", grouped
assert grouped["ops"] == program["ops"], grouped

gamma.mute = False
gamma.inputs["Gamma"].keyframe_insert(data_path="default_value", frame=1)
animated = compositor_graph.extract(scene)
assert animated["status"] == "unsupported", animated
assert animated["diagnostics"][-1]["code"] == "animated-tree"
assert instance.name in animated["diagnostics"][-1]["path"]
group.animation_data_clear()

other_scene = bpy.data.scenes.new("Other render")
source.scene = other_scene
tree.links.new(source.outputs["Image"], sink.inputs[0])
disabled = compositor_graph.extract(scene)
assert disabled["status"] == "unsupported", disabled
assert disabled["diagnostics"][-1]["code"] == "other-scene-pass"
print("BLENDLINK_COMPOSITOR_GRAPH_CHECK_PASSED")
