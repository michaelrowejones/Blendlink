# SPDX-License-Identifier: GPL-3.0-or-later
"""Research CPU boundary classification; finite carrier pixels grant no frame admission."""
import hashlib, importlib.util, json, math, struct, sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
path=root/'experiments/eevee-tangent-frame-spec/reference.py';spec=importlib.util.spec_from_file_location('frame_spec',path);model=importlib.util.module_from_spec(spec);spec.loader.exec_module(model)
directory=Path(sys.argv[1]).resolve();report=json.loads((directory/'report.json').read_text());rows=[]
for case in report['rows']:
 data=json.loads((directory/case['file']).read_text())
 def read(name,width):
  b=(directory/data['attributes'][name]['file']).read_bytes();assert hashlib.sha256(b).hexdigest()==data['attributes'][name]['sha256']
  values=struct.unpack('<'+'f'*(len(b)//4),b);return[values[i:i+width] for i in range(0,len(values),width)]
 normals,tangents,signs=read('_STW_FRAME_N',3),read('_STW_FRAME_T',3),read('_STW_FRAME_SIGN',1)
 zero=0;near=0;sentinel=0;minimum=math.inf
 for n,t,s in zip(normals,tangents,signs):
  n,t4=model.vertex(n,t,s[0],data['frame']['normalMatrix']);b=model.cross(n,t4[:3]);length=math.sqrt(model.dot(b,b));minimum=min(minimum,length);near+=length<.05
  result=model.resolve(n,t4,(.5,1,.5),negative_scale=data['frame']['negativeObjectScale']);zero+=result['undefined'];sentinel+=result['sentinel']
 rows.append({'name':data['name'],'loops':len(normals),'nearlyParallelCorners':near,'minimumCrossLength':minimum,'pureBAxisUndefinedAtCorner':zero,'fragmentSentinelAtCorner':sentinel,'disposition':'PURE_B_BOUNDARY_SEPARATE_GATE_NO_FALLBACK_OTHER_RGB_NOT_INFERRED' if near or zero else 'CPU_CORNER_NONPARALLEL_ONLY_NOT_INTERPOLATED_FRAME_CERTIFICATE'})
print(json.dumps({'status':'CPU_FRAME_BOUNDARIES_RECORDED_NOT_NATIVE_DRAW_PROOF','supportCredit':0,'referenceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'rows':rows},indent=2))
