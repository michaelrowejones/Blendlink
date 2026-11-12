# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent native affine pixel oracle before enabling a new emitter mode."""
import json
import math
import os
import platform
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
sys.path.insert(0, str(ROOT / 'packages/blendlink/blender'))
from compositor_affine import native_affine_matrix


def main(output, device):
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    for width, height in ((13, 7), (31, 9)):
        pixels = np.random.default_rng(379117 + width).uniform(-.5, 2, (height, width, 4)).astype(np.float32)
        pixels[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (height, width))
        oracle = NativeCompositorReference(output, device=device, pixels=pixels, node_previews=False)
        scene, tree = oracle.scene, oracle.tree
        engines = {item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
        scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
        if hasattr(getattr(scene, 'eevee', None), 'taa_render_samples'):
            scene.eevee.taa_render_samples = 1

        def make_image():
            tree.nodes.clear()
            sink = tree.nodes.new('NodeGroupOutput' if oracle.modern else 'CompositorNodeComposite')
            image = tree.nodes.new('CompositorNodeImage')
            image.image = oracle.image
            return sink, image.outputs['Image']

        def affine(value, kind, interpolation, angle=0, scale=(1, 1), translation=(0, 0)):
            node = tree.nodes.new(kind)
            effective = interpolation
            if node.inputs.get('Interpolation') is not None:
                node.inputs['Interpolation'].default_value = interpolation
            elif hasattr(node, 'filter_type'):
                node.filter_type = interpolation.upper()
            else:
                # Legacy Scale has no authored interpolation choice.
                effective = 'Bilinear'
            if kind == 'CompositorNodeScale':
                if node.inputs.get('Type') is not None:
                    node.inputs['Type'].default_value = 'Relative'
                else:
                    node.space = 'RELATIVE'
                node.inputs['X'].default_value, node.inputs['Y'].default_value = scale
                scale = tuple(float(node.inputs[name].default_value) for name in ('X', 'Y'))
            else:
                angle_input = node.inputs.get('Angle') or node.inputs['Degr']
                angle_input.default_value = angle
                angle = float(angle_input.default_value)
                if kind == 'CompositorNodeTransform':
                    node.inputs['Scale'].default_value = scale[0]
                    scale = (float(node.inputs['Scale'].default_value),) * 2
                    node.inputs['X'].default_value, node.inputs['Y'].default_value = translation
                    translation = tuple(float(node.inputs[name].default_value) for name in ('X', 'Y'))
            tree.links.new(value, node.inputs['Image'])
            return node.outputs[0], {'kind': kind, 'interpolation': effective, 'angle': angle,
                'scale': scale, 'translation': translation, 'matrix': native_affine_matrix(angle, scale, translation)}

        def save(label, value, definitions, source):
            sink = next(node for node in tree.nodes if node.bl_idname == ('NodeGroupOutput' if oracle.modern else 'CompositorNodeComposite'))
            tree.links.new(value, sink.inputs[0])
            for node in tree.nodes:
                node.show_preview = False
            scene.render.filepath = str(output / 'native.exr')
            print('BLENDLINK_AFFINE_NATIVE_CASE', label, flush=True)
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(scene.render.filepath, check_existing=False)
            image.alpha_mode = 'PREMUL'
            expected = np.asarray(image.pixels[:], np.float32)
            bpy.data.images.remove(image)
            assert expected.size == width * height * 4, (label, expected.size)
            finite = bool(np.isfinite(expected).all())
            case = oracle.prefix + f'-affine-{width}-{height}-' + label
            document = {'case': case, 'blenderVersion': bpy.app.version_string,
                'blenderHash': bpy.app.build_hash.decode(), 'compositorDevice': device,
                'preferredGpuBackend': bpy.context.preferences.system.gpu_backend,
                'architecture': platform.machine(), 'sceneEngine': scene.render.engine,
                'width': width, 'height': height, 'input': pixels.ravel().tolist(),
                'definitions': definitions, 'consumer': source, 'finite': finite}
            if finite:
                document['expected'] = expected.tolist()
            else:
                document['nativeFloat32Words'] = expected.view(np.uint32).tolist()
                document['nonfiniteCount'] = int((~np.isfinite(expected)).sum())
            (output / (case + '.json')).write_text(json.dumps(document, separators=(',', ':')))
            rows.append({'case': case, 'finite': finite})

        sink, image = make_image()
        save('input-control', image, [], 'output')
        for mode in ('Nearest', 'Bilinear'):
            for index, angle in enumerate((0, .1, .4, math.pi / 4, math.pi / 2, math.pi, -.4)):
                for kind in ('CompositorNodeTransform', 'CompositorNodeRotate'):
                    sink, image = make_image()
                    value, definition = affine(image, kind, mode, angle=angle)
                    save(f'{mode.lower()}-{kind.lower()}-angle-{index}', value, [definition], 'output')
            for index, scale in enumerate(((.5, .75), (.75, 1.25), (1.25, 2), (2, .5))):
                for kind in ('CompositorNodeTransform', 'CompositorNodeScale'):
                    if kind == 'CompositorNodeScale' and bpy.app.version < (4, 5, 0) and mode == 'Nearest':
                        continue
                    sink, image = make_image()
                    value, definition = affine(image, kind, mode, scale=scale)
                    save(f'{mode.lower()}-{kind.lower()}-scale-{index}', value, [definition], 'output')
            for consumer in ('inverse-rotation', 'exposure', 'blur', 'scale-then-rotate', 'rotate-then-scale', 'combined'):
                sink, image = make_image()
                value, first = affine(image, 'CompositorNodeRotate', mode, angle=.4)
                definitions = [first]
                if consumer == 'inverse-rotation':
                    value, second = affine(value, 'CompositorNodeRotate', mode, angle=-.4)
                    definitions.append(second)
                elif consumer in ('exposure', 'blur'):
                    node = tree.nodes.new('CompositorNodeExposure' if consumer == 'exposure' else 'CompositorNodeBlur')
                    if consumer == 'exposure': node.inputs['Exposure'].default_value = .25
                    elif node.inputs.get('Type') is not None:
                        node.inputs['Type'].default_value = 'Tent';node.inputs['Size'].default_value = (2, 3)
                    else:
                        node.filter_type = 'TENT';node.size_x, node.size_y = 2, 3
                    tree.links.new(value, node.inputs['Image']);value = node.outputs[0]
                elif consumer == 'rotate-then-scale':
                    value, second = affine(value, 'CompositorNodeScale', mode, scale=(.75, 1.25))
                    definitions.append(second)
                elif consumer == 'scale-then-rotate':
                    value, first = affine(image, 'CompositorNodeScale', mode, scale=(.75, 1.25))
                    value, second = affine(value, 'CompositorNodeRotate', mode, angle=.4)
                    definitions = [first, second]
                else:
                    value, first = affine(image, 'CompositorNodeTransform', mode, angle=.4, scale=(1.25, 1.25), translation=(.1, -.2))
                    definitions = [first]
                save(mode.lower() + '-consumer-' + consumer, value, definitions, consumer)
    (output / 'index.json').write_text(json.dumps(rows, indent=2))
    print('BLENDLINK_AFFINE_NATIVE_PASSED', json.dumps({'blender': bpy.app.version_string, 'device': device,
        'cases': len(rows), 'nonfinite': sum(not row['finite'] for row in rows)}))


main(Path(os.environ['BLENDLINK_AFFINE_NATIVE']).resolve(), os.environ.get('BLENDLINK_AFFINE_DEVICE', 'CPU'))
