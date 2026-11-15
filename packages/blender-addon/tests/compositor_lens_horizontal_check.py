# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Candidate pinned CPU horizontal Lens Distortion source policy; no renders or GPU work.
# blendlink-headless-sentinel: SCENETOWEB_LENS_HORIZONTAL_SOURCE_POLICY_PASSED
from pathlib import Path
import json
import sys
import bpy
import gpu

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'packages/blendlink/blender'))
import compositor_graph

blocked = {'gpu': 0, 'render': 0}
def no_gpu(*args, **kwargs):
    blocked['gpu'] += 1
    raise RuntimeError('Horizontal lens source policy forbids gpu.init')
gpu.init = no_gpu
original_ops = bpy.ops
class RenderGuard:
    def __getattr__(self, name):
        def denied(*args, **kwargs):
            blocked['render'] += 1
            raise RuntimeError('Horizontal lens source policy forbids render operators')
        return denied
class OpsGuard:
    def __getattr__(self, name):
        return RenderGuard() if name == 'render' else getattr(original_ops, name)
bpy.ops = OpsGuard()
for action in (gpu.init, bpy.ops.render.render):
    try:
        action()
    except RuntimeError as error:
        assert 'source policy forbids' in str(error)
    else:
        raise AssertionError('Source policy guard did not reject a forbidden call')
assert blocked == {'gpu': 1, 'render': 1}
blocked = {'gpu': 0, 'render': 0}
scene = bpy.context.scene
scene.render.compositor_device = 'CPU'
scene.render.compositor_precision = 'FULL'
scene.render.resolution_x = 13
scene.render.resolution_y = 9
scene.render.resolution_percentage = 100
scene.render.use_compositing = True
positive, refusals = [], []

def setup():
    tree = bpy.data.node_groups.new('Owned horizontal lens policy', 'CompositorNodeTree')
    tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    scene.compositing_node_group = tree
    image = tree.nodes.new('CompositorNodeRLayers')
    node = tree.nodes.new('CompositorNodeLensdist')
    node.inputs['Type'].default_value = 'Horizontal'
    node.inputs['Dispersion'].default_value = .2
    end = tree.nodes.new('NodeGroupOutput')
    tree.links.new(image.outputs['Image'], node.inputs['Image'])
    tree.links.new(node.outputs['Image'], end.inputs[0])
    return tree, node, end

def check(label, accepted):
    before = [(group.as_pointer(), group.users) for group in bpy.data.node_groups]
    frame = scene.frame_current, scene.frame_subframe
    result = compositor_graph.extract(scene)
    assert before == [(group.as_pointer(), group.users) for group in bpy.data.node_groups]
    assert frame == (scene.frame_current, scene.frame_subframe)
    assert result['status'] == ('extracted' if accepted else 'unsupported'), (label, result)
    if accepted:
        positive.append(label)
        op = next(op for op in result['ops'] if op['source']['nodeType'] == 'CompositorNodeLensdist')
        assert op['kind'] == 'lens-horizontal'
        assert op['properties']['lens_horizontal_controls'] == ['Horizontal', 0, 0x3e4ccccd, False, False]
        assert len(result['ops']) == 2
    else:
        refusals.append(label)
        assert any('lens-horizontal' in row['code'] or row['code'] == 'animated-tree' for row in result['diagnostics']), result
    return result

tree, node, end = setup()
check('classroom-original-controls', True)
tree, node, end = setup()
route = tree.nodes.new('NodeReroute')
tree.links.new(node.outputs['Image'], route.inputs[0])
tree.links.new(route.outputs[0], end.inputs[0])
check('rerouted-output', True)
for name, value in [('Type', 'Radial'), ('Distortion', -.0), ('Distortion', .001),
                    ('Dispersion', 0), ('Dispersion', .21), ('Jitter', True), ('Fit', True)]:
    tree, node, end = setup()
    node.inputs[name].default_value = value
    check('control-' + name + '-' + str(value), False)
tree, node, end = setup()
value = tree.nodes.new('ShaderNodeValue')
tree.links.new(value.outputs[0], node.inputs['Dispersion'])
check('linked-dispersion', False)
tree, node, end = setup()
rgb = tree.nodes.new('CompositorNodeRGB')
tree.links.new(rgb.outputs[0], node.inputs['Image'])
check('constant-producer', False)
tree, node, end = setup()
next_node = tree.nodes.new('CompositorNodeTranslate')
tree.links.new(node.outputs[0], next_node.inputs['Image'])
tree.links.new(next_node.outputs[0], end.inputs[0])
check('downstream-transform', False)
tree, node, end = setup()
scene.render.compositor_device = 'GPU'
check('GPU-compositor', False)
scene.render.compositor_device = 'CPU'
tree, node, end = setup()
scene.render.resolution_x = 2049
scene.render.resolution_y = 2048
check('pixel-budget', False)
scene.render.resolution_x, scene.render.resolution_y = 13, 9
tree, node, end = setup()
node.inputs['Dispersion'].keyframe_insert('default_value', frame=1)
check('animated-control', False)
tree, node, end = setup()
original_normalize = compositor_graph.lens_horizontal.normalize
def change_after_read(*args, **kwargs):
    result = original_normalize(*args, **kwargs)
    node.inputs['Dispersion'].default_value = .21
    return result
compositor_graph.lens_horizontal.normalize = change_after_read
try:
    check('late-raw-dispersion-change', False)
finally:
    compositor_graph.lens_horizontal.normalize = original_normalize
assert blocked == {'gpu': 0, 'render': 0}
print('SCENETOWEB_LENS_HORIZONTAL_SOURCE_POLICY_PASSED ' + json.dumps({
    'positive': positive, 'refusals': refusals, 'supportCredit': 0,
    'nativeRenders': 0, 'gpuInitializations': 0, 'blockedPolicyCalls': blocked,
}))
