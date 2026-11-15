# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent native Metal execution of original pre-Naga lowered GLSL."""
import sys,json,hashlib,time
from pathlib import Path
import bpy,gpu,numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'experiments/native-f32-oracle-research'))
from framebuffer_oracle import FramebufferOracle,initialize_metal,calibration,VERTEX_SOURCE
from gpu_extras.batch import batch_for_shader
args=sys.argv[sys.argv.index('--')+1:];OUT=Path(args[0]);GEN=Path(args[1]);INPUT=Path(args[2]);OUT.mkdir(parents=True,exist_ok=True)
sha=lambda data:hashlib.sha256(data).hexdigest()
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
generation=json.loads((GEN/'generation.json').read_text());assert generation['status']=='COMBINED_LIBRARY_GENERATED';library=(GEN/'canonical-metal-library.glsl').read_bytes();abi=(GEN/'canonical-abi.glsl').read_bytes();assert sha(library)==generation['nativeMetalPreprocess']['sha256'];assert sha(abi)==generation['canonicalAbiSha256']
for path,pin in generation['sourcePins'].items():assert sha(Path(path).read_bytes())==pin,path
input_bytes=INPUT.read_bytes();input_data=json.loads(input_bytes);assert input_data['extent']==[8,8];assert input_data['order']=='x-fastest, bottom row first';words=np.asarray([row['words']for row in input_data['rows']],np.uint32);assert words.shape==(64,4);values=words.view(np.float32)
for i,(row,value)in enumerate(zip(input_data['rows'],values)):
 x=i%8;y=i//8;assert[row['x'],row['y']]==[x,y];expected=np.array([(x+.5)/8*4-2,(y+.5)/8*4-2,(x+y+1)/8-1,1],np.float32);assert np.array_equal(expected.view(np.uint32),value.view(np.uint32))
(OUT/'input.json').write_bytes(input_bytes);(OUT/'input.rgba32f').write_bytes(words.astype('<u4').tobytes());(OUT/'canonical-library.glsl').write_bytes(library);(OUT/'canonical-abi.glsl').write_bytes(abi)
identity=initialize_metal();surface=FramebufferOracle(64);texture=None;rows=[];start=time.perf_counter()
try:
 controls=calibration(surface)
 texture=gpu.types.GPUTexture((64,1),format='RGBA32F',data=gpu.types.Buffer('FLOAT',values.size,values.ravel()))
 expressions={'input':'p','gradient-radial':'bridge_gradient(p.xyz)','noise-fbm3-default':'bridge_noise(p.xyz)','voronoi-f1-3d-default':'bridge_voronoi_first(p.xyz)','voronoi-f2-3d-default':'bridge_voronoi_second(p.xyz)','noise-twice':'bridge_noise(bridge_noise(p.xyz).rgb)','noise-to-voronoi-first':'bridge_voronoi_first(bridge_noise(p.xyz).rgb)'}
 for name,expression in expressions.items():
  fragment=(''if name=='input'else library.decode()+'\n'+abi.decode())+'\nvoid main(){ vec4 p=texelFetch(oracle_input,ivec2(int(gl_FragCoord.x),0),0); fragColor='+expression+'; }\n'
  shader_file=OUT/(name+'.glsl');shader_file.write_text(fragment);t=time.perf_counter();
  if name=='input':compiled=surface.compile(fragment,samplers=['oracle_input'])
  else:
   info=gpu.types.GPUShaderCreateInfo();info.vertex_in(0,'VEC2','pos');info.fragment_out(0,'VEC4','fragColor');info.sampler(0,'FLOAT_2D','oracle_input');info.typedef_source(library.decode()+'\n'+abi.decode());info.vertex_source(VERTEX_SOURCE);info.fragment_source('void main(){vec4 p=texelFetch(oracle_input,ivec2(int(gl_FragCoord.x),0),0);fragColor='+expression+';}');shader=gpu.shader.create_from_info(info);compiled=(shader,batch_for_shader(shader,'TRI_FAN',{'pos':[(-1,-1),(1,-1),(1,1),(-1,1)]}))
  compile_ms=(time.perf_counter()-t)*1000;t=time.perf_counter();actual=surface.draw(compiled,samplers={'oracle_input':texture});draw_ms=(time.perf_counter()-t)*1000;assert np.isfinite(actual).all();path=OUT/(name+'.rgba32f');path.write_bytes(actual.astype('<f4').tobytes());rows.append({'case':name,'rawFile':path.name,'rawSha256':sha(path.read_bytes()),'shaderFile':shader_file.name,'shaderSha256':sha(shader_file.read_bytes()),'words':256,'compileMs':compile_ms,'drawReadbackMs':draw_ms})
  if name=='input':assert np.array_equal(actual.view(np.uint32),words),'Native input upload/readback changed before kernels'
finally:texture=None;surface.release()
report={'schemaVersion':1,'status':'CAPTURED_NATIVE_PRE_NAGA_KERNEL_F32','model':'Blender53-PythonGPU-original-lowered-GLSL-Metal-RGBA32F-v1','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'backend':identity,'extent':[8,8],'nativeDraws':len(controls)+len(rows),'milliseconds':(time.perf_counter()-start)*1000,'calibration':{'cases':len(controls),'words':len(controls)*256,'wordMismatches':0,'controls':controls},'inputSha256':sha(input_bytes),'canonicalLibrarySha256':sha(library),'canonicalAbiSha256':sha(abi),'generationSha256':sha((GEN/'generation.json').read_bytes()),'generationSourcePins':generation['sourcePins'],'consumedTargetWgsl':False,'consumedTargetEsGlsl':False,'nativeMetalPreprocess':generation['nativeMetalPreprocess'],'originalBodiesChanged':False,'libraryPlacement':'Public GPUShaderCreateInfo.typedef_source; fragment entry separate','runs':rows,'prototypePins':{str(path.relative_to(ROOT)):sha(path.read_bytes())for path in[Path(__file__),ROOT/'experiments/native-f32-oracle-research/framebuffer_oracle.py']},'supportCredit':0,'FinalCredit':0,'eeveeMaterialCredit':0,'limits':['Actual Blender native Metal compiler with original pre-Naga GLSL and exact input; no CPU-MF alias.','PythonGPU GLSL frontend/create-info/optimization context differs from actual EEVEE material; EEVEE crosscheck remains separate.','No derivatives/textures/closures/lights/material fusion or whole-scene proof beyond these explicit pure kernels.']}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('CAPTURED_NATIVE_PRE_NAGA_KERNEL_F32',report['nativeDraws'],report['milliseconds'])
