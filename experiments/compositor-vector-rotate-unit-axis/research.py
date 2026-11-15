# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned CPU-MF unit-axis comparison, without renders, GPU or port credit."""
from pathlib import Path
import ast,hashlib,json,struct,sys
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];OUT=Path(sys.argv[sys.argv.index('--')+1]).resolve();calls=[]
def deny(*args,**kwargs):calls.append(True);raise RuntimeError('Unit-axis research denies GPU initialization')
gpu.init=deny
try:gpu.init()
except RuntimeError:pass
else:raise AssertionError('GPU guard absent')
calls.clear()
# Reuse the exact retained owned native carrier functions, not a new math oracle.
helper=ROOT/'experiments/compositor-vector-rotate-research/probe.py';source=ast.parse(helper.read_text());names={'raw3','ownership','active','configure','geometry','hash32'};selected=[node for node in source.body if isinstance(node,ast.FunctionDef)and node.name in names];assert{node.name for node in selected}==names
namespace={'bpy':bpy,'array':__import__('array').array,'struct':struct};exec(compile(ast.Module(body=selected,type_ignores=[]),str(helper),'exec'),namespace)
f=lambda value:struct.unpack('=f',struct.pack('=f',value))[0];word=lambda value:struct.unpack('=I',struct.pack('=f',value))[0];value=lambda bits:struct.unpack('=f',struct.pack('=I',bits))[0]
namespace['word']=word;namespace['f']=f;geometry=namespace['geometry'];hashword=lambda bits:namespace['hash32'](namespace['hash32'](bits),0)
owned=namespace['ownership']();old_scene=bpy.context.scene;frame=(old_scene.frame_current,old_scene.frame_subframe)
angles=[('zero',0),('min',2**-16),('min-next',value(word(2**-16)+1)),('ordinary',f(.9)),('max',1),('negative-max',-1)]
vectors=[('ordinary',[f(.1),f(.2),f(.3)],[.5,-.5,.25]),('bounds',[16,-16,2**-16],[-16,16,-2**-16]),('centered',[2**-16]*3,[2**-16]*3)]
rows=[];evaluations=0;schema=bpy.data.node_groups.new('Owned unit-axis schema','CompositorNodeTree')
try:
 node=schema.nodes.new('ShaderNodeVectorRotate');defaults={'mode':node.rotation_type,'invert':node.invert,'axisWords':namespace['raw3'](node,node.inputs['Axis']),'angleWord':word(node.inputs['Angle'].default_value),'inputs':[{'identifier':s.identifier,'type':s.type,'socketClass':s.bl_idname}for s in node.inputs]};assert defaults['mode']=='AXIS_ANGLE'and defaults['axisWords']==[0,0,0x3f800000]and defaults['angleWord']==0
finally:bpy.data.node_groups.remove(schema)
for axis_index,fixed_mode in enumerate(['X_AXIS','Y_AXIS','Z_AXIS']):
 for axis_sign in[1,-1]:
  axis=[0,0,0];axis[axis_index]=axis_sign
  for invert in[False,True]:
   for label,angle in angles:
    controls={'mode':'AXIS_ANGLE','invert':invert,'axis':axis,'angle':angle,'rotation':[0,0,0]};columns=[];basis_hashes=[]
    for lane in range(3):
     basis=[0,0,0];basis[lane]=1;actual,hashes=geometry({**controls,'vector':basis,'center':[0,0,0]});evaluations+=1;assert list(map(hashword,actual))==hashes
     assert all(bits!=0x80000000 and(not(bits&0x7fffffff)or 0x20000000<=bits&0x7fffffff<=0x40000000)for bits in actual);columns.append(actual);basis_hashes.append(hashes)
    outputs=[]
    for name,vector,center in vectors:
     actual,hashes=geometry({**controls,'vector':vector,'center':center});fixed,fixed_hashes=geometry({**controls,'mode':fixed_mode,'invert':invert^(axis_sign<0),'vector':vector,'center':center});evaluations+=2
     delta=[f(a-b)for a,b in zip(vector,center)];predicted=[]
     for lane in range(3):
      products=[f(value(columns[index][lane])*delta[index])for index in range(3)];predicted.append(word(f(f(f(products[0]+products[1])+products[2])+center[lane])))
     assert actual==fixed==predicted and hashes==fixed_hashes==list(map(hashword,predicted)),(axis,angle,invert,name,actual,fixed,predicted,hashes)
     outputs.append({'case':name,'vectorWords':list(map(word,vector)),'centerWords':list(map(word,center)),'actualWords':actual,'fixedTwinWords':fixed,'stagedWords':predicted,'preStoreHashWords':hashes})
    rows.append({'case':fixed_mode+'-'+str(axis_sign)+'-'+str(invert)+'-'+label,'axisWords':list(map(word,axis)),'invert':invert,'angleWord':word(angle),'columnWords':columns,'basisHashWords':basis_hashes,'outputs':outputs})
assert not calls and namespace['ownership']()==owned and bpy.context.scene==old_scene and(old_scene.frame_current,old_scene.frame_subframe)==frame
report={'schemaVersion':1,'status':'OBSERVED_SIGNED_UNIT_AXIS_VECTOR_ROTATE_CPU_MF','supportCredit':0,'FinalCredit':0,'browserCredit':0,'nativeRenders':0,'gpuInitializations':0,'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'helperSha256':hashlib.sha256(helper.read_bytes()).hexdigest(),'helperFunctions':sorted(names),'defaults':defaults,'controlKeys':len(rows),'geometryEvaluations':evaluations,'basisComponentWords':len(rows)*9,'stagedComponentWords':len(rows)*len(vectors)*3,'nativeTwinComponentWords':len(rows)*len(vectors)*3,'wordDifferences':0,'hashDifferences':0,'sourceOwnershipRestored':True,'rows':rows}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows),evaluations)
