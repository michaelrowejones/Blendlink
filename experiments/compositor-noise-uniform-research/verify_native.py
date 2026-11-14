# SPDX-License-Identifier: GPL-3.0-or-later
"""CPU-only independent reread; no Blender API or native recapture."""
from pathlib import Path
import hashlib,json,struct,sys
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];OUT=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(HERE))
from model import compare,F,word
report_path=OUT/'report.json';report=json.loads(report_path.read_text());contract=json.loads((HERE/'contract.json').read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert report['contractSha256']==sha(HERE/'contract.json')
assert report['sourceProfile']=={'version':[5,3,0],'build':'02f0899d78e3','engine':'CYCLES','compositor':'CPU','precision':'FULL'}
for p,h in report['sourceHashes'].items():assert sha(ROOT/p)==h,p
assert report['nativeRenders']==20 and report['pythonGpuInitializationCalls']==0
assert all(report[k]==0 for k in ['gpuRuns','finalCredit','browserCredit','portCredit'])

def pixels(row):
 p=(OUT/row['pixelFile']).resolve();assert p.parent==OUT and sha(p)==row['pixelSha256'];data=p.read_bytes();assert len(data)==row['width']*row['height']*16
 exr=(OUT/row['exrFile']).resolve();assert exr.parent==OUT and sha(exr)==row['exrSha256']
 return list(struct.unpack('='+str(len(data)//4)+'f',data))

assert [(r['width'],r['height'])for r in report['coordinateControls']]==[tuple(pair)for pair in contract['extents']]
coordinates={};coordinate_words=0
for row in report['coordinateControls']:
 w,h=row['width'],row['height'];actual=pixels(row);maximum=max(w,h);expected=[]
 for y in range(h):
  for x in range(w):expected.extend([F(F(F(F(x+.5)-F(w/2))/maximum)*2),F(F(F(F(y+.5)-F(h/2))/maximum)*2),0.,1.])
 assert list(map(word,actual))==list(map(word,expected));coordinates[(w,h)]=actual;coordinate_words+=len(actual)
expected_cases=[f'{w}x{h}-{route}'for w,h in contract['extents']for route in contract['routes']]
assert [r['case']for r in report['cases']]==expected_cases
summary={model:{'words':0,'wordDifferences':0,'contractViolations':0,'maxAbs':0,'maxUlps':0}for model in contract['models']}
fields=[];actual_by_case={};source_preserved=0
for row in report['cases']:
 actual=pixels(row);coords=coordinates[(row['width'],row['height'])];route=row['route'];actual_by_case[row['case']]=actual
 assert row['nativeAlphaExact']and all(word(v)==word(1)for v in actual[3::4]);assert row['vectorLinked']is False
 assert row['defaults']=={'Scale':5.,'Detail':2.,'Roughness':.5,'Lacunarity':2.,'Distortion':0.}
 if 'sourceFile'in row:
  source=(OUT/row['sourceFile']).resolve();assert source.parent==OUT and sha(source)==row['sourceSha256']and row['sourcePreserved'];source_preserved+=1
 for model in contract['models']:
  metric=compare(actual,coords,route,model,contract['precision']);assert metric==row['models'][model];assert metric['contractViolations']==0
  if model=='source-unsuffixed-double-staging':assert metric['wordDifferences']==0
  total=summary[model]
  for k in ['words','wordDifferences','contractViolations']:total[k]+=metric['comparedWords'if k=='words'else k]
  total['maxAbs']=max(total['maxAbs'],metric['maxAbs']);total['maxUlps']=max(total['maxUlps'],metric['maxUlps'])
 unique=len({tuple(map(word,actual[i:i+3]))for i in range(0,len(actual),4)})
 if route.startswith('default'):assert unique>1;fields.append({'case':row['case'],'distinctRgbTuples':unique})
 if route.endswith('fac'):
  for i in range(0,len(actual),4):
   if route.startswith('scale-zero')or coords[i]==0 and coords[i+1]==0:assert word(actual[i])==word(.5)
for w,h in contract['extents']:
 for prefix in ['default','scale-zero']:assert all(word(a)==word(b)for a,b in zip(actual_by_case[f'{w}x{h}-{prefix}-fac'][::4],actual_by_case[f'{w}x{h}-{prefix}-color'][::4]))
result={'status':'INDEPENDENT_NOISE_CPU_RESEARCH_RECHECKED','reportSha256':sha(report_path),'contractSha256':sha(HERE/'contract.json'),'coordinateWords':coordinate_words,'nativeRenders':20,'noiseRows':16,'genuineDefaultFieldRows':len(fields),'savedOwnedSourcesPreserved':source_preserved,'fieldVariation':fields,'models':summary,'gpuRuns':0,'finalCredit':0,'browserCredit':0,'portCredit':0}
(OUT/'independent-summary.json').write_text(json.dumps(result,indent=2)+'\n');print(result['status'])
