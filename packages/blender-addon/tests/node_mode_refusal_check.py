# SPDX-License-Identifier: GPL-3.0-or-later
"""Preserve native shader curve tone and legacy compositor alpha behavior."""
import json
from pathlib import Path
import sys
import tempfile

import bpy
import numpy as np

addon = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(addon))
sys.path.insert(0, str(addon.parent / 'blendlink/blender'))
import tsl_ir
import compositor_graph


def main(output):
    bpy.ops.wm.read_factory_settings(use_empty=False)
    material = bpy.data.materials.new('Native RGB Curve Tone')
    material.use_nodes = True
    curve = material.node_tree.nodes.new('ShaderNodeRGBCurve')
    curve.mapping.tone = 'STANDARD'
    standard = tsl_ir.emit_output(curve, curve.outputs['Color'])
    assert standard['op'] == 'curve_native'
    curve.mapping.tone = 'FILMLIKE'
    filmlike = tsl_ir.emit_output(curve, curve.outputs['Color'])
    assert filmlike['op'] == 'curve_native' and filmlike['sourceTone'] == 'FILMLIKE'
    # The native shader nodes ignore tone; the compositor implements coupled
    # Film Like separately. Native Cycles/EEVEE differential graphs prove this.
    assert standard['values'] == filmlike['values']
    curve.mapping.tone = 'STANDARD'
    assert tsl_ir.emit_output(curve, curve.outputs['Color'])['op'] == 'curve_native'

    scene = bpy.context.scene
    modern = hasattr(scene, 'compositing_node_group')
    if modern:
        tree = bpy.data.node_groups.new('Native Mode Refusal', 'CompositorNodeTree')
        tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        scene.compositing_node_group = tree
        sink = tree.nodes.new('NodeGroupOutput')
    else:
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()
        sink = tree.nodes.new('CompositorNodeComposite')
    layers = tree.nodes.new('CompositorNodeRLayers')
    grade = tree.nodes.new('CompositorNodeBrightContrast')
    grade.inputs['Bright'].default_value = 20
    grade.inputs['Contrast'].default_value = 30
    tree.links.new(layers.outputs['Image'], grade.inputs['Image'])
    tree.links.new(grade.outputs['Image'], sink.inputs[0])
    report = {'version': bpy.app.version_string, 'shaderCurveToneTransported': True}
    if hasattr(grade, 'use_premultiply'):
        grade.use_premultiply = True
        normalized = compositor_graph.extract(scene)
        assert normalized['status'] == 'extracted', normalized
        assert any(op['kind'] == 'brightness-contrast' and op['properties']['use_premultiply'] is True for op in normalized['ops']), normalized
        grade.use_premultiply = False
        normalized = compositor_graph.extract(scene)
        assert normalized['status'] == 'extracted'
        assert any(op['kind'] == 'brightness-contrast' and op['properties']['use_premultiply'] is False for op in normalized['ops']), normalized
        # Real pixels prove the legacy flag changes translucent image behavior.
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.samples = 1
        import _cycles
        _cycles.set_device_override('CPU')
        scene.render.resolution_x = scene.render.resolution_y = 8
        scene.render.resolution_percentage = 100
        scene.render.use_compositing = True
        scene.render.use_sequencer = False
        if hasattr(scene.render, 'compositor_device'):
            scene.render.compositor_device = 'CPU'
        scene.render.dither_intensity = 0
        scene.view_settings.view_transform = 'Raw'
        scene.view_settings.look = 'None'
        scene.view_settings.exposure = 0
        scene.view_settings.gamma = 1
        scene.render.image_settings.file_format = 'OPEN_EXR'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.image_settings.color_depth = '32'
        pixels = np.zeros((8, 8, 4), np.float32)
        pixels[..., :] = [0.1, 0.2, 0.3, 0.5]
        pixels[:, 4:, :] = [0.02, 0.03, 0.08, 0.125]
        image = bpy.data.images.new('Translucent native input', width=8, height=8, alpha=True, float_buffer=True)
        image.alpha_mode = 'PREMUL'
        image.colorspace_settings.name = 'Linear Rec.709'
        image.pixels.foreach_set(pixels.ravel())
        source = tree.nodes.new('CompositorNodeImage')
        source.image = image
        tree.links.new(source.outputs['Image'], grade.inputs['Image'])
        results = []
        for enabled in (False, True):
            grade.use_premultiply = enabled
            scene.render.filepath = str(output / f'legacy-premultiply-{enabled}.exr')
            bpy.ops.render.render(write_still=True)
            read = bpy.data.images.load(scene.render.filepath, check_existing=False)
            read.alpha_mode = 'PREMUL'
            results.append(np.asarray(read.pixels[:], np.float32).reshape(8, 8, 4))
            bpy.data.images.remove(read)
        delta = float(np.max(np.abs(results[1][..., :3] - results[0][..., :3])))
        assert delta > 0.01, f'Premultiply flag did not affect this native alpha fixture: {delta}'
        assert np.array_equal(results[0][..., 3], pixels[..., 3])
        assert np.array_equal(results[1][..., 3], pixels[..., 3])
        report.update(legacyPremultiplyNormalized=True, nativeRgbDifference=delta, alphaPreserved=True)
    else:
        assert compositor_graph.extract(scene)['status'] == 'extracted'
        report['modernBrightContrastUnchanged'] = True
    print('BLENDLINK_NODE_MODE_REFUSAL_CHECK_PASSED ' + json.dumps(report, sort_keys=True))


with tempfile.TemporaryDirectory(prefix='blendlink-native-node-refusals-') as temporary:
    main(Path(temporary))
