#!/usr/bin/env python3
"""Static helper-call specialization under one pinned native precision profile."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import re
import subprocess
import sys
import time
sys.dont_write_bytecode=True
from specialize import clone_helper,clone_entry,function,lex,apply,ENTRY,ENTRY_CLONE
sha=lambda b:hashlib.sha256(b).hexdigest()


def main():
 ap=argparse.ArgumentParser();ap.add_argument('--canonical',type=pathlib.Path,required=True);ap.add_argument('--table',type=pathlib.Path,required=True);ap.add_argument('--closed',type=pathlib.Path,required=True);ap.add_argument('--naga',type=pathlib.Path,required=True);ap.add_argument('--out',type=pathlib.Path,required=True);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=False)
 here=pathlib.Path(__file__).resolve().parent;original=(a.canonical/'generation.json').read_bytes();base=json.loads(original)
 assert base['status']=='COMBINED_LIBRARY_GENERATED'
 for path,pin in base['sourcePins'].items():assert sha(pathlib.Path(path).read_bytes())==pin,path
 report=dict(schemaVersion=1,status='running',supportCredit=0,originalGenerationSha256=sha(original),sourcePins=dict(base['sourcePins']),commands=[],staticModel='native-metal53-m5pro-static-noise-color-3d-fbm-default-v1',genericBodiesChanged=False)
 def run(cmd):
  t=time.monotonic();p=subprocess.run(list(map(str,cmd)),capture_output=True,text=True,timeout=45);report['commands'].append(dict(command=list(map(str,cmd)),seconds=time.monotonic()-t,returncode=p.returncode,stdout=p.stdout,stderr=p.stderr));assert p.returncode==0,p.stderr+p.stdout
  return p.stdout
 try:
  validated=json.loads(run(['node',here/'validate-table.mjs',a.table,a.closed,a.canonical/'generation.json']))
  table=validated['table'];report['sourcePins'].update(validated['pins']);report['tableProfile']=table['profile'];report['tableAuthoritySha256']=table['closedSha256']
  for path in[here/'generate.py',here/'specialize.py',here/'validate-table.mjs']:
   report['sourcePins'][str(path)]=sha(path.read_bytes())
  library=(a.canonical/'canonical-library.glsl').read_bytes();assert sha(library)==base['canonicalLibrarySha256']
  helper,helper_proof=clone_helper(library.decode(),table['table']);entry,entry_proof=clone_entry(library.decode())
  # Clone the original fixed-default ABI wrapper with only names changed.
  abi=(a.canonical/'canonical-abi.glsl').read_bytes();assert sha(abi)==base['canonicalAbiSha256']
  original_wrapper=function(abi.decode(),'bridge_noise',['vec3','p']);tokens=lex(original_wrapper);changes=[]
  for i,t in enumerate(tokens):
   if i==1 and t[0]=='bridge_noise':changes.append((t[1],t[2],'bridge_noise_static'))
   elif t[0]==ENTRY:changes.append((t[1],t[2],ENTRY_CLONE))
  assert len(changes)==2;wrapper=apply(original_wrapper,changes)
  voronoi=function(abi.decode(),'bridge_voronoi_first',['vec3','p'])
  wrappers={'bridge_noise_static':wrapper,'bridge_voronoi_first':voronoi}
  derived='\n'+helper+'\n'+entry+'\n'
  (a.out/'derived-clones.glsl').write_text(derived)
  # The complete original library remains an identical byte prefix.
  assembly=library.decode()+derived+'\n'+'\n'.join(wrappers.values())
  assert assembly.encode().startswith(library)
  stage='#version 450\n'+assembly+'\nlayout(location=0) out vec4 bridge_stage_output;void main(){vec3 p=gl_FragCoord.xyz;vec4 color=bridge_noise_static(p);bridge_stage_output=color+bridge_noise_static(color.rgb)+bridge_voronoi_first(color.rgb);}\n'
  glsl=a.out/'static-color.frag';wgsl=a.out/'static-color.wgsl';es=a.out/'static-color.es.frag';glsl.write_text(stage)
  run([a.naga,'--input-kind','glsl','--shader-stage','frag','--compact','--entry-point','main',glsl,wgsl])
  # Reuse the exact approved Float32-max spelling rule, never other constants.
  text=wgsl.read_text();(a.out/'static-color.naga-original.wgsl').write_text(text)
  decimal='340282350000000000000000000000000000000f';hexa='0x1.fffffep+127f';count=text.count(decimal);assert count==3
  assert (((1<<24)-1)<<104)<int(decimal[:-1])<(((1<<24)-1)<<104)+(1<<103)
  text=text.replace(decimal,hexa);wgsl.write_text(text);run([a.naga,wgsl]);run([a.naga,'--profile','es300',wgsl,es])
  packaging=here.parent/'shader-kernel-bridge-next/generate.py';report['sourcePins'][str(packaging)]=sha(packaging.read_bytes())
  spec=importlib.util.spec_from_file_location('frozen_bridge_packaging',packaging);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.WRAPPERS=wrappers
  wlib,wfn,wnames=m.package_module(text,'wgsl');glib,gfn,gnames=m.package_module(es.read_text(),'glsl')
  old=json.loads((a.canonical/'module.json').read_bytes());notice=old['wgslLibrary'].split('struct VoronoiParams {',1)[0];assert'SPDX-License-Identifier:'in notice
  module=dict(model=report['staticModel'],sourceSha256=sha(assembly.encode()),glslLibrary=notice+glib,wgslLibrary=notice+wlib,glslFunctions=gfn,wgslFunctions=wfn,tableProfile=table['profile'],tableAuthoritySha256=table['closedSha256'])
  (a.out/'module.json').write_text(json.dumps(module,indent=2)+'\n')
  # Source originals and each edit span are archived as provenance, not replaced.
  (a.out/'source-clone-proof.json').write_text(json.dumps({'helper':helper_proof,'entry':entry_proof,'originalWrapper':original_wrapper,'originalLibrarySha256':sha(library),'originalAbiSha256':sha(abi),'genericPrefixByteIdentical':True},indent=2)+'\n')
  report.update(status='STATIC_NOISE_COLOR_LIBRARY_GENERATED',moduleSha256=sha((a.out/'module.json').read_bytes()),originalLibrarySha256=sha(library),cloneProofSha256=sha((a.out/'source-clone-proof.json').read_bytes()),helperCallSubstitutions=2,nativeOffsetWords=table['table'],internalFunctions=len(wnames),literalSpellingReplacements=count,moduleBytes={p.name:p.stat().st_size for p in[glsl,wgsl,es]},staticParameters={'dimensions':3,'type':'FBM','scale':5,'detail':2,'roughness':.5,'lacunarity':2,'distortion':0,'normalize':True,'computeColor':True})
  for path,pin in report['sourcePins'].items():assert sha(pathlib.Path(path).read_bytes())==pin,path
 except BaseException as e:report.update(status='FAILED_ZERO_CREDIT',error=str(e));raise
 finally:(a.out/'generation.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':main()
