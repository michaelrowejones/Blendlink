# SPDX-License-Identifier: GPL-3.0-or-later
"""One sample is opt-in, image-only and restored even after a failed render."""
import sys
import tempfile
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference
with tempfile.TemporaryDirectory(prefix='blendlink-compositor-sampling-') as temporary:
    oracle=NativeCompositorReference(temporary,image_only_scene=True)
    engines={item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    eevee=oracle.scene.eevee;eevee.taa_render_samples=21
    sink,source=oracle.reset();oracle.tree.links.new(source.outputs['Image'],sink.inputs[0])
    with oracle._render_sampling() as profile:
        assert not profile['imageOnlyScene'] and eevee.taa_render_samples==21
    replacement=oracle.tree.nodes.new('CompositorNodeImage');replacement.image=oracle.image
    oracle.tree.links.new(replacement.outputs['Image'],sink.inputs[0])
    try:
        with oracle._render_sampling() as profile:
            assert profile['imageOnlyScene'] and eevee.taa_render_samples==1
            assert profile['compositorPrecision']==getattr(oracle.scene.render,'compositor_precision',None)
            if profile['compositorPrecision'] is not None:assert profile['compositorPrecision']=='FULL'
            raise RuntimeError('simulated render failure')
    except RuntimeError:pass
    assert eevee.taa_render_samples==21
    unused=oracle.tree.nodes.new('ShaderNodeMath' if oracle.modern else 'CompositorNodeMath');unused.operation='ADD'
    oracle.tree.links.new(source.outputs['Alpha'],unused.inputs[0])
    with oracle._render_sampling() as profile:
        assert not profile['imageOnlyScene'] and eevee.taa_render_samples==21
    oracle.tree.nodes.remove(unused)
    # Legacy Render Layers nodes are restricted to the scene's root tree.
    if oracle.modern:
        group=bpy.data.node_groups.new('Nested render pass','CompositorNodeTree')
        group_source=group.nodes.new('CompositorNodeRLayers')
        group_target=group.nodes.new('ShaderNodeMath' if oracle.modern else 'CompositorNodeMath')
        group.links.new(group_source.outputs['Alpha'],group_target.inputs[0])
        instance=oracle.tree.nodes.new('CompositorNodeGroup');instance.node_tree=group
        with oracle._render_sampling() as profile:
            assert not profile['imageOnlyScene'] and eevee.taa_render_samples==21
        oracle.tree.nodes.remove(instance);bpy.data.node_groups.remove(group)
    oracle.image_only_scene=False
    with oracle._render_sampling() as profile:
        assert not profile['imageOnlyScene'] and eevee.taa_render_samples==21
    oracle.image_only_scene=True;oracle.scene.render.engine='CYCLES'
    with oracle._render_sampling() as profile:
        assert not profile['imageOnlyScene'] and eevee.taa_render_samples==21
print('BLENDLINK_COMPOSITOR_REFERENCE_RENDER_PASSED opt-in, linked-pass guard, FULL precision and exception restoration')
