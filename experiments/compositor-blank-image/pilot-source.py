# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Owned CPU-only Blank Image feasibility, no support credit.
from array import array
from pathlib import Path
import hashlib,json,struct,sys
import bpy,gpu,numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'packages/blender-addon/tests'),str(ROOT/'packages/blendlink/blender')]
from compositor_reference import NativeCompositorReference
import compositor_graph
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
OUT=Path(sys.argv[sys.argv.index('--')+1]).resolve();OUT.mkdir(parents=True,exist_ok=True)
REFERENCE=Path(sys.argv[sys.argv.index('--')+2]).resolve();reference=json.loads((REFERENCE/'report.json').read_text());assert reference['status']=='RESEARCH_BLANK_IMAGE_CPU_DOMAIN_OBSERVATIONS'and reference['supportCredit']==0
blocked=[0]
def deny_gpu(*args,**kwargs):
 blocked[0]+=1
 raise RuntimeError('Blank Image CPU feasibility forbids GPU initialization')
gpu.init=deny_gpu
try:gpu.init()
except RuntimeError:pass
else:raise AssertionError('GPU guard did not refuse')
assert blocked==[1];blocked[0]=0
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
raw=lambda socket,typecode,count:(lambda result:(socket.default_value.foreach_get(result),result.tobytes())[1])(array(typecode,[0])*count)
wordfloat=lambda data:list(struct.unpack('='+str(len(data)//4)+'I',data))
case=lambda name,size=(5,3),frame=(13,9),color=(.25,.5,2,.5),**extra:dict(case=name,size=size,frame=frame,color=color,**extra)
plan=[row for row in reference['rows']if not row.get('node')and not row.get('colorRoute')]
oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False)
rows=[];schema=None
for definition in plan:
 width,height=definition['frame'];scene=oracle.scene;scene.render.resolution_x=width;scene.render.resolution_y=height;scene.frame_set(definition.get('frameNumber',1));scene.render.film_transparent=True
 sink,_=oracle.reset();tree=oracle.tree;owner=tree;target=sink.inputs[0]
 if definition.get('layout')=='group':
  owner=bpy.data.node_groups.new('Owned nested Blank Image','CompositorNodeTree');owner.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');end=owner.nodes.new('NodeGroupOutput');target=end.inputs[0];instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=owner;tree.links.new(instance.outputs[0],sink.inputs[0])
 blank=owner.nodes.new('CompositorNodeBlankImage')
 if schema is None:
  schema={'inputs':[{'name':s.name,'identifier':s.identifier,'type':s.type,'class':s.bl_idname,'value':list(s.default_value)}for s in blank.inputs],'outputs':[{'name':s.name,'identifier':s.identifier,'type':s.type,'class':s.bl_idname}for s in blank.outputs]}
 if not definition.get('nativeDefaults'):
  if not definition.get('colorRoute'):blank.inputs['Color'].default_value.foreach_set(array('f',definition['color']))
  blank.inputs['Size'].default_value.foreach_set(array('i',definition['size']))
 color=raw(blank.inputs['Color'],'f',4);size=raw(blank.inputs['Size'],'i',2);stored_size=list(struct.unpack('=2i',size));effective_size=[max(1,n)for n in stored_size]
 if definition.get('colorRoute'):
  combined=owner.nodes.new('CompositorNodeCombineColor');combined.mode='RGB'
  for name,value in zip(('Red','Green','Blue','Alpha'),definition['color']):combined.inputs[name].default_value=value;assert combined.inputs[name].default_value==value
  owner.links.new(combined.outputs[0],blank.inputs['Color'])
 else:assert color==struct.pack('=4f',*definition['color'])
 if definition.get('nativeDefaults'):assert stored_size==[1920,1080]and color==struct.pack('=4f',0,0,0,1)
 output=blank.outputs['Image']
 if definition.get('node'):
  consumer=owner.nodes.new(definition['node']);owner.links.new(output,consumer.inputs['Image']);output=consumer.outputs[definition['output']]
 if definition.get('layout')=='reroute':
  route=owner.nodes.new('NodeReroute');owner.links.new(output,route.inputs[0]);output=route.outputs[0]
 owner.links.new(output,target)
 for group in bpy.data.node_groups:
  for node in group.nodes:node.show_preview=False
 ownership=[(g.as_pointer(),g.users)for g in bpy.data.node_groups];frame=(scene.frame_current,scene.frame_subframe)
 extracted=compositor_graph.extract(scene);assert extracted['status']=='extracted',(definition['case'],extracted)
 assert ownership==[(g.as_pointer(),g.users)for g in bpy.data.node_groups]and frame==(scene.frame_current,scene.frame_subframe)
 assert color==raw(blank.inputs['Color'],'f',4)and size==raw(blank.inputs['Size'],'i',2)
 program_file=OUT/(definition['case']+'.program.json');program_file.write_text(json.dumps(extracted,sort_keys=True,indent=2)+'\n')
 pixels=REFERENCE/definition['pixelFile'];assert sha(pixels)==definition['pixelSha256']
 rows.append({'case':definition['case'],'width':width,'height':height,'programFile':program_file.name,'programSha256':sha(program_file),'pixelFile':str(pixels),'pixelSha256':sha(pixels),'wordCount':definition['wordCount'],'sourcePreserved':True,'storedColorWords':wordfloat(color),'storedSize':stored_size})
assert blocked==[0]
report={'status':'BLANK_IMAGE_PILOT_SOURCE_OBSERVED','supportCredit':0,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'gpuInitializations':0,'nativeRenders':0,'referenceReportSha256':sha(REFERENCE/'report.json'),'referenceClosedSha256':sha(REFERENCE/'closed.json'),'rows':rows}
(OUT/'pilot-source.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows))
