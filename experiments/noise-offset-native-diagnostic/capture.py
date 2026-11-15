# SPDX-License-Identifier: GPL-3.0-or-later
"""Native-only stage attribution; original canonical Noise helpers unchanged."""
import sys,json,hashlib,time,re
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'experiments/native-f32-oracle-research'))
from framebuffer_oracle import FramebufferOracle,initialize_metal,calibration
OUT=Path(sys.argv[sys.argv.index('--')+1]);GEN=Path(sys.argv[sys.argv.index('--')+2]);OUT.mkdir(parents=True,exist_ok=True);sha=lambda b:hashlib.sha256(b).hexdigest()
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
meta=json.loads((GEN/'generation.json').read_text());library=(GEN/'canonical-metal-library.glsl').read_bytes();assert sha(library)==meta['nativeMetalPreprocess']['sha256'];assert meta['nativeMetalPreprocess']['guardBlocks']==20 and meta['nativeMetalPreprocess']['allBodyTokensUnchanged']
for path,pin in meta['sourcePins'].items():assert sha(Path(path).read_bytes())==pin,path
original=(GEN/'canonical-library.glsl').read_text();removed=re.findall(r'\bfloat\s+Noise\w+_noise_fn\s*\([^{};]*\)\s*;',original);assert len(removed)==20;assert re.sub(r'\s+','',re.sub(r'\bfloat\s+Noise\w+_noise_fn\s*\([^{};]*\)\s*;','',original))==re.sub(r'\s+','',library.decode())
identity=initialize_metal();surface=FramebufferOracle(2);rows=[];start=time.perf_counter()
# Same seed and lane bits as random_vec3_offset. Stage wrappers observe, never edit it.
common='uint h0=hash_uint2(floatBitsToUint(seed),floatBitsToUint(0.0f)); uint h1=hash_uint2(floatBitsToUint(seed),floatBitsToUint(1.0f)); uint h2=hash_uint2(floatBitsToUint(seed),floatBitsToUint(2.0f));'
unit='vec3(hash_vec2_to_float(vec2(seed,0.0f)),hash_vec2_to_float(vec2(seed,1.0f)),hash_vec2_to_float(vec2(seed,2.0f)))'
expressions={'hash-low':'vec3(float(h0&65535u),float(h1&65535u),float(h2&65535u))','hash-high':'vec3(float(h0>>16u),float(h1>>16u),float(h2>>16u))','uint-float':'vec3(float(h0),float(h1),float(h2))','unit':unit,'offset':'random_vec3_offset(seed)','fma':'vec3(fma(u.x,100.0f,100.0f),fma(u.y,100.0f,100.0f),fma(u.z,100.0f,100.0f))'}
try:
 controls=calibration(surface)
 for source in ['literal','uniform']:
  for stage,expression in [('seed-control','vec3(seed,0.0f,0.0f)'),*expressions.items()]:
   body=(''if stage=='seed-control'else library.decode()+'\n')+'vec3 diagnostic(float seed){'+(''if stage=='seed-control'else common+' vec3 u='+unit+';')+'return '+expression+';}\n'
   seed='vec3 a=diagnostic(3.0f);vec3 b=diagnostic(4.0f);'if source=='literal'else'vec3 a=diagnostic(seedValues.x);vec3 b=diagnostic(seedValues.y);'
   fragment=body+'void main(){'+seed+'fragColor=vec4(gl_FragCoord.x<1.0f?a:b,1.0f);}\n';name=source+'-'+stage;shader=OUT/(name+'.glsl');shader.write_text(fragment);t=time.perf_counter();compiled=surface.compile(fragment,uniforms=['seedValues']if source=='uniform'else[]);compile_ms=(time.perf_counter()-t)*1000;t=time.perf_counter();raw=surface.draw(compiled,uniforms={'seedValues':[3,4,0,1]}if source=='uniform'else{});elapsed=(time.perf_counter()-t)*1000;assert np.isfinite(raw).all();assert np.array_equal(raw[:,3],np.ones(2,np.float32));file=OUT/(name+'.rgba32f');file.write_bytes(raw.astype('<f4').tobytes());rows.append({'source':source,'stage':stage,'file':file.name,'sha256':sha(file.read_bytes()),'shader':shader.name,'shaderSha256':sha(shader.read_bytes()),'compileMs':compile_ms,'drawReadbackMs':elapsed,'words':8})
   if stage=='seed-control':assert np.array_equal(raw,np.asarray([[3,0,0,1],[4,0,0,1]],np.float32))
finally:surface.release()
assert len(rows)==14
report={'schemaVersion':1,'status':'CAPTURED_NATIVE_NOISE_OFFSET_DIAGNOSTIC','nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'backend':identity,'seeds':[3,4],'lanes':[0,1,2],'extent':[2,1],'order':'pixel0seed3,pixel1seed4,RGBxyz,alpha1','sourceKinds':['literal','uniform'],'stages':list(expressions),'draws':19,'milliseconds':(time.perf_counter()-start)*1000,'calibration':{'draws':5,'words':40,'wordMismatches':0,'controls':controls},'nativeLibrarySha256':sha(library),'genericLibrarySha256':meta['nativeMetalPreprocess']['browserCanonicalSha256'],'generationSha256':sha((GEN/'generation.json').read_bytes()),'generationSourcePins':meta['sourcePins'],'nativeMetalPreprocess':meta['nativeMetalPreprocess'],'rows':rows,'prototypePins':{str(p.relative_to(ROOT)):sha(p.read_bytes())for p in[Path(__file__),ROOT/'experiments/native-f32-oracle-research/framebuffer_oracle.py',ROOT/'experiments/uint32-f32-exhaustive/probe.cpp',ROOT/'packages/blendlink/src/tslCompositorWhiteNoiseRne.ts']},'supportCredit':0,'FinalCredit':0,'cpuCompositorCredit':0,'limits':['Actual native Metal PythonGPU source stage, not EEVEE material/film.','No changes to original random_vec3_offset/hash bodies; observation wrappers and explicit fma builtin only.','RNE and separate/fused arithmetic controls are host attribution, not new production math.']}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('CAPTURED_NATIVE_NOISE_OFFSET_DIAGNOSTIC',report['draws'],report['milliseconds'])
