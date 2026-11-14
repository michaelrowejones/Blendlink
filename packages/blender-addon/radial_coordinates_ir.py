# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded regular/full-roundness shader coordinates; actual input width is two."""
import math,platform,struct,sys,array
from contextvars import ContextVar
from functools import wraps
import bpy
MODEL='regular-full-roundness-segment-coordinates-webgl2-m5pro-v1'
PROFILE='darwin-arm64-53-eevee-metal-m5pro-radial-coordinates-v1'
INPUT='literal-vector2-f32-normal-plus-zero-v1'
BOUNDARY='blender53-shader-float2-padded-v1'
_used=ContextVar('radial_coordinates_channel_used',default=False)
def coordinate_channel_boundary(resolve_link,convert):
 def decorate(function):
  @wraps(function)
  def wrapped(socket,*args,**kwargs):
   token=_used.set(False)
   try:
    document=function(socket,*args,**kwargs)
    if _used.get():
     source=resolve_link(socket)
     if source is not None:document['output']=convert(document['output'],source[1],socket)
    return document
   finally:_used.reset(token)
  return wrapped
 return decorate
def number(value,bounded=True):
 if not isinstance(value,(int,float))or isinstance(value,bool)or not math.isfinite(value):return False
 if value==0 and math.copysign(1,value)<0:return False
 if value!=0 and abs(value)<2**-126:return False
 if abs(value)> (2 if bounded else 3.4028234663852886e38):return False
 return struct.unpack('<f',struct.pack('<f',value))[0]==value
def vector_input(expression,depth=0,work=None):
 work={'nodes':0}if work is None else work;work['nodes']+=1
 if not isinstance(expression,dict)or depth>16 or work['nodes']>128:return False
 if expression.get('op')=='native_vector2':
  return set(expression)=={'op','model','input'}and expression.get('model')==BOUNDARY and vector_input(expression.get('input'),depth+1,work)
 if expression.get('op')=='const_vec3':
  values=expression.get('value');return set(expression)=={'op','value'}and isinstance(values,list)and len(values)==3 and all(number(v,i<2)for i,v in enumerate(values))
 return False

def raw_literal_xy_words(socket,stack,source,matching,refuse,depth=0):
 if depth>16:refuse('Radial Tiling static coordinate raw-storage walk exceeds16 boundaries')
 linked=source(socket)
 if linked is None:
  values=getattr(socket,'default_value',None)
 elif getattr(linked[0],'mute',False):
  node,out=linked
  bypass=next((item.from_socket for item in node.internal_links if item.to_socket.identifier==out.identifier),None)
  if bypass is None:refuse('Radial Tiling static coordinate muted producer has no native bypass')
  return raw_literal_xy_words(bypass,stack,source,matching,refuse,depth+1)
 else:
  node,out=linked
  if node.bl_idname=='NodeReroute':return raw_literal_xy_words(node.inputs[0],stack,source,matching,refuse,depth+1)
  if node.bl_idname=='ShaderNodeGroup':
   group=next((n for n in node.node_tree.nodes if n.type=='GROUP_OUTPUT'and getattr(n,'is_active_output',True)),None)
   target=matching(group.inputs,out)if group else None
   if target is None:refuse('Radial Tiling static coordinate group has no matching active output')
   return raw_literal_xy_words(target,stack+(node,),source,matching,refuse,depth+1)
  if node.bl_idname=='NodeGroupInput':
   target=matching(stack[-1].inputs,out)if stack else None
   if target is None:refuse('Radial Tiling static coordinate group has no matching bound input')
   return raw_literal_xy_words(target,stack[:-1],source,matching,refuse,depth+1)
  if node.bl_idname=='FunctionNodeInputVector':values=node.vector
  elif node.bl_idname=='ShaderNodeRGB':values=out.default_value
  else:refuse('Radial Tiling static coordinate producer has no verified raw Float32 array storage')
 if not hasattr(values,'foreach_get')or len(values)<2:refuse('Radial Tiling static coordinate needs raw Float32 array storage')
 buffer=array.array('f',[0])*len(values);values.foreach_get(buffer)
 words=struct.unpack('<'+'I'*len(values),buffer.tobytes())[:2]
 for word in words:
  magnitude=word&0x7fffffff
  if word==0x80000000 or 0<magnitude<0x00800000 or magnitude>0x40000000:refuse('Radial Tiling static coordinates refuse raw negative-zero, subnormal or out-of-domain Float32 XY storage')
 return words

def raw_literal_xy(socket,stack,source,matching,refuse,depth=0):
 return struct.unpack('<2f',struct.pack('<2I',*raw_literal_xy_words(socket,stack,source,matching,refuse,depth)))

def emit_radial_coordinates(node,socket,*,scalar,vector,refuse,evaluation_engine,source,matching,stack=()):
 if tuple(bpy.app.version)!=(5,3,0)or bpy.app.build_hash!=b'02f0899d78e3'or evaluation_engine!='EEVEE':
  refuse('Radial Tiling Segment Coordinates requires the pinned Blender5.3 EEVEE source profile; Cycles uses baking')
 if(socket.identifier!='Segment Coordinates'or socket.bl_idname!='NodeSocketVector'or len(socket.default_value)!=3 or node.inputs['Vector'].bl_idname!='NodeSocketVector2D'or len(node.inputs['Vector'].default_value)!=2):refuse('Radial Tiling Segment Coordinates requires the native float2 input and padded float3 output schema')
 sides,roundness=scalar(node.inputs['Sides']),scalar(node.inputs['Roundness'])
 if(set(sides)!={'op','value'}or sides.get('op')!='const_float'or sides.get('value')not in{3,8,12}or isinstance(sides.get('value'),bool)or set(roundness)!={'op','value'}or roundness.get('op')!='const_float'or roundness.get('value')!=1 or isinstance(roundness.get('value'),bool)):refuse('Radial Tiling Segment Coordinates requires literal Sides3/8/12 and Roundness1; computed/fractional/other branches remain unqualified')
 raw_words=raw_literal_xy_words(node.inputs['Vector'],stack,source,matching,refuse)
 raw_xy=struct.unpack('<2f',struct.pack('<2I',*raw_words))
 incoming=vector(node.inputs['Vector'])
 if(incoming.get('op')!='native_vector2'or incoming.get('model')!=BOUNDARY or not vector_input(incoming)):refuse('Radial Tiling Segment Coordinates requires an explicit native float2 boundary and finite normal/+0 literal XY in[-2,2]; image, Object, UV, arithmetic and other inputs remain unqualified')
 literal=incoming
 while literal.get('op')=='native_vector2':literal=literal['input']
 if tuple(literal['value'][:2])!=tuple(raw_xy):refuse('Radial Tiling static coordinate RNA promotion differs from verified raw Float32 XY')
 _used.set(True)
 if raw_words==(0,0):
  # Pinned native source: regular/full-roundness radius is length(+0,+0),
  # phase is explicitly overwritten with +0, then Normalize postprocesses.
  # Discarded rotation can be NaN; no multiplication-by-zero hides it.
  return {'op':'const_vec3','value':[0.5,0.0,0.0]if node.normalize else[0.0,-1.0,0.0]}
 if sys.platform!='darwin'or platform.machine()!='arm64'or bpy.context.preferences.system.gpu_backend!='METAL':
  refuse('Radial Tiling nonzero Segment Coordinates requires the measured macOS arm64 EEVEE Metal source profile')
 import gpu
 gpu.init()
 if gpu.platform.backend_type_get()!='METAL'or gpu.platform.vendor_get()!='Apple M5 Pro':refuse('Radial Tiling Segment Coordinates requires actual native Apple M5 Pro Metal source attestation; other source devices are unqualified')
 return{'op':'radial_segment_coordinates','model':MODEL,'sourceProfile':PROFILE,'nativeVersion':[5,3,0],'nativeBuild':'02f0899d78e3','sourceEngine':'EEVEE','nativeGpuBackend':'METAL','inputModel':INPUT,'outputModel':'native-float3-phase-radius-zero-v1','normalize':bool(node.normalize),'sides':sides,'roundness':roundness,'vector':incoming}
