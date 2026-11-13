// CPU/compiler overhead only: no native launcher, browser, numerical capture or GPU.
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {captureRuntimeSnapshot,captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {captureRuntimeTransaction,loadRuntimeTransaction} from '../../scripts/lib/runtime-transaction-snapshot.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-field-proof-throughput'))
await mkdir(directory) // A measurement never overwrites/reuses another measurement transaction.
const measured=async work=>{const start=performance.now(),value=await work();return{milliseconds:performance.now()-start,value}}
const fingerprint=provenance=>hash(JSON.stringify(provenance.modules.map(module=>({name:module.name,source:module.sourceSha256,expected:module.expectedEmitterSha256,built:module.emitterSha256}))))
const before=[];let runtimeFingerprint
for(let child=0;child<8;child++){
 const run=await measured(async()=>{const destination=join(directory,'standalone-'+child),result=await captureRuntimeSnapshot({root,built:true,destination,label:'Independent child '+child});await cp(join(root,'packages/blendlink/dist/vendor'),join(destination,'vendor'),{recursive:true});return result})
 const current=fingerprint(run.value.provenance);if(runtimeFingerprint)assert.equal(current,runtimeFingerprint);else runtimeFingerprint=current
 before.push({child,milliseconds:run.milliseconds,productionModules:run.value.provenance.modules.length})
}
const beforeClose=await measured(()=>captureRuntimeProvenance({root,built:true,label:'Independent closing emission'}))
assert.equal(fingerprint(beforeClose.value.provenance),runtimeFingerprint)
const capture=await measured(()=>captureRuntimeTransaction({root,directory:join(directory,'transaction'),label:'Shared field proof matrix'})),pin=capture.value,after=[]
for(let child=0;child<8;child++){
 const run=await measured(()=>loadRuntimeTransaction({root,...pin}));assert.equal(run.value.provenance.modules.length,before[child].productionModules);assert.equal(fingerprint(run.value.provenance),runtimeFingerprint)
 after.push({child,milliseconds:run.milliseconds,productionModules:run.value.provenance.modules.length})
}
const afterClose=await measured(async()=>{
 const shared=await loadRuntimeTransaction({root,...pin})
 const {provenance}=await captureRuntimeProvenance({root,built:true,compilerInputs:true,label:'Shared independent closing emission'})
 assert.deepEqual(provenance.compilerAttestation,shared.provenance.compilerAttestation);assert.equal(fingerprint(provenance),runtimeFingerprint)
 await loadRuntimeTransaction({root,...pin});return provenance
})
const beforeMs=before.reduce((sum,row)=>sum+row.milliseconds,0)+beforeClose.milliseconds,afterMs=capture.milliseconds+after.reduce((sum,row)=>sum+row.milliseconds,0)+afterClose.milliseconds
const sources={};for(const path of ['experiments/field-proof-throughput/profile.mjs','scripts/lib/runtime-transaction-snapshot.mjs','scripts/lib/runtime-provenance.mjs','scripts/lib/runtime-compiler-trace.mjs','package.json','package-lock.json'])sources[path]=hash(await readFile(join(root,path)))
const result={status:'MEASURED_CPU_ATTESTATION_OVERHEAD',numericalCredit:0,node:process.version,platform:process.platform,architecture:process.arch,browserChildren:8,runtimeFingerprint,compilerInputs:{sourceFiles:afterClose.value.compilerAttestation.sourceFiles.length,operations:afterClose.value.compilerAttestation.operations.length},wholeProgramEmissions:{before:9,after:2,retainedIndependentClosingEmissions:1},before:{children:before,closingMilliseconds:beforeClose.milliseconds,totalMilliseconds:beforeMs},after:{captureMilliseconds:capture.milliseconds,children:after,closingAndFinalRevalidationMilliseconds:afterClose.milliseconds,totalMilliseconds:afterMs},reductionPercent:(beforeMs-afterMs)/beforeMs*100,transaction:pin,sourceHashes:sources,limits:'One serial CPU-only whole-production-program sample. Baseline includes eight snapshot/vendor copies and a fresh close. Optimized includes compiler-traced capture, eight complete child revalidations, fresh compiler-traced close and closing revalidations. No native/export/numerical/browser/render performance claim.'}
await writeFile(join(directory,'measurement.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({status:result.status,numericalCredit:0,beforeMilliseconds:beforeMs,afterMilliseconds:afterMs,reductionPercent:result.reductionPercent,wholeProgramEmissions:result.wholeProgramEmissions}))
