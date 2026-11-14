# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned5.3 no-render source admission; full field proof is separate.
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_WHITE_NOISE_FIELDS_POLICY_PASSED
"""Real source/native interface defaults, domain refusals and copy ownership."""
from pathlib import Path
from array import array
import bpy,json,sys,struct
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph,compositor_white_noise as white,compositor_static_matrix as matrix
scene=bpy.context.scene;scene.render.compositor_device='CPU';scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100
positive=[];refusals=[]
def build(dim='2D',output='Color'):
 tree=bpy.data.node_groups.new('Owned White Noise field','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
 noise=tree.nodes.new('ShaderNodeTexWhiteNoise');noise.noise_dimensions=dim;sink=tree.nodes.new('NodeGroupOutput');tree.links.new(noise.outputs[output],sink.inputs[0]);return tree,noise,sink

def scalar_sources():
 result=[]
 for tree in bpy.data.node_groups:
  for node in tree.nodes:
   if node.bl_idname=='CompositorNodeGroup'and len(node.inputs)and all(s.type=='VALUE'for s in node.inputs):
    raw=array('f',[0])*len(node.inputs);node.inputs.foreach_get('default_value',raw);result.append((node.as_pointer(),raw.tobytes()))
 return result

def extract(label,accepted):
 scalar_before=scalar_sources()
 before=matrix._ownership();frame=(scene.frame_current,scene.frame_subframe);users=[(g.as_pointer(),g.users)for g in bpy.data.node_groups]
 program=compositor_graph.extract(scene)
 assert scalar_sources()==scalar_before,label+' scalar source raw storage changed'
 assert matrix._ownership()==before and frame==(scene.frame_current,scene.frame_subframe)and users==[(g.as_pointer(),g.users)for g in bpy.data.node_groups],label
 assert program['status']==('extracted'if accepted else'unsupported'),(label,program)
 if accepted:positive.append(label)
 else:
  assert any('white-noise'in d['code']or d['code']=='animated-tree'for d in program['diagnostics']),(label,program);refusals.append(label)
 return program
for precision in ['AUTO','FULL']:
 scene.render.compositor_precision=precision
 for dimension in ['2D','3D','4D']:
  for output in ['Value','Color']:
   tree,node,sink=build(dimension,output);program=extract(dimension+'-'+output+'-'+precision,True);op=program['ops'][-1]
   assert op['properties']['white_noise_model']==white.FIELD_MODEL and op['properties']['white_noise_coordinate_model']==white.FIELD_COORDINATES
   assert 'Vector'not in op['inputs']and op['properties']['white_noise_export_extent']==[13,9]
   assert len(op['inputs'])==(1 if dimension=='4D'else 0)
# Stored Vector defaults are not implicit coordinates. Mutating them changes
# neither the source-field marker nor introduces a literal Vector payload.
tree,node,sink=build();node.inputs['Vector'].default_value=(.125,.5,-.75);program=extract('implicit-ignores-stored-vector-default',True);assert 'Vector'not in program['ops'][-1]['inputs']
# 1D remains genuinely fixed/single; no axis table model is emitted.
tree,node,sink=build('1D');program=extract('1D-fixed-unchanged',True);assert program['ops'][-1]['properties']['white_noise_model']==white.MODEL
# 4D W retains raw normal/+0 rules at each source copy boundary.
for label,word,accepted in [('positive-zero',0,True),('min-normal',0x00800000,True),('negative-min-normal',0x80800000,True),('maximum-normal',0x7f7fffff,True),('negative-zero',0x80000000,False),('subnormal',1,False),('nan',0x7fc12345,False)]:
 tree,node,sink=build('4D')
 # Active native sockets Vector3+W are homogeneous Float RNA arrays but not a
 # homogeneous scalar collection. from_socket copies raw W without promotion.
 group=bpy.data.node_groups.new('Owned W raw','CompositorNodeTree');item=group.interface.new_socket(name='W',in_out='INPUT',socket_type='NodeSocketFloat');group.interface.new_socket(name='Noise',in_out='OUTPUT',socket_type='NodeSocketColor');entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');inside=group.nodes.new('ShaderNodeTexWhiteNoise');inside.noise_dimensions='4D';group.links.new(entry.outputs[0],inside.inputs['W']);group.links.new(inside.outputs['Color'],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group
 values=array('f');values.frombytes(struct.pack('=I',word));instance.inputs.foreach_set('default_value',values);tree.links.new(instance.outputs[0],sink.inputs[0]);extract('W-'+label,accepted)
for label,apply,restore in [
 ('border',lambda:setattr(scene.render,'use_border',True),lambda:setattr(scene.render,'use_border',False)),
 ('crop-border',lambda:setattr(scene.render,'use_crop_to_border',True),lambda:setattr(scene.render,'use_crop_to_border',False)),
 ('pixel-aspect',lambda:setattr(scene.render,'pixel_aspect_x',2),lambda:setattr(scene.render,'pixel_aspect_x',1)),
 ('small-extent',lambda:setattr(scene.render,'resolution_percentage',10),lambda:setattr(scene.render,'resolution_percentage',100)),
 ('large-extent',lambda:setattr(scene.render,'resolution_x',8193),lambda:setattr(scene.render,'resolution_x',13)),
 ('GPU',lambda:setattr(scene.render,'compositor_device','GPU'),lambda:setattr(scene.render,'compositor_device','CPU'))]:
 tree,node,sink=build();apply();extract(label,False);restore()
# The field route never intercepts a linked group implicit default.
tree,node,sink=build();group=bpy.data.node_groups.new('Owned implicit Vector group','CompositorNodeTree');item=group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketVector');item.default_input='UNIFORM_IMAGE_COORDINATES';group.interface.new_socket(name='Noise',in_out='OUTPUT',socket_type='NodeSocketColor');entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');inside=group.nodes.new('ShaderNodeTexWhiteNoise');group.links.new(entry.outputs[0],inside.inputs['Vector']);group.links.new(inside.outputs['Color'],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(instance.outputs[0],sink.inputs[0]);extract('linked-group-implicit-still-refuses',False)
for kind in ['CompositorNodeFlip','CompositorNodeBlur']:
 tree,node,sink=build();effect=tree.nodes.new(kind);target=next(s for s in effect.inputs if s.identifier=='Image');tree.links.new(node.outputs['Color'],target);tree.links.new(effect.outputs[0],sink.inputs[0]);extract('spatial-'+kind,False)
tree,node,sink=build('4D');node.inputs['W'].keyframe_insert('default_value',frame=1);extract('animated-tree',False);tree.animation_data_clear()
# Presentation budget derives actual display descriptors: shared axes count1,
# independently of how many White Noise nodes use the same table.
from compositor_mask_domains import validate_mask_presentation
tree,node,sink=build();program=extract('presentation-shared-table-source',True)
for count in [7,8]:
 presentation={'compositor':program,'display':{'ops':[{'type':'Lut3DTransform'}for _ in range(count)]}}
 assert (validate_mask_presentation(presentation)is None)==(count==7)

# Source addon/canonical package aliases must see the same field model and
# produce the same graph; source import fallback is independently exercised.
import importlib,types
alias='scenetoweb_white_field_source_alias';package=types.ModuleType(alias);package.__path__=[str(ROOT/'packages/blendlink/blender')];sys.modules[alias]=package
aliased=importlib.import_module(alias+'.compositor_graph');before=matrix._ownership();assert aliased.extract(scene)==compositor_graph.extract(scene);assert before==matrix._ownership();positive.append('source-addon-package-alias')
print('BLENDLINK_COMPOSITOR_WHITE_NOISE_FIELDS_POLICY_PASSED '+json.dumps({'positive':positive,'refusals':refusals,'renders':0,'gpuInitializationCalls':0,'portCredit':0}))
