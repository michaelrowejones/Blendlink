# SPDX-License-Identifier: MIT
"""A real export prepares one validated layout shared by plan and bake."""
import json
import sys
import tempfile
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blendlink/blender'))
import export_scene

bpy.ops.wm.read_factory_settings(use_empty=False)
bpy.context.scene['blendlink_recipe'] = json.dumps({
    'schemaVersion': 1, 'presentation': 'hybrid',
    'atlases': [{'id': 'main', 'name': 'Main', 'size': 128, 'margin': 4,
                 'targetDensity': 8, 'fitPolicy': 'scale', 'bakeOutput': 'appearance'}],
    'preview': {'samples': 1, 'supersample': 1, 'denoise': False, 'resolutionScale': 1},
    'final': {'samples': 1, 'supersample': 1, 'denoise': False, 'resolutionScale': 1},
    'states': [{'name': 'default'}],
})
calls = []
prepare = export_scene.bake_prepare_geometry
def counted(*args, **kwargs):
    result = prepare(*args, **kwargs)
    calls.append(result)
    return result
export_scene.bake_prepare_geometry = counted
with tempfile.TemporaryDirectory(prefix='blendlink-one-preparation-') as directory:
    root = Path(directory)
    (root / 'settings.json').write_text(json.dumps({'draft': True}))
    sys.argv = ['test', '--', str(root / 'scene.glb'), str(root / 'settings.json'), str(root / 'result.json')]
    export_scene.main()
    result = json.loads((root / 'result.json').read_text())
    assert len(calls) == 1, f'Prepared the same scene {len(calls)} times'
    assert result['ok'] and result['plan']['atlasLayout']
    assert not result['plan']['errors']
    assert (root / 'scene.glb').stat().st_size > 0
print('BLENDLINK_BAKE_PREPARATION_PASSED')
