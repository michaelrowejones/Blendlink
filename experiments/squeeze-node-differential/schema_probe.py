# SPDX-License-Identifier: GPL-3.0-or-later
import bpy,json,os
from pathlib import Path
bpy.ops.wm.read_factory_settings(use_empty=True)
material=bpy.data.materials.new('Actual Squeeze');material.use_nodes=True
node=material.node_tree.nodes.new('ShaderNodeSqueeze')
record={'version':list(bpy.app.version),'hash':bpy.app.build_hash.decode(),'id':node.bl_idname,'inputs':[], 'outputs':[],'properties':[]}
for name in ['inputs','outputs']:
 for s in getattr(node,name):
  v=getattr(s,'default_value',None)
  if v is not None and not isinstance(v,(bool,float,int,str)):v=list(v)
  record[name].append({'id':s.identifier,'type':s.type,'name':s.name,'default':v,'enabled':s.enabled,'hidden':s.hide,'available':not s.is_unavailable})
for p in node.bl_rna.properties:
 if not p.is_readonly and p.identifier not in {'name','label','location','width','height','select','show_options','show_preview','hide','use_custom_color','color','parent','shrink'}:
  try:v=getattr(node,p.identifier);json.dumps(v)
  except Exception:continue
  record['properties'].append({'id':p.identifier,'value':v})
emission=material.node_tree.nodes.new('ShaderNodeEmission')
link=material.node_tree.links.new(node.outputs[0],emission.inputs['Color'])
record['linkValid']=link.is_valid
path=Path(os.environ['BLENDLINK_SQUEEZE_PROBE']);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(record,indent=2))
print('BLENDLINK_SQUEEZE_PROBE',json.dumps(record))
