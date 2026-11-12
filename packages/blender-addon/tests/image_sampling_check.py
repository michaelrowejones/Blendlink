# SPDX-License-Identifier: GPL-3.0-or-later
"""Image sample extraction respects source context and leaves source pixels intact."""
import json, sys
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tsl_ir
material=bpy.data.materials.new("Image sampler extraction"); material.use_nodes=True
tree=material.node_tree
image=bpy.data.images.new("Sampling input",width=2,height=2,alpha=True,float_buffer=True)
image.colorspace_settings.name="Non-Color"
image.pixels=[.2142857,.1234567,.3333333,.6666667]*4
image.update()
node=tree.nodes.new("ShaderNodeTexImage");node.image=image
coordinate=tree.nodes.new("ShaderNodeCombineXYZ")
coordinate.inputs[0].default_value=-.5
tree.links.new(coordinate.outputs[0],node.inputs["Vector"])
target=next(n for n in tree.nodes if n.bl_idname=="ShaderNodeBsdfPrincipled")
before=(tuple(image.pixels[:]),len(tree.nodes),len(tree.links),image.use_half_precision,image.users)
for engine in ["CYCLES","EEVEE"]:
 for extension in ["REPEAT","EXTEND","MIRROR","CLIP"]:
  node.extension=extension
  for interpolation in ["Closest","Linear","Cubic","Smart"]:
   node.interpolation=interpolation
   for output in ["Color","Alpha"]:
    tree.links.new(node.outputs[output],target.inputs["Base Color"])
    document=tsl_ir.emit_channel(target.inputs["Base Color"],evaluation_engine=engine)
    expression=document["output"];json.dumps(document,allow_nan=False)
    assert expression["sourceEngine"]==engine
    assert expression["extension"]==extension
    assert expression['interpolation']==('Cubic' if interpolation=='Smart' else interpolation)
    assert expression["sourceImageStorage"]==("rgba16f" if engine=="EEVEE" else "rgba32f")
    assert tuple(image.pixels[:])==before[0] and image.use_half_precision==before[3] and image.users==before[4]
image.use_half_precision=False
document=tsl_ir.emit_channel(target.inputs["Base Color"],evaluation_engine="EEVEE")
assert document["output"]["sourceImageStorage"]=="rgba32f"
assert tuple(image.pixels[:])==before[0]
image.source="SEQUENCE"
try:
    tsl_ir.emit_channel(target.inputs["Base Color"],evaluation_engine="CYCLES")
    raise AssertionError("Media image silently froze")
except tsl_ir.TslIrRefusal as error:
    assert "static FILE or GENERATED" in str(error)
print("BLENDLINK_IMAGE_SAMPLING_CHECK_PASSED engines, all extensions/filters/outputs, precision and read-only source pixels")
