// Closed receipt verification; local raw artifacts stay separate from the tracked summary.
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir,realpath,stat} from 'node:fs/promises'
import {join,resolve,relative,dirname,basename} from 'node:path'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {loadRuntimeTransaction} from '../../scripts/lib/runtime-transaction-snapshot.mjs'
import {nodePortPythonFileIdentity} from '../../scripts/lib/node-port-python.mjs'
import {assertBuiltRuntimeArchive} from '../../scripts/lib/runtime-proof-archive.mjs'
import {browserProofContract,assertPixelQualification,assertPixelFinal} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-image-coordinates'))
const output=resolve(process.argv[3]??join(directory,'qualified.json'))
const read=async path=>JSON.parse(await readFile(path,'utf8'))
const pin=async(path,digest)=>assert.equal(hash(await readFile(path)),digest,'Proof input changed '+path)
const transactionPath=process.env.SCENETOWEB_RUNTIME_TRANSACTION,transactionSha256=process.env.SCENETOWEB_RUNTIME_TRANSACTION_SHA256
const shared=transactionPath||transactionSha256?await loadRuntimeTransaction({root,path:transactionPath,sha256:transactionSha256}):null
const {provenance:current}=await captureRuntimeProvenance({root,built:true,compilerInputs:!!shared,label:'Image Coordinates closed receipt'})
if(shared)assert.deepEqual(current.compilerAttestation,shared.provenance.compilerAttestation,'Fresh closing compiler closure differs from captured transaction')
const expectedNativeSources=['packages/blender-addon/tests/compositor_image_coordinates_check.py','packages/blender-addon/tests/compositor_reference.py']
for(const directory of ['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,directory)))if(name.endsWith('.py'))expectedNativeSources.push(directory+'/'+name)
expectedNativeSources.sort()
const cachePrefixes=new Set(),identities=new Map(),sources=[],runs=[];let runtimeFingerprint,caseRuns=0,words=0
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
   const guard=result.args.indexOf('--python-expr'),script=result.args.indexOf('--python');assert.ok(guard>=0&&script>guard);assert.equal(result.args[guard+1],'import sys; sys.pycache_prefix='+JSON.stringify(result.cacheDirectory)+'; sys.dont_write_bytecode=True')
   const file=await realpath(result.args[script+1]);if(file===await realpath(join(root,'packages/blender-addon/tests/compositor_image_coordinates_check.py')))capture++
   else{assert.equal(file,await realpath(join(root,'packages/blendlink/dist/blender/export_scene.py')));const source=result.args.indexOf('-b');assert.ok(source>=0);exported.push(await realpath(result.args[source+1]))}
  }
  records.push({name,sha256:hash(await readFile(path))})
 }
 assert.equal(version,1);assert.equal(capture,1);assert.deepEqual(exported.sort(),(await Promise.all(native.cases.filter(row=>row.sourceFile).map(row=>realpath(join(folder,row.sourceFile))))).sort())
 assert.deepEqual(final.nativeInvocationReceipts.map(packet=>JSON.stringify(packet)).sort(),(await Promise.all(files.map(async name=>JSON.stringify(await read(join(archive,'invocations',name)))))).sort())
 return{native:identity.native,node:identity.node,configurationSha256:identity.configuration.sha256,invocations:records,exports:exported.length,captures:1,versionProbes:1}
}
for(const device of ['CPU','GPU']){
 const folder=join(directory,device.toLowerCase()),nativePath=join(folder,'qualification.json')
 const native=assertPixelQualification(await read(nativePath));assert.equal(native.device,device)
 assert.deepEqual(Object.keys(native.sourceHashes).sort(),expectedNativeSources,'Native source closure census differs from current canonical Python imports/oracle/fixture')
 for(const[path,digest]of Object.entries(native.sourceHashes))await pin(join(root,path),digest)
 for(const row of native.cases){await pin(join(folder,row.programFile),row.programSha256);await pin(join(folder,row.pixelFile),row.pixelSha256);await pin(join(folder,row.inputFile),row.inputSha256)}
 const finalPath=join(folder,'final-proof.json'),final=assertPixelFinal(await read(finalPath),native,{built:true,nativeSha256:hash(await readFile(nativePath))})
 for(const entry of final.provenance){await pin(join(root,entry.source),entry.sha256);await pin(join(root,entry.artifact),entry.sha256)}
 const nativeLauncher=await launcherClosure(folder,final,native)
 assert.ok(final.nativeInvocationReceipts.some(receipt=>receipt.result.pythonGuardApplied))
 for(const receipt of final.nativeInvocationReceipts){assert.equal(receipt.result.error,null);assert.equal(receipt.result.exitCode,0);assert.equal(receipt.result.cacheDisposed,true);assert.equal(receipt.result.timedOut,false);assert.equal(receipt.result.aborted,false)}
 for(const row of final.rows){await pin(join(folder,row.sourceFile),row.sourceSha256);for(const key of ['manifest','glb','presentation'])await pin(row[key+'Path'],row[key+'Sha256'])}
 sources.push({device,nativeCases:native.cases.length,savedFinalScenes:final.rows.length,native:{path:relative(root,nativePath),sha256:hash(await readFile(nativePath))},final:{path:relative(root,finalPath),sha256:hash(await readFile(finalPath))},sourceHashes:native.sourceHashes,nativeLauncher})
 for(const profile of ['metal','software'])for(const phase of ['raw','final']){
  const path=join(folder,'browser-'+phase+'-'+profile,'report.json'),report=await read(path)
  assert.equal(report.status,browserProofContract.browserStatus);assert.equal(report.built,true);assert.equal(report.final,phase==='final');assert.equal(report.profile,profile);assert.equal(report.sourceDevice,device)
  assert.equal(report.provenance.nativeQualificationSha256,hash(await readFile(nativePath)));if(phase==='final')assert.equal(report.provenance.finalProofSha256,hash(await readFile(finalPath)))
  if(shared){assert.deepEqual(report.provenance.transaction,shared.transaction);assert.deepEqual(report.provenance.compilerAttestation,current.compilerAttestation)}else assert.equal(report.provenance.transaction,undefined)
  runtimeFingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:shared?shared.provenance.snapshot.directory:join(folder,'browser-'+phase+'-'+profile,'runtime'),fixtureDirectory:join(folder,'browser-'+phase+'-'+profile,'fixture'),fixtureSourceDirectory:import.meta.dirname})
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
    const original=native.cases.find(candidate=>candidate.case===result.case),resizeEligible=original.route==='rgba'||/^(scalar|integer|boolean)(-|$)/.test(original.route);assert.equal(result.width,original.width);assert.equal(result.height,original.height);assert.equal(result.pixelRatio,original.pixelRatio);assert.equal(result.resizeFrames,original.width===13&&resizeEligible?7:0)
    if(phase==='raw'&&original.width===13&&resizeEligible)assert.equal(result.extentRefused,true)
    assert.ok(result.animationFrames.length>=2);for(let i=1;i<result.animationFrames.length;i++)assert.ok(result.animationFrames[i]>result.animationFrames[i-1])
    assert.equal(result.wordMismatches,0);assert.equal(result.portOwnedTextures,0);assert.equal(result.remainingRenderTargets,0)
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
assert.equal(caseRuns,752);assert.equal(words,1071200)
assert.equal(cachePrefixes.size,34)
if(shared)await loadRuntimeTransaction({root,path:transactionPath,sha256:transactionSha256})
const result={runtimeTransaction:shared?{sha256:shared.transaction.sha256,id:shared.transaction.id,independentlyReemittedAtClose:true}:null,status:'QUALIFIED_IMAGE_COORDINATES_PIXEL_INT2',nativeGraphs:156,savedFinalScenes:32,builtCaseRuns:caseRuns,primaryFloat32Words:words,wordMismatches:0,uniqueActualPythonPrefixes:cachePrefixes.size,
 sourceProfile:'Blender5.3.0 02f0899d78e3 macOSarm64 CPU and Metal compositor image fields',
 scope:'Fresh two-component Pixel INT_VECTOR2 output; explicit RGBA, padded float3, exact scalar half-sum, integer midpoint ties toward X and Boolean either-component-nonzero edges through direct/reroute/group routes. Independent native analytic cast controls include odd-sum ties on both sides of X=Y. Direct full-frame Render Layers Image with square pixels, dimensions1..8192; pointwise consumers only. Floating coordinate scalar reduction, arbitrary offsets/transforms, borders and neighborhood operations remain unsupported.',
 resizeContract:'Same built raw graph and actual saved Final PassNode pipeline reused through seven physical resize/DPR frames per eligible route/source/profile/API/phase, including portrait and landscape. Raw control disposes its owned DataTexture GPU allocation before changing dimensions, retaining the same JavaScript Texture identity; actual pipeline uses normal RenderTarget.setSize. Mismatched physical extents refuse and recover.',
 resourceContract:'No port-owned texture or RTT. Actual GLB source-scene control warms renderer-owned DFG_LUT16x16. Three apply/dispose cycles restore its exact identity set, source materials and callbacks, and zero render targets. Raw controls dispose all owned textures. No broad performance claim.',
 closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(join(import.meta.dirname,'verify.mjs'))),runtimeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs'))),runtimeProvenanceHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-provenance.mjs')))},
 sources,runs,upstream:await read(join(import.meta.dirname,'sources.json')),rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)},productionPromotion:false}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_PIXEL_QUALIFIED '+JSON.stringify({native:156,final:32,caseRuns,words,mismatches:0}))
