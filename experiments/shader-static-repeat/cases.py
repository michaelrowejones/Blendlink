# SPDX-License-Identifier: GPL-3.0-or-later
COUNTS=[0,1,2,7,32,64]
def cases():
 rows=[]
 for kind in ['scalar-step','counter','vector-step']:
  for n in COUNTS:
   for component in range(3)if kind.startswith('vector')else[0]:rows.append({'case':kind+'-'+str(n)+'-'+str(component),'kind':kind,'iterations':n,'component':component,'state':0,'saved':n in{7,64}and component==0})
 for n in[2,64]:
  for state,kind in enumerate(['FLOAT','VECTOR','FLOAT','VECTOR']):
   for component in range(3)if kind=='VECTOR'else[0]:rows.append({'case':'multi-'+str(n)+'-'+str(state)+'-'+str(component),'kind':'multi','iterations':n,'state':state,'component':component,'saved':n==64 and(state,component)in{(0,0),(3,1)}})
 for kind in['scalar-step']:rows.append({'case':'group-'+kind,'kind':kind,'iterations':7,'state':0,'component':0,'group':True,'saved':True})
 rows.append({'case':'inactive-zero','kind':'scalar-step','iterations':0,'state':0,'component':0,'inactive':True,'saved':True})
 return rows

def unqualified_field_cases():
 """Retained authored research fixtures, never admitted numerical cases."""
 rows=[]
 for kind in ['scalar-field','vector-field']:
  for n in COUNTS:
   for component in range(3)if kind.startswith('vector')else[0]:rows.append({'case':kind+'-'+str(n)+'-'+str(component),'kind':kind,'iterations':n,'component':component,'state':0,'saved':False})
 rows.append({'case':'group-vector-field','kind':'vector-field','iterations':7,'state':0,'component':0,'group':True,'saved':False})
 return rows

def clamp_snap(tree,uv):
 value=uv
 for mode,constant in[('MAXIMUM',0),('MINIMUM',1),('SNAP',.25)]:
  node=tree.nodes.new('ShaderNodeVectorMath');node.operation=mode;node.inputs[1].default_value=[constant]*3;tree.links.new(value,node.inputs[0]);value=node.outputs['Vector']
 return value

def build(tree,row,uv=None):
 start=tree.nodes.new('GeometryNodeRepeatInput');end=tree.nodes.new('GeometryNodeRepeatOutput')
 kinds=['FLOAT','VECTOR','FLOAT','VECTOR']if row['kind']=='multi'else['VECTOR']if row['kind'].startswith('vector')else['FLOAT']
 for i,kind in enumerate(kinds):end.repeat_items.new(kind,'State'+str(i))
 start.pair_with_output(end);start.inputs['Iterations'].default_value=row['iterations']
 for i,kind in enumerate(kinds):
  start.inputs[i+1].default_value=[.125,.25,.5]if kind=='VECTOR'else.125
  if 'field'in row['kind']:
   value=clamp_snap(tree,uv)
   if kind=='FLOAT':
    sep=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(value,sep.inputs[0]);value=sep.outputs['X']
   tree.links.new(value,start.inputs[i+1])
  node=tree.nodes.new('ShaderNodeVectorMath'if kind=='VECTOR'else'ShaderNodeMath');node.operation='SUBTRACT'if row['kind']=='multi'and i>=2 else'ADD'
  node.inputs[1].default_value=[.0625,-.0625,.125]if kind=='VECTOR'else.0625;tree.links.new(start.outputs[i+1],node.inputs[0])
  if row['kind']=='counter':tree.links.new(start.outputs['Iteration'],node.inputs[1])
  tree.links.new(node.outputs['Vector'if kind=='VECTOR'else'Value'],end.inputs[i])
 if row.get('inactive'):tree.links.new(tree.nodes.new('ShaderNodeTexSky').outputs[0],end.inputs[0])
 return end.outputs[row.get('state',0)],start,end

def signed_carrier(tree,signal,component=0):
 """Independent reversible1/16 scalar encoding, outside the loop under test."""
 if signal.type=='VECTOR':
  sep=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(signal,sep.inputs[0]);signal=sep.outputs[component]
 def math(mode,a,b=0):
  node=tree.nodes.new('ShaderNodeMath');node.operation=mode
  for index,value in enumerate([a,b]):
   if hasattr(value,'node'):tree.links.new(value,node.inputs[index])
   else:node.inputs[index].default_value=value
  return node.outputs[0]
 scaled=math('MULTIPLY',math('ADD',signal,2048),16)
 high=math('FLOOR',math('DIVIDE',scaled,256))
 low=math('SUBTRACT',scaled,math('MULTIPLY',high,256))
 combine=tree.nodes.new('ShaderNodeCombineXYZ');tree.links.new(math('DIVIDE',high,256),combine.inputs['X']);tree.links.new(math('DIVIDE',low,256),combine.inputs['Y'])
 return combine.outputs[0]

def build_case(tree,row):
 uv=tree.nodes.new('ShaderNodeTexCoord').outputs['UV']
 if row['kind']=='control':
  separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(uv,separate.inputs[0]);combine=tree.nodes.new('ShaderNodeCombineXYZ');combine.inputs['Z'].default_value=.25
  for index in range(2):
   compare=tree.nodes.new('ShaderNodeMath');compare.operation='GREATER_THAN';compare.inputs[1].default_value=.5;tree.links.new(separate.outputs[index],compare.inputs[0]);tree.links.new(compare.outputs[0],combine.inputs[index])
  return combine.outputs[0]
 if row.get('group'):
  import bpy
  group=bpy.data.node_groups.new('Artist Repeat Group','ShaderNodeTree');kind='VECTOR'if row['kind'].startswith('vector')else'FLOAT';group.interface.new_socket(name='Result',in_out='OUTPUT',socket_type='NodeSocketVector'if kind=='VECTOR'else'NodeSocketFloat');sink=group.nodes.new('NodeGroupOutput');inner_uv=group.nodes.new('ShaderNodeTexCoord').outputs['UV'];signal,_,_=build(group,row,inner_uv);group.links.new(signal,sink.inputs[0]);instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;signal=instance.outputs[0]
 else:signal,_,_=build(tree,row,uv)
 return signed_carrier(tree,signal,row.get('component',0))
