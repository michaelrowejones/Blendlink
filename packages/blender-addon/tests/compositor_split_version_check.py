# SPDX-License-Identifier: GPL-3.0-or-later
"""Keep fresh Split extraction within measured source versions."""
from pathlib import Path
import sys
import tempfile

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


with tempfile.TemporaryDirectory(prefix='blendlink-split-version-') as directory:
    oracle = NativeCompositorReference(Path(directory), device='CPU', image_only_scene=True, node_previews=False)
    sink, source = oracle.reset()
    node = oracle.tree.nodes.new('CompositorNodeSplit')
    oracle.tree.links.new(source.outputs['Image'], node.inputs['Image'])
    oracle.tree.links.new(node.outputs['Image'], sink.inputs[0])

    def fingerprint():
        return repr(([(n.name, n.bl_idname, [(s.identifier, repr(getattr(s, 'default_value', None)))
            for s in n.inputs]) for n in oracle.tree.nodes],
            [(link.from_node.name, link.from_socket.identifier, link.to_node.name, link.to_socket.identifier)
                for link in oracle.tree.links], len(bpy.data.images), len(bpy.data.node_groups)))

    before = fingerprint()
    assert compositor_graph.extract(oracle.scene)['status'] == 'extracted'
    namespace = compositor_graph.normalize_split.__globals__
    original = namespace['_source_version']
    try:
        for version in [(4, 2, 1), (4, 3, 0), (5, 0, 0), (5, 1, 0), (5, 2, 1), (5, 3, 1), (6, 0, 0)]:
            namespace['_source_version'] = lambda: version
            rejected = compositor_graph.extract(oracle.scene)
            assert rejected['status'] == 'unsupported', rejected
            assert len(rejected['diagnostics']) == 1, rejected
            assert rejected['diagnostics'][0]['code'] == 'unsupported-split-domain', rejected
            assert rejected['diagnostics'][0]['message'] == 'Split requires a measured Blender 4.2.0, 5.2.0 or 5.3.0 source model', rejected
            assert fingerprint() == before
    finally:
        namespace['_source_version'] = original
    assert compositor_graph.extract(oracle.scene)['status'] == 'extracted'
    assert fingerprint() == before

print('BLENDLINK_COMPOSITOR_SPLIT_VERSION_PASSED ' + bpy.app.version_string)
