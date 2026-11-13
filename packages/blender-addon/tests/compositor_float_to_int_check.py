# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_FLOAT_TO_INT_CHECK_PASSED
"""Actual scalar schema, literal guards and optional native composed references."""
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import types

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'packages/blendlink/blender'))
sys.path.insert(0, str(ROOT / 'packages/blender-addon/tests'))
sys.path.insert(0, str(ROOT / 'experiments/float-to-int-native'))
import compositor_graph
import compositor_float_to_int as helper
from compositor_reference import NativeCompositorReference
from values import controls, word

DESTINATION = os.environ.get('BLENDLINK_FLOAT_TO_INT_REFERENCES')
DEVICE = os.environ.get('BLENDLINK_FLOAT_TO_INT_DEVICE', 'CPU')
assert DEVICE in {'CPU', 'GPU'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def state(tree):
    def default(socket):
        value = getattr(socket, 'default_value', None)
        if isinstance(value, float):
            return word(value)
        return value if value is None or isinstance(value, (str, int, bool)) else tuple(value)
    return repr([(node.bl_idname, node.name, getattr(node, 'rounding_mode', None),
                  [(socket.identifier, default(socket)) for socket in node.inputs],
                  [(socket.identifier, default(socket)) for socket in node.outputs]) for node in tree.nodes]) + repr(
                      sorted((link.from_node.name, link.from_socket.identifier, link.to_node.name,
                              link.to_socket.identifier) for link in tree.links))


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=False)
    scene = bpy.context.scene
    if hasattr(scene, 'compositing_node_group'):
        tree = bpy.data.node_groups.new('Artist Float to Integer', 'CompositorNodeTree')
        tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        scene.compositing_node_group = tree
    else:
        scene.use_nodes = True
        tree = scene.node_tree
    return scene, tree


def main(destination):
    scene, tree = setup()
    try:
        tree.nodes.new('FunctionNodeFloatToInt')
    except RuntimeError as error:
        packet = {'status': 'NATIVE_NODE_UNAVAILABLE', 'version': list(bpy.app.version),
                  'build': bpy.app.build_hash.decode(), 'deviceRequested': DEVICE,
                  'context': 'CompositorNodeTree', 'numericalCases': 0, 'reason': str(error),
                  'fixtureSha256': digest(Path(__file__))}
        (destination / 'unavailable.json').write_text(json.dumps(packet, indent=2) + '\n')
        print('BLENDLINK_FLOAT_TO_INT_NATIVE_UNAVAILABLE ' + json.dumps(packet))
        return
    assert tuple(bpy.app.version) == (5, 3, 0), 'Review newly available native versions before qualifying them'
    tree.nodes.clear()
    node = tree.nodes.new('FunctionNodeFloatToInt')
    sink = tree.nodes.new('NodeGroupOutput')
    tree.links.new(node.outputs['Integer'], sink.inputs['Image'])
    if hasattr(scene.render, 'compositor_device'):
        scene.render.compositor_device = DEVICE
    before = state(tree)
    initial = compositor_graph.extract(scene)
    if initial['status'] != 'extracted':
        assert any('no verified native literal profile' in row['message'] for row in initial['diagnostics']), initial
        packet = {'status': 'SOURCE_ADMISSION_NA', 'version': list(bpy.app.version),
                  'numericalCases': 0, 'reason': initial['diagnostics'], 'fixtureSha256': digest(Path(__file__))}
        (destination / 'not-applicable.json').write_text(json.dumps(packet, indent=2) + '\n')
        print('BLENDLINK_FLOAT_TO_INT_SOURCE_ADMISSION_NA ' + json.dumps(packet))
        return
    assert before == state(tree)
    assert next(item for item in initial['ops'] if item['kind'] == 'float-to-int')['type'] == 'INT'
    for value in [2**-149, -2**-149, 2**24 + 2, -(2**24 + 2), math.inf, math.nan, .1]:
        assert not helper.literal_float(value), value
    for value in [-2**24, -.5 - 2**-24, -.5, -.5 + 2**-25, -0., 0., .5, 2**-126, -2**-126, 2**24]:
        assert helper.literal_float(value), value
    deep = {'kind': 'constant', 'type': 'VALUE', 'value': .5}
    for _ in range(9):
        deep = {'kind': 'convert', 'type': 'VALUE', 'fromType': 'VALUE', 'input': deep}
    assert helper.resolve_literal(deep, []) is None
    assert helper.resolve_literal({'kind': 'ref', 'type': 'VALUE', 'node': {}}, []) is None
    assert helper.resolve_literal({'kind': 'constant', 'type': 'RGBA', 'value': [.5] * 4}, []) is None
    for incoming in [2**24 + 2, -(2**24 + 2)]:
        node.inputs['Float'].default_value = incoming
        result = compositor_graph.extract(scene)
        assert result['status'] == 'unsupported' and any('literal/group constants' in d['message'] for d in result['diagnostics']), result
    node.inputs['Float'].default_value = .5
    math_node = tree.nodes.new('ShaderNodeMath')
    math_node.operation = 'ADD'
    math_node.inputs[0].default_value = .5
    tree.links.new(math_node.outputs[0], node.inputs['Float'])
    result = compositor_graph.extract(scene)
    assert result['status'] == 'unsupported' and any('literal/group constants' in d['message'] for d in result['diagnostics']), result
    tree.nodes.remove(math_node)
    # Typed implicit conversions and unknown fields do not earn a literal proof.
    for identifier in ['CompositorNodeRGB', 'CompositorNodeRLayers', 'FunctionNodeInputInt', 'FunctionNodeInputBool']:
        source = tree.nodes.new(identifier)
        tree.links.new(source.outputs[0], node.inputs['Float'])
        result = compositor_graph.extract(scene)
        assert result['status'] == 'unsupported' and any('literal/group constants' in d['message'] for d in result['diagnostics']), result
        tree.nodes.remove(source)
    value_node = tree.nodes.new('ShaderNodeValue')
    value_node.outputs[0].default_value = -.5
    reroute = tree.nodes.new('NodeReroute')
    tree.links.new(value_node.outputs[0], reroute.inputs[0])
    tree.links.new(reroute.outputs[0], node.inputs['Float'])
    assert compositor_graph.extract(scene)['status'] == 'extracted'
    value_node.outputs[0].keyframe_insert(data_path='default_value', frame=1)
    assert compositor_graph.extract(scene)['status'] == 'unsupported'
    value_node.outputs[0].keyframe_delete(data_path='default_value', frame=1)
    tree.nodes.remove(value_node)
    tree.nodes.remove(reroute)
    # Blender leaves an empty Action after key removal; discard only fixture animation.
    if tree.animation_data is not None:
        tree.animation_data_clear()
    copied = False
    staged = Path(os.environ.get('BLENDLINK_FLOAT_TO_INT_ADDON', ROOT / 'packages/blendlink/dist/addon'))
    if os.environ.get('BLENDLINK_FLOAT_TO_INT_ADDON'):
        assert (staged / 'compositor_float_to_int.py').read_bytes() == Path(helper.__file__).read_bytes()
        with tempfile.TemporaryDirectory(prefix='blendlink-float-int-package-') as temporary:
            package = Path(temporary) / 'isolated_float_int_extension'
            package.mkdir()
            for file in staged.iterdir():
                if file.suffix in {'.py', '.json'}:
                    shutil.copy2(file, package / file.name)
            name = package.name
            module = types.ModuleType(name)
            module.__path__ = [str(package)]
            sys.modules[name] = module
            try:
                qualified = importlib.import_module(name + '.compositor_graph')
                assert qualified.normalize_float_to_int.__module__ == name + '.compositor_float_to_int'
                assert qualified.extract(scene) == compositor_graph.extract(scene)
                copied = True
            finally:
                for key in list(sys.modules):
                    if key == name or key.startswith(name + '.'):
                        sys.modules.pop(key, None)
    if not DESTINATION:
        print('BLENDLINK_FLOAT_TO_INT_LITERAL_POLICY_PASSED ' + json.dumps({'version': list(bpy.app.version), 'device': DEVICE, 'copiedNamespace': copied}))
        return

    oracle = NativeCompositorReference(destination, device=DEVICE, name='Artist Float to Integer', image_only_scene=True)
    scene, tree = oracle.scene, oracle.tree
    scene.render.engine = 'BLENDER_EEVEE'
    scene.world = None
    rows = []
    source_hashes = {str(path.relative_to(ROOT)): digest(path) for path in [Path(__file__), Path(helper.__file__), Path(compositor_graph.__file__), ROOT / 'experiments/float-to-int-native/values.py']}
    candidates = [item for item in controls() if helper.literal_float(item['value'])]

    def reset():
        tree.nodes.clear()
        return tree.nodes.new('NodeGroupOutput')

    def convert(value, mode, target=tree):
        convert_node = target.nodes.new('FunctionNodeFloatToInt')
        convert_node.rounding_mode = mode
        if isinstance(value, (int, float)):
            convert_node.inputs['Float'].default_value = value
        else:
            target.links.new(value, convert_node.inputs['Float'])
        return convert_node.outputs['Integer']

    def capture(label, sink, field):
        tree.links.new(field, sink.inputs['Image'])
        for item in tree.nodes:
            item.show_preview = False
        source = None
        if label.endswith(('-group', '-instances', '-integer-consumer', '-literal-3f000000')):
            source = destination / (label + '.blend')
            bpy.ops.wm.save_as_mainfile(filepath=str(source))
            source_sha = digest(source)
        original = state(tree)
        program = compositor_graph.extract(scene)
        assert program['status'] == 'extracted', program
        assert original == state(tree), 'Extraction changed source defaults/links'
        scene.render.filepath = str(destination / (label + '.exr'))
        with oracle._render_sampling():
            bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(scene.render.filepath, check_existing=False)
        image.alpha_mode = 'PREMUL'
        pixels = np.empty(8 * 8 * 4, np.float32)
        image.pixels.foreach_get(pixels)
        bpy.data.images.remove(image)
        assert np.isfinite(pixels).all() and original == state(tree)
        file = destination / (label + '.rgba32f')
        file.write_bytes(pixels.tobytes())
        program_path = destination / (label + '.program.json')
        program_path.write_text(json.dumps(program, indent=2) + '\n')
        rows.append({'case': label, 'pixelFile': file.name, 'pixelSha256': digest(file),
                     'programFile': program_path.name, 'programSha256': digest(program_path),
                     'sourcePreserved': True, **({'sourceFile': source.name, 'sourceSha256': source_sha} if source else {})})
        if source:
            assert digest(source) == source_sha, 'Oracle changed saved source bytes'
        return program

    for mode in ['ROUND', 'FLOOR', 'CEILING', 'TRUNCATE']:
        for item in candidates:
            sink = reset()
            capture(mode.lower() + '-literal-' + item['word'], sink, convert(item['value'], mode))
        sink = reset()
        value = tree.nodes.new('ShaderNodeValue')
        value.outputs[0].default_value = -1.5
        capture(mode.lower() + '-linked', sink, convert(value.outputs[0], mode))
        sink = reset()
        group = bpy.data.node_groups.new('Authored literal group ' + mode, 'CompositorNodeTree')
        group.interface.new_socket(name='Float', in_out='INPUT', socket_type='NodeSocketFloat')
        group.interface.new_socket(name='Integer', in_out='OUTPUT', socket_type='NodeSocketInt')
        incoming = group.nodes.new('NodeGroupInput')
        outgoing = group.nodes.new('NodeGroupOutput')
        group.links.new(convert(incoming.outputs[0], mode, group), outgoing.inputs[0])
        instance = tree.nodes.new('CompositorNodeGroup')
        instance.node_tree = group
        instance.inputs['Float'].default_value = -1.5
        capture(mode.lower() + '-group', sink, instance.outputs[0])
        sink = reset()
        combine = tree.nodes.new('CompositorNodeCombineColor')
        for channel, value in zip(['Red', 'Green', 'Blue'], [-.5, .5, .5 - 2**-25]):
            tree.links.new(convert(value, mode), combine.inputs[channel])
        capture(mode.lower() + '-instances', sink, combine.outputs[0])
        sink = reset()
        integer = tree.nodes.new('FunctionNodeIntegerMath')
        integer.operation = 'ADD'
        tree.links.new(convert(.5, mode), integer.inputs[0])
        integer.inputs[1].default_value = 2
        capture(mode.lower() + '-integer-consumer', sink, integer.outputs[0])
        sink = reset()
        compare = tree.nodes.new('FunctionNodeCompare')
        compare.data_type = 'INT'
        compare.operation = 'EQUAL'
        active = [socket for socket in compare.inputs if socket.enabled and not getattr(socket, 'is_unavailable', False)]
        assert len(active) == 2
        tree.links.new(convert(.5, mode), active[0])
        active[1].default_value = 1 if mode in {'ROUND', 'CEILING'} else 0
        capture(mode.lower() + '-compare-consumer', sink, compare.outputs[0])
    report = {'status': 'CAPTURED_LITERAL_PRODUCTION_CANDIDATE', 'version': list(bpy.app.version),
              'build': bpy.app.build_hash.decode(), 'device': DEVICE, 'sourceEvaluator': 'CPU-MF including GPU single values',
              'copiedNamespace': copied, 'sourcePreserved': True, 'sourceHashes': source_hashes,
              'width': 8, 'height': 8, 'cases': rows}
    (destination / 'qualification.json').write_text(json.dumps(report, indent=2) + '\n')
    print('BLENDLINK_FLOAT_TO_INT_REFERENCES_PASSED ' + json.dumps({'device': DEVICE, 'cases': len(rows)}))


if DESTINATION:
    destination = Path(DESTINATION).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    main(destination)
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-float-int-check-') as temporary:
        main(Path(temporary))
print('BLENDLINK_FLOAT_TO_INT_CHECK_PASSED ' + bpy.app.version_string)
