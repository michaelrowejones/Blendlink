# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual legacy HSV creatability/sockets, without assuming modern aliases."""
import json
import os
from pathlib import Path
import bpy
root=Path(os.environ['BLENDLINK_HSV_PROBE']).resolve();root.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
material=bpy.data.materials.new('Actual legacy HSV audit');material.use_nodes=True;material.use_fake_user=True;tree=material.node_tree;tree.nodes.clear()
rows=[]
for identifier in ['ShaderNodeCombineHSV','ShaderNodeSeparateHSV','ShaderNodeCombineColor','ShaderNodeSeparateColor']:
    row={'requested':identifier,'registered':hasattr(bpy.types,identifier)}
    try:
        node=tree.nodes.new(identifier)
        row.update(created=True,actual=node.bl_idname,label=node.bl_label)
        def socket(item):
            value=getattr(item,'default_value',None)
            if value is not None and not isinstance(value,(int,float,str,bool)):value=list(value)
            return {'identifier':item.identifier,'name':item.name,'class':item.bl_idname,'type':item.type,'default':value}
        row['inputs']=[socket(item) for item in node.inputs];row['outputs']=[socket(item) for item in node.outputs]
        if hasattr(node,'mode'):row['modes']=[item.identifier for item in node.bl_rna.properties['mode'].enum_items]
    except RuntimeError as error:row.update(created=False,reason=str(error))
    rows.append(row)
if bpy.app.version == (4,2,0):
    combine=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeCombineHSV')
    separate=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeSeparateHSV')
    for index,value in enumerate([.125,.75,.625]):combine.inputs[index].default_value=value
    tree.links.new(combine.outputs['Color'],separate.inputs['Color'])
    sink=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission')
    tree.links.new(separate.outputs['H'],emission.inputs['Color']);tree.links.new(emission.outputs[0],sink.inputs['Surface'])
bpy.ops.wm.save_as_mainfile(filepath=str(root/'Legacy HSV.blend'))
(root/'probe.json').write_text(json.dumps({'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'nodes':rows},indent=2))
print('BLENDLINK_LEGACY_HSV_PROBE',json.dumps(rows))
