"""Native Split schema/domain research; does not admit a live operation."""
import hashlib
import json
import os
from pathlib import Path
import sys

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference

output = Path(os.environ['BLENDLINK_SPLIT_RESEARCH']).resolve()
device = os.environ.get('BLENDLINK_SPLIT_DEVICE', 'CPU')
records, schemas = [], []
for width, height in ((8, 8), (13, 7), (100, 4)):
    pixels = np.random.default_rng(31951 + width).uniform(-.5, 3, (height, width, 4)).astype(np.float32)
    pixels[..., 3] = np.resize(np.asarray([-.5, 0, .125, 1, 2], np.float32), (height, width))
    oracle = NativeCompositorReference(output, pixels=pixels, device=device, name='Native Split research', image_only_scene=True, node_previews=False)
    oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
    tree = oracle.tree
    if width == 8:
        for kind in ('CompositorNodeSplit', 'CompositorNodeSplitViewer', 'CompositorNodeViewer'):
            try: node = tree.nodes.new(kind)
            except Exception as error: schemas.append({'kind': kind, 'available': False, 'error': str(error)}); continue
            def socket(s):
                value = getattr(s, 'default_value', None)
                if value is not None and not isinstance(value, (str, int, float, bool)): value = list(value)
                return {'name': s.name, 'identifier': s.identifier, 'type': s.type, 'value': value}
            schemas.append({'kind': kind, 'available': True, 'inputs': [socket(s) for s in node.inputs],
                'outputs': [socket(s) for s in node.outputs], 'properties': {name: getattr(node, name) for name in ('axis', 'factor') if hasattr(node, name)}})
    modes = ('default', 'horizontal', 'vertical', 'constant-pair', 'reversed', 'factor53')
    for mode in modes:
        sink, unused = oracle.reset(); image = tree.nodes.new('CompositorNodeImage'); image.image = oracle.image
        a = image.outputs[0]; b = oracle.color((-.25, 1, .75, 2))
        if mode == 'constant-pair': a = oracle.color((.125, .5, 2, 0))
        if mode == 'reversed': a, b = b, a
        split = tree.nodes.new('CompositorNodeSplit')
        if oracle.modern:
            if mode == 'horizontal': split.inputs['Rotation'].default_value = 0
            if mode == 'vertical': split.inputs['Rotation'].default_value = np.pi / 2
            if mode == 'factor53': split.inputs['Position'].default_value = (.53, .53)
            settings = {name: list(split.inputs[name].default_value) if name == 'Position' else split.inputs[name].default_value for name in ('Position', 'Rotation')}
        else:
            if mode == 'horizontal': split.axis = 'Y'
            if mode == 'vertical': split.axis = 'X'
            if mode == 'factor53': split.factor = 53
            settings = {'axis': split.axis, 'factor': split.factor}
        tree.links.new(a, split.inputs['Image']); tree.links.new(b, split.inputs['Image_001']); tree.links.new(split.outputs[0], sink.inputs[0])
        for node in tree.nodes: node.show_preview = False
        oracle.scene.render.filepath = str(output / f'{width}x{height}-{mode}.exr')
        with oracle._render_sampling(): bpy.ops.render.render(write_still=True)
        result = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False); result.alpha_mode = 'PREMUL'
        actual = np.asarray(result.pixels[:], np.float32).reshape(height, width, 4)
        assert np.isfinite(actual).all()
        records.append({'mode': mode, 'width': width, 'height': height, 'settings': settings,
            'input': pixels.tolist(), 'expected': actual.tolist(), 'sourceSettingsPreserved': settings ==
            ({name: list(split.inputs[name].default_value) if name == 'Position' else split.inputs[name].default_value for name in settings}
             if oracle.modern else {'axis': split.axis, 'factor': split.factor})})
        bpy.data.images.remove(result)
    (output / 'report.json').write_text(json.dumps({'version': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode(),
        'device': device, 'backend': getattr(bpy.context.preferences.system, 'gpu_backend', None),
        'fixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'schemas': schemas, 'cases': records}, indent=2))
print('BLENDLINK_NATIVE_SPLIT_RESEARCH_RECORDED', bpy.app.version_string, device, len(records))
