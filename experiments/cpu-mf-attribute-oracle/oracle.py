# SPDX-License-Identifier: GPL-3.0-or-later
"""Research-only one-point CPU-MF output storage. No generic native folding."""
from array import array
import hashlib,json,math,struct,time,uuid
import bpy

MODEL='blender53-private-geometry-cpu-mf-attribute-v1'
ALLOWED={'NodeGroupInput','NodeGroupOutput','GeometryNodeStoreNamedAttribute','FunctionNodeInputInt','ShaderNodeValue','FunctionNodeStringToValue','FunctionNodeCombineMatrix','FunctionNodeMatrixMultiply','FunctionNodeQuaternionToRotation'}
MAX_CASES=64
class OracleUnsupported(ValueError):pass

def word(value):return struct.unpack('<I',struct.pack('<f',value))[0]
def from_word(value):return struct.unpack('<f',struct.pack('<I',value))[0]
def snapshot():
    scene=bpy.context.scene
    ids={name:sorted((item.as_pointer(),item.name,item.users)for item in getattr(bpy.data,name))for name in ['scenes','objects','meshes','node_groups','materials','collections','images']}
    return {'ids':ids,'scene':scene.as_pointer(),'frame':scene.frame_current,'engine':scene.render.engine,'active':bpy.context.view_layer.objects.active.as_pointer()if bpy.context.view_layer.objects.active else None,'selection':sorted(obj.as_pointer()for obj in bpy.context.selected_objects)}

def active(sockets,identifier,kind):
    rows=[s for s in sockets if s.identifier==identifier and s.type==kind and s.enabled and not s.is_unavailable]
    if len(rows)!=1:raise OracleUnsupported('Oracle active typed socket differs: '+identifier+'/'+kind)
    return rows[0]

def set_float(socket,value):
    if socket.type!='VALUE'or not math.isfinite(value):raise OracleUnsupported('Oracle needs explicit finite FLOAT constants')
    socket.default_value=value
    actual=word(socket.default_value)
    if actual!=word(value):raise OracleUnsupported('Oracle native RNA Float32 input was changed')
    return actual

def validate(specifications):
    if not isinstance(specifications,list)or not 1<=len(specifications)<=MAX_CASES:raise OracleUnsupported('Oracle batch mustcontain1..64cases')
    shapes={'int':{'value','expectedValues'},'float':{'word','expectedWords'},'parse':{'text','base','output','expectedValues'},'matrix':{'values','expectedWords'},'matrix-multiply':{'values','expectedWords'},'quaternion':{'values','expectedWords'}}
    names=set()
    for spec in specifications:
        if not isinstance(spec,dict)or spec.get('kind')not in shapes:raise OracleUnsupported('Oracle class/kind is outside reviewed context-free CPU-MF allowlist')
        if set(spec)-shapes[spec['kind']]-{'id','kind'}:raise OracleUnsupported('Oracle implicit/context/dynamic or unknown input is forbidden')
        if not isinstance(spec.get('id'),str)or len(spec['id'])>64 or spec['id']in names:raise OracleUnsupported('Oracle requires unique bounded case identifiers')
        names.add(spec['id'])
        words=[spec['word']]if spec['kind']=='float'else[word(v)for v in spec.get('values',[])]
        for bits in words:
            if not isinstance(bits,int)or isinstance(bits,bool)or not 0<=bits<=0xffffffff:raise OracleUnsupported('Oracle Float32 word mustbe uint32')
            absolute=bits&0x7fffffff
            if bits==0x80000000 or 0<absolute<0x00800000:raise OracleUnsupported('Oracle negative-zero/subnormal node-evaluation inputs remain unqualified')
            if absolute>=0x7f800000:raise OracleUnsupported('Oracle requires finite normal Float32 or positive zero')

def build(tree,spec):
    kind=spec['kind'];created=[];inputs=[]
    def node(name):
        if name not in ALLOWED:raise OracleUnsupported('Oracle node class is outside reviewed pure-MF allowlist: '+name)
        n=tree.nodes.new(name);created.append(n);return n
    def integer(value):
        if not isinstance(value,int)or isinstance(value,bool)or not -2147483648<=value<=2147483647:raise OracleUnsupported('Oracle literal INT is outside int32')
        n=node('FunctionNodeInputInt');n.integer=value
        if n.integer!=value:raise OracleUnsupported('Oracle native INT input was changed')
        inputs.append({'type':'INT','value':value});return active(n.outputs,'Integer','INT')
    def matrix(values):
        if len(values)!=16:raise OracleUnsupported('Oracle matrix needs16 explicit columns-first Float32 constants')
        n=node('FunctionNodeCombineMatrix')
        for i,v in enumerate(values):
            socket=active(n.inputs,'Column '+str(i//4+1)+' Row '+str(i%4+1),'VALUE');actual=set_float(socket,v)
            inputs.append({'type':'VALUE','word':actual,'requestedWord':word(v)})
        return active(n.outputs,'Matrix','MATRIX')
    if kind=='int':signal=integer(spec['value']);data_type='INT';width=1
    elif kind=='float':
        n=node('ShaderNodeValue');signal=active(n.outputs,'Value','VALUE');actual=set_float(signal,from_word(spec['word']));inputs.append({'type':'VALUE','word':actual,'requestedWord':spec['word']});data_type='FLOAT';width=1
    elif kind=='parse':
        if not isinstance(spec['text'],str)or '\x00'in spec['text']or len(spec['text'].encode('utf8'))>128:raise OracleUnsupported('Oracle parser requires <=128bytes of explicit valid text')
        n=node('FunctionNodeStringToValue');n.data_type='INT';text=active(n.inputs,'String','STRING');text.default_value=spec['text']
        if text.default_value!=spec['text']:raise OracleUnsupported('Oracle string RNA altered input')
        tree.links.new(integer(spec['base']),active(n.inputs,'Base','INT'));signal=active(n.outputs,spec.get('output','Value'),'INT');data_type='INT';width=1
        inputs.append({'type':'STRING','value':text.default_value})
    elif kind in {'matrix','matrix-multiply'}:
        signal=matrix(spec['values'])
        if kind=='matrix-multiply':
            right=matrix([1.0 if i//4==i%4 else 0.0 for i in range(16)]);n=node('FunctionNodeMatrixMultiply');tree.links.new(signal,active(n.inputs,'Matrix','MATRIX'));tree.links.new(right,active(n.inputs,'Matrix_001','MATRIX'));signal=active(n.outputs,'Matrix','MATRIX')
        data_type='FLOAT4X4';width=16
    elif kind=='quaternion':
        if len(spec['values'])!=4:raise OracleUnsupported('Oracle quaternion needs4 explicit Float32 constants')
        n=node('FunctionNodeQuaternionToRotation')
        for label,value in zip(['W','X','Y','Z'],spec['values']):
            actual=set_float(active(n.inputs,label,'VALUE'),value);inputs.append({'type':'VALUE','word':actual,'requestedWord':word(value)})
        signal=active(n.outputs,'Rotation','ROTATION');data_type='QUATERNION';width=4
    else:raise OracleUnsupported('Oracle requires a reviewed pure constant case kind')
    return signal,data_type,width,inputs,[n.bl_idname for n in created]

def capture(specifications):
    if tuple(bpy.app.version)!=(5,3,0)or bpy.app.build_hash!=b'02f0899d78e3':raise OracleUnsupported('Oracle requires pinned Blender5.3.0 build02f0899d78e3')
    validate(specifications)
    before=snapshot();scene=mesh=obj=tree=None;timing={};start=time.perf_counter();rows=[]
    try:
        tag=uuid.uuid4().hex;scene=bpy.data.scenes.new('Owned CPU-MF '+tag);mesh=bpy.data.meshes.new('Owned one point '+tag);mesh.from_pydata([(0,0,0)],[],[]);obj=bpy.data.objects.new('Owned CPU-MF carrier '+tag,mesh);scene.collection.objects.link(obj)
        tree=bpy.data.node_groups.new('Owned CPU-MF graph '+tag,'GeometryNodeTree');tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');entry=tree.nodes.new('NodeGroupInput');output=tree.nodes.new('NodeGroupOutput');geometry=entry.outputs['Geometry'];bindings=[]
        for i,spec in enumerate(specifications):
            signal,data_type,width,inputs,classes=build(tree,spec);store=tree.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type=data_type;store.domain='POINT';store.inputs['Name'].default_value='oracle_'+str(i);store.inputs['Selection'].default_value=True
            tree.links.new(geometry,store.inputs['Geometry']);target=next(s for s in store.inputs if s.name=='Value'and s.enabled and not s.is_unavailable)
            if signal.type!=target.type:raise OracleUnsupported('Oracle implicit output cast is forbidden')
            tree.links.new(signal,target);geometry=store.outputs['Geometry'];bindings.append((spec,data_type,width,inputs,classes,'oracle_'+str(i)))
        tree.links.new(geometry,output.inputs['Geometry']);modifier=obj.modifiers.new('Owned CPU-MF evaluator','NODES');modifier.node_group=tree
        if len(tree.nodes)>512 or any(n.bl_idname not in ALLOWED for n in tree.nodes):raise OracleUnsupported('Oracle node work limit or class refusal')
        if tree.animation_data or scene.animation_data or obj.animation_data:raise OracleUnsupported('Oracle dynamic context is forbidden')
        timing['buildMilliseconds']=(time.perf_counter()-start)*1000;evaluate=time.perf_counter()
        with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
            depsgraph=bpy.context.evaluated_depsgraph_get();evaluated=obj.evaluated_get(depsgraph);result=evaluated.to_mesh()
            try:
                if len(result.vertices)!=1 or len(result.edges)or len(result.polygons):raise OracleUnsupported('Oracle carrier topology changed')
                timing['evaluateMilliseconds']=(time.perf_counter()-evaluate)*1000;read=time.perf_counter()
                for spec,data_type,width,inputs,classes,name in bindings:
                    attribute=result.attributes[name]
                    if attribute.domain!='POINT'or attribute.data_type!=data_type or len(attribute.data)!=1:raise OracleUnsupported('Oracle attribute type/domain/size changed')
                    buffer=array('i'if data_type=='INT'else'f',[0]*width)
                    if buffer.itemsize!=4:raise OracleUnsupported('Oracle needs native32bit array storage')
                    attribute.data.foreach_get('value',buffer)
                    if data_type=='INT':values=list(buffer);words=list(struct.unpack('='+str(width)+'I',buffer.tobytes()))
                    else:values=list(buffer);words=list(struct.unpack('='+str(width)+'I',buffer.tobytes()))
                    wanted=spec['expectedValues']if data_type=='INT'else spec['expectedWords'];actual=values if data_type=='INT'else words
                    rows.append({'case':spec['id'],'kind':spec['kind'],'attributeType':data_type,'socketType':{'INT':'INT','FLOAT':'VALUE','FLOAT4X4':'MATRIX','QUATERNION':'ROTATION'}[data_type],'domain':'POINT','width':width,'values':values,'words':words,'expected':wanted,'matches':actual==wanted,'actualInputs':inputs,'nativeClasses':classes})
                timing['readMilliseconds']=(time.perf_counter()-read)*1000
            finally:evaluated.to_mesh_clear()
    finally:
        cleanup=time.perf_counter()
        if obj is not None:bpy.data.objects.remove(obj,do_unlink=True)
        if mesh is not None:bpy.data.meshes.remove(mesh)
        if tree is not None:bpy.data.node_groups.remove(tree)
        if scene is not None:bpy.data.scenes.remove(scene)
        timing['cleanupMilliseconds']=(time.perf_counter()-cleanup)*1000
    after=snapshot()
    if before!=after:raise OracleUnsupported('Oracle source/context/ID ownership was not restored')
    return {'model':MODEL,'stage':'Private Geometry Nodes CPU-MF attribute readback; not compositor execution, EEVEE, GPU kernel or scene proof','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'gpuInitializedByProbe':False,'renders':0,'bakes':0,'nodePortCredit':0,'sourceOwnershipRestored':True,'ownershipSnapshotSha256':hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest(),'timing':timing,'rows':rows,'wordOrIntegerMismatches':sum(not row['matches']for row in rows)}
