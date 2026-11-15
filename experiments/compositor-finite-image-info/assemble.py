# SPDX-License-Identifier: GPL-3.0-or-later
"""No-render assembly of the declared next proof case plan; no numerical credit."""
from pathlib import Path
from unittest.mock import patch
import json,sys
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(Path(__file__).parent)]
from cases import cases,build
import compositor_graph as graph
OUT=Path(sys.argv[sys.argv.index('--')+1]);OUT.mkdir(exist_ok=True);old_ops=bpy.ops;calls={'render':0,'gpu':0}
class RenderGuard:
 def __getattr__(self,name):
  def deny(*a,**k):calls['render']+=1;raise RuntimeError('Assembly forbids render')
  return deny
class OpsGuard:
 def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(old_ops,name)
def deny_gpu(*a,**k):calls['gpu']+=1;raise RuntimeError('Assembly forbids GPU')
gpu.init=deny_gpu;scene=bpy.context.scene;scene.render.engine='CYCLES';scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.resolution_x=scene.render.resolution_y=8;scene.render.resolution_percentage=100;scene.render.use_compositing=True
rows=[]
with patch.object(bpy,'ops',OpsGuard()):
 for action in [gpu.init,bpy.ops.render.render]:
  try:action()
  except RuntimeError:pass
  else:raise AssertionError('Guard failed')
 assert calls=={'render':1,'gpu':1};calls={k:0 for k in calls}
 for row in cases():
  tree=bpy.data.node_groups.new('Authored finite metadata '+row['case'],'CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree;sink=tree.nodes.new('NodeGroupOutput');signal,node=build(tree,row,OUT);tree.links.new(signal,sink.inputs[0]);program=graph.extract(scene);assert program['status']=='extracted',(row,program)
  if row['kind']!='control':assert any(op['properties'].get('image_info_model')=='finite-identity-image-info-v1'for op in program['ops'])
  rows.append({'case':row['case'],'program':program})
assert calls=={'render':0,'gpu':0}
(OUT/'report.json').write_text(json.dumps({'status':'ASSEMBLED_FINITE_IMAGE_INFO_CASE_PLAN','rows':rows,'renders':0,'gpuInitializationCalls':0,'supportCredit':0},indent=2)+'\n');print('ASSEMBLED_FINITE_IMAGE_INFO_CASE_PLAN',len(rows))
