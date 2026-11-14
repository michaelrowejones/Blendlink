// Close raw native pixels, saved Final publication, exact source and actual runtime archives.
import assert from'node:assert/strict'
import{readFile,writeFile,readdir,realpath}from'node:fs/promises'
import{join,resolve,relative}from'node:path'
import{captureRuntimeProvenance,hash}from'../../scripts/lib/runtime-provenance.mjs'
import{assertBuiltRuntimeArchive}from'../../scripts/lib/runtime-proof-archive.mjs'
import{validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
import{assertQualification,assertFinal,assertBrowserRows,browserProofContract,cases,expectedFinalCases,resizeCount,assertPolicy}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-static-matrix')),folder=join(directory,'cpu'),output=resolve(process.argv[3]??join(directory,'qualified.json'))
const read=async path=>JSON.parse(await readFile(path,'utf8')),pin=async(path,sha)=>assert.equal(hash(await readFile(path)),sha,'Changed proof input '+path)
const nativePath=join(folder,'qualification.json'),native=assertQualification(await read(nativePath)),nativePin=hash(await readFile(nativePath))
const expectedNativeSources=['experiments/compositor-static-matrix/reference.py','experiments/compositor-static-matrix/policy.py','packages/blender-addon/tests/compositor_reference.py','experiments/compositor-static-matrix/cases.json']
for(const sub of['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,sub)))if(name.endsWith('.py')||sub==='packages/blender-addon'&&name.endsWith('.json'))expectedNativeSources.push(sub+'/'+name)
assert.deepEqual(Object.keys(native.sourceHashes).sort(),expectedNativeSources.sort())
for(const[path,sha]of Object.entries(native.sourceHashes))await pin(join(root,path),sha)
const rawNative=[]
for(const row of native.cases){
 for(const kind of['program','pixel','input'])await pin(join(folder,row[kind+'File']),row[kind+'Sha256'])
 const pixels=await readFile(join(folder,row.pixelFile));assert.equal(pixels.length,row.width*row.height*16)
 const program=await read(join(folder,row.programFile));assert.equal(program.status,'extracted');const matrices=program.ops.filter(op=>op.source.nodeType==='FunctionNodeSeparateMatrix');assert.equal(matrices.length,row.indices.length);for(const node of matrices){assert.equal(node.kind,'value');assert.equal(node.type,'VALUE');assert.equal(node.properties.evaluation_device,'CPU')};assert.ok(program.ops.every(op=>['value','combine-color'].includes(op.kind)));assert.equal(program.compileTimeMatrices.length,row.indices.length);for(const record of program.compileTimeMatrices){assert.equal(record.model,'native-static-matrix-copy-cpu-53-v1');assert.equal(record.matrixRuntimeTransport,false);assert.equal(record.nativeBuild,'02f0899d78e3')}
 const words=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length/4);for(let i=0;i<words.length;i++)assert.equal(words[i],row.rgbaWords[i%4]);assert.deepEqual(matrices.map(op=>new Uint32Array(new Float32Array([op.value]).buffer)[0]),row.privateMFWords)
 if(row.sourceFile){assert.equal(row.sourceFile,row.case+'.blend');await pin(join(folder,row.sourceFile),row.sourceSha256)}
 rawNative.push({case:row.case,pixelSha256:row.pixelSha256,programSha256:row.programSha256,comparedWords:pixels.length/4})
}
const finalPath=join(folder,'final-proof.json'),finalPin=hash(await readFile(finalPath)),published=assertFinal(await read(finalPath),native,{built:true,nativeSha256:nativePin})
const provenancePaths=['compositor_graph.py','compositor_static_matrix.py','source_presentation.py','export_scene.py'].map(n=>'packages/blendlink/blender/'+n)
assert.deepEqual(published.provenance.map(r=>r.source),provenancePaths)
for(const row of published.provenance){assert.equal(row.artifact,row.source.replace('/blender/','/dist/blender/'));await pin(join(root,row.source),row.sha256);await pin(join(root,row.artifact),row.sha256)}
for(const row of published.rows){
 const original=native.cases.find(x=>x.case===row.case);for(const kind of['manifest','glb','presentation'])await pin(row[kind+'Path'],row[kind+'Sha256'])
 const manifest=await read(row.manifestPath),body=await readFile(row.presentationPath),presentation=JSON.parse(body)
 assert.deepEqual(manifest.sourcePresentation,row.presentationPointer);assert.equal(body.length,row.presentationPointer.bytes);assert.equal(hash(body).slice(0,16),row.presentationPointer.hash)
 const nativeProgram=await read(join(folder,original.programFile));for(const key of['status','ops','passes','output'])assert.deepEqual(presentation.compositor[key],nativeProgram[key]);assert.ok(presentation.compositor.ops.some(op=>op.source.nodeType==='FunctionNodeSeparateMatrix'));assert.deepEqual(presentation.compositor.compileTimeMatrices,nativeProgram.compileTimeMatrices)
}
const archive=await validateNativeArchive(published.nativeArchive,folder,{expectedFinalSources:await Promise.all(expectedFinalCases().map(row=>realpath(join(folder,row.case+'.blend')))),expectedScripts:['reference.py','policy.py'].map(name=>({path:join(root,'experiments/compositor-static-matrix',name),invocations:1})),helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
assert.equal(published.nativeArchive.proof.invocations.length,expectedFinalCases().length+3);assert.equal(published.nativeArchive.proof.invocations.filter(r=>JSON.stringify(r.result.args)==='["--version"]').length,1)
const policy=assertPolicy(await read(join(folder,'policy.json')))
const{provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Static Matrix closed reader'})
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
const result={schemaVersion:1,status:'QUALIFIED_PARTIAL_COMPOSITOR_STATIC_MATRIX',nativeGraphs:cases.length,savedFinalScenes:expectedFinalCases().length,browserCaseRuns:caseRuns,primaryFloat32Words:words,exactWordMismatches:0,contractViolations:0,resizeFrames,lifecycleCycles,uniqueActualPythonPrefixes:archive.uniqueCachePrefixes,scope:'Pinned Blender5.3 macOS arm64 CPU compositor static Combine Matrix/Transpose Matrix/Separate Matrix copy-only islands. Typed literal/value/group/reroute/mute and qualified static Float selectors only. All source Float words must be normal or positive zero. Private Geometry Nodes CPU-MF carrier never evaluates user trees. MATRIX remains opaque in Python; terminal Float outputs use existing value runtime. No shader/EEVEE/GPU-authored, dynamic field, arithmetic Matrix, Quaternion or unlinked MATRIX-default equivalence.',numericContract:await read(join(import.meta.dirname,'numeric-contract.json')),numericContractSha256:hash(await readFile(join(import.meta.dirname,'numeric-contract.json'))),upstream:await read(join(import.meta.dirname,'sources.json')),resources:'One private depsgraph evaluation yields all16 outputs per unique island and extraction; no global cache. Source storage/topology/group ancestry/context/ownership checked. Private Scene/Object/Mesh/GeometryTree removed in finally. No Matrix browser op/pass/texture/readback. Three saved Final apply/dispose cycles preserve actual material/callback/renderer-cache identities. Static constants remain exact through target resize.',policy,closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(join(import.meta.dirname,'verify.mjs'))),runtimeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs'))),nativeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/native-proof-archive.mjs')))},sources,runs,rawNative,rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)}}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_STATIC_MATRIX_QUALIFIED '+JSON.stringify({native:cases.length,final:expectedFinalCases().length,caseRuns,words,resizeFrames,exactWordMismatches:0}))
