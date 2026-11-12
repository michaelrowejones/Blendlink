# SPDX-License-Identifier: GPL-3.0-or-later
"""Selected Material Outputs determine node semantics without context leaks."""
import sys
from pathlib import Path
import bpy
root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'packages/blender-addon'))
sys.path.insert(0, str(root / 'packages/blendlink/blender'))
import tsl_ir
import material_compiler

scene = bpy.context.scene
original = scene.render.engine
try:
    scene.render.engine = 'CYCLES'
    material = bpy.data.materials.new('Selected Source Engine')
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    temperatures = {'CYCLES': 6500, 'EEVEE': 1300}
    outputs = []
    roots = {}
    for target in ('CYCLES', 'EEVEE'):
        blackbody = tree.nodes.new('ShaderNodeBlackbody')
        blackbody.inputs['Temperature'].default_value = temperatures[target]
        principled = tree.nodes.new('ShaderNodeBsdfPrincipled')
        tree.links.new(blackbody.outputs['Color'], principled.inputs['Base Color'])
        tree.links.new(blackbody.outputs['Color'], principled.inputs['Emission Color'])
        roots[target] = principled
        output = tree.nodes.new('ShaderNodeOutputMaterial')
        output.target = target
        output.is_active_output = True
        tree.links.new(principled.outputs['BSDF'], output.inputs['Surface'])
        outputs.append(output)
    for target in ('CYCLES', 'EEVEE'):
        channels = [{'channel': 'Base Color'}, {'channel': 'Emission'}]
        material_compiler._attach_tsl_ir(tree, channels, target=target)
        base = channels[0].get('tslIr', {}).get('output', {})
        emission = channels[1].get('tslIr', {}).get('output', {}).get('input', {})
        assert base.get('sourceEngine') == target, channels
        assert base.get('input', {}).get('value') == temperatures[target], 'Compiler selected the wrong target graph'
        assert emission.get('sourceEngine') == target, channels
        assert tsl_ir.get_evaluation_engine() == 'CYCLES', 'Compiler engine leaked after a channel batch'
        surface = tsl_ir.emit_surface(tree, target=target)
        assert surface['channels']['Base Color']['output']['sourceEngine'] == target
        assert tsl_ir.get_evaluation_engine() == 'CYCLES', 'Surface engine leaked'
    for output in outputs:
        tree.nodes.remove(output)
    principled = roots['CYCLES']
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    output.target = 'ALL'
    tree.links.new(principled.outputs['BSDF'], output.inputs['Surface'])
    with tsl_ir.emission_context(tree=tree, target='EEVEE'):
        assert tsl_ir.get_evaluation_engine() == 'CYCLES', 'ALL did not follow scene engine'
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    with tsl_ir.emission_context(tree=tree, target='CYCLES'):
        assert tsl_ir.get_evaluation_engine() == 'EEVEE', 'ALL did not normalize the source EEVEE engine'
        try:
            with tsl_ir.emission_context(evaluation_engine='CYCLES'):
                assert tsl_ir.get_evaluation_engine() == 'CYCLES'
                raise RuntimeError('intentional nested refusal')
        except RuntimeError:
            pass
        assert tsl_ir.get_evaluation_engine() == 'EEVEE', 'Nested failure leaked context'
    direct = tsl_ir.emit_channel(principled.inputs['Base Color'], evaluation_engine='CYCLES')
    assert direct['output']['sourceEngine'] == 'CYCLES'
    assert tsl_ir.get_evaluation_engine() == 'EEVEE', 'Explicit channel context leaked'
    bpy.data.materials.remove(material)
finally:
    scene.render.engine = original
print('BLENDLINK_EMISSION_CONTEXT_CHECK_PASSED selected targets, ALL scene fallback, weighted channels and reset')
