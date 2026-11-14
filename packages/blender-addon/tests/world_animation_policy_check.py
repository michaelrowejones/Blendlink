# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned Blender5.3 no-render World animation publication-policy regression.
# blendlink-headless-sentinel: SCENETOWEB_WORLD_ANIMATION_POLICY_PASSED
"""The current-frame private preview exception never becomes Final animation."""
from pathlib import Path
import sys
import bpy
ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / 'packages/blendlink/blender'), str(ROOT / 'packages/blender-addon')]
import export_scene as exporter
assert Path(exporter.__file__).resolve() == ROOT / 'packages/blendlink/blender/export_scene.py'
assert tuple(bpy.app.version) == (5, 3, 0) and bpy.app.build_hash == b'02f0899d78e3'
scene = bpy.context.scene
previous = scene.world
worlds = tuple(bpy.data.worlds)
actions = tuple(bpy.data.actions)
world = bpy.data.worlds.new('.SceneToWeb World animation policy')
world.use_nodes = True
scene.world = world
tree = world.node_tree
background = next(node for node in tree.nodes if node.bl_idname == 'ShaderNodeBackground')
results = []
def check(label):
    issues = exporter.procedural.pointer_animation_issues(scene, objects=())
    assert len(issues) == 1 and issues[0]['object'] == 'World', (label, issues)
    for settings in ({}, {'draft': True}, {'authoringPreview': True}):
        try:
            exporter.enforce_pointer_animation_policy(settings, issues, 17.25)
        except SystemExit as error:
            assert 'Property animation blocked' in str(error)
        else:
            raise AssertionError((label, 'Final/connected publication accepted animation'))
    warnings = exporter.enforce_pointer_animation_policy({'draft': True, 'authoringPreview': True}, issues, 17.25)
    assert len(warnings) == 1 and 'PRIVATE PREVIEW ONLY' in warnings[0] and '17.25' in warnings[0]
    results.append(label)
try:
    assert exporter.procedural.pointer_animation_issues(scene, objects=()) == []
    world.keyframe_insert(data_path='color', frame=1)
    check('world-action')
    world.animation_data_clear()
    background.inputs['Strength'].keyframe_insert(data_path='default_value', frame=1)
    check('tree-action')
    action = tree.animation_data.action
    track = tree.animation_data.nla_tracks.new()
    track.strips.new('World policy NLA', 1, action)
    tree.animation_data.action = None
    check('tree-nla')
    tree.animation_data_clear()
    driver = background.inputs['Strength'].driver_add('default_value')
    driver.driver.expression = '1.0'
    check('tree-driver')
    tree.animation_data_clear()
    assert exporter.procedural.pointer_animation_issues(scene, objects=()) == []
finally:
    scene.world = previous
    bpy.data.worlds.remove(world)
    for action in tuple(bpy.data.actions):
        if action not in actions and action.users == 0:
            bpy.data.actions.remove(action)
assert tuple(bpy.data.worlds) == worlds and tuple(bpy.data.actions) == actions
print('SCENETOWEB_WORLD_ANIMATION_POLICY_PASSED ' + ','.join(results))
