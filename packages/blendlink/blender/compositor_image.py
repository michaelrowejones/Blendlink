# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only static compositor image inputs; no scene render or surface bake."""
import base64
import hashlib
import os
from pathlib import Path
import tempfile
import zlib

import bpy
import numpy as np
import PyOpenColorIO as OCIO

MAX_IMAGE_PIXELS = 2048 * 2048
MAX_PROGRAM_PIXELS = 2 * MAX_IMAGE_PIXELS


def _pixels(image):
    pixels = np.empty(len(image.pixels), dtype='<f4')
    image.pixels.foreach_get(pixels)
    return pixels


def _fixed_image(image):
    animation = getattr(image, 'animation_data', None)
    if animation and (animation.action or len(animation.drivers) or len(animation.nla_tracks)):
        raise ValueError('Static compositor Image inputs do not yet transport image animation or drivers')
    if image.source not in {'FILE', 'GENERATED'} or image.type not in {'IMAGE', 'UV_TEST'}:
        raise ValueError('Compositor Image currently requires a static single-layer file or generated image; movies, sequences, UDIM, viewers and render results remain unqualified')
    if getattr(image, 'is_multiview', False) or getattr(image, 'is_stereo_3d', False) or len(image.packed_files) > 1:
        raise ValueError('Compositor Image requires a single-view image')


def _working_space():
    bundled = Path(bpy.utils.resource_path('LOCAL')) / 'datafiles/colormanagement/config.ocio'
    path = Path(os.environ.get('OCIO') or bundled)
    if path.read_bytes() != bundled.read_bytes():
        raise ValueError('Static compositor Image custom OCIO input processing remains unqualified; use the bundled Linear Rec.709 configuration')
    try:
        config = OCIO.Config.CreateFromFile(str(path))
        space = config.getColorSpace(OCIO.ROLE_SCENE_LINEAR)
        if space is None or space.getName() != 'Linear Rec.709':
            raise ValueError('Static compositor Image inputs currently require a Linear Rec.709 CPU working space; other image processing profiles remain unqualified')
    except OCIO.Exception as error:
        raise ValueError('Static compositor Image cannot resolve the authored OCIO input processing: ' + str(error)) from error


def _byte_srgb(image):
    # This invokes native image-only decode/color/association, never the
    # compositor or a scene render. Image.copy() may discard a generated buffer.
    stage = bpy.data.scenes.new('.BLENDLINK_IMAGE_DECODE')
    decoded = None
    try:
        stage.view_settings.view_transform = 'Raw'
        stage.view_settings.look = 'None'
        stage.view_settings.exposure = 0
        stage.view_settings.gamma = 1
        stage.render.image_settings.file_format = 'OPEN_EXR'
        stage.render.image_settings.color_mode = 'RGBA'
        stage.render.image_settings.color_depth = '32'
        with tempfile.TemporaryDirectory(prefix='blendlink-image-decode-') as temporary:
            path = str(Path(temporary) / 'decoded.exr')
            image.save_render(path, scene=stage)
            decoded = bpy.data.images.load(path, check_existing=False)
            decoded.alpha_mode = 'PREMUL'
            pixels = _pixels(decoded)
        return pixels
    finally:
        if decoded is not None:
            bpy.data.images.remove(decoded)
        bpy.data.scenes.remove(stage)


def normalize_image(node, socket, op, scene, result, cache, fail):
    if getattr(scene.render, 'compositor_device', 'CPU') != 'CPU':
        fail(socket, 'Static compositor Image inputs currently require the Blender CPU compositor')
    if socket.identifier not in {'Image', 'Alpha'} or node.image is None:
        fail(socket, 'Compositor Image requires an assigned static image and Image or Alpha output')
    image = node.image
    try:
        _fixed_image(image)
        _working_space()
        width, height = map(int, image.size)
        if image.channels not in {3, 4}:
            raise ValueError('Static compositor Image currently requires RGB or RGBA input channels; other native pixel formats remain unqualified')
        if min(width, height) < 1 or max(width, height) > 4096 or width * height > MAX_IMAGE_PIXELS:
            raise ValueError('Compositor Image requires nonempty dimensions <=4096 and at most 2048x2048 pixels')
        legacy = bpy.app.version < (5, 0, 0)
        if legacy and (width % 2 or height % 2):
            raise ValueError('Legacy CPU compositor Image inputs currently require even source dimensions; odd native windows remain unqualified')
        if scene.render.use_border:
            raise ValueError('Compositor Image render-border and crop windows require native display/data-window transport')
        pointer = image.as_pointer()
        if pointer not in cache:
            space = image.colorspace_settings.name
            if image.is_float:
                if space not in {'Linear Rec.709', 'Non-Color', 'Raw'}:
                    raise ValueError('Float compositor Image inputs currently require Linear Rec.709 or Non-Color storage; other input transforms remain unqualified')
                # EXR can carry a nonzero data/display window not exposed by
                # Image.size. Admit generated float buffers first.
                if image.source != 'GENERATED':
                    raise ValueError('File/packed float Image display windows require native metadata transport; generated linear float buffers are supported')
                pixels = _pixels(image)
                storage = 'direct-float-buffer'
            else:
                if space != 'sRGB' or image.source == 'FILE' and image.file_format != 'PNG':
                    raise ValueError('Byte compositor Image inputs currently require sRGB PNG files/packed images or generated sRGB buffers')
                if image.source == 'GENERATED' and image.alpha_mode not in {'STRAIGHT', 'PREMUL'}:
                    raise ValueError('Generated byte Image inputs currently require Straight or Premultiplied alpha; other native buffer-flag models remain unqualified')
                pixels = _byte_srgb(image)
                storage = 'native-byte-srgb-decode'
            if pixels.size != width * height * 4 or not np.isfinite(pixels).all():
                raise ValueError('Compositor Image requires finite complete RGBA Float32 pixels')
            raw = pixels.tobytes()
            identifier = hashlib.sha256(raw + str((width, height, storage)).encode()).hexdigest()
            payloads = result.setdefault('images', {})
            if identifier not in payloads:
                if sum(record['width'] * record['height'] for record in payloads.values()) + width * height > MAX_PROGRAM_PIXELS:
                    raise ValueError('Static compositor Image inputs exceed the 8-megapixel decoded program budget')
                payloads[identifier] = {
                    'model': 'native-cpu-static-image-v1', 'encoding': 'zlib-le-rgba32f',
                    'width': width, 'height': height, 'decodedBytes': len(raw),
                    'data': base64.b64encode(zlib.compress(raw, level=6)).decode('ascii'),
                    'source': {'name': image.name, 'kind': image.source, 'colorSpace': space,
                               'alphaMode': image.alpha_mode, 'storage': storage},
                }
            cache[pointer] = identifier
        op['properties'].update({
            'image_id': cache[pointer],
            'image_window_model': 'legacy-cpu-even-v1' if legacy else 'modern-cpu-v1',
        })
    except (ValueError, RuntimeError, OSError) as error:
        fail(socket, str(error))


def validate_image_graph(result):
    if not result.get('images'):
        return None
    domains = {}
    def domain(value):
        return domains.get(value.get('node')) if value['kind'] == 'ref' else domain(value['input']) if value['kind'] == 'convert' else None
    for op in result['ops']:
        if op['kind'] == 'render-pass':
            return op, 'Static Image and Render Layers currently need separate canvas-domain realization; mixed render/image canvases remain unqualified'
        if op['kind'] == 'image-input':
            record = result['images'][op['properties']['image_id']]
            domains[op['id']] = (record['width'], record['height'])
            continue
        incoming = [domain(item['value']) for item in op['inputs'].values()]
        fields = [value for value in incoming if value is not None]
        if not fields:
            continue
        if op['kind'] in {'translate', 'image-affine', 'blur', 'filter', 'flip', 'glare'}:
            return op, 'Static Image neighborhood/transform consumers require native finite-window processing; this port currently supports pointwise consumers'
        if any(value != fields[0] for value in fields):
            return op, 'Static Image inputs with different pixel dimensions require native cross-domain realization; use matching image canvases'
        domains[op['id']] = fields[0]
    return None
