# SPDX-License-Identifier: MIT
"""Create a small authored woodland scene for Preview Studio checks."""
import json
import math
import sys
import uuid
from pathlib import Path

import bpy
from mathutils import Vector

out = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*color, 1)
    return m
grass = material('Meadow', (0.24, 0.42, 0.2))
earth = material('Earth', (0.2, 0.105, 0.055))
wood = material('Honey timber', (0.65, 0.32, 0.13))
roof = material('Terracotta roof', (0.55, 0.12, 0.055))
leaves = material('Pine needles', (0.055, 0.24, 0.15))
stone = material('Path stone', (0.52, 0.5, 0.4))
glass = material('Pale blue window', (0.2, 0.55, 0.65))

def finish(name, mat, scale):
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj['blendlink_id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'blendlink-woodland/' + name))
    return obj

def box(name, pos, scale, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    return finish(name, mat, scale)

def cone(name, pos, radius, depth, mat, vertices=8, top=0):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=top, depth=depth, location=pos)
    return finish(name, mat, (1, 1, 1))
cone('Island earth', (0, 0, -0.3), 2.9, 0.6, earth, 12, 3)
cone('Meadow top', (0, 0, 0.035), 3, 0.07, grass, 12, 3)
box('Cabin', (0.3, 0.35, 0.65), (1.5, 1.35, 1.3), wood)
for x, angle in [(-0.17, -32), (0.77, 32)]:
    obj = box('Roof left' if x < 0 else 'Roof right', (x, 0.35, 1.55), (1.18, 1.65, 0.13), roof)
    obj.rotation_euler.y = math.radians(angle)
box('Door', (0.3, -0.34, 0.43), (0.38, 0.05, 0.8), earth)
box('Window', (0.82, -0.34, 0.83), (0.3, 0.06, 0.32), glass)
box('Chimney', (0.8, 0.65, 1.85), (0.23, 0.28, 0.55), stone)
for i, (x, y, height) in enumerate([(-1.65, 0.7, 1.65), (-1.1, 1.65, 1.9), (1.65, 1.1, 1.5), (1.9, -0.55, 1.1), (-2, -0.6, 1.2)]):
    cone(f'Pine {i} trunk', (x, y, 0.3), 0.085, 0.6, wood, 6, 0.065)
    cone(f'Pine {i} lower', (x, y, height * 0.48), height * 0.31, height * 0.72, leaves)
    cone(f'Pine {i} crown', (x, y, height * 0.78), height * 0.24, height * 0.64, leaves)
for i in range(5):
    cone(f'Stepping stone {i}', (0.3 - i * 0.09, -0.65 - i * 0.34, 0.1), 0.17, 0.08, stone, 7, 0.17)
for i, (x, y) in enumerate([(-1, -1.5), (-1.5, -1.25), (1.2, -1.5)]):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.22, location=(x, y, 0.15))
    finish(f'Rock {i}', stone, (1.2, 0.8, 0.7))
world = bpy.data.worlds.new('Soft sky')
world.use_nodes = True
world.node_tree.nodes.get('Background').inputs['Color'].default_value = (0.55, 0.68, 0.8, 1)
world.node_tree.nodes.get('Background').inputs['Strength'].default_value = 0.65
scene.world = world
bpy.ops.object.light_add(type='AREA', location=(-3, -4, 7))
bpy.context.object.data.energy = 650
bpy.context.object.data.shape = 'DISK'
bpy.context.object.data.size = 4
bpy.context.object.rotation_euler = (Vector((0, 0, 0)) - bpy.context.object.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add(location=(7, -10, 7))
scene.camera = bpy.context.object
scene.camera.rotation_euler = (Vector((0, 0, 0.7)) - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera.data.type = 'ORTHO'
scene.camera.data.ortho_scale = 8
scene.render.resolution_x = 1200
scene.render.resolution_y = 900
scene['blendlink_recipe'] = json.dumps({
    'schemaVersion': 1,
    'presentation': 'hybrid',
    'atlases': [{
        'id': 'main', 'name': 'Main', 'size': 512, 'targetDensity': 16,
        'margin': 4, 'fitPolicy': 'block', 'bakeOutput': 'appearance',
    }],
    'preview': {'samples': 16, 'supersample': 1, 'denoise': True, 'resolutionScale': 1},
    'final': {'samples': 16, 'supersample': 1, 'denoise': True, 'resolutionScale': 1},
    'states': [{'name': 'default'}],
})
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out), compress=True)
print('WOODLAND_DIORAMA', out)
