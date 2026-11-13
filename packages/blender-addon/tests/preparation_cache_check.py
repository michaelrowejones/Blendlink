# SPDX-License-Identifier: MIT
"""Real exports reuse layout proofs but invalidate geometry and corrupt caches."""
import json
import hashlib
import sys
import tempfile
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blendlink/blender'))
import bakelib
import export_scene
import preparation_cache

bpy.ops.wm.read_factory_settings(use_empty=False)
recipe = {
    'schemaVersion': 1, 'presentation': 'hybrid',
    'atlases': [{'id': 'main', 'name': 'Main', 'size': 128, 'margin': 4,
                 'targetDensity': 8, 'fitPolicy': 'scale', 'bakeOutput': 'appearance'}],
    'preview': {'samples': 1, 'supersample': 1, 'denoise': False, 'resolutionScale': 1},
    'final': {'samples': 1, 'supersample': 1, 'denoise': False, 'resolutionScale': 1},
    'states': [{'name': 'default'}],
}
bpy.context.scene['blendlink_recipe'] = json.dumps(recipe)
calls = []
reports = []
pack = bakelib.pack_with_evaluated_uv_repair
def counted(*args, **kwargs):
    calls.append(1)
    return pack(*args, **kwargs)
bakelib.pack_with_evaluated_uv_repair = counted

with tempfile.TemporaryDirectory(prefix='blendlink-preparation-cache-') as directory:
    root = Path(directory)
    source = root / 'source.blend'
    cache = root / 'preparation.json'
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    def compile_scene(label, edit=lambda: None):
        bpy.ops.wm.open_mainfile(filepath=str(source))
        edit()
        calls.clear()
        settings = {'draft': True, 'preparationCachePath': str(cache)}
        (root / 'settings.json').write_text(json.dumps(settings))
        sys.argv = ['test', '--', str(root / (label + '.glb')), str(root / 'settings.json'), str(root / 'result.json')]
        export_scene.main()
        result = json.loads((root / 'result.json').read_text())
        assert result['ok'] and not result['plan']['errors']
        reports.append(result['baked']['fingerprints'])
        if label.startswith('pinned'):
            assert any(obj.get('pinned') for obj in result['plan']['objects'])
        return len(calls), result['plan']['atlasLayout']
    cold_calls, cold_uvs = compile_scene('cold')
    assert cold_calls > 0
    first_fingerprints = reports[-1]
    assert compile_scene('unchanged')[0] == 0
    assert reports[-1] == first_fingerprints, 'Cached preparation changed bake dependency identity'
    hot_calls, hot_uvs = compile_scene('light', lambda: setattr(bpy.data.objects['Light'].data, 'energy', 2000))
    assert hot_calls == 0, f'Lighting-only edit repacked {hot_calls} times'
    assert hot_uvs == cold_uvs, 'Cached layout changed packed UV evidence'
    assert reports[-1] != first_fingerprints, 'Lighting edit reused stale bake identity'
    assert cache.is_file()
    def change_material():
        material = bpy.data.objects['Cube'].data.materials[0]
        material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.2, .6, .1, 1)
    assert compile_scene('material', change_material)[0] == 0
    assert reports[-1] != first_fingerprints, 'Material edit reused stale bake identity'
    def change_samples():
        changed = json.loads(bpy.context.scene['blendlink_recipe'])
        changed['preview']['samples'] = 4
        changed['preview']['denoise'] = True
        bpy.context.scene['blendlink_recipe'] = json.dumps(changed)
    assert compile_scene('samples', change_samples)[0] == 0
    assert reports[-1] != first_fingerprints, 'Quality edit reused stale bake identity'
    def change_source_uv():
        for item in bpy.data.objects['Cube'].data.uv_layers[0].data:
            item.uv.x += .1
    assert compile_scene('source-uv', change_source_uv)[0] > 0
    def change_geometry():
        bpy.data.objects['Cube'].data.vertices[0].co.x += .2
    assert compile_scene('geometry', change_geometry)[0] > 0
    assert compile_scene('camera', lambda: setattr(bpy.data.objects['Camera'].location, 'x', 10))[0] > 0
    def change_padding():
        changed = json.loads(bpy.context.scene['blendlink_recipe'])
        changed['atlases'][0]['margin'] = 6
        bpy.context.scene['blendlink_recipe'] = json.dumps(changed)
    assert compile_scene('padding', change_padding)[0] > 0
    def change_supersample():
        changed = json.loads(bpy.context.scene['blendlink_recipe'])
        changed['preview']['supersample'] = 2
        bpy.context.scene['blendlink_recipe'] = json.dumps(changed)
    assert compile_scene('supersample', change_supersample)[0] > 0
    def pin_layout():
        mesh = bpy.data.objects['Cube'].data
        layer = mesh.uv_layers.new(name=bakelib.AUTHORED_UV)
        record = next(item for item in cold_uvs['objects'] if item['name'] == 'Cube')
        for loop, coordinates in zip(layer.data, bakelib._decode_packed_uv_record(record)):
            loop.uv = coordinates
        # Allocating the optional pin attribute inside this live UV iterator
        # invalidates its CustomData pointers in native Blender4.2.
        bakelib.set_uv_layer_pin_mask(layer, [True] * len(layer.data))
    assert compile_scene('pinned-cold', pin_layout)[0] > 0
    assert compile_scene('pinned-hot', pin_layout)[0] == 0
    compile_scene('restore')
    damaged = json.loads(cache.read_text())
    damaged['payload']['objects']['Cube']['uv'] = 'AAAA'
    cache.write_text(json.dumps(damaged))
    assert compile_scene('checksum')[0] > 0
    cache.write_text('{broken')
    recovered_calls, recovered_uvs = compile_scene('corrupt')
    assert recovered_calls > 0 and recovered_uvs == cold_uvs

    # A late corrupt record or a Blender write failure must leave every mesh
    # at its staged input state, including optional selection/pin attributes.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    meshes = []
    for index in range(2):
        bpy.ops.mesh.primitive_cube_add(location=(index * 3, 0, 0))
        meshes.append(bpy.context.object)
    bakelib.stage_atlas_layers(meshes)
    # Legacy proximity atlases use declaration order as assignment priority.
    # Generic dictionary hashing sorts keys, so order must be explicit here.
    first_order = {'atlases': {'near': {'maxCameraDistance': 3}, 'far': {'maxCameraDistance': 6}}}
    second_order = {'atlases': dict(reversed(list(first_order['atlases'].items())))}
    first_key = preparation_cache.fingerprint(meshes, first_order, 1, [], {})
    assert first_key != preparation_cache.fingerprint(meshes, second_order, 1, [], {})
    assert first_key != preparation_cache.fingerprint(list(reversed(meshes)), first_order, 1, [], {})
    layout = {'main': {'objects': meshes, 'size': 128, 'margin': 4, 'bakeOutput': 'appearance'},
              '_warnings': [], '_errors': [], '_authored': set(), '_lightmap_uv': {}}
    # Empty declared atlases and their order survive canonical JSON encoding.
    layout['aaa-empty'] = {'objects': [], 'size': 128, 'margin': 4, 'bakeOutput': 'appearance'}
    preparation_cache.store(cache, 'transaction', layout)
    valid = cache.read_bytes()
    for obj in meshes:
        obj.data.uv_layers[bakelib.ATLAS_UV].data[0].uv.x += .125
    def mesh_hashes():
        result = []
        for obj in meshes:
            digest = hashlib.sha256()
            bakelib._fingerprint_mesh(digest, obj.data, include_atlas=True)
            result.append(digest.hexdigest())
        return result
    before = mesh_hashes()
    damaged = json.loads(valid)
    damaged['payload']['objects'][meshes[-1].name]['pins'] = preparation_cache._pack(b'')
    damaged['sha256'] = hashlib.sha256(preparation_cache._json(damaged['payload'])).hexdigest()
    cache.write_text(json.dumps(damaged))
    assert preparation_cache.restore(cache, 'transaction', meshes) is None
    assert mesh_hashes() == before, 'Late corrupt record partially restored an earlier mesh'
    cache.write_bytes(valid)
    apply_booleans = preparation_cache._apply_booleans
    writes = []
    def fail_second_write(mesh, attributes):
        writes.append(mesh.name)
        if len(writes) == 2:
            raise RuntimeError('Injected Blender write failure')
        apply_booleans(mesh, attributes)
    preparation_cache._apply_booleans = fail_second_write
    try:
        try:
            preparation_cache.restore(cache, 'transaction', meshes)
            raise AssertionError('Injected write failure was not reached')
        except RuntimeError as error:
            assert str(error) == 'Injected Blender write failure'
    finally:
        preparation_cache._apply_booleans = apply_booleans
    assert mesh_hashes() == before, 'Blender write failure did not restore staged mesh state'
    restored = preparation_cache.restore(cache, 'transaction', meshes)
    assert [name for name in restored if not name.startswith('_')] == ['main', 'aaa-empty']
    assert mesh_hashes() != before
    layout['_errors'] = ['invalid layout']
    preparation_cache.store(cache, 'invalid', layout)
    assert cache.read_bytes() == valid, 'An invalid layout replaced a validated cache'
print('BLENDLINK_PREPARATION_CACHE_PASSED')
