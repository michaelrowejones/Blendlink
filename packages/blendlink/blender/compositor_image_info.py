# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual Blender Image Info metadata, qualified for identity Render Layers domains."""
import platform
import sys
import bpy
MODEL='render-layer-identity-image-info-v1'
PROFILE='darwin-arm64-53-image-info-v1'
FINITE_MODEL='finite-identity-image-info-v1'
FINITE_PROFILE='darwin-arm64-53-finite-image-info-v1'
TYPES={'Dimensions':'INT_VECTOR2','Resolution':'INT_VECTOR2','Location':'FLOAT_VECTOR2','Rotation':'VALUE','Scale':'FLOAT_VECTOR2'}

def finite_metadata_graph(program, producer_id):
    """Only finite-source metadata may escape the initial Blank terminal boundary."""
    ops=program.get('ops',[])
    if not 2<=len(ops)<=64 or program.get('passes')or any(not isinstance(op.get('id'),str)or not op['id']for op in ops)or len({op['id']for op in ops})!=len(ops):return False
    source=next((op for op in ops if op.get('id')==producer_id),None)
    if source is None:return False
    by_id={op['id']:op for op in ops};used=set();visiting=set();info_count=0
    def walk(value,depth=0,allow_producer=False):
        nonlocal info_count
        if not isinstance(value,dict)or depth>64:return False
        if value.get('kind')=='constant':return True
        if value.get('kind')=='convert':return walk(value.get('input'),depth+1,allow_producer)
        if value.get('kind')!='ref'or value.get('node')not in by_id:return False
        key=value['node']
        if key==producer_id and not allow_producer:return False
        if key in visiting:return False
        if key in used:return True
        op=by_id[key];used.add(key);visiting.add(key)
        if key==producer_id:valid=True
        elif op.get('kind')=='image-info':
            info_count+=1
            edge=op.get('inputs',{}).get('Image',{}).get('value')
            valid=(op.get('properties',{}).get('image_info_model')==FINITE_MODEL and edge=={'kind':'ref','node':producer_id,'type':'RGBA'} and walk(edge,depth+1,True))
        elif op.get('kind')in{'value','math','separate-vector','combine-color'}:
            valid=all(not (incoming.get('value',{}).get('kind')=='ref'and incoming['value'].get('node')==producer_id)and walk(incoming.get('value'),depth+1)for incoming in op.get('inputs',{}).values())
        else:valid=False
        visiting.remove(key);return valid
    return walk(program.get('output'))and len(used)==len(ops)and info_count>0


def validate_finite_graph(program):
    infos=[op for op in program['ops']if op.get('properties',{}).get('image_info_model')==FINITE_MODEL]
    if not infos:return None
    producers={op.get('inputs',{}).get('Image',{}).get('value',{}).get('node')for op in infos}
    if len(producers)!=1 or not finite_metadata_graph(program,next(iter(producers))):
        return infos[0],'Finite Image Info requires one direct finite producer and closed contributing metadata consumers; image branches and arbitrary consumers remain unqualified'
    return None

def _context(scene):
    render=scene.render
    return (scene.as_pointer(),scene.compositing_node_group.as_pointer()if scene.compositing_node_group else None,scene.frame_current,scene.frame_subframe,render.use_compositing,render.compositor_device,render.compositor_precision,render.use_border,render.use_crop_to_border,render.pixel_aspect_x,render.pixel_aspect_y,render.resolution_x,render.resolution_y,render.resolution_percentage,render.engine)
def finite_source_signature(node, source, scene):
    context=_context(scene)
    schema=tuple((socket.as_pointer(),socket.identifier,socket.type,socket.enabled,socket.is_unavailable,tuple((link.as_pointer(),link.from_socket.as_pointer(),link.to_socket.as_pointer(),link.is_valid,link.is_muted)for link in socket.links))for socket in list(node.inputs)+list(node.outputs))
    image=source.image if source.bl_idname=='CompositorNodeImage'else None
    animation=getattr(image,'animation_data',None)if image else None
    storage=(image.source,image.type,image.is_float,image.channels,image.colorspace_settings.name,image.alpha_mode,image.filepath,getattr(image,'is_multiview',False),getattr(image,'is_stereo_3d',False),len(image.packed_files),animation.action.as_pointer()if animation and animation.action else None,len(animation.drivers)if animation else 0,len(animation.nla_tracks)if animation else 0)if image else None
    producer=(source.as_pointer(),source.id_data.as_pointer(),source.bl_idname,source.mute,image.as_pointer()if image else None,tuple(image.size)if image else None,storage)
    return node.as_pointer(),node.id_data.as_pointer(),node.mute,schema,context,producer

def validate_image_info_edge(value, socket, operations, fail):
    if value.get('kind')!='ref' or value.get('type') not in {'INT_VECTOR2','FLOAT_VECTOR2'}: return
    matches=[op for op in operations if op.get('id')==value.get('node')]
    if len(matches)!=1 or matches[0].get('kind')!='image-info': return
    default=getattr(socket,'default_value',None)
    identity=(value['type']=='INT_VECTOR2' and socket.type=='INT_VECTOR' and socket.bl_idname=='NodeSocketIntVector2D'
              or value['type']=='FLOAT_VECTOR2' and socket.type=='VECTOR' and socket.bl_idname=='NodeSocketVector2D')
    if identity and default is not None and len(default)==2: return
    if socket.type=='RGBA' or socket.type=='VECTOR' and default is not None and len(default)==3: return
    fail('Image Info metadata currently supports only its native two-component identity, RGBA and padded float3 edges; scalar/integer/Boolean casts need separate proof')

def normalize_image_info(node, socket, op, scene, read, operations, fail, program=None, source_nodes=None, image_cache=None):
    if (tuple(bpy.app.version)!=(5,3,0) or bpy.app.build_hash!=b'02f0899d78e3'
            or sys.platform!='darwin' or platform.machine()!='arm64'):
        fail(socket,'Image Info has no measured source profile for this Blender build/platform')
    output=socket.identifier;tag=TYPES.get(output)
    if node.bl_idname!='CompositorNodeImageInfo' or tag is None or socket.type!=('INT_VECTOR'if tag=='INT_VECTOR2'else'VECTOR'if tag=='FLOAT_VECTOR2'else'VALUE'):
        fail(socket,'Image Info requires its native Dimensions/Resolution/Location/Rotation/Scale schema')
    if tag!='VALUE' and len(socket.default_value)!=2:
        fail(socket,'Image Info requires native two-component metadata sockets')
    if scene.render.use_border or scene.render.use_crop_to_border or scene.render.pixel_aspect_x!=1 or scene.render.pixel_aspect_y!=1:
        fail(socket,'Image Info requires an identity full-frame Render Layers domain without borders or non-square pixels')
    width=scene.render.resolution_x*scene.render.resolution_percentage//100; height=scene.render.resolution_y*scene.render.resolution_percentage//100
    if not(1<=width<=8192 and 1<=height<=8192):fail(socket,'Image Info requires physical full-frame image extents in [1,8192]')
    entry_context=_context(scene)
    image=read(node.inputs['Image'])
    matches=[item for item in operations if item.get('id')==image.get('node')]if image.get('kind')=='ref'else[]
    if len(operations)>2048 or image.get('type')!='RGBA' or len(matches)!=1:
        fail(node.inputs['Image'],'Image Info requires a bounded direct Render Layers Image; single values and transformed/static/computed inputs are unqualified')
    source=matches[0]
    if source.get('kind')in{'image-input','blank-image'}:
        if _context(scene)!=entry_context:fail(socket,'Finite Image Info source context changed while reading its producer')
        if scene.render.compositor_device!='CPU'or scene.render.compositor_precision not in {'AUTO','FULL'}or not scene.render.use_compositing:
            fail(socket,'Finite Image Info requires an enabled pinned CPU AUTO/FULL compositor')
        if source.get('kind')=='image-input':
            record=(program or {}).get('images',{}).get(source.get('properties',{}).get('image_id'))
            if source.get('source',{}).get('nodeType')!='CompositorNodeImage'or source.get('source',{}).get('output')!='Image'or source.get('properties',{}).get('image_window_model')!='modern-cpu-v1'or not record:
                fail(socket,'Finite Image Info requires the admitted direct modern static Image buffer')
            size=[record['width'],record['height']]
        else:
            if source.get('source',{}).get('nodeType')!='CompositorNodeBlankImage'or source.get('properties',{}).get('blank_image_model')!='native-compositor-blank-image-cpu-53-v1':
                fail(socket,'Finite Image Info requires the actual native Blank Image finite producer')
            size=source['properties']['blank_image_effective_size']
        if not isinstance(size,list)or len(size)!=2 or any(type(n)is not int or not 1<=n<=8192 for n in size):fail(socket,'Finite Image Info source dimensions are invalid')
        op['type']=tag
        op['properties'].update(image_info_model=FINITE_MODEL,image_info_source_profile=FINITE_PROFILE,image_info_native_version=list(bpy.app.version),image_info_reference_model='finite-image-identity-v1',image_info_scene=scene.name,image_info_finite_size=list(size))
        actual=(source_nodes or {}).get(source['id'])
        if actual is None:fail(socket,'Finite Image Info requires its actual source producer identity')
        if source['kind']=='image-input'and(actual.image is None or tuple(actual.image.size)!=tuple(size)or(image_cache or {}).get(actual.image.as_pointer())!=source['properties']['image_id']):
            fail(socket,'Finite Image Info source Image binding/size changed during producer capture')
        signature=finite_source_signature(node,actual,scene)
    else:
        if (source.get('kind')!='render-pass' or source.get('type')!='RGBA'
                or source.get('source',{}).get('nodeType')!='CompositorNodeRLayers' or source.get('source',{}).get('output')!='Image'
                or source.get('pass',{}).get('pass')!='Image' or source.get('pass',{}).get('scene')!=scene.name):
            fail(node.inputs['Image'],'Image Info requires a current scene direct Render Layers Image or qualified finite static/Blank Image identity domain')
        op['type']=tag
        op['properties'].update(image_info_model=MODEL,image_info_source_profile=PROFILE,image_info_native_version=list(bpy.app.version),
                                image_info_reference_model='full-frame-render-layer-identity-v1',image_info_scene=scene.name)
        signature=None
    op['inputs']['Image']={'name':'Image','socketType':'RGBA','value':image}

    return signature
