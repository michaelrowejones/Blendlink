# SPDX-License-Identifier: Apache-2.0
"""CPU-only strict WASM/native C++ and actual public Mikk comparison."""
import hashlib,json,math,struct,subprocess,sys
from pathlib import Path
wasm,frozen,public,out=map(Path,sys.argv[1:]);out.mkdir(exist_ok=False)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
f32=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
word=lambda x:struct.pack('<f',x)
packed=lambda x:math.trunc(f32(f32(x)*511))
runner=Path(__file__).with_name('run.mjs');report={'status':'running','supportCredit':0,'sceneAcceptance':False,'renderCalls':0,'wasm':{'path':str(wasm),'bytes':wasm.stat().st_size,'sha256':sha(wasm)},'runnerSha256':sha(runner),'comparatorSha256':sha(__file__),'nativeReportSha256':sha(frozen/'report.json'),'publicReportSha256':sha(public/'report.json'),'rows':[]}
native=json.loads((frozen/'report.json').read_text());pub=json.loads((public/'report.json').read_text());assert pub['sourceUnchanged']
def parsed(b):return[(int(v[0]),*[f32(float(x))for x in v[1:]])for v in (line.split()for line in b.decode().splitlines())]
def check(id,input_bytes,native_bytes):
 r=subprocess.run(['node',str(runner),str(wasm)],input=input_bytes,capture_output=True,check=True);(out/(id+'.wasm.tangents')).write_bytes(r.stdout);(out/(id+'.stderr')).write_bytes(r.stderr)
 a,b=parsed(r.stdout),parsed(native_bytes);assert len(a)==len(b)
 assert [x[0]for x in a]==[x[0]for x in b]
 differences=sum(word(x)!=word(y)for aa,bb in zip(a,b)for x,y in zip(aa[1:],bb[1:]));snorm=sum(any(packed(x)!=packed(y)for x,y in zip(aa[1:4],bb[1:4]))for aa,bb in zip(a,b));sign=sum(word(aa[4])!=word(bb[4])for aa,bb in zip(a,b))
 row={'id':id,'callbackRows':len(a),'inputSha256':hashlib.sha256(input_bytes).hexdigest(),'nativeOutputSha256':hashlib.sha256(native_bytes).hexdigest(),'wasmOutputSha256':hashlib.sha256(r.stdout).hexdigest(),'float32WordDifferences':differences,'snorm10ChangedRows':snorm,'signWordDifferences':sign,'maximumAbsoluteDifference':max(abs(x-y)for aa,bb in zip(a,b)for x,y in zip(aa[1:],bb[1:]))}
 if id=='Plane.021-native-face-model':
  p=next(x for x in pub['rows']if x['id']=='Plane.021');data=(public/p['file']).read_bytes();assert sha(public/p['file'])==p['sha256'];actual={r[0]:r[1:]for r in struct.iter_unpack('<Iffff',data)};last={r[0]:r[1:]for r in a};assert actual.keys()==last.keys();row['publicNativeFloat32WordDifferences']=sum(word(x)!=word(y)for i in actual for x,y in zip(actual[i],last[i]));row['publicNativeSnorm10ChangedRows']=sum(any(packed(x)!=packed(y)for x,y in zip(actual[i][:3],last[i][:3]))for i in actual);row['publicNativeMaximumAbsoluteDifference']=max(abs(x-y)for i in actual for x,y in zip(actual[i],last[i]))
 report['rows'].append(row)
 failed=bool(differences or snorm or sign or row.get('publicNativeFloat32WordDifferences',0) or row.get('publicNativeSnorm10ChangedRows',0))
 report['status']='FAILED_EXACT_CPU_ORACLE'if failed else 'running'
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 assert not failed,row
for owner in native['owners']+native['fixtures']:
 for mode,key in [('native-face-model','sourceCallbackModel'),('all-triangles','allTrianglesModel')]:
  id=owner['id']+'-'+mode;ip=frozen/(id+'.mesh');np=frozen/(id+'.tangents');assert sha(ip)==owner[key]['inputSha256'];assert sha(np)==owner[key]['outputSha256'];check(id,ip.read_bytes(),np.read_bytes())
folded=json.loads(Path(__file__).resolve().parents[1].joinpath('archviz-tangent-frame/folded-quad-control.json').read_text())
for key,v in folded['models'].items():check('folded-quad-'+key,v['input'].encode(),v['output'].encode())
report['status']='PASSED_EXACT_CPU_ORACLE';report['publicWalls']='Native public calc_tangents refused n-gons; WASM/native C++ equality is a source-model result, not a native draw/GPU tangent certificate.'
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'rows':len(report['rows']),'callbackRows':sum(x['callbackRows']for x in report['rows'])}))
