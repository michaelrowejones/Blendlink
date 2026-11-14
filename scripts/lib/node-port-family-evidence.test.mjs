// Synthetic scheduling/schema tests only: retained receipts are parser fixtures,
// never a fresh native or browser run and never production qualification credit.
import assert from 'node:assert/strict'
import test from 'node:test'
import {chmod,mkdtemp,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {assertClosedFamilyReceipt,assertClosedFamilyScope,assertClosedFamilyNativeIdentity,closedFamilyReaderCommand,CLOSED_NODE_PORT_FAMILIES} from './node-port-family-evidence.mjs'
import {nodePortEvidenceAdapter,nativeFinalEvidenceHash} from './node-port-evidence.mjs'
import {readNodePortManifest,validateNodePortManifest,nodePortHash,fingerprintNodePortInputs} from './node-port-contract.mjs'
import {closedFamilySuitePlan} from '../run-node-port-family.mjs'
import {runNodePort} from '../test-node-port.mjs'
import {diffBlenderSnapshots,digest} from './blender-node-changes.mjs'
import {planUnqualifiedPorts} from '../watch-blender-nodes.mjs'

const root=resolve(import.meta.dirname,'../..'),ids=Object.keys(CLOSED_NODE_PORT_FAMILIES)
const manifests=Object.fromEntries(await Promise.all(ids.map(async id=>[id,await readNodePortManifest(join(root,'node-ports',id+'.json'))])))
const receipt=async id=>{
 // This new-family object exercises only parser/scheduling boundaries. It is
 // intentionally synthetic and never written as production evidence.
 if(id==='compositor-wave-axis'){
  const fixed=JSON.parse(await readFile(join(root,'experiments/compositor-white-noise/evidence.json'),'utf8'))
  return {...fixed,status:'QUALIFIED_PARTIAL_COMPOSITOR_WAVE_AXIS',nativeGraphs:140,nativeOracleControls:9,nativeRenders:149,savedFinalScenes:20,browserCaseRuns:640,primaryFloat32Words:10876288,uniqueActualPythonPrefixes:22,lifecycleCycles:240,resizeFrames:384,nativeZeroRgbWords:1,nativeOneRgbWords:1,
   sources:[{nativeArchive:{pythonInvocations:22,finalInvocations:20,uniqueCachePrefixes:22}}],runs:fixed.runs.map(run=>({...run,actualApis:run.actualApis.map(api=>({...api,cases:run.phase==='raw'?140:20}))}))}
 }
 if(id==='compositor-white-noise-default-field'){
  const fixed=JSON.parse(await readFile(join(root,'experiments/compositor-white-noise/evidence.json'),'utf8'))
  return {...fixed,status:'QUALIFIED_PARTIAL_COMPOSITOR_WHITE_NOISE_DEFAULT_FIELD',nativeGraphs:54,nativeOracleControls:9,nativeRenders:63,savedFinalScenes:8,browserCaseRuns:248,primaryFloat32Words:7943520,uniqueActualPythonPrefixes:10,lifecycleCycles:96,
   sources:[{nativeArchive:{pythonInvocations:10,finalInvocations:8,uniqueCachePrefixes:10}}],
   runs:fixed.runs.map(run=>({...run,actualApis:run.actualApis.map(api=>({...api,cases:run.phase==='raw'?54:8}))}))}
 }
 return JSON.parse(await readFile(join(root,id==='mono-switch-view'?'experiments/compositor-switch-view/evidence.json':'experiments/compositor-white-noise/evidence.json'),'utf8'))
}
const scope=id=>{const manifest=structuredClone(manifests[id]);return{manifest,profile:manifest.profiles[0],completedRuns:structuredClone(manifest.profiles[0].runs)}}
const browsers=(id,q)=>id==='mono-switch-view'?q.receipts[0].browsers:q.runs
const apis=(id,run)=>id==='mono-switch-view'?run.APIs:run.actualApis

for(const id of ids){
 test(id+' binds one complete matrix to its exact class/source context and calibration census',()=>{
  assertClosedFamilyScope(id,scope(id));assert.equal(nodePortEvidenceAdapter(manifests[id].evidence.adapter).nativeOwnership,'family')
  for(const mutate of [
   s=>s.manifest.nativeNode='ShaderNodeMath',s=>s.manifest.domain='shader',s=>s.manifest.id='wrong-family',
   s=>s.profile.blenderVersion='5.4.0',s=>s.profile.blenderBuildHash='a'.repeat(12),s=>s.profile.hostPlatforms=['linux'],
   s=>s.profile.nativeSource.backend='METAL',s=>s.profile.nativeSource.evaluator='CPU-MF',s=>s.profile.expectedStatus='not-applicable',
   s=>s.profile.runs.push({...s.profile.runs[0],id:'again'}),s=>s.profile.runs[0].args=['--reuse-native'],
   s=>s.completedRuns=[],s=>s.manifest.evidence.productionCases=0,s=>s.manifest.evidence.calibrationCases++,
  ]){const s=scope(id);mutate(s);assert.throws(()=>assertClosedFamilyScope(id,s))}
  for(const patch of [{nativeNode:'ShaderNodeMath'},{domain:'shader'}])assert.throws(()=>validateNodePortManifest({...structuredClone(manifests[id]),...patch}))
 })
 test(id+' rejects zero/truncated graphs, missing archives, profile spoofing and missing/duplicate APIs',async()=>{
  const q=await receipt(id);assertClosedFamilyReceipt(id,q)
  const mutations=[
   q=>q.status='qualified',q=>q.nativeGraphs=0,q=>q.savedFinalScenes--,q=>q.browserCaseRuns--,
   q=>{if(id==='mono-switch-view')q.comparedFloat32Words--;else q.primaryFloat32Words--},
   q=>{if(id==='mono-switch-view')delete q.nativePythonProof;else delete q.sources[0].nativeArchive},
   q=>browsers(id,q).pop(),q=>browsers(id,q)[1].phase='raw',
   q=>apis(id,browsers(id,q)[0]).pop(),
   q=>apis(id,browsers(id,q)[0])[1]=structuredClone(apis(id,browsers(id,q)[0])[0]),
   q=>delete apis(id,browsers(id,q)[0])[0].gpu,
   q=>apis(id,browsers(id,q)[0])[0].gpu.api='WebGL2',
   q=>apis(id,browsers(id,q)[0])[0].gpu={api:'WebGPU',vendor:'SwiftShader'},
   q=>apis(id,browsers(id,q)[2])[0].gpu={api:'WebGPU',vendor:'Apple Metal'},
  ]
  if(id==='mono-switch-view')mutations.push(q=>q.variant='static',q=>q.productionNativeGraphs=8,q=>q.productionBrowserCaseRuns=64,q=>q.receipts[0].nativeBackend.gpuInitialized=true,q=>q.nativePythonProof.finalInvocations=0)
  else mutations.push(q=>q.exactWordMismatches=1,q=>q.contractViolations=1,q=>apis(id,browsers(id,q)[0])[0].cases=0,q=>q.sources[0].nativeArchive.finalInvocations=0)
  if(id==='compositor-wave-axis')mutations.push(q=>q.nativeOracleControls=0,q=>q.nativeRenders=140,q=>q.lifecycleCycles=96,q=>q.uniqueActualPythonPrefixes=10,q=>q.resizeFrames=0,q=>q.nativeZeroRgbWords=0,q=>q.nativeOneRgbWords=0)
  if(id==='compositor-white-noise-default-field')mutations.push(q=>q.nativeOracleControls=0,q=>q.nativeRenders=54,q=>q.lifecycleCycles=0,q=>q.uniqueActualPythonPrefixes=14)
  for(const mutate of mutations){const copy=structuredClone(q);mutate(copy);assert.throws(()=>assertClosedFamilyReceipt(id,copy))}
 })
 test(id+' dry-run schedules one full existing family without a launcher, GPU or evidence writes',async t=>{
  const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-family-plan-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
  const evidence=join(tmp,'untouched'),blender=join(tmp,'not-executable');await writeFile(blender,'Never execute or hash in dry-run')
  const plan=await runNodePort({root,id,profile:'mac-53',blender,evidence,dryRun:true})
  assert.equal(plan.status,'planned');assert.equal(plan.runnable,true);assert.equal(plan.productionCredit,false);assert.equal(plan.nativeIdentity.sha256,null)
  const suites=plan.commands.filter(c=>c.id.startsWith('suite-'));assert.equal(suites.length,1);assert.equal(suites[0].id,'suite-matrix')
  assert.ok(suites[0].argv.includes('scripts/run-node-port-family.mjs'));assert.equal(suites[0].argv.includes('--reuse-native'),false)
  const owned=closedFamilySuitePlan(id,{root,evidence,blender});assert.equal(owned.env.BLENDLINK_BLENDER,blender);assert.equal(owned.env.SCENETOWEB_RUNTIME_TRANSACTION,null)
  if(id==='mono-switch-view'){assert.ok(owned.argv.includes('--mono-view'));assert.equal(owned.env.SCENETOWEB_SWITCH_VARIANT,'mono-view')}
  else assert.ok(owned.argv.includes(join(root,CLOSED_NODE_PORT_FAMILIES[id].folder,'matrix.mjs')))
  const closing=closedFamilyReaderCommand(id,{root,evidence,output:join(evidence,'closed.json'),transaction:(await receipt(id)).runtimeTransaction});assert.ok(closing.argv.includes(join(root,CLOSED_NODE_PORT_FAMILIES[id].folder,'verify.mjs')))
  await assert.rejects(readFile(join(evidence,'report.json')),{code:'ENOENT'})
 })
 test(id+' pins all declared native/Final receipts, not only the browser matrix summary',async t=>{
  const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-family-pins-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
  const adapter=nodePortEvidenceAdapter(manifests[id].evidence.adapter)
  for(const path of adapter.nativeFinalPaths){await mkdir(resolve(tmp,path,'..'),{recursive:true});await writeFile(join(tmp,path),'original')}
  const baseline=await nativeFinalEvidenceHash(adapter,tmp)
  for(const path of adapter.nativeFinalPaths){await writeFile(join(tmp,path),'changed');assert.notEqual(await nativeFinalEvidenceHash(adapter,tmp),baseline);await writeFile(join(tmp,path),'original')}
  assert.equal(await nativeFinalEvidenceHash(adapter,tmp),baseline)
 })
}

test('combined matrix scheduling cannot be borrowed by an unrelated legacy adapter',async()=>{
 const manifest=JSON.parse(await readFile(join(root,'node-ports/float-to-int.json'),'utf8'));manifest.profiles[0].runs[0].adapter='matrix'
 assert.throws(()=>validateNodePortManifest(manifest),/trusted closed family adapter/)
})

test('legacy manifests pin the new transitive registry import while retaining their own scheduling',async()=>{
 for(const id of ['float-to-int','squeeze']){
  const manifest=await readNodePortManifest(join(root,'node-ports',id+'.json'))
  assert.ok(manifest.inputs.sdk.includes('scripts/lib/node-port-family-evidence.mjs'))
  assert.equal(nodePortEvidenceAdapter(manifest.evidence.adapter).nativeOwnership,undefined)
  assert.ok(manifest.profiles.every(profile=>profile.runs.every(run=>run.adapter!=='matrix')))
 }
})

test('owned family launcher must match the outer actual raw native identity, not merely its version',()=>{
 const identity={path:'/owned/actual-blender',bytes:123,sha256:'a'.repeat(64)},native={version:[5,3,0],build:'02f0899d78e3'},archive={identity:{native:structuredClone(identity)}}
 assertClosedFamilyNativeIdentity(native,archive,identity)
 for(const mutate of [
  a=>delete a.identity,a=>a.identity.native.path='/other/blender',a=>a.identity.native.bytes++,a=>a.identity.native.sha256='b'.repeat(64),
 ]){const a=structuredClone(archive);mutate(a);assert.throws(()=>assertClosedFamilyNativeIdentity(native,a,identity))}
 assert.throws(()=>assertClosedFamilyNativeIdentity({...native,build:'a'.repeat(12)},archive,identity))
 assert.throws(()=>assertClosedFamilyNativeIdentity(native,archive,undefined))
})

test('mono closed-reader sharing requires the explicit pinned owned transaction, never automatic discovery',async()=>{
 const options={root,evidence:'/owned/transaction',output:'/owned/transaction/closed.json'},transaction=(await receipt('mono-switch-view')).runtimeTransaction
 assert.throws(()=>closedFamilyReaderCommand('mono-switch-view',options),/explicit transaction pin/)
 assert.throws(()=>closedFamilyReaderCommand('mono-switch-view',{...options,transaction:{...transaction,sha256:'bad'}}))
 const command=closedFamilyReaderCommand('mono-switch-view',{...options,transaction})
 assert.equal(command.env.SCENETOWEB_RUNTIME_TRANSACTION,'/owned/transaction/runtime-transaction/transaction.json')
 assert.equal(command.env.SCENETOWEB_RUNTIME_TRANSACTION_SHA256,transaction.sha256)
 assert.equal(closedFamilyReaderCommand('compositor-white-noise',options).env.SCENETOWEB_RUNTIME_TRANSACTION,null)
})

test('a passed matrix summary cannot bypass its independent closed reader',async t=>{
 const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-family-closed-refusal-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 // The fake reader performs no numerical work; its forced failure must prevail
 // over even an otherwise well-shaped retained compact receipt.
 const id='compositor-white-noise',proof=await receipt(id),bytes=JSON.stringify(proof),out=join(tmp,'evidence')
 await mkdir(join(tmp,'experiments/compositor-white-noise'),{recursive:true});await mkdir(out)
 await writeFile(join(tmp,'experiments/compositor-white-noise/verify.mjs'),"console.error('synthetic missing native archive'); process.exit(1)\n")
 await writeFile(join(out,'qualified.json'),bytes)
 await writeFile(join(out,'suite-matrix.json'),JSON.stringify({status:'passed',family:id,built:true,reuseNative:false,receiptSha256:nodePortHash(bytes),nativeGraphs:44,savedFinalScenes:12,browserCaseRuns:224}))
 await assert.rejects(nodePortEvidenceAdapter(manifests[id].evidence.adapter).read({root:tmp,evidence:out,...scope(id)}),/Independent family reader failed/)
 assert.match(await readFile(join(out,'adapter-closed.log'),'utf8'),/synthetic missing native archive/)
 await assert.rejects(readFile(join(out,'adapter-closed.json')),{code:'ENOENT'})
})

test('family-owned execution passes the raw native path once and never nests a guard or outer browser probe',{skip:process.platform!=='darwin'},async t=>{
 const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-family-dispatch-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 const put=async(path,bytes)=>{await mkdir(resolve(tmp,path,'..'),{recursive:true});await writeFile(join(tmp,path),bytes)}
 const manifest=structuredClone(manifests['compositor-white-noise'])
 manifest.inputs={native:['native.py'],runtime:['runtime.ts'],sdk:['package.json'],tests:['verify.mjs']};manifest.commands.build=[]
 manifest.commands.verify={id:'suite',argv:['{node}','verify.mjs','{evidence}','{blender}'],timeoutMs:10000}
 await put('node-ports/compositor-white-noise.json',JSON.stringify(manifest));await put('package.json','{"type":"module"}\n')
 await put('native.py','# fake, never executed\n');await put('runtime.ts','export const probe = 1\n')
 await put('fake-native','#!'+process.execPath+'\nconsole.log("Blender 5.3.0\\n build hash: 02f0899d78e3");\n');await chmod(join(tmp,'fake-native'),0o755)
 await put('verify.mjs',"import {writeFile} from 'node:fs/promises'; import {join} from 'node:path'; await writeFile(join(process.argv[2],'raw-native-path.txt'),process.argv[3]); process.exit(23)\n")
 const evidence=join(tmp,'transaction'),result=await runNodePort({root:tmp,id:manifest.id,profile:'mac-53',blender:join(tmp,'fake-native'),evidence})
 assert.equal(result.status,'failed');assert.equal(result.productionCredit,false);assert.equal(result.nativePythonOwnership,'family')
 assert.equal(result.nativeLauncherIdentity,null);assert.deepEqual(result.browserProbes,[])
 assert.equal(await readFile(join(evidence,'raw-native-path.txt'),'utf8'),await realpath(join(tmp,'fake-native')))
 assert.equal(result.steps.filter(r=>r.id==='suite-matrix').length,1);assert.equal(result.steps.at(-1).exitCode,23)
 assert.equal((await readdir(evidence)).includes('native-python-active'),false)
})

test('new family manifests participate in source-change selection and observation grants zero credit',()=>{
 const ports=Object.values(manifests),files=Object.fromEntries(ports.flatMap(p=>p.upstream.direct).map(path=>[path,'old']))
 const make=files=>{const s={schemaVersion:1,collectorVersion:1,kind:'blendlink-blender-node-source-snapshot-v1',watchScope:['synthetic'],sourceRevision:'a'.repeat(40),files,nodeSources:{},sourceDependencies:{},catalogIdentity:null,catalogNodes:null};return{...s,inputDigest:digest(s)}}
 const before=make(files)
 for(const port of ports){const path=port.upstream.direct[0],queue=diffBlenderSnapshots(before,make({...files,[path]:'changed'}),ports)
  const expected=ports.filter(other=>[...other.upstream.direct,...other.upstream.shared].includes(path)).map(other=>other.id).sort()
  assert.deepEqual([...queue.affectedManifestIds].sort(),expected);const plan=planUnqualifiedPorts(ports,queue,{source:{commit:'a'.repeat(40)},build:{version:'5.3.0'}})
  assert.equal(plan.productionCredit,false);assert.equal(plan.productionCases,0)
  assert.deepEqual(plan.ports.map(row=>row.id).sort(),expected)
  assert.ok(plan.ports.every(row=>row.status==='needs-fresh-qualified-verification'))
 }
})

// Compact evidence is a result of verification, never an executable input.
// Recording it must not recursively queue the same numerical transaction.
test('proof record updates do not invalidate executable inputs, but case changes do',async t=>{
 const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-proof-record-boundary-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 for(const id of ['compositor-white-noise','compositor-white-noise-default-field','compositor-wave-axis']){
  const folder=CLOSED_NODE_PORT_FAMILIES[id].folder,jsonInputs=manifests[id].inputs.tests.filter(path=>path.startsWith(folder+'/')&&path.endsWith('.json'))
  assert.ok(jsonInputs.length>0);assert.ok(jsonInputs.every(path=>!path.includes('*')))
  const dir=join(tmp,id);await mkdir(join(dir,folder),{recursive:true})
  for(const path of jsonInputs)await writeFile(join(dir,path),await readFile(join(root,path)))
  for(const path of ['native.py','runtime.ts','package.json'])await writeFile(join(dir,path),'fixed executable input')
  const manifest={...manifests[id],inputs:{native:['native.py'],runtime:['runtime.ts'],sdk:['package.json'],tests:jsonInputs}}
  const before=await fingerprintNodePortInputs(dir,manifest)
  for(const name of ['evidence.json','pilot.json','readiness.json','scaffold-readiness.json'])await writeFile(join(dir,folder,name),'new retrospective proof record')
  assert.equal((await fingerprintNodePortInputs(dir,manifest)).inputDigest,before.inputDigest)
  const cases=join(dir,folder,'cases.json');await writeFile(cases,(await readFile(cases,'utf8'))+'\n')
  assert.notEqual((await fingerprintNodePortInputs(dir,manifest)).inputDigest,before.inputDigest)
 }
})
