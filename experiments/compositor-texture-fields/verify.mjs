// Close native fields -> actual saved Final -> exact runtime archives, with declared numerical contracts.
import assert from'node:assert/strict'
import{readFile,writeFile,readdir,realpath,stat}from'node:fs/promises'
import{join,resolve,relative,dirname,basename}from'node:path'
import{captureRuntimeProvenance,hash}from'../../scripts/lib/runtime-provenance.mjs'
import{assertBuiltRuntimeArchive}from'../../scripts/lib/runtime-proof-archive.mjs'
import{nodePortPythonFileIdentity}from'../../scripts/lib/node-port-python.mjs'
import{assertTextureFieldQualification,assertTextureFieldFinal}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]),output=resolve(process.argv[3]??join(directory,'qualified.json'))
const read=async path=>JSON.parse(await readFile(path)),pin=async(path,sha)=>assert.equal(hash(await readFile(path)),sha,'Changed proof input '+path)
const{provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Texture fields closed reader'})
const expectedNativeSources=['packages/blender-addon/tests/compositor_texture_fields_check.py','packages/blender-addon/tests/compositor_reference.py']
for(const folder of['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,folder)))if(name.endsWith('.py'))expectedNativeSources.push(folder+'/'+name)
expectedNativeSources.sort()
const cachePrefixes=new Set(),identities=new Map(),sources=[],runs=[];let caseRuns=0,words=0,exactWordMismatches=0,contractViolations=0,maxUlps=0,maxAbsoluteError=0,resizeFrames=0,exactControlWords=0,runtimeFingerprint
async function currentIdentity(identity){if(!identities.has(identity.path))identities.set(identity.path,nodePortPythonFileIdentity(identity.path));assert.deepEqual(await identities.get(identity.path),identity)}
async function launcherClosure(folder,final,native){
 const identity=final.nativeLauncherIdentity,archive=join(folder,'native-launcher-archive'),config=await read(join(archive,'launcher.json'))
 assert.equal(identity.kind,'blendlink-proof-native-python-v1');assert.equal(identity.platform,'darwin');assert.equal(config.kind,identity.kind);assert.equal(config.schemaVersion,1)
 for(const key of['native','node','helper','bridge'])assert.deepEqual(config[key],identity[key])
 await currentIdentity(identity.native);await currentIdentity(identity.node)
 for(const[key,path]of Object.entries({launcher:'blender-proof',configuration:'launcher.json',helper:'lib/node-port-python.mjs',bridge:'node-port-blender.mjs'})){const bytes=await readFile(join(archive,path));assert.equal(bytes.length,identity[key].bytes);assert.equal(hash(bytes),identity[key].sha256);assert.equal(identity[key].path,join(config.owned,path))}
 for(const[key,path]of[['helper','scripts/lib/node-port-python.mjs'],['bridge','scripts/node-port-blender.mjs']])await pin(join(root,path),identity[key].sha256)
 assert.equal(dirname(config.owned),await realpath(join(folder,'native-launchers')));assert.match(basename(config.owned),/^native-launcher-/)
 assert.deepEqual((await readdir(archive)).sort(),['blender-proof','invocations','launcher.json','lib','node-port-blender.mjs'].sort());assert.deepEqual(await readdir(join(archive,'lib')),['node-port-python.mjs'])
 const files=(await readdir(join(archive,'invocations'))).sort();assert.equal(files.length,10)
 const records=[],exported=[];let version=0,capture=0
 for(const name of files){assert.match(name,/^[a-f0-9-]{36}\.json$/);const path=join(archive,'invocations',name),packet=await read(path),result=packet.result
  assert.equal(packet.schemaVersion,1);assert.equal(packet.kind,identity.kind);assert.equal(packet.parentGone,false);assert.equal(packet.productionCases,0);assert.equal(packet.error,undefined);assert.equal(packet.configSha256,identity.configuration.sha256);assert.deepEqual(packet.native,identity.native);assert.deepEqual(packet.node,identity.node)
  assert.equal(result.exitCode,0);assert.equal(result.signal,null);assert.equal(result.error,null);assert.equal(result.timedOut,false);assert.equal(result.aborted,false);assert.equal(result.cacheDisposed,true)
  if(result.args.length===1&&result.args[0]==='--version'){version++;assert.equal(result.pythonGuardApplied,false);assert.equal(result.cacheDirectory,null)}
  else{
   assert.equal(result.pythonGuardApplied,true);assert.equal(dirname(result.cacheDirectory),config.owned);assert.match(basename(result.cacheDirectory),/^python-cache-/);assert.ok(!cachePrefixes.has(result.cacheDirectory));cachePrefixes.add(result.cacheDirectory);await assert.rejects(stat(result.cacheDirectory),{code:'ENOENT'})
   const guard=result.args.indexOf('--python-expr'),script=result.args.indexOf('--python');assert.ok(guard>=0&&script>guard);assert.equal(result.args[guard+1],'import sys; sys.pycache_prefix='+JSON.stringify(result.cacheDirectory)+'; sys.dont_write_bytecode=True')
   const file=await realpath(result.args[script+1]);if(file===await realpath(join(root,'packages/blender-addon/tests/compositor_texture_fields_check.py')))capture++
   else{assert.equal(file,await realpath(join(root,'packages/blendlink/dist/blender/export_scene.py')));const source=result.args.indexOf('-b');assert.ok(source>=0);exported.push(await realpath(result.args[source+1]))}
  }
  records.push({name,sha256:hash(await readFile(path))})
 }
 assert.equal(version,1);assert.equal(capture,1);assert.deepEqual(exported.sort(),(await Promise.all(native.cases.filter(row=>row.sourceFile).map(row=>realpath(join(folder,row.sourceFile))))).sort())
 assert.deepEqual(final.nativeInvocationReceipts.map(packet=>JSON.stringify(packet)).sort(),(await Promise.all(files.map(async name=>JSON.stringify(await read(join(archive,'invocations',name)))))).sort())
 return{native:identity.native,node:identity.node,configurationSha256:identity.configuration.sha256,invocations:records,exports:8,captures:1,versionProbes:1}
}
for(const device of['CPU','GPU']){
 const folder=join(directory,device.toLowerCase()),nativePath=join(folder,'qualification.json'),native=assertTextureFieldQualification(await read(nativePath));assert.equal(native.device,device)
 assert.deepEqual(Object.keys(native.sourceHashes).sort(),expectedNativeSources)
 for(const[path,sha]of Object.entries(native.sourceHashes))await pin(join(root,path),sha)
 for(const row of native.cases){for(const kind of['program','pixel','input'])await pin(join(folder,row[kind+'File']),row[kind+'Sha256']);if(row.controlFile)await pin(join(folder,row.controlFile),row.controlSha256);if(row.sourceFile){assert.equal(row.sourceFile,row.case.replace(/^blender-5-3-(cpu|gpu)-/,'')+'.blend');await pin(join(folder,row.sourceFile),row.sourceSha256)}}
 const finalPath=join(folder,'final-proof.json'),final=assertTextureFieldFinal(await read(finalPath),native,{built:true,nativeSha256:hash(await readFile(nativePath))})
 for(const item of final.provenance){await pin(join(root,item.source),item.sha256);await pin(join(root,item.artifact),item.sha256)}
 for(const row of final.rows){const original=native.cases.find(item=>item.case===row.case);assert.equal(row.sourceFile,original.sourceFile);assert.equal(row.sourceSha256,original.sourceSha256);for(const kind of['manifest','glb','presentation'])await pin(row[kind+'Path'],row[kind+'Sha256'])}
 const nativeLauncher=await launcherClosure(folder,final,native)
 sources.push({device,nativeCases:native.cases.length,savedFinalScenes:final.rows.length,native:{path:relative(root,nativePath),sha256:hash(await readFile(nativePath))},final:{path:relative(root,finalPath),sha256:hash(await readFile(finalPath))},sourceHashes:native.sourceHashes,nativeLauncher})
 for(const profile of['metal','software'])for(const phase of['raw','final']){
  const browser=join(folder,'browser-'+phase+'-'+profile),path=join(browser,'report.json'),report=await read(path)
  // The frozen field runner retains this legacy label; exact field fixture/runner pins and the closed case census below establish family identity.
  assert.equal(report.status,'PASSED_FLOAT_COORDINATE_BUILT_PROOF');assert.equal(report.built,true);assert.equal(report.final,phase==='final');assert.equal(report.profile,profile);assert.equal(report.sourceDevice,device);assert.equal(report.provenance.nativeQualificationSha256,hash(await readFile(nativePath)));if(phase==='final')assert.equal(report.provenance.finalProofSha256,hash(await readFile(finalPath)))
  runtimeFingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(browser,'runtime'),fixtureDirectory:join(browser,'fixture'),fixtureSourceDirectory:import.meta.dirname});await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
  assert.equal(report.missingAdapterControl.refused,true);assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu'])
  for(const api of report.rows){
   assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
   assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.equal(api.negatives.length,8);assert.equal(new Set(api.negatives.map(row=>row.kind)).size,8);for(const bad of api.negatives)assert.match(bad.error,/Procedural Texture/)
   assert.deepEqual(api.rows.map(row=>row.case).sort(),(phase==='raw'?native.cases:final.rows).map(row=>row.case).sort())
   for(const row of api.rows){const original=native.cases.find(item=>item.case===row.case),expectedResize=original.resizeEligible?native.cases.filter(item=>item.route===original.route&&item.kind===original.kind&&item.mode===original.mode&&item.textureOutput===original.textureOutput).length+1:0
    for(const key of['width','height','pixelRatio','route','kind','mode','textureOutput','coordinateOutput'])assert.equal(row[key],original[key])
    assert.equal(row.contractViolations,0);assert.equal(row.comparedWords,row.width*row.height*4);assert.ok(row.maxAbsoluteError<=2**-20);if(row.mode!=='DIAGONAL'||row.coordinateOutput!=='Uniform')assert.ok(row.maxUlps<=8)
    if(row.kind==='checker'||row.mode==='DIAGONAL'&&row.coordinateOutput==='Uniform')assert.equal(row.exactWordMismatches,0)
    assert.equal(row.resizeFrames,expectedResize);assert.equal(row.resizeResults.length,expectedResize);if(phase==='raw'&&original.resizeEligible)assert.equal(row.extentRefused,true)
    if(original.resizeEligible&&row.route==='implicit'&&row.kind==='checker')assert.equal(row.boundaryRefused,true)
    if(original.resizeEligible&&row.kind==='gradient'&&row.mode==='EASING')assert.equal(row.endpointRefused,true)
    if(original.resizeEligible&&row.mode==='DIAGONAL'&&row.coordinateOutput==='Uniform')assert.equal(row.dyadicRefused,true)
    for(const frame of row.resizeResults){assert.equal(frame.contractViolations,0);assert.ok(frame.maxAbsoluteError<=2**-20)}
    for(let i=1;i<row.animationFrames.length;i++)assert.ok(row.animationFrames[i]>row.animationFrames[i-1]);assert.ok(row.animationFrames.length>=2)
    assert.equal(row.portOwnedTextures,0);assert.equal(row.remainingRenderTargets,0)
    if(phase==='final'){assert.equal(row.pinRejected,true);assert.ok(row.meshCount>0);assert.equal(row.pipeline,'blender-compositor');assert.equal(row.sourceMaterialsPreserved,true);assert.equal(row.lifecycleCycles,3);assert.equal(row.baselineCacheRestored,true);assert.ok(row.baselineSceneDrawCalls>0);assert.equal(row.baselineCache.length,1);assert.equal(row.remainingTextures,1);assert.equal(row.baselineCache[0].name,'DFG_LUT');assert.equal(row.baselineCache[0].width,16);assert.equal(row.baselineCache[0].height,16)}else assert.equal(row.remainingTextures,0)
    caseRuns++;words+=row.comparedWords;exactWordMismatches+=row.exactWordMismatches;contractViolations+=row.contractViolations;maxUlps=Math.max(maxUlps,row.maxUlps);maxAbsoluteError=Math.max(maxAbsoluteError,row.maxAbsoluteError);exactControlWords+=row.exactControlWords;resizeFrames+=row.resizeFrames
   }
  }
  runs.push({path:relative(root,path),sha256:hash(await readFile(path)),sourceDevice:device,profile,phase,browserVersion:report.browserVersion,actualApis:report.rows.map(row=>({backend:row.backend,gpu:row.gpu,cases:row.rows.length}))})
 }
}
assert.equal(caseRuns,952);assert.equal(cachePrefixes.size,18);assert.equal(contractViolations,0)
const numericContract=await read(join(import.meta.dirname,'numeric-contract.json'))
const result={status:'QUALIFIED_PARTIAL_COMPOSITOR_TEXTURE_FIELDS',nativeGraphs:222,savedFinalScenes:16,browserCaseRuns:caseRuns,primaryFloat32Words:words,exactWordMismatches,contractViolations,maxUlps,maxAbsoluteError,exactControlWords,resizeFrames,uniqueActualPythonPrefixes:cachePrefixes.size,numericContract,numericContractSha256:hash(await readFile(join(import.meta.dirname,'numeric-contract.json'))),scope:'MeasuredBlender5.3.0 02f0899d78e3 macOSarm64 CPU/GPU compositor; implicitUniform and linkedfullframeImageCoordinates Uniform/Normalized with identitymapping. LINEAR/QUADRATIC boundedfieldcontract. EASING requiresnative-one endpointseparation greaterthan8u aftercoordinateuncertainty, includingresize; exactzero/onecontrolsunchanged. UniformDIAGONAL requirespoweroftwo maxphysicalextent andbitexactwords, includingresize; NormalizedDIAGONAL boundedcontract. Checker literalintegerScale0..256 andliteralcolors onlywhen conservativephaseguardadmitscurrentphysicalextent; exactbranch/words, recheckedafterresize. Literalportsunchanged. Noarbitrarycomputedcoordinates/spatialdomains/borders/non-squarepixels.',resources:'Noportownedtextures/RTTs/perframeGPUreadback. Shadercoordinate/mathkernelsreusefloat2producer. CheckerphaseguardO(width+height)onlyonextentchange, cachedduringframes. ActualGLTFnoglobalcompositorbaselinewarmsoneDFG_LUT identity;3apply/disposecyclespreservesourcematerials/callbacksandrestoreexactcacheidentityset.',closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(join(import.meta.dirname,'verify.mjs'))),runtimeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs')))},sources,runs,upstream:await read(join(import.meta.dirname,'sources.json')),rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)}}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_TEXTURE_FIELDS_QUALIFIED '+JSON.stringify({native:222,final:16,caseRuns,words,exactWordMismatches,maxUlps,maxAbsoluteError,contractViolations:0,resizeFrames}))
