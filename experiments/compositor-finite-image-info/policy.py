# SPDX-License-Identifier: GPL-3.0-or-later
"""Guarded source-only finite metadata admission and late-change controls."""
from pathlib import Path
from unittest.mock import patch
import sys,json
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];OUT=Path(sys.argv[sys.argv.index('--')+1]);OUT.mkdir(exist_ok=True)
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph as graph
scene=bpy.context.scene;positive=[];refusals=[];render_calls=[];gpu_calls=[];programs=[]
def render_deny(*a,**k):render_calls.append(1);raise AssertionError('render denied')
def gpu_deny(*a,**k):gpu_calls.append(1);raise AssertionError('GPU denied')
gpu.init=gpu_deny
old_ops=bpy.ops
class RenderGuard:
 def __getattr__(self,name):return render_deny
class OpsGuard:
 def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(old_ops,name)
with patch.object(bpy,'ops',OpsGuard()):
 for f in [lambda:bpy.ops.render.render(),lambda:gpu.init()]:
  try:f()
  except AssertionError:pass
 assert render_calls==[1]and gpu_calls==[1];render_calls.clear();gpu_calls.clear()
 def setup(kind='blank',output='Dimensions',route='direct'):
  scene.render.engine='CYCLES';scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100;scene.render.use_compositing=True;scene.render.use_border=False;scene.render.use_crop_to_border=False
  tree=bpy.data.node_groups.new('Owned finite Info policy','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
  sink=tree.nodes.new('NodeGroupOutput');info=tree.nodes.new('CompositorNodeImageInfo')
  if kind=='blank':source=tree.nodes.new('CompositorNodeBlankImage');source.inputs['Size'].default_value=(5,3)
  else:
   source=tree.nodes.new('CompositorNodeImage');image=bpy.data.images.new('Owned policy image',width=7,height=4,alpha=True,float_buffer=True);image.colorspace_settings.name='Linear Rec.709';image.pixels.foreach_set([.25,.5,.75,1]*28);source.image=image
  tree.links.new(source.outputs['Image'],info.inputs['Image']);result=info.outputs[output];aux=None
  if route=='reroute':aux=tree.nodes.new('NodeReroute');tree.links.new(result,aux.inputs[0]);result=aux.outputs[0]
  if route=='group':
   group=bpy.data.node_groups.new('Actual finite metadata group','CompositorNodeTree');group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketVector');group.interface.new_socket(name='Vector',in_out='OUTPUT',socket_type='NodeSocketVector');gi=group.nodes.new('NodeGroupInput');go=group.nodes.new('NodeGroupOutput');group.links.new(gi.outputs[0],go.inputs[0]);aux=tree.nodes.new('CompositorNodeGroup');aux.node_tree=group;tree.links.new(result,aux.inputs[0]);result=aux.outputs[0]
  if route=='aspect':
   separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(result,separate.inputs[0]);ratio=tree.nodes.new('ShaderNodeMath');ratio.operation='DIVIDE';tree.links.new(separate.outputs[0],ratio.inputs[0]);tree.links.new(separate.outputs[1],ratio.inputs[1]);result=ratio.outputs[0]
  if route=='summary':
   ds=tree.nodes.new('ShaderNodeSeparateXYZ');rs=tree.nodes.new('ShaderNodeSeparateXYZ');ss=tree.nodes.new('ShaderNodeSeparateXYZ');combined=tree.nodes.new('CompositorNodeCombineColor')
   tree.links.new(info.outputs['Dimensions'],ds.inputs[0]);tree.links.new(info.outputs['Resolution'],rs.inputs[0]);tree.links.new(info.outputs['Scale'],ss.inputs[0])
   for output,index in [(ds.outputs['X'],0),(rs.outputs['Y'],1),(info.outputs['Rotation'],2),(ss.outputs['X'],3)]:tree.links.new(output,combined.inputs[index])
   result=combined.outputs[0]
  tree.links.new(result,sink.inputs[0]);return tree,source,info,sink,aux
 def check(label,ok):
  before=[(n.as_pointer(),n.name,n.mute)for n in scene.compositing_node_group.nodes]
  result=graph.extract(scene);assert result['status']==('extracted'if ok else'unsupported'),(label,result)
  if ok:
   assert any(op['properties'].get('image_info_model')=='finite-identity-image-info-v1'for op in result['ops']),result
   positive.append(label);programs.append({'case':label,'program':result});assert before==[(n.as_pointer(),n.name,n.mute)for n in scene.compositing_node_group.nodes]
  else:refusals.append({'case':label,'codes':[d['code']for d in result['diagnostics']]})
  return result
 for kind in ['blank','image']:
  for output in ['Dimensions','Resolution','Location','Rotation','Scale']:
   setup(kind,output);check(kind+'-'+output,True)
  for route in ['reroute','group','aspect','summary']:
   setup(kind,'Dimensions',route);check(kind+'-'+route,True)
 # Single values and transformed domains do not inherit a finite identity marker.
 for kind in ['single','transformed','Alpha']:
  tree,source,info,sink,aux=setup('image')
  if kind=='single':node=tree.nodes.new('CompositorNodeRGB');tree.links.new(node.outputs[0],info.inputs['Image'])
  elif kind=='transformed':node=tree.nodes.new('CompositorNodeTransform');tree.links.new(source.outputs[0],node.inputs['Image']);node.inputs['Scale'].default_value=2;tree.links.new(node.outputs[0],info.inputs['Image'])
  else:tree.links.new(source.outputs['Alpha'],info.inputs['Image'])
  check(kind,False)
 for kind in ['blank','image']:
  tree,source,info,sink,aux=setup(kind,'Rotation');consumer=tree.nodes.new('CompositorNodeExposure');tree.links.new(info.outputs['Rotation'],consumer.inputs['Image']);tree.links.new(consumer.outputs[0],sink.inputs[0]);check(kind+'-outside-metadata-consumer',False)
 for mode in ['root','size','binding']:
  tree,source,info,sink,aux=setup('image');original_capture=graph.normalize_static_image;replacement=bpy.data.images.new('During-read replacement',width=7,height=4,alpha=True,float_buffer=True)
  def during(*args,**kwargs):
   result=original_capture(*args,**kwargs)
   if mode=='root':scene.compositing_node_group=bpy.data.node_groups.new('During-read root','CompositorNodeTree')
   elif mode=='size':source.image.scale(9,5)
   else:source.image=replacement
   return result
  with patch.object(graph,'normalize_static_image',during):check('during-producer-'+mode,False)
 for mode in ['unchanged','blank-size','image-size','image-id','root','frame','disabled','render-size','group-mute','reroute-relink','image-link']:
  kind='image'if mode.startswith('image')else'blank';route='group'if mode=='group-mute'else'reroute'if mode=='reroute-relink'else'direct'
  tree,source,info,sink,aux=setup(kind,route=route);old_frame=scene.frame_current;original=graph.validate_static_image_graph;calls=[]
  alternate=tree.nodes.new('CompositorNodeRGB')if mode in {'reroute-relink','image-link'}else None
  replacement=bpy.data.images.new('Replacement same-size',width=7,height=4,alpha=True,float_buffer=True)if mode=='image-id'else None
  def late(program):
   result=original(program);calls.append(1)
   if mode=='blank-size':source.inputs['Size'].default_value=(6,4)
   elif mode=='image-size':source.image.scale(8,5)
   elif mode=='image-id':source.image=replacement
   elif mode=='root':scene.compositing_node_group=bpy.data.node_groups.new('Replacement root','CompositorNodeTree')
   elif mode=='frame':scene.frame_current+=1
   elif mode=='disabled':scene.render.use_compositing=False
   elif mode=='render-size':scene.render.resolution_x=9000
   elif mode=='image-link':tree.links.new(alternate.outputs[0],info.inputs['Image'])
   elif mode=='group-mute':aux.mute=True
   elif mode=='reroute-relink':tree.links.new(alternate.outputs[0],aux.inputs[0])
   return result
  with patch.object(graph,'validate_static_image_graph',late):check('late-'+mode,mode=='unchanged')
  assert calls;scene.frame_current=old_frame
assert not render_calls and not gpu_calls
report={'status':'PASSED_FINITE_IMAGE_INFO_SOURCE_POLICY','positive':positive,'refusals':refusals,'programs':programs,'renderCalls':len(render_calls),'gpuInitializationCalls':len(gpu_calls),'guardCanaries':{'renderRefused':True,'gpuInitializationRefused':True},'supportCredit':0}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(positive),len(refusals))
