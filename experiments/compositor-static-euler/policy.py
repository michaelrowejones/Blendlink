# SPDX-License-Identifier: GPL-3.0-or-later
"""Run the reviewed source policy with GPU initialization trapped; no render."""
import contextlib,hashlib,io,json,os,runpy
from pathlib import Path
import gpu
ROOT=Path(__file__).resolve().parents[2];script=ROOT/'packages/blender-addon/tests/compositor_static_euler_check.py';original=gpu.init;calls=[]
def forbidden(*args,**kwargs):calls.append('gpu.init');raise AssertionError('Static quaternion policy must not initialize GPU')
stream=io.StringIO()
try:
 gpu.init=forbidden
 with contextlib.redirect_stdout(stream):runpy.run_path(str(script),run_name='__main__')
finally:gpu.init=original
text=stream.getvalue();print(text,end='');prefix='BLENDLINK_STATIC_EULER_POLICY_PASSED ';line=next(row for row in text.splitlines()if row.startswith(prefix));details=json.loads(line[len(prefix):]);assert not calls
report={'schemaVersion':1,'status':'STATIC_EULER_SOURCE_POLICY_PASSED','positive':details['positive'],'refusals':details['refusals'],'gpuInitializationCalls':len(calls),'renders':0,'supportCredit':0,'scriptSha256':hashlib.sha256(script.read_bytes()).hexdigest()}
if os.environ.get('SCENETOWEB_STATIC_EULER_REFERENCES'):
 out=Path(os.environ['SCENETOWEB_STATIC_EULER_REFERENCES']);out.mkdir(parents=True,exist_ok=True);(out/'policy.json').write_text(json.dumps(report,indent=2)+'\n')
print(report['status'],len(report['positive']),len(report['refusals']))
