// Independent close: actual native axes/field words, saved Final publication,
// guarded source calls and immutable built browser/runtime/fixture archives.
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir,realpath,lstat} from 'node:fs/promises'
import {join,resolve,relative,sep,basename} from 'node:path'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from '../../scripts/lib/runtime-proof-archive.mjs'
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
import {browserProofContract,assertQualification,assertFinal,assertProgram,assertBrowserRows,assertPolicy,cases,expectedFinalCases,expectedFinalProvenance,uniformAxisWords,expectedFieldRgbaWords,resizeCount} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-white-noise-default-field')),folder=join(directory,'cpu'),output=resolve(process.argv[3]??join(directory,'qualified.json'))
const read=async path=>JSON.parse(await readFile(path,'utf8')),pin=async(path,sha)=>assert.equal(hash(await readFile(path)),sha,'Changed proof input '+path)
const owned=async path=>{const p=await realpath(path),base=await realpath(folder);assert.ok(p.startsWith(base+sep),'Proof artifact escaped native ownership');return p}
const rawWords=async(row)=>{const path=await owned(join(folder,row.pixelFile));await pin(path,row.pixelSha256);const bytes=await readFile(path);assert.equal(bytes.length,row.width*row.height*16);return Array.from({length:bytes.length/4},(_,i)=>bytes.readUInt32LE(i*4))}
const nativePath=join(folder,'qualification.json'),native=assertQualification(await read(nativePath)),nativePin=hash(await readFile(nativePath))
const expectedNativeSources=['experiments/compositor-white-noise-default-field/reference.py','experiments/compositor-white-noise-default-field/policy.py','experiments/compositor-white-noise-default-field/cases.json','experiments/compositor-white-noise/hash_reference.py','packages/blender-addon/tests/compositor_reference.py','packages/blender-addon/tests/compositor_white_noise_fields_check.py','packages/blender-addon/tests/compositor_white_noise_check.py']
for(const sub of['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,sub)))if(name.endsWith('.py')||sub==='packages/blender-addon'&&name.endsWith('.json'))expectedNativeSources.push(sub+'/'+name)
assert.deepEqual(Object.keys(native.sourceHashes).sort(),expectedNativeSources.sort(),'Native source census is incomplete, stale or contains unreviewed helpers')
for(const[path,sha]of Object.entries(native.sourceHashes))await pin(join(root,path),sha)
const axes=new Map(),controls=[]
for(const row of native.coordinateControls){
 const actual=await rawWords(row),maximum=Math.max(row.width,row.height),x=uniformAxisWords(row.width,maximum),y=uniformAxisWords(row.height,maximum)
 for(let iy=0;iy<row.height;iy++)for(let ix=0;ix<row.width;ix++)assert.deepEqual(actual.slice((iy*row.width+ix)*4,(iy*row.width+ix+1)*4),[x[ix],y[iy],0,0x3f800000],'Actual native Uniform coordinate differs before hashing')
 axes.set(row.width+'x'+row.height,actual);controls.push({case:row.case,pixelSha256:row.pixelSha256,comparedWords:actual.length})
}
const domain=await rawWords(native.fieldDomainControl)
for(let i=0;i<domain.length;i++)assert.equal(domain[i],[0x41500000,0x41100000,0,0x3f800000][i%4],'Actual native field domain must be13x9, not single0x0')
controls.push({case:native.fieldDomainControl.case,pixelSha256:native.fieldDomainControl.pixelSha256,comparedWords:domain.length,runtimeConsumerCredit:0})
const rawNative=[]
for(const row of native.cases){
 for(const kind of['program','input'])await pin(await owned(join(folder,row[kind+'File'])),row[kind+'Sha256'])
 const program=assertProgram(await read(join(folder,row.programFile)),row),pixels=await rawWords(row),coordinates=axes.get(row.width+'x'+row.height)
 assert.ok(coordinates);assert.equal((await readFile(join(folder,row.inputFile))).length,row.width*row.height*16)
 for(let i=0;i<pixels.length;i+=4)assert.deepEqual(pixels.slice(i,i+4),expectedFieldRgbaWords(row,coordinates.slice(i,i+3)),'Actual native field/hash words differ')
 if(row.saved)await pin(await owned(join(folder,row.sourceFile)),row.sourceSha256)
 rawNative.push({case:row.case,pixelSha256:row.pixelSha256,programSha256:row.programSha256,comparedWords:pixels.length,nativeFields:program.ops.filter(op=>op.kind==='white-noise-texture').length})
}
const finalPath=join(folder,'final-proof.json'),finalPin=hash(await readFile(finalPath)),published=assertFinal(await read(finalPath),native,{built:true,nativeSha256:nativePin})
assert.deepEqual(published.provenance,expectedFinalProvenance(native))
for(const row of published.provenance){await pin(join(root,row.source),row.sha256);await pin(join(root,row.artifact),row.sha256)}
for(const row of published.rows){
 const original=native.cases.find(r=>r.case===row.case)
 for(const kind of['manifest','glb','presentation','module'])await pin(await owned(row[kind+'Path']),row[kind+'Sha256'])
 const manifest=await read(row.manifestPath);assert.deepEqual(manifest.sourcePresentation,row.presentationPointer)
 const bytes=await readFile(row.presentationPath);assert.equal(bytes.length,row.presentationPointer.bytes);assert.equal(hash(bytes).slice(0,16),row.presentationPointer.hash)
 const presentation=JSON.parse(bytes);assertProgram(presentation.compositor,original)
 const nativeProgram=await read(join(folder,original.programFile));for(const key of['status','ops','passes','output'])assert.deepEqual(presentation.compositor[key],nativeProgram[key])
 await pin(join(folder,original.sourceFile),original.sourceSha256)
}
const archive=await validateNativeArchive(published.nativeArchive,folder,{expectedFinalSources:await Promise.all(expectedFinalCases().map(r=>realpath(join(folder,r.case+'.blend')))),expectedScripts:['reference.py','policy.py'].map(n=>({path:join(import.meta.dirname,n),invocations:1})),helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
assert.equal(archive.pythonInvocations,10);assert.equal(archive.finalInvocations,8);assert.equal(archive.uniqueCachePrefixes,10)
assert.equal(published.nativeArchive.proof.invocations.length,11);assert.equal(published.nativeArchive.proof.invocations.filter(r=>JSON.stringify(r.result.args)==='["--version"]').length,1)
const policy=assertPolicy(await read(join(folder,'policy.json')))
// Always independently emit current whole program; no receipt-only reuse.
const{provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Default White Noise field closed reader'})
const runs=[];let words=0,caseRuns=0,resizeFrames=0,lifecycleCycles=0,runtimeFingerprint
for(const profile of['metal','software'])for(const phase of['raw','final']){
 const browser=join(folder,'browser-'+phase+'-'+profile),path=join(browser,'report.json'),report=assertBrowserRows(await read(path),native,published,{profile,final:phase==='final'})
 assert.equal(report.status,browserProofContract.browserStatus)
 assert.equal(report.provenance.nativeQualificationSha256,nativePin);if(phase==='final')assert.equal(report.provenance.finalProofSha256,finalPin)
 if(phase==='final'){
  const generated=join(browser,'generated');assert.equal((await lstat(generated)).isSymbolicLink(),false)
  assert.deepEqual((await readdir(generated)).sort(),published.rows.map(r=>basename(r.modulePath)).sort())
  assert.deepEqual(report.provenance.generatedFiles,published.rows.map(r=>({name:basename(r.modulePath),sha256:r.moduleSha256,source:r.modulePath})))
  for(const row of published.rows){const path=join(generated,basename(row.modulePath));assert.equal((await lstat(path)).isSymbolicLink(),false);await pin(path,row.moduleSha256)}
 }else assert.deepEqual(report.provenance.generatedFiles??[],[])
 const fingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(browser,'runtime'),fixtureDirectory:join(browser,'fixture'),fixtureSourceDirectory:import.meta.dirname,fixtureNames:['browser.js','index.html']})
 runtimeFingerprint??=fingerprint;assert.equal(fingerprint,runtimeFingerprint)
 for(const[name,key]of[['run.mjs','runnerSha256'],['protocol.mjs','protocolSha256']])await pin(join(import.meta.dirname,name),report.provenance[key])
 for(const api of report.rows)for(const row of api.rows){caseRuns++;words+=row.comparedWords;resizeFrames+=row.resizeFrames;lifecycleCycles+=row.lifecycleCycles??0}
 runs.push({path:relative(root,path),sha256:hash(await readFile(path)),profile,phase,browserVersion:report.browserVersion,actualApis:report.rows.map(r=>({backend:r.backend,gpu:r.gpu,cases:r.rows.length,savedDispose:r.savedDispose}))})
}
const expectedWords=4*(cases.reduce((n,r)=>n+r.width*r.height*4,0)+expectedFinalCases().reduce((n,r)=>n+r.width*r.height*4,0)),expectedResize=4*(cases.reduce((n,r)=>n+resizeCount(r),0)+expectedFinalCases().reduce((n,r)=>n+resizeCount(r),0))
assert.equal(caseRuns,248);assert.equal(words,expectedWords);assert.equal(resizeFrames,expectedResize);assert.equal(lifecycleCycles,4*8*3)
const result={schemaVersion:1,status:'QUALIFIED_PARTIAL_COMPOSITOR_WHITE_NOISE_DEFAULT_FIELD',nativeGraphs:54,nativeOracleControls:9,nativeRenders:63,savedFinalScenes:8,browserCaseRuns:caseRuns,primaryFloat32Words:words,exactWordMismatches:0,contractViolations:0,resizeFrames,lifecycleCycles,uniqueActualPythonPrefixes:archive.uniqueCachePrefixes,scope:'Pinned Blender5.3 macOS arm64 CPU compositor. Native unlinked Vector Uniform input for dimensions2..4 Value/Color; fixed raw normal/+0 W for4D; same-frame full-frame zero-origin square-pixel context, AUTO/FULL CPU Float32. Exact cached shared R32F axis table and integer RN-even uint normalization. Closed texture-free pointwise consumers and total axis/row/display sampler budget8. No linked implicit field, native GPU/EEVEE, image/render-pass/spatial producer, ImageInfo consumer extension or original-demo acceptance.',policy,resources:'One shared O(W+H) R32F table per build, at most64KiB; one update per valid physical extent change, no production readback or extra render pass. Independent native coordinate and domain controls receive no runtime node credit.',closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(import.meta.filename)),runtimeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs'))),nativeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/native-proof-archive.mjs')))},sources:[{native:{path:relative(root,nativePath),sha256:nativePin},final:{path:relative(root,finalPath),sha256:finalPin},sourceHashes:native.sourceHashes,nativeArchive:archive}],controls,rawNative,runs,rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)}}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_WHITE_NOISE_DEFAULT_FIELD_QUALIFIED '+JSON.stringify({native:54,controls:9,final:8,caseRuns,words,resizeFrames,exactWordMismatches:0}))
