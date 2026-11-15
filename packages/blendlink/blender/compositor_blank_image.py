# SPDX-License-Identifier: GPL-3.0-or-later
"""Literal CPU Blank Image, preserving a finite native image domain."""
from array import array
import platform,struct,sys
import bpy
if __package__:
    from .compositor_image_info import finite_metadata_graph
else:
    from compositor_image_info import finite_metadata_graph

MODEL='native-compositor-blank-image-cpu-53-v1'
PROFILE='darwin-arm64-53-blank-image-cpu-v1'
MAX_PIXELS=4194304
class BlankImageUnsupported(ValueError):pass

def _static(tree):
    animation=tree.animation_data
    if animation and (animation.action or len(animation.drivers) or len(animation.nla_tracks)):
        raise BlankImageUnsupported('Blank Image requires static used trees without actions, drivers or NLA')

def source_signature(node,scene):
    render=scene.render
    if tuple(bpy.app.version)!=(5,3,0)or bpy.app.build_hash!=b'02f0899d78e3'or sys.platform!='darwin'or platform.machine()!='arm64'or render.compositor_device!='CPU':
        raise BlankImageUnsupported('Blank Image requires the pinned Blender 5.3 macOS arm64 CPU compositor profile')
    if node.bl_idname!='CompositorNodeBlankImage'or node.mute or [s.identifier for s in node.inputs]!=['Color','Size']or [s.identifier for s in node.outputs]!=['Image']:
        raise BlankImageUnsupported('Blank Image requires its exact unmuted native Color/Size/Image schema')
    _static(node.id_data);_static(scene.compositing_node_group)
    color,size=node.inputs['Color'],node.inputs['Size']
    if color.bl_idname!='NodeSocketColor'or color.type!='RGBA'or len(color.default_value)!=4 or size.bl_idname!='NodeSocketIntVectorPixel2D'or size.type!='INT_VECTOR'or len(size.default_value)!=2 or color.is_linked or size.is_linked:
        raise BlankImageUnsupported('Blank Image currently requires unlinked native raw Color and two-component pixel Size literals')
    floats=array('f',[0])*4;color.default_value.foreach_get(floats);color_bytes=floats.tobytes();words=struct.unpack('=4I',color_bytes)
    # Classify stored words before any potentially flushing float promotion.
    if any(word&0x80000000 or word and not 0x37800000<=word<=0x41800000 for word in words)or words[3]>0x3f800000:
        raise BlankImageUnsupported('Blank Image Color requires positive zero or normal Float32 values [2^-16,16], with alpha at most one')
    integers=array('i',[0,0]);size.default_value.foreach_get(integers);size_bytes=integers.tobytes();stored=struct.unpack('=2i',size_bytes);effective=tuple(max(1,n)for n in stored)
    if any(n>8192 for n in effective)or effective[0]*effective[1]>MAX_PIXELS:
        raise BlankImageUnsupported('Blank Image effective Size must be 1..8192 with at most 4194304 pixels, checked before allocation')
    width=render.resolution_x*render.resolution_percentage//100;height=render.resolution_y*render.resolution_percentage//100
    if not render.use_compositing or render.use_border or render.use_crop_to_border or render.pixel_aspect_x!=1 or render.pixel_aspect_y!=1 or render.compositor_precision not in {'AUTO','FULL'}or not(1<=width<=8192 and 1<=height<=8192)or width*height>MAX_PIXELS:
        raise BlankImageUnsupported('Blank Image requires a zero-offset square-pixel CPU full frame with at most 4194304 output pixels')
    return(node.as_pointer(),node.id_data.as_pointer(),color_bytes,size_bytes,effective,(scene.as_pointer(),scene.name,scene.frame_current,scene.frame_subframe,scene.compositing_node_group.as_pointer(),width,height,render.compositor_precision,render.engine))

def normalize(node,socket,op,scene,fail):
    try:
        signature=source_signature(node,scene)
        if socket.identifier!='Image'or socket.type!='RGBA':raise BlankImageUnsupported('Blank Image requires its native RGBA Image output')
        color=list(struct.unpack('=4f',signature[2]));size=list(struct.unpack('=2i',signature[3]))
        op['inputs'].update(Color={'name':'Color','socketType':'RGBA','value':{'kind':'constant','type':'RGBA','value':color}},Size={'name':'Size','socketType':'INT_VECTOR','value':{'kind':'constant','type':'INT_VECTOR2','value':size}})
        op['properties'].update(blank_image_model=MODEL,blank_image_profile=PROFILE,blank_image_version=[5,3,0],blank_image_build=bpy.app.build_hash.decode(),blank_image_color_words=list(struct.unpack('=4I',signature[2])),blank_image_size=size,blank_image_effective_size=list(signature[4]),blank_image_max_pixels=MAX_PIXELS,blank_image_sampling_model='modern-cpu-v1',blank_image_source_precision=scene.render.compositor_precision)
        return signature
    except BlankImageUnsupported as error:fail(socket,str(error))

def validate_graph(program):
    blanks=[op for op in program['ops']if op.get('source',{}).get('nodeType')=='CompositorNodeBlankImage']
    if not blanks:return None
    op=blanks[0]
    terminal=len(program['ops'])==1 and program.get('output')=={'kind':'ref','node':op['id'],'type':'RGBA'}
    if len(blanks)!=1 or program.get('passes')or program.get('images')or not(terminal or finite_metadata_graph(program,op['id'])):
        return op,'Blank Image initially requires one terminal finite producer; Image Info, coordinates, mixed/pointwise/spatial consumers need separate domain proof'
    return None
