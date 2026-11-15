// Synthetic scheduling/schema tests only: retained receipts are parser fixtures,
// never a fresh native or browser run and never production qualification credit.
import assert from 'node:assert/strict'
import test from 'node:test'
import{readFileSync as readFileSyncLocal}from'node:fs'
import {chmod,mkdtemp,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {assertClosedFamilyReceipt,assertClosedFamilyScope,assertClosedFamilyNativeIdentity,closedFamilyReaderCommand,CLOSED_NODE_PORT_FAMILIES,assertFinitePayloadCostReports} from './node-port-family-evidence.mjs'
import {nodePortEvidenceAdapter,nativeFinalEvidenceHash} from './node-port-evidence.mjs'
import {readNodePortManifest,validateNodePortManifest,nodePortHash,fingerprintNodePortInputs} from './node-port-contract.mjs'
import {closedFamilySuitePlan} from '../run-node-port-family.mjs'
import {runNodePort} from '../test-node-port.mjs'
import {diffBlenderSnapshots,digest} from './blender-node-changes.mjs'
import {planUnqualifiedPorts} from '../watch-blender-nodes.mjs'

const root=resolve(import.meta.dirname,'../..'),ids=Object.keys(CLOSED_NODE_PORT_FAMILIES)
const manifests=Object.fromEntries(await Promise.all(ids.map(async id=>[id,await readNodePortManifest(join(root,'node-ports',id+'.json'))])))
const receipt=async id=>{
 if(id==='compositor-finite-image-info'){const fixture=await receipt('compositor-integer-vector3');return{...fixture,status:'qualified-finite-image-info-slice',variant:'finite-image-info',nativeGraphs:21,productionNativeGraphs:20,browserCaseRuns:116,productionBrowserCaseRuns:108,comparedFloat32Words:29696,productionComparedWords:27648,archivedGpuPrimaryWords:29696,archivedGpuReadbackWords:67584,receipts:fixture.receipts.map(r=>({...r,nativeGraphs:21,productionNativeGraphs:20,browsers:r.browsers.map(b=>({...b,caseRuns:b.phase==='raw'?42:16}))}))}}
 if(id==='compositor-integer-vector3'){
  const fixture=await receipt('mono-switch-view');return{...fixture,status:'qualified-integer-vector3-slice',variant:'integer-vector3',nativeGraphs:16,productionNativeGraphs:15,browserCaseRuns:96,productionBrowserCaseRuns:88,comparedFloat32Words:24576,productionComparedWords:22528,archivedGpuPrimaryWords:24576,archivedGpuReadbackWords:57344,independentlyRecomputedGpuWordDifferences:0,receipts:fixture.receipts.map(r=>({...r,nativeGraphs:16,productionNativeGraphs:15,browsers:r.browsers.map(b=>({...b,caseRuns:b.phase==='raw'?32:16}))}))}
 }
 if(id==='compositor-input-rotation'){
  const fixed=JSON.parse(await readFile(join(root,'experiments/compositor-white-noise/evidence.json'),'utf8'))
  return {...fixed,status:'QUALIFIED_PARTIAL_COMPOSITOR_INPUT_ROTATION',variant:'input-rotation',nativeGraphs:48,nativeOracleControls:104,nativeRenders:152,savedFinalScenes:8,browserCaseRuns:224,primaryFloat32Words:14336,uniqueActualPythonPrefixes:10,lifecycleCycles:96,resizeFrames:48,sourceInputAdmissionControls:34,sourceRegressionControls:2,sourceOutputGuardRefusals:8,policy:{refusals:Array(44).fill('synthetic')},archivedGpuPrimaryWords:14336,archivedGpuWords:37824,archivedGpuFrames:560,independentlyRecomputedGpuWordDifferences:0,
   sources:[{nativeArchive:{pythonInvocations:10,finalInvocations:8,uniqueCachePrefixes:10}}],runs:fixed.runs.map(run=>({...run,actualApis:run.actualApis.map(api=>({...api,cases:run.phase==='raw'?48:8}))}))}
 }
 if(id==='compositor-vector-rotate-unit-axis'){const q=await receipt('compositor-vector-rotate');return{...q,status:'QUALIFIED_PARTIAL_COMPOSITOR_VECTOR_ROTATE_UNIT_AXIS',variant:'unit-axis',nativeGraphs:35,nativeRenders:110,browserCaseRuns:180,primaryFloat32Words:1134688,runs:q.runs.map(run=>({...run,actualApis:run.actualApis.map(api=>({...api,cases:run.phase==='raw'?35:10}))}))}}
 if(id==='compositor-vector-rotate'){
  const fixed=JSON.parse(await readFile(join(root,'experiments/compositor-white-noise/evidence.json'),'utf8'))
  const fixture={...fixed,status:'QUALIFIED_PARTIAL_COMPOSITOR_VECTOR_ROTATE',nativeGraphs:25,nativeOracleControls:5,nativeRenders:80,savedFinalScenes:10,browserCaseRuns:140,primaryFloat32Words:2166416,uniqueActualPythonPrefixes:13,lifecycleCycles:120,resizeFrames:16,
   sources:[{nativeArchive:{pythonInvocations:13,finalInvocations:10,uniqueCachePrefixes:13}}],runs:fixed.runs.map(run=>({...run,actualApis:run.actualApis.map(api=>({...api,cases:run.phase==='raw'?25:10}))}))}
  delete fixture.contractViolations;return fixture
 }

 if(id==='compositor-blank-image'){
  const fixed=JSON.parse(await readFile(join(root,'experiments/compositor-white-noise/evidence.json'),'utf8'))
  const fixture={...fixed,status:'QUALIFIED_PARTIAL_COMPOSITOR_BLANK_IMAGE',nativeGraphs:26,nativeRenders:26,savedFinalScenes:8,browserCaseRuns:136,primaryFloat32Words:1153408,uniqueActualPythonPrefixes:10,lifecycleCycles:96,resizeFrames:272,
   sources:[{nativeArchive:{pythonInvocations:10,finalInvocations:8,uniqueCachePrefixes:10}}],runs:fixed.runs.map(run=>({...run,actualApis:run.actualApis.map(api=>({...api,cases:run.phase==='raw'?26:8}))}))}
  delete fixture.contractViolations;return fixture
 }
 // This new-family object exercises only parser/scheduling boundaries. It is
 // intentionally synthetic and never written as production evidence.
 if(id==='compositor-noise-default-field'){
  const fixed=JSON.parse(await readFile(join(root,'experiments/compositor-white-noise/evidence.json'),'utf8'))
  const fixture={...fixed,status:'QUALIFIED_PARTIAL_COMPOSITOR_NOISE_DEFAULT_FIELD',nativeGraphs:26,nativeOracleControls:15,nativeRenders:41,savedFinalScenes:8,browserCaseRuns:136,primaryFloat32Words:12919456,uniqueActualPythonPrefixes:10,lifecycleCycles:96,resizeFrames:352,wordDifferences:100,maxUlps:8,maxAbsoluteError:2**-23,precision:{absoluteMax:2**-20,ulpsMax:8},sources:[{nativeArchive:{pythonInvocations:10,finalInvocations:8,uniqueCachePrefixes:10}}],runs:fixed.runs.map(run=>({...run,actualApis:run.actualApis.map(api=>({...api,cases:run.phase==='raw'?26:8}))}))}
  delete fixture.exactWordMismatches;return fixture
 }
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
const selection=id=>CLOSED_NODE_PORT_FAMILIES[id].folder==='experiments/static-switch-family'
const browsers=(id,q)=>selection(id)?q.receipts[0].browsers:q.runs
const apis=(id,run)=>selection(id)?run.APIs:run.actualApis

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
   q=>{if(selection(id))q.comparedFloat32Words--;else q.primaryFloat32Words--},
   q=>{if(selection(id))delete q.nativePythonProof;else delete q.sources[0].nativeArchive},
   q=>browsers(id,q).pop(),q=>browsers(id,q)[1].phase='raw',
   q=>apis(id,browsers(id,q)[0]).pop(),
   q=>apis(id,browsers(id,q)[0])[1]=structuredClone(apis(id,browsers(id,q)[0])[0]),
   q=>delete apis(id,browsers(id,q)[0])[0].gpu,
   q=>apis(id,browsers(id,q)[0])[0].gpu.api='WebGL2',
   q=>apis(id,browsers(id,q)[0])[0].gpu={api:'WebGPU',vendor:'SwiftShader'},
   q=>apis(id,browsers(id,q)[2])[0].gpu={api:'WebGPU',vendor:'Apple Metal'},
  ]
  if(selection(id))mutations.push(q=>q.variant='static',q=>q.productionNativeGraphs++,q=>q.productionBrowserCaseRuns++,q=>q.receipts[0].nativeBackend.gpuInitialized=true,q=>q.nativePythonProof.finalInvocations=0)
  else mutations.push(...(id==='compositor-noise-default-field'?[q=>q.exactWordMismatches=0,q=>q.wordDifferences=-1,q=>q.wordDifferences=12919457,q=>q.maxUlps=9,q=>q.maxAbsoluteError=2**-19,q=>q.precision.ulpsMax=9,q=>q.nativeOracleControls=14,q=>q.resizeFrames=0]:[q=>q.exactWordMismatches=1]),q=>q.contractViolations=1,q=>apis(id,browsers(id,q)[0])[0].cases=0,q=>q.sources[0].nativeArchive.finalInvocations=0)
  if(['compositor-integer-vector3','compositor-finite-image-info'].includes(id))mutations.push(q=>q.variant='mono-view',q=>q.productionComparedWords=CLOSED_NODE_PORT_FAMILIES[id].words,q=>q.archivedGpuPrimaryWords=0,q=>q.archivedGpuReadbackWords=24576,q=>q.independentlyRecomputedGpuWordDifferences=1,q=>q.receipts[0].browsers[0].caseRuns=16)
  if(id==='compositor-wave-axis')mutations.push(q=>q.nativeOracleControls=0,q=>q.nativeRenders=140,q=>q.lifecycleCycles=96,q=>q.uniqueActualPythonPrefixes=10,q=>q.resizeFrames=0,q=>q.nativeZeroRgbWords=0,q=>q.nativeOneRgbWords=0)
  if(id==='compositor-white-noise-default-field')mutations.push(q=>q.nativeOracleControls=0,q=>q.nativeRenders=54,q=>q.lifecycleCycles=0,q=>q.uniqueActualPythonPrefixes=14)
  if(id==='compositor-vector-rotate-unit-axis')mutations.push(q=>q.variant='fixed-axis',q=>q.nativeRenders=80,q=>q.primaryFloat32Words=2166416,q=>q.status='QUALIFIED_PARTIAL_COMPOSITOR_VECTOR_ROTATE')
  if(id==='compositor-input-rotation')mutations.push(q=>q.variant='euler',q=>q.nativeOracleControls=0,q=>q.nativeRenders=48,q=>q.archivedGpuWords=0,q=>q.archivedGpuFrames=0,q=>q.independentlyRecomputedGpuWordDifferences=1,q=>q.sourceInputAdmissionControls=36,q=>q.sourceRegressionControls=0,q=>q.sourceOutputGuardRefusals=0)
  if(id==='compositor-blank-image')mutations.push(q=>q.nativeRenders=0,q=>q.lifecycleCycles=0,q=>q.resizeFrames=0,q=>q.uniqueActualPythonPrefixes=0)
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
  if(selection(id)){const variant=CLOSED_NODE_PORT_FAMILIES[id].variant;assert.ok(owned.argv.includes('--'+variant));assert.equal(owned.env.SCENETOWEB_SWITCH_VARIANT,variant)}
  else assert.ok(owned.argv.includes(join(root,CLOSED_NODE_PORT_FAMILIES[id].folder,'matrix.mjs')))
  const closing=closedFamilyReaderCommand(id,{root,evidence,output:join(evidence,'closed.json'),transaction:(await receipt(id)).runtimeTransaction});if(id==='compositor-input-rotation'){assert.equal(owned.env.SCENETOWEB_STATIC_EULER_VARIANT,'input-rotation');assert.equal(closing.env.SCENETOWEB_STATIC_EULER_VARIANT,'input-rotation')}if(id==='compositor-vector-rotate-unit-axis'){assert.equal(owned.env.SCENETOWEB_VECTOR_ROTATE_VARIANT,'unit-axis');assert.equal(closing.env.SCENETOWEB_VECTOR_ROTATE_VARIANT,'unit-axis');assert.equal(owned.env.SCENETOWEB_SWITCH_VARIANT,'static');assert.equal(owned.argv.includes('--unit-axis'),false)}else{assert.equal(owned.env.SCENETOWEB_VECTOR_ROTATE_VARIANT,null);assert.equal(closing.env.SCENETOWEB_VECTOR_ROTATE_VARIANT,null)}assert.ok(closing.argv.includes(join(root,CLOSED_NODE_PORT_FAMILIES[id].folder,'verify.mjs')))
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
 for(const id of ['compositor-blank-image','compositor-noise-default-field','compositor-white-noise','compositor-white-noise-default-field','compositor-wave-axis']){
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

test('bounded Noise adapter preserves measured word differences without advertising exact equality',async t=>{
 const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-noise-adapter-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 const id='compositor-noise-default-field',proof=await receipt(id),out=join(tmp,'evidence'),folder=join(tmp,CLOSED_NODE_PORT_FAMILIES[id].folder)
 await mkdir(folder,{recursive:true});await mkdir(join(out,'cpu'),{recursive:true})
 const identity={path:'/synthetic/never-executed-blender',bytes:123,sha256:'c'.repeat(64)}
 const bytes=JSON.stringify(proof)
 // Fake reader/scene bytes exercise adapter transport only; no numerical work,
 // Blender execution, browser run or production receipt is claimed here.
 await writeFile(join(folder,'verify.mjs'),"import {writeFile} from 'node:fs/promises';await writeFile(process.argv[3],"+JSON.stringify(bytes)+")")
 await writeFile(join(out,'qualified.json'),bytes)
 await writeFile(join(out,'suite-matrix.json'),JSON.stringify({status:'passed',family:id,built:true,reuseNative:false,receiptSha256:nodePortHash(bytes),nativeGraphs:26,savedFinalScenes:8,browserCaseRuns:136}))
 const cases=Array.from({length:8},(_,i)=>({sourceFile:'source'+i+'.blend'}))
 for(const row of cases)await writeFile(join(out,'cpu',row.sourceFile),'synthetic source; never opened')
 await writeFile(join(out,'cpu/qualification.json'),JSON.stringify({version:[5,3,0],build:'02f0899d78e3',cases}))
 await writeFile(join(out,'cpu/final-proof.json'),JSON.stringify({nativeArchive:{identity:{native:identity}}}))
 const result=await nodePortEvidenceAdapter('compositor-noise-default-field-v1').read({root:tmp,evidence:out,...scope(id),nativeIdentity:identity})
 assert.equal(result.wordDifferences,100);assert.equal(result.wordMismatches,undefined)
 assert.equal(result.contractViolations,0);assert.deepEqual(result.precision,{absoluteMax:2**-20,ulpsMax:8})
 assert.equal(result.maxUlps,8);assert.equal(result.maxAbsoluteError,2**-23)
})

test('Integer Vector3 bridge preserves calibration, checks original native identity and requires a second explicit variant reader',async t=>{
 const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-int3-adapter-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 const id='compositor-integer-vector3',proof=await receipt(id),out=join(tmp,'evidence'),folder=join(tmp,'experiments/static-switch-family')
 await mkdir(folder,{recursive:true});await mkdir(join(out,'cpu'),{recursive:true});await mkdir(join(out,'runtime-transaction'))
 const identity={path:'/synthetic/never-executed-blender',bytes:123,sha256:'c'.repeat(64)},transaction='synthetic transaction; no runtime emitted'
 proof.runtimeTransaction.sha256=nodePortHash(transaction);await writeFile(join(out,'runtime-transaction/transaction.json'),transaction)
 const bytes=JSON.stringify(proof)
 // This reader is deliberately synthetic: only adapter transport/identity and
 // explicit ownership are tested. It performs no native, GPU or numerical work.
 await writeFile(join(folder,'verify.mjs'),"import assert from 'node:assert/strict';import{readFile,writeFile,appendFile}from'node:fs/promises';import{createHash}from'node:crypto';assert.equal(process.env.SCENETOWEB_SWITCH_VARIANT,'integer-vector3');const actual=createHash('sha256').update(await readFile(process.env.SCENETOWEB_RUNTIME_TRANSACTION)).digest('hex');assert.equal(actual,process.env.SCENETOWEB_RUNTIME_TRANSACTION_SHA256);await appendFile(process.env.SCENETOWEB_SWITCH_EVIDENCE+'/reader-calls.txt','synthetic second reader\\n');await writeFile(process.argv[2],"+JSON.stringify(bytes)+");")
 await writeFile(join(out,'closed-receipt.json'),bytes)
 await writeFile(join(out,'suite-matrix.json'),JSON.stringify({status:'passed',family:id,built:true,reuseNative:false,receiptSha256:nodePortHash(bytes),nativeGraphs:16,savedFinalScenes:8,browserCaseRuns:96}))
 const cases=Array.from({length:8},(_,i)=>({sourceFile:'source'+i+'.blend'}))
 for(const row of cases)await writeFile(join(out,'cpu',row.sourceFile),'synthetic scene; never opened')
 await writeFile(join(out,'cpu/qualification.json'),JSON.stringify({version:[5,3,0],build:'02f0899d78e3',cases}))
 await writeFile(join(out,'native-python-proof.json'),JSON.stringify({identity:{native:identity}}))
 const adapter=nodePortEvidenceAdapter('compositor-integer-vector3-v1'),args={root:tmp,evidence:out,...scope(id),nativeIdentity:identity}
 const result=await adapter.read(args)
 assert.equal(await readFile(join(out,'reader-calls.txt'),'utf8'),'synthetic second reader\n')
 assert.equal(result.nativeGraphs,16);assert.equal(result.productionNativeGraphs,15);assert.equal(result.savedFinalScenes,8);assert.equal(result.productionSavedFinalScenes,7)
 assert.equal(result.caseRuns,96);assert.equal(result.productionCaseRuns,88);assert.equal(result.calibrationCaseRuns,8)
 assert.equal(result.primaryFloat32Words,24576);assert.equal(result.productionFloat32Words,22528);assert.equal(result.calibrationComparedWords,2048)
 assert.equal(result.archivedGpuReadbackWords,57344);assert.equal(result.independentlyRecomputedGpuWordDifferences,0);assert.equal(result.finalSources.length,8)
 // The closed receipt contains counts, not the raw launcher's identity. Read
 // and compare the original packet even when the second reader returns PASS.
 await writeFile(join(out,'native-python-proof.json'),JSON.stringify({identity:{native:{...identity,sha256:'b'.repeat(64)}}}))
 await assert.rejects(adapter.read(args),/Actual native identity differs/)
 await rm(join(out,'native-python-proof.json'));await assert.rejects(adapter.read(args),{code:'ENOENT'})
 const options={root:tmp,evidence:out,output:join(out,'second.json')}
 assert.throws(()=>closedFamilyReaderCommand(id,options),/explicit transaction pin/)
 assert.throws(()=>closedFamilyReaderCommand(id,{...options,transaction:{...proof.runtimeTransaction,sha256:'bad'}}))
})

test('Integer Vector3 source watcher covers every declared type/schema/conversion dependency without promoting support',()=>{
 const manifest=manifests['compositor-integer-vector3'],paths=[...manifest.upstream.direct,...manifest.upstream.shared],files=Object.fromEntries(paths.map(path=>[path,'old']))
 const snapshot=files=>{const s={schemaVersion:1,collectorVersion:1,kind:'blendlink-blender-node-source-snapshot-v1',watchScope:['synthetic'],sourceRevision:'a'.repeat(40),files,nodeSources:{},sourceDependencies:{},catalogIdentity:null,catalogNodes:null};return{...s,inputDigest:digest(s)}}
 for(const path of paths){const queue=diffBlenderSnapshots(snapshot(files),snapshot({...files,[path]:'changed'}),[manifest]);assert.deepEqual(queue.affectedManifestIds,[manifest.id]);const plan=planUnqualifiedPorts([manifest],queue,{source:{commit:'a'.repeat(40)},build:{version:'5.3.0'}});assert.equal(plan.productionCredit,false);assert.equal(plan.productionCases,0);assert.equal(plan.ports[0].status,'needs-fresh-qualified-verification')}
})

test('Integer Vector3 retained evidence is excluded from executable inputs while its exact case plan remains pinned',async t=>{
 const tmp=await mkdtemp(join(tmpdir(),'scenetoweb-int3-proof-record-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 const id='compositor-integer-vector3',jsonInputs=manifests[id].inputs.tests.filter(path=>path.endsWith('.json'))
 assert.ok(jsonInputs.length>0);assert.ok(jsonInputs.every(path=>!path.includes('*')))
 for(const path of jsonInputs){await mkdir(resolve(tmp,path,'..'),{recursive:true});await writeFile(join(tmp,path),await readFile(join(root,path)))}
 for(const path of ['native.py','runtime.ts','package.json'])await writeFile(join(tmp,path),'fixed synthetic input')
 const manifest={...manifests[id],inputs:{native:['native.py'],runtime:['runtime.ts'],sdk:['package.json'],tests:jsonInputs}},before=await fingerprintNodePortInputs(tmp,manifest)
 for(const folder of ['experiments/compositor-int-vector3','experiments/static-switch-family']){await mkdir(join(tmp,folder),{recursive:true});await writeFile(join(tmp,folder,'evidence.json'),'retrospective result, not executed')}
 assert.equal((await fingerprintNodePortInputs(tmp,manifest)).inputDigest,before.inputDigest)
 const path=join(tmp,'experiments/static-switch-family/int-vector3-cases.json');await writeFile(path,(await readFile(path,'utf8'))+'\n')
 assert.notEqual((await fingerprintNodePortInputs(tmp,manifest)).inputDigest,before.inputDigest)
})

function finiteCostFixtures(){
 const cases=JSON.parse(readFileSyncLocal(new URL('../../experiments/compositor-finite-image-info/cases.json',import.meta.url))).map(row=>({...row,programFile:row.case+'.program.json',...(row.saveFinal?{sourceFile:row.case+'.blend'}:{})}))
 const payloads=new Map(cases.filter(row=>['png','float'].includes(row.producer)).map(row=>[row.case,{bytes:row.size[0]*row.size[1]*16,sha256:'e'.repeat(64)}]))
 const runs=['metal','software'].flatMap(profile=>['raw','final'].map(phase=>({profile,phase,report:{status:'PASSED_STATIC_SELECTION_BUILT_PROOF',built:true,profile,final:phase==='final',sourceContext:'CPU',rows:['webgpu','webgl2'].map(backend=>({backend,gpu:{api:backend==='webgpu'?'WebGPU':'WebGL2',vendor:profile==='metal'?'Apple Metal':'SwiftShader'},errors:[],pageErrors:[],payloadCostCanary:{creations:1,uploads:1,physicalHandles:1,sampledTextureBindings:1,samplerBindings:1},finiteFrameGuard:{case:'blank-group',refused:true,recovered:true,error:'Blank Image requires full-frame'},rows:(phase==='final'?cases.filter(row=>row.saveFinal):cases).map(entry=>{
  const payload=payloads.get(entry.case),count=payload?(phase==='final'?2:1):0
  return{case:entry.case,wordMismatches:0,remainingTextures:0,finalBindings:phase==='final',ownershipPreserved:true,readbacks:(phase==='final'?['primary','repeat','reinstalled']:['primary','repeat']).map(name=>({phase:name,comparedWords:256,rowFlip:false,wordFile:'readbacks/'+backend+'-'+entry.case+'-'+name+'.u32',wordSha256:'d'.repeat(64)})),payloadCost:{scope:'matched-actual-source-payload-objects-and-backend-bindings',cpuObjects:count,distinctCpuBuffers:count,observedCpuBytes:count*(payload?.bytes??0),gpuCreations:0,gpuUploads:0,physicalGpuHandles:0,sampledTextureBindings:0,samplerBindings:0,rows:Array.from({length:count},(_,i)=>({uuid:entry.case+'-'+i,width:entry.size[0],height:entry.size[1],observedCpuBytes:payload.bytes,rawSha256:payload.sha256,creations:0,uploads:0,physicalHandles:0,sampledTextureBindings:0,samplerBindings:0}))}}
 })}))}})))
 return{cases,payloads,runs}
}

test('finite metadata bridge separates calibrated CPU facts from actual zero GPU payload work',()=>{
 const{cases,payloads,runs}=finiteCostFixtures(),result=assertFinitePayloadCostReports(runs,cases,payloads)
 assert.equal(result.archivedCaptures,264);assert.equal(result.archivedWords,67584);assert.equal(result.cpuObjects,76);assert.equal(result.observedCpuBytes,321984);assert.equal(result.physicalGpuHandles,0);assert.equal(result.sampledTextureBindings,0)
 const mutations=[r=>r.pop(),r=>delete r[0].report.rows[0].gpu,r=>r[0].report.rows[0].payloadCostCanary.samplerBindings=0,r=>r[0].report.rows[0].finiteFrameGuard.recovered=false,r=>r[0].report.rows[0].rows[1].readbacks.pop(),r=>r[0].report.rows[0].rows.find(row=>row.case==='png-dimensions').payloadCost.gpuUploads=1,r=>r[0].report.rows[0].rows.find(row=>row.case==='png-dimensions').payloadCost.rows[0].rawSha256='f'.repeat(64),r=>r[0].report.rows[0].rows.find(row=>row.case==='png-dimensions').payloadCost.cpuObjects=0]
 for(const change of mutations){const rows=structuredClone(runs);change(rows);assert.throws(()=>assertFinitePayloadCostReports(rows,cases,payloads))}
})
