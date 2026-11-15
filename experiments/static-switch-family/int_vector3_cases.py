# SPDX-License-Identifier: GPL-3.0-or-later
"""Authored static int3 graphs; no output-derived expected values."""
from pathlib import Path
import json
import bpy
def cases():return json.loads(Path(__file__).with_name('int-vector3-cases.json').read_text())
def build(tree,row,context,unused):
 assert context=='compositor' and row['kind']=='integer-vector3'
 if row['route']=='nested-constructor':
  group=bpy.data.node_groups.new('Artist nested int3 constructor','CompositorNodeTree');group.interface.new_socket(name='Vector',in_out='OUTPUT',socket_type='NodeSocketIntVector3D')
  inner=group.nodes.new('FunctionNodeInputIntVector');inner.vector_dimensions=3;inner.vector=row['value'];assert list(inner.vector)==row['value']
  go=group.nodes.new('NodeGroupOutput');group.links.new(inner.outputs[0],go.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group
  return instance.outputs[0],inner
 node=tree.nodes.new('FunctionNodeInputIntVector');node.vector_dimensions=3;node.vector=row['value'];assert list(node.vector)==row['value']
 output=node.outputs['Vector']
 if row['route']=='reroute':
  route=tree.nodes.new('NodeReroute');tree.links.new(output,route.inputs[0]);output=route.outputs[0]
 elif row['route']!='direct':
  kind={'int3-group':'NodeSocketIntVector3D','vector-group':'NodeSocketVector','rgba-group':'NodeSocketColor'}[row['route']]
  group=bpy.data.node_groups.new('Artist int3 presentation','CompositorNodeTree');group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketIntVector3D');group.interface.new_socket(name='Presented',in_out='OUTPUT',socket_type=kind)
  gi=group.nodes.new('NodeGroupInput');go=group.nodes.new('NodeGroupOutput');group.links.new(gi.outputs[0],go.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(output,instance.inputs[0]);output=instance.outputs[0]
 return output,node
