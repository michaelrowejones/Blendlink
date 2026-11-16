// Saved-Final transaction uses the normal sync/verify/publication path and the
// existing guarded native launcher; it never edits a generated material carrier.
import assert from'node:assert/strict'
import{readFile,writeFile,readdir,mkdir}from'node:fs/promises'
import{join,resolve}from'node:path'
import{createHash}from'node:crypto'
import{createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import{archiveNativeLauncher,validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
import{executeNodePortCommand}from'../../scripts/lib/node-port-contract.mjs'
import{assertProofSdk}from'./proof-sdk.mjs'
const sdkProof=await assertProofSdk({checkOnly:process.argv[2]==='--check-sdk'});if(process.argv[2]==='--check-sdk')process.exit(0)
const{resolveConfig}=await import('../../packages/blendlink/dist/config.js'),{syncAll,verifyAll,publishedAssetPath}=await import('../../packages/blendlink/dist/sync.js'),{parseManifest}=await import('../../packages/blendlink/dist/typegen.js')
assert.equal(process.argv[3],'--gpu-lease');assert.ok(process.argv[4]===undefined||process.argv[4]==='--target-width=512');assert.equal(process.argv[5],undefined)
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]),hash=b=>createHash('sha256').update(b).digest('hex'),fixture=JSON.parse(await readFile(join(out,'fixtures.json')))
assert.equal(fixture.status,'SAVED_OWNED_ORIGINAL_COLOR_ONLY_FIXTURES');assert.equal(fixture.sourceOriginalSha256,hash(await readFile(fixture.sourceOriginal)));assert.deepEqual(fixture.calls,{gpu:0,render:0})
for(const c of fixture.cases)assert.equal(hash(await readFile(c.sourceFile)),c.sourceSha256)
const provenance=[]
for(const folder of['packages/blender-addon','packages/blendlink/blender'])for(const name of(await readdir(join(root,folder))).filter(n=>/\.(py|json)$/.test(n)).sort()){
 const source=join(root,folder,name),artifact=join(root,folder==='packages/blender-addon'?'packages/blendlink/dist/addon':'packages/blendlink/dist/blender',name),bytes=await readFile(source);assert.deepEqual(await readFile(artifact),bytes);provenance.push({source,artifact,sha256:hash(bytes)})
}
await mkdir(join(out,'compiled'));await mkdir(join(out,'export-archive'))
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'export-launchers')});let passed=false
try{
 // Each saved189MB case retains its own30s deadline. Three policy calls
 // have an explicit aggregate maximum3*30s, instead of sharing one30s timer.
 const policyRows=[],caseReports=[]
 for(const input of fixture.cases){
  assert.ok(['plane-1','source-Plane.021','source-Walls'].includes(input.id))
  const command=await executeNodePortCommand({argv:[launcher.executable,'--background','--factory-startup','--disable-autoexec','--python-exit-code','17','--python',join(import.meta.dirname,'audit-colors.py'),'--',out,'--case='+input.id],cwd:root,timeoutMs:30000,logPath:join(out,'source-policy-'+input.id+'.log')});assert.equal(command.exitCode,0);assert.equal(command.timedOut,false)
  const file='source-policy-'+input.id+'.json',bytes=await readFile(join(out,file)),report=JSON.parse(bytes)
  assert.equal(report.status,'PASSED_SINGLE_SAVED_COLOR_SOURCE_POLICY_NO_GPU');assert.equal(report.selectedCase,input.id);assert.deepEqual(report.calls,{gpu:0,render:0,bake:0});assert.equal(report.guards.status,'PERSISTENT_NATIVE_LOOKUP_DENIAL_SELFTEST_PASSED');assert.equal(report.guards.nativeGpuRenderBakeCalls,0);assert.deepEqual(report.rows.map(r=>r.id),[input.id]);assert.equal(report.scriptSha256,hash(await readFile(join(import.meta.dirname,'audit-colors.py'))))
  policyRows.push(...report.rows);caseReports.push({id:input.id,file,sha256:hash(bytes),elapsedMs:command.elapsedMs,deadlineMs:30000})
 }
 await writeFile(join(out,'source-policy.json'),JSON.stringify({status:'PASSED_SAVED_COLOR_SOURCE_POLICY_NO_GPU',supportCredit:0,calls:{gpu:0,render:0,bake:0},rows:policyRows,caseReports,policyCalls:fixture.cases.length,perCaseDeadlineMs:30000,aggregatePolicyCallDeadlineMs:fixture.cases.length*30000,scriptSha256:hash(await readFile(join(import.meta.dirname,'audit-colors.py')))},null,2)+'\n')
 const config=resolveConfig({blenderPath:launcher.executable,outDir:'public/models',genDir:'src/generated',scenes:fixture.cases.map((c,i)=>({name:'boxColorCase'+i,file:c.sourceFile,automaticMaterials:true}))},join(out,'compiled'))
 await syncAll(config,{force:true});assert.deepEqual((await verifyAll(config)).filter(i=>i.severity!=='warning'),[])
 const rows=[]
 for(const[index,scene]of config.scenes.entries()){
  const original=fixture.cases[index],manifestBytes=await readFile(scene.manifestPath),manifest=parseManifest(manifestBytes.toString());assert.ok(manifest.materialPrograms)
  const materialPath=publishedAssetPath(scene,manifest.materialPrograms.url,manifest),materialBytes=await readFile(materialPath),programs=JSON.parse(materialBytes)
  const flatten=v=>!v||typeof v!=='object'?[]:[...('op'in v?[v]:[]),...Object.values(v).flatMap(flatten)]
  const box=flatten(programs).filter(n=>n.op==='texture_box_ref');assert.ok(box.length);assert.ok(box.every(n=>n.model==='eevee-metal-box-color-mips-v1'))
  const materialRows=Object.values(programs.materials);assert.equal(materialRows.length,1);assert.ok(materialRows.every(m=>flatten(m.channels['Base Color']).some(n=>n.op==='texture_box_ref')&&['Base Color','Metallic','Roughness','Emission','Alpha'].every(c=>m.channels[c]?.tslIr)&&(m.skipped??[]).length===0));assert.deepEqual(materialRows[0].channels.Alpha.tslIr.output,{op:'const_float',value:1})
  const glb=await readFile(scene.glbPath);assert.equal(glb.readUInt32LE(0),0x46546c67);assert.equal(glb.readUInt32LE(16),0x4e4f534a);const json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString())
  assert.equal(json.meshes.length,1);assert.equal(json.meshes[0].primitives.length,1);const primitive=json.meshes[0].primitives[0]
  assert.ok(json.meshes[0].extras.blendlink_tsl_runtime.requiresNodeRenderer.programs.some(p=>p.op==='texture_box_ref'&&p.model==='eevee-metal-box-color-mips-v1'))
  for(const name of['POSITION','NORMAL'])assert.equal(json.accessors[primitive.attributes[name]].componentType,5126)
  assert.equal(json.materials.length,1);const carrier=json.materials[primitive.material];assert.ok(!carrier.pbrMetallicRoughness?.baseColorTexture);assert.deepEqual(carrier.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1],[1,1,1,1]);assert.equal(carrier.alphaMode??'OPAQUE','OPAQUE');assert.equal((json.images??[]).length,0,'Private neutral carrier must not retain stock BOX image transport')
  const image=Object.values(programs.images);assert.equal(image.length,1);assert.ok(image[0].boxMipmaps);const mipPath=publishedAssetPath(scene,new URL(image[0].boxMipmaps.file,new URL(manifest.materialPrograms.url,'http://local/')).pathname,manifest)
  const row={id:original.id,moduleExport:scene.name,sourceFile:original.sourceFile,sourceSha256:original.sourceSha256,manifestPath:scene.manifestPath,manifestSha256:hash(manifestBytes),glbPath:scene.glbPath,glbSha256:hash(await readFile(scene.glbPath)),modulePath:scene.modulePath,moduleSha256:hash(await readFile(scene.modulePath)),materialPath,materialSha256:hash(materialBytes),materialPointer:manifest.materialPrograms,materialPrograms:programs,mipPath,mipSha256:hash(await readFile(mipPath))}
  if(manifest.sourcePresentation){row.presentationPath=publishedAssetPath(scene,manifest.sourcePresentation.url,manifest);row.presentationSha256=hash(await readFile(row.presentationPath))}
  rows.push(row);assert.equal(hash(await readFile(original.sourceFile)),original.sourceSha256)
 }
 await writeFile(join(out,'final.json'),JSON.stringify({status:'EXPORTED_OWNED_ORIGINAL_BOX_COLOR_FINALS_NOT_SCENE_ACCEPTANCE',sdkProof,supportCredit:0,materialCredit:0,sceneCredit:0,fixtureSha256:hash(await readFile(join(out,'fixtures.json'))),provenance,rows},null,2)+'\n');passed=true
}finally{try{await launcher.finalize();const archive={passed,identity:launcher.identity,proof:await archiveNativeLauncher(launcher,join(out,'export-archive'),passed)};await writeFile(join(out,'export-native-proof.json'),JSON.stringify(archive,null,2)+'\n');if(passed)await validateNativeArchive(archive,join(out,'export-archive'),{expectedScripts:[{path:join(import.meta.dirname,'audit-colors.py'),invocations:fixture.cases.length}],expectedFinalSources:fixture.cases.map(c=>c.sourceFile),helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})}finally{await launcher.dispose()}}
