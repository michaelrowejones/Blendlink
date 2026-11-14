# SPDX-License-Identifier: GPL-3.0-or-later
"""Blender 5.3 compile-time selection; only the selected branch is a dependency."""
import bpy

MODEL = 'native-static-selection-53-v1'
NODES = {'GeometryNodeSwitch', 'GeometryNodeIndexSwitch', 'GeometryNodeMenuSwitch'}
MENU_SOURCES = {'FunctionNodeInputMenu'}
TYPES = {'FLOAT': 'VALUE', 'INT': 'INT', 'BOOLEAN': 'BOOLEAN', 'VECTOR': 'VECTOR', 'RGBA': 'RGBA'}


class SelectionUnsupported(ValueError):
    pass


def _static(node):
    owner = node.id_data
    animation = getattr(owner, 'animation_data', None)
    if animation and (animation.action or len(animation.drivers) or len(animation.nla_tracks)):
        raise SelectionUnsupported('Static selection cannot substitute the current frame for node-tree animation or drivers')


def _matching(items, reference):
    return next((item for item in items if item.identifier == reference.identifier), None)


def _literal(socket, stack, budget, seen=(), depth=0):
    budget[0] -= 1
    if budget[0] < 0 or depth > 16:
        raise SelectionUnsupported('Static selector exceeds its bounded traversal')
    _static(socket.node)
    key = (socket.node.as_pointer(), socket.identifier, socket.is_output, tuple(item.as_pointer() for item in stack))
    if key in seen:
        raise SelectionUnsupported('Static selector has a reachable cycle')
    seen = seen + (key,)
    if socket.is_output:
        node = socket.node
        if node.mute:
            links = [link for link in node.internal_links if link.to_socket == socket]
            if len(links) != 1:
                raise SelectionUnsupported('Muted selector has no unique native bypass')
            return _literal(links[0].from_socket, stack, budget, seen, depth + 1)
        if node.bl_idname == 'FunctionNodeInputBool' and socket.identifier == 'Boolean' and socket.type == 'BOOLEAN':
            return bool(node.boolean)
        if node.bl_idname == 'FunctionNodeInputInt' and socket.identifier == 'Integer' and socket.type == 'INT':
            return int(node.integer)
        if node.bl_idname in {'FunctionNodeStringLength', 'FunctionNodeFindInString', 'FunctionNodeMatchString'} and socket.type in {'INT', 'BOOLEAN'}:
            if __package__:
                from .static_strings import evaluate_output, StaticStringUnsupported
            else:
                from static_strings import evaluate_output, StaticStringUnsupported
            try:
                return evaluate_output(socket, stack)['value']
            except StaticStringUnsupported as error:
                raise SelectionUnsupported(str(error)) from error
        if node.bl_idname in MENU_SOURCES and socket.identifier == 'Menu' and socket.type == 'MENU':
            # Native Input Menu stores its constant on the node, independently
            # of the output socket default. RNA resolves its label through the
            # enum propagated from the actual connected menu consumer.
            value = node.value
            if isinstance(value, str) and value:
                return value
            raise SelectionUnsupported('Menu source needs a resolved, nonconflicting native menu choice')
        if node.bl_idname == 'FunctionNodeBooleanMath' and socket.type == 'BOOLEAN':
            active = [item for item in node.inputs if item.enabled and not item.is_unavailable]
            values = [_literal(item, stack, budget, seen, depth + 1) for item in active]
            if any(not isinstance(value, bool) for value in values):
                raise SelectionUnsupported('Boolean selector math requires actual Boolean constants')
            a, b = values[0], values[1] if len(values) > 1 else False
            operations = {'AND': a and b, 'OR': a or b, 'NOT': not a, 'XOR': a != b,
                          'XNOR': a == b, 'NAND': not (a and b), 'NOR': not (a or b),
                          'IMPLY': (not a) or b, 'NIMPLY': a and not b}
            if node.operation not in operations:
                raise SelectionUnsupported('Unmeasured Boolean selector operation')
            return operations[node.operation]
        if node.bl_idname == 'NodeReroute':
            return _literal(node.inputs[0], stack, budget, seen, depth + 1)
        if node.bl_idname == 'NodeGroupInput':
            if not stack:
                raise SelectionUnsupported('Root group selector has no scene binding')
            target = _matching(stack[-1].inputs, socket)
            if target is None:
                raise SelectionUnsupported('Group selector identifier has no instance binding')
            return _literal(target, stack[:-1], budget, seen, depth + 1)
        if node.bl_idname in {'ShaderNodeGroup', 'CompositorNodeGroup'}:
            if node.node_tree is None:
                raise SelectionUnsupported('Selector group has no node tree')
            _static(node)
            outputs = [item for item in node.node_tree.nodes if item.bl_idname == 'NodeGroupOutput' and item.is_active_output]
            if len(outputs) != 1:
                raise SelectionUnsupported('Selector group has no unique active output')
            target = _matching(outputs[0].inputs, socket)
            if target is None:
                raise SelectionUnsupported('Selector group output identifier is missing')
            return _literal(target, stack + (node,), budget, seen, depth + 1)
        if node.bl_idname in NODES:
            selected = _selection(node, socket, stack, budget, seen, depth + 1)
            if selected['constant'] is not None:
                return selected['constant']
            return _literal(selected['input'], stack, budget, seen, depth + 1)
        raise SelectionUnsupported('Selector must be a fixed typed literal/group value or proven Boolean Math; fields and implicit conversions are unqualified')
    links = [link for link in socket.links if link.is_valid and not getattr(link, 'is_muted', False)]
    if len(links) > 1:
        raise SelectionUnsupported('Selector has multiple live links')
    if links:
        if links[0].from_socket.type != socket.type:
            raise SelectionUnsupported('Selector implicit conversion is not qualified')
        return _literal(links[0].from_socket, stack, budget, seen, depth + 1)
    value = getattr(socket, 'default_value', None)
    if socket.type == 'BOOLEAN' and isinstance(value, bool):
        return value
    if socket.type == 'INT' and isinstance(value, int) and not isinstance(value, bool) and -2147483648 <= value <= 2147483647:
        return value
    if socket.type == 'MENU' and isinstance(value, str):
        return value
    raise SelectionUnsupported('Selector has no supported typed literal')


def _selection(node, output, stack, budget, seen=(), depth=0):
    if tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3':
        raise SelectionUnsupported('Static selection has no verified native version/build profile')
    _static(node)
    if node.bl_idname not in NODES:
        raise SelectionUnsupported('Unknown static selection class')
    declared = node.input_type if node.bl_idname == 'GeometryNodeSwitch' else node.data_type
    expected = TYPES.get(declared)
    if expected is None:
        raise SelectionUnsupported('Static selection data type is not qualified: ' + declared)
    actual = [item for item in node.inputs if item.identifier != '__extend__']
    if len(actual) > 33:
        raise SelectionUnsupported('Static selection exceeds 32 authored branches')
    if not actual or not node.outputs or node.outputs[0].identifier != 'Output' or node.outputs[0].type != expected:
        raise SelectionUnsupported('Static selection has an unmeasured socket schema')
    selector = actual[0]
    value = _literal(selector, stack, budget, seen, depth + 1)
    constant = None
    if node.bl_idname == 'GeometryNodeSwitch':
        if selector.identifier != 'Switch' or selector.type != 'BOOLEAN' or not isinstance(value, bool) or len(actual) != 3:
            raise SelectionUnsupported('Switch requires its Boolean/False/True schema')
        index = 1 if value else 0
        if [item.identifier for item in actual[1:]] != ['False', 'True']:
            raise SelectionUnsupported('Switch branch identifiers changed')
    elif node.bl_idname == 'GeometryNodeIndexSwitch':
        if selector.identifier != 'Index' or selector.type != 'INT' or not isinstance(value, int) or isinstance(value, bool):
            raise SelectionUnsupported('Index Switch requires a fixed Integer selector')
        if len(actual) != len(node.index_switch_items) + 1 or not 0 <= value < len(actual) - 1:
            raise SelectionUnsupported('Index Switch index is outside the authored item list')
        index = value
    else:
        if selector.identifier != 'Menu' or selector.type != 'MENU' or not isinstance(value, str):
            raise SelectionUnsupported('Menu Switch requires a fixed native menu label')
        names = [item.name for item in node.enum_items]
        if len(names) != len(set(names)) or len(actual) != len(names) + 1 or names.count(value) != 1:
            raise SelectionUnsupported('Menu Switch label is absent, ambiguous, or has an unmeasured item schema')
        index = names.index(value)
        if output != node.outputs[0]:
            masks = [item for item in node.outputs[1:] if item.identifier == output.identifier and item.type == 'BOOLEAN']
            if len(masks) != 1 or output.identifier not in [item.identifier for item in actual[1:]]:
                raise SelectionUnsupported('Menu Switch has an unmeasured mask output')
            constant = output.identifier == actual[index + 1].identifier
    if output != node.outputs[0] and constant is None:
        raise SelectionUnsupported('Static selection has an unqualified output')
    if any(item.type != expected for item in actual[1:]):
        raise SelectionUnsupported('Static selection branch socket types changed')
    selected = actual[index + 1]
    return {'input': selected, 'constant': constant, 'selector': value,
            'metadata': {'model': MODEL, 'nodeType': node.bl_idname, 'dataType': declared,
                         'selectorType': selector.type, 'selector': value, 'selectedIndex': index,
                         'selectedSocket': selected.identifier, 'output': output.identifier}}


def static_selection(node, output, stack=()):
    return _selection(node, output, tuple(stack), [128])
