# SPDX-License-Identifier: GPL-3.0-or-later
"""Original-scene DOF-off control: one render, no saves, unchanged source bytes.

Run only in the coordinated GPU slot:
blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
  ORIGINAL.blend --python native-dof-off.py -- NEW_OUTPUT_DIRECTORY
"""
import datetime
import hashlib
import json
from pathlib import Path
import sys
import time

import bpy

out = Path(sys.argv[sys.argv.index('--')+1]).resolve()
out.mkdir()
sha = lambda data: hashlib.sha256(data).hexdigest()
producer = Path(__file__).read_bytes()
(out/'producer.py').write_bytes(producer)
source = Path(bpy.data.filepath)
source_hash = sha(source.read_bytes())
assert source_hash == '6785c3b4c5b50e2eab7b088914f6558b90aa3dad9cd105ef57d2973495c7b69c'
assert bpy.app.version_string == '5.3.0' and bpy.app.build_hash.decode() == '02f0899d78e3'
reference_path = Path('/tmp/scenetoweb-impact-native-reference-r2/report.json')
reference_bytes = reference_path.read_bytes()
reference = json.loads(reference_bytes)
assert reference['sourceSha256'] == source_hash
assert reference['imageSha256'] == sha((reference_path.parent/'native.png').read_bytes())
scene = bpy.context.scene
camera = scene.camera
assert scene.frame_current == 0 and scene.render.engine == 'BLENDER_EEVEE'
assert scene.eevee.taa_render_samples == 64 and camera.data.dof.use_dof
assert camera.data.lens == 50 and camera.data.dof.aperture_fstop == 0.5
original_dof = camera.data.dof.use_dof
report = {'schemaVersion': 1, 'role': 'Original native DOF-off delta control; not optics parity qualification',
          'sourceSha256': source_hash, 'nativeBuild': bpy.app.build_hash.decode(),
          'producerSha256': sha(producer), 'pairedNativeOnReportSha256': sha(reference_bytes),
          'pairedNativeOnImageSha256': reference['imageSha256'],
          'sourceFrame': scene.frame_current, 'sourceSamples': scene.eevee.taa_render_samples,
          'sourceDofEnabled': original_dof, 'onlyOpticalChange': 'camera.data.dof.use_dof=False',
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'renderAttempts': 0, 'completedRenders': 0, 'saveCalls': 0,
          'supportCredit': 0, 'sceneAcceptance': False, 'status': 'PREPARING'}
try:
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    # Exactly the existing native-on R2 reference extent/format. No sample,
    # material, light, frame, camera transform or display changes.
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = str(out/'native-dof-off.png')
    camera.data.dof.use_dof = False
    report['renderSettings'] = {'engine': scene.render.engine, 'frame': scene.frame_current,
        'samples': scene.eevee.taa_render_samples, 'extent': [1280, 720],
        'pixelAspect': [scene.render.pixel_aspect_x, scene.render.pixel_aspect_y],
        'camera': camera.name, 'lens': camera.data.lens,
        'fstop': camera.data.dof.aperture_fstop, 'focus': camera.data.dof.focus_distance,
        'focusObject': camera.data.dof.focus_object.name if camera.data.dof.focus_object else None,
        'displayDevice': scene.display_settings.display_device, 'view': scene.view_settings.view_transform,
        'look': scene.view_settings.look, 'exposure': scene.view_settings.exposure,
        'gamma': scene.view_settings.gamma, 'dofEnabled': camera.data.dof.use_dof}
    report['renderAttempts'] = 1
    report['status'] = 'RENDERING'
    (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    start = time.monotonic()
    bpy.ops.render.render(write_still=True)
    report.update(completedRenders=1, renderWallSeconds=time.monotonic()-start,
                  imageSha256=sha((out/'native-dof-off.png').read_bytes()), status='CAPTURED_CONTROL')
except BaseException as error:
    report.update(status='FAILED', failure=repr(error))
    raise
finally:
    camera.data.dof.use_dof = original_dof
    report['dofRestoredInMemory'] = camera.data.dof.use_dof == original_dof
    report['sourceUnchanged'] = source_hash == sha(source.read_bytes())
    report['completedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    assert report['sourceUnchanged']
