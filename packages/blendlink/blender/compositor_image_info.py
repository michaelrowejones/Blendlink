# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual Blender Image Info metadata, qualified for identity Render Layers domains."""
import platform
import sys
import bpy
MODEL='render-layer-identity-image-info-v1'
PROFILE='darwin-arm64-53-image-info-v1'
TYPES={'Dimensions':'INT_VECTOR2','Resolution':'INT_VECTOR2','Location':'FLOAT_VECTOR2','Rotation':'VALUE','Scale':'FLOAT_VECTOR2'}

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

def normalize_image_info(node, socket, op, scene, read, operations, fail):
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
    image=read(node.inputs['Image'])
    matches=[item for item in operations if item.get('id')==image.get('node')]if image.get('kind')=='ref'else[]
    if len(operations)>2048 or image.get('type')!='RGBA' or len(matches)!=1:
        fail(node.inputs['Image'],'Image Info requires a bounded direct Render Layers Image; single values and transformed/static/computed inputs are unqualified')
    source=matches[0]
    if (source.get('kind')!='render-pass' or source.get('type')!='RGBA'
            or source.get('source',{}).get('nodeType')!='CompositorNodeRLayers' or source.get('source',{}).get('output')!='Image'
            or source.get('pass',{}).get('pass')!='Image' or source.get('pass',{}).get('scene')!=scene.name):
        fail(node.inputs['Image'],'Image Info requires the current scene direct full-frame Render Layers Image with identity domain')
    op['type']=tag
    op['properties'].update(image_info_model=MODEL,image_info_source_profile=PROFILE,image_info_native_version=list(bpy.app.version),
                            image_info_reference_model='full-frame-render-layer-identity-v1',image_info_scene=scene.name)
    op['inputs']['Image']={'name':'Image','socketType':'RGBA','value':image}
