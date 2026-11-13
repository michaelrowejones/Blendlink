# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned CPU-only exporter fixture. It never renders or creates image textures."""
import bpy,os
from pathlib import Path
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
owner=bpy.context.object;owner.name='Owned export throughput cube';owner['blendlink_id']='throughput-cube'
material=bpy.data.materials.new('Owned constant material');material.use_nodes=True
material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.125,.25,.5,1)
owner.data.materials.append(material)
bpy.ops.wm.save_as_mainfile(filepath=str(Path(os.environ['SCENETOWEB_EXPORT_THROUGHPUT_SCENE']).resolve()))
print('SCENETOWEB_OWNED_EXPORT_FIXTURE_SAVED no-render')
