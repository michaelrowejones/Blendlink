// Closed receipt verification; local raw artifacts stay separate from the tracked summary.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertRelativeQualification,assertRelativeFinal} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-relative-to-pixel'))
const output=resolve(process.argv[3]??join(directory,'qualified.json'))
const read=async path=>JSON.parse(await readFile(path,'utf8'))
const pin=async(path,digest)=>assert.equal(hash(await readFile(path)),digest,'Proof input changed '+path)
const sources=[],runs=[];let caseRuns=0,words=0
for(const device of ['CPU','GPU']){
 const folder=join(directory,device.toLowerCase()),nativePath=join(folder,'qualification.json')
 const native=assertRelativeQualification(await read(nativePath));assert.equal(native.device,device)
 for(const[path,digest]of Object.entries(native.sourceHashes))await pin(join(root,path),digest)
 for(const row of native.cases){await pin(join(folder,row.programFile),row.programSha256);await pin(join(folder,row.pixelFile),row.pixelSha256)}
 const finalPath=join(folder,'final-proof.json'),final=assertRelativeFinal(await read(finalPath),native,{built:true,nativeSha256:hash(await readFile(nativePath))})
 for(const entry of final.provenance){await pin(join(root,entry.source),entry.sha256);await pin(join(root,entry.artifact),entry.sha256)}
 assert.ok(final.nativeLauncherIdentity?.native?.sha256)
 assert.ok(final.nativeInvocationReceipts.some(receipt=>receipt.result.pythonGuardApplied))
 for(const receipt of final.nativeInvocationReceipts){assert.equal(receipt.result.error,null);assert.equal(receipt.result.exitCode,0);assert.equal(receipt.result.cacheDisposed,true);assert.equal(receipt.result.timedOut,false);assert.equal(receipt.result.aborted,false)}
 for(const row of final.rows){await pin(join(folder,row.sourceFile),row.sourceSha256);for(const key of ['manifest','glb','presentation'])await pin(row[key+'Path'],row[key+'Sha256'])}
 sources.push({device,nativeCases:native.cases.length,savedFinalScenes:final.rows.length,native:{path:relative(root,nativePath),sha256:hash(await readFile(nativePath))},final:{path:relative(root,finalPath),sha256:hash(await readFile(finalPath))},sourceHashes:native.sourceHashes,nativeLauncherIdentity:final.nativeLauncherIdentity})
 for(const profile of ['metal','software'])for(const phase of ['raw','final']){
  const path=join(folder,'browser-'+phase+'-'+profile,'report.json'),report=await read(path)
  assert.equal(report.status,'PASSED_RELATIVE_BUILT_PROOF');assert.equal(report.built,true);assert.equal(report.final,phase==='final');assert.equal(report.profile,profile);assert.equal(report.sourceDevice,device)
  assert.equal(report.provenance.nativeQualificationSha256,hash(await readFile(nativePath)));if(phase==='final')assert.equal(report.provenance.finalProofSha256,hash(await readFile(finalPath)))
  for(const module of report.provenance.modules){assert.equal(module.emitterMatchesSource,true);await pin(join(root,'packages/blendlink/src',module.name+'.ts'),module.sourceSha256);await pin(join(report.provenance.snapshot.directory,module.name+'.js'),module.testedSnapshotSha256)}
  for(const[name,digest]of Object.entries(report.provenance.fixturePins))await pin(join(import.meta.dirname,name),digest)
  await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
  assert.equal(report.missingAdapterControl.refused,true);assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu'])
  const wanted=(phase==='final'?final.rows:native.cases).map(row=>row.case).sort()
  for(const row of report.rows){
   assert.equal(row.gpu.api,row.backend==='webgpu'?'WebGPU':'WebGL2');const gpu=JSON.stringify(row.gpu)
   if(profile==='metal'){assert.match(gpu,/apple|metal/i);assert.doesNotMatch(gpu,/swiftshader/i)}else assert.match(gpu,/swiftshader/i)
   assert.deepEqual(row.rows.map(result=>result.case).sort(),wanted);assert.deepEqual(row.errors,[]);assert.deepEqual(row.pageErrors,[])
   assert.equal(row.negatives.length,9);assert.equal(new Set(row.negatives.map(result=>result.kind)).size,9)
   for(const bad of row.negatives)assert.match(bad.error,/Relative To Pixel/)
   for(const result of row.rows){
    assert.equal(result.wordMismatches,0);assert.equal(result.portOwnedTextures,0);assert.equal(result.remainingRenderTargets,0)
    if(phase==='final'){
     assert.equal(result.pinRejected,true);assert.ok(result.meshCount>0);assert.equal(result.pipeline,'blender-compositor');assert.equal(result.sourceMaterialsPreserved,true)
     assert.equal(result.lifecycleCycles,3);assert.equal(result.baselineCacheRestored,true);assert.ok(result.baselineSceneDrawCalls>0);assert.equal(result.baselineCache.length,1);assert.equal(result.remainingTextures,1)
     const cache=result.baselineCache[0];assert.equal(cache.name,'DFG_LUT');assert.equal(cache.width,16);assert.equal(cache.height,16);assert.equal(typeof cache.uuid,'string')
    }else assert.equal(result.remainingTextures,0)
   }
   caseRuns+=row.rows.length;words+=row.rows.length*13*9*4
  }
  runs.push({path:relative(root,path),sha256:hash(await readFile(path)),sourceDevice:device,profile,phase,actualApis:report.rows.map(row=>({backend:row.backend,gpu:row.gpu,cases:row.rows.length})),browserVersion:report.browserVersion})
 }
}
assert.equal(caseRuns,288);assert.equal(words,134784)
const result={status:'QUALIFIED_RELATIVE_TO_PIXEL_SCALAR',nativeGraphs:64,savedFinalScenes:8,builtCaseRuns:caseRuns,primaryFloat32Words:words,wordMismatches:0,
 sourceProfile:'Blender5.3.0 02f0899d78e3 macOSarm64 CPU single-value operation, including GPU-authored single values',
 scope:'FLOAT X/Y/Greater/Smaller with direct Render Layers Image reference and exact Float32 literal/Value/group coefficient: +0 or normal, magnitude<=65536. No -0/subnormal/nonfinite/F64/computed factors, vector/per-dimension/diagonal modes, static/shifted/transformed references, render borders or non-square pixels.',
 resourceContract:'No port-owned textures or RTTs. Final actual-GLB no-compositor warmup identifies the exact renderer-owned DFG_LUT16x16 object. Three apply/dispose cycles restore that identical cache set, all source materials/callbacks, and zero render targets; raw cases dispose all textures.',
 sources,runs,negativeZeroBoundary:await read(join(import.meta.dirname,'negative-zero-evidence.json')),upstream:await read(join(import.meta.dirname,'sources.json')),
 rawArtifacts:{machineLocal:true,ignored:true,path:'artifacts/verification-relative-to-pixel'},productionPromotion:false}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_RELATIVE_QUALIFIED '+JSON.stringify({native:64,final:8,caseRuns,words,mismatches:0}))
