/* SPDX-License-Identifier: MIT */
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {expectedCalibrationCases,assertCasePlan,assertProgram,assertPolicy,assertQualification,assertFinal,assertBrowserRows,cases,expectedFinalCases,browserProofContract,policyPositive,policyRefusals} from './protocol.mjs'
import {assertBrowserProofAssembly} from '../../scripts/lib/browser-proof-contract.mjs'
const read=name=>readFile(new URL(name,import.meta.url),'utf8')
test('closed plan retains every mode/invert, ten Finals, real resize and constant guard',()=>{
 assertCasePlan(cases);assert.equal(expectedFinalCases().length,10)
 for(const mode of['X_AXIS','Y_AXIS','Z_AXIS'])for(const invert of[false,true])assert.ok(cases.some(row=>row.mode===mode&&row.invert===invert&&row.saved))
 for(const mutate of[p=>p.pop(),p=>p[1].case=p[0].case,p=>p[0].resizeCases=['absent'],p=>p.find(r=>r.resizeCases.length).resizeCases.push('literal-X_AXIS')]){const copy=structuredClone(cases);mutate(copy);assert.throws(()=>assertCasePlan(copy))}
})
test('actual lexicographically serialized native pilot IR is accepted with strict malformed rejection',async()=>{
 const fixture=JSON.parse(await read('./native-program-fixture.json')),spec=cases.find(row=>row.case==='X_AXIS-forward-ordinary');assertProgram(fixture,spec)
 for(const mutate of[p=>p.ops.find(o=>o.kind==='vector-rotate-cpu').properties.vector_rotate_angle_word++,p=>p.ops.find(o=>o.kind==='vector-rotate-cpu').inputs.Fake={},p=>p.ops[0].source.nodeType='Other',p=>p.ops.reverse(),p=>p.output.type='VALUE']){const copy=structuredClone(fixture);mutate(copy);assert.throws(()=>assertProgram(copy,spec))}
})
test('exact source policy IDs reject missing, duplicate and reordered controls',()=>{
 const policy={status:'SCENETOWEB_COMPOSITOR_VECTOR_ROTATE_POLICY_PASSED',positives:policyPositive,refusals:policyRefusals,programs:policyPositive.map(label=>({case:label})),gpuInitializations:0,nativeRenders:0,supportCredit:0};assertPolicy(policy)
 for(const field of['positives','refusals'])for(const mutate of[a=>a.pop(),a=>a[1]=a[0],a=>a.reverse()]){const copy=structuredClone(policy);mutate(copy[field]);assert.throws(()=>assertPolicy(copy))}
})
test('browser contract assembly and early native schemas precede expensive renders/exports',async()=>{
 const runner=await read('./run.mjs'),reader=await read('./verify.mjs'),protocol=await read('./protocol.mjs');assertBrowserProofAssembly({family:'compositor-vector-rotate',contract:browserProofContract,runner,reader,protocol})
 const capture=await read('./capture.mjs');assert.ok(capture.indexOf('await programs(source.cases)')<capture.indexOf("await native('reference.py');"));assert.ok(capture.indexOf('await programs(q.cases)')<capture.indexOf("'experiments/compositor-vector-rotate/export.test.ts'"))
})
test('browser final census rejects reordered/missing raw and Final IDs before metrics can grant credit',()=>{
 assert.throws(()=>assertQualification({status:browserProofContract.nativeStatus,cases:[]}));assert.throws(()=>assertFinal({status:browserProofContract.finalStatus,rows:[]},{},{built:true,nativeSha256:'0'.repeat(64)}));assert.throws(()=>assertBrowserRows({status:browserProofContract.browserStatus,built:true,final:false,profile:'metal',rows:[]},{cases},{rows:[]},{profile:'metal',final:false}))
})
test('full browser schema checks ordered case/sample/cycle IDs and every original handle',()=>{
 const pin='a'.repeat(64),q={cases},f={rows:expectedFinalCases()}
 const make=final=>({status:browserProofContract.browserStatus,built:true,final,profile:'software',missingAdapterControl:{refused:true},rows:['webgpu','webgl2'].map(backend=>({backend,gpu:{api:backend==='webgpu'?'WebGPU':'WebGL2',description:'SwiftShader'},errors:[],pageErrors:[],uncaptured:[],calibrations:expectedCalibrationCases(final?expectedFinalCases():cases,final).map(control=>{const spec=cases.find(row=>row.case===control.case);return{...control,width:spec.width,height:spec.height,pixelRatio:spec.pixelRatio,backend,readbackFlipY:false,copySha256:pin,pixelSha256:pin}}),rows:(final?expectedFinalCases():cases).map(spec=>{const labels=[spec.case,spec.case,...spec.resizeCases.flatMap(label=>[label,label]),spec.case,...(final?[spec.case,spec.case]:[])];return{case:spec.case,width:spec.width,height:spec.height,pixelRatio:spec.pixelRatio,kind:spec.kind,comparedWords:spec.width*spec.height*4,exactWordMismatches:0,portOwnedTextures:spec.kind==='normalized'?1:0,unchangedExtentUploads:0,additionalPortPasses:0,remainingRenderTargets:0,constantTerminalGuard:spec.terminal==='z',resizeResults:spec.resizeCases.map(name=>{const row=cases.find(r=>r.case===name);return{case:name,comparedWords:row.width*row.height*4,exactWordMismatches:0,rowUploads:spec.kind==='normalized'?1:0,repeatUploads:0}}),samples:labels.map((label,index)=>({case:label,index,cycle:final&&index>=labels.length-2?index-labels.length+3:0,sha256:pin,exactWordMismatches:0,...(final?{displaySha256:pin}:{})})),...(final?{lifecycleCycles:3,cancelledPreparationRejected:true,preparedCancellationRestored:true,pinRejected:true,hostIdentityRestored:true,rendererCallbacksRestored:true,rendererPropertiesRestored:true,baselineCacheRestored:true,installer:'startThreeCompiledScenePreparation.commit',meshCount:1,installationCycles:[0,1,2].map(cycle=>({cycle}))}:{})}}),negatives:['source-profile','invalid-viewport','physical-extent'].map(kind=>({kind,error:'Vector Rotate: synthetic refusal'})),savedDispose:{physicalDestroys:1,perHandleDestroys:[1],distinctHandles:1,externalDevice:backend==='webgpu',remainingOwnedTextures:0,idempotentDisposal:true,error:'Vector Rotate: epoch ended'}}))})
 for(const final of[false,true]){const report=make(final);assertBrowserRows(report,q,f,{profile:'software',final});for(const mutate of[r=>r.rows[0].rows.reverse(),r=>r.rows[0].rows.pop(),r=>r.rows[0].rows[1]=r.rows[0].rows[0],r=>r.rows[0].rows[0].samples.pop(),r=>r.rows[0].rows[0].samples[0].cycle=9,r=>r.rows[0].savedDispose.perHandleDestroys=[0],r=>r.rows[0].savedDispose.perHandleDestroys=[2],r=>r.rows[0].savedDispose.externalDevice=false,r=>r.rows[0].gpu.description='Google hardware',r=>r.rows[0].calibrations.pop(),r=>r.rows[0].calibrations[0].role='other',r=>r.rows[0].calibrations[1]=r.rows[0].calibrations[0],r=>r.rows[0].calibrations[0].copySha256='bad']){const copy=structuredClone(report);mutate(copy);assert.throws(()=>assertBrowserRows(copy,q,f,{profile:'software',final}))}}
})

test('calibration reader independently derives orientation and rejects truncated, flipped and corrupt captures',async()=>{
 const{assertCalibrationBuffers}=await import('./native-reader.mjs'),width=4,height=4,expected=Buffer.alloc(width*height*16)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(const[lane,value]of[x,y,0,1].entries())expected.writeFloatLE(value,((y*width+x)*4+lane)*4)
 const row={width,height,readbackFlipY:false};assertCalibrationBuffers(row,expected,expected,expected)
 for(const [r,copy,pixel]of[[{...row,readbackFlipY:true},expected,expected],[row,expected.subarray(4),expected],[row,expected,expected.subarray(4)],[row,Buffer.alloc(expected.length),expected],[row,expected,Buffer.alloc(expected.length)]])assert.throws(()=>assertCalibrationBuffers(r,copy,pixel,expected))
})
