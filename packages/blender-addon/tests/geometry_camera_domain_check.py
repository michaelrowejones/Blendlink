# SPDX-License-Identifier: GPL-3.0-or-later
"""CPU-only source policy and real material-planner guard controls; no render/save."""
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import bpy

addon = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(addon)); sys.path.insert(0, str(addon.parent / 'blendlink/blender'))
import geometry_ir
import material_compiler as compiler

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE' if bpy.app.version >= (5, 3, 0) else 'BLENDER_EEVEE_NEXT'
camera = bpy.data.objects.new('Static camera domain control', bpy.data.cameras.new('Static camera domain control'))
scene.collection.objects.link(camera); scene.camera = camera; camera.location.z = 5
camera.data.shift_y = -.09
scene.render.use_border = True; scene.render.use_crop_to_border = False
scene.render.border_min_x = 0; scene.render.border_min_y = 0
scene.render.border_max_x = 1; scene.render.border_max_y = 1
mesh = bpy.data.meshes.new('Camera-domain triangle')
mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], [(0, 1, 2)]); mesh.update()
owner = bpy.data.objects.new('Camera-domain owner', mesh); scene.collection.objects.link(owner)
bpy.context.view_layer.update()

context = {'op': 'geometry_context', 'model': 'primary-triangles-v1', 'sourceEngine': 'EEVEE', 'normalStorage': 'SNORM10', 'output': 'object-normal'}
error = 'Primary geometry view coordinates have no verified shifted/cropped camera projection binding'
checks = 0
def refused(outputs={'object-normal'}, ir=context, expected=error):
    global checks
    try: geometry_ir.validate_owner(owner, outputs, ir)
    except ValueError as exception: assert str(exception) == expected, str(exception)
    else: raise AssertionError('Unqualified source camera domain was admitted: ' + str(outputs))
    checks += 1
def allowed():
    global checks
    geometry_ir.validate_owner(owner, {'object-normal'}, {'channels': [{'expression': context}]})
    checks += 1

qualified = bpy.app.version == (5, 3, 0) and bpy.app.build_hash == b'02f0899d78e3'
if qualified:
    allowed()  # Real shifted source plus exact original full-rectangle border flag.
    scene.render.use_border = False; allowed()
    camera.data.shift_y = 0; scene.render.use_border = True; allowed()
    camera.data.shift_y = -.09
    for output in geometry_ir.VIEW_OUTPUTS - {'object-normal'}:
        refused({output}, {**context, 'output': output})
        refused({'object-normal', output}, [context, {**context, 'output': output}])
    refused(ir=None); refused(ir={})
    for key, value in [('sourceEngine', 'CYCLES'), ('normalStorage', 'SNORM16'), ('normalStorage', 'FLOAT32'), ('model', 'unknown')]:
        refused(ir={**context, key: value})
    refused(ir=[context, {**context, 'sourceEngine': 'CYCLES'}])
    scene.render.engine = 'CYCLES'; refused(); scene.render.engine = 'BLENDER_EEVEE'
    scene.render.border_max_x = .75; refused(); scene.render.border_max_x = 1
    scene.render.border_min_y = .25; refused(); scene.render.border_min_y = 0
    scene.render.use_crop_to_border = True; refused(); scene.render.use_crop_to_border = False
    scene.render.use_multiview = True; refused(); scene.render.use_multiview = False
    scene.render.pixel_aspect_x = 2; refused(); scene.render.pixel_aspect_x = 1
    camera.data.type = 'ORTHO'; refused(); camera.data.type = 'PERSP'
    camera.data.keyframe_insert(data_path='shift_y', frame=1); refused(); camera.data.animation_data_clear()
    camera.scale = (2, 2, 2); bpy.context.view_layer.update(); refused()
    camera.scale = (-1, 1, 1); bpy.context.view_layer.update()
    refused(expected='Primary geometry context has no verified reflected/sheared camera projection binding')
    camera.scale = (1, 1, 1); bpy.context.view_layer.update()
    modifier = owner.modifiers.new('Unqualified deformation', 'DISPLACE')
    refused(expected='Geometry context currently requires authored triangle meshes without modifiers, skin or morph deformation')
    owner.modifiers.remove(modifier)
    @geometry_ir.cached_plan
    def cached_scope_control():
        allowed()
        refused(ir=None)
    cached_scope_control()
    # Actual EEVEE material emission -> IR collection -> owner camera policy.
    material = bpy.data.materials.new('Native Texture Coordinate Normal'); material.use_nodes = True; mesh.materials.append(material)
    bsdf = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    coordinates = material.node_tree.nodes.new('ShaderNodeTexCoord')
    material.node_tree.links.new(coordinates.outputs['Normal'], bsdf.inputs['Base Color'])
    compiler.set_tsl_ir(material, True)
    plan = compiler.plan_materials([owner], purpose='final', automatic_programs=True)
    assert not plan.errors, plan.errors
    decision = plan.decisions[0]
    assert not decision.issues, decision.issues
    outputs = set(); geometry_ir.collect_outputs(decision.channel_plan, outputs)
    assert outputs == {'object-normal'}, outputs
    for entry in decision.channel_plan['channels']:
        if 'tslIr' in entry:
            encoded = json.dumps(entry['tslIr'], sort_keys=True, separators=(',', ':')).encode()
            assert entry['tslIrHash'] == hashlib.sha256(encoded).hexdigest() and entry['tslIrBytes'] == len(encoded)
    checks += 1
    for output in ('Window', 'Reflection'):
        material.node_tree.links.new(coordinates.outputs[output], bsdf.inputs['Base Color'])
        blocked = compiler.plan_materials([owner], purpose='final', automatic_programs=True)
        assert any(issue.code == 'material.geometry-context-unproven' and issue.problem == error for issue in blocked.decisions[0].issues), blocked.decisions[0].issues
        assert any(channel.get('tslIrRefusal') == error and 'tslIr' not in channel for channel in blocked.decisions[0].channel_plan['channels'])
        checks += 1
    incoming = material.node_tree.nodes.new('ShaderNodeNewGeometry')
    material.node_tree.links.new(incoming.outputs['Incoming'], bsdf.inputs['Base Color'])
    blocked = compiler.plan_materials([owner], purpose='final', automatic_programs=True)
    assert any(issue.code == 'material.geometry-context-unproven' and issue.problem == error for issue in blocked.decisions[0].issues), blocked.decisions[0].issues
    checks += 1
else:
    refused()

# Policy witness: legacy versions and unknown native builds stay conservative.
original_bpy = geometry_ir.bpy
try:
    for version, build in [((4, 2, 0), b'legacy'), ((5, 2, 0), b'legacy'), ((5, 3, 1), b'02f0899d78e3'), ((5, 3, 0), b'unknown')]:
        geometry_ir.bpy = SimpleNamespace(app=SimpleNamespace(version=version, build_hash=build), context=bpy.context)
        refused()
        camera.data.shift_y = 0; scene.render.use_border = False
        geometry_ir.validate_owner(owner, {'object-normal'})  # Existing centered caller remains valid.
        checks += 1
        camera.data.shift_y = -.09; scene.render.use_border = True
finally:
    geometry_ir.bpy = original_bpy
print('BLENDLINK_GEOMETRY_CAMERA_DOMAIN_PASSED ' + json.dumps({'version': list(bpy.app.version), 'build': bpy.app.build_hash.decode(), 'qualified': qualified, 'checks': checks, 'rendered': False, 'saved': False}))
