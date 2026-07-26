from pathlib import Path
import sys

import bpy


output = Path(sys.argv[-1])
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
cube = bpy.context.object
cube.name = "Realtime Needs Bake"

material = bpy.data.materials.new("Autumn Shader to RGB")
material.use_nodes = True
tree = material.node_tree
tree.nodes.clear()
diffuse = tree.nodes.new("ShaderNodeBsdfDiffuse")
shader_to_rgb = tree.nodes.new("ShaderNodeShaderToRGB")
ramp = tree.nodes.new("ShaderNodeValToRGB")
emission = tree.nodes.new("ShaderNodeEmission")
output_node = tree.nodes.new("ShaderNodeOutputMaterial")
tree.links.new(diffuse.outputs["BSDF"], shader_to_rgb.inputs["Shader"])
tree.links.new(shader_to_rgb.outputs["Color"], ramp.inputs["Fac"])
tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])
tree.links.new(emission.outputs["Emission"], output_node.inputs["Surface"])
cube.data.materials.append(material)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
bpy.ops.wm.save_as_mainfile(filepath=str(output))
print(f"BLENDLINK_REALTIME_PLAN_FIXTURE {output.as_posix()}")
