# SPDX-License-Identifier: GPL-3.0-or-later
"""Static shared Vector input uses its native property, and animation refuses."""
import sys
from pathlib import Path
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir

material=bpy.data.materials.new('Native Shared Vector Input');material.use_nodes=True
tree=material.node_tree
try:
    vector=tree.nodes.new('FunctionNodeInputVector')
except RuntimeError:
    print('BLENDLINK_VECTOR_INPUT_NOT_APPLICABLE')
else:
    root=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeBsdfPrincipled')
    tree.links.new(vector.outputs[0],root.inputs['Base Color'])
    for values in [(0,0,0),(.25,.5,.75),(-2,.3,1.5),(-1.234567,.3333333,2**-24)]:
        vector.vector=values
        before=(len(tree.nodes),len(tree.links),len(bpy.data.node_groups))
        document=tsl_ir.emit_channel(root.inputs['Base Color'])
        assert document['output']=={'op':'const_vec3','value':list(vector.vector)},document
        assert before==(len(tree.nodes),len(tree.links),len(bpy.data.node_groups))
    vector.keyframe_insert(data_path='vector',index=0,frame=1)
    try:tsl_ir.emit_channel(root.inputs['Base Color'])
    except tsl_ir.TslIrRefusal as error:assert 'animation' in str(error),error
    else:raise AssertionError('Animated shared Vector input silently froze')
bpy.data.materials.remove(material)
print('BLENDLINK_VECTOR_INPUT_CHECK_PASSED')
