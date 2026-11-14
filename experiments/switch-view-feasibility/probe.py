# SPDX-License-Identifier: GPL-3.0-or-later
# Native mono-view branch/domain observations only; no SDK changes.
import bpy,json,sys,os,struct,hashlib
from pathlib import Path
from array import array
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
OUT=Path(os.environ['SCENETOWEB_SWITCH_VIEW']);OUT.mkdir(parents=True,exist_ok=True)
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
pixels=np.zeros((9,13,4),np.float32);pixels[...,0]=np.arange(13,dtype=np.float32)[None,:]/16;pixels[...,1]=np.arange(9,dtype=np.float32)[:,None]/16;pixels[...,2]=.375;pixels[...,3]=1
oracle=NativeCompositorReference(OUT,device='CPU',pixels=pixels,node_previews=False);scene=oracle.scene;scene.render.use_multiview=False
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
rows=[]
def capture(label,*,first_disabled=False,rename=False,image=False,time_inactive=False,group=False,dimensions=False):
 scene.render.use_multiview=False
 scene.render.views['left'].use=not first_disabled;scene.render.views['right'].use=True
 if rename:scene.render.views['right'].name='Artist right'
 sink,_=oracle.reset();switch=oracle.tree.nodes.new('CompositorNodeSwitchView')
 inputs=[(s.identifier,s.name,s.type,s.enabled,s.is_unavailable)for s in switch.inputs]
 assert inputs and all(s.type=='RGBA'for s in switch.inputs)
 selected=switch.inputs[0];expected=(.125,.25,.5,1)
 for index,socket in enumerate(switch.inputs):socket.default_value=expected if index==0 else(.875,.75,.625,1)
 if image:
  node=oracle.tree.nodes.new('CompositorNodeImage');node.image=oracle.image;oracle.tree.links.new(node.outputs['Image'],selected)
 if time_inactive:
  assert len(switch.inputs)>1;time=oracle.tree.nodes.new('CompositorNodeSceneTime');oracle.tree.links.new(time.outputs['Frame'],switch.inputs[1])
 output=switch.outputs['Image']
 if group:
  # A group around the selected producer, without altering native SwitchView.
  sub=bpy.data.node_groups.new('Owned view branch producer','CompositorNodeTree');sub.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');out=sub.nodes.new('NodeGroupOutput');rgb=sub.nodes.new('CompositorNodeRGB');rgb.outputs[0].default_value=expected;reroute=sub.nodes.new('NodeReroute');sub.links.new(rgb.outputs[0],reroute.inputs[0]);sub.links.new(reroute.outputs[0],out.inputs[0]);instance=oracle.tree.nodes.new('CompositorNodeGroup');instance.node_tree=sub;oracle.tree.links.new(instance.outputs[0],selected)
 if dimensions:
  info=oracle.tree.nodes.new('CompositorNodeImageInfo');oracle.tree.links.new(output,info.inputs['Image']);output=info.outputs['Dimensions']
 oracle.tree.links.new(output,sink.inputs[0]);before=[(node.as_pointer(),node.bl_idname,[(s.identifier,len(s.links))for s in node.inputs])for node in oracle.tree.nodes]
 path=OUT/(label+'.exr');scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);loaded=bpy.data.images.load(str(path),check_existing=False);loaded.alpha_mode='PREMUL';raw=array('f',[0])*(13*9*4);loaded.pixels.foreach_get(raw);bpy.data.images.remove(loaded);target=OUT/(label+'.rgba32f');target.write_bytes(raw.tobytes());expected_data=(np.tile(np.array((13,9,0,1)if image else(0,0,0,1),np.float32),13*9)if dimensions else pixels.reshape(-1)if image else np.tile(np.array(expected,np.float32),13*9));assert raw.tobytes()==expected_data.tobytes(),(label,list(raw)[:8],expected_data[:8]);assert before==[(node.as_pointer(),node.bl_idname,[(s.identifier,len(s.links))for s in node.inputs])for node in oracle.tree.nodes]
 rows.append({'case':label,'inputs':inputs,'selectedInput':selected.identifier,'mono':not scene.render.use_multiview,'firstDisabled':first_disabled,'renamedView':rename,'selectedImageField':image,'inactiveSceneTime':time_inactive,'groupReroute':group,'dimensions':dimensions,'expected':list((13,9,0,1)if image else(0,0,0,1))if dimensions else'controlled-full-frame-image'if image else list(expected),'file':target.name,'sha256':sha(target),'words':len(raw),'wordDifferences':0,'sourcePreserved':True,'rnaProperties':list(switch.bl_rna.properties.keys()),'nativeSceneProperty':getattr(getattr(switch,'scene',None),'name',None)})
 if rename:scene.render.views['Artist right'].name='right'
capture('mono-default')
capture('mono-disabled-first',first_disabled=True)
capture('mono-renamed-first',first_disabled=True,rename=True)
capture('mono-inactive-time',time_inactive=True)
capture('mono-group-reroute',group=True)
capture('mono-image-field',image=True)
capture('mono-single-domain',dimensions=True)
capture('mono-image-domain',image=True,dimensions=True)
# Inspect native RNA schemas for alternatives; do not evaluate or port them.
for kind in ['FunctionNodeInputRotation','FunctionNodeInputIntVector']:
 node=oracle.tree.nodes.new(kind);row={'node':kind,'rnaProperties':list(node.bl_rna.properties.keys()),'outputs':[(s.identifier,s.type,s.bl_idname)for s in node.outputs]}
 if kind.endswith('IntVector'):
  node.vector_dimensions=3;node.vector=(-2147483648,16777217,2147483647);row['integerPropertyRead']=list(node.vector);assert row['integerPropertyRead']==[-2147483648,16777217,2147483647];node.vector_dimensions=2;row['twoDPropertyRead']=list(node.vector);row['twoDOutputs']=[(s.identifier,s.type,s.bl_idname)for s in node.outputs];assert row['twoDPropertyRead']==[-2147483648,16777217]
 rows.append(row)
report={'status':'OBSERVED_MONO_SWITCH_VIEW_NATIVE_CPU','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'nativeRenders':8,'gpuInitializationCalls':0,'rows':rows,'supportCredit':0,'FinalCredit':0,'browserCredit':0};(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'])
