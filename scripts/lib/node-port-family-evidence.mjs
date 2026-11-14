// Scheduling adapters for families that already own a complete guarded matrix.
// A compact receipt alone never qualifies: read() always invokes its closed reader.
import assert from 'node:assert/strict'
import {readFile,realpath} from 'node:fs/promises'
import {join,relative,sep} from 'node:path'
import {executeNodePortCommand,nodePortHash} from './node-port-contract.mjs'

export const CLOSED_NODE_PORT_FAMILIES=Object.freeze({
 'compositor-white-noise':Object.freeze({adapter:'compositor-white-noise-fixed-v1',node:'ShaderNodeTexWhiteNoise',folder:'experiments/compositor-white-noise',profile:'darwin-arm64-53-white-noise-cpu-v1',productionCases:44,calibrationCases:0,nativeGraphs:44,finals:12,caseRuns:224,words:14336,status:'QUALIFIED_PARTIAL_COMPOSITOR_WHITE_NOISE'}),
 'mono-switch-view':Object.freeze({adapter:'mono-switch-view-v1',node:'CompositorNodeSwitchView',folder:'experiments/static-switch-family',profile:'darwin-arm64-53-mono-view-cpu-v1',productionCases:7,calibrationCases:1,nativeGraphs:8,finals:8,caseRuns:64,words:16384,status:'qualified-mono-switch-view-slice'}),
})
export function closedNodePortFamily(id){const value=Object.hasOwn(CLOSED_NODE_PORT_FAMILIES,id)&&CLOSED_NODE_PORT_FAMILIES[id];assert.ok(value,'Unknown closed node-port family');return value}
const json=async path=>JSON.parse(await readFile(path,'utf8'))
const mono=id=>id==='mono-switch-view'
const pins=Object.freeze(['cpu/qualification.json','cpu/final-proof.json'])
const phases=[['metal','raw'],['metal','final'],['software','raw'],['software','final']]

export function assertClosedFamilyScope(id,{manifest,profile,completedRuns=profile.runs}){
 const f=closedNodePortFamily(id)
 assert.equal(manifest.id,id);assert.equal(manifest.evidence.adapter,f.adapter)
 assert.equal(manifest.nativeNode,f.node,'Closed family cannot qualify another native node');assert.equal(manifest.domain,'compositor')
 assert.equal(manifest.lifecycle,'production');assert.equal(profile.id,'mac-53');assert.deepEqual(profile.hostPlatforms,['darwin'])
 assert.equal(profile.blenderVersion,'5.3.0');assert.equal(profile.blenderBuildHash,'02f0899d78e3');assert.equal(profile.expectedStatus,undefined)
 assert.deepEqual(profile.nativeSource,{profile:f.profile,backend:null,evaluator:'CPU-compositor'})
 assert.deepEqual(manifest.evidence,{adapter:f.adapter,productionCases:f.productionCases,calibrationCases:f.calibrationCases,refusedNativeCases:0})
 assert.deepEqual(profile.runs.map(r=>[r.id,r.adapter,r.args??[]]),[['matrix','matrix',[]]])
 assert.deepEqual(completedRuns,profile.runs,'A closed family matrix runs exactly once')
 return f
}
function actualApis(apis,profile,count){
 assert.deepEqual(apis.map(r=>r.backend).sort(),['webgl2','webgpu'],'Both actual APIs are mandatory')
 for(const api of apis){assert.equal(api.gpu?.api,api.backend==='webgpu'?'WebGPU':'WebGL2');const identity=JSON.stringify(api.gpu)
  if(profile==='metal'){assert.match(identity,/apple|metal/i);assert.doesNotMatch(identity,/swiftshader/i)}else assert.match(identity,/swiftshader/i)
  if(count!==undefined)assert.equal(api.cases,count)
 }
}
export function assertClosedFamilyReceipt(id,value){
 const f=closedNodePortFamily(id)
 assert.equal(value.status,f.status);assert.equal(value.nativeGraphs,f.nativeGraphs);assert.equal(value.savedFinalScenes,f.finals)
 assert.equal(value.browserCaseRuns,f.caseRuns);assert.equal(mono(id)?value.comparedFloat32Words:value.primaryFloat32Words,f.words)
 assert.equal(mono(id)?value.wordMismatches:value.exactWordMismatches,0)
 if(mono(id)){
  assert.equal(value.variant,'mono-view');assert.equal(value.productionNativeGraphs,7);assert.equal(value.productionBrowserCaseRuns,56);assert.equal(value.productionComparedWords,14336);assert.equal(value.remainingOwnedTextures,0)
  assert.equal(value.runtimeTransaction?.independentlyReemittedAtClose,true)
  assert.equal(value.nativePythonProof?.pythonInvocations,10);assert.equal(value.nativePythonProof.finalInvocations,8);assert.equal(value.nativePythonProof.uniqueCachePrefixes,10)
  assert.equal(value.receipts.length,1);const receipt=value.receipts[0];assert.equal(receipt.context,'CPU');assert.equal(receipt.nativeGraphs,8);assert.equal(receipt.productionNativeGraphs,7);assert.equal(receipt.savedFinalScenes,8)
  assert.deepEqual(receipt.nativeBackend,{evaluator:'native-cpu-compositor',requestedCompositorDevice:'CPU',gpuInitialized:false,gpuEvaluationCredit:false})
  assert.deepEqual(receipt.browsers.map(r=>[r.profile,r.phase]),phases)
  for(const run of receipt.browsers){assert.equal(run.caseRuns,16);actualApis(run.APIs,run.profile)}
 }else{
  assert.equal(value.contractViolations,0);assert.equal(value.uniqueActualPythonPrefixes,14)
  assert.equal(value.sources.length,1);const archive=value.sources[0].nativeArchive
  assert.equal(archive?.pythonInvocations,14);assert.equal(archive.finalInvocations,12);assert.equal(archive.uniqueCachePrefixes,14)
  assert.deepEqual(value.runs.map(r=>[r.profile,r.phase]),phases)
  for(const run of value.runs)actualApis(run.actualApis,run.profile,run.phase==='raw'?44:12)
 }
 assert.match(mono(id)?value.runtimeFingerprint:value.closedReader?.runtimeFingerprint,/^[a-f0-9]{64}$/)
 return value
}

export function assertClosedFamilyNativeIdentity(native,archive,nativeIdentity){
 assert.deepEqual(native.version,[5,3,0]);assert.equal(native.build,'02f0899d78e3')
 assert.ok(archive?.identity?.native&&nativeIdentity,'Missing actual owned native identity')
 for(const key of ['path','bytes','sha256']){
  assert.notEqual(nativeIdentity[key],undefined);assert.notEqual(nativeIdentity[key],null)
  assert.equal(archive.identity.native[key],nativeIdentity[key],'Actual native identity differs from the owned family launcher')
 }
 assert.match(nativeIdentity.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(nativeIdentity.bytes)&&nativeIdentity.bytes>0)
}

async function finalSources(id,evidence){
 const q=await json(join(evidence,'cpu/qualification.json')),base=await realpath(evidence)
 return Promise.all(q.cases.filter(r=>r.sourceFile).map(async row=>{const path=await realpath(join(evidence,'cpu',row.sourceFile));assert.ok(path.startsWith(base+sep),'Final source escaped the owned transaction');return path}))
}
export function closedFamilyReaderCommand(id,{root,evidence,output,transaction}){
 const f=closedNodePortFamily(id)
 const env={SCENETOWEB_RUNTIME_TRANSACTION:null,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:null}
 if(mono(id)){
  assert.equal(transaction?.independentlyReemittedAtClose,true,'Mono family requires its explicit transaction pin')
  assert.match(transaction.sha256,/^[a-f0-9]{64}$/);assert.match(transaction.id,/^[a-f0-9-]{36}$/)
  Object.assign(env,{SCENETOWEB_SWITCH_VARIANT:'mono-view',SCENETOWEB_SWITCH_EVIDENCE:evidence,
   SCENETOWEB_RUNTIME_TRANSACTION:join(evidence,'runtime-transaction/transaction.json'),SCENETOWEB_RUNTIME_TRANSACTION_SHA256:transaction.sha256})
 }
 return {argv:[process.execPath,join(root,f.folder,'verify.mjs'),...(mono(id)?[output]:[evidence,output])],
  env,timeoutMs:300_000}
}
export function closedFamilyAdapter(id){
 const f=closedNodePortFamily(id)
 return Object.freeze({nativeOwnership:'family',validate:args=>assertClosedFamilyScope(id,args),nativeFinalPaths:mono(id)?[...pins,'native-python-proof.json','runtime-transaction/transaction.json']:pins,finalSources:evidence=>finalSources(id,evidence),
  async read({root,evidence,manifest,profile,completedRuns,nativeIdentity}){
   assertClosedFamilyScope(id,{manifest,profile,completedRuns})
   const suite=await json(join(evidence,'suite-matrix.json'));assert.equal(suite.status,'passed');assert.equal(suite.family,id);assert.equal(suite.built,true);assert.equal(suite.reuseNative,false)
   const firstPath=join(evidence,mono(id)?'closed-receipt.json':'qualified.json'),firstBytes=await readFile(firstPath)
   assert.equal(suite.receiptSha256,nodePortHash(firstBytes),'Family receipt changed after the complete matrix')
   const first=assertClosedFamilyReceipt(id,JSON.parse(firstBytes))
   for(const key of ['nativeGraphs','savedFinalScenes','browserCaseRuns'])assert.equal(suite[key],first[key])
   const output=join(evidence,'adapter-closed.json'),command=closedFamilyReaderCommand(id,{root,evidence,output,transaction:first.runtimeTransaction})
   // Re-running the authoritative reader revalidates every source/native/runtime/
   // vendor/fixture pin and independently emits the current whole program.
   const result=await executeNodePortCommand({...command,cwd:root,logPath:join(evidence,'adapter-closed.log')})
   assert.equal(result.exitCode,0,'Independent family reader failed; inspect adapter-closed.log');assert.equal(result.timedOut,false);assert.equal(result.error,undefined)
   const proof=assertClosedFamilyReceipt(id,await json(output))
   const native=await json(join(evidence,'cpu/qualification.json'))
   const archive=mono(id)?await json(join(evidence,'native-python-proof.json')):(await json(join(evidence,'cpu/final-proof.json'))).nativeArchive
   assertClosedFamilyNativeIdentity(native,archive,nativeIdentity)
   const sources=await finalSources(id,evidence);assert.equal(sources.length,f.finals);assert.equal(new Set(sources).size,f.finals)
   return {status:'qualified',productionCases:f.productionCases,calibrationCases:f.calibrationCases,nativeGraphs:f.nativeGraphs,savedFinalScenes:f.finals,
    caseRuns:f.caseRuns,primaryFloat32Words:f.words,productionCaseRuns:mono(id)?56:f.caseRuns,productionFloat32Words:mono(id)?14336:f.words,wordMismatches:0,finalSources:sources,
    nativePythonOwnership:'family',nativePythonProof:mono(id)?proof.nativePythonProof:proof.sources[0].nativeArchive,
    files:[{path:relative(evidence,output),sha256:nodePortHash(await readFile(output))}],
    actualIdentity:{nativeVersion:native.version,nativeBuild:native.build,nativeSource:profile.nativeSource,browsers:mono(id)?proof.receipts[0].browsers:proof.runs}}
  }})
}
