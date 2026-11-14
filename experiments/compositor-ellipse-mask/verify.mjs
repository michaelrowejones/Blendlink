// Close raw native pixels, saved Final publication, exact source and actual runtime archives.
import assert from'node:assert/strict'
import{readFile,writeFile,readdir,realpath}from'node:fs/promises'
import{join,resolve,relative}from'node:path'
import{captureRuntimeProvenance,hash}from'../../scripts/lib/runtime-provenance.mjs'
import{assertBuiltRuntimeArchive}from'../../scripts/lib/runtime-proof-archive.mjs'
import{validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
import{assertQualification,assertFinal,assertBrowserRows,browserProofContract,cases,expectedFinalCases,resizeSequence}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-ellipse-mask')),folder=join(directory,'cpu'),output=resolve(process.argv[3]??join(directory,'qualified.json'))
const read=async path=>JSON.parse(await readFile(path,'utf8')),pin=async(path,sha)=>assert.equal(hash(await readFile(path)),sha,'Changed proof input '+path)
const nativePath=join(folder,'qualification.json'),native=assertQualification(await read(nativePath)),nativePin=hash(await readFile(nativePath))
const expectedNativeSources=['packages/blender-addon/tests/compositor_reference.py',...(await read(join(import.meta.dirname,'fixture-files.json'))).map(name=>'experiments/compositor-ellipse-mask/'+name)]
for(const sub of['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,sub)))if(name.endsWith('.py')||sub==='packages/blender-addon'&&name.endsWith('.json'))expectedNativeSources.push(sub+'/'+name)
assert.deepEqual(Object.keys(native.sourceHashes).sort(),expectedNativeSources.sort())
for(const[path,sha]of Object.entries(native.sourceHashes))await pin(join(root,path),sha)
const rawNative=[]
for(const row of native.cases){
 for(const kind of['program','pixel','input'])await pin(join(folder,row[kind+'File']),row[kind+'Sha256'])
 const pixels=await readFile(join(folder,row.pixelFile));assert.equal(pixels.length,row.width*row.height*16)
 const program=await read(join(folder,row.programFile));assert.equal(program.status,'extracted');const ellipses=program.ops.filter(op=>op.kind==='ellipse-mask');assert.equal(ellipses.length,1);assert.equal(ellipses[0].source.nodeType,'CompositorNodeEllipseMask');assert.equal(ellipses[0].properties.evaluation_device,'CPU');assert.equal(ellipses[0].properties.ellipse_mask_requested_precision,row.precision);assert.deepEqual(ellipses[0].properties.ellipse_mask_export_extent,[row.width,row.height]);assert.equal(ellipses[0].properties.ellipse_mask_identity,row.expectedSingle)
 if(row.sourceFile){assert.equal(row.sourceFile,row.case+'.blend');await pin(join(folder,row.sourceFile),row.sourceSha256)}
 rawNative.push({case:row.case,pixelSha256:row.pixelSha256,programSha256:row.programSha256,comparedWords:pixels.length/4})
}
const finalPath=join(folder,'final-proof.json'),finalPin=hash(await readFile(finalPath)),published=assertFinal(await read(finalPath),native,{built:true,nativeSha256:nativePin})
const provenancePaths=['compositor_graph.py','compositor_box_mask.py','compositor_ellipse_mask.py','compositor_mask_domains.py','source_presentation.py','export_scene.py'].map(n=>'packages/blendlink/blender/'+n)
assert.deepEqual(published.provenance.map(r=>r.source),provenancePaths)
for(const row of published.provenance){assert.equal(row.artifact,row.source.replace('/blender/','/dist/blender/'));await pin(join(root,row.source),row.sha256);await pin(join(root,row.artifact),row.sha256)}
for(const row of published.rows){
 const original=native.cases.find(x=>x.case===row.case);for(const kind of['manifest','glb','presentation'])await pin(row[kind+'Path'],row[kind+'Sha256'])
 const manifest=await read(row.manifestPath),body=await readFile(row.presentationPath),presentation=JSON.parse(body)
 assert.deepEqual(manifest.sourcePresentation,row.presentationPointer);assert.equal(body.length,row.presentationPointer.bytes);assert.equal(hash(body).slice(0,16),row.presentationPointer.hash)
 const nativeProgram=await read(join(folder,original.programFile));for(const key of['status','ops','passes','output'])assert.deepEqual(presentation.compositor[key],nativeProgram[key]);assert.ok(presentation.compositor.ops.some(op=>op.source.nodeType==='CompositorNodeEllipseMask'))
}
const archive=await validateNativeArchive(published.nativeArchive,folder,{expectedFinalSources:await Promise.all(expectedFinalCases().map(row=>realpath(join(folder,row.case+'.blend')))),expectedScripts:[{path:await realpath(join(root,'experiments/compositor-ellipse-mask/reference.py')),invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
assert.equal(published.nativeArchive.proof.invocations.length,expectedFinalCases().length+2);assert.equal(published.nativeArchive.proof.invocations.filter(r=>JSON.stringify(r.result.args)==='["--version"]').length,1)
const{provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Ellipse Mask closed reader'})
const sources=[{native:{path:relative(root,nativePath),sha256:nativePin},final:{path:relative(root,finalPath),sha256:finalPin},sourceHashes:native.sourceHashes,nativeArchive:archive}],runs=[];let words=0,caseRuns=0,resizeFrames=0,lifecycleCycles=0,runtimeFingerprint
for(const profile of['metal','software'])for(const phase of['raw','final']){
 const browser=join(folder,'browser-'+phase+'-'+profile),path=join(browser,'report.json'),report=await read(path)
 assert.equal(report.status,browserProofContract.browserStatus)
 assertBrowserRows(report,native,published,{profile,final:phase==='final'})
 assert.equal(report.provenance.nativeQualificationSha256,nativePin);if(phase==='final')assert.equal(report.provenance.finalProofSha256,finalPin)
 const fingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(browser,'runtime'),fixtureDirectory:join(browser,'fixture'),fixtureSourceDirectory:import.meta.dirname,fixtureNames:['browser.js','index.html','browser-contract.mjs']})
 runtimeFingerprint??=fingerprint;assert.equal(fingerprint,runtimeFingerprint)
 await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
 for(const api of report.rows)for(const row of api.rows){caseRuns++;words+=row.comparedWords;resizeFrames+=row.resizeFrames;lifecycleCycles+=row.lifecycleCycles??0}
 runs.push({path:relative(root,path),sha256:hash(await readFile(path)),profile,phase,browserVersion:report.browserVersion,actualApis:report.rows.map(r=>({backend:r.backend,gpu:r.gpu,cases:r.rows.length}))})
}
assert.equal(caseRuns,4*(cases.length+expectedFinalCases().length));assert.equal(words,4*(cases.reduce((n,r)=>n+r.width*r.height*4,0)+expectedFinalCases().reduce((n,r)=>n+r.width*r.height*4,0)))
const expectedResize=4*(cases.reduce((n,r)=>n+resizeSequence(r).length,0)+expectedFinalCases().reduce((n,r)=>n+resizeSequence(r).length,0));assert.equal(resizeFrames,expectedResize)
const result={schemaVersion:1,status:'QUALIFIED_PARTIAL_COMPOSITOR_ELLIPSE_MASK',nativeGraphs:cases.length,savedFinalScenes:expectedFinalCases().length,browserCaseRuns:caseRuns,primaryFloat32Words:words,exactWordMismatches:0,contractViolations:0,resizeFrames,lifecycleCycles,uniqueActualPythonPrefixes:archive.uniqueCachePrefixes,scope:'Pinned Blender5.3 CPU compositor only. Static literal unlinked axis-aligned Ellipse Mask, native raw Float32 scalar copy; cached integer row intervals and precomputed branch values. FULL/AUTO source requests recorded per case. Portable actual browser WebGPU/WebGL2 qualification on observed Metal and SwiftShader. No Blender GPU-authored, AA, animated/field/rotation or arbitrary transformed-domain claim.',numericContract:await read(join(import.meta.dirname,'numeric-contract.json')),numericContractSha256:hash(await readFile(join(import.meta.dirname,'numeric-contract.json'))),upstream:await read(join(import.meta.dirname,'sources.json')),resources:'One fixed64KiB RG32I row texture per nonconstant node, no RTT/readback/additional pass; zero/equal-valued outputs allocate no row texture. At most one varying row table, closed texture-free pointwise compositor kinds, combined row/display lookup budget8 and no additional post-LDR registrations. Three Final apply/dispose cycles restore exact source material/callback identities and independently drawn renderer cache identities. Extent validator is retained on result VarNode, including allzero/constant optimized graphs; invalid extents recover without changing prior one-entry cache.',closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(join(import.meta.dirname,'verify.mjs'))),runtimeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs'))),nativeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/native-proof-archive.mjs')))},sources,runs,rawNative,rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)}}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_ELLIPSE_MASK_QUALIFIED '+JSON.stringify({native:cases.length,final:expectedFinalCases().length,caseRuns,words,resizeFrames,exactWordMismatches:0}))
