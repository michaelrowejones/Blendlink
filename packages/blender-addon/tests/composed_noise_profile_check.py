# SPDX-License-Identifier: GPL-3.0-or-later
"""Qualify composed Noise fixtures without weakening their native graphs."""
import ast
from pathlib import Path
import platform
import sys
import bpy

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'packages/blender-addon'))
sys.path.insert(0, str(ROOT / 'packages/blendlink/blender'))
import bakelib
import tsl_ir


def fixture(name, factory):
    path = ROOT / 'experiments' / name / 'reference.py'
    functions = [node for node in ast.parse(path.read_text()).body
                 if isinstance(node, ast.FunctionDef) and node.name in {factory, 'source_qualified_noise_refusal'}]
    assert len(functions) == 2
    namespace = {'sys': sys, 'platform': platform, 'bpy': bpy, 'bakelib': bakelib}
    exec(compile(ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[])), str(path), 'exec'), namespace)
    return namespace[factory], namespace['source_qualified_noise_refusal']


color, color_qualification = fixture('color-conversion-differential', 'make_material')
spectral, spectral_qualification = fixture('spectral-node-differential', 'material_for')
materials = [color({'id': 'qualified-noise', 'kind': 'conversion', 'mode': 'HSL',
                    'direction': 'separate', 'stage': 'constant', 'value': [.3, .5, .7], 'composition': 'noise'})]
materials += [spectral(kind, {'noise': True}) for kind in ['noise-control', 'blackbody']]
saved_platform, saved_machine = sys.platform, platform.machine
try:
    sys.platform = 'linux'
    platform.machine = lambda: 'x86_64'
    for index, (material, emission) in enumerate(materials):
        tree = material.node_tree
        state = lambda: (len(tree.nodes), [(link.from_node.name, link.from_socket.identifier,
            link.to_node.name, link.to_socket.identifier) for link in tree.links],
            [(node.name, node.normalize) for node in tree.nodes if node.bl_idname == 'ShaderNodeTexNoise'])
        before = state()
        with tsl_ir.emission_context(evaluation_engine='CYCLES'):
            try:
                tsl_ir.emit_channel(emission.inputs['Color'])
                raise AssertionError('Unmeasured Cycles child was silently admitted')
            except tsl_ir.TslIrRefusal as error:
                reason = str(error)
        qualifies = color_qualification if index == 0 else spectral_qualification
        assert qualifies('CYCLES', True, reason, None)
        for engine, uses_noise, text, profile in [('EEVEE', True, reason, None),
                ('CYCLES', False, reason, None), ('CYCLES', True, reason + ' suffix', None),
                ('CYCLES', True, reason, 'cycles-neon-fma'),
                ('CYCLES', True, 'HSL bounds are unknown', None)]:
            assert not qualifies(engine, uses_noise, text, profile)
        with tsl_ir.emission_context(evaluation_engine='EEVEE'):
            document = tsl_ir.emit_channel(emission.inputs['Color'])
        assert 'noise_normalized' in str(document)
        assert before == state(), 'Source qualification mutated the authored graph'
        if index == 0:
            clamps = [node for node in tree.nodes if node.bl_idname == 'ShaderNodeMixRGB']
            assert len(clamps) == 1 and clamps[0].use_clamp and clamps[0].blend_type == 'MIX'
            clamps[0].use_clamp = False
            with tsl_ir.emission_context(evaluation_engine='EEVEE'):
                try:
                    tsl_ir.emit_channel(emission.inputs['Color'])
                    raise AssertionError('Unclamped 3D Noise acquired a unit HSL contract')
                except tsl_ir.TslIrRefusal as error:
                    assert 'HSL' in str(error) and 'bounds are unknown' in str(error)
finally:
    sys.platform, platform.machine = saved_platform, saved_machine
    for material, _ in materials:
        bpy.data.materials.remove(material, do_unlink=True)

print('BLENDLINK_COMPOSED_NOISE_PROFILE_PASSED exact Cycles refusals; EEVEE and authored RGB Clamp retained')
