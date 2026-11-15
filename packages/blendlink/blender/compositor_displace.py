# SPDX-License-Identifier: GPL-3.0-or-later
"""Candidate native single-value Displacement branch; no varying coordinate kernel."""
from array import array
import platform,struct,sys
import bpy
if __package__:
    from .compositor_white_noise import _static,WhiteNoiseUnsupported
else:
    from compositor_white_noise import _static,WhiteNoiseUnsupported
MODEL='native-displace-single-domain-cpu-53-v1'
PROFILE='darwin-arm64-53-displace-single-cpu-v1'
MAX_PIXELS=4194304
class DisplaceUnsupported(ValueError):pass

def _words(socket,width,classes):
    if socket.bl_idname not in classes or len(socket.default_value)!=width:
        raise DisplaceUnsupported('Displace requires its native float2/RGBA socket storage')
    stored=array('f',[0])*width;socket.default_value.foreach_get(stored)
    words=tuple(struct.unpack('='+str(width)+'I',stored.tobytes()))
    for bits in words:
        absolute=bits&0x7fffffff
        if bits==0x80000000 or absolute and not 0x37800000<=absolute<=0x46000000:
            raise DisplaceUnsupported('Displace stored values require positive zero or normal Float32 magnitude [2^-16,8192]')
    return words,tuple(stored)

def signature(node,scene):
    r=scene.render
    if tuple(bpy.app.version)!=(5,3,0)or bpy.app.build_hash!=b'02f0899d78e3'or sys.platform!='darwin'or platform.machine()!='arm64'or r.compositor_device!='CPU':
        raise DisplaceUnsupported('Displace has only its pinned Blender 5.3 macOS arm64 CPU compositor source profile')
    if node.bl_idname!='CompositorNodeDisplace'or node.mute or [s.identifier for s in node.inputs]!=['Image','Displacement','Interpolation','Extension X','Extension Y']:
        raise DisplaceUnsupported('Displace requires its exact unmuted 5.3 schema; legacy Scale X/Y layouts remain unsupported')
    try:_static(node)
    except WhiteNoiseUnsupported as error:raise DisplaceUnsupported(str(error))from error
    width=r.resolution_x*r.resolution_percentage//100;height=r.resolution_y*r.resolution_percentage//100
    if not r.use_compositing or r.use_border or r.use_crop_to_border or r.pixel_aspect_x!=1 or r.pixel_aspect_y!=1 or r.compositor_precision not in {'AUTO','FULL'}or not(4<=width<=8192 and 4<=height<=8192)or width*height>MAX_PIXELS:
        raise DisplaceUnsupported('Displace requires a zero-offset square-pixel CPU full frame, extent 4..8192 and at most 4194304 pixels')
    displacement=node.inputs['Displacement']
    if displacement.type!='VECTOR'or displacement.is_linked:raise DisplaceUnsupported('Displace requires an unlinked native float2 literal; fields and implicit conversions remain unsupported')
    words,_=_words(displacement,2,{'NodeSocketVector2D'})
    menus=[]
    for name in ('Interpolation','Extension X','Extension Y'):
        socket=node.inputs[name]
        if socket.type!='MENU'or socket.is_linked:raise DisplaceUnsupported('Displace sampling menus must be unlinked native literals')
        menus.append(socket.default_value)
    if menus[0]not in {'Nearest','Bilinear'}or menus[1:]!=['Clip','Clip']:raise DisplaceUnsupported('Displace currently requires Nearest/Bilinear and Clip extensions')
    links=tuple((link.from_node.as_pointer(),link.from_socket.as_pointer(),link.is_valid,getattr(link,'is_muted',False))for link in node.inputs['Image'].links)
    return(node.as_pointer(),node.id_data.as_pointer(),words,tuple(menus),(scene.as_pointer(),scene.frame_current,scene.frame_subframe,width,height,r.compositor_precision,r.engine,scene.compositing_node_group.as_pointer()),links)

def normalize(node,socket,op,scene,read,ops,source_nodes,fail):
    try:
        snapshot=signature(node,scene)
        if socket.identifier!='Image'or socket.type!='RGBA':raise DisplaceUnsupported('Displace requires its native Image output')
        image=read(node.inputs['Image']);image_socket=None
        if image.get('kind')=='constant'and image.get('type')=='RGBA'and not node.inputs['Image'].is_linked:
            image_socket=node.inputs['Image'];source_kind='constant-rgba'
        elif image.get('kind')=='ref'and image.get('type')=='RGBA':
            source=next((source for source in ops if source['id']==image['node']),{})
            if source.get('kind')=='render-pass'and source.get('source',{}).get('nodeType')=='CompositorNodeRLayers'and source.get('source',{}).get('output')=='Image':source_kind='render-layer'
            elif source.get('kind')=='rgb'and source.get('source',{}).get('nodeType')=='CompositorNodeRGB':
                owner=source_nodes.get(source['id']);image_socket=owner.outputs[0];source_kind='constant-rgba'
            else:raise DisplaceUnsupported('Displace Image currently requires a direct Render Layers Image or a native single RGB value')
        else:raise DisplaceUnsupported('Displace Image casts, fields and transformed/finite-window producers remain unsupported')
        image_words=None
        if image_socket is not None:
            image_words,channels=_words(image_socket,4,{'NodeSocketColor'})
            if image_words[3]!=0x3f800000 or any(abs(value)>16 for value in channels[:3]):raise DisplaceUnsupported('Displace constant RGBA requires alpha one and RGB magnitude at most 16')
        op['kind']='translate'
        op['inputs']['Image']={'name':'Image','socketType':'RGBA','value':image}
        op['properties'].update(image_domain_model='native-translation-v2',image_translation=list(struct.unpack('=2f',struct.pack('=2I',*snapshot[2]))),image_interpolation=snapshot[3][0],image_sampling_model='modern-cpu-v1',displace_model=MODEL,displace_profile=PROFILE,displace_version=[5,3,0],displace_build=bpy.app.build_hash.decode(),displace_words=list(snapshot[2]),displace_source_kind=source_kind,displace_image_words=list(image_words)if image_words else None,displace_export_extent=list(snapshot[4][3:5]),displace_requested_precision=snapshot[4][5],displace_max_pixels=MAX_PIXELS)
        return(snapshot,image_socket,image_words)
    except DisplaceUnsupported as error:fail(socket,str(error))

def check(node,scene,record):
    before,image_socket,image_words=record
    if signature(node,scene)!=before:raise DisplaceUnsupported('Displace source or context changed during extraction')
    if image_socket is not None and _words(image_socket,4,{'NodeSocketColor'})[0]!=image_words:raise DisplaceUnsupported('Displace constant Image changed during extraction')

def validate_graph(program):
    fields=[op for op in program['ops']if op.get('source',{}).get('nodeType')=='CompositorNodeDisplace']
    if not fields:return None
    op=fields[0];output=program.get('output',{})
    if len(fields)!=1 or output!={'kind':'ref','node':op['id'],'type':'RGBA'}or any(other['kind']not in {'translate','render-pass','rgb'}or other['kind']=='translate'and other is not op for other in program['ops']):
        return op,'Displace currently requires one terminal constant-displacement node; spatial/pointwise consumers and transform chains remain unsupported'
    return None
