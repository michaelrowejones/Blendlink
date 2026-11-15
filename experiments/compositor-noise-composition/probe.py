# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned no-render admission counterexample, no numerical/support credit."""
import sys,json,hashlib,os
from pathlib import Path
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph as graph,compositor_static_matrix as matrix
OUT=Path(os.environ['SCENETOWEB_NOISE_COMPOSITION_PROBE']);OUT.mkdir(exist_ok=True)
scene=bpy.context.scene;scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100;scene.render.use_compositing=True
original_gpu=gpu.init;original_ops=bpy.ops;attempts={'gpu':0,'render':0}
def denied_gpu(*a,**kw):attempts['gpu']+=1;raise RuntimeError('composition probe forbids GPU initialization')
class RenderGuard:
 def __getattr__(self,name):
  def denied(*a,**kw):attempts['render']+=1;raise RuntimeError('composition probe forbids render')
  return denied
class OpsGuard:
 def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(original_ops,name)
gpu.init=denied_gpu;bpy.ops=OpsGuard()
rows=[];owned=[]
try:
 for label in ['multiply-1024','exposure-plus10']:
  tree=bpy.data.node_groups.new('Owned Noise '+label,'CompositorNodeTree');owned.append(tree);tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
  noise=tree.nodes.new('ShaderNodeTexNoise');assert noise.noise_dimensions=='2D';sink=tree.nodes.new('NodeGroupOutput')
  if label=='multiply-1024':
   consumer=tree.nodes.new('ShaderNodeMath');consumer.operation='MULTIPLY';consumer.use_clamp=False;consumer.inputs[1].default_value=1024.;tree.links.new(noise.outputs['Fac'],consumer.inputs[0])
  else:
   consumer=tree.nodes.new('CompositorNodeExposure');consumer.inputs['Exposure'].default_value=10.;tree.links.new(noise.outputs['Color'],consumer.inputs['Image'])
  tree.links.new(consumer.outputs[0],sink.inputs[0]);before=matrix._ownership();frame=(scene.frame_current,scene.frame_subframe)
  program=graph.extract(scene)
  assert before==matrix._ownership()and frame==(scene.frame_current,scene.frame_subframe)
  path=OUT/(label+'.program.json');path.write_text(json.dumps(program,indent=2)+'\n')
  rows.append({'case':label,'status':program['status'],'programFile':path.name,'programSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'ownershipPreserved':True})
 assert attempts=={'gpu':0,'render':0},attempts
 sources=[Path(__file__).resolve()]+sorted((ROOT/'packages/blendlink/blender').glob('*.py'))+sorted((ROOT/'packages/blender-addon').glob('*.py'))+sorted((ROOT/'packages/blender-addon').glob('*.json'))
 report={'status':'CAPTURED_NO_RENDER_NOISE_COMPOSITION_ADMISSION','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'cases':rows,'sourceHashes':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()for p in sources},'attempts':attempts,'numericalCredit':0,'supportCredit':0}
 (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'cases':rows,'attempts':attempts}))
finally:
 scene.compositing_node_group=None
 for tree in owned:bpy.data.node_groups.remove(tree,do_unlink=True)
 gpu.init=original_gpu;bpy.ops=original_ops
