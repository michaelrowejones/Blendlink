// Close exact native literals -> saved Final -> pinned built runtime and source archives.
import assert from'node:assert/strict'
import{readFile,writeFile,readdir,realpath,stat}from'node:fs/promises'
import{join,resolve,relative,dirname,basename}from'node:path'
import{captureRuntimeProvenance,hash}from'../../scripts/lib/runtime-provenance.mjs'
import{loadRuntimeTransaction}from'../../scripts/lib/runtime-transaction-snapshot.mjs'
import{assertBuiltRuntimeArchive}from'../../scripts/lib/runtime-proof-archive.mjs'
import{nodePortPythonFileIdentity}from'../../scripts/lib/node-port-python.mjs'
import{assertGuardedNativeScript}from'../../scripts/lib/native-proof-archive.mjs'
import{browserProofContract,browserRefusals,expectedCases,expectedFinalCases,assertRadialWidthQualification,assertRadialWidthFinal}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]),pilot=process.argv.includes('--pilot-cpu-metal'),output=resolve(process.argv[3]?.startsWith('--')?join(directory,'pilot-closed.json'):process.argv[3]??join(directory,'qualified.json'))
const devices=pilot?['CPU']:['CPU','GPU'],profiles=pilot?['metal']:['metal','software']
const read=async path=>JSON.parse(await readFile(path)),pin=async(path,sha)=>assert.equal(hash(await readFile(path)),sha,'Changed proof input '+path)
const transactionPath=process.env.SCENETOWEB_RUNTIME_TRANSACTION,transactionSha256=process.env.SCENETOWEB_RUNTIME_TRANSACTION_SHA256
const shared=transactionPath||transactionSha256?await loadRuntimeTransaction({root,path:transactionPath,sha256:transactionSha256}):null
const{provenance:current}=await captureRuntimeProvenance({root,built:true,compilerInputs:!!shared,label:'Radial Tiling Segment Width closed reader'})
if(shared)assert.deepEqual(current.compilerAttestation,shared.provenance.compilerAttestation,'Fresh closing compiler closure differs from captured transaction')
const expectedNativeSources=['packages/blender-addon/tests/radial_segment_width_check.py','packages/blender-addon/tests/compositor_reference.py','experiments/radial-segment-width/cases.json','experiments/radial-segment-width/native_shader.py','experiments/radial-segment-width/numeric-contract.json']
for(const folder of['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,folder)))if(name.endsWith('.py'))expectedNativeSources.push(folder+'/'+name)
expectedNativeSources.sort()
const cachePrefixes=new Set(),identities=new Map(),sources=[],runs=[];let caseRuns=0,words=0,wordMismatches=0,shaderWordMismatches=0,maxUlps=0,maxAbsoluteError=0,resizeFrames=0,runtimeFingerprint
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
 const files=(await readdir(join(archive,'invocations'))).sort();assert.equal(files.length,native.cases.filter(row=>row.sourceFile).length+2)
 const records=[],exported=[];let version=0,capture=0
 for(const name of files){assert.match(name,/^[a-f0-9-]{36}\.json$/);const path=join(archive,'invocations',name),packet=await read(path),result=packet.result
  assert.equal(packet.schemaVersion,1);assert.equal(packet.kind,identity.kind);assert.equal(packet.parentGone,false);assert.equal(packet.productionCases,0);assert.equal(packet.error,undefined);assert.equal(packet.configSha256,identity.configuration.sha256);assert.deepEqual(packet.native,identity.native);assert.deepEqual(packet.node,identity.node)
  assert.equal(result.exitCode,0);assert.equal(result.signal,null);assert.equal(result.error,null);assert.equal(result.timedOut,false);assert.equal(result.aborted,false);assert.equal(result.cacheDisposed,true)
  if(result.args.length===1&&result.args[0]==='--version'){version++;assert.equal(result.pythonGuardApplied,false);assert.equal(result.cacheDirectory,null)}
  else{
   assert.equal(result.pythonGuardApplied,true);assert.equal(dirname(result.cacheDirectory),config.owned);assert.match(basename(result.cacheDirectory),/^python-cache-/);assert.ok(!cachePrefixes.has(result.cacheDirectory));cachePrefixes.add(result.cacheDirectory);await assert.rejects(stat(result.cacheDirectory),{code:'ENOENT'})
   const file=await realpath(assertGuardedNativeScript(result.args,result.cacheDirectory));if(file===await realpath(join(root,'packages/blender-addon/tests/radial_segment_width_check.py')))capture++
   else{assert.equal(file,await realpath(join(root,'packages/blendlink/dist/blender/export_scene.py')));const source=result.args.indexOf('-b');assert.ok(source>=0);exported.push(await realpath(result.args[source+1]))}
  }
  records.push({name,sha256:hash(await readFile(path))})
 }
 assert.equal(version,1);assert.equal(capture,1);assert.deepEqual(exported.sort(),(await Promise.all(native.cases.filter(row=>row.sourceFile).map(row=>realpath(join(folder,row.sourceFile))))).sort())
 assert.deepEqual(final.nativeInvocationReceipts.map(packet=>JSON.stringify(packet)).sort(),(await Promise.all(files.map(async name=>JSON.stringify(await read(join(archive,'invocations',name)))))).sort())
 return{native:identity.native,node:identity.node,configurationSha256:identity.configuration.sha256,invocations:records,exports:exported.length,captures:1,versionProbes:1}
}
for(const device of devices){
 const folder=join(directory,pilot?'pilot-cpu':device.toLowerCase()),nativePath=join(folder,'qualification.json'),native=assertRadialWidthQualification(await read(nativePath));assert.equal(native.device,device)
 assert.deepEqual(Object.keys(native.sourceHashes).sort(),expectedNativeSources)
 for(const[path,sha]of Object.entries(native.sourceHashes))await pin(join(root,path),sha)
 const atlas=await read(join(folder,native.shaderAtlas.report));await pin(join(folder,native.shaderAtlas.report),native.shaderAtlas.sha256);assert.deepEqual(atlas,native.shaderAtlas.data)
 for(const[file,sha]of Object.entries(atlas.files))await pin(join(folder,'native-shader',file),sha)
 const decodedBytes=await readFile(join(folder,'native-shader/decoded.f32')),decoded=new Float32Array(decodedBytes.buffer,decodedBytes.byteOffset,decodedBytes.length/4)
 assert.equal(atlas.cases.length,126);assert.equal(decoded.length,128);assert.deepEqual(atlas.controls,[Math.fround(.049123456),Math.fround(1.5678912)])
 assert.deepEqual([...new Uint32Array(decodedBytes.buffer,decodedBytes.byteOffset,decodedBytes.length/4)].slice(-2),atlas.controlWords)
 for(const row of native.cases){
  const program=await read(join(folder,row.programFile));assert.equal(program.status,'extracted');const math=program.ops.filter(op=>op.kind==='radial-segment-width');assert.equal(math.length,1);assert.equal(math[0].source.nodeType,'ShaderNodeRadialTiling');assert.equal(math[0].type,'VALUE');assert.equal(math[0].source.output,'Segment Width');assert.equal(Object.hasOwn(math[0].inputs,'Vector'),false)
  for(const kind of['program','pixel','shaderIr','shaderPixel'])await pin(join(folder,row[kind+'File']),row[kind+'Sha256'])
  const bytes=await readFile(join(folder,row.shaderPixelFile)),pixels=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),index=(row.sides-2)*2+Number(row.normalize)
  assert.equal(atlas.cases[index].sides,row.sides);assert.equal(atlas.cases[index].normalize,row.normalize)
  for(let i=0;i<pixels.length;i++)assert.equal(pixels[i],i%4===3?1:decoded[index])
  if(row.sourceFile){assert.equal(row.sourceFile,row.case+'.blend');await pin(join(folder,row.sourceFile),row.sourceSha256)}
 }

 const finalPath=join(folder,'final-proof.json'),final=assertRadialWidthFinal(await read(finalPath),native,{built:true,nativeSha256:hash(await readFile(nativePath))})
 for(const item of final.provenance){await pin(join(root,item.source),item.sha256);await pin(join(root,item.artifact),item.sha256)}
 for(const row of final.rows){const original=native.cases.find(item=>item.case===row.case);assert.equal(row.sourceFile,original.sourceFile);assert.equal(row.sourceSha256,original.sourceSha256);for(const kind of['manifest','glb','presentation','material'])await pin(row[kind+'Path'],row[kind+'Sha256'])}
 const nativeLauncher=await launcherClosure(folder,final,native)
 sources.push({device,nativeCases:native.cases.length,savedFinalScenes:final.rows.length,native:{path:relative(root,nativePath),sha256:hash(await readFile(nativePath))},final:{path:relative(root,finalPath),sha256:hash(await readFile(finalPath))},sourceHashes:native.sourceHashes,nativeLauncher})
 for(const profile of profiles)for(const phase of['raw','final']){
  const browser=join(folder,'browser-'+phase+'-'+profile),path=join(browser,'report.json'),report=await read(path)
  assert.equal(report.status,browserProofContract.browserStatus);assert.equal(report.built,true);assert.equal(report.final,phase==='final');assert.equal(report.profile,profile);assert.equal(report.sourceDevice,device);assert.equal(report.provenance.nativeQualificationSha256,hash(await readFile(nativePath)));if(phase==='final')assert.equal(report.provenance.finalProofSha256,hash(await readFile(finalPath)))
  if(shared){assert.deepEqual(report.provenance.transaction,shared.transaction);assert.deepEqual(report.provenance.compilerAttestation,current.compilerAttestation)}else assert.equal(report.provenance.transaction,undefined)
  runtimeFingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:shared?shared.provenance.snapshot.directory:join(browser,'runtime'),fixtureDirectory:join(browser,'fixture'),fixtureSourceDirectory:import.meta.dirname});await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
  assert.equal(report.missingAdapterControl.refused,true);assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu'])
  for(const api of report.rows){
   assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
   assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.negatives.map(row=>row.kind).sort(),browserRefusals.slice().sort());for(const bad of api.negatives)assert.match(bad.error,/Radial Tiling Segment Width/)
   assert.deepEqual(api.rows.map(row=>row.case).sort(),(phase==='raw'?native.cases:final.rows).map(row=>row.case).sort())
   for(const row of api.rows){
    for(const metric of[row,row.shaderMetrics]){assert.equal(metric.contractViolations,0);assert.equal(metric.comparedWords,256);assert.ok(metric.maxUlps<=2);assert.ok(metric.maxAbsoluteError<=2**-22);maxUlps=Math.max(maxUlps,metric.maxUlps);maxAbsoluteError=Math.max(maxAbsoluteError,metric.maxAbsoluteError)}
    wordMismatches+=row.wordMismatches;shaderWordMismatches+=row.shaderMetrics.wordMismatches;assert.equal(row.shaderLifecycleCycles,phase==='final'?3:0);assert.equal(row.resizeFrames,row.case==='sides-5-normalize-0'?3:0);assert.equal(row.resizeResults.length,row.resizeFrames);for(const metric of row.resizeResults)assert.equal(metric.contractViolations,0);resizeFrames+=row.resizeFrames;assert.equal(row.portOwnedTextures,0);assert.equal(row.remainingRenderTargets,0)
    if(phase==='final'){assert.equal(row.pinRejected,true);assert.ok(row.meshCount>0);assert.equal(row.pipeline,'blender-compositor');assert.equal(row.sourceMaterialsPreserved,true);assert.equal(row.lifecycleCycles,3);assert.equal(row.baselineCacheRestored,true);assert.ok(row.baselineSceneDrawCalls>0);assert.equal(row.baselineCache.length,1);assert.equal(row.remainingTextures,1);assert.equal(row.baselineCache[0].name,'DFG_LUT');assert.equal(row.baselineCache[0].width,16);assert.equal(row.baselineCache[0].height,16)}else assert.equal(row.remainingTextures,0)
    caseRuns++;words+=8*8*4
   }
  }
  runs.push({path:relative(root,path),sha256:hash(await readFile(path)),sourceDevice:device,profile,phase,browserVersion:report.browserVersion,actualApis:report.rows.map(row=>({backend:row.backend,gpu:row.gpu,cases:row.rows.length}))})
 }
}
const expectedNativeGraphs=expectedCases().length*devices.length,expectedSavedFinalScenes=expectedFinalCases().length*devices.length,expectedBrowserCases=2*devices.length*profiles.length*(expectedCases().length+expectedFinalCases().length)
assert.equal(caseRuns,expectedBrowserCases);assert.equal(cachePrefixes.size,devices.length*(expectedFinalCases().length+1));assert.equal(words,caseRuns*8*8*4)
if(shared)await loadRuntimeTransaction({root,path:transactionPath,sha256:transactionSha256})
const result={runtimeTransaction:shared?{sha256:shared.transaction.sha256,id:shared.transaction.id,independentlyReemittedAtClose:true}:null,status:pilot?'VALIDATED_RADIAL_WIDTH_CPU_METAL_PILOT':'QUALIFIED_PARTIAL_RADIAL_SEGMENT_WIDTH',matrixComplete:!pilot,nativeGraphs:expectedNativeGraphs,nativeShaderAtlasCases:126*devices.length,savedFinalScenes:expectedSavedFinalScenes,browserCaseRuns:caseRuns,primaryFloat32Words:words,shaderFloat32Words:words,wordMismatches,shaderWordMismatches,maxUlps,maxAbsoluteError,contractViolations:0,resizeFrames,uniqueActualPythonPrefixes:cachePrefixes.size,
 scope:'Blender5.3.0 02f0899d78e3 macOSarm64 Radial Segment Width only, integer literal Sides2..64 and Roundness exactly1, both Normalize states. Shader source EEVEE Metal; compositor authored CPU/GPU. The pinned regular/full-roundness output is independent of Vector and Normalize; only that dependency is pruned. CPU MF double-PI and GPU Float32-PI staging remain distinct native anchors. All other Radial outputs/branches, Cycles live shader, general computed Sides and other builds/platforms remain unqualified. The official demo uses a spatially computed stepped Sides field and Segment Coordinates; the unchanged scene is not unlocked or visually accepted by this literal Width slice.',
 numericContract:await read(join(import.meta.dirname,'numeric-contract.json')),
 resources:'No port-owned textures/render targets or per-frame readback. Three actual saved Final compositor pipeline cycles restore original material/callback ownership and the exact independent renderer-owned DFG_LUT baseline. Three additional actual material-program installation/disposal cycles draw the actual saved plane using its live Base Color under an explicitly named fragment diagnostic; these test the kernel/program transport, not Principled lighting parity.',
 closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(join(import.meta.dirname,'verify.mjs'))),runtimeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs')))},sources,runs,upstream:await read(join(import.meta.dirname,'sources.json')),rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)}}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log((pilot?'SCENETOWEB_RADIAL_WIDTH_PILOT_VALIDATED ':'SCENETOWEB_RADIAL_WIDTH_QUALIFIED ')+JSON.stringify({native:expectedNativeGraphs,final:expectedSavedFinalScenes,caseRuns,words,maxUlps,maxAbsoluteError,contractViolations:0}))
