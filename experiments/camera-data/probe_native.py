# SPDX-License-Identifier: GPL-3.0-or-later
import bpy,json,os
from pathlib import Path
report={'version':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),'contexts':{}}
for context in ['material','group']:
    if context=='material':
        material=bpy.data.materials.new('Isolated Camera Data');material.use_nodes=True;tree=material.node_tree
    else:tree=bpy.data.node_groups.new('Isolated Camera Data','ShaderNodeTree')
    try:node=tree.nodes.new('ShaderNodeCameraData')
    except RuntimeError as error:report['contexts'][context]={'creatable':False,'reason':str(error)};continue
    report['contexts'][context]={'creatable':True,'inputs':[(s.identifier,s.type) for s in node.inputs],
      'outputs':[(s.identifier,s.type,list(s.default_value) if s.type=='VECTOR' else s.default_value) for s in node.outputs]}
Path(os.environ['BLENDLINK_CAMERA_DATA_PROBE']).write_text(json.dumps(report,indent=2)+'\n')
print('BLENDLINK_CAMERA_DATA_SCHEMA_PASSED',json.dumps(report))
