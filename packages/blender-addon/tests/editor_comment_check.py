# SPDX-License-Identifier: GPL-3.0-or-later
"""Native editor comments preserve annotations and do not change live programs."""
from pathlib import Path
import sys
import tempfile

import bpy

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'packages/blender-addon'))
sys.path.insert(0, str(ROOT / 'packages/blendlink/blender'))
import tsl_ir
import compositor_graph
import material_compiler

bpy.ops.wm.read_factory_settings(use_empty=True)
version = tuple(bpy.app.version)
if version in {(4, 2, 0), (5, 2, 0)}:
    for kind in ('ShaderNodeTree', 'CompositorNodeTree'):
        tree = bpy.data.node_groups.new('Comment absence', kind)
        try:
            try:
                tree.nodes.new('NodeComment')
            except RuntimeError as error:
                assert 'undefined' in str(error), error
            else:
                raise AssertionError('Unreviewed native Comment availability')
        finally:
            bpy.data.node_groups.remove(tree)
    print('BLENDLINK_EDITOR_COMMENT_PASSED native-node-absent numericalCases=0', version)
else:
    assert version == (5, 3, 0), 'Unknown native Comment schema'
    material = bpy.data.materials.new('Comment shader')
    material.use_nodes = True
    bpy.ops.mesh.primitive_cube_add()
    bpy.context.object.data.materials.append(material)
    shader = material.node_tree
    shader_group = bpy.data.node_groups.new('Comment shader group', 'ShaderNodeTree')
    shader_group.interface.new_socket(name='Value', in_out='INPUT', socket_type='NodeSocketFloat')
    shader_group.interface.new_socket(name='Value', in_out='OUTPUT', socket_type='NodeSocketFloat')
    incoming = shader_group.nodes.new('NodeGroupInput')
    outgoing = shader_group.nodes.new('NodeGroupOutput')
    shader_group.links.new(incoming.outputs[0], outgoing.inputs[0])
    instance = shader.nodes.new('ShaderNodeGroup')
    instance.node_tree = shader_group
    instance.inputs[0].default_value = .375
    shader.links.new(instance.outputs[0], shader.nodes.get('Principled BSDF').inputs['Roughness'])

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.use_compositing = True
    compositor = bpy.data.node_groups.new('Comment compositor', 'CompositorNodeTree')
    compositor.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    scene.compositing_node_group = compositor
    render = compositor.nodes.new('CompositorNodeRLayers')
    sink = compositor.nodes.new('NodeGroupOutput')
    comp_group = bpy.data.node_groups.new('Comment compositor group', 'CompositorNodeTree')
    comp_group.interface.new_socket(name='Image', in_out='INPUT', socket_type='NodeSocketColor')
    comp_group.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    incoming = comp_group.nodes.new('NodeGroupInput')
    outgoing = comp_group.nodes.new('NodeGroupOutput')
    comp_group.links.new(incoming.outputs[0], outgoing.inputs[0])
    instance = compositor.nodes.new('CompositorNodeGroup')
    instance.node_tree = comp_group
    compositor.links.new(render.outputs['Image'], instance.inputs[0])
    compositor.links.new(instance.outputs[0], sink.inputs[0])

    def programs():
        result = compositor_graph.extract(bpy.context.scene)
        assert result['status'] == 'extracted', result
        plan = material_compiler.plan_materials(tuple(bpy.context.scene.objects),
                                               purpose='final', automatic_programs=True)
        assert not plan.errors, plan.as_dict()
        return (tsl_ir.emit_surface(bpy.data.materials['Comment shader'].node_tree, target='EEVEE'),
                result, [decision.as_dict() for decision in plan.decisions])

    def comments():
        result = {}
        trees = [bpy.data.materials['Comment shader'].node_tree, *bpy.data.node_groups]
        for tree in trees:
            for node in tree.nodes:
                if node.bl_idname == 'NodeComment':
                    result[tree.name] = (node.text, node.label, tuple(node.location), tuple(node.color),
                                         node.use_custom_color, node.parent.name, node['Artist note'])
        return result

    with tempfile.TemporaryDirectory(prefix='blendlink-editor-comments-') as temporary:
        path = str(Path(temporary) / 'comments.blend')
        bpy.ops.wm.save_as_mainfile(filepath=path)
        baseline = programs()
        for tree in (shader, shader_group, compositor, comp_group):
            frame = tree.nodes.new('NodeFrame')
            frame.name = 'Artist organization'
            comment = tree.nodes.new('NodeComment')
            assert len(comment.inputs) == 0 and len(comment.outputs) == 0
            comment.text = 'Artist intent\nPreserve this annotation: cloud \u2601'
            comment.label = 'Look development note'
            comment.parent = frame
            comment.location = (23, 17)
            comment.use_custom_color = True
            comment.color = (.3, .4, .6)
            comment['Artist note'] = 'Private annotation, no runtime instruction'
        assert programs() == baseline, 'Editor comments changed emitted programs'
        before = comments()
        assert len(before) == 4
        bpy.ops.wm.save_as_mainfile(filepath=path)
        bpy.ops.wm.open_mainfile(filepath=path)
        assert comments() == before, 'Saved annotations or organization changed'
        assert programs() == baseline, 'Comment save/reload changed emitted programs'
        for tree in [bpy.data.materials['Comment shader'].node_tree, *bpy.data.node_groups]:
            for node in tree.nodes:
                if node.bl_idname == 'NodeComment':
                    node.text += '\nEdited note'
                    node.location.x += 53
        assert programs() == baseline, 'Editing annotations changed emitted programs'
    print('BLENDLINK_EDITOR_COMMENT_PASSED shaderAndCompositorContexts=4 numericalCases=0', version)
