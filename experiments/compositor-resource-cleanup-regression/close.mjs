/* SPDX-License-Identifier: MIT */
// Resource-only regression wrapper. Existing family readers remain authoritative;
// this close independently binds their receipts and the older Blur harness.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile,readdir,lstat,realpath} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'
import {captureRuntimeProvenance,hash,normalizeEmit} from '../../scripts/lib/runtime-provenance.mjs'
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=await realpath(resolve(import.meta.dirname,'../..')),json=async file=>JSON.parse(await readFile(file))
const pinned=async file=>{const bytes=await readFile(file);return{path:relative(root,file),bytes:bytes.length,sha256:hash(bytes)}}
const {provenance:current}=await captureRuntimeProvenance({root,built:true,label:'resource-only compositor regression close'})
const fingerprint=hash(JSON.stringify(current.modules.map(module=>({name:module.name,source:module.sourceSha256,built:module.emitterSha256}))))
const families=[]
for(const[name,folder,status,graphs,controls,finals,runs]of[['white-noise','compositor-white-noise-default-field','QUALIFIED_PARTIAL_COMPOSITOR_WHITE_NOISE_DEFAULT_FIELD',54,9,8,248],['wave','compositor-wave-axis','QUALIFIED_PARTIAL_COMPOSITOR_WAVE_AXIS',140,9,20,640]]){
 const path=join(root,'artifacts/verification-resource-next43-'+name,'qualified.json'),q=await json(path)
 assert.equal(q.status,status);assert.equal(q.nativeGraphs,graphs);assert.equal(q.nativeOracleControls,controls);assert.equal(q.savedFinalScenes,finals);assert.equal(q.browserCaseRuns,runs);assert.equal(q.exactWordMismatches,0);assert.equal(q.contractViolations,0);assert.equal(q.closedReader.runtimeFingerprint,fingerprint)
 assert.equal(q.closedReader.verifierSha256,hash(await readFile(join(root,'experiments',folder,'verify.mjs'))))
 assert.deepEqual(q.runs.map(run=>[run.profile,run.phase]),[['metal','raw'],['metal','final'],['software','raw'],['software','final']])
 for(const run of q.runs){assert.equal(hash(await readFile(join(root,run.path))),run.sha256);assert.deepEqual(run.actualApis.map(api=>api.backend),['webgpu','webgl2']);for(const api of run.actualApis){if(run.profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)}}
 families.push({family:name,receipt:await pinned(path),nativeGraphs:graphs,nativeOracleControls:controls,savedFinalScenes:finals,browserCaseRuns:runs,primaryFloat32Words:q.primaryFloat32Words,exactWordMismatches:0,contractViolations:0,resizeFrames:q.resizeFrames,lifecycleCycles:q.lifecycleCycles,uniqueActualPythonPrefixes:q.uniqueActualPythonPrefixes,runtimeFingerprint:fingerprint,runs:q.runs})
}
const nativeFolder=join(root,'artifacts/verification-resource-next43-blur-native-r2'),referenceFolder=join(nativeFolder,'cpu'),archivePath=join(nativeFolder,'native-archive.json'),native=await json(archivePath),index=await json(join(referenceFolder,'index.json'))
assert.equal(native.complete,true);assert.equal(index.length,161);assert.equal(new Set(index.map(row=>row.case)).size,161)
const expectedSources=['packages/blender-addon/tests/compositor_blur_check.py','packages/blender-addon/tests/compositor_reference.py']
for(const name of await readdir(join(root,'packages/blendlink/blender')))if(name.endsWith('.py'))expectedSources.push('packages/blendlink/blender/'+name)
assert.deepEqual(Object.keys(native.inputs).sort(),expectedSources.sort())
for(const[file,pin]of Object.entries(native.inputs))assert.equal(hash(await readFile(join(root,file))),pin)
const calls=native.proof.invocations.flatMap(call=>call.result.args.flatMap((argument,i,args)=>argument==='--python'?[args[i+1]]:[]));assert.equal(calls.length,1);assert.equal(await realpath(calls[0]),await realpath(join(root,'packages/blender-addon/tests/compositor_blur_check.py')))
const archive=await validateNativeArchive(native,nativeFolder,{expectedScripts:[{path:calls[0],invocations:1}],expectedFinalSources:[],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
const blurRuns=[]
for(const profile of['metal','software']){
 const directory=join(root,'artifacts/verification-resource-next43-blur-'+profile),provenance=await json(join(directory,'provenance.json')),reports=await json(join(directory,'results.json'))
 assert.equal(provenance.mode,'built');assert.equal(provenance.typescript,current.typescript);assert.equal(provenance.copyAssetsSha256,current.copyAssetsSha256);assert.deepEqual(provenance.postEmitRules,current.postEmitRules);assert.deepEqual(provenance.workspaceChangesDuringRun,[]);assert.deepEqual(provenance.workspaceSourceChangesDuringRun,[])
 assert.equal(provenance.browserTimeoutMs,1200000);assert.equal(provenance.browserChannel,profile==='metal'?'chromium':null)
 assert.deepEqual(provenance.browserLaunchArgs,['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...profile==='software'?['--use-angle=swiftshader','--use-webgpu-adapter=swiftshader']:[]])
 const nowNames=current.modules.map(module=>module.name).sort();assert.deepEqual(provenance.modules.map(module=>module.name).sort(),nowNames)
 assert.deepEqual(provenance.snapshot.files.map(file=>file.name).sort(),nowNames.map(name=>name+'.js').sort())
 const expectedFiles=[]
 for(const now of current.modules){
  const recorded=provenance.modules.find(module=>module.name===now.name)
  for(const key of['sourceSha256','expectedEmitterSha256','emitterSha256','postEmitTransform'])assert.deepEqual(recorded[key],now[key])
  assert.equal(recorded.emitterMatchesSource,true);const name=now.name+'.js',bytes=await readFile(join(provenance.snapshot.directory,name)),raw=hash(bytes)
  assert.equal(raw,recorded.testedSnapshotSha256);assert.equal(raw,hash(await readFile(join(root,'packages/blendlink/dist',name))));assert.equal(hash(normalizeEmit(bytes.toString())),now.expectedEmitterSha256);assert.equal(raw,provenance.snapshot.files.find(file=>file.name===name).sha256);expectedFiles.push(name)
 }
 for(const map of provenance.snapshot.sourceMaps){assert.equal(hash(await readFile(join(provenance.snapshot.directory,map.name))),map.sha256);assert.equal(hash(await readFile(join(root,'packages/blendlink/dist',map.name))),map.sha256);expectedFiles.push(map.name)}
 assert.deepEqual((await readdir(provenance.snapshot.directory)).sort(),expectedFiles.sort());for(const name of expectedFiles)assert.equal((await lstat(join(provenance.snapshot.directory,name))).isSymbolicLink(),false)
 for(const name of['browser.ts','run.mjs','relative-resize.ts','word-transport.mjs'])assert.equal(hash(await readFile(join(root,'experiments/native-compositor-differential',name))),provenance.harnessSha256[name])
 const sourcePins=[]
 for(const row of index){
  const original=join(referenceFolder,row.case+'.json'),copy=join(directory,'browser-input/references','0-'+row.case+'.json'),bytes=await readFile(original)
  assert.deepEqual(await readFile(copy),bytes);sourcePins.push({case:row.case,sha256:hash(bytes)})
 }
 assert.deepEqual(await json(join(directory,'browser-input/references/index.json')),index.map(row=>({file:'0-'+row.case+'.json'})))
 assert.deepEqual(reports.map(report=>report.backend),['webgl2','webgpu'])
 let maxAbsoluteError=0,caseRuns=0,resizeFrames=0,maxPasses=0,maxFragmentBytes=0,shaderCostMeasurements=0
 const apis=[]
 for(const report of reports){
  assert.equal(report.failure,undefined);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.rows.map(row=>row.case),index.map(row=>row.case))
  if(profile==='metal'){assert.match(JSON.stringify(report.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(report.gpu),/swiftshader/i)}else assert.match(JSON.stringify(report.gpu),/swiftshader/i)
  for(const [i,row]of report.rows.entries()){
   const expected=await json(join(referenceFolder,index[i].case+'.json'))
   assert.equal(row.backend,report.backend);assert.equal(row.blenderHash,'02f0899d78e3');assert.equal(row.error,undefined);assert.deepEqual(row.shaderErrors,[]);assert.equal(row.remainingTextures,0);assert.ok(Number.isFinite(row.max)&&row.max>=0&&row.max<=2e-5);assert.equal(row.channels.length,4);assert.ok(row.channels.every(v=>Number.isFinite(v)&&v>=0&&v<=2e-5));if(expected.exactAlpha)assert.equal(row.channels[3],0)
   if(expected.resizeFrames){shaderCostMeasurements++;assert.equal(row.frames.length,expected.resizeFrames.length);resizeFrames+=row.frames.length;for(const [j,frame]of row.frames.entries()){assert.equal(frame.width,expected.resizeFrames[j].width);assert.equal(frame.height,expected.resizeFrames[j].height);assert.equal(frame.restoredState,true);if(expected.resizeFrames[j].expectError)assert.ok(frame.rejected.includes(expected.resizeFrames[j].expectError));else{assert.equal(frame.shaderStructureUnchanged,true);assert.ok(frame.max<=2e-5)}}assert.ok(row.maxPasses<=expected.assertShaderCost.maxPasses);assert.ok(row.maxFragmentBytes<=expected.assertShaderCost.maxFragmentBytes);maxPasses=Math.max(maxPasses,row.maxPasses);maxFragmentBytes=Math.max(maxFragmentBytes,row.maxFragmentBytes)}
   else{assert.ok(Number.isFinite(row.calibration)&&row.calibration<=1e-6);if(expected.assertShaderCost){shaderCostMeasurements++;assert.ok(row.shaderCost.passes<=expected.assertShaderCost.maxPasses);assert.ok(row.shaderCost.fragmentBytes.every(bytes=>bytes<=expected.assertShaderCost.maxFragmentBytes));maxPasses=Math.max(maxPasses,row.shaderCost.passes);maxFragmentBytes=Math.max(maxFragmentBytes,...row.shaderCost.fragmentBytes)}}
   maxAbsoluteError=Math.max(maxAbsoluteError,row.max);caseRuns++
  }
  apis.push({backend:report.backend,gpu:report.gpu,cases:report.rows.length})
 }
 blurRuns.push({profile,results:await pinned(join(directory,'results.json')),provenance:await pinned(join(directory,'provenance.json')),browserVersion:provenance.browserVersion,caseRuns,maxAbsoluteError,limit:2e-5,remainingTextures:0,shaderErrors:0,resizeFrames,shaderCost:shaderCostMeasurements?{measured:true,measurements:shaderCostMeasurements,maxPasses,maxFragmentBytes}:{measured:false,reason:'Fresh legacy Blur cases did not request shader/pass budget instrumentation'},apis,sourceReferencesSha256:hash(JSON.stringify(sourcePins))})
}
const packageReceipts=[]
for(const file of['/tmp/scenetoweb-resource-next43-install.json','/tmp/scenetoweb-primary-resource-next43-install.json']){
 const text=await readFile(file,'utf8'),end=text.indexOf('\nBLENDLINK_DOGFOOD_PACKAGE_READY ');assert.ok(end>0)
 const packet=JSON.parse(text.slice(0,end)),bytes=await readFile(packet.archive)
 assert.equal(bytes.length,packet.bytes);assert.equal(hash(bytes),packet.sha256);assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),packet.integrity)
 packageReceipts.push({receipt:{machineLocal:true,file,...await pinned(file)},...packet})
}
const comparisonKeys=['schemaVersion','name','version','bytes','sha256','integrity','treeFingerprint']
for(const key of comparisonKeys)assert.deepEqual(packageReceipts[0][key],packageReceipts[1][key],'Primary and resource-only tarball differ: '+key)
const packetComparison={equalFields:comparisonKeys,resource:packageReceipts[0],primary:packageReceipts[1],rerunClaim:'The primary tarball is byte-identical to the tested resource-only tarball. Tests ran in the resource worktree; no separate primary GPU/native rerun is claimed.'}
const journalPath='/tmp/scenetoweb-resource-regression-journal.json',journal=await json(journalPath);assert.equal(journal.length,12);assert.ok(journal.every(command=>command.exitCode===0))
const executionJournal={machineLocal:true,...await pinned(journalPath)}
const result={schemaVersion:1,status:'CLOSED_RESOURCE_ONLY_COMPOSITOR_REGRESSIONS',supportPromotion:false,newNodeSupportCredit:0,sdkFreeze:'c0c64b4',executionJournal,packetComparison,runtimeFingerprint:fingerprint,scope:'Resource-only owned RTT/DataTexture/row allocation cleanup. Fresh existing White Noise and Wave native/source/Final/browser proofs plus native CPU Blur consumer regressions on Metal and SwiftShader, WebGPU and WebGL2. No unqualified Noise or Displace prototype, new node admission, whole-scene equivalence or all-other-port freshness claim.',families,blur:{nativeCases:161,nativeSourceInventory:'Exact legacy declaration: canonical SDK Python and two test helpers; no complete addon-root import census claim',nativeArchive:await pinned(archivePath),archive,index:await pinned(join(referenceFolder,'index.json')),gate:2e-5,wordExactClaim:false,runs:blurRuns},reader:{path:relative(root,import.meta.filename),sha256:hash(await readFile(import.meta.filename))},rawArtifacts:{machineLocal:true,ignored:true,base:'artifacts/verification-resource-next43-*'}}
await writeFile(join(import.meta.dirname,'evidence.json'),JSON.stringify(result,null,2)+'\n');console.log(result.status,fingerprint)
