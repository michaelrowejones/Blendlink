# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded CPU fixed-axis Vector Rotate with native MF coefficient capture."""
from array import array
import platform,struct,sys,uuid
import bpy
if __package__:
    from . import compositor_static_matrix as shared
    from .compositor_static_euler import _hash_word
    from .compositor_white_noise import _raw
else:
    import compositor_static_matrix as shared
    from compositor_static_euler import _hash_word
    from compositor_white_noise import _raw

MODEL='native-fixed-axis-vector-rotate-cpu-53-v1'
PROFILE='darwin-arm64-53-fixed-axis-vector-rotate-cpu-v1'
COORDINATES='private-normalized-r32f-vector-rotate-v1'
MODES={'X_AXIS','Y_AXIS','Z_AXIS'}
class VectorRotateUnsupported(ValueError):pass

def _carrier_state(tree,obj):
    rotations=[node for node in tree.nodes if node.bl_idname=='ShaderNodeVectorRotate']
    angles=shared._raw_scalars(tuple(node.inputs['Angle']for node in rotations))
    def vector(socket):
        raw=array('f',[0])*3;socket.default_value.foreach_get(raw);return struct.unpack('=3I',raw.tobytes())
    return(tuple((node.as_pointer(),node.bl_idname,node.mute)for node in tree.nodes),
        tuple((link.from_socket.as_pointer(),link.to_socket.as_pointer(),link.is_valid,link.is_muted)for link in tree.links),
        tuple((node.rotation_type,node.invert,vector(node.inputs['Vector']),vector(node.inputs['Center']),angle)for node,angle in zip(rotations,angles)),
        tuple((node.data_type,node.inputs['Seed'].default_value)for node in tree.nodes if node.bl_idname=='FunctionNodeHashValue'),
        tuple((node.data_type,node.domain,node.inputs['Name'].default_value,node.inputs['Selection'].default_value)for node in tree.nodes if node.bl_idname=='GeometryNodeStoreNamedAttribute'),
        tuple((modifier.as_pointer(),modifier.type,modifier.node_group.as_pointer())for modifier in obj.modifiers))

def _bounded(words,maximum=0x41800000):
    if any(bits==0x80000000 or bits&0x7fffffff and not 0x37800000<=bits&0x7fffffff<=maximum for bits in words):
        raise VectorRotateUnsupported('Vector Rotate requires positive zero or raw normal Float32 magnitude [2^-16,16]')
    return tuple(words)

def signature(node,scene):
    r=scene.render
    if tuple(bpy.app.version)!=(5,3,0)or bpy.app.build_hash!=b'02f0899d78e3'or sys.platform!='darwin'or platform.machine()!='arm64'or r.compositor_device!='CPU':
        raise VectorRotateUnsupported('Vector Rotate has only its pinned Blender 5.3 macOS arm64 CPU compositor profile')
    if node.bl_idname!='ShaderNodeVectorRotate'or node.mute or node.rotation_type not in MODES or [s.identifier for s in node.inputs]!=['Vector','Center','Axis','Angle','Rotation']:
        raise VectorRotateUnsupported('Vector Rotate requires its unmuted fixed X/Y/Z native schema; arbitrary Axis and Euler remain unqualified')
    shared._static(node)
    if any(socket.is_linked for socket in node.inputs if socket.identifier!='Vector'):
        raise VectorRotateUnsupported('Vector Rotate Center/Angle and inactive controls must be unlinked static literals')
    vector=node.inputs['Vector'];center=node.inputs['Center'];angle=node.inputs['Angle']
    if any(s.type!='VECTOR'or s.bl_idname!='NodeSocketVector'or len(s.default_value)!=3 for s in (vector,center))or angle.type!='VALUE'or angle.bl_idname!='NodeSocketFloatAngle':
        raise VectorRotateUnsupported('Vector Rotate requires native float3 Vector/Center and scalar Angle storage')
    center_words=_bounded(_raw((center,),'VECTOR')[0],0x41800000)
    angle_word=shared._raw_scalar(angle);absolute=angle_word&0x7fffffff
    if absolute and not 0x37800000<=absolute<=0x3f800000:
        raise VectorRotateUnsupported('Vector Rotate Angle requires positive zero or magnitude [2^-16,1]')
    vector_words=None if vector.is_linked else _bounded(_raw((vector,),'VECTOR')[0],0x41800000)
    width=r.resolution_x*r.resolution_percentage//100;height=r.resolution_y*r.resolution_percentage//100
    if not r.use_compositing or r.use_border or r.use_crop_to_border or r.use_multiview or r.pixel_aspect_x!=1 or r.pixel_aspect_y!=1 or r.compositor_precision not in {'AUTO','FULL'}or not(4<=width<=8192 and 4<=height<=8192):
        raise VectorRotateUnsupported('Vector Rotate requires a mono square-pixel zero-offset full frame, CPU AUTO/FULL and extent [4,8192]')
    root=scene.compositing_node_group
    return(node.as_pointer(),node.id_data.as_pointer(),node.rotation_type,bool(node.invert),center_words,angle_word,vector_words,
        (scene.as_pointer(),scene.frame_current,scene.frame_subframe,width,height,r.compositor_precision,r.engine,root.as_pointer()if root else None,scene.name,r.resolution_x,r.resolution_y,r.resolution_percentage),
        shared._Evaluator.signature(node))

def _native_columns(mode,invert,angle_word):
    before=shared._ownership();scene=mesh=obj=tree=None
    try:
        tag=uuid.uuid4().hex;scene=bpy.data.scenes.new('.SceneToWeb Vector Rotate '+tag)
        mesh=bpy.data.meshes.new('.SceneToWeb Vector Rotate point '+tag);mesh.from_pydata([(0,0,0)],[],[])
        obj=bpy.data.objects.new('.SceneToWeb Vector Rotate point '+tag,mesh);scene.collection.objects.link(obj)
        tree=bpy.data.node_groups.new('.SceneToWeb Vector Rotate MF '+tag,'GeometryNodeTree')
        tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
        entry=tree.nodes.new('NodeGroupInput');out=tree.nodes.new('NodeGroupOutput');geometry=entry.outputs[0]
        for column in range(3):
            rotate=tree.nodes.new('ShaderNodeVectorRotate');rotate.rotation_type=mode;rotate.invert=invert
            basis=[0,0,0];basis[column]=1;rotate.inputs['Vector'].default_value=basis;rotate.inputs['Center'].default_value=(0,0,0);rotate.inputs['Angle'].default_value=shared._float(angle_word)
            separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(rotate.outputs['Vector'],separate.inputs['Vector'])
            for lane,source in enumerate(separate.outputs):
                witness=tree.nodes.new('FunctionNodeHashValue');witness.data_type='FLOAT';witness.inputs['Seed'].default_value=0;tree.links.new(source,shared._active(witness.inputs,'Value','VALUE'))
                for kind,label,signal in [('FLOAT','f',source),('INT','h',witness.outputs['Hash'])]:
                    store=tree.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type=kind;store.domain='POINT';store.inputs['Name'].default_value=label+str(column)+str(lane)
                    tree.links.new(geometry,store.inputs['Geometry']);tree.links.new(signal,shared._active(store.inputs,'Value','VALUE'if kind=='FLOAT'else'INT'));geometry=store.outputs['Geometry']
        if len(tree.nodes)!=35:raise VectorRotateUnsupported('Vector Rotate private 35-node basis carrier schema changed')
        tree.links.new(geometry,out.inputs[0]);modifier=obj.modifiers.new('.SceneToWeb Vector Rotate MF','NODES');modifier.node_group=tree
        carrier=_carrier_state(tree,obj)
        with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
            evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());result=evaluated.to_mesh()
            try:
                if len(result.vertices)!=1 or len(result.edges)or len(result.polygons):raise VectorRotateUnsupported('Vector Rotate private basis topology changed')
                columns=[]
                for column in range(3):
                    words=[]
                    for lane in range(3):
                        stored=result.attributes['f'+str(column)+str(lane)];hashed=result.attributes['h'+str(column)+str(lane)]
                        if stored.data_type!='FLOAT'or hashed.data_type!='INT'or stored.domain!='POINT'or hashed.domain!='POINT'or len(stored.data)!=1 or len(hashed.data)!=1:raise VectorRotateUnsupported('Vector Rotate native basis attribute schema changed')
                        raw=array('f',[0]);stored.data.foreach_get('value',raw);bits=struct.unpack('=I',raw.tobytes())[0];h=array('i',[0]);hashed.data.foreach_get('value',h)
                        absolute=bits&0x7fffffff
                        if not shared._normal_word(bits)or absolute and not 0x20000000<=absolute<=0x40000000 or(h[0]&0xffffffff)!=_hash_word(bits):raise VectorRotateUnsupported('Vector Rotate native coefficient bound or pre-store hash guard failed')
                        words.append(bits)
                    columns.append(tuple(words))
                if _carrier_state(tree,obj)!=carrier:raise VectorRotateUnsupported('Vector Rotate owned native coefficient carrier changed during evaluation')
            finally:evaluated.to_mesh_clear()
    finally:
        cleanup=[]
        for collection,item in [(bpy.data.objects,obj),(bpy.data.meshes,mesh),(bpy.data.node_groups,tree),(bpy.data.scenes,scene)]:
            if item is None:continue
            try:
                if item.as_pointer():collection.remove(item,do_unlink=True)
            except ReferenceError:pass # An evaluation handler already removed this owned ID.
            except RuntimeError as error:cleanup.append(str(error))
        if cleanup:raise VectorRotateUnsupported('Vector Rotate owned carrier cleanup failed: '+'; '.join(cleanup))
    if before!=shared._ownership():raise VectorRotateUnsupported('Vector Rotate private coefficient capture changed source/context ownership')
    return tuple(columns)

def _coefficient_shape(mode,invert,angle_word,columns):
    """Fixed-axis source zeros are exact; do not infer them from basis zeros.

    Require the nontrivial captured pair to be normal and separated from zero.
    Thus a hidden tiny native sin/cos cannot acquire admission as exposed zero.
    """
    matrix=[[shared._float(bits)for bits in column]for column in columns]
    axis={'X_AXIS':0,'Y_AXIS':1,'Z_AXIS':2}[mode];others=[i for i in range(3)if i!=axis];a,b=others
    if matrix[axis][axis]!=1 or any(matrix[axis][i]!=0 or matrix[i][axis]!=0 for i in others):raise VectorRotateUnsupported('Vector Rotate fixed-axis unit/zero coefficient schema changed')
    cosine=matrix[a][a];sine=matrix[a][b]
    if cosine!=matrix[b][b]or sine!=-matrix[b][a]or not .5<=cosine<=1:raise VectorRotateUnsupported('Vector Rotate fixed-axis native sin/cos pair is unqualified')
    if angle_word&0x7fffffff:
        sign=(-1 if angle_word&0x80000000 else 1)*(-1 if invert else 1)*(-1 if mode=='Y_AXIS'else 1)
        if not 2**-17<=abs(sine)<=1 or(sine>0)!=(sign>0):raise VectorRotateUnsupported('Vector Rotate nonzero native sine must stay normal with the fixed-axis sign')
    elif cosine!=1 or sine!=0:raise VectorRotateUnsupported('Vector Rotate exact zero-angle native coefficients changed')

def normalize(node,socket,op,scene,read,ops,cache,fail):
    try:
        before=signature(node,scene)
        if len(op['source']['path'])>17:raise VectorRotateUnsupported('Vector Rotate exceeds sixteen source group hops')
        if socket.identifier!='Vector'or socket.type!='VECTOR'or len(socket.default_value)!=3:raise VectorRotateUnsupported('Vector Rotate requires its native VECTOR3 output')
        if before[6]is not None:
            vector={'kind':'constant','type':'VECTOR','value':[shared._float(bits)for bits in before[6]]};kind='literal'
        else:
            vector=read(node.inputs['Vector']);kind='normalized'
            if vector.get('kind')!='convert'or vector.get('fromType')!='FLOAT_VECTOR2'or vector.get('type')!='VECTOR'or vector.get('input',{}).get('kind')!='ref':raise VectorRotateUnsupported('Vector Rotate varying Vector requires direct Normalized float2 padded to VECTOR3')
            ref=vector['input'];producer=next((item for item in ops if item['id']==ref.get('node')),None)
            if not producer or producer['kind']!='image-coordinates'or producer['source']['output']!='Normalized'or producer['properties'].get('image_coordinates_model')!='render-layer-float2-v1':raise VectorRotateUnsupported('Vector Rotate accepts only direct qualified Image Coordinates Normalized; other fields/conversions remain unsupported')
            image=producer['inputs']['Image']['value'];source=next((item for item in ops if item['id']==image.get('node')),None)
            if not source or source.get('pass',{}).get('scene')!=scene.name:raise VectorRotateUnsupported('Vector Rotate Normalized requires its current-scene full-frame Render Layers domain')
        key=before[2:4]+(before[5],)
        if key not in cache:
            if len(cache)>=8:raise VectorRotateUnsupported('Vector Rotate exceeds eight private coefficient keys per extraction')
            columns=_native_columns(before[2],before[3],before[5])
            _coefficient_shape(before[2],before[3],before[5],columns)
            if signature(node,scene)!=before:raise VectorRotateUnsupported('Vector Rotate source changed during coefficient capture')
            cache[key]=columns
        columns=cache[key]
        if signature(node,scene)!=before:raise VectorRotateUnsupported('Vector Rotate source changed before publishing coefficients')
        op['kind']='vector-rotate-cpu';op['inputs']['Vector']={'name':'Vector','socketType':'VECTOR','value':vector}
        op['properties'].update(vector_rotate_model=MODEL,vector_rotate_profile=PROFILE,vector_rotate_version=[5,3,0],vector_rotate_build=bpy.app.build_hash.decode(),vector_rotate_mode=before[2],vector_rotate_invert=before[3],vector_rotate_center_words=list(before[4]),vector_rotate_angle_word=before[5],vector_rotate_columns=[list(column)for column in columns],vector_rotate_input=kind,vector_rotate_vector_words=list(before[6])if before[6]is not None else None,vector_rotate_coordinates=COORDINATES if kind=='normalized'else None,vector_rotate_export_extent=list(before[7][3:5]),vector_rotate_precision=before[7][5],vector_rotate_scene=before[7][8])
        return before
    except (ValueError,ReferenceError,RuntimeError)as error:fail(socket,str(error))

def check(node,scene,before):
    if signature(node,scene)!=before:raise VectorRotateUnsupported('Vector Rotate source or context changed during extraction')

def validate_graph(program,source_nodes=None):
    fields=[op for op in program['ops']if op.get('source',{}).get('nodeType')=='ShaderNodeVectorRotate']
    if not fields:return None
    op=fields[0]
    if len(fields)!=1 or len(program['ops'])>8 or any(item['kind']not in {'vector-rotate-cpu','image-coordinates','render-pass','separate-vector','combine-color'}for item in program['ops']):
        return op,'Vector Rotate currently requires one bounded rotate and direct output/component-to-RGBA presentation; computed/spatial consumers remain unsupported'
    # Exact shape/type validation is mirrored by the runtime closed reader.
    def signal(value,target):
        if value.get('kind')=='convert':
            if set(value)!={'kind','type','fromType','input'}or(value['fromType'],value['type'])not in {('VECTOR','RGBA'),('VALUE','RGBA')}:return False
            return signal(value['input'],value['fromType'])
        if value.get('kind')=='constant':return target=='VALUE'and value=={'kind':'constant','type':'VALUE','value':value.get('value')}and type(value.get('value'))in(int,float)and value['value']in(0,1)and struct.unpack('=I',struct.pack('=f',value['value']))[0]in(0,0x3f800000)
        if value.get('kind')!='ref'or value.get('type')!=target:return False
        if value.get('node')==op['id']:return target=='VECTOR'
        item=next((other for other in program['ops']if other['id']==value.get('node')),None)
        if not item:return False
        if item['kind']=='separate-vector':return target=='VALUE'and item['source']['nodeType']=='ShaderNodeSeparateXYZ'and item['source']['output']in {'X','Y','Z'}and set(item['inputs'])=={'Vector'}and item['inputs']['Vector']['value']=={'kind':'ref','node':op['id'],'type':'VECTOR'}
        if item['kind']=='combine-color':return target=='RGBA'and item['source']['nodeType']=='CompositorNodeCombineColor'and item['properties'].get('mode')=='RGB'and set(item['inputs'])=={'Red','Green','Blue','Alpha'}and item['inputs']['Alpha']['value']=={'kind':'constant','type':'VALUE','value':1}and all(incoming['socketType']=='VALUE'and signal(incoming['value'],'VALUE')for incoming in item['inputs'].values())
        return False
    if not signal(program.get('output',{}),'RGBA'):return op,'Vector Rotate output conversions/consumers require direct VECTOR-to-RGBA or Separate XYZ with positive-zero/one RGB presentation'
    if source_nodes is not None:
        for item in program['ops']:
            if item['kind']!='combine-color':continue
            owner=source_nodes.get(item['id'])
            if owner is None:return op,'Vector Rotate presentation has no actual native source owner'
            for name,incoming in item['inputs'].items():
                if incoming['value'].get('kind')!='constant':continue
                socket=owner.inputs[name]
                if socket.is_linked:return op,'Vector Rotate presentation zero/one controls must be direct unlinked native literals'
                try:stored=shared._raw_scalar(socket)
                except ValueError as error:return op,'Vector Rotate presentation raw literal refused: '+str(error)
                if stored not in(0,0x3f800000)or stored!=struct.unpack('=I',struct.pack('=f',incoming['value']['value']))[0]:return op,'Vector Rotate presentation raw literal changed or is not positive zero/one'
    return None

def validate_presentation(presentation):
    fields=[op for op in presentation.get('compositor',{}).get('ops',[])if op.get('kind')=='vector-rotate-cpu']
    if not fields:return None
    lookups=sum(op.get('type')in {'Lut1DTransform','Lut3DTransform'}for op in presentation.get('display',{}).get('ops',[]))
    if lookups+(1 if fields[0]['properties'].get('vector_rotate_input')=='normalized'else 0)>8:
        return fields[0],'Vector Rotate combined private-row/display lookup budget is eight sampled textures'
    return None
