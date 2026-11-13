// Close native signed32 oracle -> saved Final -> actual built production renderer.
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir,realpath,stat} from 'node:fs/promises'
import {resolve,join,relative,basename,dirname} from 'node:path'
import {hash,captureRuntimeProvenance} from '../../scripts/lib/runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from '../../scripts/lib/runtime-proof-archive.mjs'
import {nodePortPythonFileIdentity} from '../../scripts/lib/node-port-python.mjs'
import {assertIntegerBitsQualification,assertIntegerBitsFinal} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-integer-family53')),output=resolve(process.argv[3]??join(directory,'integer-evidence.json'))
const read=async p=>JSON.parse(await readFile(p)),pin=async(p,digest)=>assert.equal(hash(await readFile(p)),digest,'Changed proof input '+p)
const {provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Integer closed receipt'})
const expectedNativeSources=[
 ...await Promise.all(['packages/blendlink/blender','packages/blender-addon'].map(async folder=>(await readdir(join(root,folder))).filter(name=>name.endsWith('.py')).map(name=>folder+'/'+name))),
 ['packages/blender-addon/tests/compositor_integer_bits_check.py','packages/blender-addon/tests/compositor_reference.py'],
].flat().sort()
const nativeReceipts=[],receipts=[];let runs=0
const savedCases=['bit-and-0','bit-or-0','bit-xor-0','bit-not-0','bit-shift-0','bit-rotate-0','hash-int-0','hash-int-3','hash-int-20','bit-int-compare','hash-int-compare','hash-bit-chain'].sort()
const cachePrefixes=new Set(),currentIdentities=new Map()
async function currentIdentity(identity){
 assert.equal(typeof identity.path,'string');assert.ok(Number.isInteger(identity.bytes)&&identity.bytes>0);assert.match(identity.sha256,/^[a-f0-9]{64}$/)
 if(!currentIdentities.has(identity.path))currentIdentities.set(identity.path,nodePortPythonFileIdentity(identity.path))
 assert.deepEqual(await currentIdentities.get(identity.path),identity,'Current executable identity changed')
}
async function guardedResult(result,owned){
 assert.equal(result.exitCode,0);assert.equal(result.signal,null);assert.equal(result.error,null);assert.equal(result.timedOut,false);assert.equal(result.aborted,false);assert.equal(result.cacheDisposed,true)
 assert.equal(result.pythonGuardApplied,true);assert.ok(Array.isArray(result.args));assert.equal(typeof result.cacheDirectory,'string')
 assert.equal(dirname(result.cacheDirectory),owned);assert.match(basename(result.cacheDirectory),/^python-cache-/)
 assert.ok(!cachePrefixes.has(result.cacheDirectory),'Repeated actual Python cache prefix');cachePrefixes.add(result.cacheDirectory)
 const guard=result.args.indexOf('--python-expr'),script=result.args.indexOf('--python')
 assert.ok(guard>=0&&script>guard,'Fresh Python prefix must precede exporter execution')
 assert.equal(result.args[guard+1],'import sys; sys.pycache_prefix='+JSON.stringify(result.cacheDirectory)+'; sys.dont_write_bytecode=True')
 await assert.rejects(stat(result.cacheDirectory),{code:'ENOENT'},'Actual Python cache must be disposed')
 return script
}
async function assertFinalLauncher(folder,final,native){
 const archive=join(folder,'final-native-launcher'),identity=final.nativeLauncher
 assert.equal(identity.kind,'blendlink-proof-native-python-v1');assert.equal(identity.platform,'darwin');assert.deepEqual(identity.native,native)
 await currentIdentity(identity.native);await currentIdentity(identity.node)
 const paths={launcher:'blender-proof',configuration:'launcher.json',helper:'lib/node-port-python.mjs',bridge:'node-port-blender.mjs'}
 for(const[key,path]of Object.entries(paths)){const bytes=await readFile(join(archive,path));assert.equal(bytes.length,identity[key].bytes);assert.equal(hash(bytes),identity[key].sha256)}
 for(const[key,path]of [['helper','scripts/lib/node-port-python.mjs'],['bridge','scripts/node-port-blender.mjs']])assert.equal(hash(await readFile(join(root,path))),identity[key].sha256,'Current launcher helper changed')
 const config=await read(join(archive,'launcher.json'));assert.equal(config.schemaVersion,1);assert.equal(config.kind,identity.kind);assert.deepEqual(config.native,identity.native);assert.deepEqual(config.node,identity.node);assert.deepEqual(config.helper,identity.helper);assert.deepEqual(config.bridge,identity.bridge)
 assert.equal(dirname(config.owned),await realpath(join(folder,'final-python')));assert.match(basename(config.owned),/^native-launcher-/);assert.equal(identity.configuration.path,join(config.owned,'launcher.json'));assert.equal(identity.launcher.path,join(config.owned,'blender-proof'));assert.equal(identity.helper.path,join(config.owned,'lib/node-port-python.mjs'));assert.equal(identity.bridge.path,join(config.owned,'node-port-blender.mjs'))
 assert.deepEqual((await readdir(archive)).sort(),['blender-proof','invocations','launcher.json','lib','node-port-blender.mjs'].sort());assert.deepEqual(await readdir(join(archive,'lib')),['node-port-python.mjs'])
 const names=(await readdir(join(archive,'invocations'))).sort();assert.equal(names.length,savedCases.length+1,'Exactly12 saved-source exports and1version probe required')
 const seenSources=[],records=[];let versions=0
 for(const name of names){assert.match(name,/^[a-f0-9-]{36}\.json$/);const path=join(archive,'invocations',name),packet=await read(path),result=packet.result
  assert.equal(packet.schemaVersion,1);assert.equal(packet.kind,identity.kind);assert.equal(packet.productionCases,0);assert.equal(packet.parentGone,false);assert.equal(packet.error,undefined);assert.deepEqual(packet.native,identity.native);assert.deepEqual(packet.node,identity.node);assert.equal(packet.configSha256,identity.configuration.sha256)
  if(result.args.length===1&&result.args[0]==='--version'){versions++;assert.equal(result.exitCode,0);assert.equal(result.pythonGuardApplied,false);assert.equal(result.cacheDirectory,null);assert.equal(result.cacheDisposed,true);assert.equal(result.timedOut,false);assert.equal(result.aborted,false);assert.equal(result.error,null);assert.equal(result.signal,null)}
  else{const script=await guardedResult(result,config.owned);assert.equal(await realpath(result.args[script+1]),await realpath(join(root,'packages/blendlink/dist/blender/export_scene.py')));const source=result.args.indexOf('-b');assert.ok(source>=0);seenSources.push(await realpath(result.args[source+1]))}
  records.push({name,sha256:hash(await readFile(path))})
 }
 assert.equal(versions,1);assert.deepEqual(seenSources.sort(),(await Promise.all(savedCases.map(name=>realpath(join(folder,name+'.blend'))))).sort())
 return{configurationSha256:identity.configuration.sha256,invocations:records,savedSourceCensus:savedCases,uniqueCachePrefixes:savedCases.length}
}
const perNode={FunctionNodeBitMath:{nativeGraphs:0,savedFinalScenes:0,browserCaseRuns:0},FunctionNodeHashValue:{nativeGraphs:0,savedFinalScenes:0,browserCaseRuns:0}},controls={nativeGraphs:0,browserCaseRuns:0}
const types=program=>Object.keys(perNode).filter(type=>program.ops.some(op=>op.source.nodeType===type))
for(const device of ['CPU','GPU']){
 const folder=join(directory,device.toLowerCase()),nativePath=join(folder,'qualification.json'),native=assertIntegerBitsQualification(await read(nativePath));assert.equal(native.device,device)
 const invocation=await read(join(folder,'native-invocation.json'));await currentIdentity(invocation.native);const nativeScript=await guardedResult(invocation.result,await realpath(join(folder,'fresh-python')));assert.equal(await realpath(invocation.result.args[nativeScript+1]),await realpath(join(root,'packages/blender-addon/tests/compositor_integer_bits_check.py')));assert.deepEqual(native.cases.filter(row=>row.sourceFile).map(row=>row.case).sort(),savedCases)
 assert.deepEqual(Object.keys(native.sourceHashes).sort(),expectedNativeSources,'Native source/helper/oracle census must match current independent tree');for(const[path,digest]of Object.entries(native.sourceHashes))await pin(join(root,path),digest)
 const nodeKinds=new Map()
 for(const row of native.cases){assert.equal(row.programFile,row.case+'.program.json');assert.equal(row.pixelFile,row.case+'.rgba32f');if(row.sourceFile)assert.equal(row.sourceFile,row.case+'.blend');const program=await read(join(folder,row.programFile)),kinds=types(program);nodeKinds.set(row.case,kinds);if(row.control){assert.deepEqual(kinds,[]);controls.nativeGraphs++}else{assert.ok(kinds.length>0);for(const kind of kinds)perNode[kind].nativeGraphs++}
  for(const key of ['pixel','program'])await pin(join(folder,row[key+'File']),row[key+'Sha256']);if(row.sourceFile)await pin(join(folder,row.sourceFile),row.sourceSha256)
 }
 const finalPath=join(folder,'final-proof.json'),final=assertIntegerBitsFinal(await read(finalPath),native);assert.equal(final.nativeQualificationSha256,hash(await readFile(nativePath)))
 for(const entry of final.provenance){await pin(join(root,entry.source),entry.sha256);await pin(join(root,entry.artifact),entry.sha256)}
 for(const row of final.rows){for(const kind of nodeKinds.get(row.case))perNode[kind].savedFinalScenes++;for(const key of ['manifest','glb','presentation'])await pin(row[key+'Path'],row[key+'Sha256'])}
 const launcherClosure=await assertFinalLauncher(folder,final,invocation.native)
 nativeReceipts.push({device,graphs:native.cases.length,savedFinalScenes:final.rows.length,qualificationSha256:hash(await readFile(nativePath)),finalSha256:hash(await readFile(finalPath)),native:invocation.native,sourceHashes:native.sourceHashes,nativeElapsedMs:invocation.result.elapsedMs,launcherClosure})
 for(const profile of ['metal','software'])for(const phase of ['raw','final']){
  const path=join(folder,'browser-'+phase+'-'+profile,'report.json'),report=await read(path)
  assert.equal(report.status,'PASSED_INTEGER_BITS_BUILT_PROOF');assert.equal(report.built,true);assert.equal(report.final,phase==='final');assert.equal(report.profile,profile);assert.equal(report.sourceDevice,device)
  assert.equal(report.provenance.nativeQualificationSha256,hash(await readFile(nativePath)));if(phase==='final')assert.equal(report.provenance.finalProofSha256,hash(await readFile(finalPath)))
  const runtimeFingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(folder,'browser-'+phase+'-'+profile,'runtime'),fixtureDirectory:join(folder,'browser-'+phase+'-'+profile,'fixture'),fixtureSourceDirectory:import.meta.dirname,fixtureNames:['browser.js','index.html']})
  await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
  assert.equal(report.missingAdapterControl.refused,true);assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu'])
  const expected=(phase==='final'?final.rows:native.cases).map(row=>row.case).sort()
  for(const row of report.rows){assert.equal(row.gpu.api,row.backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(row.errors,[]);assert.deepEqual(row.pageErrors,[]);assert.deepEqual(row.rows.map(x=>x.case).sort(),expected);assert.equal(row.negatives.length,7);assert.ok(row.integerShaderCompiles>0);assert.equal(row.integerFloatBitcasts,0)
   if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}else assert.match(JSON.stringify(row.gpu),/swiftshader/i)
   for(const result of row.rows){const kinds=nodeKinds.get(result.case);if(!kinds.length)controls.browserCaseRuns++;for(const kind of kinds)perNode[kind].browserCaseRuns++
    assert.equal(result.wordMismatches,0);assert.equal(result.portOwnedTextures,0);assert.equal(result.remainingRenderTargets,0)
    if(phase==='final'){assert.equal(result.pinRejected,true);assert.ok(result.meshCount>0);assert.equal(result.sourceMaterialsPreserved,true);assert.equal(result.baselineCacheRestored,true);assert.equal(result.lifecycleCycles,3);assert.equal(result.remainingTextures,result.baselineCache.length);assert.equal(result.baselineCache.length,1);assert.equal(result.baselineCache[0].name,'DFG_LUT')}
   }
   for(const refusal of row.negatives){assert.match(refusal.error,/Integer Bits/);assert.equal(refusal.remainingTextures,0)}runs+=row.rows.length
  }
  receipts.push({path:relative(root,path),sha256:hash(await readFile(path)),device,profile,phase,runtimeFingerprint,browserVersion:report.browserVersion,apis:report.rows.map(row=>({backend:row.backend,gpu:row.gpu,cases:row.rows.length}))})
 }
}
assert.equal(runs,2472);assert.equal(cachePrefixes.size,26,'Exactly26uniqueactualPythonprefixes required across2captures+24Finalexports')
const inputs=['packages/blendlink/blender/compositor_integer_bits.py','packages/blendlink/blender/compositor_graph.py','packages/blendlink/src/tslCompositorIntegerBits.ts','packages/blendlink/src/tslNodeRecipe.ts','packages/blendlink/src/tslSourceCompositor.ts','packages/blender-addon/tests/compositor_integer_bits_check.py','experiments/compositor-integer-bits/protocol.mjs','experiments/compositor-integer-bits/run.mjs','experiments/compositor-integer-bits/browser.js','experiments/compositor-integer-bits/export.test.ts','experiments/compositor-integer-bits/verify.mjs','scripts/lib/runtime-proof-archive.mjs','scripts/lib/runtime-provenance.mjs','scripts/lib/node-port-python.mjs','scripts/node-port-blender.mjs']
const result={status:'QUALIFIED_PARTIAL_COMPOSITOR_INTEGER_BITS',nativeGraphs:594,savedFinalScenes:24,browserCaseRuns:runs,primaryFloat32Words:runs*256,wordMismatches:0,uniqueActualPythonPrefixes:cachePrefixes.size,perNode,controls,nativeReceipts,receipts,
 scope:'Blender5.3.0 build02f0899d78e3 macOSarm64 compositor typed full signed32 literal/InputInt/group/reroute and bounded own-family chains. All6BitMath modes; INT HashValue only. General fields and implicit conversions refused. Native GPU-authored single values evaluate on CPU multi-function stage; native GPU spatial kernels have no numerical credit.',
 transport:'RawF32 [low16,byte2,byte3,1] integers use independent IntegerMath DIVIDE_FLOOR/FLOORED_MODULO and preserve all32bits exactly. Twelve standalone signed-extrema/mask calibration controls plus independent exact INT Compare consumers; Python signed32/Jenkins expectations assert every native pixel before browser capture.',
 resources:'Laidout integer shader functions; bounded branch counts; no portownedtextures/RTTs/perframeGPUreadbacks. Actual savedGLTF no-compositor DFG_LUT exactidentitybaseline restored through3productionpipelineapply/disposecycles.',
 rawArtifacts:{machineLocal:true,ignored:true,directory:relative(root,directory)},verifiedInputs:Object.fromEntries(await Promise.all(inputs.map(async path=>[path,hash(await readFile(join(root,path)))]))),upstream:JSON.parse(await readFile(join(import.meta.dirname,'sources.json')))}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_INTEGER_BITS_QUALIFIED '+JSON.stringify({nativeGraphs:594,savedFinalScenes:24,browserCaseRuns:runs,wordMismatches:0}))
