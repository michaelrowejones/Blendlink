import assert from'node:assert/strict'
import{readdir,readFile,writeFile}from'node:fs/promises'
import{join,resolve,relative}from'node:path'
import{hash,captureRuntimeProvenance}from'../../scripts/lib/runtime-provenance.mjs'
import{assertBuiltRuntimeArchive}from'../../scripts/lib/runtime-proof-archive.mjs'
import{NodeIO}from'@gltf-transform/core'
import{ALL_EXTENSIONS}from'@gltf-transform/extensions'
import{MeshoptDecoder}from'meshoptimizer'
import{captureVertexAlphaOptimization}from'../../packages/blendlink/dist/vertexAlphaOptimization.js'
import{validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
import{assertQualification,assertFinal,assertBrowserRows,browserProofContract,cases}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]),output=resolve(process.argv[3]??join(directory,'qualified.json'))
const read=async path=>JSON.parse(await readFile(path)),pin=async(path,expected)=>assert.equal(hash(await readFile(path)),expected,'Changed proof input '+path)
const nativePath=join(directory,'qualification.json'),native=assertQualification(await read(nativePath)),nativePin=hash(await readFile(nativePath))
const expectedSources=['experiments/vertex-color-alpha/reference.py','experiments/vertex-color-alpha/cases.json','experiments/vertex-color-alpha/protocol.mjs','experiments/vertex-color-alpha/fixture-geometry.json']
for(const sub of['packages/blender-addon','packages/blendlink/blender'])for(const name of await readdir(join(root,sub)))if(name.endsWith('.py')||sub==='packages/blender-addon'&&name.endsWith('.json'))expectedSources.push(sub+'/'+name)
assert.deepEqual(Object.keys(native.sourceHashes).sort(),expectedSources.sort());for(const[file,sha]of Object.entries(native.sourceHashes))await pin(join(root,file),sha)
for(const row of native.cases){
 for(const kind of['source','rawGlb','rawProgram'])await pin(join(directory,row[kind+'File']),row[kind+'Sha256'])
 for(const frame of row.frames){await pin(join(directory,frame.pixelFile),frame.pixelSha256);await pin(join(directory,frame.exrFile),frame.exrSha256);assert.equal((await readFile(join(directory,frame.pixelFile))).length,frame.width*frame.height*16)}
 const programs=await read(join(directory,row.rawProgramFile));assert.equal(Object.keys(programs.materials).length,row.materials)
 for(const material of Object.values(programs.materials))assert.match(JSON.stringify(material.channels.Emission),/"op":"vertex_color_alpha"/)
}
await pin(join(directory,native.calibration.pixelFile),native.calibration.pixelSha256)
const calibration=await readFile(join(directory,native.calibration.pixelFile));for(let y=0;y<64;y++)for(let x=0;x<64;x++){
 const expected=[(x+.5)/64,(y+.5)/64,.5,1];for(let lane=0;lane<4;lane++)assert.equal(calibration.readFloatLE(((y*64+x)*4+lane)*4),expected[lane])
}
const finalPath=join(directory,'final-proof.json'),published=assertFinal(await read(finalPath),native),finalPin=hash(await readFile(finalPath))
assert.equal(published.nativeQualificationSha256,nativePin)
assert.deepEqual(Object.keys(published.fixtureHashes).sort(),['experiments/vertex-color-alpha/capture.mjs','experiments/vertex-color-alpha/reference.py','experiments/vertex-color-alpha/export.test.ts','experiments/vertex-color-alpha/protocol.mjs','experiments/vertex-color-alpha/cases.json','experiments/vertex-color-alpha/fixture-geometry.json','packages/blender-addon/tests/vertex_color_alpha_check.py'].sort())
for(const[file,sha]of Object.entries(published.fixtureHashes))await pin(join(root,file),sha)
for(const provenance of published.provenance){await pin(join(root,provenance.source),provenance.sha256);await pin(join(root,provenance.artifact),provenance.sha256)}
await MeshoptDecoder.ready
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
for(const row of published.rows){
 for(const kind of['manifest','glb','material'])await pin(row[kind+'Path'],row[kind+'Sha256'])
 const source=native.cases.find(item=>item.case===row.case),manifest=await read(row.manifestPath),materialBytes=await readFile(row.materialPath),glb=await readFile(row.glbPath)
 assert.deepEqual(manifest.materialPrograms,row.materialPointer);assert.equal(materialBytes.length,row.materialPointer.bytes);assert.equal(hash(materialBytes).slice(0,16),row.materialPointer.hash)
 assert.equal(hash(glb).slice(0,16),manifest.hash);assert.equal(glb.length,manifest.stats.bytes)
 assert.deepEqual(JSON.parse(materialBytes).materials,(await read(join(directory,source.rawProgramFile))).materials)
 const before=captureVertexAlphaOptimization(await io.read(join(directory,source.rawGlbFile))),after=captureVertexAlphaOptimization(await io.read(row.glbPath))
 const authored=rows=>rows.map(({mesh,variant,...association})=>association)
 assert.deepEqual(authored(after.associations),authored(before.associations));assert.deepEqual(after.semantics,before.semantics)
 assert.equal(hash(Buffer.from(JSON.stringify(after.associations))),row.optimizedAssociationDigest)
}
const archive=await validateNativeArchive(published.nativeArchive,directory,{expectedFinalSources:native.cases.map(row=>join(directory,row.sourceFile)),
 expectedScripts:[{path:join(root,'packages/blender-addon/tests/vertex_color_alpha_check.py'),invocations:1},{path:join(root,'experiments/vertex-color-alpha/reference.py'),invocations:1}],
 helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
const policy=await read(join(directory,'policy/policy.json'));assert.equal(policy.status,'VERTEX_ALPHA_NO_RENDER_POLICY_PASSED')
const{provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Vertex Alpha closed reader'})
let runtimeFingerprint,words=0,browserCaseRuns=0,resizeFrames=0,lifecycleCycles=0,maxAbs=0,rgbWordDifferences=0
const runs=[]
for(const profile of['metal','software'])for(const phase of['raw','final']){
 const folder=join(directory,'browser-'+phase+'-'+profile),report=await read(join(folder,'report.json'))
 assert.equal(report.status,browserProofContract.browserStatus)
 assertBrowserRows(report,{profile,phase});assert.equal(report.provenance.nativeQualificationSha256,nativePin)
 if(phase==='final')assert.equal(report.provenance.finalProofSha256,finalPin)
 const fingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(folder,'runtime'),fixtureDirectory:join(folder,'fixture'),fixtureSourceDirectory:import.meta.dirname,fixtureNames:['browser.js','index.html']})
 runtimeFingerprint??=fingerprint;assert.equal(fingerprint,runtimeFingerprint)
 await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
 for(const api of report.rows)for(const row of api.cases){browserCaseRuns++;words+=row.primaryWords;resizeFrames+=row.resizeFrames;lifecycleCycles+=row.cycles;maxAbs=Math.max(maxAbs,row.maxAbs);rgbWordDifferences+=row.rgbWordDiff}
 runs.push({path:relative(root,join(folder,'report.json')),sha256:hash(await readFile(join(folder,'report.json'))),profile,phase,actualApis:report.rows.map(row=>({backend:row.backend,gpu:row.gpu}))})
}
assert.equal(browserCaseRuns,cases.length*8);assert.equal(words,cases.length*8*64*64*4)
const receipt={schemaVersion:1,status:'QUALIFIED_PARTIAL_VERTEX_COLOR_ALPHA',nativeGraphs:cases.length,nativeFrames:cases.length*3,savedFinalScenes:published.rows.length,
 browserCaseRuns,primaryFloat32Words:words,rgbWordDifferences,exactAlphaMismatches:0,contractViolations:0,maximumAbsoluteRGB:maxAbs,
 numericContract:{rgbAbsoluteMax:2**-10,alphaOneExact:true,allPixels:true,seamAndEdgeBands:true,reference:'actual EEVEE half-film material output, not an exact-F32 field oracle'},
 resizeFrames,lifecycleCycles,uniqueActualPythonPrefixes:archive.uniqueCachePrefixes,
 scope:'Pinned Blender5.3.0 build02f0899d78e3 macOS arm64 EEVEE Metal FLOAT_COLOR POINT/CORNER Alpha. Raw +0/normal[0,1] scalar source transport, actual per-owner/material indexed associations, default Final pipeline with authored Meshopt mode. Eight field scenes: constants/nonuniform/seam/groups/shared owners/materials/RGB preservation. Native Alpha-to-Emission and actual installed material plus stripped Final Emission projection; no whole-scene camera, lighting, transparent coverage or Color+Alpha opacity qualification.',
 limits:'No BYTE_COLOR, source signed-zero/subnormal/HDR, deformation, instances, clocks, coincident same-winding triangles; 300k source vertices/corners and4layers permesh. Optimizer explicit globalPOSITIONfallback ≤1M unique position vertices and3M checkedrenderedcorners. New opacity+nonunit/unknown VEC4COLOR0 refuses; exact physical unit-alpha fakewhite safe. No changes to existingRGB multiplication.',
 closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(new URL(import.meta.url)))},nativePythonProof:archive,policy,
 sources:{native:{path:relative(root,nativePath),sha256:nativePin},final:{path:relative(root,finalPath),sha256:finalPin},sourceHashes:native.sourceHashes},runs,
 rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)}}
await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log('SCENETOWEB_VERTEX_ALPHA_QUALIFIED '+JSON.stringify({native:cases.length,Final:published.rows.length,browserCaseRuns,words,maxAbs,violations:0}))
