import assert from'node:assert/strict'
import{readFile,writeFile,readdir,realpath,stat}from'node:fs/promises'
import{join,resolve,relative,dirname,basename}from'node:path'
import{captureRuntimeProvenance,hash}from'../../scripts/lib/runtime-provenance.mjs'
import{assertBuiltRuntimeArchive}from'../../scripts/lib/runtime-proof-archive.mjs'
import{loadRuntimeTransaction}from'../../scripts/lib/runtime-transaction-snapshot.mjs'
import{nodePortPythonFileIdentity}from'../../scripts/lib/node-port-python.mjs'
import{assertGuardedNativeScript}from'../../scripts/lib/native-proof-archive.mjs'
import{browserProofContract,expectedCases,expectedFinalCases,assertQualification,assertFinal,browserRefusals,policyRefusals}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]),output=resolve(process.argv[3]??join(directory,'qualified.json'))
const read=async p=>JSON.parse(await readFile(p)),pin=async(p,sha)=>assert.equal(hash(await readFile(p)),sha,'Changed proof input '+p)
const transactionPath=process.env.SCENETOWEB_RUNTIME_TRANSACTION,transactionSha256=process.env.SCENETOWEB_RUNTIME_TRANSACTION_SHA256
const shared=transactionPath||transactionSha256?await loadRuntimeTransaction({root,path:transactionPath,sha256:transactionSha256}):null
const{provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Static Repeat closed reader',compilerInputs:!!shared})
if(shared)assert.deepEqual(current.compilerAttestation,shared.provenance.compilerAttestation)
const cachePrefixes=new Set(),identities=new Map()
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
 const files=(await readdir(join(archive,'invocations'))).sort();assert.equal(files.length,native.cases.filter(row=>row.sourceFile).length+3)
 const records=[],exported=[];let version=0,capture=0,policy=0
 for(const name of files){assert.match(name,/^[a-f0-9-]{36}\.json$/);const path=join(archive,'invocations',name),packet=await read(path),result=packet.result
  assert.equal(packet.schemaVersion,1);assert.equal(packet.kind,identity.kind);assert.equal(packet.parentGone,false);assert.equal(packet.productionCases,0);assert.equal(packet.error,undefined);assert.equal(packet.configSha256,identity.configuration.sha256);assert.deepEqual(packet.native,identity.native);assert.deepEqual(packet.node,identity.node)
  assert.equal(result.exitCode,0);assert.equal(result.signal,null);assert.equal(result.error,null);assert.equal(result.timedOut,false);assert.equal(result.aborted,false);assert.equal(result.cacheDisposed,true)
  if(result.args.length===1&&result.args[0]==='--version'){version++;assert.equal(result.pythonGuardApplied,false);assert.equal(result.cacheDirectory,null)}
  else{
   assert.equal(result.pythonGuardApplied,true);assert.equal(dirname(result.cacheDirectory),config.owned);assert.match(basename(result.cacheDirectory),/^python-cache-/);assert.ok(!cachePrefixes.has(result.cacheDirectory));cachePrefixes.add(result.cacheDirectory);await assert.rejects(stat(result.cacheDirectory),{code:'ENOENT'})
   const file=await realpath(assertGuardedNativeScript(result.args,result.cacheDirectory));if(file===await realpath(join(root,'experiments/shader-static-repeat/reference.py')))capture++
   else if(file===await realpath(join(root,'packages/blender-addon/tests/repeat_static_check.py')))policy++
   else{assert.equal(file,await realpath(join(root,'packages/blendlink/dist/blender/export_scene.py')));const source=result.args.indexOf('-b');assert.ok(source>=0);exported.push(await realpath(result.args[source+1]))}
  }
  records.push({name,sha256:hash(await readFile(path))})
 }
 assert.equal(version,1);assert.equal(capture,1);assert.equal(policy,1);assert.deepEqual(exported.sort(),(await Promise.all(native.cases.filter(row=>row.sourceFile).map(row=>realpath(join(folder,row.sourceFile))))).sort())
 assert.deepEqual(final.nativeInvocationReceipts.map(packet=>JSON.stringify(packet)).sort(),(await Promise.all(files.map(async name=>JSON.stringify(await read(join(archive,'invocations',name)))))).sort())
 return{native:identity.native,node:identity.node,configurationSha256:identity.configuration.sha256,invocations:records,exports:exported.length,captures:1,policies:1,versionProbes:1}
}

const qp=join(directory,'qualification.json'),fp=join(directory,'final-proof.json'),q=assertQualification(await read(qp)),f=assertFinal(await read(fp),q,hash(await readFile(qp)))
assert.equal(q.nativeBackend.backend,'METAL');assert.match(q.nativeBackend.renderer,/metal/i)
const expectedNativeSources=['experiments/shader-static-repeat/cases.py','experiments/shader-static-repeat/reference.py','experiments/shader-static-repeat/numeric-contract.json','packages/blender-addon/tests/repeat_static_check.py']
for(const folder of['packages/blender-addon','packages/blendlink/blender'])for(const name of await readdir(join(root,folder)))if(name.endsWith('.py'))expectedNativeSources.push(folder+'/'+name)
assert.deepEqual(Object.keys(q.sourceHashes).sort(),expectedNativeSources.sort());assert.deepEqual(q.artifactInputs.map(x=>x.source).sort(),expectedNativeSources.filter(x=>!x.startsWith('experiments/')&&!x.includes('/tests/')).sort())
for(const[path,sha]of Object.entries(q.sourceHashes))await pin(join(root,path),sha)
for(const row of q.artifactInputs){await pin(join(root,row.source),row.sha256);await pin(join(root,row.artifact),row.sha256)}
assert.deepEqual(f.provenance,q.artifactInputs)
for(const row of q.cases){for(const kind of['program','pixel'])await pin(join(directory,row[kind+'File']),row[kind+'Sha256']);if(row.sourceFile)await pin(join(directory,row.sourceFile),row.sourceSha256)}
for(const row of f.rows){const original=q.cases.find(x=>x.case===row.case);assert.equal(row.sourceSha256,original.sourceSha256);await pin(join(directory,row.sourceFile),row.sourceSha256);for(const kind of['manifest','glb','program'])await pin(row[kind+'Path'],row[kind+'Sha256'])}
const nativeLauncher=await launcherClosure(directory,f,q),runs=[];let caseRuns=0,runtimeFingerprint
const policyPath=join(directory,'policy.json'),policy=await read(policyPath)
assert.equal(policy.status,'PASSED_STATIC_REPEAT_POLICY');assert.equal(policy.productionCases,expectedCases().length-1);assert.deepEqual(policy.refusals.map(row=>row.kind).sort(),policyRefusals.slice().sort());assert.equal(policy.zeroCountFieldForwardControls,2);assert.equal(policy.unqualifiedFieldResearchCases,25);assert.equal(policy.privateNumericalCredit,0);for(const row of policy.refusals){assert.ok(typeof row.reason==='string'&&row.reason.length>0);if(row.kind.includes('field'))assert.match(row.reason,/Repeat.*literal seeds/)}
for(const profile of['metal','software'])for(const phase of['raw','final']){
 const browser=join(directory,'browser-'+phase+'-'+profile),path=join(browser,'report.json'),report=await read(path)
 assert.equal(report.status,browserProofContract.browserStatus);assert.equal(report.built,true);assert.equal(report.final,phase==='final');assert.equal(report.profile,profile);assert.equal(report.sourceContext,'shader');assert.equal(report.provenance.nativeQualificationSha256,hash(await readFile(qp)));if(phase==='final')assert.equal(report.provenance.finalProofSha256,hash(await readFile(fp)))
 runtimeFingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:shared?shared.provenance.snapshot.directory:join(browser,'runtime'),fixtureDirectory:join(browser,'fixture'),fixtureSourceDirectory:import.meta.dirname});await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
 if(shared){assert.deepEqual(report.provenance.transaction,shared.transaction);assert.deepEqual(report.provenance.compilerAttestation,current.compilerAttestation)}else assert.equal(report.provenance.transaction,undefined)
 assert.equal(report.missingAdapterControl.refused,true);assert.deepEqual(report.rows.map(r=>r.backend).sort(),['webgl2','webgpu'])
 for(const api of report.rows){
  assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
  assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.rows.map(r=>r.case),(phase==='final'?f.rows:q.cases).map(r=>r.case))
  if(phase==='raw'){assert.deepEqual(api.negatives.map(x=>x.kind).sort(),browserRefusals.slice().sort());for(const bad of api.negatives){assert.match(bad.error,/Repeat/);assert.equal(bad.remainingTextures,0)}}
  for(const row of api.rows){const original=q.cases.find(x=>x.case===row.case);assert.equal(row.wordMismatches,0);assert.equal(row.remainingTextures,0);assert.equal(row.ownershipPreserved,true);assert.equal(row.loopCount,original.iterations>0?1:0);assert.ok(row.shaderBytes>0&&row.shaderBytes<=128000);assert.match(row.shaderSha256,/^[a-f0-9]{64}$/);if(phase==='raw'&&original.iterations>0)assert.equal(row.mutationIsolated,true);if(phase==='final'){assert.equal(row.pinRejected,true);assert.equal(row.finalBindings,true)}caseRuns++}
 }
 runs.push({path:relative(root,path),sha256:hash(await readFile(path)),profile,phase,actualApis:report.rows.map(r=>({backend:r.backend,gpu:r.gpu,cases:r.rows.length})),browserVersion:report.browserVersion})
}
assert.equal(caseRuns,4*(expectedCases().length+expectedFinalCases().length));assert.equal(cachePrefixes.size,expectedFinalCases().length+2)
if(shared)await loadRuntimeTransaction({root,path:transactionPath,sha256:transactionSha256})
const result={status:'QUALIFIED_PARTIAL_STATIC_REPEAT',nativeGraphs:q.cases.length,productionNativeGraphs:q.cases.length-1,savedFinalScenes:f.rows.length,browserCaseRuns:caseRuns,comparedFloat32Words:caseRuns*256,wordMismatches:0,uniqueActualPythonPrefixes:cachePrefixes.size,
 scope:'Blender5.3.0 02f0899d78e3 EEVEE Metal shader; fixed typed counts0..64,1..4 independent FLOAT/VECTOR states, own-state copy/add/sub with bounded sixteenth-grid literal or counter steps. Bounded literal seeds only for positive counts; count0 forwards the existing qualified initial expression. UV fields including authored clamped SNAP.25 are refused without a checked phase-margin producer contract; no altered Mandelbrot source. Node-level dyadic arithmetic is exact within proven2048 bound. Independent reversible signed-byte carriers are outside the operator to preserve values through native emission/HDR storage. Direct cross-state aliases, constant overwrites, nonlinear/nested/dynamic zones, animation/drivers, unrounded UV, derivatives/textures and Cycles remain unqualified.',
 resources:'No loop-owned textures/render targets/readback; source materials and callbacks restored on actual saved Final installation/reapply. Identical serialized loop subexpressions share one actual generated shader loop, capped at8 unique loops and8192 weighted operations per channel. Bounded source traversal, runtime schema/type/cost guards, cancelled build refusal and owned immutable deferred IR snapshots are independently checked.',
 numericContract:await read(join(import.meta.dirname,'numeric-contract.json')),policy:{sha256:hash(await readFile(policyPath)),refusalControls:policy.refusals.length,fieldRefusals:policy.refusals.filter(row=>row.kind.includes('field')).length},nativeLauncher,closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(join(import.meta.dirname,'verify.mjs')))},sourceHashes:q.sourceHashes,runs,upstream:await read(join(import.meta.dirname,'sources.json')),rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)},qualificationCredit:{privateResearch:0,nativeClassCreation:0,unqualifiedMandelbrot:0}}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_STATIC_REPEAT_QUALIFIED '+JSON.stringify({native:q.cases.length,final:f.rows.length,caseRuns,words:caseRuns*256,wordMismatches:0}))
