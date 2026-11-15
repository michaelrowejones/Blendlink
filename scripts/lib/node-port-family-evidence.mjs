// Scheduling adapters for families that already own a complete guarded matrix.
// A compact receipt alone never qualifies: read() always invokes its closed reader.
import assert from 'node:assert/strict'
import {readFile,realpath} from 'node:fs/promises'
import{inflateSync}from'node:zlib'
import {join,relative,sep} from 'node:path'
import {executeNodePortCommand,nodePortHash} from './node-port-contract.mjs'

export const CLOSED_NODE_PORT_FAMILIES=Object.freeze({
 'compositor-input-rotation':Object.freeze({adapter:'compositor-input-rotation-v1',node:'FunctionNodeInputRotation',folder:'experiments/compositor-static-euler',profile:'darwin-arm64-53-input-rotation-cpu-v1',productionCases:48,calibrationCases:0,nativeGraphs:48,nativeOracleControls:104,nativeRenders:152,prefixes:10,finals:8,caseRuns:224,words:14336,lifecycleCycles:96,resizeFrames:48,sourcePolicy:true,status:'QUALIFIED_PARTIAL_COMPOSITOR_INPUT_ROTATION'}),
 'compositor-vector-rotate-unit-axis':Object.freeze({adapter:'compositor-vector-rotate-unit-axis-v1',node:'ShaderNodeVectorRotate',folder:'experiments/compositor-vector-rotate',profile:'darwin-arm64-53-unit-axis-vector-rotate-cpu-v1',variant:'unit-axis',productionCases:35,calibrationCases:0,nativeGraphs:35,nativeOracleControls:5,nativeRenders:110,prefixes:13,finals:10,caseRuns:180,words:1134688,lifecycleCycles:120,resizeFrames:16,sourcePolicy:true,derivedExactContract:true,status:'QUALIFIED_PARTIAL_COMPOSITOR_VECTOR_ROTATE_UNIT_AXIS'}),
 'compositor-vector-rotate':Object.freeze({adapter:'compositor-vector-rotate-v1',node:'ShaderNodeVectorRotate',folder:'experiments/compositor-vector-rotate',profile:'darwin-arm64-53-fixed-axis-vector-rotate-cpu-v1',productionCases:25,calibrationCases:0,nativeGraphs:25,nativeOracleControls:5,nativeRenders:80,prefixes:13,finals:10,caseRuns:140,words:2166416,lifecycleCycles:120,resizeFrames:16,sourcePolicy:true,derivedExactContract:true,status:'QUALIFIED_PARTIAL_COMPOSITOR_VECTOR_ROTATE'}),
 'compositor-blank-image':Object.freeze({adapter:'compositor-blank-image-v1',node:'CompositorNodeBlankImage',folder:'experiments/compositor-blank-image',profile:'darwin-arm64-53-blank-image-cpu-v1',productionCases:26,calibrationCases:0,nativeGraphs:26,nativeRenders:26,prefixes:10,finals:8,caseRuns:136,words:1153408,lifecycleCycles:96,resizeFrames:272,sourcePolicy:true,derivedExactContract:true,status:'QUALIFIED_PARTIAL_COMPOSITOR_BLANK_IMAGE'}),
 'compositor-noise-default-field':Object.freeze({adapter:'compositor-noise-default-field-v1',node:'ShaderNodeTexNoise',folder:'experiments/compositor-noise-default-field',profile:'darwin-arm64-53-noise2d-default-fbm-cpu-v1',productionCases:26,calibrationCases:0,nativeGraphs:26,nativeOracleControls:15,nativeRenders:41,prefixes:10,finals:8,caseRuns:136,words:12919456,lifecycleCycles:96,resizeFrames:352,sourcePolicy:true,approximateRgb:true,status:'QUALIFIED_PARTIAL_COMPOSITOR_NOISE_DEFAULT_FIELD'}),
 'compositor-wave-axis':Object.freeze({adapter:'compositor-wave-axis-v1',node:'ShaderNodeTexWave',folder:'experiments/compositor-wave-axis',profile:'darwin-arm64-53-wave-saw-tri-cpu-v1',productionCases:140,calibrationCases:0,nativeGraphs:140,nativeOracleControls:9,nativeRenders:149,prefixes:22,finals:20,caseRuns:640,words:10876288,lifecycleCycles:240,resizeFrames:384,exactEndpoints:true,sourcePolicy:true,status:'QUALIFIED_PARTIAL_COMPOSITOR_WAVE_AXIS'}),
 'compositor-white-noise':Object.freeze({adapter:'compositor-white-noise-fixed-v1',node:'ShaderNodeTexWhiteNoise',folder:'experiments/compositor-white-noise',profile:'darwin-arm64-53-white-noise-cpu-v1',productionCases:44,calibrationCases:0,nativeGraphs:44,prefixes:14,finals:12,caseRuns:224,words:14336,status:'QUALIFIED_PARTIAL_COMPOSITOR_WHITE_NOISE'}),
 'compositor-white-noise-default-field':Object.freeze({adapter:'compositor-white-noise-default-field-v1',node:'ShaderNodeTexWhiteNoise',folder:'experiments/compositor-white-noise-default-field',profile:'darwin-arm64-53-white-noise-uniform-cpu-v1',productionCases:54,calibrationCases:0,nativeGraphs:54,nativeOracleControls:9,nativeRenders:63,sourcePolicy:true,prefixes:10,finals:8,caseRuns:248,words:7943520,status:'QUALIFIED_PARTIAL_COMPOSITOR_WHITE_NOISE_DEFAULT_FIELD'}),
 'compositor-finite-image-info':Object.freeze({adapter:'compositor-finite-image-info-v1',node:'CompositorNodeImageInfo',folder:'experiments/static-switch-family',profile:'darwin-arm64-53-finite-image-info-v1',variant:'finite-image-info',productionCases:20,calibrationCases:1,nativeGraphs:21,productionFinals:7,finals:8,caseRuns:116,productionCaseRuns:108,words:29696,productionWords:27648,allReadWords:67584,allReadCaptures:264,status:'qualified-finite-image-info-slice'}),
 'compositor-integer-vector3':Object.freeze({adapter:'compositor-integer-vector3-v1',node:'FunctionNodeInputIntVector',folder:'experiments/static-switch-family',profile:'darwin-arm64-53-int3-cpu-v1',variant:'integer-vector3',productionCases:15,calibrationCases:1,nativeGraphs:16,productionFinals:7,finals:8,caseRuns:96,productionCaseRuns:88,words:24576,productionWords:22528,allReadWords:57344,status:'qualified-integer-vector3-slice'}),
 'mono-switch-view':Object.freeze({adapter:'mono-switch-view-v1',node:'CompositorNodeSwitchView',folder:'experiments/static-switch-family',profile:'darwin-arm64-53-mono-view-cpu-v1',variant:'mono-view',productionCases:7,calibrationCases:1,nativeGraphs:8,finals:8,caseRuns:64,words:16384,status:'qualified-mono-switch-view-slice'}),
})
export function closedNodePortFamily(id){const value=Object.hasOwn(CLOSED_NODE_PORT_FAMILIES,id)&&CLOSED_NODE_PORT_FAMILIES[id];assert.ok(value,'Unknown closed node-port family');return value}
const json=async path=>JSON.parse(await readFile(path,'utf8'))
const mono=id=>id==='mono-switch-view'
const selection=id=>closedNodePortFamily(id).folder==='experiments/static-switch-family'
const selectionVariant=id=>closedNodePortFamily(id).variant
const exactSelection=id=>id==='compositor-integer-vector3'||id==='compositor-finite-image-info'
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
 assert.equal(value.browserCaseRuns,f.caseRuns);assert.equal(selection(id)?value.comparedFloat32Words:value.primaryFloat32Words,f.words)
 if(f.approximateRgb){
  assert.equal(value.exactWordMismatches,undefined,'Bounded approximation must not claim word-exact output')
  assert.deepEqual(value.precision,{absoluteMax:2**-20,ulpsMax:8})
  assert.ok(Number.isSafeInteger(value.wordDifferences)&&value.wordDifferences>=0&&value.wordDifferences<=f.words)
  assert.ok(Number.isSafeInteger(value.maxUlps)&&value.maxUlps>=0&&value.maxUlps<=8)
  assert.ok(Number.isFinite(value.maxAbsoluteError)&&value.maxAbsoluteError>=0&&value.maxAbsoluteError<=2**-20)
 }else assert.equal(selection(id)?value.wordMismatches:value.exactWordMismatches,0)
 if(selection(id)){
  assert.equal(value.variant,selectionVariant(id));assert.equal(value.productionNativeGraphs,f.productionCases);assert.equal(value.productionBrowserCaseRuns,f.productionCaseRuns??56);assert.equal(value.productionComparedWords,f.productionWords??14336);assert.equal(value.remainingOwnedTextures,0)
  assert.equal(value.runtimeTransaction?.independentlyReemittedAtClose,true)
  assert.equal(value.nativePythonProof?.pythonInvocations,10);assert.equal(value.nativePythonProof.finalInvocations,8);assert.equal(value.nativePythonProof.uniqueCachePrefixes,10)
  if(exactSelection(id)){assert.equal(value.archivedGpuPrimaryWords,f.words);assert.equal(value.archivedGpuReadbackWords,f.allReadWords);assert.equal(value.independentlyRecomputedGpuWordDifferences,0)}
  assert.equal(value.receipts.length,1);const receipt=value.receipts[0];assert.equal(receipt.context,'CPU');assert.equal(receipt.nativeGraphs,f.nativeGraphs);assert.equal(receipt.productionNativeGraphs,f.productionCases);assert.equal(receipt.savedFinalScenes,f.finals)
  assert.deepEqual(receipt.nativeBackend,{evaluator:'native-cpu-compositor',requestedCompositorDevice:'CPU',gpuInitialized:false,gpuEvaluationCredit:false})
  assert.deepEqual(receipt.browsers.map(r=>[r.profile,r.phase]),phases)
  for(const run of receipt.browsers){assert.equal(run.caseRuns,2*(run.phase==='raw'?f.nativeGraphs:f.finals));actualApis(run.APIs,run.profile)}
 }else{
  // Blank's reader derives byte equality from every archived linear readback;
  // it does not emit the approximate field families' violation counter.
  assert.equal(value.contractViolations,f.derivedExactContract?undefined:0);assert.equal(value.uniqueActualPythonPrefixes,f.prefixes)
  assert.equal(value.sources.length,1);const archive=value.sources[0].nativeArchive
  assert.equal(archive?.pythonInvocations,f.prefixes);assert.equal(archive.finalInvocations,f.finals);assert.equal(archive.uniqueCachePrefixes,f.prefixes)
  if(f.nativeOracleControls!==undefined)assert.equal(value.nativeOracleControls,f.nativeOracleControls)
  if(f.nativeRenders!==undefined)assert.equal(value.nativeRenders,f.nativeRenders)
  if(f.lifecycleCycles!==undefined||f.nativeOracleControls!==undefined)assert.equal(value.lifecycleCycles,f.lifecycleCycles??96)
  if(f.resizeFrames!==undefined)assert.equal(value.resizeFrames,f.resizeFrames)
  if(f.exactEndpoints)for(const key of['nativeZeroRgbWords','nativeOneRgbWords'])assert.ok(Number.isSafeInteger(value[key])&&value[key]>0,'Actual native endpoint witnesses are required')
  assert.deepEqual(value.runs.map(r=>[r.profile,r.phase]),phases)
  for(const run of value.runs)actualApis(run.actualApis,run.profile,run.phase==='raw'?f.productionCases:f.finals)
 }
 if(id==='compositor-vector-rotate-unit-axis')assert.equal(value.variant,'unit-axis')
 if(id==='compositor-input-rotation'){assert.equal(value.variant,'input-rotation');assert.equal(value.sourceInputAdmissionControls,34);assert.equal(value.sourceRegressionControls,2);assert.equal(value.sourceOutputGuardRefusals,8);assert.equal(value.policy.refusals.length,44);assert.equal(value.archivedGpuPrimaryWords,14336);assert.equal(value.archivedGpuWords,37824);assert.equal(value.archivedGpuFrames,560);assert.equal(value.independentlyRecomputedGpuWordDifferences,0)}
 assert.match(selection(id)?value.runtimeFingerprint:value.closedReader?.runtimeFingerprint,/^[a-f0-9]{64}$/)
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
 const env={SCENETOWEB_RUNTIME_TRANSACTION:null,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:null,SCENETOWEB_STATIC_EULER_VARIANT:id==='compositor-input-rotation'?'input-rotation':null,SCENETOWEB_VECTOR_ROTATE_VARIANT:id==='compositor-vector-rotate-unit-axis'?'unit-axis':null}
 if(selection(id)){
  assert.equal(transaction?.independentlyReemittedAtClose,true,'Selection family requires its explicit transaction pin')
  assert.match(transaction.sha256,/^[a-f0-9]{64}$/);assert.match(transaction.id,/^[a-f0-9-]{36}$/)
  Object.assign(env,{SCENETOWEB_SWITCH_VARIANT:selectionVariant(id),SCENETOWEB_SWITCH_EVIDENCE:evidence,
   SCENETOWEB_RUNTIME_TRANSACTION:join(evidence,'runtime-transaction/transaction.json'),SCENETOWEB_RUNTIME_TRANSACTION_SHA256:transaction.sha256})
 }
 return {argv:[process.execPath,join(root,f.folder,'verify.mjs'),...(selection(id)?[output]:[evidence,output])],
  env,timeoutMs:300_000}
}
export function closedFamilyAdapter(id){
 const f=closedNodePortFamily(id)
 return Object.freeze({nativeOwnership:'family',validate:args=>assertClosedFamilyScope(id,args),nativeFinalPaths:selection(id)?[...pins,'native-python-proof.json','runtime-transaction/transaction.json',...(exactSelection(id)?['source-policy.json']:[]),...(id==='compositor-finite-image-info'?['source-policy/report.json',...phases.map(([profile,phase])=>'cpu/browser-'+phase+'-'+profile+'/report.json')]:[])]:f.sourcePolicy?[...pins,'cpu/policy.json']:pins,finalSources:evidence=>finalSources(id,evidence),
  async read({root,evidence,manifest,profile,completedRuns,nativeIdentity}){
   assertClosedFamilyScope(id,{manifest,profile,completedRuns})
   const suite=await json(join(evidence,'suite-matrix.json'));assert.equal(suite.status,'passed');assert.equal(suite.family,id);assert.equal(suite.built,true);assert.equal(suite.reuseNative,false)
   const firstPath=join(evidence,selection(id)?'closed-receipt.json':'qualified.json'),firstBytes=await readFile(firstPath)
   assert.equal(suite.receiptSha256,nodePortHash(firstBytes),'Family receipt changed after the complete matrix')
   const first=assertClosedFamilyReceipt(id,JSON.parse(firstBytes))
   for(const key of ['nativeGraphs','savedFinalScenes','browserCaseRuns'])assert.equal(suite[key],first[key])
   const output=join(evidence,'adapter-closed.json'),command=closedFamilyReaderCommand(id,{root,evidence,output,transaction:first.runtimeTransaction})
   // Re-running the authoritative reader revalidates every source/native/runtime/
   // vendor/fixture pin and independently emits the current whole program.
   const result=await executeNodePortCommand({...command,cwd:root,logPath:join(evidence,'adapter-closed.log')})
   assert.equal(result.exitCode,0,'Independent family reader failed; inspect adapter-closed.log');assert.equal(result.timedOut,false);assert.equal(result.error,undefined)
   const proof=assertClosedFamilyReceipt(id,await json(output))
   if(id==='compositor-finite-image-info')assert.deepEqual(proof,first,'The two authoritative finite metadata closes must agree')
   const native=await json(join(evidence,'cpu/qualification.json'))
   const archive=selection(id)?await json(join(evidence,'native-python-proof.json')):(await json(join(evidence,'cpu/final-proof.json'))).nativeArchive
   assertClosedFamilyNativeIdentity(native,archive,nativeIdentity)
   const finitePayloadCosts=id==='compositor-finite-image-info'?await readFinitePayloadCosts({evidence,proof,native}):undefined
   const sources=await finalSources(id,evidence);assert.equal(sources.length,f.finals);assert.equal(new Set(sources).size,f.finals)
   return {status:'qualified',productionCases:f.productionCases,calibrationCases:f.calibrationCases,nativeGraphs:f.nativeGraphs,savedFinalScenes:f.finals,
    ...(f.nativeOracleControls===undefined?{}:{nativeOracleControls:f.nativeOracleControls}),...(f.nativeRenders===undefined?{}:{nativeRenders:f.nativeRenders}),
    caseRuns:f.caseRuns,primaryFloat32Words:f.words,productionCaseRuns:selection(id)?f.productionCaseRuns??56:f.caseRuns,productionFloat32Words:selection(id)?f.productionWords??14336:f.words,...(exactSelection(id)?{productionNativeGraphs:f.productionCases,productionSavedFinalScenes:f.productionFinals,calibrationCaseRuns:f.caseRuns-f.productionCaseRuns,calibrationComparedWords:f.words-f.productionWords,archivedGpuReadbackWords:proof.archivedGpuReadbackWords,independentlyRecomputedGpuWordDifferences:0}:{}),...(f.approximateRgb?{wordDifferences:proof.wordDifferences,contractViolations:0,precision:proof.precision,maxUlps:proof.maxUlps,maxAbsoluteError:proof.maxAbsoluteError}:{wordMismatches:0}),finalSources:sources,
    ...(finitePayloadCosts?{finitePayloadCosts,archivedGpuReadbackCaptures:f.allReadCaptures}:{}),
    nativePythonOwnership:'family',nativePythonProof:selection(id)?proof.nativePythonProof:proof.sources[0].nativeArchive,
    files:[{path:relative(evidence,output),sha256:nodePortHash(await readFile(output))}],
    actualIdentity:{nativeVersion:native.version,nativeBuild:native.build,nativeSource:profile.nativeSource,browsers:selection(id)?proof.receipts[0].browsers:proof.runs}}
  }})
}


// Only the new finite-metadata adapter reads these observed cost facts. The
// authoritative family close already validated every raw GPU word; this bridge
// independently binds the observed CPU objects to the actual pinned payloads.
export function assertFinitePayloadCostReports(runs,cases,payloads){
 assert.equal(cases.length,21);assert.equal(cases.filter(row=>row.sourceFile).length,8)
 assert.deepEqual(runs.map(row=>[row.profile,row.phase]),phases)
 let captures=0,words=0,cpuObjects=0,cpuBytes=0;const observed=[]
 const zeroKeys=['gpuCreations','gpuUploads','physicalGpuHandles','sampledTextureBindings','samplerBindings']
 for(const{profile,phase,report}of runs){
  assert.equal(report.status,'PASSED_STATIC_SELECTION_BUILT_PROOF');assert.equal(report.built,true);assert.equal(report.profile,profile);assert.equal(report.final,phase==='final');assert.equal(report.sourceContext,'CPU')
  const expected=phase==='final'?cases.filter(row=>row.sourceFile):cases;actualApis(report.rows,profile)
  for(const api of report.rows){
   assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.rows.map(row=>row.case),expected.map(row=>row.case))
   for(const key of['creations','uploads','physicalHandles','sampledTextureBindings','samplerBindings'])assert.ok(Number.isSafeInteger(api.payloadCostCanary?.[key])&&api.payloadCostCanary[key]>0,'Actual backend upload/binding canary is required')
   assert.equal(api.finiteFrameGuard?.case,'blank-group');assert.equal(api.finiteFrameGuard.refused,true);assert.equal(api.finiteFrameGuard.recovered,true);assert.match(api.finiteFrameGuard.error,/Blank Image.*full-frame/)
   let objects=0,bytes=0
   for(const row of api.rows){
    const entry=expected.find(entry=>entry.case===row.case),cost=row.payloadCost,payload=payloads.get(entry.case),count=payload?(phase==='final'?2:1):0
    assert.equal(row.wordMismatches,0);assert.equal(row.remainingTextures,0);assert.equal(row.finalBindings,phase==='final');assert.equal(row.ownershipPreserved,true)
    assert.equal(cost?.scope,'matched-actual-source-payload-objects-and-backend-bindings');assert.equal(cost.cpuObjects,count);assert.equal(cost.distinctCpuBuffers,count);assert.equal(cost.observedCpuBytes,count*(payload?.bytes??0))
    for(const key of zeroKeys)assert.equal(cost[key],0,'Unused image metadata payload performed GPU work')
    assert.equal(cost.rows.length,count);assert.equal(new Set(cost.rows.map(value=>value.uuid)).size,count)
    for(const object of cost.rows){assert.ok(typeof object.uuid==='string'&&object.uuid.length>0);assert.deepEqual([object.width,object.height],entry.size);assert.equal(object.observedCpuBytes,payload.bytes);assert.equal(object.rawSha256,payload.sha256,'Observed CPU texture does not match its native payload');for(const key of['creations','uploads','physicalHandles','sampledTextureBindings','samplerBindings'])assert.equal(object[key],0)}
    assert.deepEqual(row.readbacks.map(value=>value.phase),phase==='final'?['primary','repeat','reinstalled']:['primary','repeat'])
    for(const readback of row.readbacks){assert.equal(readback.comparedWords,256);assert.equal(typeof readback.rowFlip,'boolean');assert.equal(readback.wordFile,'readbacks/'+api.backend+'-'+row.case+'-'+readback.phase+'.u32');assert.match(readback.wordSha256,/^[a-f0-9]{64}$/);captures++;words+=256}
    objects+=cost.cpuObjects;bytes+=cost.observedCpuBytes
   }
   cpuObjects+=objects;cpuBytes+=bytes;observed.push({profile,phase,backend:api.backend,cpuObjects:objects,observedCpuBytes:bytes,gpuCreations:0,gpuUploads:0,physicalGpuHandles:0,sampledTextureBindings:0,samplerBindings:0,canary:api.payloadCostCanary,frameGuard:api.finiteFrameGuard})
  }
 }
 assert.equal(captures,264);assert.equal(words,67584)
 return{scope:'source-payload CPU objects/bytes and observed backend work only; not total install/frame cost or image-pixel credit',observedRuns:observed,cpuObjects,observedCpuBytes:cpuBytes,gpuCreations:0,gpuUploads:0,physicalGpuHandles:0,sampledTextureBindings:0,samplerBindings:0,archivedCaptures:captures,archivedWords:words}
}
async function readFinitePayloadCosts({evidence,proof,native}){
 const payloads=new Map(),runs=[],base=await realpath(join(evidence,'cpu'))
 assert.deepEqual(await readFile(join(evidence,'source-policy.json')),await readFile(join(evidence,'source-policy/report.json')),'Original source policy and closed copy differ')
 for(const entry of native.cases){if(!['png','float'].includes(entry.producer))continue
  assert.equal(entry.programFile,entry.case+'.program.json');const path=await realpath(join(base,entry.programFile));assert.ok(path.startsWith(base+sep),'Native payload program escaped its owner');const bytes=await readFile(path);assert.equal(nodePortHash(bytes),entry.programSha256)
  const program=JSON.parse(bytes),source=program.ops.find(op=>op.kind==='image-input'),record=program.images?.[source?.properties.image_id]
  assert.ok(record);assert.equal(record.model,'native-cpu-static-image-v1');assert.equal(record.encoding,'zlib-le-rgba32f');assert.deepEqual([record.width,record.height],entry.size)
  assert.ok(Number.isSafeInteger(record.decodedBytes)&&record.decodedBytes>0&&record.decodedBytes<=4194304*16);const raw=inflateSync(Buffer.from(record.data,'base64'),{maxOutputLength:record.decodedBytes});assert.equal(raw.byteLength,record.decodedBytes);payloads.set(entry.case,{bytes:raw.byteLength,sha256:nodePortHash(raw)})
 }
 for(const run of proof.receipts[0].browsers){const path=join(evidence,'cpu','browser-'+run.phase+'-'+run.profile,'report.json'),bytes=await readFile(path);assert.equal(nodePortHash(bytes),run.reportSha256,'Observed cost report changed after authoritative close');runs.push({profile:run.profile,phase:run.phase,report:JSON.parse(bytes)})}
 return assertFinitePayloadCostReports(runs,native.cases,payloads)
}
