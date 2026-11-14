# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual No-render closed Ellipse/current-scene policy controls.
import bpy,json,sys,struct
from array import array
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import compositor_graph
from compositor_ellipse_scene_mix import MODEL,ellipse_scene_mix_contract
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.engine='CYCLES';scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100;scene.render.use_compositing=True
rows=[]
def setup(route='Image',side='A'):
 old=scene.compositing_node_group
 if old:bpy.data.node_groups.remove(old)
 tree=bpy.data.node_groups.new('Owned ellipse scene policy','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree;sink=tree.nodes.new('NodeGroupOutput');source=tree.nodes.new('CompositorNodeRLayers');source.layer=bpy.context.view_layer.name;mask=tree.nodes.new('CompositorNodeEllipseMask');mask.inputs['Mask'].default_value=0;mask.inputs['Value'].default_value=1;mask.inputs['Size'].default_value=(.8,.7);mix=tree.nodes.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MIX';mix.clamp_factor=True;mix.clamp_result=False;active=lambda n:next(s for s in mix.inputs if s.identifier==n);background=active('B_Color'if side=='A'else'A_Color');background.default_value=(.125,.25,.5,.75);tree.links.new(source.outputs[route],active(side+'_Color'));tree.links.new(mask.outputs['Mask'],active('Factor_Float'));tree.links.new(next(s for s in mix.outputs if s.identifier=='Result_Color'),sink.inputs[0]);return tree,sink,source,mask,mix,background

def capture(label,expected,change=lambda _:None,route='Image',side='A'):
 objects=setup(route,side);change(objects);tree=objects[0];before=tree.to_json()if hasattr(tree,'to_json')else[(n.name,n.bl_idname,[(s.identifier,len(s.links))for s in n.inputs])for n in tree.nodes];counts=len(bpy.data.node_groups);graph=compositor_graph.extract(scene);after=tree.to_json()if hasattr(tree,'to_json')else[(n.name,n.bl_idname,[(s.identifier,len(s.links))for s in n.inputs])for n in tree.nodes];assert before==after and counts==len(bpy.data.node_groups);assert graph['status']==expected,(label,graph)
 if expected=='extracted':assert ellipse_scene_mix_contract(graph) is not None;assert next(o for o in graph['ops']if o['kind']=='mix')['properties']['ellipse_scene_mix_model']==MODEL
 rows.append({'case':label,'status':graph['status'],'diagnostics':graph['diagnostics']});return graph
for route in ['Image','Alpha']:
 for side in ['A','B']:capture(route+'-'+side,'extracted',route=route,side=side)
capture('positive-zero-background','extracted',lambda o:setattr(o[-1],'default_value',(0,0,0,0)))
capture('minimum-normal-background','extracted',lambda o:setattr(o[-1],'default_value',(2**-126,2**-126,2**-126,2**-126)))
for label,change in [('nonbinary-mask',lambda o:setattr(o[3].inputs['Mask'],'default_value',.5)),('nonbinary-value',lambda o:setattr(o[3].inputs['Value'],'default_value',.5)),('zero-size-single',lambda o:setattr(o[3].inputs['Size'],'default_value',(0,.5))),('result-clamp',lambda o:setattr(o[4],'clamp_result',True)),('factor-unclamped',lambda o:setattr(o[4],'clamp_factor',False)),('other-blend',lambda o:setattr(o[4],'blend_type','ADD'))]:capture(label,'unsupported',change)
other=scene.view_layers.new('Owned other view layer');capture('other-view-layer','unsupported',lambda o:setattr(o[2],'layer',other.name))
def linked(o):
 tree=o[0];rgb=tree.nodes.new('CompositorNodeRGB');tree.links.new(rgb.outputs[0],o[-1])
capture('linked-background','unsupported',linked)
for label,word in [('negative-zero',0x80000000),('subnormal',1),('infinity',0x7f800000),('negative',0xbf800000),('above-one',0x40000000)]:
 objects=setup();raw=array('f');raw.frombytes(struct.pack('=4I',word,word,word,word));objects[-1].default_value.foreach_set(raw);read=array('f',[0])*4;objects[-1].default_value.foreach_get(read);actual=list(struct.unpack('=4I',read.tobytes()));graph=compositor_graph.extract(scene)
 valid=all(x==0 or 0x00800000<=x<=0x3f800000 for x in actual)
 assert graph['status']==('extracted'if valid else'unsupported'),(label,actual,graph)
 rows.append({'case':'raw-'+label,'requested':word,'stored':actual,'status':graph['status'],'diagnostics':graph['diagnostics']})
print(json.dumps({'status':'PASSED_ELLIPSE_SCENE_MIX_POLICY','cases':len(rows),'rows':rows,'nativeRenders':0,'gpuInitializationCalls':0}))
