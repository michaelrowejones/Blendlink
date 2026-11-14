# SPDX-License-Identifier: GPL-3.0-or-later
"""No-render inspection of actual group implicit-default source admission."""
from pathlib import Path
import json,os,sys
import bpy
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph
scene=bpy.context.scene;scene.render.compositor_device='CPU'
tree=bpy.data.node_groups.new('Owned White Noise interface admission','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
group=bpy.data.node_groups.new('Owned seed interface','CompositorNodeTree');seed=group.interface.new_socket(name='Seed',in_out='INPUT',socket_type='NodeSocketVector');group.interface.new_socket(name='Noise',in_out='OUTPUT',socket_type='NodeSocketColor')
entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');noise=group.nodes.new('ShaderNodeTexWhiteNoise');group.links.new(entry.outputs[0],noise.inputs['Vector']);group.links.new(noise.outputs['Color'],exit.inputs[0])
instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;sink=tree.nodes.new('NodeGroupOutput');tree.links.new(instance.outputs[0],sink.inputs[0])
schema={name:{'value':getattr(seed,name),'choices':[item.identifier for item in seed.bl_rna.properties[name].enum_items]}for name in ['default_input','structure_type']if name in seed.bl_rna.properties}
baseline=compositor_graph.extract(scene);rows=[{'case':'native-value-default','defaultInput':getattr(seed,'default_input',None),'program':baseline}]
for default in schema.get('default_input',{}).get('choices',[]):
    if 'UNIFORM' not in default and 'FRAME' not in default:continue
    try:
        seed.default_input=default
        group.interface_update(bpy.context)
        rows.append({'case':default,'defaultInput':seed.default_input,'structureType':seed.structure_type,'program':compositor_graph.extract(scene)})
    except Exception as error:rows.append({'case':default,'setterRefusal':str(error)})
packet={'status':'RESEARCH_ONLY_GROUP_DEFAULT_ADMISSION','schema':schema,'rows':rows,'renders':0,'gpuInitializationCalls':0,'portCredit':0}
Path(os.environ['SCENETOWEB_GROUP_DEFAULT_RESEARCH']).write_text(json.dumps(packet,indent=2)+'\n');print(json.dumps(packet))
