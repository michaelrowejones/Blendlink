# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned no-render schema/Geometry-MF/mathutils research; zero port credit."""
from array import array
from pathlib import Path
import json,struct,sys
import bpy,gpu
from mathutils import Matrix,Euler,Vector
ROOT=Path(__file__).resolve().parents[2];OUT=Path(sys.argv[sys.argv.index('--')+1]).resolve()
report={'status':'RUNNING','supportCredit':0,'FinalCredit':0,'browserCredit':0,'nativeRenders':0,'gpuInitializations':0,'schemas':[],'rows':[]}
def deny(*a,**kw):report['gpuInitializations']+=1;raise RuntimeError('Vector Rotate no-render probe denies GPU initialization')
gpu.init=deny
try:gpu.init()
except RuntimeError:pass
else:raise AssertionError('Missing GPU guard')
report['gpuInitializations']=0
f=lambda value:struct.unpack('=f',struct.pack('=f',value))[0]
word=lambda value:struct.unpack('=I',struct.pack('=f',value))[0]
def raw3(node,socket):
 # Euler RNA exposes a mathutils object, not an array bulk method. Copy the
 # native socket into one owned homogeneous interface before the raw read.
 private=owner=None
 try:
  private=bpy.data.node_groups.new('Owned vector copy','CompositorNodeTree');interface=private.interface.new_socket(name='Copy',in_out='INPUT',socket_type='NodeSocketVector');interface.from_socket(node,socket)
  owner=bpy.data.node_groups.new('Owned vector copy owner','CompositorNodeTree');instance=owner.nodes.new('CompositorNodeGroup');instance.node_tree=private;a=array('f',[0])*3;instance.inputs.foreach_get('default_value',a);return list(struct.unpack('=3I',a.tobytes()))
 finally:
  if owner is not None:bpy.data.node_groups.remove(owner,do_unlink=True)
  if private is not None:bpy.data.node_groups.remove(private,do_unlink=True)
def ownership():return tuple(tuple((i.as_pointer(),i.users)for i in collection)for collection in(bpy.data.scenes,bpy.data.objects,bpy.data.meshes,bpy.data.node_groups))
def active(sockets,name):return next(s for s in sockets if s.name==name and s.enabled and not s.is_unavailable)
def configure(tree,mode,invert,vector,center,axis,angle,rotation):
 n=tree.nodes.new('ShaderNodeVectorRotate');n.rotation_type=mode;n.invert=invert
 for name,value in [('Vector',vector),('Center',center)]+([('Rotation',rotation)]if mode=='EULER_XYZ'else([('Axis',axis)]if mode=='AXIS_ANGLE'else[])):n.inputs[name].default_value=value;assert raw3(n,n.inputs[name])==list(map(word,value))
 if mode!='EULER_XYZ':n.inputs['Angle'].default_value=angle;assert n.inputs['Angle'].default_value==f(angle)
 return n
schema_tree=bpy.data.node_groups.new('Owned Vector Rotate Schema','CompositorNodeTree')
try:
 for mode in ['AXIS_ANGLE','X_AXIS','Y_AXIS','Z_AXIS','EULER_XYZ']:
  n=schema_tree.nodes.new('ShaderNodeVectorRotate');n.rotation_type=mode
  report['schemas'].append({'mode':mode,'invertDefault':n.invert,'inputs':[{'name':s.name,'identifier':s.identifier,'type':s.type,'socketClass':s.bl_idname,'enabled':s.enabled,'unavailable':s.is_unavailable,'defaultInput':getattr(s,'default_input',None),'structure':getattr(s,'structure_type',None),'defaultWords':raw3(n,s)if s.type=='VECTOR'else[word(s.default_value)]}for s in n.inputs],'outputs':[{'name':s.name,'type':s.type,'socketClass':s.bl_idname,'width':len(s.default_value)}for s in n.outputs]})
finally:bpy.data.node_groups.remove(schema_tree)
(OUT/'partial-schema.json').write_text(json.dumps(report,indent=2)+'\n')
def geometry(definition):
 before=ownership();scene=mesh=obj=tree=None
 try:
  scene=bpy.data.scenes.new('Owned Vector Rotate MF');mesh=bpy.data.meshes.new('Owned Vector Rotate Point');mesh.from_pydata([(0,0,0)],[],[]);obj=bpy.data.objects.new('Owned Vector Rotate Object',mesh);scene.collection.objects.link(obj)
  tree=bpy.data.node_groups.new('Owned Vector Rotate MF','GeometryNodeTree');tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');entry=tree.nodes.new('NodeGroupInput');exit=tree.nodes.new('NodeGroupOutput');n=configure(tree,**definition);separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(n.outputs[0],separate.inputs[0]);geo=entry.outputs[0]
  for i,signal in enumerate(separate.outputs):
   h=tree.nodes.new('FunctionNodeHashValue');h.data_type='FLOAT';h.inputs['Seed'].default_value=0;tree.links.new(signal,active(h.inputs,'Value'))
   for typ,name,value in [('FLOAT','f'+str(i),signal),('INT','h'+str(i),h.outputs['Hash'])]:
    store=tree.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type=typ;store.domain='POINT';store.inputs['Name'].default_value=name;tree.links.new(geo,store.inputs['Geometry']);tree.links.new(value,active(store.inputs,'Value'));geo=store.outputs['Geometry']
  tree.links.new(geo,exit.inputs[0]);modifier=obj.modifiers.new('Owned MF','NODES');modifier.node_group=tree
  with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
   evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());result=evaluated.to_mesh()
   try:
    outputs=[];hashes=[]
    for i in range(3):
     a=array('f',[0]);result.attributes['f'+str(i)].data.foreach_get('value',a);outputs.append(struct.unpack('=I',a.tobytes())[0]);b=array('i',[0]);result.attributes['h'+str(i)].data.foreach_get('value',b);hashes.append(b[0]&0xffffffff)
   finally:evaluated.to_mesh_clear()
  return outputs,hashes
 finally:
  if obj is not None:bpy.data.objects.remove(obj,do_unlink=True)
  if mesh is not None:bpy.data.meshes.remove(mesh)
  if tree is not None:bpy.data.node_groups.remove(tree)
  if scene is not None:bpy.data.scenes.remove(scene)
  assert ownership()==before
for mode in ['AXIS_ANGLE','X_AXIS','Y_AXIS','Z_AXIS','EULER_XYZ']:
 for invert in [False,True]:
  for label,vector,center,axis,angle,rotation in [('ordinary',[.1,.2,.3],[.5,.5,.5],[.3,-.7,.5],.9,[.1,.2,.3]),('zero-angle',[.1,.2,.3],[.5,.5,.5],[.3,-.7,.5],0,[0,0,0]),('zero-axis',[.1,.2,.3],[.5,.5,.5],[0,0,0],.9,[.1,.2,.3])]:
   definition=dict(mode=mode,invert=invert,vector=list(map(f,vector)),center=list(map(f,center)),axis=list(map(f,axis)),angle=f(angle),rotation=list(map(f,rotation)));actual,hashes=geometry(definition)
   if mode=='EULER_XYZ':
    matrix=Euler(definition['rotation'],'XYZ').to_matrix()
    if invert:matrix.invert()
   else:matrix=Matrix.Rotation(-definition['angle']if invert else definition['angle'],3,definition['axis']if mode=='AXIS_ANGLE'else {'X_AXIS':(1,0,0),'Y_AXIS':(0,1,0),'Z_AXIS':(0,0,1)}[mode])
   expected=matrix@(Vector(definition['vector'])-Vector(definition['center']))+Vector(definition['center'])
   report['rows'].append({'case':mode+'-'+str(invert)+'-'+label,'inputs':definition,'geometryFloatWords':actual,'preStoreHashWords':hashes,'publicMathutilsWords':list(map(word,expected)),'publicMatrixWords':[list(map(word,row))for row in matrix],'inputVectorWords':list(map(word,definition['vector'])),'floatAgreement':actual==list(map(word,expected))})
# One bounded coefficient experiment: call the SAME MF at center +0 on
# each basis vector. No mathutils constructor or output-derived correction.
coefficient_cache={};report['basisRows']=[];report['basisPredictions']=[]
def hash32(*items):
 m=0xffffffff;rot=lambda x,k:((x<<k)|(x>>(32-k)))&m;a=b=c=(0xdeadbeef+(len(items)<<2)+13)&m;a=(a+items[0])&m
 if len(items)>1:b=(b+items[1])&m
 c=((c^b)-rot(b,14))&m;a=((a^c)-rot(c,11))&m;b=((b^a)-rot(a,25))&m;c=((c^b)-rot(b,16))&m;a=((a^c)-rot(c,4))&m;b=((b^a)-rot(a,14))&m;c=((c^b)-rot(b,24))&m;return c
hashword=lambda w:hash32(hash32(w),0)
for row in report['rows']:
 d=row['inputs'];controls={k:d[k]for k in ('mode','invert')}
 controls.update({'rotation':d['rotation']}if d['mode']=='EULER_XYZ'else{'angle':d['angle'],**({'axis':d['axis']}if d['mode']=='AXIS_ANGLE'else{})})
 key=json.dumps(controls,sort_keys=True)
 if key not in coefficient_cache:
  columns=[];hashes=[]
  for index in range(3):
   basis=[0,0,0];basis[index]=1;source={**d,'vector':basis,'center':[0,0,0]};output,h=geometry(source);columns.append(output);hashes.append(h)
  coefficient_cache[key]=columns;report['basisRows'].append({'controls':controls,'columnWords':columns,'preStoreHashWords':hashes,'storedWordsMatchPreStoreHashes':all(list(map(hashword,a))==b for a,b in zip(columns,hashes))})
 columns=coefficient_cache[key];values=[[struct.unpack('=f',struct.pack('=I',column[lane]))[0]for column in columns]for lane in range(3)];centered=[f(a-b)for a,b in zip(d['vector'],d['center'])]
 predicted=[]
 for lane,coefficients in enumerate(values):
  products=[f(a*b)for a,b in zip(coefficients,centered)];predicted.append(word(f(f(f(products[0]+products[1])+products[2])+d['center'][lane])))
 report['basisPredictions'].append({'case':row['case'],'predictedWords':predicted,'actualWords':row['geometryFloatWords'],'exact':predicted==row['geometryFloatWords'],'preStoreExact':list(map(hashword,predicted))==row['preStoreHashWords']})
report['basisGeometryEvaluations']=len(coefficient_cache)*3
report['basisPredictionMismatches']=[r['case']for r in report['basisPredictions']if not(r['exact']and r['preStoreExact'])]
assert report['gpuInitializations']==0
report.update(status='OBSERVED_VECTOR_ROTATE_CPU_MF_RESEARCH',nativeVersion=list(bpy.app.version),nativeBuild=bpy.app.build_hash.decode(),sourceOwnershipRestored=True,mathutilsFloatMismatches=[r['case']for r in report['rows']if not r['floatAgreement']]);(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(report['rows']),report['mathutilsFloatMismatches'])
