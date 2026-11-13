# SPDX-License-Identifier: GPL-3.0-or-later
"""Read native availability/schema; no Blendlink translation or runtime shim."""
import hashlib
import json
import os
from pathlib import Path
import platform
import bpy

OUTPUT = Path(os.environ['BLENDLINK_RADIAL_OUTPUT']).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def value(item):
    if isinstance(item, (str, int, float, bool)) or item is None:
        return item
    return list(item)


def socket_schema(socket):
    prop = socket.bl_rna.properties.get('default_value')
    return {
        'identifier': socket.identifier,
        'name': socket.name,
        'type': socket.bl_rna.identifier,
        'default': value(socket.default_value) if hasattr(socket, 'default_value') else None,
        'enabled': socket.enabled,
        'hideValue': socket.hide_value,
        'rna': {key: getattr(prop, key) for key in ['hard_min', 'hard_max', 'soft_min', 'soft_max', 'array_length'] if prop and hasattr(prop, key)},
    }


records = []
for kind in ['ShaderNodeTree', 'GeometryNodeTree', 'CompositorNodeTree']:
    tree = bpy.data.node_groups.new('Radial schema ' + kind, kind)
    try:
        node = tree.nodes.new('ShaderNodeRadialTiling')
    except RuntimeError as error:
        records.append({'context': kind, 'available': False, 'reason': str(error)})
        bpy.data.node_groups.remove(tree)
        continue
    row = {'context': kind, 'available': True, 'inputs': [socket_schema(s) for s in node.inputs], 'outputs': [socket_schema(s) for s in node.outputs], 'normalize': node.normalize}
    row['assignments'] = []
    for name, values in [('Sides', [-8, 0, 1.5, 2, 2.5, 1001]), ('Roundness', [-1, 0, .5, 1, 2])]:
        original = node.inputs[name].default_value
        for assigned in values:
            node.inputs[name].default_value = assigned
            row['assignments'].append({'input': name, 'assigned': assigned, 'stored': node.inputs[name].default_value})
        node.inputs[name].default_value = original
    records.append(row)
    tree.use_fake_user = True

source = OUTPUT / 'schema.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(source))
bpy.ops.wm.open_mainfile(filepath=str(source))
for row in records:
    if row['available']:
        tree = bpy.data.node_groups['Radial schema ' + row['context']]
        node = next(n for n in tree.nodes if n.bl_idname == 'ShaderNodeRadialTiling')
        row['savedReloaded'] = {'inputs': [socket_schema(s) for s in node.inputs], 'outputs': [socket_schema(s) for s in node.outputs], 'normalize': node.normalize}
        assert row['savedReloaded']['inputs'] == row['inputs']
        assert row['savedReloaded']['outputs'] == row['outputs']
        assert row['savedReloaded']['normalize'] == row['normalize']

result = {'version': list(bpy.app.version), 'buildHash': bpy.app.build_hash.decode(), 'platform': platform.system(), 'machine': platform.machine(), 'records': records, 'blendSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'fixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'proofRole': 'ACTUAL_NATIVE_SCHEMA_AND_PERSISTENCE_ONLY', 'numericalCases': 0}
(OUTPUT / 'schema.json').write_text(json.dumps(result, indent=2) + '\n')
print('BLENDLINK_RADIAL_SCHEMA', json.dumps(result))
