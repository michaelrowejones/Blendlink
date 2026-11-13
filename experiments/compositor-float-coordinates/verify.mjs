// Closed receipt verification; local raw artifacts stay separate from the tracked summary.
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from '../../scripts/lib/runtime-proof-archive.mjs'
import {assertFloatCoordinateQualification,assertFloatCoordinateFinal} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-float-coordinates'))
const output=resolve(process.argv[3]??join(directory,'qualified.json'))
const read=async path=>JSON.parse(await readFile(path,'utf8'))
const pin=async(path,digest)=>assert.equal(hash(await readFile(path)),digest,'Proof input changed '+path)
const {provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Image Coordinates closed receipt'})
const expectedNativeSources=['packages/blender-addon/tests/compositor_float_coordinates_check.py','packages/blender-addon/tests/compositor_reference.py']
for(const directory of ['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,directory)))if(name.endsWith('.py'))expectedNativeSources.push(directory+'/'+name)
expectedNativeSources.sort()
const sources=[],runs=[];let runtimeFingerprint,caseRuns=0,words=0,exactWordMismatches=0,maxUlps=0,maxAbsoluteError=0,exactControlWords=0
for(const device of ['CPU','GPU']){
 const folder=join(directory,device.toLowerCase()),nativePath=join(folder,'qualification.json')
 const native=assertFloatCoordinateQualification(await read(nativePath));assert.equal(native.device,device)
 assert.deepEqual(Object.keys(native.sourceHashes).sort(),expectedNativeSources,'Native source closure census differs from current canonical Python imports/oracle/fixture')
 for(const[path,digest]of Object.entries(native.sourceHashes))await pin(join(root,path),digest)
 for(const row of native.cases){await pin(join(folder,row.programFile),row.programSha256);await pin(join(folder,row.pixelFile),row.pixelSha256);await pin(join(folder,row.inputFile),row.inputSha256)}
 const finalPath=join(folder,'final-proof.json'),final=assertFloatCoordinateFinal(await read(finalPath),native,{built:true,nativeSha256:hash(await readFile(nativePath))})
 for(const entry of final.provenance){await pin(join(root,entry.source),entry.sha256);await pin(join(root,entry.artifact),entry.sha256)}
 assert.ok(final.nativeLauncherIdentity?.native?.sha256)
 assert.ok(final.nativeInvocationReceipts.some(receipt=>receipt.result.pythonGuardApplied))
 for(const receipt of final.nativeInvocationReceipts){assert.equal(receipt.result.error,null);assert.equal(receipt.result.exitCode,0);assert.equal(receipt.result.cacheDisposed,true);assert.equal(receipt.result.timedOut,false);assert.equal(receipt.result.aborted,false)}
 for(const row of final.rows){await pin(join(folder,row.sourceFile),row.sourceSha256);for(const key of ['manifest','glb','presentation'])await pin(row[key+'Path'],row[key+'Sha256'])}
 sources.push({device,nativeCases:native.cases.length,savedFinalScenes:final.rows.length,native:{path:relative(root,nativePath),sha256:hash(await readFile(nativePath))},final:{path:relative(root,finalPath),sha256:hash(await readFile(finalPath))},sourceHashes:native.sourceHashes,nativeLauncherIdentity:final.nativeLauncherIdentity})
 for(const profile of ['metal','software'])for(const phase of ['raw','final']){
  const path=join(folder,'browser-'+phase+'-'+profile,'report.json'),report=await read(path)
  assert.equal(report.status,'PASSED_FLOAT_COORDINATE_BUILT_PROOF');assert.equal(report.built,true);assert.equal(report.final,phase==='final');assert.equal(report.profile,profile);assert.equal(report.sourceDevice,device)
  assert.equal(report.provenance.nativeQualificationSha256,hash(await readFile(nativePath)));if(phase==='final')assert.equal(report.provenance.finalProofSha256,hash(await readFile(finalPath)))
  runtimeFingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(folder,'browser-'+phase+'-'+profile,'runtime'),fixtureDirectory:join(folder,'browser-'+phase+'-'+profile,'fixture'),fixtureSourceDirectory:import.meta.dirname})
  await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
  assert.equal(report.missingAdapterControl.refused,true);assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu'])
  const wanted=(phase==='final'?final.rows:native.cases).map(row=>row.case).sort()
  for(const row of report.rows){
   assert.equal(row.gpu.api,row.backend==='webgpu'?'WebGPU':'WebGL2');const gpu=JSON.stringify(row.gpu)
   if(profile==='metal'){assert.match(gpu,/apple|metal/i);assert.doesNotMatch(gpu,/swiftshader/i)}else assert.match(gpu,/swiftshader/i)
   assert.deepEqual(row.rows.map(result=>result.case).sort(),wanted);assert.deepEqual(row.errors,[]);assert.deepEqual(row.pageErrors,[])
   assert.equal(row.negatives.length,8);assert.equal(new Set(row.negatives.map(result=>result.kind)).size,8)
   for(const bad of row.negatives)assert.match(bad.error,/Image Coordinates/)
   for(const result of row.rows){
    const original=native.cases.find(candidate=>candidate.case===result.case);assert.equal(result.width,original.width);assert.equal(result.height,original.height);assert.equal(result.pixelRatio,original.pixelRatio);assert.equal(result.resizeFrames,original.width===13&&original.route==='rgba'?7:0)
    if(phase==='raw'&&original.width===13&&original.route==='rgba')assert.equal(result.extentRefused,true)
    assert.ok(result.animationFrames.length>=2);for(let i=1;i<result.animationFrames.length;i++)assert.ok(result.animationFrames[i]>result.animationFrames[i-1])
    assert.equal(result.coordinateOutput,original.coordinateOutput);assert.equal(result.contractViolations,0);assert.equal(result.comparedWords,result.width*result.height*4);assert.ok(result.exactWordMismatches>=0);assert.ok(result.maxUlps<=2);assert.ok(result.maxAbsoluteError<=2**-22)
    assert.ok(result.exactControlWords>=result.width*result.height*2)
    assert.equal(result.resizeResults.length,result.resizeFrames)
    for(const frame of result.resizeResults){assert.equal(frame.contractViolations,0);assert.ok(frame.maxUlps<=2);assert.ok(frame.maxAbsoluteError<=2**-22);assert.ok(frame.exactControlWords>=frame.width*frame.height*2)}
    exactWordMismatches+=result.exactWordMismatches;maxUlps=Math.max(maxUlps,result.maxUlps);maxAbsoluteError=Math.max(maxAbsoluteError,result.maxAbsoluteError);exactControlWords+=result.exactControlWords;
    assert.equal(result.portOwnedTextures,0);assert.equal(result.remainingRenderTargets,0)
    if(phase==='final'){
     assert.equal(result.pinRejected,true);assert.ok(result.meshCount>0);assert.equal(result.pipeline,'blender-compositor');assert.equal(result.sourceMaterialsPreserved,true)
     assert.equal(result.lifecycleCycles,3);assert.equal(result.baselineCacheRestored,true);assert.ok(result.baselineSceneDrawCalls>0);assert.equal(result.baselineCache.length,1);assert.equal(result.remainingTextures,1)
     const cache=result.baselineCache[0];assert.equal(cache.name,'DFG_LUT');assert.equal(cache.width,16);assert.equal(cache.height,16);assert.equal(typeof cache.uuid,'string')
    }else assert.equal(result.remainingTextures,0)
   }
   caseRuns+=row.rows.length;words+=row.rows.reduce((sum,result)=>sum+result.width*result.height*4,0)
  }
  runs.push({path:relative(root,path),sha256:hash(await readFile(path)),sourceDevice:device,profile,phase,actualApis:report.rows.map(row=>({backend:row.backend,gpu:row.gpu,cases:row.rows.length})),browserVersion:report.browserVersion})
 }
}
assert.equal(caseRuns,448);assert.equal(words,596992)
const numericContract=await read(join(import.meta.dirname,'numeric-contract.json'));assert.equal(numericContract.xy.maxUlps,2);assert.equal(numericContract.xy.maxAbsoluteError,2**-22)
const result={status:'QUALIFIED_IMAGE_COORDINATES_FLOAT2',nativeGraphs:96,savedFinalScenes:16,builtCaseRuns:caseRuns,primaryFloat32Words:words,exactWordMismatches,contractViolations:0,maxUlps,maxAbsoluteError,exactControlWords,numericContract,numericContractSha256:hash(await readFile(join(import.meta.dirname,'numeric-contract.json'))),
 sourceProfile:'Blender5.3.0 02f0899d78e3 macOSarm64 CPU and Metal compositor image fields',
 scope:'Fresh Uniform/Normalized FLOAT_VECTOR2 outputs only, explicit RGBA and padded float3 edges through direct/reroute/group routes. Direct texture-backed full-frame Render Layers Image, square pixels, physical dimensions1..8192; pointwise consumers. Scalar/int conversion, arbitrary domains, transformed/static/computed references, borders and neighborhood operations remain unsupported. Pixel INT_VECTOR2 and legacy VECTOR3 remain unchanged.',
 resizeContract:'Same built raw graph and actual saved Final PassNode pipeline reused through seven physical resize/DPR frames per source/profile/API/phase. Raw control disposes its owned DataTexture GPU allocation before changing dimensions, retaining the same JavaScript Texture identity; actual pipeline uses normal RenderTarget.setSize. Mismatched physical extents refuse and recover.',
 resourceContract:'No port-owned texture or RTT. Actual GLB source-scene control warms renderer-owned DFG_LUT16x16. Three apply/dispose cycles restore its exact identity set, source materials and callbacks, and zero render targets. Raw controls dispose all owned textures. No broad performance claim.',
 closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(join(import.meta.dirname,'verify.mjs'))),runtimeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs'))),runtimeProvenanceHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-provenance.mjs')))},
 sources,runs,upstream:await read(join(import.meta.dirname,'sources.json')),rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)},productionPromotion:false}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_FLOAT_COORDINATE_QUALIFIED '+JSON.stringify({native:96,final:16,caseRuns,words,exactWordMismatches,maxUlps,maxAbsoluteError,contractViolations:0}))
