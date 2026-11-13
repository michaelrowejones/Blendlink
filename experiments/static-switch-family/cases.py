# SPDX-License-Identifier: GPL-3.0-or-later
"""Fixed native case census and authored static-selection graph construction."""
FAMILIES={'switch':'GeometryNodeSwitch','index':'GeometryNodeIndexSwitch','menu':'GeometryNodeMenuSwitch'}
MODES=['FLOAT','INT','BOOLEAN','VECTOR','RGBA']


def cases():
 rows=[{'case':f'{family}-{mode.lower()}-{choice}','family':family,'mode':mode,'choice':choice,'kind':'literal'}
       for family in FAMILIES for mode in MODES for choice in [0,1]]
 for family in FAMILIES:
  for kind in ['field','inactive','group']:
   for choice in [0,1]:rows.append({'case':f'{family}-{kind}-{choice}','family':family,'mode':'RGBA','choice':choice,'kind':kind})
 for family in ['switch','index']:
  for choice in [0,1]:rows.append({'case':f'{family}-typed-{choice}','family':family,'mode':'RGBA','choice':choice,'kind':'typed'})
 for choice in [0,1]:
  for output in [1,2]:rows.append({'case':f'menu-mask-{choice}-{output}','family':'menu','mode':'RGBA','choice':choice,'kind':'mask','output':output})
 for operation,a,b in [('NOT',True,False),('XOR',True,True),('OR',True,False),('IMPLY',True,False)]:
  choice=int({'NOT':not a,'XOR':a!=b,'OR':a or b,'IMPLY':not a or b}[operation])
  rows.append({'case':'switch-bool-'+operation.lower(),'family':'switch','mode':'RGBA','choice':choice,'kind':'boolean-math','operation':operation,'a':a,'b':b})
 for family in ['index','menu']:
  rows.append({'case':family+'-three-items','family':family,'mode':'RGBA','choice':2,'kind':'three-items'})
  rows.append({'case':family+'-reordered','family':family,'mode':'RGBA','choice':0,'kind':'reordered'})
 for route in ['direct','reroute','group']:
  for choice in [0,1]:rows.append({'case':f'menu-source-{route}-{choice}','family':'menu','mode':'RGBA','choice':choice,'kind':'menu-source-'+route})
 return rows


def setting(node,choice):
 if node.bl_idname=='GeometryNodeSwitch':node.inputs[0].default_value=bool(choice)
 elif node.bl_idname=='GeometryNodeIndexSwitch':node.inputs[0].default_value=choice
 else:node.inputs[0].default_value=node.enum_items[choice].name


def set_branches(node,mode):
 values={'FLOAT':[.125,.75,.5],'INT':[1,3,2],'BOOLEAN':[False,True,True],
         'VECTOR':[(.125,.25,.5),(.75,.5,.25),(.5,.125,.25)],
         'RGBA':[(.125,.25,.5,1),(.75,.5,.25,1),(.5,.125,.25,1)]}
 for socket,value in zip([x for x in node.inputs[1:] if x.identifier!='__extend__'],values[mode]):socket.default_value=value


def build(tree,row,context,field=None):
 import bpy
 group_kind='ShaderNodeGroup' if context=='shader' else 'CompositorNodeGroup'
 if row['kind'] in ['group','menu-source-group']:
  group=bpy.data.node_groups.new('Artist static selection group',tree.bl_idname)
  typ='NodeSocketBool' if row['family']=='switch' else 'NodeSocketInt' if row['family']=='index' else 'NodeSocketMenu'
  group.interface.new_socket(name='Choice',in_out='INPUT',socket_type=typ)
  group.interface.new_socket(name='Inactive artist input',in_out='INPUT',socket_type='NodeSocketColor')
  group.interface.new_socket(name='Color',in_out='OUTPUT',socket_type='NodeSocketColor')
  incoming=group.nodes.new('NodeGroupInput');outgoing=group.nodes.new('NodeGroupOutput')
  nested=dict(row,kind='literal');node=group.nodes.new(FAMILIES[row['family']]);setattr(node,'input_type' if row['family']=='switch' else 'data_type',row['mode']);set_branches(node,row['mode'])
  group.links.new(incoming.outputs['Choice'],node.inputs[0]);group.links.new(incoming.outputs['Inactive artist input'],node.inputs[2 if not row['choice'] else 1]);group.links.new(node.outputs[0],outgoing.inputs[0])
  instance=tree.nodes.new(group_kind);instance.node_tree=group
  if row['family']=='switch':instance.inputs['Choice'].default_value=bool(row['choice'])
  elif row['family']=='index':instance.inputs['Choice'].default_value=row['choice']
  else:instance.inputs['Choice'].default_value=node.enum_items[row['choice']].name
  if row['kind']=='menu-source-group':
   menu=tree.nodes.new('FunctionNodeInputMenu');tree.links.new(menu.outputs[0],instance.inputs['Choice']);bpy.context.view_layer.update();menu.value=node.enum_items[row['choice']].name
  bad=tree.nodes.new('ShaderNodeTexSky' if context=='shader' else 'CompositorNodeKuwahara')
  tree.links.new(bad.outputs[0],instance.inputs['Inactive artist input'])
  return instance.outputs[0],node
 node=tree.nodes.new(FAMILIES[row['family']]);setattr(node,'input_type' if row['family']=='switch' else 'data_type',row['mode'])
 if row['kind']=='three-items':
  if row['family']=='index':node.index_switch_items.new()
  else:node.enum_items.new('Third option')
 if row['kind']=='reordered':
  collection=node.index_switch_items if row['family']=='index' else node.enum_items
  collection.move(0,1)
  if row['family']=='menu':node.enum_items[0].name='Renamed artist option'
 set_branches(node,row['mode']);setting(node,row['choice'])
 if row['kind'] in ['menu-source-direct','menu-source-reroute']:
  menu=tree.nodes.new('FunctionNodeInputMenu');signal=menu.outputs[0]
  if row['kind']=='menu-source-reroute':
   route=tree.nodes.new('NodeReroute');tree.links.new(signal,route.inputs[0]);signal=route.outputs[0]
  tree.links.new(signal,node.inputs[0]);bpy.context.view_layer.update();menu.value=node.enum_items[row['choice']].name
 if row['kind']=='field':tree.links.new(field,node.inputs[1+row['choice']])
 if row['kind']=='inactive':
  bad=tree.nodes.new('ShaderNodeTexSky' if context=='shader' else 'CompositorNodeKuwahara');tree.links.new(bad.outputs[0],node.inputs[2 if row['choice']==0 else 1])
 if row['kind']=='typed':
  value=tree.nodes.new('FunctionNodeInputBool' if row['family']=='switch' else 'FunctionNodeInputInt')
  if row['family']=='switch':value.boolean=bool(row['choice'])
  else:value.integer=row['choice']
  tree.links.new(value.outputs[0],node.inputs[0])
 if row['kind']=='boolean-math':
  value=tree.nodes.new('FunctionNodeBooleanMath');value.operation=row['operation'];value.inputs[0].default_value=row['a']
  if len(value.inputs)>1:value.inputs[1].default_value=row['b']
  tree.links.new(value.outputs[0],node.inputs[0])
 return node.outputs[row.get('output',0)],node
