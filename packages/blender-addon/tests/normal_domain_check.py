# SPDX-License-Identifier: GPL-3.0-or-later
"""Native normal-domain blocking and package-qualified compiler regression."""
import importlib.util
from pathlib import Path
import sys
import bpy

addon=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(addon));sys.path.insert(0,str(addon.parent/'blendlink/blender'))
import material_compiler as compiler

bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='CYCLES'
mesh=bpy.data.meshes.new('Normal field');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)]);mesh.update();mesh.polygons[0].use_smooth=True
owner=bpy.data.objects.new('Normal owner',mesh);scene.collection.objects.link(owner)
material=bpy.data.materials.new('Normal program');material.use_nodes=True;mesh.materials.append(material)
tree=material.node_tree;bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
normal=tree.nodes.new('ShaderNodeNormalMap');normal.space='WORLD';normal.inputs['Color'].default_value=(.8,.6,.9,1)
tree.links.new(normal.outputs['Normal'],bsdf.inputs['Normal']);compiler.set_tsl_ir(material,True)
def plan(module=compiler):return module.plan_materials([owner],purpose='final',automatic_programs=True)
assert not plan().errors
coordinates=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(coordinates.outputs['Generated'],normal.inputs['Color'])
failed=plan();assert any(issue.code=='material.normal-map-program-unproven' for issue in failed.errors),failed.errors
tree.nodes.remove(coordinates)
normal.space='OBJECT';normal.inputs['Color'].default_value=(.5,.5,.5,1)
failed=plan();assert any(issue.code=='material.normal-map-program-unproven' for issue in failed.errors),failed.errors
normal.space='WORLD'
assert not plan().errors  # Cycles' explicit zero-color fallback is defined.
eevee='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in {item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE'
scene.render.engine=eevee;normal.inputs['Color'].default_value=(.5,.5,.5,1)
failed=plan();assert any(issue.code=='material.normal-map-domain-unproven' and 'zero-length' in issue.problem for issue in failed.errors),failed.errors
normal.inputs['Color'].default_value=(.8,.6,.9,1)
assert not plan().errors
normal.inputs['Color'].default_value=(.8,.5,.9,1);normal.inputs['Strength'].default_value=.5
assert not plan().errors
import math
owner.rotation_euler.y=math.asin(.6);bpy.context.view_layer.update()
failed=plan();assert any(issue.code=='material.normal-map-domain-unproven' and 'normal cone' in issue.problem for issue in failed.errors),failed.errors
owner.rotation_euler.y=0;normal.inputs['Strength'].default_value=1;bpy.context.view_layer.update()
name='blendlink_normal_domain_package_check'
spec=importlib.util.spec_from_file_location(name,addon/'__init__.py',submodule_search_locations=[str(addon)])
package=importlib.util.module_from_spec(spec);sys.modules[name]=package;spec.loader.exec_module(package)
assert not plan(package.material_compiler).errors
# The normal-specific early refusal must not assume every material has a
# Principled root. Surface-resolved emission retains its established route.
tree.nodes.clear();emission=tree.nodes.new('ShaderNodeEmission');output=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(emission.outputs[0],output.inputs['Surface'])
plan()
print('BLENDLINK_NORMAL_DOMAIN_PASSED '+bpy.app.version_string)
