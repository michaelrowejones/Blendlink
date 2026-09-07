# SPDX-License-Identifier: MIT
"""Attribute edits invalidate bake hashes without per-element RNA inspection."""
import hashlib
import sys
import time
from array import array
from pathlib import Path
from types import SimpleNamespace

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blendlink/blender'))
import bakelib

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new('Attribute hash regression')
mesh.from_pydata([(float(i), 0, 0) for i in range(12000)], [],
                 [(i, i + 1, i + 2) for i in range(0, 12000, 3)])
specs = [
    ('FLOAT', 'value', 1, 'f'), ('INT', 'value', 1, 'i'),
    ('BOOLEAN', 'value', 1, 'b'), ('FLOAT_VECTOR', 'vector', 3, 'f'),
    ('FLOAT2', 'vector', 2, 'f'), ('BYTE_COLOR', 'color', 4, 'f'),
    ('FLOAT_COLOR', 'color', 4, 'f'), ('INT8', 'value', 1, 'i'),
    ('QUATERNION', 'value', 4, 'f'), ('FLOAT4X4', 'value', 16, 'f'),
]
for kind, _, _, _ in specs:
    mesh.attributes.new('test_' + kind, kind, 'POINT')

def fingerprint():
    digest = hashlib.sha256()
    bakelib._fingerprint_mesh(digest, mesh, include_atlas=True)
    return digest.hexdigest()

calls = []
scalar = bakelib._fingerprint_rna_scalars
def counted(*args, **kwargs):
    calls.append(1)
    return scalar(*args, **kwargs)
bakelib._fingerprint_rna_scalars = counted
started = time.perf_counter()
baseline = fingerprint()
elapsed = time.perf_counter() - started
bakelib._fingerprint_rna_scalars = scalar
print('BLENDLINK_ATTRIBUTE_HASH_TIMING', elapsed, 'scalar_inspections', len(calls), flush=True)
assert not calls, f'Numeric mesh attributes caused {len(calls)} per-element RNA inspections'

# Mutate the last component too: a truncated buffer must not pass this check.
for kind, key, width, code in specs:
    attribute = mesh.attributes['test_' + kind]
    original = array(code, [0]) * (len(attribute.data) * width)
    attribute.data.foreach_get(key, original)
    changed = array(code, original)
    changed[-1] = (0.375 if code == 'f' else 1) if original[-1] == 0 else 0
    attribute.data.foreach_set(key, changed)
    assert fingerprint() != baseline, f'{kind} edit did not invalidate the mesh'
    attribute.data.foreach_set(key, original)
    assert fingerprint() == baseline, f'{kind} restoration changed the hash'

# Strings need the conservative scalar path, including variable-length bytes.
mesh.attributes.new('words', 'STRING', 'POINT')
before = fingerprint()
mesh.attributes['words'].data[-1].value = b'changed shader input'
assert fingerprint() != before, 'String attribute edit was omitted'

# Unsupported bulk access must retain the scalar evidence, including edits.
class UnsupportedBulk:
    def __init__(self, data):
        self.data = data
    def __len__(self):
        return len(self.data)
    def __getitem__(self, index):
        return self.data[index]
    def foreach_get(self, *_):
        raise TypeError('No bulk reader for this property')

attribute = mesh.attributes['test_FLOAT']
def fallback_hash():
    digest = hashlib.sha256()
    bakelib._fingerprint_mesh_attribute(digest, SimpleNamespace(data=UnsupportedBulk(attribute.data)))
    return digest.hexdigest()
before = fallback_hash()
attribute.data[-1].value = .123
assert fallback_hash() != before, 'Unsupported bulk reader lost scalar evidence'
bpy.data.meshes.remove(mesh)
print('BLENDLINK_ATTRIBUTE_FINGERPRINT_PASSED')
