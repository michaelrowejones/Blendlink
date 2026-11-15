# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires the owned Blank Image policy launcher.
# blendlink-headless-sentinel: SCENETOWEB_BLANK_IMAGE_POLICY_PASSED
"""Actual Blender RNA/source policy. No compositor render or GPU initialization."""
from array import array
from pathlib import Path
import json,struct,sys
import bpy,gpu,numpy as np
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon/tests')]
import compositor_graph
from compositor_reference import NativeCompositorReference
OUT=Path(sys.argv[sys.argv.index('--')+1]).resolve()
calls=[]
def denied(*args,**kwargs):calls.append('gpu.init');raise RuntimeError('Blank Image source policy denies GPU initialization')
gpu.init=denied
try:gpu.init()
except RuntimeError:pass
else:raise AssertionError('GPU guard absent')
calls.clear()
oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False)
def configure(size=(1920,1080),color=(0,0,0,1),route='direct'):
 sink,_=oracle.reset();tree=oracle.tree;owner=tree
 oracle.scene.render.compositor_device='CPU';oracle.scene.render.compositor_precision='FULL';oracle.scene.render.use_border=False
 if tree.animation_data:tree.animation_data_clear()
 if route=='group':
  owner=bpy.data.node_groups.new('Owned Blank group','CompositorNodeTree');owner.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');exit=owner.nodes.new('NodeGroupOutput');instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=owner;tree.links.new(instance.outputs[0],sink.inputs[0]);sink=exit
 node=owner.nodes.new('CompositorNodeBlankImage');node.inputs['Color'].default_value.foreach_set(array('f',color));node.inputs['Size'].default_value.foreach_set(array('i',size));output=node.outputs['Image']
 if route=='reroute':
  reroute=owner.nodes.new('NodeReroute');owner.links.new(output,reroute.inputs[0]);output=reroute.outputs[0]
 owner.links.new(output,sink.inputs[0]);return node
def identity(node):
 return ([(g.as_pointer(),g.users)for g in bpy.data.node_groups],oracle.scene.frame_current,oracle.scene.frame_subframe,node.as_pointer(),node.id_data.as_pointer())
positives=[];refusals=[]
for label,size,color,route in [('defaults',(1920,1080),(0,0,0,1),'direct'),('native-clamp',(-3,0),(.25,.5,2,.5),'direct'),('thin',(8192,4),(0,0,0,0),'direct'),('group',(5,3),(.25,.5,2,.5),'group'),('reroute',(4,4),(0,0,0,1),'reroute'),('minimum-color',(1,1),(2**-16,0,16,1),'direct')]:
 node=configure(size,color,route);before=identity(node)
 for repeat in range(3):
  program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',(label,program)
  assert len(program['ops'])==1 and program['ops'][0]['kind']=='blank-image'
  assert program['ops'][0]['properties']['blank_image_effective_size']==[max(1,n)for n in size]
  assert identity(node)==before
 positives.append(label)
def linked_color(node):
 value=node.id_data.nodes.new('CompositorNodeRGB');node.id_data.links.new(value.outputs[0],node.inputs['Color'])
def consumer(node):
 info=node.id_data.nodes.new('CompositorNodeImageInfo');node.id_data.links.new(node.outputs[0],info.inputs['Image']);sink=next(n for n in node.id_data.nodes if n.bl_idname=='NodeGroupOutput');node.id_data.links.new(info.outputs['Dimensions'],sink.inputs[0])
for label,change in [('gpu',lambda n:setattr(oracle.scene.render,'compositor_device','GPU')),('border',lambda n:setattr(oracle.scene.render,'use_border',True)),('too-wide',lambda n:n.inputs['Size'].default_value.foreach_set(array('i',[8193,1]))),('pixel-budget',lambda n:n.inputs['Size'].default_value.foreach_set(array('i',[4096,4096]))),('linked-color',linked_color),('consumer-domain',consumer),('muted',lambda n:setattr(n,'mute',True)),('animation',lambda n:n.inputs['Color'].keyframe_insert('default_value',frame=1))]:
 node=configure();change(node);result=compositor_graph.extract(oracle.scene);assert result['status']=='unsupported',(label,result);refusals.append(label)
# Raw storage controls prove RNA bits before checking admission. No scalar
# promotion or guessed signed-zero/subnormal behavior is accepted as evidence.
for label,word in [('negative-zero',0x80000000),('minimum-subnormal',1),('maximum-subnormal',0x007fffff),('below-color-bound',0x37000000)]:
 node=configure();values=array('f');values.frombytes(struct.pack('=4I',word,0,0,0x3f800000));node.inputs['Color'].default_value.foreach_set(values);actual=array('f',[0])*4;node.inputs['Color'].default_value.foreach_get(actual)
 assert struct.unpack('=4I',actual.tobytes())[0]==word,(label,actual.tobytes().hex())
 result=compositor_graph.extract(oracle.scene);assert result['status']=='unsupported',(label,result);refusals.append(label)
# Source mutation after normalization must fail the end-of-extraction check.
original=compositor_graph.blank_image.normalize
for label,change in [('late-color',lambda n:n.inputs['Color'].default_value.foreach_set(array('f',[.25,0,0,1]))),('late-size',lambda n:n.inputs['Size'].default_value.foreach_set(array('i',[7,4]))),('late-frame',lambda n:oracle.scene.frame_set(9)),('late-mute',lambda n:setattr(n,'mute',True))]:
 node=configure()
 def mutate(*args,**kwargs):
  result=original(*args,**kwargs);change(node);return result
 compositor_graph.blank_image.normalize=mutate
 try:result=compositor_graph.extract(oracle.scene)
 finally:compositor_graph.blank_image.normalize=original
 assert result['status']=='unsupported'and any('changed' in d.get('message','').lower()for d in result['diagnostics']),(label,result)
 refusals.append(label)
for label,route,change in [('late-group-mute','group',lambda n:setattr(next(item for item in oracle.tree.nodes if item.bl_idname=='CompositorNodeGroup'),'mute',True)),('late-reroute-link','reroute',lambda n:n.id_data.links.remove(next(item for item in n.id_data.links if item.from_node==n)))]:
 node=configure(route=route)
 def mutate_topology(*args,**kwargs):
  result=original(*args,**kwargs);change(node);return result
 compositor_graph.blank_image.normalize=mutate_topology
 try:result=compositor_graph.extract(oracle.scene)
 finally:compositor_graph.blank_image.normalize=original
 assert result['status']=='unsupported'and any('changed' in d.get('message','').lower()for d in result['diagnostics']),(label,result)
 refusals.append(label)
assert calls==[],calls
report={'status':'SCENETOWEB_BLANK_IMAGE_POLICY_PASSED','supportCredit':0,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'positives':positives,'refusals':refusals,'sourceReadRepeats':3,'gpuInitGuardProved':True,'gpuInitializations':0,'nativeRenders':0}
(OUT/'policy.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(positives),len(refusals))
