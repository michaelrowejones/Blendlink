# SPDX-License-Identifier: GPL-3.0-or-later
"""Native transparent Crop masking, preserving the incoming finite canvas."""
import math

import bpy


def normalize_crop(node, op, scene, read, fail):
    if scene.render.use_border:
        fail(node.inputs['Image'], 'Crop render-border/cropped windows require native data/display-window transport')
    if (getattr(scene.render, 'compositor_device', 'CPU') == 'GPU'
            and getattr(scene.render, 'compositor_precision', 'AUTO') not in {'FULL', 'AUTO'}):
        fail(node.inputs['Image'], 'Crop currently requires Full or final-render Automatic compositor precision; Half output quantization remains unqualified')
    modern = node.inputs.get('Alpha Crop') is not None
    if modern:
        for name in ('Alpha Crop', 'X', 'Y', 'Width', 'Height'):
            if node.inputs[name].is_linked:
                fail(node.inputs[name], 'Crop requires fixed unlinked rectangle settings')
        if not node.inputs['Alpha Crop'].default_value:
            fail(node.inputs['Alpha Crop'], 'Crop resizing requires native resized image-window transport; enable Alpha Crop for transparent masking')
        rectangle = [int(node.inputs[name].default_value) for name in ('X', 'Y', 'Width', 'Height')]
        if any(abs(value) > 1048576 for value in rectangle):
            fail(node.inputs['X'], 'Crop rectangle coordinates must remain within +/-1048576 pixels')
        model = 'modern-int-mask-v1'
    else:
        if node.use_crop_size:
            fail(node.inputs['Image'], 'Crop resizing requires native resized image-window transport; disable Crop Image Size for transparent masking')
        relative = bool(node.relative)
        # Legacy RNA min_y is the UPPER boundary, max_y the LOWER boundary.
        prefix = 'rel_' if relative else ''
        rectangle = [getattr(node, prefix + key) for key in ('min_x', 'max_y', 'max_x', 'min_y')]
        if any(not math.isfinite(value) or value < 0 or value > (1 if relative else 1048576) for value in rectangle):
            fail(node.inputs['Image'], 'Legacy Crop requires bounded nonnegative pixel boundaries or relative factors in [0,1]')
        model = 'legacy-relative-mask-v1' if relative else 'legacy-int-mask-v1'
    image = read(node.inputs['Image'])
    if image.get('kind') == 'convert' and image.get('fromType') != 'RGBA':
        fail(node.inputs['Image'], 'Crop currently requires a Color image field; scalar/vector input domains remain unqualified')
    op['properties'].update(crop_model=model, crop_rectangle=rectangle)
    op['inputs']['Image'] = {'name': 'Image', 'socketType': 'RGBA', 'value': image}


def validate_crop_domains(program):
    """A mask reads input-local pixels; deferred translated windows are distinct."""
    origins = {}
    def transformed(value):
        if value['kind'] == 'convert':
            return transformed(value['input'])
        return origins.get(value.get('node'), False)
    for op in program['ops']:
        incoming = any(transformed(item['value']) for item in op['inputs'].values())
        if op['kind'] == 'alpha-crop' and incoming:
            return op, 'Crop after translated/affine images requires native input-local window realization; crop before the transform instead'
        origins[op['id']] = incoming or op['kind'] in {'translate', 'image-affine'}
    return None
