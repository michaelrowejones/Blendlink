# SPDX-License-Identifier: GPL-3.0-or-later
"""Measured render/GPU-denied source policy, separate from numerical capture."""
from pathlib import Path
import json,os,runpy
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2]
blocked={'gpu':0,'render':0};original_ops=bpy.ops;original_init=gpu.init

def no_gpu(*args,**kwargs):
 blocked['gpu']+=1
 raise RuntimeError('Noise source policy forbids gpu.init')
class RenderGuard:
 def __getattr__(self,name):
  def denied(*args,**kwargs):
   blocked['render']+=1
   raise RuntimeError('Noise source policy forbids render operators')
  return denied
class OpsGuard:
 def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(original_ops,name)
owned_ops=OpsGuard();bpy.ops=owned_ops;gpu.init=no_gpu
try:
 for label,action in [('gpu',gpu.init),('render',bpy.ops.render.render)]:
  try:action()
  except RuntimeError as error:assert 'Noise source policy forbids'in str(error)
  else:raise AssertionError('Policy guard did not refuse '+label)
 assert blocked=={'gpu':1,'render':1};blocked={'gpu':0,'render':0}
 result=runpy.run_path(str(ROOT/'packages/blender-addon/tests/compositor_noise_check.py'))
 assert blocked=={'gpu':0,'render':0}
 packet={'status':'NOISE_DEFAULT_FIELD_SOURCE_POLICY_PASSED','positive':result['positive'],'refusals':result['refusals'],'renders':blocked['render'],'gpuInitializationCalls':blocked['gpu'],'portCredit':0,'guardControls':{'gpuInitializationRefused':True,'renderRefused':True}}
 Path(os.environ['SCENETOWEB_NOISE_DEFAULT_FIELD_POLICY']).write_text(json.dumps(packet,indent=2)+'\n')
 print(packet['status'])
finally:
 if bpy.ops is owned_ops:bpy.ops=original_ops
 if gpu.init is no_gpu:gpu.init=original_init
