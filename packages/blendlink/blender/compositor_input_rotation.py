# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned static Input Rotation EulerXYZ construction; scalar endpoints only."""
from array import array
import struct
import uuid
import bpy
if __package__:
    from . import compositor_static_euler as euler
    from . import compositor_static_rotation as rotation
    from . import compositor_static_matrix as shared
    from .compositor_raw_arrays import raw_float_array_words
else:
    import compositor_static_euler as euler
    import compositor_static_rotation as rotation
    import compositor_static_matrix as shared
    from compositor_raw_arrays import raw_float_array_words

MODEL='native-static-input-rotation-euler-xyz-cpu-53-v1'
NODES={'FunctionNodeInputRotation','FunctionNodeRotationToQuaternion'}
COMPONENTS=rotation.COMPONENTS

class InputRotationUnsupported(rotation.StaticRotationUnsupported):pass
class NotInputRotationRoute(InputRotationUnsupported):pass

def _raw_constructor(node):
    if (node.bl_idname!='FunctionNodeInputRotation' or node.mute or len(node.inputs)!=0
            or len(node.outputs)!=1 or node.outputs[0].identifier!='Rotation'
            or node.outputs[0].type!='ROTATION' or node.outputs[0].bl_idname!='NodeSocketRotation'
            or not node.outputs[0].enabled or node.outputs[0].is_unavailable):
        raise InputRotationUnsupported('Input Rotation requires its unmuted native no-input, single Rotation output constructor')
    try:words=raw_float_array_words(node,'rotation_euler',3)
    except (ValueError,TypeError)as error:raise InputRotationUnsupported('Input Rotation raw Euler array schema changed: '+str(error))from error
    if any(word==0x80000000 or word&0x7fffffff and not 0x00800000<=word&0x7fffffff<=0x41000000 for word in words):
        raise InputRotationUnsupported('Input Rotation Euler components require raw positive zero or signed normal Float32 magnitude at most eight radians')
    return words

def _carrier_state(tree,obj):
    return(tuple((node.as_pointer(),shared._Evaluator.signature(node),
                  tuple((s.identifier,s.type,s.bl_idname,s.enabled,s.is_unavailable)for s in node.outputs))for node in tree.nodes),
        tuple((link.from_socket.as_pointer(),link.to_socket.as_pointer(),link.is_valid,link.is_muted)for link in tree.links),
        tuple((node.as_pointer(),_raw_constructor(node))for node in tree.nodes if node.bl_idname=='FunctionNodeInputRotation'),
        tuple((node.as_pointer(),node.data_type,node.inputs['Seed'].default_value)for node in tree.nodes if node.bl_idname=='FunctionNodeHashValue'),
        tuple((node.as_pointer(),node.data_type,node.domain,node.inputs['Name'].default_value,node.inputs['Selection'].default_value)for node in tree.nodes if node.bl_idname=='GeometryNodeStoreNamedAttribute'),
        tuple((modifier.as_pointer(),modifier.type,modifier.node_group.as_pointer())for modifier in obj.modifiers))

class _Evaluator(euler._Evaluator):
    def __init__(self,scene,select):
        super().__init__(scene,select);self.input_rotation_reads={}

    def _resolve(self,socket,stack,depth):
        node=socket.node
        if node.bl_idname in {'FunctionNodeEulerToRotation','FunctionNodeQuaternionToRotation'}:
            raise NotInputRotationRoute('Input Rotation bridge does not change existing Euler or Quaternion producer admission')
        if node.bl_idname!='FunctionNodeInputRotation':return super()._resolve(socket,stack,depth)
        if not socket.is_output or socket.identifier!='Rotation' or socket.type!='ROTATION':
            raise InputRotationUnsupported('Input Rotation constructor output schema changed')
        words=_raw_constructor(node);key=(node.as_pointer(),tuple(instance.as_pointer()for instance in stack))
        prior=self.input_rotation_reads.get(key)
        if prior is not None and prior[1]!=words:raise InputRotationUnsupported('Input Rotation raw Euler property changed during extraction')
        self.input_rotation_reads[key]=(node,words)
        self.members[key]={'nodeType':node.bl_idname,'node':node.name,'tree':node.id_data.name,'instances':[instance.name for instance in stack]}
        return self.recipe('quaternion',tuple(self.recipe('float',word)for word in words))

    def check_sources(self):
        super().check_sources()
        try:
            for node,words in self.input_rotation_reads.values():
                if _raw_constructor(node)!=words:raise InputRotationUnsupported('Input Rotation raw Euler property changed during extraction')
        except (ReferenceError,RuntimeError)as error:raise InputRotationUnsupported('Input Rotation source ownership changed during extraction')from error

    def native(self,expression):
        recipe=self.recipes[expression]
        if recipe[0]!='quaternion' or len(recipe[1])!=3 or any(self.recipes[child][0]!='float'for child in recipe[1]):
            raise InputRotationUnsupported('Input Rotation private recipe requires exactly three raw literal words')
        input_words=tuple(self.recipes[child][1]for child in recipe[1]);before=shared._ownership();scene=mesh=obj=tree=None
        try:
            tag=uuid.uuid4().hex;scene=bpy.data.scenes.new('.SceneToWeb Input Rotation '+tag)
            mesh=bpy.data.meshes.new('.SceneToWeb Input Rotation point '+tag);mesh.from_pydata([(0,0,0)],[],[])
            obj=bpy.data.objects.new('.SceneToWeb Input Rotation point '+tag,mesh);scene.collection.objects.link(obj)
            tree=bpy.data.node_groups.new('.SceneToWeb Input Rotation MF '+tag,'GeometryNodeTree')
            tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
            entry=tree.nodes.new('NodeGroupInput');out=tree.nodes.new('NodeGroupOutput');constructor=tree.nodes.new('FunctionNodeInputRotation');separate=tree.nodes.new('FunctionNodeRotationToQuaternion')
            raw=array('f');raw.frombytes(struct.pack('=3I',*input_words));constructor.path_resolve('rotation_euler',False).foreach_set(raw)
            if _raw_constructor(constructor)!=input_words:raise InputRotationUnsupported('Input Rotation private literal storage changed')
            tree.links.new(constructor.outputs['Rotation'],separate.inputs['Rotation']);geometry=entry.outputs['Geometry']
            for index,name in enumerate(COMPONENTS):
                signal=shared._active(separate.outputs,name,'VALUE');hashed=tree.nodes.new('FunctionNodeHashValue');hashed.data_type='FLOAT';hashed.inputs['Seed'].default_value=0
                tree.links.new(signal,shared._active(hashed.inputs,'Value','VALUE'))
                for kind,label,source in [('FLOAT','rotation_'+str(index),signal),('INT','hash_'+str(index),hashed.outputs['Hash'])]:
                    store=tree.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type=kind;store.domain='POINT';store.inputs['Name'].default_value=label;store.inputs['Selection'].default_value=True
                    tree.links.new(geometry,store.inputs['Geometry']);tree.links.new(source,shared._active(store.inputs,'Value','VALUE'if kind=='FLOAT'else'INT'));geometry=store.outputs['Geometry']
            tree.links.new(geometry,out.inputs['Geometry']);modifier=obj.modifiers.new('.SceneToWeb Input Rotation MF','NODES');modifier.node_group=tree
            if len(tree.nodes)!=16:raise InputRotationUnsupported('Input Rotation private sixteen-node carrier schema changed')
            carrier=_carrier_state(tree,obj)
            with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
                evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());result=evaluated.to_mesh()
                try:
                    if len(result.vertices)!=1 or len(result.edges)or len(result.polygons):raise InputRotationUnsupported('Input Rotation private carrier topology changed')
                    words=[]
                    for index in range(4):
                        attribute=result.attributes.get('rotation_'+str(index));witness=result.attributes.get('hash_'+str(index))
                        if attribute is None or witness is None:raise InputRotationUnsupported('Input Rotation native output attributes changed')
                        if attribute.data_type!='FLOAT' or witness.data_type!='INT' or attribute.domain!='POINT' or witness.domain!='POINT' or len(attribute.data)!=1 or len(witness.data)!=1:raise InputRotationUnsupported('Input Rotation output attribute schema changed')
                        raw=array('f',[0]);attribute.data.foreach_get('value',raw);word=struct.unpack('=I',raw.tobytes())[0];native_hash=array('i',[0]);witness.data.foreach_get('value',native_hash)
                        if not shared._normal_word(word)or(native_hash[0]&0xffffffff)!=euler._hash_word(word):raise InputRotationUnsupported('Input Rotation raw output or pre-Float-store signed-zero/hash guard failed')
                        words.append(word)
                    if _carrier_state(tree,obj)!=carrier:raise InputRotationUnsupported('Input Rotation owned native carrier changed during evaluation')
                finally:evaluated.to_mesh_clear()
        finally:
            failures=[]
            for collection,item in [(bpy.data.objects,obj),(bpy.data.meshes,mesh),(bpy.data.node_groups,tree),(bpy.data.scenes,scene)]:
                if item is None:continue
                try:
                    if item.as_pointer():collection.remove(item,do_unlink=True)
                except ReferenceError:pass
                except RuntimeError as error:failures.append(str(error))
            if failures:raise InputRotationUnsupported('Input Rotation owned carrier cleanup failed: '+'; '.join(failures))
        if before!=shared._ownership():raise InputRotationUnsupported('Input Rotation private evaluation changed source/context ownership')
        return tuple(words)

def evaluate_output(socket,scene,cache,stack=(),select=None):
    try:
        evaluator=cache.get('evaluator')
        if evaluator is None:evaluator=_Evaluator(scene,select)
        if type(evaluator)is not _Evaluator or evaluator.scene.as_pointer()!=scene.as_pointer():raise InputRotationUnsupported('Input Rotation cache cannot cross profile/source scenes')
        expression=evaluator.resolve(socket,tuple(stack));word=evaluator.evaluate(expression);cache['evaluator']=evaluator
        opaque=evaluator.recipes[expression][1];children=evaluator.recipes[opaque][1]
        return {'value':shared._float(word),'word':word,'type':'VALUE','model':MODEL,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'sourceContext':'CPU compositor static literal Input Rotation EulerXYZ; signed normal inputs within eight radians, output normal/+0 and pre-store hash required; private Geometry CPU-MF carrier; unchanged native trig construction, no normalize/canonicalize','rotationRuntimeTransport':False,'eulerInputWords':[evaluator.recipes[child][1]for child in children],'rawArrayReader':'public-path-resolve-coerce-false-foreach-f32-v1','preFloatStoreHashGuard':True,'sources':list(evaluator.members.values()),'nativeEvaluations':evaluator.native_evaluations}
    except shared.StaticMatrixUnsupported as error:raise InputRotationUnsupported(str(error).replace('Static Matrix','Input Rotation').replace('Separate Matrix','Rotation to Quaternion'))from error

    except (ReferenceError,RuntimeError,KeyError,TypeError)as error:raise InputRotationUnsupported('Input Rotation source/private ownership or schema changed during evaluation')from error
