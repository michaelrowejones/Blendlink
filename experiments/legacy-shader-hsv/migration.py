# SPDX-License-Identifier: GPL-3.0-or-later
"""Observe Blender's own file versioning; never manufacture legacy aliases."""
import json
import os
from pathlib import Path
import bpy
source = Path(os.environ['BLENDLINK_HSV_LEGACY_BLEND']).resolve()
bpy.ops.wm.open_mainfile(filepath=str(source))
rows = []
for material in bpy.data.materials:
    if material.use_nodes:
        for node in material.node_tree.nodes:
            rows.append({'name':node.name, 'actual':node.bl_idname, 'mode':getattr(node,'mode',None),
                         'inputs':[item.identifier for item in node.inputs],
                         'outputs':[item.identifier for item in node.outputs]})
legacy = [row for row in rows if row['name'].startswith(('Combine HSV', 'Separate HSV'))]
assert len(legacy) == 2, legacy
for row in legacy:
    assert row['actual'] == ('ShaderNodeCombineColor' if row['name'].startswith('Combine') else 'ShaderNodeSeparateColor'), row
    assert row['mode'] == 'HSV', row
material=bpy.data.materials['Actual legacy HSV audit'];tree=material.node_tree
combine=next(node for node in tree.nodes if node.name.startswith('Combine HSV'))
separate=next(node for node in tree.nodes if node.name.startswith('Separate HSV'))
assert [float(socket.default_value)for socket in combine.inputs]==[.125,.75,.625]
links=[(link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier)for link in tree.links]
assert any(link[0]==combine.name and link[1]=='Color' and link[2]==separate.name and link[3]=='Color'for link in links)
assert any(link[0]==separate.name and link[1]=='Red' and link[3]=='Color'for link in links)
Path(os.environ['BLENDLINK_HSV_MIGRATION']).write_text(json.dumps({'version':list(bpy.app.version),'nodes':rows,'links':links},indent=2))
print('BLENDLINK_LEGACY_HSV_MIGRATION_PASSED')
