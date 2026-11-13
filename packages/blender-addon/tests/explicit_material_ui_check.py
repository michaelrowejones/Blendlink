# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit live materials show cached compiler results and named refusals."""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
import bpy


class RecordingLayout:
    def __init__(self, events=None):
        self.events = events if events is not None else []

    def box(self): return RecordingLayout(self.events)
    def row(self, **kwargs): return RecordingLayout(self.events)
    def label(self, *, text='', **kwargs): self.events.append(('label', text))
    def operator(self, name, *, text='', **kwargs):
        self.events.append(('operator', name, text))
        return SimpleNamespace()


bpy.ops.wm.read_factory_settings(use_empty=False)
root = Path(__file__).resolve().parents[1]
name = 'blendlink_explicit_material_ui_check'
spec = importlib.util.spec_from_file_location(name, root / '__init__.py', submodule_search_locations=[str(root)])
addon = importlib.util.module_from_spec(spec)
sys.modules[name] = addon
spec.loader.exec_module(addon)
addon.register()
try:
    bpy.ops.blendlink.setup_website_export()
    obj = bpy.data.objects['Cube']
    material = bpy.data.materials.new('Explicit live no-height Bump')
    material.use_nodes = True
    obj.data.materials.clear(); obj.data.materials.append(material)
    addon.material_compiler.set_tsl_ir(material, True)
    tree = material.node_tree
    principled = next(node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED')
    bump = tree.nodes.new('ShaderNodeBump')
    inactive = tree.nodes.new('ShaderNodeTexEnvironment')
    tree.links.new(inactive.outputs['Color'], bump.inputs['Strength'])
    tree.links.new(bump.outputs['Normal'], principled.inputs['Normal'])
    original = len(tree.nodes), len(tree.links), tuple(material.keys())
    addon.validation.recompute(bpy.context.scene)
    record = addon.validation.result().material_compatibility[material.name]
    compilation = record['materialCompilation']
    assert compilation['intent'] == 'tslProgram' and compilation['outcome'] == 'lowered', compilation
    assert any(entry['channel'] == 'Normal' and entry['route'] == 'program'
               for entry in compilation['channels']['channels'])
    layout = RecordingLayout()
    with patch.object(addon.material_compiler, 'plan_materials', side_effect=AssertionError('Compilation ran during draw')):
        addon.ui._draw_material_compatibility(layout, record)
    text = ' '.join(event[-1] for event in layout.events)
    assert 'TSL Program ready to compile' in text and 'Normal: Live node translation' in text, text
    assert 'Needs Bake' not in text and 'Environment' not in text, text
    assert ('operator', 'blendlink.toggle_tsl_program', 'Disable TSL Program') in layout.events
    assert not any(event[0] == 'operator' and event[1] == 'blendlink.toggle_material_bake' for event in layout.events)
    assert original == (len(tree.nodes), len(tree.links), tuple(material.keys()))

    height = tree.nodes.new('ShaderNodeValue')
    tree.links.new(height.outputs[0], bump.inputs['Height'])
    addon.validation.recompute(bpy.context.scene)
    record = addon.validation.result().material_compatibility[material.name]
    assert record['materialCompilation']['outcome'] == 'blocked'
    normal = next(entry for entry in record['materialCompilation']['channels']['channels']
                  if entry['channel'] == 'Normal')
    refusal = normal.get('tslIrRefusal')
    assert normal['route'] == 'refused' and isinstance(refusal, str) and refusal.startswith('Bump Height'), normal
    layout = RecordingLayout()
    with patch.object(addon.material_compiler, 'plan_materials', side_effect=AssertionError('Compilation ran during draw')):
        addon.ui._draw_material_compatibility(layout, record)
    text = ' '.join(event[-1] for event in layout.events)
    assert 'TSL Program needs attention' in text and refusal in text, text
    assert 'ready to compile' not in text
finally:
    addon.unregister()

print('BLENDLINK_EXPLICIT_MATERIAL_UI_PASSED cached ready/blocked routes; inactive controls preserved')
