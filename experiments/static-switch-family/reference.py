# SPDX-License-Identifier: GPL-3.0-or-later
"""Authored static selectors: EEVEE shader or native CPU/GPU compositor pixels."""
import bpy,gpu,json,os,sys,hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blendlink/dist/blender'),str(ROOT/'packages/blendlink/dist/addon'),str(Path(__file__).parent)]
import tsl_ir,compositor_graph,procedural,static_selection
VARIANT=os.environ.get('SCENETOWEB_SWITCH_VARIANT','static');assert VARIANT in {'static','mono-view','integer-vector3'}
if VARIANT=='integer-vector3':from int_vector3_cases import cases,build
elif VARIANT=='mono-view':from view_cases import cases,build
else:from cases import cases,build
OUT=Path(os.environ['SCENETOWEB_SWITCH_REFERENCES']).resolve();OUT.mkdir(parents=True,exist_ok=True)
CONTEXT=os.environ['SCENETOWEB_SWITCH_CONTEXT'];assert CONTEXT in (['CPU']if VARIANT!='static'else['shader','CPU','GPU'])
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene
scene.render.engine='CYCLES'if VARIANT!='static'else'BLENDER_EEVEE';scene.eevee.taa_render_samples=1;scene.world=None
if VARIANT!='static':
 scene.cycles.device='CPU';scene.cycles.samples=1;scene.cycles.use_denoising=False;scene.render.use_multiview=False
 import _cycles
 _cycles.set_device_override('CPU')
scene.render.resolution_x=scene.render.resolution_y=SIZE=8;scene.render.resolution_percentage=100;scene.render.dither_intensity=0
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.use_compositing=CONTEXT!='shader'
if CONTEXT!='shader':scene.render.compositor_device=CONTEXT;scene.render.compositor_precision='FULL'
bpy.ops.mesh.primitive_plane_add(size=2);owner=bpy.context.object;owner.name='Artist static selector owner';owner['blendlink_id']='static-selector-owner'
camera_data=bpy.data.cameras.new('Artist source camera');camera_data.type='ORTHO';camera_data.ortho_scale=2
camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
if CONTEXT!='shader':
 plate=bpy.data.materials.new('Source scene plate');plate.use_nodes=True;plate.node_tree.nodes.clear();p=plate.node_tree.nodes.new('ShaderNodeBsdfPrincipled');p.inputs['Base Color'].default_value=(0,0,0,1);p.inputs['Emission Color'].default_value=(.125,.25,.5,1);p.inputs['Emission Strength'].default_value=1
 o=plate.node_tree.nodes.new('ShaderNodeOutputMaterial');plate.node_tree.links.new(p.outputs[0],o.inputs[0]);owner.data.materials.append(plate)
 if VARIANT=='mono-view':
  unlit=plate.node_tree.nodes.new('ShaderNodeEmission');unlit.inputs['Color'].default_value=(.125,.25,.5,1);plate.node_tree.links.new(unlit.outputs[0],o.inputs[0])

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def state(tree):
 def value(socket):
  v=getattr(socket,'default_value',None)
  return v if v is None or isinstance(v,(str,bool,int,float)) else tuple(v)
 nested=([(n.name,state(n.node_tree))for n in tree.nodes if getattr(n,'node_tree',None)]if VARIANT=='integer-vector3'else[])
 return repr(nested)+repr([(n.bl_idname,n.name,n.value if n.bl_idname=='FunctionNodeInputMenu' else (tuple(n.vector),n.vector_dimensions)if n.bl_idname=='FunctionNodeInputIntVector'else None,
               [item.name for item in n.enum_items] if n.bl_idname=='GeometryNodeMenuSwitch' else None,
               [(s.identifier,value(s)) for s in n.inputs],[(s.identifier,value(s)) for s in n.outputs]) for n in tree.nodes])+repr(sorted((l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier) for l in tree.links))

def render(label):
 scene.render.filepath=str(OUT/(label+'.exr'));bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';pixels=np.asarray(image.pixels[:],np.float32).reshape(SIZE,SIZE,4);bpy.data.images.remove(image)
 assert np.isfinite(pixels).all(),label
 path=OUT/(label+'.rgba32f');pixels.astype('<f4').tofile(path)
 return {'pixelFile':path.name,'pixelSha256':sha(path)}

python_gpu_initializations=0
if VARIANT=='integer-vector3':
 original_gpu_init=gpu.init
 def forbidden_gpu(*args,**kwargs):
  global python_gpu_initializations
  python_gpu_initializations+=1
  raise RuntimeError('Integer Vector reference forbids Python GPU initialization')
 gpu.init=forbidden_gpu
 try:gpu.init()
 except RuntimeError:pass
 else:raise AssertionError('Native GPU initialization guard failed')
 assert python_gpu_initializations==1;python_gpu_initializations=0
rows=[]
source_files=sorted(str(p.relative_to(ROOT)) for directory in ['packages/blender-addon','packages/blendlink/blender'] for p in (ROOT/directory).glob('*.py'))+['experiments/static-switch-family/cases.py','experiments/static-switch-family/reference.py','experiments/static-switch-family/view_cases.py','experiments/static-switch-family/view-cases.json']
if VARIANT=='integer-vector3':
 source_files+=['experiments/static-switch-family/int_vector3_cases.py','experiments/static-switch-family/int-vector3-cases.json','experiments/compositor-int-vector3/sources.json','experiments/compositor-int-vector3/policy.py','packages/blender-addon/tests/compositor_integer_vector_check.py']+[str(p.relative_to(ROOT))for directory in ['packages/blender-addon','packages/blendlink/blender']for p in (ROOT/directory).glob('*.json')]
source_pins_before={p:sha(ROOT/p)for p in source_files}if VARIANT=='integer-vector3'else None
artifact_inputs=[]
for relative in source_files:
 if relative.startswith('experiments/')or'/tests/'in relative:continue
 source=ROOT/relative;artifact=ROOT/'packages/blendlink/dist'/('addon' if relative.startswith('packages/blender-addon/') else 'blender')/source.name
 assert sha(source)==sha(artifact),'Staged native helper differs: '+relative
 artifact_inputs.append({'source':relative,'artifact':str(artifact.relative_to(ROOT)),'sha256':sha(source)})
configurations=cases()
if VARIANT=='static':configurations.insert(0,{'case':'calibration','kind':'control','family':'control','mode':'RGBA','choice':0})
for row in configurations:
 name=row['case']
 if CONTEXT=='shader':
  material=bpy.data.materials.new('Artist static '+name);material.use_nodes=True;tree=material.node_tree;tree.nodes.clear();sink=tree.nodes.new('ShaderNodeOutputMaterial');root=tree.nodes.new('ShaderNodeBsdfPrincipled');tree.links.new(root.outputs[0],sink.inputs['Surface'])
  uv=tree.nodes.new('ShaderNodeTexCoord').outputs['UV']
  quantized=tree.nodes.new('ShaderNodeVectorMath');quantized.operation='SNAP';quantized.inputs[1].default_value=(.25,.25,.25);tree.links.new(uv,quantized.inputs[0]);uv=quantized.outputs['Vector']
  signal,node=(uv,None) if row['kind']=='control' else build(tree,row,'shader',uv)
  tree.links.new(signal,root.inputs['Base Color']);owner.data.materials.clear();owner.data.materials.append(material)
  program=tsl_ir.emit_channel(root.inputs['Base Color'],evaluation_engine='EEVEE')
  if row['kind'] in ['inactive','group']:assert not any(n.bl_idname=='ShaderNodeTexSky' for n in procedural.reachable_surface_nodes(tree))
 else:
  tree=bpy.data.node_groups.new('Artist static compositor '+name,'CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree;sink=tree.nodes.new('NodeGroupOutput');source=tree.nodes.new('CompositorNodeRLayers')
  signal,node=(source.outputs['Image'],None) if row['kind']=='control' else build(tree,row,'compositor',source.outputs['Image'])
  if VARIANT!='static'and row['kind']=='control':
   control=tree.nodes.new('CompositorNodeRGB');control.outputs[0].default_value=(.125,.25,.5,1);signal=control.outputs[0]
  tree.links.new(signal,sink.inputs[0]);program=compositor_graph.extract(scene);assert program['status']=='extracted',program
  if row['kind']!='control'and VARIANT!='integer-vector3':assert program['compileTimeViews'if VARIANT=='mono-view'else'compileTimeSelections'],name
  assert all(op['source']['nodeType']!='CompositorNodeKuwahara' for op in program['ops'])
 before=state(tree);entry=dict(row);entry['context']=CONTEXT
 path=OUT/(name+'.program.json');path.write_text(json.dumps(program,indent=2)+'\n');entry.update({'programFile':path.name,'programSha256':sha(path)})
 saved=row['saveFinal']if VARIANT=='integer-vector3'else VARIANT=='mono-view' or row['kind'] in ['control','field','group','mask','three-items','reordered'] or row['kind'].startswith('menu-source-') or row['kind']=='literal' and row['mode']=='RGBA' and row['choice']==1
 if saved:
  path=OUT/(name+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(path));entry.update({'sourceFile':path.name,'sourceSha256':sha(path)})
 if CONTEXT=='shader':
  created=set(tree.nodes);emission=tree.nodes.new('ShaderNodeEmission');emission.inputs['Strength'].default_value=1;tree.links.new(signal,emission.inputs['Color']);tree.links.new(emission.outputs[0],sink.inputs['Surface'])
  entry.update(render(name));tree.links.new(root.outputs[0],sink.inputs['Surface'])
  for n in list(tree.nodes):
   if n not in created:tree.nodes.remove(n)
 else:
  entry.update(render(name))
  if VARIANT!='static'and row['kind']=='control':
   expected=np.tile(np.array([.125,.25,.5,1],dtype='<f4'),SIZE*SIZE)
   actual=np.fromfile(OUT/entry['pixelFile'],dtype='<f4')
   assert np.array_equal(actual.view(np.uint32),expected.view(np.uint32)), 'Literal compositor calibration must close before capturing any view node'

 if VARIANT=='integer-vector3':
  actual=np.fromfile(OUT/entry['pixelFile'],dtype='<u4');wanted=np.tile(np.array(row['expectedWords'],dtype='<u4'),SIZE*SIZE)
  assert np.array_equal(actual,wanted),(name,actual[:4].tolist(),row['expectedWords'])
 assert before==state(tree),name
 if saved:assert sha(OUT/entry['sourceFile'])==entry['sourceSha256']
 entry['sourcePreserved']=True;rows.append(entry)
native_backend=({'evaluator':'native-cpu-compositor','requestedCompositorDevice':'CPU','gpuInitialized':False,'gpuEvaluationCredit':False}if VARIANT!='static'else{'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get()})
if VARIANT=='integer-vector3':assert source_pins_before=={p:sha(ROOT/p)for p in source_files},'Integer Vector native source census changed during capture'
packet={'status':'CAPTURED_STATIC_SELECTION','context':CONTEXT,'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'nativeBackend':native_backend,'sourcePreserved':True,**({'pythonGpuInitializationCalls':python_gpu_initializations}if VARIANT=='integer-vector3'else{}),'width':SIZE,'height':SIZE,'cases':rows,'sourceHashes':{p:sha(ROOT/p) for p in source_files},'artifactInputs':artifact_inputs}
if VARIANT=='integer-vector3':
 assert python_gpu_initializations==0;gpu.init=original_gpu_init
(OUT/'qualification.json').write_text(json.dumps(packet,indent=2)+'\n');print('SCENETOWEB_STATIC_SELECTION_NATIVE_PASSED '+json.dumps({'context':CONTEXT,'cases':len(rows),'saved':sum('sourceFile' in x for x in rows)}))
