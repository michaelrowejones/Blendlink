# SPDX-License-Identifier: GPL-3.0-or-later
"""One actual two-material mesh must merge fresh renderer requirements."""
import os
from pathlib import Path
import bpy
out=Path(os.environ['BLENDLINK_REQUIRED_RENDERER_EVIDENCE']).resolve()
bpy.ops.wm.open_mainfile(filepath=str(out/'MagicRoughness.blend'))
owner=bpy.data.objects['Magic Roughness Owner'];original=owner.data.materials[0]
mesh=bpy.data.meshes.new('Two material union mesh');mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2),(0,2,3)]);mesh.update()
uv=mesh.uv_layers.new(name='Carrier UV')
for item,value in zip(uv.data,[(0,0),(1,0),(1,1),(0,0),(1,1),(0,1)]):item.uv=value
owner.data=mesh;mesh.materials.append(original)
second=bpy.data.materials.new('Squeeze Roughness Artist');second.use_nodes=True;mesh.materials.append(second);mesh.polygons[1].material_index=1
root=next(n for n in second.node_tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled');root.inputs['Base Color'].default_value=(.25,.125,.5,1)
squeeze=second.node_tree.nodes.new('ShaderNodeSqueeze');squeeze.inputs['Value'].default_value=1;second.node_tree.links.new(squeeze.outputs['Value'],root.inputs['Roughness'])
# The same active UV layout on both materials keeps this a real shared mesh;
# this ordinary extra channel makes no new numeric/native-node claim.
coord=second.node_tree.nodes.new('ShaderNodeTexCoord');split=second.node_tree.nodes.new('ShaderNodeSeparateXYZ');second.node_tree.links.new(coord.outputs['UV'],split.inputs[0]);second.node_tree.links.new(split.outputs['X'],root.inputs['Metallic'])
bpy.ops.wm.save_as_mainfile(filepath=str(out/'MagicSqueezeMulti.blend'))
print('BLENDLINK_REQUIRED_RENDERER_MULTIMATERIAL_SOURCE_PASSED')
