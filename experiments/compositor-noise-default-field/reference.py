# SPDX-License-Identifier: GPL-3.0-or-later
"""Stock authored CPU Noise fields and controls. No replacement native MF/kernel."""
from array import array
from pathlib import Path
import hashlib,json,os,struct,sys
import bpy,gpu,numpy as np
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon/tests')]
import compositor_graph,compositor_noise as helper
from compositor_reference import NativeCompositorReference
OUT=Path(os.environ['SCENETOWEB_NOISE_DEFAULT_FIELD_REFERENCES']).resolve();OUT.mkdir(parents=True,exist_ok=True)
CASES=json.loads((HERE/'cases.json').read_text());assert len(CASES)==26
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
paths=[HERE/name for name in ['reference.py','policy.py','cases.json','protocol.mjs','numeric-contract.mjs','sources.json']]+[ROOT/'packages/blender-addon/tests/compositor_reference.py',ROOT/'packages/blender-addon/tests/compositor_noise_check.py',*sorted((ROOT/'packages/blendlink/blender').glob('*.py')),*sorted((ROOT/'packages/blender-addon').glob('*.py')),*sorted((ROOT/'packages/blender-addon').glob('*.json'))]
pins={str(p.relative_to(ROOT)):sha(p)for p in paths};original_init=gpu.init;gpu_calls=0

def deny_gpu(*args,**kwargs):
 global gpu_calls
 gpu_calls+=1;raise AssertionError('Native CPU Noise capture forbids gpu.init')
gpu.init=deny_gpu
word=lambda f:struct.unpack('=I',struct.pack('=f',f))[0]
F=lambda f:struct.unpack('=f',struct.pack('=f',f))[0]
rows=[];coordinate_controls=[];field_controls=[];endpoint_controls=[];native_renders=0;oracle=None;extent=None;small_direct={}

def choose(width,height):
 global oracle,extent
 if extent!=(width,height):
  oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((height,width,4),np.float32),node_previews=False)
  oracle.scene.cycles.use_denoising=False;extent=(width,height)
 return oracle

def capture(case):
 global native_renders
 path=OUT/(case+'.exr');oracle.scene.render.filepath=str(path)
 for group in bpy.data.node_groups:
  for node in group.nodes:node.show_preview=False
 bpy.ops.render.render(write_still=True);native_renders+=1
 image=bpy.data.images.load(str(path),check_existing=False)
 try:
  assert tuple(image.size)==extent
  pixels=array('f',[0])*(extent[0]*extent[1]*4);image.pixels.foreach_get(pixels)
 finally:bpy.data.images.remove(image)
 raw=OUT/(case+'.rgba32f');raw.write_bytes(pixels.tobytes())
 return list(struct.unpack('='+str(len(pixels))+'I',pixels.tobytes())),{'pixelFile':raw.name,'pixelSha256':sha(raw)}

def noise(tree,output='Color'):
 node=tree.nodes.new('ShaderNodeTexNoise');assert node.noise_dimensions=='2D'and node.noise_type=='FBM'and node.normalize
 assert {name:node.inputs[name].default_value for name in helper.DEFAULTS}==helper.DEFAULTS
 assert not any(s.is_linked for s in node.inputs)
 return node,node.outputs[output]

def combine(tree,channels):
 node=tree.nodes.new('CompositorNodeCombineColor');node.mode='RGB';node.inputs[3].default_value=1
 for source,target in zip(channels,node.inputs):tree.links.new(source,target)
 return node.outputs[0]

def separate(tree,source):
 node=tree.nodes.new('CompositorNodeSeparateColor');node.mode='RGB';tree.links.new(source,node.inputs[0]);return node.outputs

def pair_mean(tree,a,b):
 add=tree.nodes.new('ShaderNodeMath');add.operation='ADD';tree.links.new(a,add.inputs[0]);tree.links.new(b,add.inputs[1])
 half=tree.nodes.new('ShaderNodeMath');half.operation='MULTIPLY';half.inputs[1].default_value=.5;tree.links.new(add.outputs[0],half.inputs[0]);return half.outputs[0]

def author(tree,definition):
 route=definition['route']
 if route=='group-reroute':
  group=bpy.data.node_groups.new('Owned Noise group','CompositorNodeTree');group.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');exit=group.nodes.new('NodeGroupOutput');_,terminal=noise(group,'Color');reroute=group.nodes.new('NodeReroute');group.links.new(terminal,reroute.inputs[0]);group.links.new(reroute.outputs[0],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;terminal=instance.outputs[0]
 elif route=='shared-fac-color':
  node,fac=noise(tree,'Fac');color=separate(tree,node.outputs['Color']);terminal=combine(tree,(fac,color[1],color[2]))
 elif route=='two-color':
  _,a=noise(tree);_,b=noise(tree);a,b=separate(tree,a),separate(tree,b);terminal=combine(tree,(a[0],b[1],b[2]))
 elif route=='six-fac':
  channels=[]
  for _ in range(3):
   _,a=noise(tree,'Fac');_,b=noise(tree,'Fac');channels.append(pair_mean(tree,a,b))
  terminal=combine(tree,channels)
 else:_,terminal=noise(tree,definition['output'])
 return terminal


def group_trace(tree,sink):
 instance=sink.inputs[0].links[0].from_node;assert instance.bl_idname=='CompositorNodeGroup'
 group=instance.node_tree;exit=next(n for n in group.nodes if n.bl_idname=='NodeGroupOutput'and n.is_active_output)
 reroute=exit.inputs[0].links[0].from_node;assert reroute.bl_idname=='NodeReroute'
 leaf=reroute.inputs[0].links[0].from_node;assert leaf.bl_idname=='ShaderNodeTexNoise'
 assert reroute.inputs[0].links[0].from_socket==leaf.outputs['Color']
 def endpoint(node,socket):return {'tree':node.id_data.name,'node':node.name,'nodeType':node.bl_idname,'socket':socket.identifier}
 links=[]
 for socket in [reroute.inputs[0],exit.inputs[0],sink.inputs[0]]:
  assert len(socket.links)==1
  link=socket.links[0];links.append({'from':endpoint(link.from_node,link.from_socket),'to':endpoint(link.to_node,link.to_socket)})
 return {'rootTree':tree.name,'groupTree':group.name,'instance':instance.name,'noise':leaf.name,'reroute':reroute.name,'links':links}

try:
 if os.environ.get('SCENETOWEB_NOISE_SOURCE_ONLY')=='1':
  original_ops=bpy.ops;blocked=[0]
  class RenderGuard:
   def __getattr__(self,name):
    def denied(*args,**kwargs):
     blocked[0]+=1;raise RuntimeError('Noise source-only preflight forbids render')
    return denied
  class OpsGuard:
   def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(original_ops,name)
  bpy.ops=OpsGuard()
  try:
   try:bpy.ops.render.render()
   except RuntimeError as error:assert 'Noise source-only preflight forbids'in str(error)
   else:raise AssertionError('Render guard missing')
   assert blocked==[1];blocked[0]=0;programs=[]
   for definition in [r for r in CASES if r['saved']]:
    choose(definition['width'],definition['height']);sink,_=oracle.reset();terminal=author(oracle.tree,definition);oracle.tree.links.new(terminal,sink.inputs[0]);program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',program
    path=OUT/(definition['case']+'.program.json');path.write_text(json.dumps(program,indent=2)+'\n');programs.append({'case':definition['case'],'programFile':path.name,'programSha256':sha(path),**({'groupTrace':group_trace(oracle.tree,sink)}if definition['route']=='group-reroute'else{})})
   assert blocked==[0]and gpu_calls==0
   (OUT/'source-only.json').write_text(json.dumps({'status':'NOISE_SOURCE_ONLY_PREFLIGHT_PASSED','programs':programs,'renders':blocked[0],'gpuInitializationCalls':gpu_calls,'portCredit':0},indent=2)+'\n');print('NOISE_SOURCE_ONLY_PREFLIGHT_PASSED')
  finally:bpy.ops=original_ops
 else:
  for width,height in dict.fromkeys((r['width'],r['height'])for r in CASES):
   choose(width,height);sink,_=oracle.reset();image=oracle.tree.nodes.new('CompositorNodeImage');image.image=oracle.image
   coordinate=oracle.tree.nodes.new('CompositorNodeImageCoordinates');oracle.tree.links.new(image.outputs['Image'],coordinate.inputs['Image']);oracle.tree.links.new(coordinate.outputs['Uniform'],sink.inputs[0])
   case=f'{width}x{height}-raw-uniform';actual,files=capture(case);maximum=max(width,height)
   for y in range(height):
    for x in range(width):assert actual[(y*width+x)*4:(y*width+x+1)*4]==[word(F(F(F(F(x+.5)-F(width/2))/maximum)*2)),word(F(F(F(F(y+.5)-F(height/2))/maximum)*2)),0,word(1)]
   coordinate_controls.append({'case':case,'width':width,'height':height,**files})
  for definition in CASES:
   width,height=definition['width'],definition['height'];choose(width,height);sink,_=oracle.reset();tree=oracle.tree;route=definition['route']
   terminal=author(tree,definition)
   tree.links.new(terminal,sink.inputs[0]);before=[(g.as_pointer(),g.users)for g in bpy.data.node_groups];frame=(oracle.scene.frame_current,oracle.scene.frame_subframe)
   program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',program
   assert before==[(g.as_pointer(),g.users)for g in bpy.data.node_groups]and frame==(oracle.scene.frame_current,oracle.scene.frame_subframe)
   fields=[op for op in program['ops']if op['kind']=='noise-texture'];assert len(fields)==definition['noiseOperations']
   assert sum(3 if op['source']['output']=='Fac'else 9 for op in fields)==definition['perlinCalls']
   for op in fields:assert op['properties']['noise_model']==helper.MODEL and op['properties']['noise_kernel']==helper.KERNEL
   case=definition['case'];program_file=OUT/(case+'.program.json');program_file.write_text(json.dumps(program,indent=2)+'\n')
   source_file=OUT/(case+'.blend')if definition['saved']else None
   if source_file:
    for group in bpy.data.node_groups:
     for node in group.nodes:node.show_preview=False
    bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
   actual,files=capture(case);assert all(actual[i]==word(1)for i in range(3,len(actual),4))
   if definition['output']=='Fac':assert all(actual[i:i+3]==[actual[i]]*3 for i in range(0,len(actual),4))
   if route=='direct'and(width,height)in[(13,9),(9,13)]:small_direct[(width,height,definition['output'])]=actual
   if route!='direct':assert actual==small_direct[(width,height,definition['output'])],(case,'Native transparent/composite route differs from direct Noise')
   yy,xx=np.mgrid[:height,:width];marker=np.stack([xx/16384,yy/16384,(xx+3*yy)/65536,np.ones_like(xx)],axis=-1).astype(np.float32);input_file=OUT/(case+'.input32f');input_file.write_bytes(marker.tobytes())
   row={**definition,**files,'programFile':program_file.name,'programSha256':sha(program_file),'inputFile':input_file.name,'inputSha256':sha(input_file),'sourceOwnershipPreserved':True,**({'groupTrace':group_trace(tree,sink)}if route=='group-reroute'else{})}
   if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
   rows.append(row)
  for width,height in [(13,9),(5,5)]:
   choose(width,height);sink,_=oracle.reset();_,terminal=noise(oracle.tree,'Fac');info=oracle.tree.nodes.new('CompositorNodeImageInfo');oracle.tree.links.new(terminal,info.inputs['Image']);oracle.tree.links.new(info.outputs['Dimensions'],sink.inputs[0]);source_program=compositor_graph.extract(oracle.scene);assert source_program['status']=='unsupported'
   case=f'{width}x{height}-native-image-info-field-domain';actual,files=capture(case);assert all(actual[i:i+4]==[word(width),word(height),0,word(1)]for i in range(0,len(actual),4))
   field_controls.append({'case':case,'width':width,'height':height,'dimensions':[width,height],'sourceExtractionStatus':'unsupported',**files})
  for output in ['Fac','Color']:
   choose(13,9);sink,_=oracle.reset();node,terminal=noise(oracle.tree,output);node.inputs['Scale'].default_value=0;oracle.tree.links.new(terminal,sink.inputs[0]);assert compositor_graph.extract(oracle.scene)['status']=='unsupported'
   case='13x9-scale-zero-'+output.lower();actual,files=capture(case);expected=small_direct[(13,9,output)][(4*13+6)*4:(4*13+6)*4+4]
   assert expected[0]==word(.5)and expected[3]==word(1);assert all(actual[i:i+4]==expected for i in range(0,len(actual),4))
   endpoint_controls.append({'case':case,'width':13,'height':9,'output':output,**files})
  assert native_renders==41 and gpu_calls==0
  assert pins=={str(p.relative_to(ROOT)):sha(p)for p in paths},'Source changed during native capture'
  report={'schemaVersion':1,'status':'CAPTURED_COMPOSITOR_NOISE_DEFAULT_FIELD','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':'CPU','sceneEngine':oracle.scene.render.engine,'resultPrecision':'CPU_FLOAT32','sourceHashes':pins,'cases':rows,'coordinateControls':coordinate_controls,'fieldDomainControls':field_controls,'endpointControls':endpoint_controls,'nativeRenders':native_renders,'wordDifferences':0,'pythonGpuInitializationCalls':gpu_calls,'finalCredit':0,'browserCredit':0}
  (OUT/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows),native_renders)
finally:
 if gpu.init is deny_gpu:gpu.init=original_init
