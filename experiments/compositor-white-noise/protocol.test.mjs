import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {assertBrowserProofAssembly} from '../../scripts/lib/browser-proof-contract.mjs'
import {cases,expectedRgbaWords,expectedFinalCases,assertQualification,assertFinal,assertPolicy,policyRefusals,interfaceDefaultControls,browserProofContract,hashWords} from './protocol.mjs'
const pin='a'.repeat(64)
function qualification(){return {status:browserProofContract.nativeStatus,version:[5,3,0],build:'02f0899d78e3',device:'CPU',sceneEngine:'CYCLES',resultPrecision:'CPU_FLOAT32',wordDifferences:0,cases:cases.map(row=>({...structuredClone(row),rgbaWords:expectedRgbaWords(row),programFile:row.case+'.program.json',pixelFile:row.case+'.rgba32f',inputFile:row.case+'.input32f',programSha256:pin,pixelSha256:pin,inputSha256:pin,...(row.imageInfoControl?{imageInfoDimensions:[0,0],imageInfoFile:row.case+'.info.rgba32f',imageInfoSha256:pin}:{}),...(row.saved?{sourceFile:row.case+'.blend',sourceSha256:pin}:{})}))}}
const final=q=>({status:browserProofContract.finalStatus,exporter:'built',sourcePreserved:true,nativeQualificationSha256:pin,rows:q.cases.filter(row=>row.saved).map(({case:name,sourceFile,sourceSha256})=>({case:name,sourceFile,sourceSha256,manifestSha256:pin,glbSha256:pin,presentationSha256:pin,presentationPointer:{url:'/actual/source.json',bytes:123}}))})
test('44 exact native cases /12 saved sources cover all dimensions, outputs, normal extremes and group routes',()=>{
 assert.equal(cases.length,44);assert.equal(expectedFinalCases().length,12)
 for(const dimension of [1,2,3,4])for(const output of ['Value','Color'])assert.equal(cases.filter(row=>row.dimensions===dimension&&row.output===output&&row.route==='direct').length,5)
 const q=qualification();assertQualification(q);assertFinal(final(q),q,{built:true,nativeSha256:pin})
 // Independent retained actual CPU source witnesses from the feasibility probe.
 assert.equal(hashWords([0x3dcccccd]),1592491683);assert.equal(hashWords([0x80000000]),3876671579);assert.equal(hashWords([1]),1255655072)
})
test('native and realistic stripped Final schemas reject drift, cross-family status and missing source controls',()=>{
 for(const mutate of [q=>q.status='CAPTURED_COMPOSITOR_STATIC_MATRIX',q=>q.device='GPU',q=>q.cases.pop(),q=>q.cases[1]={...q.cases[0]},q=>q.cases[0].rgbaWords[1]++,q=>q.cases[0].seedWords[0]=1,q=>q.cases.find(row=>row.imageInfoControl).imageInfoDimensions=[4,4],q=>delete q.cases.find(row=>row.imageInfoControl).imageInfoFile]){const q=qualification();mutate(q);assert.throws(()=>assertQualification(q))}
 const q=qualification()
 for(const mutate of [f=>f.status='PUBLISHED_COMPOSITOR_STATIC_MATRIX',f=>f.rows.pop(),f=>f.rows[1]={...f.rows[0]},f=>f.sourcePreserved=false,f=>f.nativeQualificationSha256='b'.repeat(64)]){const f=final(q);mutate(f);assert.throws(()=>assertFinal(f,q,{built:true,nativeSha256:pin}))}
})
test('policy census is fresh and all partial failures remain zero credit',()=>{
 const value={status:'WHITE_NOISE_SOURCE_POLICY_PASSED',positiveControls:Array(18),namedRefusals:[...policyRefusals],interfaceDefaultControls:interfaceDefaultControls.map(row=>({...row,...(row.nativeAvailable===false?{setterRefusal:'native enum not found'}:{})})),gpuInitializationCalls:0,renders:0,portCredit:0};assertPolicy(value)
 for(const change of [v=>v.namedRefusals.pop(),v=>v.positiveControls.pop(),v=>v.gpuInitializationCalls=1,v=>v.interfaceDefaultControls.pop(),v=>v.interfaceDefaultControls[0].status='extracted',v=>v.interfaceDefaultControls[2].nativeAvailable=true]){const v=structuredClone(value);change(v);assert.throws(()=>assertPolicy(v))}
})
test('own immutable protocol status is consumed by actual runner and closed reader AST',async()=>{
 const [runner,reader,protocol]=await Promise.all(['run.mjs','verify.mjs','protocol.mjs'].map(name=>readFile(new URL(name,import.meta.url),'utf8')))
 assertBrowserProofAssembly({family:'compositor-white-noise',contract:browserProofContract,runner,reader,protocol})
})
