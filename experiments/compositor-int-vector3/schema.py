# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native RNA, raw int32 and independent conversion research; no renders."""
from pathlib import Path
import json,sys
import bpy,gpu
OUT=Path(sys.argv[sys.argv.index('--')+1]);old_ops=bpy.ops;old_init=gpu.init;calls={'gpu':0,'render':0}
def deny_gpu(*args,**kwargs):calls['gpu']+=1;raise RuntimeError('Integer Vector schema forbids GPU')
class RenderGuard:
 def __getattr__(self,name):
  def denied(*args,**kwargs):calls['render']+=1;raise RuntimeError('Integer Vector schema forbids render')
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
 tree=bpy.data.node_groups.new('Owned Integer Vector Schema','CompositorNodeTree');node=tree.nodes.new('FunctionNodeInputIntVector')
 def socket(s):return {'name':s.name,'identifier':s.identifier,'type':s.type,'class':s.bl_idname,'value':list(s.default_value),'enabled':s.enabled,'unavailable':s.is_unavailable}
 rows=[]
 for width,values in [(3,[0,0,0]),(3,[-2147483648,2147483647,16777217]),(3,[-16777217,16777219,-16777219]),(2,[-2147483648,2147483647])]:
  node.vector_dimensions=width;node.vector=values;assert list(node.vector)==values
  rows.append({'dimensions':node.vector_dimensions,'propertyValue':list(node.vector),'inputs':len(node.inputs),'outputs':[socket(s)for s in node.outputs]})
 report={'status':'OBSERVED_INTEGER_VECTOR_RNA','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'rows':rows,'gpuInitializationCalls':calls['gpu'],'renderCalls':calls['render'],'guardCanariesRefused':True,'supportCredit':0}
 OUT.write_text(json.dumps(report,indent=2)+'\n');bpy.data.node_groups.remove(tree);print(report['status'])
finally:bpy.ops=old_ops;gpu.init=old_init
