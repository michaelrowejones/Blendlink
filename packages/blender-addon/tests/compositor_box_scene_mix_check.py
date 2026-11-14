# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual No-render exact Box scene ABI and generic regression.
import bpy,json,sys,struct
from array import array
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import compositor_graph
from compositor_ellipse_scene_mix import MODEL,box_scene_mix_contract,ellipse_scene_mix_contract
from compositor_mask_domains import validate_mask_presentation
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100;scene.render.use_compositing=True
rows=[]
def setup(route='Image',side='A'):
 old=scene.compositing_node_group
 if old:bpy.data.node_groups.remove(old)
 tree=bpy.data.node_groups.new('Owned Box scene ABI','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
 sink=tree.nodes.new('NodeGroupOutput');source=tree.nodes.new('CompositorNodeRLayers');source.layer=bpy.context.view_layer.name;mask=tree.nodes.new('CompositorNodeBoxMask');mask.inputs['Mask'].default_value=0;mask.inputs['Value'].default_value=1;mask.inputs['Size'].default_value=(.5,.5)
 mix=tree.nodes.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MIX';mix.clamp_factor=True;mix.clamp_result=False;active=lambda n:next(s for s in mix.inputs if s.identifier==n);background=active('B_Color'if side=='A'else'A_Color');background.default_value=(.125,.25,.5,.75)
 tree.links.new(source.outputs[route],active(side+'_Color'));tree.links.new(mask.outputs['Mask'],active('Factor_Float'));tree.links.new(next(s for s in mix.outputs if s.identifier=='Result_Color'),sink.inputs[0]);return tree,sink,source,mask,mix,background

def capture(label,exact,change=lambda _:None,route='Image',side='A'):
 objects=setup(route,side);change(objects);tree=objects[0];before=[(n.as_pointer(),n.bl_idname,[(s.identifier,len(s.links))for s in n.inputs])for n in tree.nodes];groups=set(g.as_pointer()for g in bpy.data.node_groups)
 graph=compositor_graph.extract(scene)
 assert before==[(n.as_pointer(),n.bl_idname,[(s.identifier,len(s.links))for s in n.inputs])for n in tree.nodes] and groups==set(g.as_pointer()for g in bpy.data.node_groups)
 assert graph['status']=='extracted',(label,graph)
 contract=box_scene_mix_contract(graph);assert(contract is not None)==exact,(label,graph)
 assert ellipse_scene_mix_contract(graph)is None
 mix=next(op for op in graph['ops']if op['kind']=='mix')
 assert ('box_scene_mix_model'in mix['properties'])==exact
 if exact:
  assert contract['family']=='box' and mix['properties']['box_scene_mix_model']==MODEL
  presentation={'compositor':graph,'display':{'ops':[{'type':'Lut1DTransform'}]*7}}
  assert validate_mask_presentation(presentation)is None
  presentation['display']['ops'].append({'type':'Lut3DTransform'});assert validate_mask_presentation(presentation)is not None
 rows.append({'case':label,'exactMarker':exact,'status':graph['status']});return graph
for route in ['Image','Alpha']:
 for side in ['A','B']:
  for size in [(0,.5),(.5,0),(0,0),(.5,.5)]:capture(route+'-'+side+'-'+str(size),True,lambda o,size=size:setattr(o[3].inputs['Size'],'default_value',size),route,side)
for label,change in [('generic-nonbinary-mask',lambda o:setattr(o[3].inputs['Mask'],'default_value',.5)),('generic-nonbinary-value',lambda o:setattr(o[3].inputs['Value'],'default_value',.5)),('generic-result-clamp',lambda o:setattr(o[4],'clamp_result',True)),('generic-factor-unclamped',lambda o:setattr(o[4],'clamp_factor',False)),('generic-other-blend',lambda o:setattr(o[4],'blend_type','ADD'))]:capture(label,False,change)
other=scene.view_layers.new('Owned other view layer');capture('generic-other-view-layer',False,lambda o:setattr(o[2],'layer',other.name))
def linked(o):
 rgb=o[0].nodes.new('CompositorNodeRGB');o[0].links.new(rgb.outputs[0],o[-1])
capture('generic-linked-background',False,linked)
for label,word in [('positive-zero',0),('minimum-normal',0x00800000),('negative-zero',0x80000000),('subnormal',1),('negative',0xbf800000),('above-one',0x40000000)]:
 def change(o,word=word):
  raw=array('f');raw.frombytes(struct.pack('=4I',word,word,word,word));o[-1].default_value.foreach_set(raw)
 objects=setup();change(objects);stored=array('f',[0])*4;objects[-1].default_value.foreach_get(stored);actual=list(struct.unpack('=4I',stored.tobytes()));expected=all(x==0 or 0x00800000<=x<=0x3f800000 for x in actual)
 capture('raw-'+label,expected,change)
print(json.dumps({'status':'PASSED_BOX_SCENE_MIX_POLICY','cases':len(rows),'rows':rows,'nativeRenders':0,'gpuInitializationCalls':0}))
