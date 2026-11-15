// Displace owns a same-pixel matrix, with admitted source and injected oracle
// inputs kept distinct. A compact receipt alone never qualifies this adapter.
import assert from 'node:assert/strict'
import {readFile,realpath,writeFile} from 'node:fs/promises'
import {join,relative,sep} from 'node:path'
import {executeNodePortCommand,nodePortHash} from './node-port-contract.mjs'
import {assertClosedFamilyNativeIdentity} from './node-port-family-evidence.mjs'

export const DISPLACE_FAMILY='compositor-displace-single'
const json=async path=>JSON.parse(await readFile(path,'utf8'))
const folder='experiments/compositor-displace-single',words=4344064
const phases=[['metal','baseline'],['metal','compare'],['software','baseline'],['software','compare']]
export function assertDisplaceAdapterScope({manifest,profile,completedRuns=profile.runs}){
 assert.equal(manifest.id,DISPLACE_FAMILY);assert.equal(manifest.nativeNode,'CompositorNodeDisplace');assert.equal(manifest.domain,'compositor');assert.equal(manifest.lifecycle,'production')
 assert.deepEqual(manifest.evidence,{adapter:'compositor-displace-single-v1',productionCases:16,calibrationCases:0,refusedNativeCases:0})
 assert.equal(profile.id,'mac-53');assert.deepEqual(profile.hostPlatforms,['darwin']);assert.equal(profile.blenderVersion,'5.3.0');assert.equal(profile.blenderBuildHash,'02f0899d78e3');assert.equal(profile.expectedStatus,undefined)
 assert.deepEqual(profile.nativeSource,{profile:'darwin-arm64-53-displace-single-cpu-v1',backend:null,evaluator:'CPU-compositor'})
 assert.deepEqual(profile.runs.map(r=>[r.id,r.adapter,r.args??[]]),[['matrix','matrix',[]]]);assert.deepEqual(completedRuns,profile.runs)
}
export function assertDisplaceAdapterReceipt(value){
 assert.equal(value.status,'QUALIFIED_DISPLACE_SINGLE_CPU_FINAL');assert.equal(value.supportCredit,0)
 assert.equal(value.savedFinalScenes,16);assert.equal(value.nativeSamePixelCases,160);assert.equal(value.nativeRenders,320);assert.equal(value.browserFrameCases,160)
 assert.equal(value.primaryWords,words);assert.equal(value.installedLinearWords,words*6);assert.equal(value.exactLinearWordDifferences,0);assert.equal(value.lifecycleFrameCycles,480)
 assert.equal(value.uniqueActualPythonPrefixes,19)
 for(const[key,python,final]of[['sourceArchive',17,16],['referenceArchive',1,0],['policyArchive',1,0]]){
  assert.equal(value[key]?.pythonInvocations,python);assert.equal(value[key].finalInvocations,final);assert.equal(value[key].uniqueCachePrefixes,python)
 }
 assert.equal(value.displayAudit?.words,words*6);assert.equal(value.displayAudit.limit,3e-5);assert.equal(value.displayAudit.bitExactClaim,false)
 assert.equal(value.displayAudit.alphaWordDifferences,0);assert.equal(value.displayAudit.nonfiniteClassDifferences,0)
 assert.ok(Number.isFinite(value.displayAudit.maxClampedAbsoluteError)&&value.displayAudit.maxClampedAbsoluteError>=0&&value.displayAudit.maxClampedAbsoluteError<=3e-5)
 assert.deepEqual(value.runs.map(r=>[r.profile,r.phase]),phases)
 for(const run of value.runs){
  assert.deepEqual(run.apis.map(r=>r.backend),['webgpu','webgl2'])
  for(const api of run.apis){assert.equal(api.cases,40);assert.equal(api.gpu?.api,api.backend==='webgpu'?'WebGPU':'WebGL2')
   if(run.profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
  }
 }
 assert.match(value.closedReader?.runtimeFingerprint,/^[a-f0-9]{64}$/)
 return value
}
export function displaceSuitePlan({root,evidence,blender}){
 assert.ok(root&&evidence&&blender)
 // The outer runner already owns evidence. The family capture requires a fresh
 // directory, and its adjacent policy archive must remain inside that ownership.
 return{argv:[process.execPath,join(root,folder,'matrix.mjs'),join(evidence,'proof')],env:{BLENDLINK_BLENDER:blender,SCENETOWEB_RUNTIME_TRANSACTION:null,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:null,SCENETOWEB_NATIVE_IDENTITY_POLICY:'per-invocation-sha256-v1'},timeoutMs:1_200_000}
}
export function displaceReaderCommand({root,evidence,output}){
 return{argv:[process.execPath,join(root,folder,'verify.mjs'),join(evidence,'proof'),output],env:{SCENETOWEB_RUNTIME_TRANSACTION:null,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:null},timeoutMs:300_000}
}
export async function runDisplaceSuite(options){
 const{root,evidence}=options,path=join(evidence,'suite-matrix.json');await assert.rejects(readFile(path),{code:'ENOENT'})
 const result=await executeNodePortCommand({...displaceSuitePlan(options),cwd:root,logPath:join(evidence,'family-matrix.log')})
 assert.equal(result.exitCode,0,'Displace matrix failed; inspect family-matrix.log');assert.equal(result.timedOut,false);assert.equal(result.error,undefined)
 const bytes=await readFile(join(evidence,'proof/qualified.json'));assertDisplaceAdapterReceipt(JSON.parse(bytes))
 await writeFile(path,JSON.stringify({status:'passed',family:DISPLACE_FAMILY,built:true,receiptSha256:nodePortHash(bytes),nativeGraphs:16,savedFinalScenes:16,browserCaseRuns:160,reuseNative:false},null,2)+'\n',{flag:'wx'})
}
async function finalSources(evidence){
 const base=await realpath(evidence),proof=join(evidence,'proof'),sources=await json(join(proof,'sources.json'))
 return Promise.all(sources.rows.map(async row=>{const file=await realpath(join(proof,row.sourceFile));assert.ok(file.startsWith(base+sep),'Displace Final source escaped owned transaction');return file}))
}
export const displaceEvidenceAdapter=Object.freeze({nativeOwnership:'family',validate:assertDisplaceAdapterScope,finalSources,
 nativeFinalPaths:['proof/sources.json','proof/final.json','proof/native.json','proof/baselines.json','proof/sources-source-inputs.json','proof/references-source-inputs.json','proof/sources-native-archive.json','proof/references-native-archive.json','proof-source-policy/policy.json','proof-source-policy/archive.json'],
 async read({root,evidence,manifest,profile,completedRuns,nativeIdentity}){
  assertDisplaceAdapterScope({manifest,profile,completedRuns})
  const suite=await json(join(evidence,'suite-matrix.json'));assert.deepEqual({status:suite.status,family:suite.family,built:suite.built,nativeGraphs:suite.nativeGraphs,savedFinalScenes:suite.savedFinalScenes,browserCaseRuns:suite.browserCaseRuns,reuseNative:suite.reuseNative},{status:'passed',family:DISPLACE_FAMILY,built:true,nativeGraphs:16,savedFinalScenes:16,browserCaseRuns:160,reuseNative:false})
  const bytes=await readFile(join(evidence,'proof/qualified.json'));assert.equal(nodePortHash(bytes),suite.receiptSha256);const first=assertDisplaceAdapterReceipt(JSON.parse(bytes))
  const output=join(evidence,'adapter-closed.json'),result=await executeNodePortCommand({...displaceReaderCommand({root,evidence,output}),cwd:root,logPath:join(evidence,'adapter-closed.log')})
  assert.equal(result.exitCode,0,'Independent Displace reader failed; inspect adapter-closed.log');assert.equal(result.timedOut,false);assert.equal(result.error,undefined)
  const proof=assertDisplaceAdapterReceipt(await json(output));assert.deepEqual(proof,first,'Displace receipt changed during independent closure')
  const native=await json(join(evidence,'proof/native.json'))
  // Reader summaries intentionally carry counts rather than executable identity.
  // Re-read each original archive, whose bytes the reader has just validated.
  for(const path of['proof/sources-native-archive.json','proof/references-native-archive.json','proof-source-policy/archive.json'])assertClosedFamilyNativeIdentity(native,await json(join(evidence,path)),nativeIdentity)
  const sources=await finalSources(evidence);assert.equal(sources.length,16);assert.equal(new Set(sources).size,16)
  return{status:'qualified',productionCases:16,calibrationCases:0,nativeGraphs:16,nativeSamePixelCases:160,nativeRenders:320,savedFinalScenes:16,caseRuns:160,productionCaseRuns:160,primaryFloat32Words:words,productionFloat32Words:words,wordMismatches:0,finalSources:sources,
   nativePythonOwnership:'family',nativePythonProof:{source:proof.sourceArchive,references:proof.referenceArchive,policy:proof.policyArchive},files:[{path:relative(evidence,output),sha256:nodePortHash(await readFile(output))}],actualIdentity:{nativeVersion:native.version,nativeBuild:native.build,nativeSource:profile.nativeSource,browsers:proof.runs}}
 }
})
