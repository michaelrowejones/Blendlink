/* SPDX-License-Identifier: MIT */
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {assertBrowserProofAssembly,preflightBrowserProofContracts} from '../../scripts/lib/browser-proof-contract.mjs'
import {cases,assertProgram,assertCasePlan,assertPolicy,policyPositive,policyRefusals,assertQualification,assertFinal,assertBrowserRows,expectedWaveRgbaWords,uniformAxisWords,browserProofContract} from './protocol.mjs'
import {waveNativeFixture,waveFinalFixture,waveBrowserFixture,waveProgramFixture} from './schema-fixtures.mjs'
const root=resolve(import.meta.dirname,'../..'),pin='a'.repeat(64)
const policy=()=>({status:'WAVE_AXIS_SOURCE_POLICY_PASSED',positive:[...policyPositive],refusals:[...policyRefusals],nativeRenders:0,gpuInitializations:0,supportCredit:0,injectedReaderWordControls:3})
test('preflight closes the actual runner/reader assembly before any native launch',async()=>{
 const result=await preflightBrowserProofContracts(root,['compositor-wave-axis']);assert.equal(result.numericalCredit,0)
 const assembly={family:'compositor-wave-axis',contract:browserProofContract,runner:await readFile(join(import.meta.dirname,'run.mjs'),'utf8'),reader:await readFile(join(import.meta.dirname,'verify.mjs'),'utf8'),protocol:await readFile(join(import.meta.dirname,'protocol.mjs'),'utf8')}
 assert.throws(()=>assertBrowserProofAssembly({...assembly,runner:assembly.runner.replace('report.status=browserProofContract.browserStatus',"report.status='PASSED_WRONG_BUILT_PROOF'")}))
 const capture=await readFile(join(import.meta.dirname,'capture.mjs'),'utf8');assert.ok(capture.indexOf('assertPolicy(')<capture.indexOf("reference.py'"),'Policy must close before native renders')
 assert.ok(capture.indexOf('for(const row of native.cases)')>capture.indexOf('assertQualification('),'Actual captured cases must be available before validating programs')
 assert.ok(capture.indexOf('assertProgram(JSON.parse(bytes),row)')<capture.indexOf("export.test.ts'"),'Every actual program must close before Final exports or browsers')
 assert.match(capture,/readFile\(join\(destination,row\.programFile\)\)/);assert.match(capture,/assert\.equal\(hash\(bytes\),row\.programSha256/)
 const exporter=await readFile(join(import.meta.dirname,'export.test.ts'),'utf8');assert.match(exporter,/assertProgram\(presentation\.compositor,reference\)/)
})
test('the declared cross-product refuses lost/duplicate/default/profile/control variants',()=>{
 assertCasePlan(cases)
 for(const mutate of[x=>x.pop(),x=>x[1]={...x[0]},x=>x[0].profile='SIN',x=>x[0].parameterWords[0]=0x80000000,x=>x[0].parameterWords[1]=1,x=>x[0].parameterWords[2]=0x3f000000,x=>x[0].resizeCases.push('missing'),x=>x[0].saved=false]){const rows=structuredClone(cases);mutate(rows);assert.throws(()=>assertCasePlan(rows))}
})
test('source policy uses ordered explicit IDs and distinguishes injected storage controls',()=>{
 assertPolicy(policy())
 for(const mutate of[x=>x.positive.pop(),x=>x.refusals.pop(),x=>x.refusals[1]=x.refusals[0],x=>x.positive.reverse(),x=>x.nativeRenders=1,x=>x.gpuInitializations=1,x=>x.supportCredit=1,x=>x.injectedReaderWordControls=0]){const value=policy();mutate(value);assert.throws(()=>assertPolicy(value))}
})
test('native and saved Final schemas close ordered cases, owned sources and endpoint records',()=>{
 const q=waveNativeFixture();assertQualification(q);const f=waveFinalFixture(q);assertFinal(f,q,{built:true,nativeSha256:pin})
 for(const mutate of[x=>x.cases.pop(),x=>x.cases.reverse(),x=>x.cases[1]={...x.cases[0]},x=>x.nativeRenders--,x=>x.cases[0].sourceOwnershipPreserved=false,x=>x.coordinateControls.pop(),x=>x.fieldDomainControl.dimensions=[0,0],x=>x.cases[0].parameterWords[0]++,x=>x.device='GPU']){const value=structuredClone(q);mutate(value);assert.throws(()=>assertQualification(value))}
 for(const mutate of[x=>x.rows.pop(),x=>x.rows.reverse(),x=>x.rows[1]={...x.rows[0]},x=>x.sourcePreserved=false,x=>x.provenance.push({source:'missing',artifact:'missing',sha256:pin}),x=>x.rows[0].moduleExport=x.rows[1].moduleExport]){const value=structuredClone(f);mutate(value);assert.throws(()=>assertFinal(value,q,{built:true,nativeSha256:pin}))}
})
test('browser close requires both actual APIs/profiles and exact per-case words/resources/lifecycle',()=>{
 const q=waveNativeFixture(),f=waveFinalFixture(q)
 for(const profile of['metal','software'])for(const final of[false,true]){
  const settings={profile,final},good=waveBrowserFixture(q,f,settings);assertBrowserRows(good,q,f,settings)
  for(const mutate of[x=>x.rows.pop(),x=>x.rows.reverse(),x=>x.rows[0].gpu.api='fallback',x=>x.rows[0].gpu.renderer='Google ANGLE',x=>x.rows[0].rows.reverse(),x=>x.rows[0].rows[1]={...x.rows[0].rows[0]},x=>x.rows[0].rows[0].comparedWords--,x=>x.rows[0].rows[0].exactWordMismatches=1,x=>x.rows[0].rows[0].rowTableBindings++,x=>x.rows[0].rows[0].resizeResults.pop(),x=>x.rows[0].savedDispose.physicalDestroys=0,x=>x.rows[0].negatives.pop(),x=>x.rows[0].savedDispose.bindingControls.pop(),x=>x.rows[0].savedDispose.bindingControls[0].borrowedDisposals=1,x=>x.rows[0].rows[0].maximumRowBytes++]){const value=structuredClone(good);mutate(value);assert.throws(()=>assertBrowserRows(value,q,f,settings))}
  if(final)for(const mutate of[x=>x.rows[0].rows[0].installationCycles.pop(),x=>x.rows[0].rows[0].cancelledPreparationRejected=false,x=>x.rows[0].rows[0].preparedCancellationRestored=false,x=>x.rows[0].rows[0].hostIdentityRestored=false,x=>x.rows[0].rows[0].live.initialRowUploads=99]){const value=structuredClone(good);mutate(value);assert.throws(()=>assertBrowserRows(value,q,f,settings))}
 }
})
test('independent source-law interpreter retains exact native research SAW/TRI factor rows',async()=>{
 const {createHash}=await import('node:crypto'),goldens=JSON.parse(await readFile(join(import.meta.dirname,'native-row-goldens.json'),'utf8'))
 for(const row of goldens.rows){const size=row.axis==='X'?row.width:row.height,maximum=Math.max(row.width,row.height),coords=uniformAxisWords(size,maximum),factors=new Uint32Array(size)
  for(let i=0;i<size;i++){const axes=row.axis==='X'?[coords[i],0,0]:[0,coords[i],0];factors[i]=expectedWaveRgbaWords({...row,route:'direct'},axes)[0]}
  assert.equal(createHash('sha256').update(new Uint8Array(factors.buffer)).digest('hex'),row.nativeFactorRowSha256,row.case)
 }
})

test('Final lexicographic object serialization preserves semantic input keys and rejects missing or extra members',()=>{
 const row=cases[0],native=waveProgramFixture(row),ordered=value=>JSON.parse(JSON.stringify(value,(_key,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry))
 assertProgram(native,row);const published=ordered(native)
 assert.deepEqual(Object.keys(published.ops[0].inputs),['Distortion','Phase Offset','Scale']);assertProgram(published,row)
 const reversed=JSON.parse(JSON.stringify(native,(_key,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.keys(entry).reverse().map(key=>[key,entry[key]])):entry));assertProgram(reversed,row)
 for(const mutate of[x=>delete x.ops[0].inputs.Scale,x=>x.ops[0].inputs.Extra=x.ops[0].inputs.Scale,x=>x.ops[0].inputs.Scale.value.extra=1,x=>delete x.ops[0].inputs.Scale.value.kind]){const invalid=structuredClone(published);mutate(invalid);assert.throws(()=>assertProgram(invalid,row))}
})
