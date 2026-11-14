# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned positive literal EulerXYZ CPU construction; no normalization or copy of user trees."""
from array import array
import struct
import uuid
import bpy
if __package__:
    from . import compositor_static_rotation as rotation
    from . import compositor_static_matrix as shared
else:
    import compositor_static_rotation as rotation
    import compositor_static_matrix as shared

MODEL='native-static-euler-xyz-cpu-53-v1'
NODES={'FunctionNodeEulerToRotation','FunctionNodeRotationToQuaternion'}
COMPONENTS=rotation.COMPONENTS

class StaticEulerUnsupported(rotation.StaticRotationUnsupported):
    pass

class NotEulerRoute(StaticEulerUnsupported):
    """Preserve the existing Quaternion route's refusal for unrelated producers."""
    pass


def _raw_euler(node):
    if (node.bl_idname!='FunctionNodeEulerToRotation' or len(node.inputs)!=1 or len(node.outputs)!=1
            or node.inputs[0].identifier!='Euler' or node.inputs[0].type!='VECTOR'
            or node.inputs[0].bl_idname!='NodeSocketVectorEuler'
            or node.outputs[0].identifier!='Rotation' or node.outputs[0].type!='ROTATION'
            or len(node.inputs[0].default_value)!=3):
        raise StaticEulerUnsupported('Static Euler constructor socket schema changed')
    if node.mute or len(node.inputs[0].links):
        raise StaticEulerUnsupported('Static Euler needs an unlinked literal Euler3 input and unmuted constructor')
    # default_value is mathutils.Euler: a component getter would promote F32.
    # The constructor has one homogeneous vector socket; native bulk copy is raw.
    raw=array('f',[0,0,0]);node.inputs.foreach_get('default_value',raw)
    words=struct.unpack('=3I',raw.tobytes())
    if any(word!=0 and not 0x37800000<=word<=0x3f800000 for word in words):
        raise StaticEulerUnsupported('Static Euler components must be raw positive zero or positive [2^-16,1] radians')
    return words


def _hash_word(word):
    """Pinned Blender hash_float/hash_uint2(value_hash, seed0), unsigned arithmetic.

    Hash guard formula follows Blender noise.cc (GPL-2.0-or-later). No Float
    promotion or runtime kernel; compare native pre-Float-store INT evidence.
    """
    mask=0xffffffff
    def hash32(items):
        rotate=lambda value,bits:((value<<bits)|(value>>(32-bits)))&mask
        a=b=c=(0xdeadbeef+(len(items)<<2)+13)&mask;a=(a+items[0])&mask
        if len(items)>1:b=(b+items[1])&mask
        c=((c^b)-rotate(b,14))&mask;a=((a^c)-rotate(c,11))&mask;b=((b^a)-rotate(a,25))&mask
        c=((c^b)-rotate(b,16))&mask;a=((a^c)-rotate(c,4))&mask;b=((b^a)-rotate(a,14))&mask;c=((c^b)-rotate(b,24))&mask
        return c
    return hash32((hash32((word,)),0))


class _Evaluator(rotation._Evaluator):
    def __init__(self,scene,select):
        super().__init__(scene,select);self.euler_reads={}

    def _resolve(self,socket,stack,depth):
        node=socket.node
        if node.bl_idname=='FunctionNodeQuaternionToRotation':
            raise NotEulerRoute('Static Euler route does not alter Quaternion normalization admission')
        if node.bl_idname=='FunctionNodeInputRotation':
            raise NotEulerRoute('Input Rotation property storage needs an independently safe raw reader and remains unqualified')
        if node.bl_idname!='FunctionNodeEulerToRotation':
            return super()._resolve(socket,stack,depth)
        if not socket.is_output or socket.type!='ROTATION' or socket.identifier!='Rotation':
            raise StaticEulerUnsupported('Static Euler constructor output schema changed')
        words=_raw_euler(node);key=(node.as_pointer(),tuple(instance.as_pointer()for instance in stack))
        prior=self.euler_reads.get(key)
        if prior is not None and prior[1]!=words:raise StaticEulerUnsupported('Static Euler source vector storage changed during extraction')
        self.euler_reads[key]=(node,words)
        self.members[key]={'nodeType':node.bl_idname,'node':node.name,'tree':node.id_data.name,'instances':[instance.name for instance in stack]}
        # Reuse opaque flat quaternion result IDs, with exactly three literal
        # children. This evaluator never accepts a four-component Q constructor.
        return self.recipe('quaternion',tuple(self.recipe('float',word)for word in words))

    def check_sources(self):
        super().check_sources()
        try:
            for node,words in self.euler_reads.values():
                if _raw_euler(node)!=words:raise StaticEulerUnsupported('Static Euler source vector storage changed during extraction')
        except (ReferenceError,RuntimeError)as error:
            raise StaticEulerUnsupported('Static Euler source ownership changed during extraction')from error

    def native(self,expression):
        recipe=self.recipes[expression]
        if recipe[0]!='quaternion'or len(recipe[1])!=3:raise StaticEulerUnsupported('Static Euler private recipe must contain exactly three literal words')
        input_words=tuple(self.recipes[child][1]for child in recipe[1])
        if any(self.recipes[child][0]!='float'for child in recipe[1]):raise StaticEulerUnsupported('Static Euler private recipe is not literal')
        before=shared._ownership();scene=mesh=obj=tree=None
        try:
            tag=uuid.uuid4().hex;scene=bpy.data.scenes.new('.SceneToWeb Euler '+tag)
            mesh=bpy.data.meshes.new('.SceneToWeb Euler point '+tag);mesh.from_pydata([(0,0,0)],[],[])
            obj=bpy.data.objects.new('.SceneToWeb Euler point '+tag,mesh);scene.collection.objects.link(obj)
            tree=bpy.data.node_groups.new('.SceneToWeb Euler MF '+tag,'GeometryNodeTree')
            tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
            entry=tree.nodes.new('NodeGroupInput');out=tree.nodes.new('NodeGroupOutput');constructor=tree.nodes.new('FunctionNodeEulerToRotation');separate=tree.nodes.new('FunctionNodeRotationToQuaternion')
            raw=array('f');raw.frombytes(struct.pack('=3I',*input_words));constructor.inputs.foreach_set('default_value',raw)
            if _raw_euler(constructor)!=input_words:raise StaticEulerUnsupported('Static Euler private literal storage changed')
            tree.links.new(constructor.outputs['Rotation'],separate.inputs['Rotation']);geometry=entry.outputs['Geometry']
            for index,name in enumerate(COMPONENTS):
                signal=shared._active(separate.outputs,name,'VALUE');hashed=tree.nodes.new('FunctionNodeHashValue');hashed.data_type='FLOAT';hashed.inputs['Seed'].default_value=0
                tree.links.new(signal,shared._active(hashed.inputs,'Value','VALUE'))
                for kind,label,source in [('FLOAT','euler_'+str(index),signal),('INT','hash_'+str(index),hashed.outputs['Hash'])]:
                    store=tree.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type=kind;store.domain='POINT';store.inputs['Name'].default_value=label;store.inputs['Selection'].default_value=True
                    tree.links.new(geometry,store.inputs['Geometry']);tree.links.new(source,shared._active(store.inputs,'Value','VALUE'if kind=='FLOAT'else'INT'));geometry=store.outputs['Geometry']
            if len(tree.nodes)!=16:raise StaticEulerUnsupported('Static Euler private16-node carrier schema changed')
            tree.links.new(geometry,out.inputs['Geometry']);modifier=obj.modifiers.new('.SceneToWeb Euler MF','NODES');modifier.node_group=tree
            with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
                evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());result=evaluated.to_mesh()
                try:
                    if len(result.vertices)!=1 or len(result.edges)or len(result.polygons):raise StaticEulerUnsupported('Static Euler private carrier topology changed')
                    words=[]
                    for index in range(4):
                        attribute=result.attributes['euler_'+str(index)];witness=result.attributes['hash_'+str(index)]
                        if attribute.data_type!='FLOAT'or witness.data_type!='INT'or attribute.domain!='POINT'or witness.domain!='POINT'or len(attribute.data)!=1 or len(witness.data)!=1:raise StaticEulerUnsupported('Static Euler output attribute schema changed')
                        raw=array('f',[0]);attribute.data.foreach_get('value',raw);word=struct.unpack('=I',raw.tobytes())[0];native_hash=array('i',[0]);witness.data.foreach_get('value',native_hash)
                        if not shared._normal_word(word)or(native_hash[0]&0xffffffff)!=_hash_word(word):raise StaticEulerUnsupported('Static Euler raw output or pre-Float-store signed-zero/hash guard failed')
                        words.append(word)
                finally:evaluated.to_mesh_clear()
        finally:
            if obj is not None:bpy.data.objects.remove(obj,do_unlink=True)
            if mesh is not None:bpy.data.meshes.remove(mesh)
            if tree is not None:bpy.data.node_groups.remove(tree)
            if scene is not None:bpy.data.scenes.remove(scene)
        if before!=shared._ownership():raise StaticEulerUnsupported('Static Euler private evaluation changed source/context ownership')
        return tuple(words)


def evaluate_output(socket,scene,cache,stack=(),select=None):
    try:
        evaluator=cache.get('evaluator')
        if evaluator is None:evaluator=cache.setdefault('evaluator',_Evaluator(scene,select))
        if type(evaluator)is not _Evaluator or evaluator.scene.as_pointer()!=scene.as_pointer():raise StaticEulerUnsupported('Static Euler cache cannot cross profile/source scenes')
        expression=evaluator.resolve(socket,tuple(stack));word=evaluator.evaluate(expression);opaque=evaluator.recipes[expression][1];children=evaluator.recipes[opaque][1]
        return {'value':shared._float(word),'word':word,'type':'VALUE','model':MODEL,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'sourceContext':'CPU compositor static positive literal EulerXYZ construction; unchanged native trig polynomial, no normalize/canonicalize; private Geometry CPU-MF carrier','rotationRuntimeTransport':False,'eulerInputWords':[evaluator.recipes[child][1]for child in children],'preFloatStoreHashGuard':True,'sources':list(evaluator.members.values()),'nativeEvaluations':evaluator.native_evaluations}
    except shared.StaticMatrixUnsupported as error:
        raise StaticEulerUnsupported(str(error).replace('Static Matrix','Static Euler').replace('Separate Matrix','Rotation to Quaternion'))from error
