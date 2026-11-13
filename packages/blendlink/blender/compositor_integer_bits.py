# SPDX-License-Identifier: GPL-3.0-or-later
"""Measured signed-int32 compositor Bit Math and INT Hash Value admission."""
import platform
import sys
import bpy

MODEL = 'native-compositor-integer-bits-v1'
PROFILE = 'darwin-arm64-compositor-integer-bits-v1'
MODES = {'AND': ['A', 'B'], 'OR': ['A', 'B'], 'XOR': ['A', 'B'], 'NOT': ['A'], 'SHIFT': ['A', 'Shift'], 'ROTATE': ['A', 'Shift']}

def integer_literal_tree(ref, operations):
    if len(operations) > 2048: return False
    by_id = {op['id']: op for op in operations}
    budget = 64
    def visit(value, depth=0):
        nonlocal budget
        budget -= 1
        if budget < 0 or depth > 8 or not isinstance(value, dict) or value.get('type') != 'INT': return False
        if value.get('kind') == 'constant':
            raw = value.get('value')
            return isinstance(raw, int) and not isinstance(raw, bool) and -2147483648 <= raw <= 2147483647
        source = by_id.get(value.get('node')) if value.get('kind') == 'ref' else None
        if not source: return False
        if source.get('kind') == 'utility-constant' and source.get('type') == 'INT' and source.get('source', {}).get('nodeType') == 'FunctionNodeInputInt' and source.get('inputs') == {}:
            return visit({'kind': 'constant', 'type': 'INT', 'value': source.get('value')}, depth+1)
        if source.get('kind') in {'bit-math', 'hash-value'} and source.get('properties', {}).get('integer_bits_model') == MODEL:
            return all(visit(item.get('value'), depth+1) for item in source.get('inputs', {}).values())
        return False
    return visit(ref)

def normalize_integer_bits(node, socket, op, read, operations, fail):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        fail(socket, 'Integer Bits requires the measured Blender 5.3.0 macOS arm64 compositor profile')
    hash_node = node.bl_idname == 'FunctionNodeHashValue'
    if socket.identifier != ('Hash' if hash_node else 'Value') or socket.type != 'INT':
        fail(socket, 'Integer Bits requires the native INT output schema')
    if hash_node:
        if node.data_type != 'INT': fail(socket, 'Hash Value currently qualifies INT only; other type hash contracts require separate proofs')
        names = ['Value', 'Seed']
        op['properties']['data_type'] = 'INT'
    else:
        if node.operation not in MODES: fail(socket, 'Bit Math operation has no measured kernel')
        names = MODES[node.operation]
        op['properties']['operation'] = node.operation
    active = [incoming for incoming in node.inputs if incoming.enabled and not getattr(incoming, 'is_unavailable', False)]
    if [incoming.identifier for incoming in active] != names: fail(socket, 'Integer Bits native active input schema changed')
    for incoming in active:
        value = read(incoming)
        if incoming.type != 'INT' or not integer_literal_tree(value, operations):
            fail(incoming, 'Integer Bits requires typed int32 literals/InputInt/group defaults or qualified Integer Bits chains; implicit conversions and fields require separate proofs')
        op['inputs'][incoming.identifier] = {'name': incoming.name, 'socketType': 'INT', 'value': value}
    op['properties'].update(integer_bits_model=MODEL, integer_bits_profile=PROFILE, integer_bits_version=list(bpy.app.version))
