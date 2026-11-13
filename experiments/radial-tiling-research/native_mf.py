# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual evaluated Radial Tiling MultiFunction; no reimplemented kernel."""
import hashlib
import json
import os
from pathlib import Path
import platform
import bpy
import numpy as np

OUTPUT = Path(os.environ['BLENDLINK_RADIAL_OUTPUT']).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
assert bpy.app.version in [(5, 2, 0), (5, 3, 0)]


def points():
    rows = [[0, 0, 0], [-0.0, 0, 0], [0, -0.0, 0], [-0.0, -0.0, 0]]
    for x in [-2, -1, -.5, -2**-20, 0, 2**-20, .5, 1, 2]:
        for y in [-2, -1, -.5, -2**-20, 0, 2**-20, .5, 1, 2]:
            rows.append([x, y, 0])
    # Independent polar points around all regular and irregular sector dividers.
    for sides in [2, 2.5, 3, 5, 5.5, 8]:
        for k in range(int(np.ceil(sides)) + 1):
            angle = np.float32(2 * np.pi * k / sides)
            for a in [np.nextafter(angle, np.float32(-np.inf)), angle, np.nextafter(angle, np.float32(np.inf))]:
                for radius in [.125, 1, 2]:
                    rows.append([float(np.float32(np.cos(a) * radius)), float(np.float32(np.sin(a) * radius)), 0])
    return np.asarray(rows, dtype=np.float32)


def fingerprint(tree, mesh):
    data = {'nodes': [], 'links': [], 'attributes': {}}
    for node in tree.nodes:
        row = [node.name, node.bl_idname, {}]
        for name in ['data_type', 'domain', 'normalize']:
            if hasattr(node, name):
                row[2][name] = getattr(node, name)
        for socket in list(node.inputs) + list(node.outputs):
            if hasattr(socket, 'default_value'):
                value = socket.default_value
                if not isinstance(value, (str, float, int, bool)) and value is not None:
                    try:
                        value = list(value)
                    except TypeError:
                        value = [value.bl_rna.identifier, value.name_full]
                row.append([socket.identifier, value])
        data['nodes'].append(row)
    data['links'] = [(l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier) for l in tree.links]
    for attr in mesh.attributes:
        if attr.name.startswith('source'):
            a = np.empty(len(mesh.vertices) * (3 if attr.data_type == 'FLOAT_VECTOR' else 1), dtype=np.float32)
            attr.data.foreach_get('vector' if attr.data_type == 'FLOAT_VECTOR' else 'value', a)
            data['attributes'][attr.name] = hashlib.sha256(a.tobytes()).hexdigest()
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


coordinates = points()
mesh = bpy.data.meshes.new('Native MF radial point samples')
mesh.from_pydata(coordinates.tolist(), [], [])
owner = bpy.data.objects.new(mesh.name, mesh)
bpy.context.scene.collection.objects.link(owner)
attribute = mesh.attributes.new('source-coordinate', 'FLOAT_VECTOR', 'POINT')
attribute.data.foreach_set('vector', coordinates.ravel())
tree = bpy.data.node_groups.new('Actual Radial Tiling MF evaluation', 'GeometryNodeTree')
tree.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
tree.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
incoming = tree.nodes.new('NodeGroupInput')
outgoing = tree.nodes.new('NodeGroupOutput')
radial = tree.nodes.new('ShaderNodeRadialTiling')
source = tree.nodes.new('GeometryNodeInputNamedAttribute')
source.data_type = 'FLOAT_VECTOR'
source.inputs['Name'].default_value = attribute.name
geometry = incoming.outputs['Geometry']
outputs = ['Segment Coordinates', 'Segment ID', 'Segment Width', 'Segment Rotation']
for i, name in enumerate(outputs):
    store = tree.nodes.new('GeometryNodeStoreNamedAttribute')
    store.data_type = 'FLOAT_VECTOR' if i == 0 else 'FLOAT'
    store.domain = 'POINT'
    store.inputs['Name'].default_value = 'radial-' + str(i)
    tree.links.new(geometry, store.inputs['Geometry'])
    tree.links.new(radial.outputs[name], store.inputs['Value'])
    geometry = store.outputs['Geometry']
tree.links.new(geometry, outgoing.inputs['Geometry'])
modifier = owner.modifiers.new('Actual MF field evaluator', 'NODES')
modifier.node_group = tree

cases = []
for normalize in [False, True]:
    for sides, roundness in [(5, 0), (5, .25), (5, .5), (5, 1), (2, 0), (2, .5), (2, 1), (2.5, 0), (2.5, .5), (2.5, 1), (5.5, .5), (5.5, 1), (-1, -.5), (1000, 1)]:
        cases.append({'id': f'field-s{sides}-r{roundness}-n{int(normalize)}', 'sides': sides, 'roundness': roundness, 'normalize': normalize, 'stage': 'field'})
    for coord in [(0, 0), (.173, -.375), (-1, -1), (1, 0), (1, -0.0), (-1, 0), (-1, -0.0)]:
        cases.append({'id': f'literal-{coord[0]}-{coord[1]}-n{int(normalize)}', 'coordinate': coord, 'sides': 5, 'roundness': 0, 'normalize': normalize, 'stage': 'literal'})

records = []
for case in cases:
    radial.normalize = case['normalize']
    radial.inputs['Sides'].default_value = case['sides']
    radial.inputs['Roundness'].default_value = case['roundness']
    for link in list(radial.inputs['Vector'].links):
        tree.links.remove(link)
    if case['stage'] == 'field':
        tree.links.new(source.outputs['Attribute'], radial.inputs['Vector'])
    else:
        radial.inputs['Vector'].default_value = case['coordinate']
    before = fingerprint(tree, mesh)
    owner.update_tag()
    tree.update_tag()
    bpy.context.view_layer.update()
    evaluated = owner.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    data = []
    for i in range(4):
        a = np.empty(len(coordinates) * (3 if i == 0 else 1), dtype=np.float32)
        evaluated.attributes['radial-' + str(i)].data.foreach_get('vector' if i == 0 else 'value', a)
        data.append(a.reshape(-1, 3) if i == 0 else a[:, None])
    result = np.concatenate(data, axis=1)
    assert before == fingerprint(tree, mesh), case['id']
    file = case['id'] + '.f32'
    payload = result.astype('<f4').tobytes()
    (OUTPUT / file).write_bytes(payload)
    finite = result[np.isfinite(result)]
    records.append({**case, 'file': file, 'sha256': hashlib.sha256(payload).hexdigest(), 'sourceFingerprint': before, 'shape': list(result.shape), 'nonfinite': int(np.count_nonzero(~np.isfinite(result))), 'minimum': float(finite.min()), 'maximum': float(finite.max()), 'firstRow': result[0].tolist()})

input_bytes = coordinates.astype('<f4').tobytes()
(OUTPUT / 'coordinates.f32').write_bytes(input_bytes)
source_file = OUTPUT / 'native-mf.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(source_file))
result = {'version': list(bpy.app.version), 'buildHash': bpy.app.build_hash.decode(), 'platform': platform.system(), 'machine': platform.machine(), 'proofRole': 'ACTUAL_NATIVE_MULTIFUNCTION_GEOMETRY_ATTRIBUTE_READBACK', 'noShaderCarrier': True, 'channels': ['Segment Coordinates X', 'Segment Coordinates Y', 'Segment Coordinates Z', 'Segment ID', 'Segment Width', 'Segment Rotation'], 'coordinates': {'file': 'coordinates.f32', 'sha256': hashlib.sha256(input_bytes).hexdigest(), 'shape': list(coordinates.shape)}, 'cases': records, 'fixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'blendSha256': hashlib.sha256(source_file.read_bytes()).hexdigest(), 'sourcePreserved': True}
(OUTPUT / 'index.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
print('BLENDLINK_RADIAL_MF_CAPTURED', len(records), 'cases,', len(coordinates), 'samples each')
