# SPDX-License-Identifier: GPL-3.0-or-later
"""Native transparent Crop masking, preserving the incoming finite canvas."""
import math

import bpy


def normalize_crop(node, op, scene, read, fail):
    if bpy.app.version[:2] not in {(4, 2), (5, 2), (5, 3)}:
        fail(node.inputs['Image'], 'Crop requires a measured Blender 4.2, 5.2 or 5.3 source model; this version has unqualified rectangle/empty-window semantics')
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
        resizing = not node.inputs['Alpha Crop'].default_value
        if resizing and getattr(scene.render, 'compositor_device', 'CPU') != 'CPU':
            fail(node.inputs['Alpha Crop'], 'Crop resizing currently requires the modern CPU compositor; GPU finite-window realization remains unqualified')
        rectangle = [int(node.inputs[name].default_value) for name in ('X', 'Y', 'Width', 'Height')]
        if any(abs(value) > 1048576 for value in rectangle):
            fail(node.inputs['X'], 'Crop rectangle coordinates must remain within +/-1048576 pixels')
        model = 'modern-cpu-size-v1' if resizing else 'modern-int-mask-v1'
        if resizing:
            op['kind'] = 'image-crop'
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


def validate_crop_domains(program, single_values):
    """A mask reads input-local pixels; deferred translated windows are distinct."""
    origins, windows = {}, {}
    def transformed(value):
        if value['kind'] == 'convert':
            return transformed(value['input'])
        return origins.get(value.get('node'), False)
    def window(value):
        if value['kind'] == 'convert':
            return window(value['input'])
        return windows.get(value.get('node'))
    for op in program['ops']:
        if op['id'] in single_values:
            continue
        incoming = any(transformed(item['value']) for item in op['inputs'].values())
        if op['kind'] in {'alpha-crop', 'image-crop'} and incoming:
            return op, 'Crop after translated/affine images requires native input-local window realization; crop before the transform instead'
        origins[op['id']] = incoming or op['kind'] in {'translate', 'image-affine'}
        fields = {window(item['value']) for item in op['inputs'].values()} - {None}
        resized = {field for field in fields if field.startswith('crop:')}
        if resized:
            if len(fields) != 1:
                return op, 'Inputs with different resized Crop windows require native cross-domain realization'
            if op['kind'] not in {'exposure', 'invert', 'posterize', 'alpha-over'}:
                return op, 'Resized Crop currently supports terminal output and Exposure, Invert, Posterize or Alpha Over pointwise consumers; other finite-window consumers remain unqualified'
        if op['kind'] == 'image-crop':
            windows[op['id']] = 'crop:' + op['id']
        elif op['kind'] in {'render-pass', 'image-input'}:
            windows[op['id']] = 'source:' + op['id']
        elif fields:
            windows[op['id']] = next(iter(fields))
    return None
