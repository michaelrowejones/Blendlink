# SPDX-License-Identifier: GPL-3.0-or-later
"""Controlled original-scene display capture; never a numerical parity gate.

blender --background --factory-startup --disable-autoexec ORIGINAL.blend \
  --python-exit-code 1 --python native-reference.py -- SCENE_ID NEW_DIRECTORY
"""
import datetime
import hashlib
import json
from pathlib import Path
import sys
import time

import bpy
import gpu

args = sys.argv[sys.argv.index('--') + 1:]
if len(args) != 2:
    raise ValueError('Expected SCENE_ID NEW_DIRECTORY')
scene_id, directory_arg = args
corpus = json.loads((Path(__file__).resolve().parents[2] / 'docs/release-scene-corpus.json').read_text())
record = next(row for row in corpus['scenes'] if row['id'] == scene_id)
source = Path(bpy.data.filepath)
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert digest(source) == record['source']['sha256'], 'Original source pin mismatch'
assert bpy.app.version_string == record['inventoryBlender']['version']
assert bpy.app.build_hash.decode() == record['inventoryBlender']['buildHash']
directory = Path(directory_arg).resolve()
directory.mkdir()
producer = Path(__file__).read_bytes()
(directory / 'producer.py').write_bytes(producer)
scene = bpy.context.scene


def settings():
    camera = scene.camera
    return {'engine': scene.render.engine, 'frame': scene.frame_current,
            'resolution': [scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage],
            'pixelAspect': [scene.render.pixel_aspect_x, scene.render.pixel_aspect_y],
            'camera': camera.name if camera else None, 'mode': bpy.context.mode,
            'cameraDof': {'enabled': camera.data.dof.use_dof, 'fstop': camera.data.dof.aperture_fstop,
                          'focusDistance': camera.data.dof.focus_distance,
                          'focusObject': camera.data.dof.focus_object.name if camera.data.dof.focus_object else None} if camera else None,
            'eeveeSamples': getattr(getattr(scene, 'eevee', None), 'taa_render_samples', None)}


report = {'schemaVersion': 1, 'role': 'Controlled original-scene PNG display reference for visual triage; no frozen fidelity pass gate',
          'sourceSha256': record['source']['sha256'], 'scene': scene_id,
          'producerSha256': hashlib.sha256(producer).hexdigest(),
          'native': {'version': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode()},
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'before': settings(), 'supportCredit': 0, 'sceneAcceptance': False,
          'saveCalls': 0, 'renderAttempts': 0, 'completedRenders': 0, 'status': 'PREPARING'}
try:
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = str(directory / 'native.png')
    report['referenceSettings'] = settings()
    report['renderAttempts'] = 1
    report['status'] = 'RENDERING'
    (directory / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    start = time.monotonic()
    bpy.ops.render.render(write_still=True)
    report.update(renderWallSeconds=time.monotonic() - start, completedRenders=1,
                  imageSha256=digest(directory / 'native.png'), backend=gpu.platform.backend_type_get(),
                  status='RENDERED_NOT_FIDELITY_QUALIFIED')
except BaseException as error:
    report.update(status='FAILED', failure=str(error))
    raise
finally:
    report['sourceUnchanged'] = digest(source) == record['source']['sha256']
    report['completedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (directory / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
assert report['sourceUnchanged']
print('SCENETOWEB_NATIVE_REFERENCE_CAPTURED ' + json.dumps(report), flush=True)
