# SPDX-License-Identifier: GPL-3.0-or-later
"""Characterize native constant Transform canvases without changing their oracle.

BLENDLINK_TRANSFORM_CONSTANT_PROBE=/absolute/output-directory is required.
Optionally BLENDLINK_TRANSFORM_CONSTANT_INPUT names a retained reference JSON;
its input bytes are used unchanged, and its SHA256 is recorded.
"""
import hashlib
import itertools
import json
import os
import platform
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    retained = os.environ.get('BLENDLINK_TRANSFORM_CONSTANT_INPUT')
    provenance = None
    if retained:
        source = Path(retained).resolve()
        contents = source.read_bytes()
        document = json.loads(contents)
        pixels = np.asarray(document['input'], np.float32).reshape(document['height'], document['width'], 4)
        provenance = {'path': str(source), 'sha256': hashlib.sha256(contents).hexdigest()}
    else:
        pixels = np.random.default_rng(981731).uniform(-.4, 2, (7, 13, 4)).astype(np.float32)
        pixels[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (7, 13))
    color = np.asarray((.25, -.5, 1.5, .35), np.float32)
    expected = np.tile(color, pixels.shape[0] * pixels.shape[1])
    rows = []
    for eevee, previews, warmup, unused in itertools.product((False, True), repeat=4):
        oracle = NativeCompositorReference(output, pixels=pixels, device='CPU', node_previews=previews)
        scene, tree = oracle.scene, oracle.tree
        if eevee:
            engines = {item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
            scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
            if hasattr(getattr(scene, 'eevee', None), 'taa_render_samples'):
                scene.eevee.taa_render_samples = 1

        def render():
            for node in tree.nodes:
                node.show_preview = previews
            scene.render.filepath = str(output / 'native.exr')
            bpy.ops.render.render(write_still=True)
            result = bpy.data.images.load(scene.render.filepath, check_existing=False)
            result.alpha_mode = 'PREMUL'
            values = np.asarray(result.pixels[:], np.float32)
            bpy.data.images.remove(result)
            return values

        if warmup:
            sink, _source = oracle.reset()
            image = tree.nodes.new('CompositorNodeImage')
            image.image = oracle.image
            tree.links.new(image.outputs['Image'], sink.inputs[0])
            render()
        sink, source = oracle.reset()
        if not unused:
            tree.nodes.remove(source)
        node = tree.nodes.new('CompositorNodeTransform')
        if node.inputs.get('Interpolation') is not None:
            node.inputs['Interpolation'].default_value = 'Nearest'
        else:
            node.filter_type = 'NEAREST'
        node.inputs['X'].default_value, node.inputs['Y'].default_value = 3, -2
        tree.links.new(oracle.color(color), node.inputs['Image'])
        tree.links.new(node.outputs[0], sink.inputs[0])
        if unused:
            image = tree.nodes.new('CompositorNodeImage')
            image.image = oracle.image
        actual = render()
        row = {'engine': scene.render.engine, 'previews': previews, 'warmup': warmup, 'unusedImage': unused,
               'finite': bool(np.isfinite(actual).all()), 'black': bool((actual == 0).all()),
               'constantColorWords': bool(np.array_equal(actual.view(np.uint32), expected.view(np.uint32))),
               'firstPixel': actual[:4].tolist()}
        rows.append(row)
        print('BLENDLINK_TRANSFORM_CONSTANT_CONTEXT', json.dumps(row), flush=True)
    (output / 'contexts.json').write_text(json.dumps({'blenderVersion': bpy.app.version_string,
        'blenderHash': bpy.app.build_hash.decode(), 'platform': sys.platform, 'architecture': platform.machine(),
        'compositorDevice': 'CPU', 'preferredGpuBackend': bpy.context.preferences.system.gpu_backend, 'retainedInput': provenance, 'contexts': rows}, indent=2))
    print('BLENDLINK_TRANSFORM_CONSTANT_PROBE_PASSED', len(rows))


main(Path(os.environ['BLENDLINK_TRANSFORM_CONSTANT_PROBE']).resolve())
