# SPDX-License-Identifier: GPL-3.0-or-later
"""Curve transport is read-only, renderer/version aware and package importable."""
import importlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import types

import bpy

ADDON = Path(__file__).resolve().parents[1]
CANONICAL = ADDON.parent / 'blendlink/blender'
sys.path.insert(0, str(ADDON))
sys.path.insert(0, str(CANONICAL))
import tsl_ir


def state(node):
    mapping = node.mapping
    return [mapping.use_clip, mapping.tone, mapping.extend,
            mapping.clip_min_x, mapping.clip_max_x, mapping.clip_min_y, mapping.clip_max_y,
            [[list(point.location) + [point.select] for point in curve.points] for curve in mapping.curves]]


def check(emitter):
    material = bpy.data.materials.new('Read-only Curve Transport')
    material.use_nodes = True
    tree = material.node_tree
    try:
        for node_type, kind, count in [('ShaderNodeFloatCurve', 'float', 1), ('ShaderNodeVectorCurve', 'vector', 3), ('ShaderNodeRGBCurve', 'rgb', 4)]:
            node = tree.nodes.new(node_type)
            node.mapping.use_clip = False
            node.mapping.clip_min_x = -2
            node.mapping.clip_max_x = 3
            for index, curve in enumerate(node.mapping.curves):
                curve.points.new(.37, .75 - index * .1)
            node.mapping.update()
            for tone in ['STANDARD', 'FILMLIKE']:
                node.mapping.tone = tone
                before = state(node)
                groups = len(bpy.data.node_groups)
                for engine in ['CYCLES', 'EEVEE']:
                    with emitter.emission_context(evaluation_engine=engine):
                        expression = emitter.emit_output(node, node.outputs[0])
                    assert expression['op'] == 'curve_native' and expression['kind'] == kind, expression
                    expected = 'shader-mf' if bpy.app.version >= (5, 0, 0) else 'cycles' if engine == 'CYCLES' else 'eevee-gpu'
                    assert expression['model'] == expected, expression
                    assert expression['sourceEngine'] == engine and expression['sourceTone'] == tone
                    assert len(expression['values']) == 257 * 4
                    assert expression['samples'] == 257
                    if expected == 'shader-mf': assert len(expression['ranges']) == count
                    if expected == 'eevee-gpu': assert expression['tableStorage'] == 'rgba16f'
                    json.dumps(expression, allow_nan=False)
                    assert state(node) == before, 'Extraction mutated authored control points or options'
                    assert len(bpy.data.node_groups) == groups, 'Extraction leaked a copied node tree'
            # Inputs supplied by a shader attribute cannot be folded as a native
            # material multi-function, even when the object property is uniform.
            source = tree.nodes.new('ShaderNodeAttribute')
            source.attribute_type = 'OBJECT'
            source.attribute_name = 'curve_input'
            target = next(socket for socket in node.inputs if socket.identifier in {'Value', 'Vector', 'Color'})
            link = tree.links.new(source.outputs['Fac' if kind == 'float' else 'Color'], target)
            with emitter.emission_context(evaluation_engine='EEVEE'):
                expression = emitter.emit_output(node, node.outputs[0])
            assert expression['model'] == 'eevee-gpu'
            assert expression['tableStorage'] == ('rgba32f' if bpy.app.version >= (5, 3, 0) else 'rgba16f')
            tree.links.remove(link)
            with emitter.emission_context(evaluation_engine='UNKNOWN'):
                try:
                    emitter.emit_output(node, node.outputs[0])
                    raise AssertionError('Unknown renderer was silently assigned curve semantics')
                except emitter.TslIrRefusal as error:
                    assert 'source evaluation engine' in str(error)
            tree.nodes.remove(node)
    finally:
        bpy.data.materials.remove(material, do_unlink=True)


check(tsl_ir)
# Exercise the actual flat extension layout with a package-qualified emitter.
# No global import aliases or source path insertion may satisfy its siblings.
with tempfile.TemporaryDirectory(prefix='blendlink-isolated-curves-') as temporary:
    package = Path(temporary) / 'curve_extension'
    package.mkdir()
    for directory in [ADDON, CANONICAL]:
        for path in directory.iterdir():
            if path.suffix in {'.py', '.json'}: shutil.copy2(path, package / path.name)
    wrapper = types.ModuleType('curve_extension')
    wrapper.__path__ = [str(package)]
    sys.modules[wrapper.__name__] = wrapper
    qualified = importlib.import_module('curve_extension.tsl_ir')
    check(qualified)
    helper = importlib.import_module('curve_extension.curves_ir')
    assert helper.curve_tables.__module__ == 'curve_extension.compositor_graph'
print('BLENDLINK_CURVE_TRANSLATION_PASSED native models, read-only mappings, isolated extension imports')
