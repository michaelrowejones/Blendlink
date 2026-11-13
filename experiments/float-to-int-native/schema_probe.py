# SPDX-License-Identifier: GPL-3.0-or-later
"""Authoritative creation, mode assignment and actual source backend inventory."""
import bpy,hashlib,json,os,platform,sys
from pathlib import Path
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
report={'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'platform':sys.platform,'architecture':platform.machine(),'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'contexts':{}}
try:
 import gpu
 if hasattr(gpu,'init'):gpu.init()
 report['gpu']={'status':'attested','backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get(),'vendor':gpu.platform.vendor_get()}
except Exception as error:report['gpu']={'status':'SOURCE_ATTESTATION_NA','reason':str(error),'hasGpuInit':hasattr(gpu,'init')}
material=bpy.data.materials.new('Shader creation');material.use_nodes=True
if hasattr(scene,'compositing_node_group'):
 compositor=bpy.data.node_groups.new('Compositor root','CompositorNodeTree');scene.compositing_node_group=compositor
else:
 scene.use_nodes=True;compositor=scene.node_tree
geometry=bpy.data.node_groups.new('Geometry creation','GeometryNodeTree')
def schema(socket):
 result={'identifier':socket.identifier,'name':socket.name,'type':socket.type,'idname':socket.bl_idname,'enabled':socket.enabled,'hideValue':socket.hide_value}
 if hasattr(socket,'default_value'):
  value=socket.default_value;result['default']=value if isinstance(value,(float,int,str,bool)) else list(value)
 for key in ['min_value','max_value']:
  if hasattr(socket,key):result[key]=getattr(socket,key)
 return result
for name,tree in [('shader',material.node_tree),('compositor',compositor),('geometry',geometry)]:
 try:node=tree.nodes.new('FunctionNodeFloatToInt')
 except Exception as error:report['contexts'][name]={'available':False,'error':str(error)};continue
 record={'available':True,'label':node.bl_label,'defaultMode':node.rounding_mode,'inputs':[schema(socket) for socket in node.inputs],'outputs':[schema(socket) for socket in node.outputs],'modes':{}}
 for item in node.bl_rna.properties['rounding_mode'].enum_items:
  try:
   node.rounding_mode=item.identifier
   record['modes'][item.identifier]={'nativeValue':node.rounding_mode,'inputs':[schema(socket) for socket in node.inputs],'outputs':[schema(socket) for socket in node.outputs]}
  except Exception as error:record['modes'][item.identifier]={'error':str(error)}
 report['contexts'][name]=record
output=Path(os.environ['BLENDLINK_FLOAT_TO_INT_SCHEMA']);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
print('BLENDLINK_FLOAT_TO_INT_SCHEMA_CAPTURED '+json.dumps({'version':report['version'],'available':{name:item['available'] for name,item in report['contexts'].items()}}))
