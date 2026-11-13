# SPDX-License-Identifier: GPL-3.0-or-later
"""Load a copied built add-on under its real relative-import package seam."""
import importlib.util
import importlib
import json
import os
from pathlib import Path
import sys
import bpy
root=Path(os.environ['BLENDLINK_CAMERA_DATA_ADDON']).resolve()
name='blendlink_isolated_camera_data_probe'
spec=importlib.util.spec_from_file_location(name,root/'__init__.py',submodule_search_locations=[str(root)])
addon=importlib.util.module_from_spec(spec);sys.modules[name]=addon;spec.loader.exec_module(addon)
compiler=importlib.import_module(name+'.material_compiler')
helper=importlib.import_module(name+'.camera_data_ir')
assert Path(helper.__file__).resolve().parent==root
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
mesh=bpy.data.meshes.new('Installed camera mesh');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)])
owner=bpy.data.objects.new('Installed camera owner',mesh);scene.collection.objects.link(owner)
material=bpy.data.materials.new('Installed automatic Camera Data');material.use_nodes=True;mesh.materials.append(material)
bsdf=next(node for node in material.node_tree.nodes if node.type=='BSDF_PRINCIPLED')
camera_node=material.node_tree.nodes.new('ShaderNodeCameraData');material.node_tree.links.new(camera_node.outputs['View Vector'],bsdf.inputs['Base Color'])
camera=bpy.data.objects.new('Installed camera',bpy.data.cameras.new('Installed camera'));scene.collection.objects.link(camera);scene.camera=camera;camera.location.z=20
before=(len(material.node_tree.nodes),len(material.node_tree.links),list(material.keys()))
plan=compiler.plan_materials([owner],automatic_programs=True).decisions[0].as_dict()
channel=next(item for item in plan['channels']['channels'] if item['channel']=='Base Color')
assert plan['channels']['automatic'] and channel['route']=='program' and helper.required(channel['tslIr']),plan
assert before==(len(material.node_tree.nodes),len(material.node_tree.links),list(material.keys()))
print('BLENDLINK_CAMERA_DATA_PACKAGE_PASSED '+json.dumps({'version':bpy.app.version_string,'helper':str(Path(helper.__file__).resolve()),'route':channel['route']}))
