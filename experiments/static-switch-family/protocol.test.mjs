import {test} from 'node:test'
import assert from 'node:assert/strict'
import {assertQualification,assertFinal,assertBrowserReport,expectedCases,variant,expectedSavedFinalCount,viewCases,assertMonoProgram,integerVectorCases,assertIntegerVectorProgram,assertIntegerVectorWords} from './protocol.mjs'
const native=()=>({status:'CAPTURED_STATIC_SELECTION',version:[5,3,0],build:'02f0899d78e3',context:variant!=='static'?'CPU':'shader',sourcePreserved:true,width:8,height:8,...(variant!=='static'?{nativeBackend:{evaluator:'native-cpu-compositor',requestedCompositorDevice:'CPU',gpuInitialized:false,gpuEvaluationCredit:false}}:{}),...(variant==='integer-vector3'?{pythonGpuInitializationCalls:0}:{}),cases:expectedCases.map((name,index)=>({...((variant==='integer-vector3'?integerVectorCases.find(row=>row.case===name):variant==='mono-view'?viewCases.find(row=>row.case===name):null)??{}),case:name,context:variant!=='static'?'CPU':'shader',sourcePreserved:true,programSha256:'a'.repeat(64),pixelSha256:'b'.repeat(64),...((variant==='integer-vector3'?integerVectorCases[index].saveFinal:index<expectedSavedFinalCount)?{sourceFile:name+'.blend'}:{})}))})
const final=q=>({status:'PUBLISHED_STATIC_SELECTION',context:q.context,sourcePreserved:true,nativeQualificationSha256:'c'.repeat(64),rows:q.cases.filter(x=>x.sourceFile)})
function report(q,f,phase=false){return{status:'PASSED_STATIC_SELECTION_BUILT_PROOF',built:true,final:phase,profile:'metal',sourceContext:q.context,missingAdapterControl:{refused:true,error:'actual WebGPU adapter'},rows:['webgpu','webgl2'].map(backend=>({backend,gpu:{api:backend==='webgpu'?'WebGPU':'WebGL2',vendor:'Apple Metal'},pageErrors:[],errors:[],rows:(phase?f.rows:q.cases).map(x=>({case:x.case,wordMismatches:0,remainingTextures:0,ownershipPreserved:true,finalBindings:phase,pinRejected:phase?true:null,...(variant==='integer-vector3'?{readbacks:(phase?['primary','repeat','reinstalled']:['primary','repeat']).map(name=>({phase:name,comparedWords:256,rowFlip:false,wordFile:'readbacks/'+backend+'-'+x.case+'-'+name+'.u32',wordSha256:'d'.repeat(64)}))}:{}),...(variant!=='static'?{comparedWords:256,lifecycleCycles:phase?2:1}:{})}))}))}}
test('closes native class, typed mode, selection, group, mask and control census',()=>{assert.equal(expectedCases.length,variant==='integer-vector3'?16:variant==='mono-view'?8:71);const q=native();assertQualification(q);assertFinal(final(q),q,'c'.repeat(64));for(const mutate of [q=>q.cases.pop(),q=>q.cases[3].case=q.cases[2].case,q=>q.build='different',q=>q.sourcePreserved=false]){const x=structuredClone(q);mutate(x);assert.throws(()=>assertQualification(x))}})
test('requires both actual APIs, all cases, exact words, ownership and missing-adapter refusal',()=>{const q=native(),f=final(q);for(const phase of [false,true]){const r=report(q,f,phase),options={profile:'metal',final:phase};assertBrowserReport(r,q,f,options);for(const mutate of [r=>r.rows.pop(),r=>r.rows[0].backend='webgl2',r=>r.rows[0].rows.pop(),r=>r.rows[0].rows[1].wordMismatches=1,r=>r.rows[0].rows[1].remainingTextures=1,r=>r.rows[0].rows[1].ownershipPreserved=false,r=>r.rows[0].gpu.vendor='SwiftShader',r=>r.missingAdapterControl.refused=false,...(phase?[r=>r.rows[0].rows[1].pinRejected=false]:[])]){const x=structuredClone(r);mutate(x);assert.throws(()=>assertBrowserReport(x,q,f,options))}}})

test('mono view annotations reject stale context, wrong actual input and inactive dependency copies',()=>{
 if(variant!=='mono-view')return
 const entry=viewCases.find(row=>row.kind==='view-literal'),good={status:'extracted',ops:[],compileTimeViews:[{model:'native-mono-switch-view-cpu-53-v1',nativeVersion:[5,3,0],nativeBuild:'02f0899d78e3',sourceContext:'current-mono-CPU',selectionKind:'actual-native-input0',preservesSelectedDomain:true,selectedInput:'left',inputIdentifiers:['left','right']}]}
 assertMonoProgram(good,entry)
 for(const mutate of[p=>p.compileTimeViews=[],p=>p.compileTimeViews[0].sourceContext='GPU',p=>p.compileTimeViews[0].selectedInput='right',p=>p.compileTimeViews[0].inputIdentifiers.reverse(),p=>p.ops.push({source:{nodeType:'CompositorNodeSceneTime'}})]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>assertMonoProgram(bad,entry))}
})

test('mono CPU context never substitutes configured GPU metadata for actual evaluation',()=>{
 if(variant!=='mono-view')return
 const good=native();assertQualification(good)
 for(const value of[{backend:'METAL',renderer:'claimed GPU'},{evaluator:'native-cpu-compositor',requestedCompositorDevice:'CPU',gpuInitialized:true,gpuEvaluationCredit:false},{evaluator:'native-cpu-compositor',requestedCompositorDevice:'CPU',gpuInitialized:false,gpuEvaluationCredit:true}]){const bad=structuredClone(good);bad.nativeBackend=value;assert.throws(()=>assertQualification(bad))}
})

test('integer vector native schema retains exact signed property and explicit presentation',()=>{
 if(variant!=='integer-vector3')return
 const entry=integerVectorCases.find(x=>x.case==='int3-extremes'),op={id:'n0',kind:'integer-vector',type:'INT_VECTOR3',value:entry.value,inputs:{},source:{nodeType:'FunctionNodeInputIntVector',output:'Vector'},properties:{integer_vector_model:'native-int3-constant-53-v1',integer_vector_profile:'darwin-arm64-53-int3-cpu-v1',integer_vector_build:'02f0899d78e3',integer_vector_version:[5,3,0],integer_vector_dimensions:3,evaluation_device:'CPU',single_value_device:'CPU',integer_vector_presentation:'component-rne-f32-alpha-one-v1'}}
 const good={status:'extracted',passes:[],ops:[op],output:{kind:'convert',fromType:'INT_VECTOR3',type:'RGBA',input:{kind:'ref',node:'n0',type:'INT_VECTOR3'}}};assertIntegerVectorProgram(good,entry)
 for(const change of[p=>p.ops[0].value[0]=0,p=>p.ops[0].type='INT_VECTOR2',p=>p.output.fromType='VECTOR',p=>p.ops[0].properties.evaluation_device='GPU',p=>p.ops.push({...p.ops[0],id:'unused'})]){const bad=structuredClone(good);change(bad);assert.throws(()=>assertIntegerVectorProgram(bad,entry))}
 const q=native();q.pythonGpuInitializationCalls=1;assert.throws(()=>assertQualification(q))
})

test('integer vector independently checks every archived raw word and lifecycle census',()=>{
 if(variant!=='integer-vector3')return
 const entry=integerVectorCases.find(x=>x.case==='int3-extremes'),bytes=Buffer.alloc(1024)
 for(let i=0;i<256;i++)bytes.writeUInt32LE(entry.expectedWords[i%4],i*4)
 assert.equal(assertIntegerVectorWords(bytes,entry),256)
 for(const index of [0,126,255]){const bad=Buffer.from(bytes);bad.writeUInt32LE((bad.readUInt32LE(index*4)^1)>>>0,index*4);assert.throws(()=>assertIntegerVectorWords(bad,entry))}
 assert.throws(()=>assertIntegerVectorWords(bytes.subarray(0,1020),entry))
 const q=native(),f=final(q)
 for(const phase of [false,true])for(const change of [r=>r.rows[0].rows[0].readbacks.pop(),r=>r.rows[0].rows[0].readbacks[0].comparedWords=0,r=>r.rows[0].rows[0].readbacks[1].phase='primary',r=>r.rows[0].rows[0].readbacks[0].wordFile='../foreign.u32',r=>r.rows[0].rows[0].readbacks[0].wordSha256='missing']){const bad=report(q,f,phase);change(bad);assert.throws(()=>assertBrowserReport(bad,q,f,{profile:'metal',final:phase}))}
})
