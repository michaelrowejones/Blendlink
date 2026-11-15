# SPDX-License-Identifier: GPL-3.0-or-later
"""Research-only fixed-axis coefficient boundary controls; no renders or GPU."""
from pathlib import Path
import json,runpy,struct,sys

# The retained helper runs its original 30 cases and 66 basis evaluations first.
# It is an explicitly pinned transitive source, not an installed addon fallback.
helpers=runpy.run_path(str(Path(__file__).with_name('probe.py')))
OUT=Path(sys.argv[sys.argv.index('--')+1]).resolve()
geometry=helpers['geometry'];f=helpers['f'];word=helpers['word'];hashword=helpers['hashword']
value=lambda bits:struct.unpack('=f',struct.pack('=I',bits))[0]
minimum=2**-16
angles=[('zero',0),('min',minimum),('min-next',value(word(minimum)+1)),
        ('negative-min',-minimum),('ordinary',f(.9)),('max',1)]
vectors=[('ordinary',[f(.1),f(.2),f(.3)],[.5,-.5,0]),
         ('bounds',[16,-16,minimum],[-16,16,-minimum]),
         ('centered',[minimum,minimum,minimum],[minimum,minimum,minimum])]
rows=[];evaluations=0
for mode in ['X_AXIS','Y_AXIS','Z_AXIS']:
 for invert in [False,True]:
  for label,angle in angles:
   controls={'mode':mode,'invert':invert,'axis':[0,0,1],'angle':angle,'rotation':[0,0,0]}
   columns=[];basis_hashes=[]
   for lane in range(3):
    basis=[0,0,0];basis[lane]=1
    words,hashes=geometry({**controls,'vector':basis,'center':[0,0,0]});evaluations+=1
    assert list(map(hashword,words))==hashes
    for bits in words:
     absolute=bits&0x7fffffff
     assert not absolute or 0x20000000<=absolute<=0x40000000,('coefficient bound',mode,invert,label,bits)
    columns.append(words);basis_hashes.append(hashes)
   predictions=[]
   for vector_label,vector,center in vectors:
    actual,hashes=geometry({**controls,'vector':vector,'center':center});evaluations+=1
    delta=[f(a-b)for a,b in zip(vector,center)];predicted=[]
    for lane in range(3):
     products=[f(value(columns[index][lane])*delta[index])for index in range(3)]
     predicted.append(word(f(f(f(products[0]+products[1])+products[2])+center[lane])))
    assert predicted==actual and list(map(hashword,predicted))==hashes,('staged output',mode,invert,label,vector_label,predicted,actual,hashes)
    predictions.append({'case':vector_label,'vectorWords':list(map(word,vector)),'centerWords':list(map(word,center)),
      'actualWords':actual,'preStoreHashWords':hashes,'predictedWords':predicted})
   rows.append({'case':mode+'-'+str(invert)+'-'+label,'mode':mode,'invert':invert,'angleWord':word(angle),
     'columnWords':columns,'basisHashWords':basis_hashes,'predictions':predictions})
assert helpers['report']['gpuInitializations']==0
report={'status':'OBSERVED_BOUNDED_FIXED_AXIS_VECTOR_ROTATE_RESEARCH','supportCredit':0,'FinalCredit':0,
 'browserCredit':0,'nativeRenders':0,'gpuInitializations':0,'inheritedGeometryEvaluations':96,
 'boundaryGeometryEvaluations':evaluations,'controlKeys':len(rows),'basisComponentWords':len(rows)*9,
 'predictedVectors':len(rows)*len(vectors),'predictedComponentWords':len(rows)*len(vectors)*3,
 'mismatches':0,'sourceOwnershipRestored':True,'nativeVersion':helpers['report']['nativeVersion'],
 'nativeBuild':helpers['report']['nativeBuild'],'rows':rows}
(OUT/'bounded-native.json').write_text(json.dumps(report,indent=2)+'\n')
print(report['status'],report['controlKeys'],report['predictedComponentWords'])
