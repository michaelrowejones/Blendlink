"""Observe native Crop controls/canvases without admitting a live implementation."""
import json
import hashlib
import os
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference, compositor_graph

output = Path(os.environ['BLENDLINK_CROP_EVIDENCE']).resolve()
fixture_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
pixels = np.zeros((8, 8, 4), dtype=np.float32)
for y in range(8):
    for x in range(8):
        pixels[y, x] = (x + 1, y + 1, x + 16 * y, [.25, .5, 1, 2][(x + y) % 4])
oracle = NativeCompositorReference(output, device=os.environ.get('BLENDLINK_CROP_DEVICE', 'CPU'),
    pixels=pixels, name='Native Crop domain research', image_only_scene=True)
scene, tree = oracle.scene, oracle.tree
scene.render.engine = 'BLENDER_EEVEE' if bpy.app.version >= (5, 0, 0) else 'BLENDER_EEVEE_NEXT'
records = []
settings = [
    ('identity', 0, 0, 8, 8), ('inside-even', 2, 2, 4, 4), ('inside-odd', 2, 1, 4, 3),
    ('outside-left', -2, 1, 6, 4), ('outside-right', 6, 2, 6, 4),
    ('oversized', -2, -2, 12, 12), ('single', 3, 2, 1, 1), ('zero', 2, 1, 0, 3),
]
for alpha_crop in (False, True):
    for name, x, y, width, height in settings:
        sink, _source = oracle.reset()
        image = tree.nodes.new('CompositorNodeImage'); image.image = oracle.image
        crop = tree.nodes.new('CompositorNodeCrop')
        tree.links.new(image.outputs['Image'], crop.inputs['Image'])
        tree.links.new(crop.outputs[0], sink.inputs[0])
        requested = {'x': x, 'y': y, 'width': width, 'height': height, 'alphaCrop': alpha_crop}
        if oracle.modern:
            for key, value in [('X', x), ('Y', y), ('Width', width), ('Height', height), ('Alpha Crop', alpha_crop)]:
                crop.inputs[key].default_value = value
            actual = {s.identifier: s.default_value for s in crop.inputs if s.type != 'RGBA'}
        else:
            crop.use_crop_size = not alpha_crop
            # Legacy Y1 is the upper boundary and Y2 the lower boundary.
            crop.min_x, crop.max_x, crop.min_y, crop.max_y = x, x + width, y + height, y
            actual = {key: getattr(crop, key) for key in ['relative', 'use_crop_size', 'min_x', 'max_x', 'min_y', 'max_y']}
        program = compositor_graph.extract(scene)
        for node in tree.nodes:
            node.show_preview = False
        destination = output / (name + '-' + str(int(alpha_crop)) + '.exr')
        scene.render.filepath = str(destination)
        with oracle._render_sampling():
            bpy.ops.render.render(write_still=True)
        loaded = bpy.data.images.load(str(destination), check_existing=False); loaded.alpha_mode = 'PREMUL'
        data = np.asarray(loaded.pixels[:], np.float32).reshape(loaded.size[1], loaded.size[0], 4)
        assert np.isfinite(data).all(), (name, actual)
        records.append({'case': name, 'requested': requested, 'actual': actual, 'size': list(loaded.size),
            'program': program, 'rgba': data.tolist(), 'sourceSettingsPreserved': actual ==
            ({s.identifier: s.default_value for s in crop.inputs if s.type != 'RGBA'} if oracle.modern else
             {key: getattr(crop, key) for key in actual})})
        bpy.data.images.remove(loaded)
        (output / 'report.json').write_text(json.dumps({'version': bpy.app.version_string,
            'buildHash': bpy.app.build_hash.decode(), 'device': oracle.device, 'modern': oracle.modern,
            'fixtureSha256': fixture_hash, 'inputFloat32Sha256': hashlib.sha256(pixels.tobytes()).hexdigest(),
            'input': pixels.tolist(), 'cases': records}, indent=2))
print('BLENDLINK_CROP_NATIVE_RESEARCH_RECORDED', bpy.app.version_string, len(records))
