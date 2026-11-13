# SPDX-License-Identifier: GPL-3.0-or-later
"""Same-process backend attestation for the unchanged native camera fixture."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import bpy
import gpu

root = Path(__file__).resolve().parents[2]
fixture = root / 'packages/blender-addon/tests/camera_data_check.py'
directory = Path(os.environ['BLENDLINK_CAMERA_DATA_REFERENCES'])
directory.mkdir(parents=True, exist_ok=True)
requested = os.environ.get('BLENDLINK_CAMERA_DATA_NATIVE_BACKEND') or None
record = {'schemaVersion': 1, 'model': 'blendlink-camera-data-native-backend-v1',
          'completed': False, 'requested': requested, 'version': list(bpy.app.version),
          'blenderHash': bpy.app.build_hash.decode(),
          'fixtureSha256': hashlib.sha256(fixture.read_bytes()).hexdigest(),
          'wrapperSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}

def platform():
    return {'backend': gpu.platform.backend_type_get(), 'renderer': gpu.platform.renderer_get(),
            'vendor': gpu.platform.vendor_get()}

try:
    if requested is not None:
        if requested not in {'OPENGL', 'METAL'}:
            raise ValueError('Unknown requested Camera Data native backend ' + requested)
        bpy.context.preferences.system.gpu_backend = requested
    legacy_api = bpy.app.version == (4, 2, 0) and not callable(getattr(gpu, 'init', None))
    if legacy_api:
        # Actual 4.2 background platform queries raise, and gpu.init does not
        # exist. Keep numeric source/Final proof, never infer actual backend
        # from the preference that selected the render engine.
        record.update(backendAttestation='SOURCE_ATTESTATION_NA', initializationApi='unavailable',
            before=None, after=None,
            limitation='Blender 4.2.0 background GPU initialization/platform attestation API unavailable')
    else:
        gpu.init()
        record.update(backendAttestation='VERIFIED_NATIVE_BACKEND', initializationApi='gpu.init')
        record['before'] = platform()
        if requested is not None and record['before']['backend'] != requested:
            raise RuntimeError('Camera Data requested ' + requested + ', initialized ' + record['before']['backend'])
    runpy.run_path(str(fixture), run_name='__main__')
    if not legacy_api:
        record['after'] = platform()
        if record['before']['backend'] != record['after']['backend']:
            raise RuntimeError('Camera Data native GPU backend changed during the oracle')
    reference = directory / 'native-reference.json'
    record['nativeReferenceSha256'] = hashlib.sha256(reference.read_bytes()).hexdigest()
    record['completed'] = True
except BaseException as error:
    record['error'] = str(error)
    raise
finally:
    (directory / 'native-backend.json').write_text(json.dumps(record, indent=2) + '\n')
if record['completed']:
    marker = 'BLENDLINK_CAMERA_DATA_NATIVE_BACKEND_NA' if legacy_api else 'BLENDLINK_CAMERA_DATA_NATIVE_BACKEND_PASSED'
    print(marker + ' ' + json.dumps(record))
