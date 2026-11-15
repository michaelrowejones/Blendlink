# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only camera DOF warning/readiness evidence; no optical port or render."""
import argparse
import hashlib
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import bpy

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('scenetoweb_camera_fidelity_exporter',root.parent/'blendlink/blender/export_scene.py')
exporter=importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
bpy.ops.wm.read_factory_settings(use_empty=False)
scene=bpy.context.scene
camera=scene.camera
assert exporter.camera_depth_of_field_warning(scene) is None
camera.data.dof.use_dof=True
camera.data.lens=70
camera.data.dof.aperture_fstop=1.4
camera.data.dof.focus_distance=4.25
before=(camera.data.lens,camera.data.dof.aperture_fstop,camera.data.dof.focus_distance,camera.data.dof.use_dof)
warning=exporter.camera_depth_of_field_warning(scene)
assert warning['code']=='camera.depth-of-field-untransported' and warning['source']['lensMillimeters']==70
assert warning['source']['focusDistanceBlenderUnits']==4.25 and warning['source']['focusObject'] is None
assert not warning['equivalenceClaim'] and not warning['nativeOpticsTranslated']
assert 'perspective' in warning['fix'] and 'do not map directly' in warning['fix']
explicit=exporter.camera_depth_of_field_warning(scene,{'components':[{'type':'blendlink.depth-of-field','enabled':True,'target':{'kind':'scene'}}]})
assert explicit['explicitWebsiteEffectPresent'] and 'do not establish Blender optics parity' in explicit['problem']
assert exporter.camera_depth_of_field_warning(scene,{'components':[{'type':'blendlink.depth-of-field','enabled':False,'target':{'kind':'scene'}}]})['explicitWebsiteEffectPresent'] is False
assert exporter.camera_depth_of_field_warning(scene,{'components':[{'type':'blendlink.depth-of-field','enabled':True,'target':{'kind':'object'}}]})['explicitWebsiteEffectPresent'] is False
camera.data.dof.focus_object=bpy.data.objects['Cube']
assert exporter.camera_depth_of_field_warning(scene)['source']['focusObject']=='Cube'
camera.data.dof.focus_object=None
assert before==(camera.data.lens,camera.data.dof.aperture_fstop,camera.data.dof.focus_distance,camera.data.dof.use_dof)
with tempfile.TemporaryDirectory(prefix='scenetoweb-camera-warning-') as directory:
    directory=Path(directory);settings=directory/'settings.json';settings.write_text('{"planOnly":true}')
    result=directory/'result.json';out=directory/'out.glb'
    exporter.parse_argv=lambda:(str(out),str(settings),str(result))
    exporter.main()
    report=json.loads(result.read_text())
    assert any('camera.depth-of-field-untransported' in item for item in report['warnings'])
    assert report['sidecar']['diagnostics']['cameraFidelity'][0]['source']==warning['source']
    assert not out.exists()
# Actual readiness uses the same read-only warning, without auto-adding effects.
spec=importlib.util.spec_from_file_location('scenetoweb_camera_fidelity_addon',root/'__init__.py',submodule_search_locations=[str(root)])
addon=importlib.util.module_from_spec(spec);sys.modules[spec.name]=addon;spec.loader.exec_module(addon);addon.register()
try:
    addon.validation.recompute(scene)
    assert any('native focus, lens and aperture are not automatically translated' in issue.message
               for issue in addon.validation.result().issues)
    assert len(scene.blendlink_project.components)==0
finally:addon.unregister()
arguments=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path);parser.add_argument('--report',type=Path)
args=parser.parse_args(arguments)
if args.source:
    digest=hashlib.sha256(args.source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(args.source))
    scene=bpy.context.scene
    warning=exporter.camera_depth_of_field_warning(scene)
    assert warning is not None and warning['source']['lensMillimeters']==scene.camera.data.lens
    assert warning['source']['apertureFStop']==scene.camera.data.dof.aperture_fstop
    assert digest==hashlib.sha256(args.source.read_bytes()).hexdigest()
    evidence={'sourceSha256':digest,'sourceUnchanged':True,'nativeVersion':bpy.app.version_string,
              'nativeBuild':bpy.app.build_hash.decode(),'warning':warning,'supportCredit':0,'sceneAcceptance':False}
    if args.report:args.report.write_text(json.dumps(evidence,indent=2)+'\n')
    print('CAMERA_DOF_ORIGINAL_EVIDENCE '+json.dumps(evidence))
print('BLENDLINK_CAMERA_FIDELITY_PASSED')
