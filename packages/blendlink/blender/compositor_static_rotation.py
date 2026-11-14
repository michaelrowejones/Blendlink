# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned CPU static quaternion normalization islands; ROTATION never reaches IR."""
from array import array
import struct
import uuid
import bpy
if __package__:
    from . import compositor_static_matrix as shared
else:
    import compositor_static_matrix as shared

MODEL='native-static-quaternion-normalize-cpu-53-v1'
NODES={'FunctionNodeQuaternionToRotation','FunctionNodeRotationToQuaternion'}
COMPONENTS=('W','X','Y','Z')

class StaticRotationUnsupported(ValueError):
    pass

class EulerProducer(StaticRotationUnsupported):
    """Typed source-domain routing signal, emitted only before native evaluation."""
    pass


def _literal(socket):
    word=shared._raw_scalar(socket)
    absolute=word&0x7fffffff
    if absolute and not 0x37800000<=absolute<=0x40800000:
        raise StaticRotationUnsupported('Static Quaternion literal components must be positive zero or |value| in [2^-16,4]')
    return word


class _Evaluator(shared._Evaluator):
    """Reuse fixed bounded traversal/observation, never Matrix node admission."""
    def recipe(self,kind,*parts):
        if kind=='float':children=()
        elif kind=='quaternion':children=parts[0]
        elif kind=='component':children=(parts[0],)
        else:raise StaticRotationUnsupported('Static Quaternion has an unknown recipe kind')
        height=1+max((self.recipe_heights[child]for child in children),default=-1)
        if height>shared.MAX_DEPTH:raise StaticRotationUnsupported('Static Quaternion exceeds flat recipe depth16')
        key=(kind,)+parts
        if key not in self.recipe_ids:
            if len(self.recipes)>=2048:raise StaticRotationUnsupported('Static Quaternion exceeds2048 flat recipe records')
            self.recipe_ids[key]=len(self.recipes);self.recipes.append(key);self.recipe_heights.append(height)
        return self.recipe_ids[key]

    def _resolve(self,socket,stack,depth):
        node=socket.node
        recurse=lambda incoming,frames=stack:self.resolve(incoming,frames,depth+1)
        if socket.type not in {'VALUE','ROTATION'}:
            raise StaticRotationUnsupported('Static Quaternion implicit or non-Float/Rotation conversions remain unqualified')
        if not socket.is_output:
            links=[link for link in socket.links if link.is_valid and not link.is_muted]
            if len(links)>1:raise StaticRotationUnsupported('Static Quaternion has multiple live input links')
            if links:
                if links[0].from_socket.type!=socket.type:raise StaticRotationUnsupported('Static Quaternion implicit socket conversion remains unqualified')
                return recurse(links[0].from_socket)
            if socket.type=='ROTATION':raise StaticRotationUnsupported('Static Quaternion unlinked Rotation defaults are Euler storage and remain unqualified')
            word=_literal(socket);self.source_reads[socket.as_pointer()]=(socket,word)
            return self.recipe('float',word)
        if node.mute:
            links=[link for link in node.internal_links if link.to_socket.identifier==socket.identifier]
            if len(links)!=1 or links[0].from_socket.type!=socket.type:raise StaticRotationUnsupported('Static Quaternion mute has no unique same-type native bypass')
            return recurse(links[0].from_socket)
        kind=node.bl_idname
        if kind=='NodeReroute':return recurse(node.inputs[0])
        if kind=='NodeGroupInput':
            if not stack:raise StaticRotationUnsupported('Static Quaternion group input has no instance binding')
            return recurse(shared._active(stack[-1].inputs,socket.identifier,socket.type),stack[:-1])
        if kind=='CompositorNodeGroup':
            outputs=[item for item in node.node_tree.nodes if item.bl_idname=='NodeGroupOutput'and item.is_active_output]if node.node_tree else[]
            if len(outputs)!=1:raise StaticRotationUnsupported('Static Quaternion group needs one active output')
            return recurse(shared._active(outputs[0].inputs,socket.identifier,socket.type),stack+(node,))
        if kind in {'GeometryNodeSwitch','GeometryNodeIndexSwitch','GeometryNodeMenuSwitch'}:
            if socket.type=='ROTATION':raise StaticRotationUnsupported('Static Quaternion Rotation selectors remain unqualified; only reviewed scalar literal selection is admitted')
            if self.select is None:raise StaticRotationUnsupported('Static Quaternion selector policy is unavailable')
            try:selected=self.select(node,socket,stack)
            except ValueError as error:raise StaticRotationUnsupported('Static Quaternion selector is unqualified: '+str(error))from error
            self.selectors.append((node,socket,stack,selected['input'].as_pointer()if selected['input']is not None else None,selected['constant']))
            if selected['constant']is not None:raise StaticRotationUnsupported('Static Quaternion Boolean selector output cannot convert to Float')
            return recurse(selected['input'])
        if kind in {'ShaderNodeValue','CompositorNodeValue'}and socket.type=='VALUE'and socket.identifier=='Value':
            word=_literal(socket);self.source_reads[socket.as_pointer()]=(socket,word)
            return self.recipe('float',word)
        if kind=='FunctionNodeEulerToRotation':raise EulerProducer('Static Quaternion encountered an Euler constructor before native evaluation')
        if kind not in NODES:raise StaticRotationUnsupported('Static Quaternion requires reviewed literal normalization/component-copy producers; fields, context, arithmetic and Matrix producers refuse')
        self.members[(node.as_pointer(),tuple(instance.as_pointer()for instance in stack))]={'nodeType':kind,'node':node.name,'tree':node.id_data.name,'instances':[instance.name for instance in stack]}
        if kind=='FunctionNodeQuaternionToRotation':
            if socket.identifier!='Rotation'or socket.type!='ROTATION'or tuple(s.identifier for s in node.inputs)!=COMPONENTS:
                raise StaticRotationUnsupported('Static Quaternion constructor schema changed')
            components=tuple(recurse(shared._active(node.inputs,name,'VALUE'))for name in COMPONENTS)
            if any(self.recipes[child][0]!='float'for child in components):raise StaticRotationUnsupported('Static Quaternion computed/recombined components remain unqualified')
            return self.recipe('quaternion',components)
        if socket.type!='VALUE'or socket.identifier not in COMPONENTS or tuple(s.identifier for s in node.outputs)!=COMPONENTS or len(node.inputs)!=1:
            raise StaticRotationUnsupported('Static Quaternion component schema changed')
        source=recurse(shared._active(node.inputs,'Rotation','ROTATION'))
        if self.recipes[source][0]!='quaternion':raise StaticRotationUnsupported('Static Quaternion needs an explicit linked Quaternion to Rotation producer')
        return self.recipe('component',source,COMPONENTS.index(socket.identifier))

    def native(self,rotation):
        recipe=self.recipes[rotation]
        if recipe[0]!='quaternion'or len(recipe[1])!=4:raise StaticRotationUnsupported('Static Quaternion private recipe is malformed')
        before=shared._ownership();scene=mesh=obj=tree=None
        try:
            tag=uuid.uuid4().hex;scene=bpy.data.scenes.new('.SceneToWeb quaternion '+tag)
            mesh=bpy.data.meshes.new('.SceneToWeb quaternion point '+tag);mesh.from_pydata([(0,0,0)],[],[])
            obj=bpy.data.objects.new('.SceneToWeb quaternion point '+tag,mesh);scene.collection.objects.link(obj)
            tree=bpy.data.node_groups.new('.SceneToWeb quaternion MF '+tag,'GeometryNodeTree')
            tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
            entry=tree.nodes.new('NodeGroupInput');out=tree.nodes.new('NodeGroupOutput')
            constructor=tree.nodes.new('FunctionNodeQuaternionToRotation');separate=tree.nodes.new('FunctionNodeRotationToQuaternion')
            for name,child in zip(COMPONENTS,recipe[1]):
                literal=self.recipes[child]
                if literal[0]!='float':raise StaticRotationUnsupported('Static Quaternion private constructor is not literal')
                shared._active(constructor.inputs,name,'VALUE').default_value=shared._float(literal[1])
            tree.links.new(shared._active(constructor.outputs,'Rotation','ROTATION'),shared._active(separate.inputs,'Rotation','ROTATION'))
            geometry=entry.outputs['Geometry']
            for index,name in enumerate(COMPONENTS):
                store=tree.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type='FLOAT';store.domain='POINT';store.inputs['Name'].default_value='quaternion_'+str(index);store.inputs['Selection'].default_value=True
                tree.links.new(geometry,store.inputs['Geometry']);tree.links.new(shared._active(separate.outputs,name,'VALUE'),shared._active(store.inputs,'Value','VALUE'));geometry=store.outputs['Geometry']
            tree.links.new(geometry,out.inputs['Geometry']);modifier=obj.modifiers.new('.SceneToWeb quaternion MF','NODES');modifier.node_group=tree
            with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
                evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());result=evaluated.to_mesh()
                try:
                    if len(result.vertices)!=1 or len(result.edges)or len(result.polygons):raise StaticRotationUnsupported('Static Quaternion private carrier topology changed')
                    words=[]
                    for index in range(4):
                        attribute=result.attributes['quaternion_'+str(index)]
                        if attribute.data_type!='FLOAT'or attribute.domain!='POINT'or len(attribute.data)!=1:raise StaticRotationUnsupported('Static Quaternion output attribute schema changed')
                        raw=array('f',[0]);attribute.data.foreach_get('value',raw);word=struct.unpack('=I',raw.tobytes())[0]
                        if not shared._normal_word(word):raise StaticRotationUnsupported('Static Quaternion raw output is not normal Float32 or positive zero')
                        words.append(word)
                finally:evaluated.to_mesh_clear()
        finally:
            if obj is not None:bpy.data.objects.remove(obj,do_unlink=True)
            if mesh is not None:bpy.data.meshes.remove(mesh)
            if tree is not None:bpy.data.node_groups.remove(tree)
            if scene is not None:bpy.data.scenes.remove(scene)
        if before!=shared._ownership():raise StaticRotationUnsupported('Static Quaternion private evaluation changed source/context ownership')
        return tuple(words)


def evaluate_output(socket,scene,cache,stack=(),select=None):
    """A separate extraction cache; no Quaternion recipes enter Matrix admission."""
    try:
        evaluator=cache.get('evaluator')
        if evaluator is None:evaluator=cache.setdefault('evaluator',_Evaluator(scene,select))
        if evaluator.scene.as_pointer()!=scene.as_pointer():raise StaticRotationUnsupported('Static Quaternion cache cannot cross source scenes')
        expression=evaluator.resolve(socket,tuple(stack));word=evaluator.evaluate(expression)
        return {'value':shared._float(word),'word':word,'type':'VALUE','model':MODEL,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),
            'sourceContext':'CPU compositor static quaternion normalization/component-copy island; private Geometry Nodes CPU-MF carrier','rotationRuntimeTransport':False,
            'sources':list(evaluator.members.values()),'nativeEvaluations':evaluator.native_evaluations}
    except shared.StaticMatrixUnsupported as error:
        raise StaticRotationUnsupported(str(error).replace('Static Matrix','Static Quaternion').replace('Separate Matrix','Rotation to Quaternion'))from error
