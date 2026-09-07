# SPDX-License-Identifier: MIT
"""Local cache of successful atlas preparation, keyed by exact staged inputs.

Only the disposable exporter scene is mutated. Cached proofs never substitute
for matching evaluated mesh data, source UVs, pins or layout settings. Cache
files are optional acceleration, separate from published runtime assets.
"""
import base64
import hashlib
import json
import os
import sys
import tempfile
import zlib
from array import array
from pathlib import Path

import bpy
import bakelib


def fingerprint(meshes, bake, supersample, cameras, weights):
    digest = hashlib.sha256()
    # Samples, denoise and lighting visibility affect pixels, not atlas layout.
    settings = {key: value for key, value in bake.items()
                if key not in {'samples', 'denoise', 'states'}}
    bakelib._fingerprint_value(digest, (
        'prepared-atlas-v2', bpy.app.version_string, bpy.app.build_hash, settings, supersample,
        cameras, weights, list(bake.get('atlases', {})), [obj.name for obj in meshes],
    ))
    # Include the shared addon helpers as well as the Blender export modules.
    directories = {Path(bakelib.__file__).resolve().parent}
    for name in ('material_compiler', 'procedural'):
        module = sys.modules.get(name)
        if module and getattr(module, '__file__', None):
            directories.add(Path(module.__file__).resolve().parent)
    for directory in sorted(directories):
        for path in sorted(directory.glob('*.py')):
            digest.update(path.name.encode())
            digest.update(path.read_bytes())
    for obj in sorted(meshes, key=lambda item: item.name):
        bakelib._fingerprint_value(digest, (obj.name, obj.matrix_world, obj.get('blendlink_atlas')))
        bakelib._fingerprint_mesh(digest, obj.data, include_atlas=True)
        for layer in obj.data.uv_layers:
            bakelib._fingerprint_value(digest, (layer.name, layer.active_render))
            digest.update(bytes(bakelib._uv_layer_pin_mask(layer)))
    return digest.hexdigest()


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf8')


def _uv_bytes(layer):
    values = array('f', [0]) * (len(layer.data) * 2)
    layer.data.foreach_get('uv', values)
    if sys.byteorder != 'little':
        values.byteswap()
    return values.tobytes()


def _pack(raw):
    return base64.b64encode(zlib.compress(raw, level=6)).decode('ascii')


def _unpack(value, expected):
    stream = zlib.decompressobj()
    raw = stream.decompress(base64.b64decode(value, validate=True), expected + 1)
    if len(raw) != expected or not stream.eof or stream.unused_data or stream.unconsumed_tail:
        raise ValueError('Cached UV buffer has an invalid length or compressed stream')
    return raw


def _apply(layer, coordinates, pins):
    layer.data.foreach_set('uv', coordinates)
    modern = getattr(layer, 'pin', None)
    if modern is not None:
        if len(modern) == 0 and any(pins):
            layer.data[0].pin_uv = True  # Allocate Blender's optional pin attribute.
        if len(layer.pin):
            layer.pin.foreach_set('value', pins)
    else:
        for item, pin in zip(layer.data, pins):
            item.pin_uv = bool(pin)


def _boolean_attributes(mesh):
    # Packing also changes selection attributes. Preserve their exact roster:
    # even an absent optional pin attribute differs from an all-false one in
    # the conservative bake dependency fingerprint.
    result = {}
    for attribute in mesh.attributes:
        if attribute.data_type == 'BOOLEAN':
            values = array('b', [0]) * len(attribute.data)
            attribute.data.foreach_get('value', values)
            result[attribute.name] = (attribute.domain, values)
    return result


def _apply_booleans(mesh, attributes):
    for name in [item.name for item in mesh.attributes
                 if item.data_type == 'BOOLEAN' and item.name not in attributes]:
        mesh.attributes.remove(mesh.attributes[name])
    for name, (domain, values) in attributes.items():
        attribute = mesh.attributes.get(name)
        if attribute is None:
            attribute = mesh.attributes.new(name=name, type='BOOLEAN', domain=domain)
        attribute.data.foreach_set('value', values)


def restore(path, key, meshes):
    """Return the restored layout or None. Corruption cannot partially apply."""
    try:
        envelope = json.loads(Path(path).read_text(encoding='utf8'))
        payload = envelope['payload']
        if payload['version'] != 2 or payload['key'] != key:
            return None
        if hashlib.sha256(_json(payload)).hexdigest() != envelope['sha256']:
            return None
        objects = {obj.name: obj for obj in meshes}
        records = payload['objects']
        if set(records) != set(objects):
            return None
        targets = []
        for name, obj in objects.items():
            layer = obj.data.uv_layers.get(bakelib.ATLAS_UV)
            count = len(obj.data.loops)
            if layer is None or records[name]['loops'] != count:
                return None
            values = array('f')
            values.frombytes(_unpack(records[name]['uv'], count * 8))
            if sys.byteorder != 'little':
                values.byteswap()
            pins = array('b', _unpack(records[name]['pins'], count))
            if any(pin not in (0, 1) for pin in pins):
                return None
            domains = {'POINT': len(obj.data.vertices), 'EDGE': len(obj.data.edges),
                       'FACE': len(obj.data.polygons), 'CORNER': count}
            attributes = {}
            for attr_name, record in records[name]['booleans'].items():
                domain = record['domain']
                data = array('b', _unpack(record['values'], domains[domain]))
                existing = obj.data.attributes.get(attr_name)
                if any(value not in (0, 1) for value in data) or (existing is not None and (
                        existing.data_type != 'BOOLEAN' or existing.domain != domain)):
                    return None
                attributes[attr_name] = (domain, data)
            targets.append((name, obj, values, pins, attributes))
        metadata = payload['layout']
        layout = {
            '_warnings': metadata['warnings'], '_errors': [],
            '_authored': set(metadata['authored']), '_held': {},
            '_lightmap_uv': metadata['lightmapUv'],
        }
        assigned = []
        group_order = metadata['groupOrder']
        if len(group_order) != len(set(group_order)) or set(group_order) != set(metadata['groups']):
            return None
        for name in group_order:
            group = metadata['groups'][name]
            if name.startswith('_'):
                return None
            assigned.extend(group['objects'])
            layout[name] = {**group, 'objects': [objects[item] for item in group['objects']]}
        if sorted(assigned) != sorted(objects):
            return None
    except (OSError, ValueError, KeyError, TypeError, AttributeError, zlib.error):
        return None

    # All payloads and membership are checked before the first write. Roll back
    # even an unexpected Blender write error so a fallback starts from inputs.
    originals = []
    for _name, obj, _values, _pins, _attributes in targets:
        layer = obj.data.uv_layers[bakelib.ATLAS_UV]
        values = array('f')
        values.frombytes(_uv_bytes(layer))
        if sys.byteorder != 'little':
            values.byteswap()
        originals.append((obj, values, array('b', bakelib._uv_layer_pin_mask(layer)),
                          _boolean_attributes(obj.data)))
    try:
        for name, obj, values, pins, attributes in targets:
            _apply(obj.data.uv_layers[bakelib.ATLAS_UV], values, pins)
            _apply_booleans(obj.data, attributes)
            if any(pins):
                layout['_held'][name] = [bool(pin) for pin in pins]
    except Exception:
        for obj, values, pins, attributes in originals:
            _apply(obj.data.uv_layers[bakelib.ATLAS_UV], values, pins)
            _apply_booleans(obj.data, attributes)
        raise
    for name, group in layout.items():
        if not name.startswith('_'):
            for obj in group['objects']:
                obj['blendlink_atlas'] = name
    return layout


def store(path, key, layout):
    """Atomically retain only successful preparation; an I/O miss costs time."""
    if layout.get('_errors'):
        return
    groups = {name: {**group, 'objects': [obj.name for obj in group['objects']]}
              for name, group in layout.items() if not name.startswith('_')}
    objects = {}
    for name, group in layout.items():
        if name.startswith('_'):
            continue
        for obj in group['objects']:
            layer = obj.data.uv_layers[bakelib.ATLAS_UV]
            objects[obj.name] = {
                'loops': len(layer.data), 'uv': _pack(_uv_bytes(layer)),
                'pins': _pack(bytes(bakelib._uv_layer_pin_mask(layer))),
                'booleans': {name: {'domain': domain, 'values': _pack(values.tobytes())}
                             for name, (domain, values) in _boolean_attributes(obj.data).items()},
            }
    payload = {
        'version': 2, 'key': key, 'objects': objects,
        'layout': {'groups': groups, 'groupOrder': list(groups), 'warnings': layout['_warnings'],
                   'authored': sorted(layout['_authored']), 'lightmapUv': layout['_lightmap_uv']},
    }
    envelope = {'payload': payload, 'sha256': hashlib.sha256(_json(payload)).hexdigest()}
    temporary = None
    try:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='wb', dir=destination.parent, delete=False) as handle:
            temporary = handle.name
            handle.write(_json(envelope))
        os.replace(temporary, destination)
    except OSError as error:
        print(f'blendlink: could not retain atlas preparation cache: {error}')
    finally:
        if temporary and os.path.exists(temporary):
            try:
                os.unlink(temporary)
            except OSError:
                pass
