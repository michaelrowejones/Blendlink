# SPDX-License-Identifier: GPL-3.0-or-later
"""Execute source policy under measured render/GPU denial."""
from pathlib import Path
import json,runpy,sys
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];OUT=Path(sys.argv[sys.argv.index('--')+1]);old_ops=bpy.ops;old_init=gpu.init;calls={'gpu':0,'render':0}
def deny_gpu(*args,**kwargs):calls['gpu']+=1;raise RuntimeError('Integer Vector policy forbids GPU')
class RenderGuard:
 def __getattr__(self,name):
  def denied(*args,**kwargs):calls['render']+=1;raise RuntimeError('Integer Vector policy forbids render')
  return denied
class OpsGuard:
 def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(old_ops,name)
bpy.ops=OpsGuard();gpu.init=deny_gpu
try:
 for action in [gpu.init,bpy.ops.render.render,bpy.ops.render.bake]:
  try:action()
  except RuntimeError:pass
  else:raise AssertionError('Guard failed')
 assert calls=={'gpu':1,'render':2};calls={k:0 for k in calls}
 result=runpy.run_path(str(ROOT/'packages/blender-addon/tests/compositor_integer_vector_check.py'))
 assert calls=={'gpu':0,'render':0}
 OUT.write_text(json.dumps({'status':'PASSED_INTEGER_VECTOR_SOURCE_POLICY','positive':result['positive'],'refusals':result['refusals'],'guardCanariesRefused':True,'gpuInitializationCalls':calls['gpu'],'renderCalls':calls['render'],'supportCredit':0},indent=2)+'\n')
finally:bpy.ops=old_ops;gpu.init=old_init
