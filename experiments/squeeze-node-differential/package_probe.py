# SPDX-License-Identifier: GPL-3.0-or-later
"""Copied package's real relative-import and automatic material planning seam."""
import importlib,importlib.util,os,sys,json
from pathlib import Path
import bpy
root=Path(os.environ['BLENDLINK_SQUEEZE_ADDON']).resolve();name='blendlink_isolated_squeeze_probe'
spec=importlib.util.spec_from_file_location(name,root/'__init__.py',submodule_search_locations=[str(root)])
addon=importlib.util.module_from_spec(spec);sys.modules[name]=addon;spec.loader.exec_module(addon)
compiler=importlib.import_module(name+'.material_compiler');helper=importlib.import_module(name+'.squeeze_ir')
assert Path(helper.__file__).resolve().parent==root
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
mesh=bpy.data.meshes.new('Installed Squeeze triangle');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)])
owner=bpy.data.objects.new('Installed Squeeze owner',mesh);bpy.context.scene.collection.objects.link(owner)
material=bpy.data.materials.new('Installed unmarked Squeeze');material.use_nodes=True;mesh.materials.append(material)
root_node=next(node for node in material.node_tree.nodes if node.type=='BSDF_PRINCIPLED');node=material.node_tree.nodes.new('ShaderNodeSqueeze');material.node_tree.links.new(node.outputs[0],root_node.inputs['Base Color'])
before=(len(material.node_tree.nodes),len(material.node_tree.links),list(material.keys()))
try:
 compiler.tsl_ir.emit_channel(root_node.inputs['Base Color'],evaluation_engine='EEVEE')
except compiler.tsl_ir.TslIrRefusal as error:
 assert any(text in str(error) for text in ['source attestation is N/A','has no verified live source profile','requires actual native GPU backend attestation','has no verified live source precision profile for actual GPU backend']),error
 status='SOURCE_ATTESTATION_NA'
else:
 plan=compiler.plan_materials([owner],automatic_programs=True).decisions[0].as_dict()
 channel=next(value for value in plan['channels']['channels'] if value['channel']=='Base Color')
 assert plan['channels']['automatic'] and channel['route']=='program' and channel['tslIr']['output']['op']=='squeeze_native',plan
 status='PROGRAM_QUALIFIED'
assert before==(len(material.node_tree.nodes),len(material.node_tree.links),list(material.keys()))
print('BLENDLINK_SQUEEZE_PACKAGE_PASSED '+json.dumps({'version':bpy.app.version_string,'status':status,'helper':str(Path(helper.__file__).resolve())}))
