# SPDX-License-Identifier: GPL-3.0-or-later
"""Authored finite metadata graphs. Expected words are declared separately."""
import json,struct,zlib
from pathlib import Path
import bpy

def cases():return json.loads(Path(__file__).with_name('cases.json').read_text())
def passthrough(tree,source,kind,label):
 group=bpy.data.node_groups.new(label,'CompositorNodeTree');group.interface.new_socket(name='Data',in_out='INPUT',socket_type=kind);group.interface.new_socket(name='Data',in_out='OUTPUT',socket_type=kind)
 entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(source,instance.inputs[0]);return instance.outputs[0]
def build(tree,row,directory):
 if row['kind']=='control':
  node=tree.nodes.new('CompositorNodeRGB');node.outputs[0].default_value=(.125,.25,.5,1);return node.outputs[0],node
 if row['producer']=='blank':
  producer=tree.nodes.new('CompositorNodeBlankImage');producer.inputs['Size'].default_value=row['size'];producer.inputs['Color'].default_value=(.25,.5,.75,1)
 else:
  width,height=row['size'];producer=tree.nodes.new('CompositorNodeImage')
  if row['producer']=='float':
   image=bpy.data.images.new(row['case']+' finite float',width=width,height=height,alpha=True,float_buffer=True);image.colorspace_settings.name='Linear Rec.709';image.pixels.foreach_set([.25,.5,.75,1]*(width*height))
  else:
   # Independent binary asymmetry ensures source dimensions/orientation have
   # authored physical storage. Info itself earns no image-pixel credit.
   def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
   raw=b''.join(bytes([0])+bytes(v for x in range(width)for v in (255 if(x+2*y)%3==0 else 0,255 if x%2 else 0,255 if y%2 else 0,255))for y in range(height))
   data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
   path=Path(directory)/(row['case']+'.png');assert not path.exists();path.write_bytes(data);image=bpy.data.images.load(str(path),check_existing=False);image.colorspace_settings.name='sRGB';image.alpha_mode='STRAIGHT';image.pack()
  producer.image=image
 source=producer.outputs['Image']
 if row['route']=='group-producer-output':source=passthrough(tree,source,'NodeSocketColor','Actual finite producer forwarding')
 info=tree.nodes.new('CompositorNodeImageInfo');tree.links.new(source,info.inputs['Image']);result=info.outputs[row['output']]
 if row['route']=='reroute':
  reroute=tree.nodes.new('NodeReroute');tree.links.new(result,reroute.inputs[0]);result=reroute.outputs[0]
 if row['route']=='group-producer-output':result=passthrough(tree,result,'NodeSocketVector','Actual metadata float3 forwarding')
 if row['route']=='aspect':
  separate=tree.nodes.new('ShaderNodeSeparateXYZ');ratio=tree.nodes.new('ShaderNodeMath');ratio.operation='DIVIDE';tree.links.new(result,separate.inputs[0]);tree.links.new(separate.outputs['X'],ratio.inputs[0]);tree.links.new(separate.outputs['Y'],ratio.inputs[1]);result=ratio.outputs[0]
 if row['route']=='summary':
  dimensions=tree.nodes.new('ShaderNodeSeparateXYZ');resolution=tree.nodes.new('ShaderNodeSeparateXYZ');scale=tree.nodes.new('ShaderNodeSeparateXYZ');combined=tree.nodes.new('CompositorNodeCombineColor')
  tree.links.new(info.outputs['Dimensions'],dimensions.inputs[0]);tree.links.new(info.outputs['Resolution'],resolution.inputs[0]);tree.links.new(info.outputs['Scale'],scale.inputs[0])
  for value,index in [(dimensions.outputs['X'],0),(resolution.outputs['Y'],1),(info.outputs['Rotation'],2),(scale.outputs['X'],3)]:tree.links.new(value,combined.inputs[index])
  result=combined.outputs[0]
 return result,info
