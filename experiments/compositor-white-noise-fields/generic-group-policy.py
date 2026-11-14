# SPDX-License-Identifier: GPL-3.0-or-later
"""Concrete independent leaf-path and public cross-context interface probes."""
from pathlib import Path
import json,os,sys
import bpy
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph
scene=bpy.context.scene;scene.render.compositor_device='CPU';rows=[]

def build(case,socket_type,default,operation):
    tree=bpy.data.node_groups.new('Owned generic '+case,'CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
    group=bpy.data.node_groups.new('Owned inner '+case,'CompositorNodeTree');seed=group.interface.new_socket(name='Seed',in_out='INPUT',socket_type=socket_type);seed.default_input=default;group.interface.new_socket(name='Result',in_out='OUTPUT',socket_type='NodeSocketFloat')
    entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput')
    if operation=='math':
        node=group.nodes.new('ShaderNodeMath');node.operation='ADD';node.inputs[1].default_value=.25;group.links.new(entry.outputs[0],node.inputs[0]);terminal=node.outputs[0]
    elif operation=='vector':
        node=group.nodes.new('ShaderNodeSeparateXYZ');group.links.new(entry.outputs[0],node.inputs[0]);terminal=node.outputs['X']
    elif operation=='selector':
        node=group.nodes.new('GeometryNodeIndexSwitch');node.data_type='FLOAT';node.inputs[1].default_value=.25;node.inputs[2].default_value=.75;group.links.new(entry.outputs[0],node.inputs['Index']);terminal=node.outputs[0]
    elif operation=='matrix':
        combine=group.nodes.new('FunctionNodeCombineMatrix');separate=group.nodes.new('FunctionNodeSeparateMatrix');group.links.new(entry.outputs[0],combine.inputs[0]);group.links.new(combine.outputs[0],separate.inputs[0]);terminal=separate.outputs[0]
    elif operation=='quaternion':
        combine=group.nodes.new('FunctionNodeQuaternionToRotation');combine.inputs['X'].default_value=1;separate=group.nodes.new('FunctionNodeRotationToQuaternion');group.links.new(entry.outputs[0],combine.inputs['W']);group.links.new(combine.outputs[0],separate.inputs[0]);terminal=separate.outputs['W']
    group.links.new(terminal,exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;sink=tree.nodes.new('NodeGroupOutput');tree.links.new(instance.outputs[0],sink.inputs[0]);return tree,group,seed,instance

for case,kind,default,operation in [('math-frame','NodeSocketFloat','SCENE_FRAME','math'),('vector-uniform','NodeSocketVector','UNIFORM_IMAGE_COORDINATES','vector'),('selector-frame','NodeSocketInt','SCENE_FRAME','selector'),('matrix-frame','NodeSocketFloat','SCENE_FRAME','matrix'),('quaternion-frame','NodeSocketFloat','SCENE_FRAME','quaternion')]:
    scene.frame_set(2 if operation=='quaternion'else 1)
    tree,group,seed,instance=build(case,kind,default,operation);program=compositor_graph.extract(scene)
    rows.append({'case':case,'sourceDefault':seed.default_input,'structure':seed.structure_type,'frame':scene.frame_current,'program':program})

copies=[]
for structure in ['FIELD','GRID','DYNAMIC','LIST']:
    geometry=bpy.data.node_groups.new('Owned geometry interface '+structure,'GeometryNodeTree');source=geometry.interface.new_socket(name='Seed',in_out='INPUT',socket_type='NodeSocketFloat')
    try:source.structure_type=structure
    except (TypeError,ValueError)as error:copies.append({'structure':structure,'geometrySetterRefusal':str(error)});continue
    tree,group,seed,instance=build('copied-'+structure,'NodeSocketFloat','VALUE','math')
    try:
        copied=group.interface.copy(source);group.interface_update(bpy.context)
        value=tree.nodes.new('ShaderNodeValue');value.outputs[0].default_value=.25;tree.links.new(value.outputs[0],instance.inputs[copied.identifier])
        # Route the copied input, not the original ordinary interface member.
        entry=next(node for node in group.nodes if node.bl_idname=='NodeGroupInput');math_node=next(node for node in group.nodes if node.bl_idname=='ShaderNodeMath');group.links.new(entry.outputs[copied.identifier],math_node.inputs[0])
        copies.append({'structure':structure,'nativeCopiedStructure':copied.structure_type,'nativeDefault':copied.default_input,'linked':instance.inputs[copied.identifier].is_linked,'program':compositor_graph.extract(scene)})
    except Exception as error:copies.append({'structure':structure,'publicCopyRefusal':str(error)})
packet={'status':'RESEARCH_ONLY_GENERIC_GROUP_DEFAULT_LEAVES','rows':rows,'publicStructureCopies':copies,'renders':0,'gpuInitializationCalls':0,'portCredit':0}
Path(os.environ['SCENETOWEB_GENERIC_GROUP_RESEARCH']).write_text(json.dumps(packet,indent=2)+'\n');print(json.dumps(packet))
