# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned CPU-compositor White Noise with explicitly stored fixed float words.

This resolves copy-only input bindings, never evaluates an artist node tree or
folds a native MF/hash. Raw RNA is copied before Python float promotion.
"""
from array import array
import platform
import struct
import sys
import bpy
if __package__:
    from . import compositor_group_defaults as group_defaults
else:
    import compositor_group_defaults as group_defaults

MODEL = 'native-compositor-white-noise-fixed-cpu-53-v1'
PROFILE = 'darwin-arm64-53-white-noise-cpu-v1'


class WhiteNoiseUnsupported(ValueError):
    pass


def _normal(word):
    absolute = word & 0x7fffffff
    return word != 0x80000000 and (absolute == 0 or 0x00800000 <= absolute < 0x7f800000)


def _active(sockets, identifier, kind):
    matches = [socket for socket in sockets if socket.identifier == identifier and socket.type == kind
               and socket.enabled and not socket.is_unavailable]
    if len(matches) != 1:
        raise WhiteNoiseUnsupported('White Noise fixed input active socket schema changed: '+identifier+'/'+kind)
    return matches[0]


def _static(node):
    if node.id_data.bl_idname != 'CompositorNodeTree':
        raise WhiteNoiseUnsupported('White Noise fixed source must belong to a compositor tree')
    animation = node.id_data.animation_data
    if animation and (animation.action or len(animation.drivers) or len(animation.nla_tracks)):
        raise WhiteNoiseUnsupported('White Noise fixed inputs refuse animation, drivers and NLA')


def _group_default(socket):
    """An unlinked group input can be an implicit image field, not its RNA value."""
    node = socket.node
    group = node.node_tree
    if group is None or group.bl_idname != 'CompositorNodeTree':
        raise WhiteNoiseUnsupported('White Noise fixed group default has no native compositor interface')
    items = group.interface.items_tree
    if len(items) > 256:
        raise WhiteNoiseUnsupported('White Noise fixed group interface exceeds 256 items')
    matches = [item for item in items if item.item_type == 'SOCKET' and item.in_out == 'INPUT'
               and item.identifier == socket.identifier]
    expected = {'VALUE': 'NodeSocketFloat', 'VECTOR': 'NodeSocketVector'}.get(socket.type)
    if len(matches) != 1 or expected is None or matches[0].socket_type != expected:
        raise WhiteNoiseUnsupported('White Noise fixed group default identifier/type does not match its native INPUT interface')
    interface = matches[0]
    if getattr(interface, 'default_input', None) != 'VALUE' or getattr(interface, 'structure_type', None) not in {'AUTO', 'SINGLE'}:
        raise WhiteNoiseUnsupported('White Noise fixed group defaults require VALUE input and AUTO/SINGLE structure; implicit coordinates/frame/unknown structures are unqualified')


def _raw(sockets, kind):
    """Copy native socket words into homogeneous RNA storage, with owned IDs."""
    if not sockets:
        return []
    width = 1 if kind == 'VALUE' else 3
    if kind == 'VECTOR' and any(len(socket.default_value) != 3 for socket in sockets):
        raise WhiteNoiseUnsupported('White Noise fixed Vector sources require native float3 width; Float2 casts are unqualified')
    private = owner = None
    try:
        private = bpy.data.node_groups.new('.SceneToWeb White Noise raw copy', 'CompositorNodeTree')
        for socket in sockets:
            interface = private.interface.new_socket(name='Seed', in_out='INPUT',
                socket_type='NodeSocketFloat' if width == 1 else 'NodeSocketVector')
            interface.from_socket(socket.node, socket)
        owner = bpy.data.node_groups.new('.SceneToWeb White Noise raw owner', 'CompositorNodeTree')
        instance = owner.nodes.new('CompositorNodeGroup'); instance.node_tree = private
        if len(instance.inputs) != len(sockets) or any(socket.type != kind for socket in instance.inputs):
            raise WhiteNoiseUnsupported('White Noise raw socket copy schema changed')
        raw = array('f', [0]) * (len(sockets) * width)
        instance.inputs.foreach_get('default_value', raw)
        words = struct.unpack('='+str(len(raw))+'I', raw.tobytes())
        if not all(_normal(word) for word in words):
            raise WhiteNoiseUnsupported('White Noise requires raw normal Float32 or positive-zero seeds; negative zero/subnormal/nonfinite source words refuse before promotion')
        return [words[index:index+width] for index in range(0, len(words), width)]
    finally:
        if owner is not None: bpy.data.node_groups.remove(owner, do_unlink=True)
        if private is not None: bpy.data.node_groups.remove(private, do_unlink=True)


def fixed_inputs(sockets, stack=()):
    """Bounded copy-only source walk; group bindings are native identifiers."""
    leaves = {'VALUE': [], 'VECTOR': []}
    leaf_ids = {}
    members = {}
    active = set()
    visits = 0

    def record(node):
        _static(node)
        members[node.as_pointer()] = {'node': node.name, 'nodeType': node.bl_idname, 'tree': node.id_data.name}
        if len(members) > 64:
            raise WhiteNoiseUnsupported('White Noise fixed input source exceeds 64 nodes')

    def ancestry(frames, tree):
        if len(frames) > 16:
            raise WhiteNoiseUnsupported('White Noise fixed group ancestry exceeds 16 source hops')
        for index, instance in enumerate(frames):
            record(instance)
            if (instance.bl_idname != 'CompositorNodeGroup' or instance.node_tree is None
                    or (index and instance.id_data != frames[index-1].node_tree)):
                raise WhiteNoiseUnsupported('White Noise fixed group ancestry/binding changed')
        if frames and tree != frames[-1].node_tree:
            raise WhiteNoiseUnsupported('White Noise fixed source is outside its group instance')
        pointers = [frame.id_data.as_pointer() for frame in frames] + [tree.as_pointer()]
        if len(pointers) != len(set(pointers)):
            raise WhiteNoiseUnsupported('White Noise fixed inputs refuse recursive groups')

    def leaf(socket, kind):
        key = (socket.as_pointer(), kind)
        if key not in leaf_ids:
            leaf_ids[key] = (kind, len(leaves[kind]))
            leaves[kind].append(socket)
        return leaf_ids[key]

    def resolve(socket, kind, frames, output=False, depth=0):
        nonlocal visits
        visits += 1
        if visits > 256 or depth > 16:
            raise WhiteNoiseUnsupported('White Noise fixed input source exceeds 256 visits or 16 source hops')
        node = socket.node
        record(node); ancestry(frames, node.id_data)
        if socket.type != kind or not socket.enabled or socket.is_unavailable:
            raise WhiteNoiseUnsupported('White Noise fixed inputs refuse implicit casts and inactive sockets')
        key = (socket.as_pointer(), tuple(frame.as_pointer() for frame in frames), output)
        if key in active:
            raise WhiteNoiseUnsupported('White Noise fixed input source contains a cycle')
        active.add(key)
        try:
            if not output:
                try:group_defaults.validate_input(socket)
                except group_defaults.GroupDefaultUnsupported as error:raise WhiteNoiseUnsupported("White Noise fixed group input: "+str(error)) from error
                links = [link for link in socket.links if link.is_valid and not link.is_muted]
                if len(links) > 1:
                    raise WhiteNoiseUnsupported('White Noise fixed inputs refuse multiple links')
                if links:
                    return resolve(links[0].from_socket, kind, frames, True, depth+1)
                if node.bl_idname == 'CompositorNodeGroup':
                    _group_default(socket)
                return leaf(socket, kind)
            if node.mute:
                links = [link for link in node.internal_links if link.to_socket == socket]
                if len(links) != 1:
                    raise WhiteNoiseUnsupported('White Noise muted source has no unique bypass')
                return resolve(links[0].from_socket, kind, frames, False, depth+1)
            if node.bl_idname == 'NodeReroute':
                return resolve(node.inputs[0], kind, frames, False, depth+1)
            if node.bl_idname == 'NodeGroupInput':
                if not frames:
                    raise WhiteNoiseUnsupported('White Noise root inputs have no fixed scene binding')
                return resolve(_active(frames[-1].inputs, socket.identifier, kind), kind, frames[:-1], False, depth+1)
            if node.bl_idname == 'CompositorNodeGroup':
                if node.node_tree is None:
                    raise WhiteNoiseUnsupported('White Noise group source is missing')
                sinks = [item for item in node.node_tree.nodes if item.bl_idname == 'NodeGroupOutput' and item.is_active_output]
                if len(sinks) != 1:
                    raise WhiteNoiseUnsupported('White Noise group needs one active output')
                return resolve(_active(sinks[0].inputs, socket.identifier, kind), kind, frames+(node,), False, depth+1)
            if kind == 'VALUE' and node.bl_idname in {'ShaderNodeValue', 'CompositorNodeValue'} and socket.identifier == 'Value':
                return leaf(socket, kind)
            if kind == 'VECTOR' and node.bl_idname == 'ShaderNodeCombineXYZ' and socket.identifier == 'Vector':
                return tuple(resolve(_active(node.inputs, axis, 'VALUE'), 'VALUE', frames, False, depth+1) for axis in 'XYZ')
            raise WhiteNoiseUnsupported('White Noise requires explicit fixed Float/Vector defaults, Value, CombineXYZ, groups or reroutes; computed/field producers are unqualified')
        finally:
            active.remove(key)

    recipes = [resolve(socket, socket.type, tuple(stack)) for socket in sockets]
    raw = {kind: _raw(values, kind) for kind, values in leaves.items()}

    def materialize(recipe):
        if len(recipe) == 2 and isinstance(recipe[0], str):
            words = raw[recipe[0]][recipe[1]]
            values = [struct.unpack('=f', struct.pack('=I', word))[0] for word in words]
            return values[0] if recipe[0] == 'VALUE' else values
        return [materialize(part) for part in recipe]
    return [materialize(recipe) for recipe in recipes], list(members.values())


def normalize_white_noise(node, socket, op, scene, stack, fail):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'
            or scene.render.compositor_device != 'CPU'):
        fail(socket, 'White Noise requires its pinned Blender 5.3 macOS arm64 CPU compositor source profile')
    dimensions = str(node.noise_dimensions)
    if dimensions not in {'1D', '2D', '3D', '4D'} or socket.identifier not in {'Value', 'Color'} or socket.type != ('VALUE' if socket.identifier == 'Value' else 'RGBA'):
        fail(socket, 'White Noise dimensions/output schema is unqualified')
    names = ([] if dimensions == '1D' else ['Vector']) + (['W'] if dimensions in {'1D', '4D'} else [])
    try:
        incoming = [_active(node.inputs, name, 'VECTOR' if name == 'Vector' else 'VALUE') for name in names]
        if 'Vector' in names and not any(link.is_valid and not link.is_muted for link in incoming[0].links):
            raise WhiteNoiseUnsupported('White Noise implicit Uniform Image Coordinates are unqualified; Vector must be explicitly linked')
        values, members = fixed_inputs(incoming, stack)
    except WhiteNoiseUnsupported as error:
        fail(socket, str(error))
    for name, source, value in zip(names, incoming, values):
        op['inputs'][name] = {'name': name, 'socketType': source.type,
            'value': {'kind': 'constant', 'type': source.type, 'value': value}}
    op['properties'].update(white_noise_model=MODEL, white_noise_profile=PROFILE,
        white_noise_version=list(bpy.app.version), white_noise_build=bpy.app.build_hash.decode(),
        white_noise_evaluator='CPU-MF', noise_dimensions=int(dimensions[0]), white_noise_fixed_sources=members)
