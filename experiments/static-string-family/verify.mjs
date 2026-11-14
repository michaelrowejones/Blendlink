import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile,writeFile,realpath,readdir} from 'node:fs/promises'
import {resolve,join,relative,sep} from 'node:path'
import {loadRuntimeTransaction} from '../../scripts/lib/runtime-transaction-snapshot.mjs'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from '../../scripts/lib/runtime-proof-archive.mjs'
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
import {browserProofContract,definitions,expectedCases,expectedFinalCases,policyRefusals,assertQualification,assertFinal,assertBrowserReport} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.env.SCENETOWEB_STRINGS_EVIDENCE??join(root,'artifacts/verification-static-strings'))
const read=async p=>JSON.parse(await readFile(p)),pin=async(p,h)=>assert.equal(hash(await readFile(p)),h,'Changed proof input: '+p)
const contained=async(base,p)=>{const a=await realpath(base),b=await realpath(p);assert.ok(b.startsWith(a+sep),'Proof path escapes transaction');return b}
const transactionPath=process.env.SCENETOWEB_RUNTIME_TRANSACTION,transactionSha256=process.env.SCENETOWEB_RUNTIME_TRANSACTION_SHA256
const shared=transactionPath||transactionSha256?await loadRuntimeTransaction({root,path:transactionPath,sha256:transactionSha256}):null
// The closing reader always independently emits the whole program once again.
const{provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Static Strings receipt',compilerInputs:!!shared})
if(shared)assert.deepEqual(current.compilerAttestation,shared.provenance.compilerAttestation,'Compiler closure differs from fresh closing emission')
const modules=new Map(current.modules.map(m=>[m.name,m])),receipts=[],expectedFinalSources=[];let caseRuns=0,productionRuns=0
for(const context of ['shader','CPU','GPU']){
 const folder=join(directory,context.toLowerCase()),qp=join(folder,'qualification.json'),fp=join(folder,'final-proof.json'),q=assertQualification(await read(qp)),f=assertFinal(await read(fp),q,hash(await readFile(qp)))
 for(const row of f.rows)expectedFinalSources.push(await realpath(join(folder,row.sourceFile)))
 assert.equal(q.context,context)
 const packaging=JSON.parse(execFileSync('python3',[join(import.meta.dirname,'artifact_closure.py'),root],{encoding:'utf8'}))
 const expectedNativeSources=[...packaging.sourceFiles,'experiments/static-string-family/cases.py','experiments/static-string-family/cases.json','experiments/static-string-family/artifact_closure.py','experiments/static-string-family/reference.py','experiments/static-string-family/numeric-contract.json','packages/blender-addon/tests/static_string_family_policy.py']
 assert.deepEqual(Object.keys(q.sourceHashes).sort(),expectedNativeSources.sort())
 assert.deepEqual(q.nativePackaging,packaging);assert.deepEqual(q.artifactInputs,packaging.artifactInputs)
 for(const[target,expected]of Object.entries(packaging.inventories)){const actual=(await readdir(join(root,'packages/blendlink/dist',target))).filter(name=>/\.(py|json)$/.test(name)).sort();assert.deepEqual(actual,expected)}
 for(const[file,h]of Object.entries(q.sourceHashes))await pin(join(root,file),h)
 for(const x of q.artifactInputs){await pin(join(root,x.source),x.sha256);await pin(join(root,x.artifact),x.sha256)}
 assert.deepEqual(f.provenance,q.artifactInputs)
 for(const row of q.cases){for(const key of ['program','pixel'])await pin(await contained(folder,join(folder,row[key+'File'])),row[key+'Sha256']);if(row.sourceFile)await pin(await contained(folder,join(folder,row.sourceFile)),row.sourceSha256)}
 for(const row of q.cases){
  const bytes=await readFile(join(folder,row.pixelFile));assert.equal(bytes.length,8*8*4*4)
  const expected=[(row.expectedInt%256)/256,Math.floor(row.expectedInt/256)/256,.25,1],words=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4)
  for(let index=0;index<words.length;index++)assert.equal(words[index],expected[index%4],'Independent native scalar carrier differs from declared golden '+row.case)
  assert.equal(words[0]*256+words[1]*65536,row.expectedInt)
  const program=await read(join(folder,row.programFile));const walk=value=>{if(!value||typeof value!=='object')return;if((value.kind==='constant'||value.op==='typed_const')&&value.type==='STRING')throw new Error('GPU string payload was serialized');Object.values(value).forEach(walk)};walk(program)
 }
 for(const row of f.rows){await pin(join(folder,row.sourceFile),row.sourceSha256);for(const key of ['manifest','glb','program'])await pin(await contained(join(folder,'compiled'),row[key+'Path']),row[key+'Sha256'])}
 const browsers=[]
 for(const profile of ['metal','software'])for(const phase of ['raw','final']){
  const d=join(folder,'browser-'+phase+'-'+profile),p=join(d,'report.json'),report=assertBrowserReport(await read(p),q,f,{profile,final:phase==='final'});assert.equal(report.status,browserProofContract.browserStatus)
  const provenance=report.provenance;assert.equal(provenance.nativeQualificationSha256,hash(await readFile(qp)));if(phase==='final')assert.equal(provenance.finalProofSha256,hash(await readFile(fp)))
  await pin(join(import.meta.dirname,'run.mjs'),provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),provenance.protocolSha256)
  assert.deepEqual(Object.keys(provenance.fixturePins).sort(),['browser.js','index.html']);for(const[n,h]of Object.entries(provenance.fixturePins)){await pin(join(import.meta.dirname,n),h);await pin(join(d,'fixture',n),h)}
  const runtimeDirectory=shared?shared.provenance.snapshot.directory:join(d,'runtime')
  if(shared){assert.deepEqual(provenance.transaction,shared.transaction);assert.deepEqual(provenance.compilerAttestation,current.compilerAttestation)}else assert.equal(provenance.transaction,undefined)
  await assertBuiltRuntimeArchive({root,current,provenance,runtimeDirectory,fixtureDirectory:join(d,'fixture'),fixtureSourceDirectory:import.meta.dirname})
  const count=report.rows.reduce((n,row)=>n+row.rows.length,0);caseRuns+=count;productionRuns+=count-2
  browsers.push({profile,phase,reportSha256:hash(await readFile(p)),caseRuns:count,APIs:report.rows.map(x=>({backend:x.backend,gpu:x.gpu}))})
 }
 receipts.push({context,nativeQualificationSha256:hash(await readFile(qp)),finalProofSha256:hash(await readFile(fp)),nativeGraphs:q.cases.length,productionNativeGraphs:q.cases.length-1,logicalStringCases:definitions.filter(row=>row.kind==='text'&&(!row.contexts||row.contexts.includes(context))).length,savedFinalScenes:f.rows.length,nativeBackend:q.nativeBackend,browsers})
}
const nativeArchivePath=join(directory,'native-python-proof.json'),nativePythonProof=await validateNativeArchive(await read(nativeArchivePath),directory,{expectedFinalSources,referenceScript:'experiments/static-string-family/reference.py',policyScript:'packages/blender-addon/tests/static_string_family_policy.py',helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
const policyPath=join(directory,'policy.json'),policy=await read(policyPath);assert.equal(policy.status,'PASSED_STATIC_STRING_POLICY');assert.equal(policy.privateNumericalCredit,0)
for(const context of['shader','compositor']){assert.deepEqual(policy.rows.filter(row=>row.context===context).map(row=>row.kind).sort(),policyRefusals.slice().sort());for(const row of policy.rows.filter(row=>row.context===context))assert.match(row.error,/Static string/)}
const nativeGraphs=['shader','CPU','GPU'].reduce((n,c)=>n+expectedCases(c).length,0),savedFinalScenes=['shader','CPU','GPU'].reduce((n,c)=>n+expectedFinalCases(c).length,0)
assert.equal(caseRuns,4*(nativeGraphs+savedFinalScenes));assert.equal(nativePythonProof.uniqueCachePrefixes,savedFinalScenes+4)
const logicalPerNode={};for(const context of['shader','CPU','GPU']){logicalPerNode[context]={};for(const row of definitions.filter(row=>!row.contexts||row.contexts.includes(context)))logicalPerNode[context][row.nodeType]=(logicalPerNode[context][row.nodeType]??0)+1}
const out={status:'QUALIFIED_STATIC_STRING_SCALAR_SLICE',runtimeTransaction:shared?{sha256:shared.transaction.sha256,id:shared.transaction.id,independentlyReemittedAtClose:true}:null,nativePythonProof:{...nativePythonProof,sha256:hash(await readFile(nativeArchivePath))},scope:'Blender5.3.0 build02f0899d78e3 macOSarm64 bounded static UTF8 codepoint strings feeding scalar controls. Native host string evaluation, no GPU string payload or GPU string-kernel arithmetic credit. Each nonempty expected text is independently witnessed by actual native Length and whole-string Find.Count; empty requires Length0; helper-resolved text equals manually materialized expected literal. Witness renders are not counted as distinct logical string cases.',nativeGraphs,productionNativeGraphs:nativeGraphs-3,savedFinalScenes,browserCaseRuns:caseRuns,productionBrowserCaseRuns:productionRuns,comparedFloat32Words:caseRuns*256,productionComparedWords:productionRuns*256,wordMismatches:0,remainingOwnedTextures:0,logicalPerNode,logicalStringCases:definitions.filter(row=>row.kind==='text').length*3,numericContract:await read(join(import.meta.dirname,'numeric-contract.json')),policy:{sha256:hash(await readFile(policyPath)),nativeRefusalControls:policy.rows.length,privateHostBoundaryControls:policy.privateHostBoundaryControls.length,privateNumericalCredit:0},runtimeFingerprint:hash(JSON.stringify(current.modules.map(m=>({name:m.name,source:m.sourceSha256,built:m.emitterSha256})))),sourceHashes:(await read(join(directory,'shader/qualification.json'))).sourceHashes,fixturePins:Object.fromEntries(await Promise.all(['run.mjs','verify.mjs','protocol.mjs','browser.js','index.html','export.test.ts','matrix.mjs','artifact_closure.py','cases.py','cases.json','numeric-contract.json','../../scripts/lib/native-proof-archive.mjs','../../scripts/lib/node-port-python.mjs','../../scripts/node-port-blender.mjs','../../scripts/lib/runtime-transaction-snapshot.mjs','../../scripts/lib/runtime-proof-archive.mjs','../../scripts/lib/runtime-compiler-trace.mjs'].map(async n=>[n,hash(await readFile(join(import.meta.dirname,n)))]))),receipts}
const output=resolve(process.argv[2]??join(directory,'closed-receipt.json'));await writeFile(output,JSON.stringify(out,null,2)+'\n');console.log('SCENETOWEB_STATIC_STRINGS_CLOSED '+caseRuns+' case runs')
