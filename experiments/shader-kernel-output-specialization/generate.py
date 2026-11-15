#!/usr/bin/env python3
"""Output-aware wrappers over retained, unchanged canonical Blender bodies."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys
import time
sys.dont_write_bytecode=True
WRAPPERS={
 'bridge_noise_fac': 'float bridge_noise_fac(vec3 p) { float value; vec4 unusedColor=vec4(0.0); node_noise_tex_fbm_3d(p,0.0,5.0,2.0,0.5,2.0,0.0,1.0,0.0,1.0,0.0,value,unusedColor); return value; }',
 'bridge_voronoi_distance': 'float bridge_voronoi_distance(vec3 p) { VoronoiParams params=VoronoiParams_ctor_(); params.feature=0; params.metric=0; params.scale=5.0; params.detail=0.0; params.roughness=0.5; params.lacunarity=2.0; params.smoothness=0.5; params.exponent=0.5; params.randomness=1.0; params.normalize=false; params.max_distance=voronoi_distance(vec3(0.0),vec3(1.0),params); VoronoiOutput result=voronoi_f1(params,p*5.0); return result.Distance; }',
}
sha=lambda b:hashlib.sha256(b).hexdigest()


def main():
 ap=argparse.ArgumentParser();ap.add_argument('--canonical',type=pathlib.Path,required=True);ap.add_argument('--naga',type=pathlib.Path,required=True);ap.add_argument('--out',type=pathlib.Path,required=True);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=False)
 source=a.canonical.resolve();original=(source/'generation.json').read_bytes();base=json.loads(original)
 assert base['status']=='COMBINED_LIBRARY_GENERATED'
 for path,pin in base['sourcePins'].items():assert sha(pathlib.Path(path).read_bytes())==pin,path
 library=(source/'canonical-library.glsl').read_bytes();assert sha(library)==base['canonicalLibrarySha256']
 helper=pathlib.Path(__file__).resolve().parent.parent/'shader-kernel-bridge-next/generate.py'
 spec=importlib.util.spec_from_file_location('frozen_bridge_packaging',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.WRAPPERS=WRAPPERS
 report=dict(schemaVersion=1,status='running',supportCredit=0,originalGenerationSha256=sha(original),canonicalLibrarySha256=sha(library),commands=[],sourcePins={**base['sourcePins'],str(pathlib.Path(__file__).resolve()):sha(pathlib.Path(__file__).read_bytes())},staticPreconditions={'noise':{'dimensions':3,'type':'FBM','normalize':True,'scale':5,'detail':2,'roughness':.5,'lacunarity':2,'distortion':0,'selectedOutput':'Fac','compute_color':0},'voronoi':{'dimensions':3,'feature':'F1','metric':0,'scale':5,'detail':0,'normalize':False,'roughness':.5,'lacunarity':2,'randomness':1,'exponent':.5,'smoothness':1,'selectedOutput':'Distance'}},kernelBodiesChanged=False)
 def run(cmd):
  t=time.monotonic();p=subprocess.run(list(map(str,cmd)),capture_output=True,text=True,timeout=45);report['commands'].append(dict(command=list(map(str,cmd)),seconds=time.monotonic()-t,returncode=p.returncode,stdout=p.stdout,stderr=p.stderr));assert p.returncode==0,p.stderr+p.stdout
 try:
  stage='#version 450\n'+library.decode()+'\n'+'\n'.join(WRAPPERS.values())+'\nlayout(location=0) out vec4 bridge_stage_output; void main(){vec3 p=gl_FragCoord.xyz;bridge_stage_output=vec4(bridge_noise_fac(p),bridge_voronoi_distance(p),0.0,1.0);}\n'
  glsl=a.out/'specialized.frag';wgsl=a.out/'specialized.wgsl';es=a.out/'specialized.es.frag';glsl.write_text(stage)
  run([a.naga,'--input-kind','glsl','--shader-stage','frag','--compact','--entry-point','main',glsl,wgsl])
  # Preserve the same approved one-token spelling adapter and independent guard.
  decimal='340282350000000000000000000000000000000f';hexa='0x1.fffffep+127f'
  text=wgsl.read_text();(a.out/'specialized.naga-original.wgsl').write_text(text);count=text.count(decimal);assert count==1,count
  adapter=pathlib.Path(__file__).resolve().parent.parent/'shader-kernel-bridge-next/adapt-max-literal.py';report['sourcePins'][str(adapter)]=sha(adapter.read_bytes())
  assert ((1<<24)-1)<<104 < int(decimal[:-1]) < (((1<<24)-1)<<104)+(1<<103)
  text=text.replace(decimal,hexa);wgsl.write_text(text);run([a.naga,wgsl]);run([a.naga,'--profile','es300',wgsl,es])
  wlib,wfn,wnames=m.package_module(text,'wgsl');glib,gfn,gnames=m.package_module(es.read_text(),'glsl')
  # The original full module supplies exact original SPDX/copyright notices.
  full=json.loads((source/'module.json').read_bytes());notice=full['wgslLibrary'].split('struct VoronoiParams {',1)[0];assert 'SPDX-License-Identifier:'in notice
  module=dict(schemaVersion=1,model='native-output-aware-scalar-pilot-v1',sourceSha256=sha(library+('\n'.join(WRAPPERS.values())).encode()),glslLibrary=notice+glib,wgslLibrary=notice+wlib,glslFunctions=gfn,wgslFunctions=wfn)
  (a.out/'module.json').write_text(json.dumps(module,indent=2)+'\n')
  (a.out/'scalar-wrappers.glsl').write_text('\n'.join(WRAPPERS.values())+'\n')
  report.update(status='OUTPUT_AWARE_LIBRARY_GENERATED',moduleSha256=sha((a.out/'module.json').read_bytes()),wgslInternalFunctions=len(wnames),glslInternalFunctions=len(gnames),literalSpellingReplacements=count,moduleBytes={p.name:p.stat().st_size for p in[glsl,wgsl,es]},wrapperSha256=sha((a.out/'scalar-wrappers.glsl').read_bytes()))
 except BaseException as e:report.update(status='FAILED_ZERO_CREDIT',error=str(e));raise
 finally:(a.out/'generation.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':main()
