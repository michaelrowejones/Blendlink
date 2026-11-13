# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Mapping graphs retain live coordinates and bounded Noise routing."""
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def refusal(work, message):
    try:
        work()
    except tsl_ir.TslIrRefusal as error:
        expect(message in str(error), f"Expected {message!r}; got {error}")
    else:
        raise AssertionError(f"Expected refusal naming {message!r}")


material = bpy.data.materials.new("Mapping Live Translation")
material.use_nodes = True
tree = material.node_tree
tree.nodes.clear()
coord = tree.nodes.new("ShaderNodeTexCoord")
mapping = tree.nodes.new("ShaderNodeMapping")
emission = tree.nodes.new("ShaderNodeEmission")
tree.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
tree.links.new(mapping.outputs["Vector"], emission.inputs["Color"])
mapping.inputs["Location"].default_value = (0.17, -0.23, 0.31)
mapping.inputs["Rotation"].default_value = (0.47, -0.81, 1.13)
mapping.inputs["Scale"].default_value = (-1.4, 0.65, 2.1)
for kind in ("POINT", "TEXTURE", "VECTOR", "NORMAL"):
    mapping.vector_type = kind
    document = tsl_ir.emit_channel(emission.inputs["Color"])
    expect(document["output"]["op"] == "mapping", f"{kind} did not remain a live Mapping expression")
    expect(document["output"]["vectorType"] == kind, "Mapping mode was lost")
    expect(abs(document["output"]["rotation"][1] + 0.81) < 1e-6, "Mapping Y rotation was lost")

mapping.vector_type = "POINT"
for name in ("Location", "Rotation", "Scale"):
    link = tree.links.new(coord.outputs["UV"], mapping.inputs[name])
    document = tsl_ir.emit_channel(emission.inputs["Color"])
    expect(document["output"][name.lower() + "Node"]["op"] == "uv_active", f"Linked {name} was flattened")
    tree.links.remove(link)

noise = tree.nodes.new("ShaderNodeTexNoise")
noise.noise_dimensions = "3D"
noise.inputs["Scale"].default_value = 5.0
noise.inputs["Detail"].default_value = 0.0
tree.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
tree.links.new(noise.outputs["Fac"], emission.inputs["Color"])
for kind, scale in (("TEXTURE", 0.01), ("POINT", 100.0), ("VECTOR", -100.0)):
    mapping.vector_type = kind
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    refusal(lambda: tsl_ir.emit_channel(emission.inputs["Color"]), "effective scale")
# Within the existing measured approximation band, metadata must survive.
mapping.vector_type = "TEXTURE"
mapping.inputs["Scale"].default_value = (0.025, 0.025, 0.025)
document = tsl_ir.emit_channel(emission.inputs["Color"])
expect(any(item["code"] == "tsl.noise-3d-scale-above-exact" for item in tsl_ir.drain_approximations()),
       "Texture inverse frequency lost its bounded-approximation declaration")
# A literal-zero axis collapses rather than becoming infinite frequency.
mapping.inputs["Scale"].default_value = (0.0, -1.0, 1.0)
document = tsl_ir.emit_channel(emission.inputs["Color"])
expect(not tsl_ir.drain_approximations(), "A collapsed texture axis invented high-frequency approximation")
expect(abs(tsl_ir._fold_vector_prescale({"op": "mapping", "vectorType": "TEXTURE", "scale": [0, -0.02, 2]}) - 50) < 1e-6,
       "Texture inverse scale did not bound the surviving coordinate axes")

# Newly admitted coordinate transforms must not bypass the existing
# Noise frequency limit through normalization or a varying transform.
mapping.vector_type = "NORMAL"
refusal(lambda: tsl_ir.emit_channel(emission.inputs["Color"]), "coordinate-frequency bound")
mapping.vector_type = "POINT"
for name in ("Location", "Rotation", "Scale"):
    link = tree.links.new(coord.outputs["UV"], mapping.inputs[name])
    refusal(lambda: tsl_ir.emit_channel(emission.inputs["Color"]), "coordinate-frequency bound")
    tree.links.remove(link)
bpy.data.materials.remove(material)
print("BLENDLINK_MAPPING_TRANSLATION_PASSED native XYZ/NORMAL modes, live transforms, inverse scales and Noise bounds")
