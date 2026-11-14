# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded CPU-only static copy/permutation matrix islands, not matrix fields."""
from array import array
import platform
import struct
import sys
import uuid
import bpy

MODEL = 'native-static-matrix-copy-cpu-53-v1'
NODES = {'FunctionNodeCombineMatrix', 'FunctionNodeTransposeMatrix', 'FunctionNodeSeparateMatrix'}
COLUMNS = tuple('Column %d Row %d' % (column, row) for column in range(1, 5) for row in range(1, 5))
MAX_NODES, MAX_DEPTH, MAX_ISLANDS = 64, 16, 16

class StaticMatrixUnsupported(ValueError):
    pass


def _normal_word(word):
    absolute = word & 0x7fffffff
    return word != 0x80000000 and (absolute == 0 or 0x00800000 <= absolute < 0x7f800000)


def _float(word):
    return struct.unpack('=f', struct.pack('=I', word))[0]


def _static(node):
    if node.id_data.bl_idname != 'CompositorNodeTree':
        raise StaticMatrixUnsupported('Static Matrix needs a compositor source tree; geometry/shader source admission is unqualified')
    animation = node.id_data.animation_data
    if animation and (animation.action or len(animation.drivers) or len(animation.nla_tracks)):
        raise StaticMatrixUnsupported('Static Matrix refuses source tree animation, drivers and NLA')


def _active(sockets, identifier, kind):
    matches = [socket for socket in sockets if socket.identifier == identifier and socket.type == kind
               and socket.enabled and not socket.is_unavailable]
    if len(matches) != 1:
        raise StaticMatrixUnsupported('Static Matrix active socket schema changed: '+identifier+'/'+kind)
    return matches[0]


def _raw_scalars(sockets):
    """Batch-copy homogeneous scalar storage before any Python float promotion."""
    sockets=tuple(sockets)
    if not sockets:return ()
    private = owner = None
    try:
        private = bpy.data.node_groups.new('.SceneToWeb matrix scalar copy', 'CompositorNodeTree')
        for socket in sockets:
            interface = private.interface.new_socket(name='Value', in_out='INPUT', socket_type='NodeSocketFloat')
            interface.from_socket(socket.node, socket)
        owner = bpy.data.node_groups.new('.SceneToWeb matrix scalar owner', 'CompositorNodeTree')
        instance = owner.nodes.new('CompositorNodeGroup'); instance.node_tree = private
        if len(instance.inputs) != len(sockets) or any(socket.type != 'VALUE' for socket in instance.inputs):
            raise StaticMatrixUnsupported('Static Matrix native scalar copy schema changed')
        raw = array('f', [0]) * len(sockets); instance.inputs.foreach_get('default_value', raw)
        words = struct.unpack('='+str(len(sockets))+'I', raw.tobytes())
        if not all(_normal_word(word) for word in words):
            raise StaticMatrixUnsupported('Static Matrix requires normal Float32 or positive-zero source words; negative zero/subnormals/nonfinite values refuse')
        return words
    finally:
        if owner is not None:bpy.data.node_groups.remove(owner, do_unlink=True)
        if private is not None:bpy.data.node_groups.remove(private, do_unlink=True)


def _raw_scalar(socket):
    return _raw_scalars((socket,))[0]


def _ownership():
    scene = bpy.context.scene
    return {'scene':scene.as_pointer(), 'frame':scene.frame_current, 'engine':scene.render.engine,
            'compositorDevice':getattr(scene.render,'compositor_device',None),'compositorPrecision':getattr(scene.render,'compositor_precision',None),
            'active':bpy.context.view_layer.objects.active.as_pointer() if bpy.context.view_layer.objects.active else None,
            'selected':sorted(obj.as_pointer() for obj in bpy.context.selected_objects),
            'sceneStates':sorted((item.as_pointer(),item.frame_current,item.frame_subframe,item.render.engine,
                                  getattr(item.render,'compositor_device',None),getattr(item.render,'compositor_precision',None))for item in bpy.data.scenes),
            'ids':{name:sorted((item.as_pointer(), item.name, item.users) for item in getattr(bpy.data,name))
                   for name in ['scenes','objects','meshes','node_groups','materials','collections','images']}}


class _Evaluator:
    def __init__(self, scene, select):
        if (tuple(bpy.app.version) != (5,3,0) or bpy.app.build_hash != b'02f0899d78e3'
                or sys.platform != 'darwin' or platform.machine() != 'arm64'
                or scene.render.compositor_device != 'CPU'):
            raise StaticMatrixUnsupported('Static Matrix has only its pinned Blender5.3 macOS arm64 CPU compositor profile')
        self.scene = scene
        self.scene_state = self.scene_signature()
        self.select = select
        self.resolved = {}
        self.recipes = []
        self.recipe_heights = []
        self.recipe_ids = {}
        self.resolution_frames = []
        self.active = set()
        self.nodes = set()
        self.members = {}
        self.results = {}
        self.visits = 0
        self.native_evaluations = 0
        self.source_reads = {}
        self.topology = {}
        self.selectors = []

    def scene_signature(self):
        scene=self.scene
        root=scene.compositing_node_group
        return (scene.as_pointer(),scene.frame_current,scene.frame_subframe,scene.render.engine,
                scene.render.compositor_device,scene.render.compositor_precision,root.as_pointer()if root else None)

    @staticmethod
    def signature(node):
        nested=getattr(node,'node_tree',None)
        return (node.bl_idname,node.name,node.id_data.as_pointer(),node.mute,
                nested.as_pointer() if nested else None,getattr(node,'is_active_output',None),
                tuple((socket.identifier,socket.type,socket.enabled,socket.is_unavailable,
                       tuple((link.from_node.as_pointer(),link.from_socket.identifier,link.is_valid,link.is_muted)for link in socket.links))for socket in node.inputs),
                tuple((link.from_socket.identifier,link.to_socket.identifier)for link in node.internal_links))

    def recipe(self,kind,*parts):
        # Child references are integer IDs, never recursive recipe tuples.
        # Hashing a Combine key visits its fixed16 IDs, regardless of DAG depth.
        if kind=='float':children=()
        elif kind=='combine':children=parts[0]
        elif kind in {'transpose','component'}:children=(parts[0],)
        else:raise StaticMatrixUnsupported('Static Matrix has an unknown flat recipe kind')
        height=1+max((self.recipe_heights[child]for child in children),default=-1)
        if height>MAX_DEPTH:
            raise StaticMatrixUnsupported('Static Matrix exceeds flat recipe depth16')
        key=(kind,)+parts
        if key not in self.recipe_ids:
            if len(self.recipes)>=2048:
                raise StaticMatrixUnsupported('Static Matrix exceeds2048 flat recipe records')
            self.recipe_ids[key]=len(self.recipes);self.recipes.append(key);self.recipe_heights.append(height)
        return self.recipe_ids[key]

    def observe(self,node,stack):
        _static(node)
        signature=self.signature(node)
        prior=self.topology.get(node.as_pointer())
        if prior is not None and prior[1]!=signature:
            raise StaticMatrixUnsupported('Static Matrix source graph changed during extraction')
        self.topology[node.as_pointer()]=(node,signature)
        self.nodes.add((node.as_pointer(),tuple(instance.as_pointer()for instance in stack)))
        if len(self.nodes)>MAX_NODES:
            raise StaticMatrixUnsupported('Static Matrix exceeds64 source node instances per extraction')

    def resolve(self, socket, stack=(), depth=0):
        if depth > MAX_DEPTH or len(stack)>MAX_DEPTH:
            raise StaticMatrixUnsupported('Static Matrix exceeds source depth16')
        node=socket.node
        owner=self.scene.compositing_node_group
        for index,instance in enumerate(stack):
            if instance.bl_idname!='CompositorNodeGroup'or instance.id_data!=owner or instance.node_tree is None:
                raise StaticMatrixUnsupported('Static Matrix source group ancestry/binding changed during extraction')
            self.observe(instance,stack[:index]);owner=instance.node_tree
        if node.id_data!=owner:
            raise StaticMatrixUnsupported('Static Matrix source is outside its authored compositor group ancestry')
        self.observe(node,stack)
        node_key=(node.as_pointer(),tuple(instance.as_pointer()for instance in stack))
        key=(node_key,socket.identifier,socket.is_output)
        if key in self.active:raise StaticMatrixUnsupported('Static Matrix has a reachable source cycle')
        def resolved(expression,height):
            # The cached record's entire transitive source height participates
            # at its new call site; a shallow earlier visit cannot erase cost.
            if depth+height>MAX_DEPTH:
                raise StaticMatrixUnsupported('Static Matrix exceeds source depth16 including cached subtree')
            if self.resolution_frames:
                parent=self.resolution_frames[-1];parent[0]=max(parent[0],height+1)
            return expression
        if key in self.resolved:return resolved(*self.resolved[key])
        self.visits+=1
        if self.visits>2048:raise StaticMatrixUnsupported('Static Matrix exceeds2048 source socket visits')
        self.active.add(key);frame=[0];self.resolution_frames.append(frame)
        try:
            result=self._resolve(socket,tuple(stack),depth)
            self.resolved[key]=(result,frame[0])
        finally:
            self.resolution_frames.pop();self.active.remove(key)
        return resolved(result,frame[0])

    def _resolve(self,socket,stack,depth):
        node=socket.node
        recurse=lambda incoming,frames=stack:self.resolve(incoming,frames,depth+1)
        if socket.type not in {'VALUE','MATRIX'}:
            raise StaticMatrixUnsupported('Static Matrix implicit/non-matrix typed conversion is unqualified')
        if not socket.is_output:
            links=[link for link in socket.links if link.is_valid and not link.is_muted]
            if len(links)>1:raise StaticMatrixUnsupported('Static Matrix has multiple live input links')
            if links:
                if links[0].from_socket.type!=socket.type:
                    raise StaticMatrixUnsupported('Static Matrix implicit socket conversion is unqualified')
                return recurse(links[0].from_socket)
            if socket.type=='MATRIX':
                raise StaticMatrixUnsupported('Static Matrix unlinked MATRIX defaults need separate context-equivalence proof')
            word=_raw_scalar(socket);self.source_reads[socket.as_pointer()]=(socket,word)
            return self.recipe('float',word)
        if node.mute:
            links=[link for link in node.internal_links if link.to_socket.identifier==socket.identifier]
            if len(links)!=1 or links[0].from_socket.type!=socket.type:
                raise StaticMatrixUnsupported('Static Matrix mute has no unique typed native bypass')
            return recurse(links[0].from_socket)
        kind=node.bl_idname
        if kind=='NodeReroute':return recurse(node.inputs[0])
        if kind=='NodeGroupInput':
            if not stack:raise StaticMatrixUnsupported('Static Matrix group input has no instance binding')
            return recurse(_active(stack[-1].inputs,socket.identifier,socket.type),stack[:-1])
        if kind=='CompositorNodeGroup':
            outputs=[item for item in node.node_tree.nodes if item.bl_idname=='NodeGroupOutput'and item.is_active_output]if node.node_tree else[]
            if len(outputs)!=1:raise StaticMatrixUnsupported('Static Matrix group needs one active output')
            return recurse(_active(outputs[0].inputs,socket.identifier,socket.type),stack+(node,))
        if kind in {'GeometryNodeSwitch','GeometryNodeIndexSwitch','GeometryNodeMenuSwitch'}:
            if self.select is None:raise StaticMatrixUnsupported('Static Matrix selector policy is unavailable')
            try:selected=self.select(node,socket,stack)
            except ValueError as error:raise StaticMatrixUnsupported('Static Matrix selector is unqualified: '+str(error))from error
            self.selectors.append((node,socket,stack,selected['input'].as_pointer() if selected['input'] is not None else None,selected['constant']))
            if selected['constant']is not None:raise StaticMatrixUnsupported('Static Matrix Boolean selector output cannot implicitly convert to Float')
            return recurse(selected['input'])
        if kind in {'ShaderNodeValue','CompositorNodeValue'}and socket.type=='VALUE'and socket.identifier=='Value':
            word=_raw_scalar(socket);self.source_reads[socket.as_pointer()]=(socket,word)
            return self.recipe('float',word)
        if kind not in NODES:raise StaticMatrixUnsupported('Static Matrix needs reviewed static copy-only producers; arithmetic, fields, context and unknown nodes refuse')
        self.members[(node.as_pointer(),tuple(instance.as_pointer()for instance in stack))]={'nodeType':kind,'node':node.name,'tree':node.id_data.name,'instances':[instance.name for instance in stack]}
        if kind=='FunctionNodeCombineMatrix':
            if socket.identifier!='Matrix'or socket.type!='MATRIX'or tuple(s.identifier for s in node.inputs)!=COLUMNS:
                raise StaticMatrixUnsupported('Static Matrix Combine schema changed')
            return self.recipe('combine',tuple(recurse(_active(node.inputs,name,'VALUE'))for name in COLUMNS))
        if kind=='FunctionNodeTransposeMatrix':
            if socket.identifier!='Matrix'or socket.type!='MATRIX'or len(node.inputs)!=1:
                raise StaticMatrixUnsupported('Static Matrix Transpose schema changed')
            return self.recipe('transpose',recurse(_active(node.inputs,'Matrix','MATRIX')))
        if socket.type!='VALUE'or socket.identifier not in COLUMNS or tuple(s.identifier for s in node.outputs)!=COLUMNS or len(node.inputs)!=1:
            raise StaticMatrixUnsupported('Static Matrix Separate schema changed')
        return self.recipe('component',recurse(_active(node.inputs,'Matrix','MATRIX')),COLUMNS.index(socket.identifier))

    def evaluate(self, expression):
        recipe=self.recipes[expression]
        if recipe[0]!='component':raise StaticMatrixUnsupported('Static Matrix requires a terminal Separate Matrix Float output')
        matrix,index=recipe[1:]
        if matrix not in self.results:
            if len(self.results)>=MAX_ISLANDS:raise StaticMatrixUnsupported('Static Matrix exceeds16 evaluated islands per extraction')
            # Re-read actual source storage before/after private evaluation so
            # handlers cannot silently change authored inputs behind the cache.
            self.check_sources()
            self.results[matrix]=self.native(matrix)
            self.check_sources();self.native_evaluations+=1
        self.check_sources()
        return self.results[matrix][index]

    def check_sources(self):
        try:
            if self.scene_signature()!=self.scene_state:raise StaticMatrixUnsupported('Static Matrix source scene/frame/CPU context changed during extraction')
            for node,signature in self.topology.values():
                _static(node)
                if self.signature(node)!=signature:raise StaticMatrixUnsupported('Static Matrix source graph changed during extraction')
            reads=tuple(self.source_reads.values())
            for socket,_ in reads:_static(socket.node)
            if _raw_scalars(socket for socket,_ in reads)!=tuple(word for _,word in reads):
                raise StaticMatrixUnsupported('Static Matrix source Float storage changed during extraction')
            for node,socket,stack,pointer,constant in self.selectors:
                try:selected=self.select(node,socket,stack)
                except ValueError as error:raise StaticMatrixUnsupported('Static Matrix selected source branch is no longer qualified')from error
                if(selected['input'].as_pointer()if selected['input']is not None else None)!=pointer or selected['constant']!=constant:
                    raise StaticMatrixUnsupported('Static Matrix selected source branch changed during extraction')
        except (ReferenceError,RuntimeError)as error:
            raise StaticMatrixUnsupported('Static Matrix source ownership changed during extraction')from error

    def native(self,matrix):
        before=_ownership();scene=mesh=obj=tree=None
        try:
            tag=uuid.uuid4().hex;scene=bpy.data.scenes.new('.SceneToWeb matrix '+tag)
            mesh=bpy.data.meshes.new('.SceneToWeb matrix point '+tag);mesh.from_pydata([(0,0,0)],[],[])
            obj=bpy.data.objects.new('.SceneToWeb matrix point '+tag,mesh);scene.collection.objects.link(obj)
            tree=bpy.data.node_groups.new('.SceneToWeb matrix MF '+tag,'GeometryNodeTree')
            tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
            tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
            entry=tree.nodes.new('NodeGroupInput');out=tree.nodes.new('NodeGroupOutput');built={};separated={}
            def separate(expr):
                if expr not in separated:
                    n=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(build(expr),_active(n.inputs,'Matrix','MATRIX'));separated[expr]=n
                return separated[expr]
            def build(expr):
                if expr in built:return built[expr]
                record=self.recipes[expr];kind=record[0]
                if kind=='combine':
                    n=tree.nodes.new('FunctionNodeCombineMatrix')
                    for label,scalar_id in zip(COLUMNS,record[1]):
                        scalar=self.recipes[scalar_id]
                        target=_active(n.inputs,label,'VALUE')
                        if scalar[0]=='float':target.default_value=_float(scalar[1])
                        elif scalar[0]=='component':tree.links.new(_active(separate(scalar[1]).outputs,COLUMNS[scalar[2]],'VALUE'),target)
                        else:raise StaticMatrixUnsupported('Static Matrix private graph has an unknown scalar recipe')
                elif kind=='transpose':
                    n=tree.nodes.new('FunctionNodeTransposeMatrix');tree.links.new(build(record[1]),_active(n.inputs,'Matrix','MATRIX'))
                else:raise StaticMatrixUnsupported('Static Matrix private graph has an unknown matrix recipe')
                built[expr]=_active(n.outputs,'Matrix','MATRIX');return built[expr]
            endpoint=separate(matrix);geometry=entry.outputs['Geometry']
            for index,label in enumerate(COLUMNS):
                store=tree.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type='FLOAT';store.domain='POINT';store.inputs['Name'].default_value='matrix_'+str(index);store.inputs['Selection'].default_value=True
                tree.links.new(geometry,store.inputs['Geometry']);tree.links.new(_active(endpoint.outputs,label,'VALUE'),_active(store.inputs,'Value','VALUE'));geometry=store.outputs['Geometry']
            if len(tree.nodes)>128:raise StaticMatrixUnsupported('Static Matrix private graph exceeds128 nodes')
            tree.links.new(geometry,out.inputs['Geometry']);modifier=obj.modifiers.new('.SceneToWeb matrix MF','NODES');modifier.node_group=tree
            with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
                evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());result=evaluated.to_mesh()
                try:
                    if len(result.vertices)!=1 or len(result.edges)or len(result.polygons):raise StaticMatrixUnsupported('Static Matrix private carrier topology changed')
                    words=[]
                    for index in range(16):
                        attribute=result.attributes['matrix_'+str(index)]
                        if attribute.data_type!='FLOAT'or attribute.domain!='POINT'or len(attribute.data)!=1:raise StaticMatrixUnsupported('Static Matrix raw output attribute schema changed')
                        raw=array('f',[0]);attribute.data.foreach_get('value',raw);word=struct.unpack('=I',raw.tobytes())[0]
                        if not _normal_word(word):raise StaticMatrixUnsupported('Static Matrix raw output left the normal-or-positive-zero copy domain')
                        words.append(word)
                finally:evaluated.to_mesh_clear()
        finally:
            if obj is not None:bpy.data.objects.remove(obj,do_unlink=True)
            if mesh is not None:bpy.data.meshes.remove(mesh)
            if tree is not None:bpy.data.node_groups.remove(tree)
            if scene is not None:bpy.data.scenes.remove(scene)
        if before!=_ownership():raise StaticMatrixUnsupported('Static Matrix private evaluation changed source/context ownership')
        return tuple(words)


def evaluate_output(socket, scene, cache, stack=(), select=None):
    """One extraction owns this cache; all16 endpoints share one native island."""
    evaluator=cache.get('evaluator')
    if evaluator is None:evaluator=cache.setdefault('evaluator',_Evaluator(scene,select))
    if evaluator.scene.as_pointer()!=scene.as_pointer():raise StaticMatrixUnsupported('Static Matrix cache cannot cross source scenes')
    expression=evaluator.resolve(socket,tuple(stack));word=evaluator.evaluate(expression)
    return {'value':_float(word),'word':word,'type':'VALUE','model':MODEL,'nativeVersion':list(bpy.app.version),
            'nativeBuild':bpy.app.build_hash.decode(),'sourceContext':'CPU compositor static copy-only Matrix island; private Geometry Nodes CPU-MF carrier',
            'matrixRuntimeTransport':False,'sources':list(evaluator.members.values()),'nativeEvaluations':evaluator.native_evaluations}
