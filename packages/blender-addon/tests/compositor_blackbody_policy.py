# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: SCENETOWEB_COMPOSITOR_BLACKBODY_POLICY_PASSED
"""No-render RNA/source admission checks; no numerical coverage credit."""
import json,sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import bpy
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon'),str(ROOT/'experiments/compositor-blackbody')]
import compositor_graph,compositor_blackbody
from cases import CASES,build
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE'
tree=bpy.data.node_groups.new('Artist Blackbody Controls','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
for device in ['CPU','GPU']:
 scene.render.compositor_device=device
 for row in CASES:
  tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput');node=build(tree,row);tree.links.new(node.outputs['Color'],sink.inputs[0]);program=compositor_graph.extract(scene);assert program['status']=='extracted',(device,row,program)

  if row['kind']=='blackbody':
   selected=next(op for op in program['ops']if op['kind']=='blackbody-color');assert selected['properties']['blackbody_evaluator']=='CPU-MF';assert selected['type']=='RGBA';assert len(selected['inputs'])==1
refusals=[]
for kind in ['temperature-low','temperature-high','computed-temperature','animated-temperature']:
 tree.nodes.clear();tree.animation_data_clear();sink=tree.nodes.new('NodeGroupOutput');node=build(tree,next(row for row in CASES if row['kind']=='blackbody'));tree.links.new(node.outputs[0],sink.inputs[0])
 if kind in {'temperature-low','temperature-high'}:
  value=tree.nodes.new('ShaderNodeValue');value.outputs[0].default_value=799 if kind=='temperature-low'else 12001;tree.links.new(value.outputs[0],node.inputs[0])
 elif kind=='computed-temperature':
  value=tree.nodes.new('ShaderNodeMath');value.operation='ADD';value.inputs[0].default_value=6000;value.inputs[1].default_value=500;tree.links.new(value.outputs[0],node.inputs[0])
 else:node.inputs[0].keyframe_insert(data_path='default_value',frame=1)
 program=compositor_graph.extract(scene);assert program['status']=='unsupported',(kind,program);refusals.append({'kind':kind,'diagnostics':program['diagnostics']})
# These mocked host boundaries are private guards, not native numerical cases.
current=bpy.data.colorspace
for kind,patches in [('working-space',{'working_space_interop_id':'lin_ap1_scene'}),('config-source',{'ocio_config_source':'PROJECT'}),('config-hash',{'ocio_config_path':str(ROOT/'package.json')})]:
 values={name:getattr(current,name)for name in ['working_space_interop_id','ocio_config_source','is_missing_opencolorio_config','is_failed_opencolorio_config','ocio_config_path']};values.update(patches)
 def fail(socket,reason):raise ValueError(reason)
 with patch.object(compositor_blackbody,'bpy',SimpleNamespace(data=SimpleNamespace(colorspace=SimpleNamespace(**values)))):
  try:compositor_blackbody.require_working_space(fail,None)
  except ValueError as error:assert 'Blackbody'in str(error);refusals.append({'kind':kind,'privateBoundary':True,'reason':str(error)})
  else:raise AssertionError(kind+' did not refuse')
packet={'status':'PASSED_COMPOSITOR_BLACKBODY_POLICY','schemaCases':len(CASES)*2,'refusals':refusals,'privateNumericalCredit':0}
import os
if os.environ.get('SCENETOWEB_BLACKBODY_EVIDENCE'):
 path=Path(os.environ['SCENETOWEB_BLACKBODY_EVIDENCE']);path.mkdir(parents=True,exist_ok=True);(path/'policy.json').write_text(json.dumps(packet,indent=2)+'\n')
print('SCENETOWEB_COMPOSITOR_BLACKBODY_POLICY_PASSED '+json.dumps(packet))
