# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded Blender 5.3 string constants feeding native scalar controls.

UTF-8 strings stay in the compiler. This is not a GPU/runtime string value.
"""
import platform
import sys
import hashlib
import json
from pathlib import Path

import bpy

if __package__:
    from .compositor_group_defaults_bridge import validate_input as _group_input, GroupDefaultUnsupported
else:
    from compositor_group_defaults_bridge import validate_input as _group_input, GroupDefaultUnsupported

MODEL = 'native-static-strings-53-v1'
NODES = {'FunctionNodeInputString', 'FunctionNodeInputSpecialCharacters',
         'FunctionNodeReverseString', 'FunctionNodeTrimString', 'FunctionNodeSliceString',
         'FunctionNodeReplaceString', 'FunctionNodeSetStringCase',
         'FunctionNodeStringLength', 'FunctionNodeFindInString', 'FunctionNodeMatchString',
         'FunctionNodeStringToValue', 'FunctionNodeValueToString'}
SCALAR_NODES = {'FunctionNodeStringLength', 'FunctionNodeFindInString', 'FunctionNodeMatchString', 'FunctionNodeStringToValue'}
MAX_BYTES = 4096
CASE_DATA_SHA256 = '8fb83c1d86ae27a49e80bdbdbb8dddc5b66f155dac196d71ea033f3410139360'
_CASE_MAPS = None


class StaticStringUnsupported(ValueError):
    pass


def _int32(value):
    if not isinstance(value, int) or isinstance(value, bool) or not -2147483648 <= value <= 2147483647:
        raise StaticStringUnsupported('Static string conversion requires a qualified native int32 producer')
    return value


def _active_socket(sockets, identifier, kind):
    matches = [item for item in sockets if item.identifier == identifier and item.type == kind
               and item.enabled and not item.is_unavailable]
    if len(matches) != 1:
        raise StaticStringUnsupported('Static integer string conversion active socket schema changed')
    return matches[0]


def _parse_int(source, base):
    # std::from_chars signed int: ASCII prefix, optional minus only, no
    # whitespace/plus or prefix inference. Blender maps every error to (0,0).
    if not 2 <= base <= 36:return 0, 0
    negative = source.startswith('-')
    start = 1 if negative else 0
    limit, value, cursor = (2147483648 if negative else 2147483647), 0, start
    for character in source[start:]:
        code = ord(character)
        digit = code - 48 if 48 <= code <= 57 else code - 65 + 10 if 65 <= code <= 90 else code - 97 + 10 if 97 <= code <= 122 else 36
        if digit >= base:break
        if value > (limit - digit) // base:return 0, 0
        value = value * base + digit;cursor += 1
    if cursor == start:return 0, 0
    return (-value if negative else value), cursor


def _format_int(value, base, padding):
    if not 2 <= base <= 36:return ''
    magnitude, digits = abs(value), ''
    while magnitude:
        magnitude, digit = divmod(magnitude, base)
        digits = '0123456789abcdefghijklmnopqrstuvwxyz'[digit] + digits
    digits = digits or '0'
    sign = '-' if value < 0 else ''
    width = max(len(sign) + len(digits), max(0, padding))
    if width > MAX_BYTES:
        raise StaticStringUnsupported('Static integer string Padding exceeds the 4096-byte output bound')
    return sign + '0' * (width - len(sign) - len(digits)) + digits


def _native_case(value, mode):
    global _CASE_MAPS
    if _CASE_MAPS is None:
        try:
            data = Path(__file__).with_name('static_string_case_data.json').read_bytes()
        except OSError as error:
            raise StaticStringUnsupported('Static string native case data is missing or unreadable') from error
        if hashlib.sha256(data).hexdigest() != CASE_DATA_SHA256:
            raise StaticStringUnsupported('Static string native case data differs from the reviewed source table')
        record = json.loads(data)
        if record.get('schemaVersion') != 1 or record.get('model') != 'blender-simple-unicode-case-53-v1':
            raise StaticStringUnsupported('Static string native case data has an unknown model')
        _CASE_MAPS = {key: {int(source): target for source, target in record[key].items()} for key in ['upper', 'lower']}
    return value.translate(_CASE_MAPS['upper' if mode == 'Uppercase' else 'lower'])


def _text(value):
    if not isinstance(value, str) or '\x00' in value:
        raise StaticStringUnsupported('Static string requires a native string without embedded NUL')
    try:
        size = len(value.encode('utf-8'))
    except UnicodeEncodeError as error:
        raise StaticStringUnsupported('Static string requires valid Unicode scalar values') from error
    if size > MAX_BYTES:
        raise StaticStringUnsupported('Static string exceeds the 4096-byte UTF-8 bound')
    return value


def _static(node):
    animation = getattr(node.id_data, 'animation_data', None)
    if animation and (animation.action or len(animation.drivers) or len(animation.nla_tracks)):
        raise StaticStringUnsupported('Static string cannot substitute a current frame for animation, drivers or NLA')


def _matching(items, socket):
    return next((item for item in items if item.identifier == socket.identifier), None)


def _evaluate(socket, stack, budget, seen, trace, depth=0):
    budget[0] -= 1
    if budget[0] < 0 or depth > 16:
        raise StaticStringUnsupported('Static string exceeds 128 visits or depth16')
    node = socket.node
    _static(node)
    key = (node.as_pointer(), socket.identifier, socket.is_output, tuple(item.as_pointer() for item in stack))
    if key in seen:
        raise StaticStringUnsupported('Static string has a reachable cycle')
    seen = seen + (key,)
    resolve = lambda incoming, frames=stack: _evaluate(incoming, frames, budget, seen, trace, depth + 1)
    if not socket.is_output:
        try:
            _group_input(socket)
        except GroupDefaultUnsupported as error:
            raise StaticStringUnsupported(str(error)) from error
        links = [link for link in socket.links if link.is_valid and not getattr(link, 'is_muted', False)]
        if len(links) > 1:
            raise StaticStringUnsupported('Static string has multiple live links')
        if links:
            if links[0].from_socket.type != socket.type:
                raise StaticStringUnsupported('Static string implicit conversion is unqualified')
            return resolve(links[0].from_socket)
        value = getattr(socket, 'default_value', None)
        if socket.type in {'STRING', 'MENU'}:
            return _text(value)
        if socket.type == 'INT' and isinstance(value, int) and not isinstance(value, bool) and -2147483648 <= value <= 2147483647:
            return value
        if socket.type == 'BOOLEAN' and isinstance(value, bool):
            return value
        raise StaticStringUnsupported('Static string input has no qualified typed constant')
    if node.mute:
        links = [link for link in node.internal_links if link.to_socket == socket]
        if len(links) != 1:
            raise StaticStringUnsupported('Static string muted output has no unique bypass')
        return resolve(links[0].from_socket)
    kind = node.bl_idname
    if kind == 'NodeReroute':
        return resolve(node.inputs[0])
    if kind == 'NodeGroupInput':
        target = _matching(stack[-1].inputs, socket) if stack else None
        if target is None:
            raise StaticStringUnsupported('Static string group input has no instance binding')
        return resolve(target, stack[:-1])
    if kind in {'ShaderNodeGroup', 'CompositorNodeGroup'}:
        outputs = [item for item in node.node_tree.nodes if item.bl_idname == 'NodeGroupOutput' and item.is_active_output] if node.node_tree else []
        target = _matching(outputs[0].inputs, socket) if len(outputs) == 1 else None
        if target is None:
            raise StaticStringUnsupported('Static string group needs one active output and matching identifier')
        return resolve(target, stack + (node,))
    if kind == 'FunctionNodeInputInt' and socket.type == 'INT' and socket.identifier == 'Integer':
        return int(node.integer)
    if kind == 'FunctionNodeInputBool' and socket.type == 'BOOLEAN' and socket.identifier == 'Boolean':
        return bool(node.boolean)
    if kind == 'FunctionNodeInputMenu' and socket.type == 'MENU' and socket.identifier == 'Menu':
        return _text(node.value)
    if kind not in NODES:
        raise StaticStringUnsupported('Static string needs a qualified fixed producer; fields and computed numeric inputs remain unqualified')
    incoming = lambda name: resolve(node.inputs[name])
    text = lambda name: _text(incoming(name))
    if kind in {'FunctionNodeStringToValue', 'FunctionNodeValueToString'}:
        if node.data_type != 'INT':
            raise StaticStringUnsupported('Static string numeric FLOAT mode is unqualified; exact INT mode only')
        expected_type = 'INT' if kind == 'FunctionNodeStringToValue' else 'STRING'
        if _active_socket(node.outputs, socket.identifier, expected_type) != socket:
            raise StaticStringUnsupported('Static integer string conversion output schema changed')
        integer = lambda name: _int32(resolve(_active_socket(node.inputs, name, 'INT')))
        base = integer('Base')
        if kind == 'FunctionNodeStringToValue':
            if socket.identifier not in {'Value', 'Length'}:
                raise StaticStringUnsupported('Static integer parser output schema changed')
            parsed, consumed = _parse_int(_text(resolve(_active_socket(node.inputs, 'String', 'STRING'))), base)
            value = parsed if socket.identifier == 'Value' else consumed
        else:
            if socket.identifier != 'String':
                raise StaticStringUnsupported('Static integer formatter output schema changed')
            value = _text(_format_int(integer('Value'), base, integer('Padding')))
    elif kind == 'FunctionNodeInputString' and socket.type == 'STRING' and socket.identifier == 'String':
        value = _text(node.string)
    elif kind == 'FunctionNodeInputSpecialCharacters' and socket.type == 'STRING' and socket.identifier in {'Line Break', 'Tab'}:
        value = '\n' if socket.identifier == 'Line Break' else '\t'
    elif kind in {'FunctionNodeReverseString', 'FunctionNodeTrimString', 'FunctionNodeSliceString', 'FunctionNodeReplaceString', 'FunctionNodeSetStringCase'} and socket.type == 'STRING' and socket.identifier == 'String':
        source = text('String')
        if kind == 'FunctionNodeReverseString':
            value = source[::-1]
        elif kind == 'FunctionNodeTrimString':
            characters = text('Characters')
            whitespace, start, end = (incoming(name) for name in ['Whitespace', 'Start', 'End'])
            if any(not isinstance(item, bool) for item in [whitespace, start, end]):
                raise StaticStringUnsupported('Static string Trim needs native Boolean flags')
            characters += ' \t\n\r' if whitespace else ''
            value = source.lstrip(characters) if start and characters else source
            value = value.rstrip(characters) if end and characters else value
        elif kind == 'FunctionNodeSliceString':
            position, length = incoming('Position'), incoming('Length')
            if any(not isinstance(item, int) or isinstance(item, bool) for item in [position, length]) or not -2147483648 <= position + length <= 2147483647:
                raise StaticStringUnsupported('Static string Slice needs defined int32 position-plus-length arithmetic')
            value = source[max(0, position):max(0, position + length)]
        elif kind == 'FunctionNodeReplaceString':
            find, replace = text('Find'), text('Replace')
            if find and len(source.encode('utf-8')) + source.count(find) * (len(replace.encode('utf-8')) - len(find.encode('utf-8'))) > MAX_BYTES:
                raise StaticStringUnsupported('Static string replacement exceeds the output UTF-8 bound')
            value = source.replace(find, replace) if find else source
        else:
            mode = incoming('Case')
            if mode not in {'Uppercase', 'Lowercase'}:
                raise StaticStringUnsupported('Static string Case requires a fixed native Uppercase/Lowercase menu')
            value = _native_case(source, mode)
        value = _text(value)
    elif kind == 'FunctionNodeMatchString' and socket.type == 'BOOLEAN' and socket.identifier == 'Result':
        # Native StringRef operations compare UTF-8 bytes, without casing or
        # normalization. Both strings already passed valid-scalar/NUL/size gates.
        source, key, mode = text('String').encode('utf-8'), text('Key').encode('utf-8'), incoming('Operation')
        if mode == 'Starts With':
            value = source.startswith(key)
        elif mode == 'Ends With':
            value = source.endswith(key)
        elif mode == 'Contains':
            value = source.find(key) != -1
        else:
            raise StaticStringUnsupported('Static string Match needs a fixed native Starts With/Ends With/Contains menu')
    elif kind == 'FunctionNodeStringLength' and socket.type == 'INT' and socket.identifier == 'Length':
        value = len(text('String'))
    elif kind == 'FunctionNodeFindInString' and socket.type == 'INT' and socket.identifier in {'First Found', 'Count'}:
        source, search, mode = text('String'), text('Search'), incoming('Mode')
        if mode not in {'From Start', 'From End'}:
            raise StaticStringUnsupported('Static string Find needs a fixed native From Start/From End menu')
        if not source or not search:
            value = 0
        elif socket.identifier == 'Count':
            value = source.count(search)
        else:
            position = source.rfind(search) if mode == 'From End' else source.find(search)
            # Native npos becomes a negative UTF-8 scan bound. The measured
            # native no-match position is zero; Count disambiguates it.
            value = 0 if position < 0 else position
    else:
        raise StaticStringUnsupported('Static string output schema changed')
    trace.append({'nodeType': kind, 'output': socket.identifier})
    return value


def evaluate_output(socket, stack=()):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        raise StaticStringUnsupported('Static string has no measured source version/build/platform profile')
    trace = []
    value = _evaluate(socket, tuple(stack), [128], (), trace)
    return {'value': value, 'type': socket.type, 'model': MODEL, 'sources': trace}


def evaluate_input(socket, stack=()):
    return evaluate_output(socket, stack)
