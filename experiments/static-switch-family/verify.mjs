import assert from 'node:assert/strict'
import {readFile,writeFile,realpath,readdir} from 'node:fs/promises'
import {resolve,join,relative,sep} from 'node:path'
import {loadRuntimeTransaction} from '../../scripts/lib/runtime-transaction-snapshot.mjs'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
import {assertQualification,assertFinal,assertBrowserReport,variant,contexts,expectedSavedFinalCount,assertMonoProgram} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.env.SCENETOWEB_SWITCH_EVIDENCE??join(root,'artifacts/verification-switch-family'))
const read=async p=>JSON.parse(await readFile(p)),pin=async(p,h)=>assert.equal(hash(await readFile(p)),h,'Changed proof input: '+p)
const contained=async(base,p)=>{const a=await realpath(base),b=await realpath(p);assert.ok(b.startsWith(a+sep),'Proof path escapes transaction');return b}
const transactionPath=process.env.SCENETOWEB_RUNTIME_TRANSACTION,transactionSha256=process.env.SCENETOWEB_RUNTIME_TRANSACTION_SHA256
const shared=transactionPath||transactionSha256?await loadRuntimeTransaction({root,path:transactionPath,sha256:transactionSha256}):null
// The closing reader always independently emits the whole program once again.
const{provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Static Selection receipt',compilerInputs:!!shared})
if(shared)assert.deepEqual(current.compilerAttestation,shared.provenance.compilerAttestation,'Compiler closure differs from fresh closing emission')
const modules=new Map(current.modules.map(m=>[m.name,m])),receipts=[],expectedFinalSources=[];let caseRuns=0,productionRuns=0
for(const context of contexts){
 const folder=join(directory,context.toLowerCase()),qp=join(folder,'qualification.json'),fp=join(folder,'final-proof.json'),q=assertQualification(await read(qp)),f=assertFinal(await read(fp),q,hash(await readFile(qp)))
 for(const row of f.rows)expectedFinalSources.push(await realpath(join(folder,row.sourceFile)))
 assert.equal(q.context,context)
 const expectedNativeSources=[]
 for(const directory of ['packages/blender-addon','packages/blendlink/blender'])for(const name of await readdir(join(root,directory)))if(name.endsWith('.py'))expectedNativeSources.push(directory+'/'+name)
 expectedNativeSources.push('experiments/static-switch-family/cases.py','experiments/static-switch-family/reference.py','experiments/static-switch-family/view_cases.py','experiments/static-switch-family/view-cases.json')
 assert.deepEqual(Object.keys(q.sourceHashes).sort(),expectedNativeSources.sort())
 assert.deepEqual(q.artifactInputs.map(x=>x.source).sort(),expectedNativeSources.filter(x=>!x.startsWith('experiments/')).sort())
 for(const[file,h]of Object.entries(q.sourceHashes))await pin(join(root,file),h)
 for(const x of q.artifactInputs){await pin(join(root,x.source),x.sha256);await pin(join(root,x.artifact),x.sha256)}
 assert.deepEqual(f.provenance,q.artifactInputs)
 for(const row of q.cases){assertMonoProgram(await read(join(folder,row.programFile)),row);for(const key of ['program','pixel'])await pin(await contained(folder,join(folder,row[key+'File'])),row[key+'Sha256']);if(row.sourceFile)await pin(await contained(folder,join(folder,row.sourceFile)),row.sourceSha256)}
 for(const row of f.rows){await pin(join(folder,row.sourceFile),row.sourceSha256);for(const key of ['manifest','glb','program'])await pin(await contained(join(folder,'compiled'),row[key+'Path']),row[key+'Sha256'])}
 if(variant==='mono-view')for(const row of f.rows){const entry=q.cases.find(x=>x.case===row.case),native=await read(join(folder,entry.programFile)),published=(await read(row.programPath)).compositor;assertMonoProgram(published,entry);for(const key of ['status','ops','passes','output','compileTimeViews','images'])assert.deepEqual(published[key],native[key])}
 const browsers=[]
 for(const profile of ['metal','software'])for(const phase of ['raw','final']){
  const d=join(folder,'browser-'+phase+'-'+profile),p=join(d,'report.json'),report=assertBrowserReport(await read(p),q,f,{profile,final:phase==='final'})
  const provenance=report.provenance;assert.equal(provenance.nativeQualificationSha256,hash(await readFile(qp)));if(phase==='final')assert.equal(provenance.finalProofSha256,hash(await readFile(fp)))
  await pin(join(import.meta.dirname,'run.mjs'),provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),provenance.protocolSha256)
  assert.deepEqual(Object.keys(provenance.fixturePins).sort(),['browser.js','index.html']);for(const[n,h]of Object.entries(provenance.fixturePins)){await pin(join(import.meta.dirname,n),h);await pin(join(d,'fixture',n),h)}
  assert.equal(provenance.typescript,current.typescript);assert.equal(provenance.copyAssetsSha256,current.copyAssetsSha256);assert.equal(await realpath(provenance.snapshot.directory),await realpath(shared?shared.provenance.snapshot.directory:join(d,'runtime')));if(shared){assert.deepEqual(provenance.transaction,shared.transaction);assert.deepEqual(provenance.compilerAttestation,current.compilerAttestation)}else assert.equal(provenance.transaction,undefined)
  const runtimeDirectory=shared?shared.provenance.snapshot.directory:join(d,'runtime'),runtimeOwner=shared?shared.record.directory:d
  assert.deepEqual(provenance.modules.map(x=>x.name).sort(),[...modules.keys()].sort());assert.deepEqual(provenance.snapshot.files.map(x=>x.name).sort(),[...modules.keys()].map(n=>n+'.js').sort())
  for(const m of provenance.modules){const now=modules.get(m.name);for(const k of ['sourceSha256','expectedEmitterSha256','emitterSha256'])assert.equal(m[k],now[k]);assert.equal(m.emitterMatchesSource,true);const snapshot=provenance.snapshot.files.find(x=>x.name===m.name+'.js');assert.equal(snapshot.sha256,m.testedSnapshotSha256);await pin(await contained(runtimeOwner,join(runtimeDirectory,m.name+'.js')),snapshot.sha256)}
  const vendor=[];async function walk(path){for(const x of await readdir(path,{withFileTypes:true})){assert.equal(x.isSymbolicLink(),false);const p=join(path,x.name);if(x.isDirectory())await walk(p);else vendor.push({name:relative(runtimeDirectory,p),sha256:hash(await readFile(p))})}}await walk(join(runtimeDirectory,'vendor'))
  assert.deepEqual(vendor.sort((a,b)=>a.name.localeCompare(b.name)),[...provenance.snapshot.vendorFiles].sort((a,b)=>a.name.localeCompare(b.name)));for(const v of vendor)await pin(join(root,'packages/blendlink/dist',v.name),v.sha256)
  const count=report.rows.reduce((n,row)=>n+row.rows.length,0);caseRuns+=count;productionRuns+=count-2
  browsers.push({profile,phase,reportSha256:hash(await readFile(p)),caseRuns:count,APIs:report.rows.map(x=>({backend:x.backend,gpu:x.gpu}))})
 }
 receipts.push({context,nativeQualificationSha256:hash(await readFile(qp)),finalProofSha256:hash(await readFile(fp)),nativeGraphs:q.cases.length,productionNativeGraphs:q.cases.length-1,savedFinalScenes:f.rows.length,nativeBackend:q.nativeBackend,browsers})
}
if(variant==='mono-view'){assert.equal(caseRuns,64);assert.equal(productionRuns,56);assert.equal(expectedFinalSources.length,8)}
const nativeArchivePath=join(directory,'native-python-proof.json'),nativePythonProof=await validateNativeArchive(await read(nativeArchivePath),directory,{expectedFinalSources,...(variant==='mono-view'?{expectedScripts:[{path:join(root,'experiments/static-switch-family/reference.py'),invocations:1},{path:join(root,'packages/blender-addon/tests/compositor_switch_view_check.py'),invocations:1}]}:{referenceScript:'experiments/static-switch-family/reference.py',policyScript:'packages/blender-addon/tests/static_selection_check.py'}),helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
const out={runtimeTransaction:shared?{sha256:shared.transaction.sha256,id:shared.transaction.id,independentlyReemittedAtClose:true}:null,nativePythonProof:{...nativePythonProof,sha256:hash(await readFile(nativeArchivePath))},status:variant==='mono-view'?'qualified-mono-switch-view-slice':'qualified-static-selection-slice',variant,scope:'Blender 5.3.0 build 02f0899d78e3; macOS arm64; '+(variant==='mono-view'?'static current mono CPU actual input0 SwitchView; selected existing RGBA value/domain only':'fixed typed Boolean/Integer/Menu selectors, five data types; selected existing expression only'),baseline:'29e9e03f6d193ecdd25800e7bb2f2cf5239e8c83',nativeGraphs:receipts.reduce((n,r)=>n+r.nativeGraphs,0),productionNativeGraphs:receipts.reduce((n,r)=>n+r.productionNativeGraphs,0),savedFinalScenes:contexts.length*expectedSavedFinalCount,browserCaseRuns:caseRuns,productionBrowserCaseRuns:productionRuns,comparedFloat32Words:caseRuns*256,productionComparedWords:productionRuns*256,wordMismatches:0,remainingOwnedTextures:0,qualificationCredit:{privateControls:0,nativeClassCreation:0,notApplicable:0,unqualifiedDynamicSelectors:0},runtimeFingerprint:hash(JSON.stringify(current.modules.map(m=>({name:m.name,source:m.sourceSha256,built:m.emitterSha256})))),sourceHashes:(await read(join(directory,contexts[0].toLowerCase(),'qualification.json'))).sourceHashes,fixturePins:Object.fromEntries(await Promise.all(['run.mjs','verify.mjs','protocol.mjs','browser.js','index.html','export.test.ts','suite.mjs','view_cases.py','view-cases.json','../../scripts/lib/native-proof-archive.mjs','../../scripts/lib/node-port-python.mjs','../../scripts/node-port-blender.mjs','../../scripts/lib/runtime-transaction-snapshot.mjs','../../scripts/lib/runtime-compiler-trace.mjs'].map(async n=>[n,hash(await readFile(join(import.meta.dirname,n)))]))),receipts}
const output=resolve(process.argv[2]??join(directory,'closed-receipt.json'));await writeFile(output,JSON.stringify(out,null,2)+'\n');console.log('SCENETOWEB_STATIC_SELECTION_CLOSED '+caseRuns+' case runs')
