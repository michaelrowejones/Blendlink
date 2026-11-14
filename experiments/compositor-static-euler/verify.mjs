// Close raw native pixels, saved Final publication, exact source and actual runtime archives.
import assert from'node:assert/strict'
import{readFile,writeFile,readdir,realpath}from'node:fs/promises'
import{join,resolve,relative}from'node:path'
import{captureRuntimeProvenance,hash}from'../../scripts/lib/runtime-provenance.mjs'
import{assertBuiltRuntimeArchive}from'../../scripts/lib/runtime-proof-archive.mjs'
import{validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
import{assertQualification,assertFinal,assertBrowserRows,browserProofContract,cases,expectedFinalCases,resizeCount,assertPolicy,hashFloatWord}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-static-euler')),folder=join(directory,'cpu'),output=resolve(process.argv[3]??join(directory,'qualified.json'))
const read=async path=>JSON.parse(await readFile(path,'utf8')),pin=async(path,sha)=>assert.equal(hash(await readFile(path)),sha,'Changed proof input '+path)
const nativePath=join(folder,'qualification.json'),native=assertQualification(await read(nativePath)),nativePin=hash(await readFile(nativePath))
const expectedNativeSources=['experiments/compositor-static-euler/reference.py','experiments/compositor-static-euler/policy.py','packages/blender-addon/tests/compositor_reference.py','experiments/compositor-static-euler/cases.json','packages/blender-addon/tests/compositor_static_euler_check.py']
for(const sub of['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,sub)))if(name.endsWith('.py')||sub==='packages/blender-addon'&&name.endsWith('.json'))expectedNativeSources.push(sub+'/'+name)
assert.deepEqual(Object.keys(native.sourceHashes).sort(),expectedNativeSources.sort())
for(const[path,sha]of Object.entries(native.sourceHashes))await pin(join(root,path),sha)
const rawNative=[]
async function closeHashCarrier(row,expected){
 await pin(join(folder,row.pixelFile),row.pixelSha256);const bytes=await readFile(join(folder,row.pixelFile));assert.equal(bytes.length,4*4*16);const floats=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),words=new Uint32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);assert.deepEqual([...words.slice(0,4)],row.carrierWords);for(let i=0;i<words.length;i++)assert.equal(words[i],row.carrierWords[i%4]);const[lo,hi,marker,alpha]=floats;assert.ok(Number.isInteger(lo)&&lo>=0&&lo<=65535);assert.ok(Number.isInteger(hi)&&hi>=-32768&&hi<=32767);assert.equal(marker,123);assert.equal(alpha,1);assert.equal(((hi<<16)|lo)>>>0,row.hashWord);assert.equal(row.hashWord,expected)
}
for(const row of native.hashCalibration)await closeHashCarrier(row,hashFloatWord(row.sourceWord))
for(const row of native.cases){
 for(const kind of['program','pixel','input'])await pin(join(folder,row[kind+'File']),row[kind+'Sha256'])
 const pixels=await readFile(join(folder,row.pixelFile));assert.equal(pixels.length,row.width*row.height*16)
 const program=await read(join(folder,row.programFile));assert.equal(program.status,'extracted');const endpoints=program.ops.filter(op=>op.source.nodeType==='FunctionNodeRotationToQuaternion');assert.equal(endpoints.length,row.indices.length);for(const node of endpoints){assert.equal(node.kind,'value');assert.equal(node.type,'VALUE');assert.equal(node.properties.evaluation_device,'CPU')};assert.ok(program.ops.every(op=>['value','combine-color'].includes(op.kind)));assert.equal(program.compileTimeRotations.length,row.indices.length);for(const record of program.compileTimeRotations){assert.equal(record.model,'native-static-euler-xyz-cpu-53-v1');assert.equal(record.rotationRuntimeTransport,false);assert.equal(record.nativeBuild,'02f0899d78e3');assert.equal(record.preFloatStoreHashGuard,true);assert.deepEqual(record.eulerInputWords,row.inputWords);assert.deepEqual([...new Set(record.sources.map(member=>member.nodeType))].sort(),['FunctionNodeEulerToRotation','FunctionNodeRotationToQuaternion'])}
 const words=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length/4);for(let i=0;i<words.length;i++)assert.equal(words[i],row.rgbaWords[i%4]);assert.deepEqual(endpoints.map(op=>new Uint32Array(new Float32Array([op.value]).buffer)[0]),row.privateMFWords)
 for(const witness of row.hashWitnesses)await closeHashCarrier(witness,hashFloatWord(row.privateMFWords[row.indices.indexOf(witness.componentIndex)]))
 if(row.sourceFile){assert.equal(row.sourceFile,row.case+'.blend');await pin(join(folder,row.sourceFile),row.sourceSha256)}
 rawNative.push({case:row.case,pixelSha256:row.pixelSha256,programSha256:row.programSha256,comparedWords:pixels.length/4})
}
const finalPath=join(folder,'final-proof.json'),finalPin=hash(await readFile(finalPath)),published=assertFinal(await read(finalPath),native,{built:true,nativeSha256:nativePin})
const provenancePaths=['compositor_graph.py','compositor_static_euler.py','compositor_static_rotation.py','compositor_static_matrix.py','source_presentation.py','export_scene.py'].map(n=>'packages/blendlink/blender/'+n)
assert.deepEqual(published.provenance.map(r=>r.source),provenancePaths)
for(const row of published.provenance){assert.equal(row.artifact,row.source.replace('/blender/','/dist/blender/'));await pin(join(root,row.source),row.sha256);await pin(join(root,row.artifact),row.sha256)}
for(const row of published.rows){
 const original=native.cases.find(x=>x.case===row.case);for(const kind of['manifest','glb','presentation'])await pin(row[kind+'Path'],row[kind+'Sha256'])
 const manifest=await read(row.manifestPath),body=await readFile(row.presentationPath),presentation=JSON.parse(body)
 assert.deepEqual(manifest.sourcePresentation,row.presentationPointer);assert.equal(body.length,row.presentationPointer.bytes);assert.equal(hash(body).slice(0,16),row.presentationPointer.hash)
 const nativeProgram=await read(join(folder,original.programFile));for(const key of['status','ops','passes','output'])assert.deepEqual(presentation.compositor[key],nativeProgram[key]);assert.ok(presentation.compositor.ops.some(op=>op.source.nodeType==='FunctionNodeRotationToQuaternion'));assert.deepEqual(presentation.compositor.compileTimeRotations,nativeProgram.compileTimeRotations)
}
const archive=await validateNativeArchive(published.nativeArchive,folder,{expectedFinalSources:await Promise.all(expectedFinalCases().map(row=>realpath(join(folder,row.case+'.blend')))),expectedScripts:['reference.py','policy.py'].map(name=>({path:join(root,'experiments/compositor-static-euler',name),invocations:1})),helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
assert.equal(published.nativeArchive.proof.invocations.length,expectedFinalCases().length+3);assert.equal(published.nativeArchive.proof.invocations.filter(r=>JSON.stringify(r.result.args)==='["--version"]').length,1)
const policy=assertPolicy(await read(join(folder,'policy.json')));await pin(join(root,'packages/blender-addon/tests/compositor_static_euler_check.py'),policy.scriptSha256)
const{provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Static Euler closed reader'})
const sources=[{native:{path:relative(root,nativePath),sha256:nativePin},final:{path:relative(root,finalPath),sha256:finalPin},sourceHashes:native.sourceHashes,nativeArchive:archive}],runs=[];let words=0,caseRuns=0,resizeFrames=0,lifecycleCycles=0,runtimeFingerprint
for(const profile of['metal','software'])for(const phase of['raw','final']){
 const browser=join(folder,'browser-'+phase+'-'+profile),path=join(browser,'report.json'),report=await read(path)
 assert.equal(report.status,browserProofContract.browserStatus)
 assertBrowserRows(report,native,published,{profile,final:phase==='final'})
 assert.equal(report.provenance.nativeQualificationSha256,nativePin);if(phase==='final')assert.equal(report.provenance.finalProofSha256,finalPin)
 const fingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(browser,'runtime'),fixtureDirectory:join(browser,'fixture'),fixtureSourceDirectory:import.meta.dirname,fixtureNames:['browser.js','index.html']})
 runtimeFingerprint??=fingerprint;assert.equal(fingerprint,runtimeFingerprint)
 await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
 for(const api of report.rows)for(const row of api.rows){caseRuns++;words+=row.comparedWords;resizeFrames+=row.resizeFrames;lifecycleCycles+=row.lifecycleCycles??0}
 runs.push({path:relative(root,path),sha256:hash(await readFile(path)),profile,phase,browserVersion:report.browserVersion,actualApis:report.rows.map(r=>({backend:r.backend,gpu:r.gpu,cases:r.rows.length}))})
}
assert.equal(caseRuns,4*(cases.length+expectedFinalCases().length));assert.equal(words,4*(cases.reduce((n,r)=>n+r.width*r.height*4,0)+expectedFinalCases().reduce((n,r)=>n+r.width*r.height*4,0)))
const expectedResize=4*(cases.reduce((n,r)=>n+resizeCount(r),0)+expectedFinalCases().reduce((n,r)=>n+resizeCount(r),0));assert.equal(resizeFrames,expectedResize)
const result={schemaVersion:1,status:'QUALIFIED_PARTIAL_COMPOSITOR_STATIC_EULER',nativeGraphs:cases.length,nativeCPURenders:native.nativeCPURenders,preFloatStoreHashComparisons:cases.reduce((n,r)=>n+r.indices.length,0),hashCalibrationControls:native.hashCalibration.length,savedFinalScenes:expectedFinalCases().length,browserCaseRuns:caseRuns,primaryFloat32Words:words,exactWordMismatches:0,contractViolations:0,resizeFrames,lifecycleCycles,uniqueActualPythonPrefixes:archive.uniqueCachePrefixes,scope:'Pinned Blender5.3 macOS arm64 CPU compositor static EulerToRotation/RotationToQuaternion construction/component-copy islands. Euler3 input must be unlinked literal, each raw component positive zero or positive [2^-16,1] radians. Unchanged native XYZ trig polynomial does not normalize/canonicalize. Opaque Rotation groups/reroutes and terminal Float endpoint groups only. No InputRotation/tree copy, vector links/computation, negative/wide angles, defaults/casts/fields/animation, shader/EEVEE/GPU-authored or other build/host/version credit.',numericContract:await read(join(import.meta.dirname,'numeric-contract.json')),numericContractSha256:hash(await readFile(join(import.meta.dirname,'numeric-contract.json'))),upstream:await read(join(import.meta.dirname,'sources.json')),resources:'One fixed16-node private depsgraph evaluation yields all4 outputs plus pre-Float-store hash INT guards per unique island and extraction; no global cache. Source storage/topology/group ancestry/context/ownership checked. Private Scene/Object/Mesh/GeometryTree removed in finally. No Rotation browser op/pass/texture/readback. Three saved Final apply/dispose cycles preserve actual material/callback/renderer-cache identities. Static constants remain exact through target resize.',policy,closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(join(import.meta.dirname,'verify.mjs'))),runtimeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs'))),nativeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/native-proof-archive.mjs')))},sources,runs,rawNative,rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)}}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_STATIC_EULER_QUALIFIED '+JSON.stringify({native:cases.length,final:expectedFinalCases().length,caseRuns,words,resizeFrames,exactWordMismatches:0}))
