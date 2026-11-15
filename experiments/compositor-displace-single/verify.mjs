/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir,realpath,lstat} from 'node:fs/promises'
import {resolve,join,relative,sep} from 'node:path'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from '../../scripts/lib/runtime-proof-archive.mjs'
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
import {cases,assertSourcePolicy,assertSources,assertFinal,assertNative,assertProgram,assertBaseline,assertComparison,archiveDirectory,statuses,browserProofContract,exactMetric,displayMetric} from './protocol.mjs'
import {nativeInputs} from './inputs.mjs'
const root=await realpath(resolve(import.meta.dirname,'../..')),out=await realpath(resolve(process.argv[2])),output=resolve(process.argv[3]??join(out,'qualified.json'))
async function owned(path){const actual=await realpath(path);assert.ok(actual.startsWith(out+sep),'Final artifact escaped owned proof directory: '+path);assert.equal((await lstat(path)).isSymbolicLink(),false,'Final artifact cannot be a symlink');return actual}
const json=async file=>JSON.parse(await readFile(file)),pin=async(file,expected)=>{const bytes=await readFile(file);assert.equal(hash(bytes),expected,'Changed proof bytes: '+file);return bytes}
const inputs=await nativeInputs(root)
const sources=assertSources(await json(join(out,'sources.json'))),publication=assertFinal(await json(join(out,'final.json')),sources,inputs),native=assertNative(await json(join(out,'native.json'))),baselines=await json(join(out,'baselines.json'))
assert.equal(baselines.status,statuses.allBaselines);assert.deepEqual(baselines.profiles.map(r=>r.profile),['metal','software'])
const originalSources=[]
for(const row of publication.rows){
 for(const role of['source','program'])await pin(join(out,row[role+'File']),row[role+'Sha256'])
 for(const role of['manifest','glb','presentation','module'])await pin(await owned(row[role+'Path']),row[role+'Sha256'])
 const original=assertProgram(await json(join(out,row.programFile)),row),published=await json(row.presentationPath),manifest=await json(row.manifestPath),bytes=await readFile(row.presentationPath)
 assertProgram(published.compositor,row)
 for(const key of['status','ops','passes','output'])assert.deepEqual(published.compositor[key],original[key])
 assert.equal(published.display.view,'Raw');assert.deepEqual(published.display.ops,[])
 assert.equal(bytes.length,manifest.sourcePresentation.bytes);assert.equal(hash(bytes).slice(0,16),manifest.sourcePresentation.hash)
 // This owned corpus has no external image dependency whose missing pin could
 // silently change the baseline. Embedded geometry remains hashed GLB bytes.
 const glb=await readFile(row.glbPath),gltf=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString().trim())
 assert.ok((gltf.images??[]).every(image=>image.uri===undefined),'Unexpected unpinned external source image')
 originalSources.push(await realpath(join(out,row.sourceFile)))
}
for(const row of publication.provenance)for(const path of[row.source,row.artifact])await pin(join(root,path),row.sha256)
for(const stage of['sources','references'])assert.deepEqual(await json(join(out,stage+'-source-inputs.json')),inputs,'Native stage source closure mismatch')
const helperInputs={helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}
const sourceArchive=await validateNativeArchive(await json(join(out,'sources-native-archive.json')),archiveDirectory(out,'sources'),{expectedScripts:[{path:await realpath(join(import.meta.dirname,'source.py')),invocations:1}],expectedFinalSources:originalSources,helperInputs})
const referenceArchive=await validateNativeArchive(await json(join(out,'references-native-archive.json')),archiveDirectory(out,'references'),{expectedScripts:[{path:await realpath(join(import.meta.dirname,'reference.py')),invocations:1}],expectedFinalSources:[],helperInputs})
const policyOut=out+'-source-policy',policy=assertSourcePolicy(await json(join(policyOut,'policy.json')))
assert.equal(policy.status,'PASSED_DISPLACE_SOURCE_ONLY');assert.equal(policy.supportCredit,0);assert.equal(policy.policy.positive.length,19);assert.equal(policy.policy.refusals.length,20);assert.deepEqual(policy.policy.omissions,['disabled-root']);assert.deepEqual(policy.policy.blockedPolicyCalls,{gpu:0,render:0})
const expectedPolicy={}
for(const folder of['packages/blendlink/blender','packages/blender-addon'])for(const name of(await readdir(join(root,folder))).sort())if(name.endsWith('.py')||name.endsWith('.json'))expectedPolicy[folder+'/'+name]=hash(await readFile(join(root,folder,name)))
for(const file of['packages/blender-addon/tests/compositor_displace_single_check.py','experiments/compositor-displace-single/policy.mjs','scripts/lib/node-port-python.mjs','scripts/lib/native-proof-archive.mjs','scripts/node-port-blender.mjs'])expectedPolicy[file]=hash(await readFile(join(root,file)))
assert.deepEqual(policy.sourcePins,expectedPolicy);await pin(join(policyOut,'archive.json'),policy.archiveSha256)
const policyArchive=await validateNativeArchive(await json(join(policyOut,'archive.json')),policyOut,{expectedScripts:[{path:await realpath(join(root,'packages/blender-addon/tests/compositor_displace_single_check.py')),invocations:1}],expectedFinalSources:[],helperInputs})
await pin(join(root,'experiments/compositor-ellipse-scene-mix/raw-display-sources.json'),native.rawDisplayAudit.primarySourcesSha256)
await pin(native.rawDisplayAudit.configPath,native.rawDisplayAudit.configSha256)
const nativeById=new Map()
for(const row of native.rows){
 const buffers={}
 for(const role of['baseline','copy','linear','display']){const bytes=await pin(join(out,row[role+'File']),row[role+'Sha256']);assert.equal(bytes.length,row.width*row.height*16);buffers[role]=bytes}
 assert.deepEqual(buffers.copy,buffers.baseline)
 const definition=cases.find(c=>c.case===row.case)
 if(definition.setting==='origin')assert.deepEqual(buffers.linear,buffers.baseline,'Native origin must preserve the independent input')
 if(definition.setting==='maximum')assert.deepEqual(buffers.linear,Buffer.alloc(buffers.linear.length),'Far-outside Clip must be exact transparent black')
 if(definition.source==='constant-rgba')for(let i=0;i<buffers.linear.length;i+=4)assert.equal(buffers.linear.readUInt32LE(i),definition.colorWords[(i/4)%4])
 nativeById.set(row.id,{row,buffers})
}
const {provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Displace closed Final proof',compilerInputs:true})
let runtimeFingerprint,words=0,installedWords=0,displayWords=0,cycles=0,frameCases=0,maxDisplayError=0,displayDifferences=0
const runs=[]
for(const profile of['metal','software'])for(const phase of['baseline','compare']){
 const directory=join(out,'browser-'+phase+'-'+profile),report=await json(join(directory,'report.json'))
 if(phase==='compare')assert.equal(report.status,browserProofContract.browserStatus)
 if(phase==='baseline'){assertBaseline(report,profile);assert.deepEqual(report,baselines.profiles.find(r=>r.profile===profile))}else{assertComparison(report,profile);assert.equal(report.provenance.nativeSha256,hash(await readFile(join(out,'native.json'))));assert.equal(report.provenance.baselinesSha256,hash(await readFile(join(out,'baselines.json'))))}
 assert.equal(report.provenance.finalSha256,hash(await readFile(join(out,'final.json'))));assert.equal(report.provenance.sourcesSha256,hash(await readFile(join(out,'sources.json'))))
 const fingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(directory,'runtime'),fixtureDirectory:join(directory,'fixture'),fixtureSourceDirectory:import.meta.dirname,fixtureNames:['browser.js','browser-contract.mjs','same-frame.mjs','readback-transport.mjs','index.html']})
 runtimeFingerprint??=fingerprint;assert.equal(fingerprint,runtimeFingerprint)
 await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
 assert.deepEqual(report.provenance.generatedFiles,publication.rows.map(row=>({name:row.modulePath.split('/').at(-1),sha256:row.moduleSha256,source:row.modulePath})))
 assert.deepEqual((await readdir(join(directory,'generated'))).sort(),report.provenance.generatedFiles.map(file=>file.name).sort())
 for(const file of report.provenance.generatedFiles){await pin(join(directory,'generated',file.name),file.sha256);await pin(file.source,file.sha256)}
 for(const api of report.apis)for(const row of api.rows){
  const reference=nativeById.get(row.id);assert.ok(reference)
  if(phase==='baseline'){assert.equal(row.baselineFile,reference.row.baselineFile);assert.equal(row.baselineSha256,reference.row.baselineSha256);continue}
  const expectedRoles=['direct',...Array.from({length:3},(_,cycle)=>['installed','repeated','display','repeatedDisplay'].map(role=>role+'-'+cycle)).flat()]
  assert.deepEqual(row.readbacks.map(readback=>readback.role),expectedRoles)
  for(const readback of row.readbacks){
   assert.equal(readback.file,'readbacks/'+row.id+'.'+readback.role+'.rgba32f');assert.equal(readback.words,row.width*row.height*4)
   const actual=await pin(join(directory,readback.file),readback.sha256);assert.equal(actual.length,row.width*row.height*16)
   const display=readback.role.startsWith('display-')||readback.role.startsWith('repeatedDisplay-'),expected=display?reference.buffers.display:reference.buffers.linear
   const metric=display?displayMetric(new Uint32Array(actual.buffer,actual.byteOffset,actual.length/4),new Uint32Array(expected.buffer,expected.byteOffset,expected.length/4)):exactMetric(new Uint32Array(actual.buffer,actual.byteOffset,actual.length/4),new Uint32Array(expected.buffer,expected.byteOffset,expected.length/4))
   const [role,cycleText]=readback.role.split('-'),declared=role==='direct'?row.direct:row.cycles[Number(cycleText)][role]
   assert.deepEqual(declared,{...metric,sha256:readback.sha256},'Actual archived readback does not derive declared metric')
   if(display){assert.equal(metric.projectionAccepted,true);displayWords+=metric.words;maxDisplayError=Math.max(maxDisplayError,metric.maxClampedAbsoluteError);displayDifferences+=metric.wordDifferences}
   else{assert.equal(metric.wordDifferences,0);if(role==='direct')words+=metric.words;else installedWords+=metric.words}
  }
  cycles+=row.cycles.length;frameCases++
 }
 if(phase==='compare'){
  const expected=report.apis.flatMap(api=>api.rows.flatMap(row=>row.readbacks.map(readback=>readback.file.split('/').at(-1)))).sort()
  assert.deepEqual((await readdir(join(directory,'readbacks'))).sort(),expected,'Missing/extra readback files')
 }
 runs.push({phase,profile,path:relative(root,join(directory,'report.json')),sha256:hash(await readFile(join(directory,'report.json'))),browserVersion:report.browserVersion,apis:report.apis.map(api=>({backend:api.backend,gpu:api.gpu,cases:api.rows.length}))})
}
assert.equal(frameCases,native.rows.length);assert.equal(cycles,frameCases*3);assert.equal(installedWords,words*6);assert.equal(displayWords,words*6)
const result={schemaVersion:1,status:statuses.qualified,supportCredit:0,savedFinalScenes:publication.rows.length,nativeSamePixelCases:native.rows.length,nativeRenders:native.nativeRenders,browserFrameCases:frameCases,primaryWords:words,installedLinearWords:installedWords,exactLinearWordDifferences:0,lifecycleFrameCycles:cycles,displayAudit:{model:native.rawDisplayAudit.model,words:displayWords,wordDifferences:displayDifferences,maxClampedAbsoluteError:maxDisplayError,limit:3e-5,alphaWordDifferences:0,nonfiniteClassDifferences:0,bitExactClaim:false},scope:'One terminal pinned Blender 5.3 CPU Displace, unlinked raw normal/+0 float2 bounded [2^-16,8192], Nearest/Bilinear Clip, direct Render Layers Image or alpha-one constant native RGB. Native same-pixel arithmetic is separate from admitted source IR and actual saved Final installation; the injected Image oracle grants zero producer/BSDF/EEVEE rendering credit. Physical extent 4..8192, maximum 4194304 pixels, repeated resize/DPR and public preparation/commit/cancellation/disposal on both APIs/Metal+SwiftShader.',closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(import.meta.filename)),protocolSha256:hash(await readFile(join(import.meta.dirname,'protocol.mjs')))},nativeSourceInputs:inputs,sourceArchive,referenceArchive,policyArchive,uniqueActualPythonPrefixes:sourceArchive.uniqueCachePrefixes+referenceArchive.uniqueCachePrefixes+policyArchive.uniqueCachePrefixes,runs,rawArtifacts:{machineLocal:true,path:relative(root,out)}}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(result.status,frameCases,words)
