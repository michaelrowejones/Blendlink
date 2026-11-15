/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import {blankNativeFixture,blankFinalFixture,blankBrowserFixture} from './schema-fixtures.mjs'
import {assertCasePlan,cases,assertProgram,assertPolicy,assertQualification,assertFinal,assertBrowserRows,browserProofContract,policyPositive,policyRefusals} from './protocol.mjs'
import {assertBrowserProofAssembly} from '../../scripts/lib/browser-proof-contract.mjs'
const text=path=>readFile(new URL(path,import.meta.url),'utf8'),fixture=JSON.parse(await text('./native-program-fixture.json')),row=cases.find(r=>r.case==='odd-13x9')
test('shared immutable family contract and source assembly are checked before native work',async()=>{
 const [runner,reader,protocol]=await Promise.all(['run.mjs','verify.mjs','protocol.mjs'].map(name=>text('./'+name)))
 assert.deepEqual(assertBrowserProofAssembly({family:'compositor-blank-image',contract:browserProofContract,runner,reader,protocol}),{family:'compositor-blank-image',schemaVersion:1,numericalCredit:0})
 for(const name of['run.mjs','browser.js','capture.mjs','matrix.mjs','verify.mjs']){const source=await text('./'+name),file=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.deepEqual(file.parseDiagnostics,[],name)}
 const capture=await text('./capture.mjs');assert.ok(capture.indexOf('preflightBrowserProofContracts(root')<capture.indexOf('createNodePortBlenderLauncher({'));assert.ok(capture.indexOf('assertPolicy(JSON.parse')<capture.indexOf("join(root,'experiments/compositor-blank-image/reference.py')"));assert.ok(capture.indexOf('assertProgram(JSON.parse')<capture.indexOf("export.test.ts"))
})
test('actual native sorted JSON program is accepted; missing, extra and mistyped controls refuse',()=>{
 assertProgram(fixture,row)
 const sorted=JSON.parse(JSON.stringify(fixture,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value));assertProgram(sorted,row)
 for(const change of[p=>delete p.ops[0].inputs.Size,p=>p.ops[0].inputs.extra={},p=>p.ops[0].inputs.Size.value.type='VECTOR',p=>p.ops[0].inputs.Color.value.value[0]=.125,p=>p.ops[0].properties.blank_image_effective_size=[1,1],p=>p.ops[0].source.nodeType='CompositorNodeRGB',p=>p.ops.push(p.ops[0])]){const p=structuredClone(fixture);change(p);assert.throws(()=>assertProgram(p,row))}
})
test('closed native plan refuses missing, duplicated and wrong-resize-source rows',()=>{
 assertCasePlan(cases);assert.throws(()=>assertCasePlan(cases.slice(1)));const repeated=structuredClone(cases);repeated[1]=repeated[0];assert.throws(()=>assertCasePlan(repeated));const foreign=structuredClone(cases);foreign[0].resizeCases=['odd-26x18'];assert.throws(()=>assertCasePlan(foreign))
})
test('source policy consumes exact logical refusal identities rather than counts',()=>{
 const p={status:'SCENETOWEB_BLANK_IMAGE_POLICY_PASSED',positives:policyPositive,refusals:policyRefusals,sourceReadRepeats:3,gpuInitGuardProved:true,supportCredit:0,nativeRenders:0,gpuInitializations:0};assertPolicy(p);for(const q of[{...p,refusals:[...policyRefusals].reverse()},{...p,positives:policyPositive.slice(1)},{...p,gpuInitializations:1}])assert.throws(()=>assertPolicy(q))
})

test('full native/Final/browser schemas refuse missing cases, false metrics and repeated lifecycle IDs',()=>{
 const q=assertQualification(blankNativeFixture()),f=blankFinalFixture(q);assertFinal(f,q,{built:true,nativeSha256:'a'.repeat(64)})
 for(const profile of ['metal','software'])for(const final of [false,true]){const good=blankBrowserFixture(q,f,{profile,final});assertBrowserRows(good,q,f,{profile,final});for(const change of[r=>r.rows[0].rows.pop(),r=>r.rows[0].rows[1]=r.rows[0].rows[0],r=>r.rows[0].rows[0].comparedWords--,r=>r.rows[0].rows[0].samples.pop(),r=>r.rows[0].savedDispose.physicalDestroys=1,r=>r.rows[0].savedDispose.perHandleDestroys=[2,0],r=>r.rows[0].savedDispose.perHandleDestroys=[0,2],r=>r.rows[0].savedDispose.distinctHandles=1,r=>r.rows[0].savedDispose.externalDevice=false,r=>r.rows[0].gpu.api='fallback',r=>r.rows[0].rows[0].resizeResults.pop()]){const bad=structuredClone(good);change(bad);assert.throws(()=>assertBrowserRows(bad,q,f,{profile,final}))}if(final){const bad=structuredClone(good);bad.rows[0].rows[0].installationCycles[2].cycle=1;assert.throws(()=>assertBrowserRows(bad,q,f,{profile,final}))}}
})
