// Synthetic transport/schema controls; never native or browser evidence.
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {assertDisplaceAdapterReceipt,assertDisplaceAdapterScope,displaceEvidenceAdapter,displaceSuitePlan,displaceReaderCommand} from './node-port-displace-evidence.mjs'
import {nodePortHash,readNodePortManifest,validateNodePortManifest} from './node-port-contract.mjs'
import {runNodePort} from '../test-node-port.mjs'
import {closedFamilySuitePlan} from '../run-node-port-family.mjs'
import {diffBlenderSnapshots,digest} from './blender-node-changes.mjs'
import {planUnqualifiedPorts} from '../watch-blender-nodes.mjs'
import {fingerprintNodePortInputs} from './node-port-contract.mjs'
const root=resolve(import.meta.dirname,'../..'),manifest=await readNodePortManifest(join(root,'node-ports/compositor-displace-single.json'))
const scope=()=>{const m=structuredClone(manifest);return{manifest:m,profile:m.profiles[0],completedRuns:structuredClone(m.profiles[0].runs)}}
const fixture=()=>({status:'QUALIFIED_DISPLACE_SINGLE_CPU_FINAL',supportCredit:0,savedFinalScenes:16,nativeSamePixelCases:160,nativeRenders:320,browserFrameCases:160,primaryWords:4344064,installedLinearWords:26064384,exactLinearWordDifferences:0,lifecycleFrameCycles:480,uniqueActualPythonPrefixes:19,
 sourceArchive:{pythonInvocations:17,finalInvocations:16,uniqueCachePrefixes:17},referenceArchive:{pythonInvocations:1,finalInvocations:0,uniqueCachePrefixes:1},policyArchive:{pythonInvocations:1,finalInvocations:0,uniqueCachePrefixes:1},
 displayAudit:{words:26064384,limit:3e-5,bitExactClaim:false,alphaWordDifferences:0,nonfiniteClassDifferences:0,maxClampedAbsoluteError:0},closedReader:{runtimeFingerprint:'a'.repeat(64)},
 runs:['metal','software'].flatMap(profile=>['baseline','compare'].map(phase=>({profile,phase,apis:['webgpu','webgl2'].map(backend=>({backend,cases:40,gpu:{api:backend==='webgpu'?'WebGPU':'WebGL2',vendor:profile==='metal'?'Apple Metal':'SwiftShader'}}))})))})
test('Displace closes its admitted-source/same-pixel census, profiles and exact linear contract',()=>{
 assertDisplaceAdapterScope(scope());assertDisplaceAdapterReceipt(fixture())
 for(const mutate of [v=>v.savedFinalScenes=15,v=>v.nativeSamePixelCases=16,v=>v.nativeRenders=160,v=>v.browserFrameCases=0,v=>v.primaryWords=0,v=>v.installedLinearWords=4344064,v=>v.exactLinearWordDifferences=1,v=>v.lifecycleFrameCycles=160,v=>v.uniqueActualPythonPrefixes=18,v=>delete v.referenceArchive,v=>v.sourceArchive.finalInvocations=0,v=>v.policyArchive.pythonInvocations=0,v=>v.supportCredit=1,v=>v.displayAudit.alphaWordDifferences=1,v=>v.displayAudit.nonfiniteClassDifferences=1,v=>v.displayAudit.limit=1,v=>v.displayAudit.maxClampedAbsoluteError=Infinity,v=>v.displayAudit.maxClampedAbsoluteError=3.1e-5,v=>v.displayAudit.bitExactClaim=true,v=>v.runs.pop(),v=>v.runs[1].phase='baseline',v=>v.runs[0].apis.pop(),v=>v.runs[0].apis[1]=v.runs[0].apis[0],v=>v.runs[0].apis[0].cases=16,v=>v.runs[0].apis[0].gpu.api='WebGL2',v=>v.runs[0].apis[0].gpu.vendor='SwiftShader',v=>v.runs[2].apis[0].gpu.vendor='Apple Metal']){const value=fixture();mutate(value);assert.throws(()=>assertDisplaceAdapterReceipt(value))}
 for(const mutate of [v=>v.manifest.nativeNode='CompositorNodeImage',v=>v.manifest.domain='shader',v=>v.manifest.evidence.productionCases=160,v=>v.profile.blenderVersion='5.4.0',v=>v.profile.nativeSource.backend='METAL',v=>v.profile.runs[0].args=['--reuse-native'],v=>v.completedRuns=[]]){const value=scope();mutate(value);assert.throws(()=>assertDisplaceAdapterScope(value))}
 for(const patch of[{nativeNode:'CompositorNodeImage'},{domain:'shader'}])assert.throws(()=>validateNodePortManifest({...structuredClone(manifest),...patch}))
})
test('Displace schedules one fresh nested proof with its adjacent policy owned by outer evidence',async t=>{
 const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-displace-auto-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 const evidence=join(tmp,'absent'),blender=join(tmp,'never-execute');await writeFile(blender,'not executable')
 const plan=await runNodePort({root,id:manifest.id,profile:'mac-53',evidence,blender,dryRun:true})
 assert.equal(plan.status,'planned');assert.equal(plan.productionCredit,false);assert.equal(plan.runnable,true);assert.equal(plan.commands.filter(c=>c.id==='suite-matrix').length,1)
 const owned=displaceSuitePlan({root,evidence,blender});assert.deepEqual(closedFamilySuitePlan(manifest.id,{root,evidence,blender}),owned)
 assert.equal(owned.argv.at(-1),join(evidence,'proof'));assert.equal(owned.env.BLENDLINK_BLENDER,blender);assert.equal(owned.env.SCENETOWEB_RUNTIME_TRANSACTION,null)
 const reader=displaceReaderCommand({root,evidence,output:join(evidence,'closed.json')});assert.deepEqual(reader.argv.slice(-2),[join(evidence,'proof'),join(evidence,'closed.json')])
 assert.ok(displaceEvidenceAdapter.nativeFinalPaths.every(path=>path.startsWith('proof/')||path.startsWith('proof-source-policy/')))
 await assert.rejects(readFile(join(evidence,'report.json')),{code:'ENOENT'})
})
test('a forged passed Displace summary cannot bypass the authoritative independent reader',async t=>{
 const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-displace-close-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 const evidence=join(tmp,'evidence'),folder=join(tmp,'experiments/compositor-displace-single');await mkdir(join(evidence,'proof'),{recursive:true});await mkdir(folder,{recursive:true})
 const bytes=JSON.stringify(fixture());await writeFile(join(evidence,'proof/qualified.json'),bytes)
 await writeFile(join(evidence,'suite-matrix.json'),JSON.stringify({status:'passed',family:manifest.id,built:true,nativeGraphs:16,savedFinalScenes:16,browserCaseRuns:160,reuseNative:false,receiptSha256:nodePortHash(bytes)}))
 await writeFile(join(folder,'verify.mjs'),'process.exit(23)\n')
 await assert.rejects(displaceEvidenceAdapter.read({root:tmp,evidence,...scope(),nativeIdentity:{}}),/Independent Displace reader failed/)
 await assert.rejects(readFile(join(evidence,'adapter-closed.json')),{code:'ENOENT'})
})
test('Displace source changes queue fresh verification and retrospective records cannot queue themselves',async t=>{
 const files=Object.fromEntries([...manifest.upstream.direct,...manifest.upstream.shared].map(path=>[path,'old']))
 const make=files=>{const s={schemaVersion:1,collectorVersion:1,kind:'blendlink-blender-node-source-snapshot-v1',watchScope:['synthetic'],sourceRevision:'a'.repeat(40),files,nodeSources:{},sourceDependencies:{},catalogIdentity:null,catalogNodes:null};return{...s,inputDigest:digest(s)}}
 for(const path of Object.keys(files)){
  const change=diffBlenderSnapshots(make(files),make({...files,[path]:'changed'}),[manifest]);assert.deepEqual(change.affectedManifestIds,[manifest.id])
  const plan=planUnqualifiedPorts([manifest],change,{source:{commit:'a'.repeat(40)},build:{version:'5.3.0'}});assert.equal(plan.productionCredit,false);assert.equal(plan.productionCases,0);assert.equal(plan.ports[0].status,'needs-fresh-qualified-verification')
 }
 const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-displace-inputs-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 const inputs=['native.py','runtime.ts','package.json',...manifest.inputs.tests.filter(path=>path.endsWith('.json'))]
 for(const path of inputs){await mkdir(resolve(tmp,path,'..'),{recursive:true});await writeFile(join(tmp,path),'fixed')}
 const m={...manifest,inputs:{native:['native.py'],runtime:['runtime.ts'],sdk:['package.json'],tests:inputs.slice(3)}}
 const before=await fingerprintNodePortInputs(tmp,m);await writeFile(join(tmp,'experiments/compositor-displace-single/evidence.json'),'record only')
 assert.equal((await fingerprintNodePortInputs(tmp,m)).inputDigest,before.inputDigest)
 await writeFile(join(tmp,'experiments/compositor-displace-single/cases.json'),'changed executable cases')
 assert.notEqual((await fingerprintNodePortInputs(tmp,m)).inputDigest,before.inputDigest)
 for(const name of['compositor-blank-image','compositor-noise-default-field','squeeze','float-to-int']){
  const m=await readNodePortManifest(join(root,'node-ports',name+'.json'));assert.ok(m.inputs.sdk.includes('scripts/lib/node-port-displace-evidence.mjs'))
 }
})
test('synthetic successful transport checks the actual native identity in every original archive',async t=>{
 const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-displace-identities-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 const evidence=join(tmp,'evidence'),folder=join(tmp,'experiments/compositor-displace-single');await mkdir(join(evidence,'proof'),{recursive:true});await mkdir(join(evidence,'proof-source-policy'));await mkdir(folder,{recursive:true})
 const identity={path:'/synthetic/never-executed-blender',bytes:123,sha256:'c'.repeat(64)},proof=fixture(),bytes=JSON.stringify(proof)
 await writeFile(join(evidence,'proof/qualified.json'),bytes);await writeFile(join(evidence,'proof/native.json'),JSON.stringify({version:[5,3,0],build:'02f0899d78e3'}))
 await writeFile(join(evidence,'suite-matrix.json'),JSON.stringify({status:'passed',family:manifest.id,built:true,nativeGraphs:16,savedFinalScenes:16,browserCaseRuns:160,reuseNative:false,receiptSha256:nodePortHash(bytes)}))
 const archives=['proof/sources-native-archive.json','proof/references-native-archive.json','proof-source-policy/archive.json']
 const putArchive=(path,value)=>writeFile(join(evidence,path),JSON.stringify({identity:{native:value}}))
 for(const path of archives)await putArchive(path,identity)
 const rows=Array.from({length:16},(_,i)=>({sourceFile:'source'+i+'.blend'}));for(const row of rows)await writeFile(join(evidence,'proof',row.sourceFile),'synthetic, never loaded')
 await writeFile(join(evidence,'proof/sources.json'),JSON.stringify({rows}))
 // This subprocess tests adapter transport only. It is explicitly a fake reader;
 // no Blender/browser process, production receipt or numerical credit is used.
 await writeFile(join(folder,'verify.mjs'),"import{writeFile}from'node:fs/promises';await writeFile(process.argv.at(-1),"+JSON.stringify(bytes)+")\n")
 const args={root:tmp,evidence,...scope(),nativeIdentity:identity}
 const result=await displaceEvidenceAdapter.read(args);assert.equal(result.status,'qualified');assert.equal(result.finalSources.length,16);assert.equal(result.nativeGraphs,16);assert.equal(result.nativeSamePixelCases,160)
 for(const path of archives){await putArchive(path,{...identity,sha256:'d'.repeat(64)});await assert.rejects(displaceEvidenceAdapter.read(args),/Actual native identity differs/);await putArchive(path,identity)}
})
test('both finite-image adapters watch the native shared realization and inline SIMD sampler dependencies',async()=>{
 const ports=await Promise.all(['compositor-blank-image','compositor-displace-single'].map(name=>readNodePortManifest(join(root,'node-ports',name+'.json'))))
 const paths=['source/blender/compositor/intern/realize_on_domain_operation.cc','source/blender/compositor/COM_realize_on_domain_operation.hh','source/blender/compositor/COM_result.hh','source/blender/compositor/intern/result.cc','source/blender/blenlib/BLI_math_interp.hh','source/blender/blenlib/BLI_simd.hh']
 const make=files=>{const s={schemaVersion:1,collectorVersion:1,kind:'blendlink-blender-node-source-snapshot-v1',watchScope:['synthetic'],sourceRevision:'a'.repeat(40),files,nodeSources:{},sourceDependencies:{},catalogIdentity:null,catalogNodes:null};return{...s,inputDigest:digest(s)}}
 const files=Object.fromEntries(paths.map(path=>[path,'old']))
 for(const path of paths){for(const port of ports)assert.ok(port.upstream.shared.includes(path));const change=diffBlenderSnapshots(make(files),make({...files,[path]:'changed'}),ports);assert.deepEqual([...change.affectedManifestIds].sort(),ports.map(port=>port.id).sort())}
})
