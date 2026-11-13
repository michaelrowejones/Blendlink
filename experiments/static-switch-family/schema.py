import bpy,json,os
from pathlib import Path
out=[]
for context in ['ShaderNodeTree','CompositorNodeTree']:
 tree=bpy.data.node_groups.new('Switch schema '+context,context)
 for kind in ['GeometryNodeSwitch','GeometryNodeMenuSwitch','GeometryNodeIndexSwitch','FunctionNodeInputBool','FunctionNodeInputInt','FunctionNodeInputMenu']:
  try:node=tree.nodes.new(kind)
  except Exception as error:out.append({'context':context,'kind':kind,'error':str(error)});continue
  props={}
  for prop in node.bl_rna.properties:
   if prop.identifier in ['input_type','data_type']:
    props[prop.identifier]={'value':getattr(node,prop.identifier),'enum':[x.identifier for x in prop.enum_items]}
  def sockets(items):
   rows=[]
   for s in items:
    d=getattr(s,'default_value',None)
    if d is not None and not isinstance(d,(bool,str,float,int)):d=list(d)
    rows.append({'name':s.name,'id':s.identifier,'type':s.type,'enabled':s.enabled,'unavailable':getattr(s,'is_unavailable',False),'default':d})
   return rows
  def capture():return {'properties':props,'inputs':sockets(node.inputs),'outputs':sockets(node.outputs),'collections':[p.identifier for p in node.bl_rna.properties if p.type=='COLLECTION']}
  row={'context':context,'kind':kind,**capture()}
  row['modes']={}
  for prop in ['input_type','data_type']:
   if prop not in props:continue
   for value in ['FLOAT','INT','BOOLEAN','VECTOR','RGBA','SHADER','STRING']:
    try:setattr(node,prop,value);row['modes'][value]=capture()
    except Exception as error:row['modes'][value]={'error':str(error)}
  if hasattr(node,'enum_items'):row['enumItems']=[{'name':x.name,'props':[p.identifier for p in x.bl_rna.properties]} for x in node.enum_items]
  if hasattr(node,'index_switch_items'):row['indexItems']=[[p.identifier for p in x.bl_rna.properties] for x in node.index_switch_items]
  out.append(row)
path=Path(os.environ['SCENETOWEB_SWITCH_SCHEMA']);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps({'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'rows':out},indent=2)+'\n');print('SCENETOWEB_SWITCH_SCHEMA_READY',path)
