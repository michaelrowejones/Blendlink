# SPDX-License-Identifier: GPL-3.0-or-later
"""Authored arbitrary stored Float32 temperatures; no synthetic admission grid."""
import json,struct
from pathlib import Path
CASES=json.loads(Path(__file__).with_name('cases.json').read_text())

def build(tree,row):
 import bpy
 if row['kind']=='control':
  node=tree.nodes.new('CompositorNodeRGB');node.outputs[0].default_value=row['expectedRGBA'];assert list(node.outputs[0].default_value)==row['expectedRGBA'];return node
 node=tree.nodes.new('ShaderNodeBlackbody');node.inputs['Temperature'].default_value=row['temperature'];authored=node.inputs['Temperature'].default_value
 value=None
 if row['route']in{'value','reroute'}:
  source=tree.nodes.new('ShaderNodeValue');source.outputs[0].default_value=row['temperature'];authored=source.outputs[0].default_value;value=source.outputs[0]
  if row['route']=='reroute':
   reroute=tree.nodes.new('NodeReroute');tree.links.new(value,reroute.inputs[0]);value=reroute.outputs[0]
 elif row['route']=='group':
  group=bpy.data.node_groups.new('Artist Blackbody Temperature','CompositorNodeTree');group.interface.new_socket(name='Temperature',in_out='INPUT',socket_type='NodeSocketFloat');group.interface.new_socket(name='Temperature',in_out='OUTPUT',socket_type='NodeSocketFloat');entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=row['temperature'];authored=instance.inputs[0].default_value;value=instance.outputs[0]
 if value is not None:tree.links.new(value,node.inputs['Temperature'])
 assert struct.unpack('<I',struct.pack('<f',authored))[0]==row['temperatureBits'],(row,authored)
 return node
