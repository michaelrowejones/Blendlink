# SPDX-License-Identifier: GPL-3.0-or-later
"""Private native SDNA readback preserves legacy hidden stops without source edits."""
from pathlib import Path
import sys
import bpy
ADDON = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ADDON))
from legacy_ramp_data import hidden_ramp_stop, LegacyRampDataError, _hidden_from_snapshot
import legacy_ramp_data

if not (4, 2, 0) <= bpy.app.version < (4, 4, 0):
    print('BLENDLINK_LEGACY_RAMP_DATA_PASSED native hidden storage is not used on this Blender version')
else:
    original_temporary = legacy_ramp_data.tempfile.TemporaryDirectory
    private_paths = []
    def track_private_directory(*arguments, **keywords):
        value = original_temporary(*arguments, **keywords)
        private_paths.append(Path(value.name))
        return value
    legacy_ramp_data.tempfile.TemporaryDirectory = track_private_directory
    for group in [False, True]:
        owner = bpy.data.node_groups.new('Private Ramp Group', 'ShaderNodeTree') if group else bpy.data.materials.new('Private Ramp Material')
        if not group: owner.use_nodes = True
        tree = owner if group else owner.node_tree
        if group: tree.interface.new_socket(name='Artist input', in_out='INPUT', socket_type='NodeSocketFloat')
        node = tree.nodes.new('ShaderNodeValToRGB')
        elements = node.color_ramp.elements
        elements[0].position = .15
        elements[0].color = (.1, .2, .3, .4)
        elements[1].position = .85
        elements[1].color = (.7, .6, .5, .8)
        expected = {'color': list(elements[1].color), 'position': elements[1].position}
        elements.remove(elements[1])
        node['artist_note'] = 'Retain this source property'
        state = (len(tree.nodes), len(tree.interface.items_tree), len(bpy.data.materials), len(bpy.data.node_groups),
                 elements[0].position, list(elements[0].color), dict(node.items()))
        assert hidden_ramp_stop(node) == expected
        assert hidden_ramp_stop(node) == expected, 'Readback changed hidden storage across repeated extraction'
        assert state == (len(tree.nodes), len(tree.interface.items_tree), len(bpy.data.materials), len(bpy.data.node_groups),
                         elements[0].position, list(elements[0].color), dict(node.items()))
        image = bpy.data.images.new('Foreign artist image', width=1024, height=1024)
        sibling = tree.nodes.new('ShaderNodeTexImage')
        sibling.image = image
        before = image.users
        source_counts = (owner.users, tree.users, len(bpy.data.materials), len(bpy.data.node_groups))
        if group:
            assert hidden_ramp_stop(node) == expected
        else:
            try:
                hidden_ramp_stop(node)
                raise AssertionError('Unsafe embedded-tree ID copy was attempted')
            except LegacyRampDataError as error:
                assert 'references other Blender IDs' in str(error)
        assert image.users == before
        assert source_counts == (owner.users, tree.users, len(bpy.data.materials), len(bpy.data.node_groups))
        node['artist_reference'] = image
        before = image.users
        try:
            hidden_ramp_stop(node)
            raise AssertionError('Unsafe native ID-property copy was attempted')
        except LegacyRampDataError as error:
            assert 'custom properties referencing Blender IDs' in str(error)
        assert image.users == before and node['artist_reference'] == image
        (bpy.data.node_groups if group else bpy.data.materials).remove(owner)
        bpy.data.images.remove(image)
    legacy_ramp_data.tempfile.TemporaryDirectory = original_temporary
    assert private_paths and not any(path.exists() for path in private_paths), 'Private native snapshots survived extraction'
    for invalid in [b'', b'BLENDER-v402', b'BLENDER-v402' + b'\0' * 64]:
        try:
            _hidden_from_snapshot(invalid, 1, [0, 0, 0, 1, 0])
            raise AssertionError('Malformed snapshot was accepted')
        except LegacyRampDataError:
            pass
    print('BLENDLINK_LEGACY_RAMP_DATA_PASSED material/group storage, repeated read-only extraction, isolated references and malformed refusal')
