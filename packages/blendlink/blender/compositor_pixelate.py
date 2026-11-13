# SPDX-License-Identifier: GPL-3.0-or-later
"""Fixed native block means on independently validated render canvases."""
import bpy


def normalize_pixelate(node, op, scene, read, fail):
    image = node.inputs['Color']
    if bpy.app.version[:2] not in {(4, 2), (5, 2), (5, 3)}:
        fail(image, 'Pixelate requires a measured Blender 4.2, 5.2 or 5.3 source model')
    if scene.render.use_border:
        fail(image, 'Pixelate render borders require native finite input-window transport')
    if getattr(scene.render, 'compositor_device', 'CPU') == 'GPU' and getattr(scene.render, 'compositor_precision', 'AUTO') not in {'FULL', 'AUTO'}:
        fail(image, 'Pixelate requires Full or final-render Automatic compositor precision')
    size_input = node.inputs.get('Size')
    if size_input is not None and size_input.is_linked:
        fail(size_input, 'Pixelate requires a fixed unlinked integer Size')
    size = int(size_input.default_value if size_input is not None else node.pixel_size)
    if not 1 <= size <= 16:
        fail(size_input or image, 'Pixelate Size must remain between 1 and 16 pixels')
    value = read(image)
    if value['type'] != 'RGBA' or value['kind'] == 'convert' and value['fromType'] != 'RGBA':
        fail(image, 'Pixelate currently requires a Color image without scalar/vector conversion')
    op['properties'].update(pixelate_model='native-block-mean-v1', pixelate_size=size)
    op['inputs']['Color'] = {'name': 'Color', 'socketType': 'RGBA', 'value': value}


def validate_pixelate_domains(program):
    pixelates = [op for op in program['ops'] if op['kind'] == 'pixelate']
    if pixelates and any(op['kind'] in {'translate', 'image-affine', 'image-input', 'image-crop'} for op in program['ops']):
        return pixelates[0], 'Pixelate currently requires an unshifted render canvas; static, transformed and resized input windows remain unqualified'
    return None
