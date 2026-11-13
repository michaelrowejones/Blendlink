# SPDX-License-Identifier: GPL-3.0-or-later
import bpy,json,os
from pathlib import Path
report={'version':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),'contexts':{}}
for context in ['root','group']:
    if context=='root' and bpy.app.version<(5,0,0):
        bpy.context.scene.use_nodes=True;tree=bpy.context.scene.node_tree
    else:tree=bpy.data.node_groups.new('Isolated Map Value '+context,'CompositorNodeTree')
    try:node=tree.nodes.new('CompositorNodeMapValue')
    except RuntimeError as error:report['contexts'][context]={'creatable':False,'reason':str(error)};continue
    def value(item):
        if isinstance(item,(str,float,int,bool)) or item is None:return item
        return list(item)
    report['contexts'][context]={'creatable':True,'inputs':[(s.identifier,s.type,value(getattr(s,'default_value',None))) for s in node.inputs],
      'outputs':[(s.identifier,s.type,value(getattr(s,'default_value',None))) for s in node.outputs],
      'properties':{p.identifier:{'type':p.type,'default':value(getattr(node,p.identifier)),**({'min':p.hard_min,'max':p.hard_max} if p.type in {'FLOAT','INT'} else {})} for p in node.bl_rna.properties
       if p.identifier not in bpy.types.Node.bl_rna.properties and p.type in {'FLOAT','INT','BOOLEAN','ENUM'}}}
Path(os.environ['BLENDLINK_MAP_VALUE_PROBE']).write_text(json.dumps(report,indent=2)+'\n')
print('BLENDLINK_MAP_VALUE_SCHEMA_PASSED',json.dumps(report))
