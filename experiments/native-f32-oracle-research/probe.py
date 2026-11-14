# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Coordinated research GPU window, zero node/material qualification credit.
"""Calibrated direct Float32 framebuffer storage and one unchanged native BSL BODY.

BSL signature is explicitly adapted to GLSL; this is a new PythonGPU source
stage, not native EEVEE material evaluation or a shader-compiler identity claim.
"""
import hashlib,json,os,re,sys
from pathlib import Path
import bpy,gpu,numpy as np
from gpu_extras.batch import batch_for_shader
ROOT=Path(__file__).resolve().parents[2];OUT=Path(os.environ['SCENETOWEB_F32_ORACLE_PROBE']).resolve();OUT.mkdir(parents=True,exist_ok=True)
SOURCES=Path(os.environ['SCENETOWEB_F32_ORACLE_SOURCES']).resolve();manifest_path=Path(__file__).with_name('sources.json');manifest=json.loads(manifest_path.read_text())
sha=lambda data:hashlib.sha256(data).hexdigest()
assert tuple(bpy.app.version)==tuple(manifest['nativeVersion'])and bpy.app.build_hash.decode()==manifest['nativeBuild']
source_pins={}
for entry in manifest['sources']:
 data=(SOURCES/Path(entry['path']).name).read_bytes();assert sha(data)==entry['sha256'],entry['path'];source_pins[entry['path']]=entry['sha256']
# This is the explicit public5.3 background initialization path, not a dummy render.
gpu.init();backend={'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get(),'vendor':gpu.platform.vendor_get(),'version':gpu.platform.version_get()};assert backend['backend']=='METAL'and'Metal'in backend['renderer'],backend
native=(SOURCES/'gpu_shader_material_vector_math.bsl.hh').read_text();body=re.search(r'\bvoid vector_math_add\s*\(.*?\)\s*(\{.*?\n\})',native,re.S).group(1)
assert body=='{\n  outVector = a + b;\n}'
# Only declaration/ABI adapts; source arithmetic body remains byte identical.
function='void vector_math_add(vec3 a, vec3 b, vec3 c, float scale, out vec3 outVector, out float outValue)\n'+body
vertex='void main(){gl_Position=vec4(pos,0.0,1.0);}'
copy_fragment='void main(){fragColor=sourceA;}'
kernel_fragment=function+'\nvoid main(){vec3 result;float ignored=0.0;vector_math_add(sourceA.xyz,sourceB.xyz,vec3(0.0),1.0,result,ignored);fragColor=vec4(result,1.0);}'

def compile(fragment):
 info=gpu.types.GPUShaderCreateInfo();info.vertex_in(0,'VEC2','pos');info.fragment_out(0,'VEC4','fragColor');info.push_constant('VEC4','sourceA');info.push_constant('VEC4','sourceB');info.vertex_source(vertex);info.fragment_source(fragment)
 shader=gpu.shader.create_from_info(info);batch=batch_for_shader(shader,'TRI_FAN',{'pos':[(-1,-1),(1,-1),(1,1),(-1,1)]});return shader,batch
texture=gpu.types.GPUTexture((4,1),format='RGBA32F');framebuffer=gpu.types.GPUFrameBuffer(color_slots=[texture]);old_viewport=gpu.state.viewport_get();gpu.state.blend_set('NONE');gpu.state.depth_test_set('NONE')
rows=[]
try:
 copy,batch=compile(copy_fragment);kernel,kernel_batch=compile(kernel_fragment)
 controls=[('nonhalf-positive',[.1234567,.8765432,1.5678912,1]),('signed-hdr',[-.2345679,-2016.125,2049,1]),('tiny-normal',[2**-32,-2**-32,2**-126,1]),('adjacent',[np.nextafter(np.float32(.5),np.float32(1)),np.nextafter(np.float32(.5),np.float32(0)),np.nextafter(np.float32(1),np.float32(2)),1]),('signed-zero',[-0.,0.,-0.,1])]
 def draw(name,shader,batch,a,b,expected,stage):
  a=np.asarray(a,np.float32);b=np.asarray(b,np.float32);expected=np.asarray(expected,np.float32)
  with framebuffer.bind():
   gpu.state.viewport_set(0,0,4,1);framebuffer.clear(color=(0,0,0,0));shader.bind();shader.uniform_float('sourceA',a.tolist())
   # Unused copy-sourceB may be optimized away; only bind it for the kernel.
   if stage=='adapted-native-body':shader.uniform_float('sourceB',b.tolist())
   batch.draw(shader);pixels=np.asarray(framebuffer.read_color(0,0,4,1,4,0,'FLOAT'),np.float32).reshape(4,4).copy()
  wanted=np.tile(expected,(4,1));assert np.array_equal(pixels.view(np.uint32),wanted.view(np.uint32)),(name,pixels.tolist(),wanted.tolist())
  file=name+'.rgba32f';(OUT/file).write_bytes(pixels.tobytes());rows.append({'case':name,'stage':stage,'inputA':a.tolist(),'inputB':b.tolist(),'expectedWords':expected.view(np.uint32).astype(np.uint64).tolist(),'actualWords':pixels.view(np.uint32).astype(np.uint64).tolist(),'wordMismatches':0,'pixelFile':file,'pixelSha256':sha(pixels.tobytes())})
 for name,a in controls:draw(name,copy,batch,a,[0]*4,a,'independent-storage-calibration')
 for name,a,b in [('native-add-dyadic',[.125,-.25,2016.125,1],[.0625,-.125,0,0]),('native-add-ordinary',[.1234567,-.2345679,.1,1],[.8,.1,.2,0])]:
  expected=np.asarray(a,np.float32)+np.asarray(b,np.float32);expected[3]=1;draw(name,kernel,kernel_batch,a,b,expected,'adapted-native-body')
finally:gpu.state.viewport_set(*old_viewport);del framebuffer,texture
record={'status':'CALIBRATED_NATIVE_PYTHON_GPU_RGBA32F_RESEARCH','schemaVersion':1,'model':'blender53-python-glsl-adapted-bsl-body-rgba32f-v1','sourceStage':'Python GPU GLSL frontend, native Blender Metal compiler, direct RGBA32F framebuffer; BSL declaration adapted, body unchanged. Not actual EEVEE material/film output.','qualificationCredit':{'node':0,'actualMaterial':0,'fullScene':0},'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'backend':backend,'target':{'width':4,'height':1,'format':'RGBA32F','readFormat':'FLOAT','draws':len(rows)},'sourceFlags':{'evidence':'Pinned gpu_shader.cc and mtl_shader.mm, not runtime compiler introspection','pythonFrontEnd':'SourceProcessor(Language::GLSL)','pythonCreateInfo':['NO_BUFFER_TYPE_LINTING','NO_PREPROCESSOR'],'metalFastMathEnabled':True,'metalPreserveInvariance':True,'metalLanguageDefault':'2.2','materialCreateInfoAndMacroParity':False},'nativeFunction':{'name':'vector_math_add','sourceFile':'source/blender/gpu/shaders/material/gpu_shader_material_vector_math.bsl.hh','bodySha256':sha(body.encode()),'arithmeticBodyChanged':False,'declarationAdaptation':'Drop [[node]]; float3->vec3; C++ reference outputs->GLSL out; name ignored formal parameters; no function-body expression edits','adaptedFunctionSha256':sha(function.encode())},'sourcePins':source_pins,'manifestSha256':sha(manifest_path.read_bytes()),'probeSha256':sha(Path(__file__).read_bytes()),'shaderPins':{'vertex':sha(vertex.encode()),'copyFragment':sha(copy_fragment.encode()),'adaptedKernelFragment':sha(kernel_fragment.encode())},'calibrationCases':len(controls),'kernelCases':2,'comparedFloat32Words':len(rows)*4*4,'wordMismatches':0,'rows':rows}
for name,source in [('vertex.glsl',vertex),('copy-fragment.glsl',copy_fragment),('adapted-kernel-fragment.glsl',kernel_fragment)]: (OUT/name).write_text(source)
(OUT/'report.json').write_text(json.dumps(record,indent=2)+'\n');print('SCENETOWEB_NATIVE_F32_ORACLE_RESEARCH_PASSED '+json.dumps({'cases':len(rows),'words':record['comparedFloat32Words'],'wordMismatches':0,'backend':backend,'qualificationCredit':0}))
