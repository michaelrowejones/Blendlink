# SPDX-License-Identifier: GPL-3.0-or-later
"""Run the reviewed source policy with GPU initialization trapped; no render."""
import contextlib,hashlib,io,json,os,runpy,sys
from pathlib import Path
import gpu
ROOT=Path(__file__).resolve().parents[2];input_rotation=os.environ.get('SCENETOWEB_STATIC_EULER_VARIANT','euler')=='input-rotation';script=ROOT/('packages/blender-addon/tests/compositor_input_rotation_check.py'if input_rotation else'packages/blender-addon/tests/compositor_static_euler_check.py');original=gpu.init;calls=[]
def forbidden(*args,**kwargs):calls.append('gpu.init');raise AssertionError('Static quaternion policy must not initialize GPU')
stream=io.StringIO()
try:
 gpu.init=forbidden
 original_argv=sys.argv[:]
 try:
  if input_rotation:sys.argv=[str(script),'--',str(Path(os.environ['SCENETOWEB_STATIC_EULER_REFERENCES'])/'input-rotation-policy-detail.json')]
  with contextlib.redirect_stdout(stream):runpy.run_path(str(script),run_name='__main__')
 finally:sys.argv=original_argv
finally:gpu.init=original
text=stream.getvalue();print(text,end='');prefix='SCENETOWEB_INPUT_ROTATION_POLICY_PASSED 'if input_rotation else'BLENDLINK_STATIC_EULER_POLICY_PASSED ';line=next(row for row in text.splitlines()if row.startswith(prefix));details=json.loads((Path(os.environ['SCENETOWEB_STATIC_EULER_REFERENCES'])/'input-rotation-policy-detail.json').read_text())if input_rotation else json.loads(line[len(prefix):]);assert not calls
report={'schemaVersion':1,'status':'STATIC_INPUT_ROTATION_SOURCE_POLICY_PASSED'if input_rotation else'STATIC_EULER_SOURCE_POLICY_PASSED','positive':details['positive'],'refusals':details['refusals'],'gpuInitializationCalls':len(calls),'renders':0,'supportCredit':0,'scriptSha256':hashlib.sha256(script.read_bytes()).hexdigest()}
if input_rotation:
 report.update(candidatePositive=details['positive'][:-2],regressionPositive=details['positive'][-2:],outputGuardRefusals=details['refusals'][7:15],detailSha256=hashlib.sha256((Path(os.environ['SCENETOWEB_STATIC_EULER_REFERENCES'])/'input-rotation-policy-detail.json').read_bytes()).hexdigest())
if os.environ.get('SCENETOWEB_STATIC_EULER_REFERENCES'):
 out=Path(os.environ['SCENETOWEB_STATIC_EULER_REFERENCES']);out.mkdir(parents=True,exist_ok=True);(out/'policy.json').write_text(json.dumps(report,indent=2)+'\n')
print(report['status'],len(report['positive']),len(report['refusals']))
