# SPDX-License-Identifier: MIT
"""Real saved artist scenes; no oracle image replaces Render Layers."""
import hashlib
import json
import sys
from pathlib import Path

import bpy

output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=False)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE' if bpy.app.version >= (5, 0, 0) else 'BLENDER_EEVEE_NEXT'
if hasattr(scene.render, 'compositor_device'): scene.render.compositor_device = 'CPU'
scene.render.resolution_x, scene.render.resolution_y = 640, 480
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
for obj in scene.objects: obj['blendlink_id'] = 'keyer-flow-' + obj.name.lower()
cube = bpy.data.objects['Cube']
cube.rotation_euler = (.15, .3, .2)
material = cube.active_material
material.use_nodes = True
principled = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
principled.inputs['Base Color'].default_value = (.8, .2, .04, 1)
principled.inputs['Roughness'].default_value = .7
scene.world.use_nodes = True
background = next(node for node in scene.world.node_tree.nodes if node.type == 'BACKGROUND')
background.inputs['Color'].default_value = (.1414213478565216,) * 3 + (1,)
background.inputs['Strength'].default_value = 1
recipe = {'schemaVersion': 1, 'presentation': 'realtime',
    'atlases': [{'id': 'main', 'name': 'Main', 'size': 256, 'targetDensity': 8, 'margin': 4, 'fitPolicy': 'block', 'bakeOutput': 'appearance'}],
    'states': [{'name': 'default'}],
    'preview': {'samples': 1, 'supersample': 1, 'denoise': False, 'resolutionScale': 1},
    'final': {'samples': 1, 'supersample': 1, 'denoise': False, 'resolutionScale': 1},
    'camera': {'objectId': scene.camera['blendlink_id'], 'objectName': scene.camera.name,
        'behavior': 'fixed', 'framing': 'authored', 'compositions': [{'name': 'Desktop', 'width': 640, 'height': 480, 'safeMargin': .08}]}}
scene['blendlink_recipe'] = json.dumps(recipe)
scene.render.use_compositing = True
if hasattr(scene, 'compositing_node_group'):
    tree = bpy.data.node_groups.new('Artist CPU Keyer Flow', 'CompositorNodeTree')
    tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    scene.compositing_node_group = tree
    sink = tree.nodes.new('NodeGroupOutput')
else:
    scene.use_nodes = True
    tree = scene.node_tree; tree.nodes.clear(); sink = tree.nodes.new('CompositorNodeComposite')
layers = tree.nodes.new('CompositorNodeRLayers')
luma = tree.nodes.new('CompositorNodeLumaMatte'); luma.name = 'Artist Exact CPU Luminance'
if luma.inputs.get('Minimum') is not None:
    luma.inputs['Minimum'].default_value = .1; luma.inputs['Maximum'].default_value = .3
else: luma.limit_min, luma.limit_max = .1, .3
difference = tree.nodes.new('CompositorNodeDiffMatte'); difference.name = 'Artist Exact CPU Difference'
difference.inputs['Image 2'].default_value = (.02, .05, .08, 1)
if difference.inputs.get('Tolerance') is not None:
    difference.inputs['Tolerance'].default_value = .02; difference.inputs['Falloff'].default_value = .25
else: difference.tolerance, difference.falloff = .02, .25
tree.links.new(layers.outputs['Image'], luma.inputs['Image'])
tree.links.new(luma.outputs['Image'], difference.inputs['Image 1'])
records = []
for name, source in [('Identity', layers.outputs['Image']), ('Luminance', luma.outputs['Image']), ('Both', difference.outputs['Image'])]:
    tree.links.new(source, sink.inputs[0])
    path = output / (name + '.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    records.append({'variant': name, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
(output / 'source-receipt.json').write_text(json.dumps({'nativeVersion': list(bpy.app.version),
    'buildHash': bpy.app.build_hash.decode(), 'sceneEngine': scene.render.engine,
    'compositorDevice': getattr(scene.render, 'compositor_device', 'CPU'), 'files': records}, indent=2))
print('BLENDLINK_KEYER_FINAL_FIXTURE_READY')
