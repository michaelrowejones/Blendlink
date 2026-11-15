/* SPDX-License-Identifier: MIT */
// Independent close reads actual raw words again; browser summaries are not an oracle.
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir,realpath,lstat} from 'node:fs/promises'
import {join,resolve,relative,sep,basename} from 'node:path'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from '../../scripts/lib/runtime-proof-archive.mjs'
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
import {assertRedFacObservations} from './numeric-contract.mjs'
import {cases,extents,fixtureNames,browserProofContract,assertQualification,assertProgram,assertGroupTrace,assertFinal,assertPolicy,assertBrowserRows,expectedFinalCases,expectedFinalProvenance,uniformAxisWords,compareNoise,assertRedFac,word,precision} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-noise-default-field')),nativeFolder=join(directory,'cpu')
const output=resolve(process.argv[3]??join(directory,'qualified.json'))
const json=async path=>JSON.parse(await readFile(path,'utf8'))
const pin=async(path,sha)=>assert.equal(hash(await readFile(path)),sha,'Changed proof input: '+path)
async function owned(base,path){
 const actual=await realpath(path),parent=await realpath(base)
 assert.ok(actual.startsWith(parent+sep),'Proof artifact escaped ownership: '+path)
 assert.equal((await lstat(path)).isSymbolicLink(),false,'Proof artifact cannot be a symlink')
 return actual
}
async function words(base,path,sha,width,height){
 const actual=await owned(base,path);await pin(actual,sha)
 const bytes=await readFile(actual);assert.equal(bytes.length,width*height*16,'Raw Float32 word extent changed')
 const result=new Uint32Array(bytes.length/4);for(let i=0;i<result.length;i++)result[i]=bytes.readUInt32LE(i*4)
 return result
}
const qPath=join(nativeFolder,'qualification.json'),qPin=hash(await readFile(qPath)),q=assertQualification(await json(qPath))
const expectedSources=['experiments/compositor-noise-default-field/reference.py','experiments/compositor-noise-default-field/policy.py','experiments/compositor-noise-default-field/cases.json','experiments/compositor-noise-default-field/protocol.mjs','experiments/compositor-noise-default-field/numeric-contract.mjs','experiments/compositor-noise-default-field/sources.json','packages/blender-addon/tests/compositor_reference.py','packages/blender-addon/tests/compositor_noise_check.py']
for(const sub of ['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,sub)))if(name.endsWith('.py')||sub==='packages/blender-addon'&&name.endsWith('.json'))expectedSources.push(sub+'/'+name)
assert.deepEqual(Object.keys(q.sourceHashes).sort(),expectedSources.sort(),'Complete native source/helper census differs')
for(const [name,sha]of Object.entries(q.sourceHashes))await pin(join(root,name),sha)
const coordinateData=new Map(),nativeData=new Map(),nativeRecords=[],controls=[]
for(const row of q.coordinateControls){
 const data=await words(nativeFolder,join(nativeFolder,row.pixelFile),row.pixelSha256,row.width,row.height)
 const maximum=Math.max(row.width,row.height),xs=uniformAxisWords(row.width,maximum),ys=uniformAxisWords(row.height,maximum)
 for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++)assert.deepEqual([...data.subarray((y*row.width+x)*4,(y*row.width+x+1)*4)],[xs[x],ys[y],0,word(1)],'Actual native Uniform axis words changed')
 coordinateData.set(row.width+'x'+row.height,data);controls.push({case:row.case,sha256:row.pixelSha256,comparedWords:data.length,runtimeConsumerCredit:0})
}
for(const row of q.fieldDomainControls){
 const data=await words(nativeFolder,join(nativeFolder,row.pixelFile),row.pixelSha256,row.width,row.height)
 for(let i=0;i<data.length;i++)assert.equal(data[i],[word(row.width),word(row.height),0,word(1)][i%4],'Noise remains a native field even on a lattice')
 controls.push({case:row.case,sha256:row.pixelSha256,comparedWords:data.length,runtimeConsumerCredit:0})
}
for(const row of q.cases){
 for(const kind of ['program','input'])await pin(await owned(nativeFolder,join(nativeFolder,row[kind+'File'])),row[kind+'Sha256'])
 const program=assertProgram(await json(join(nativeFolder,row.programFile)),row)
 if(row.route==='group-reroute')assertGroupTrace(row.groupTrace,program)
 const data=await words(nativeFolder,join(nativeFolder,row.pixelFile),row.pixelSha256,row.width,row.height)
 const coordinates=coordinateData.get(row.width+'x'+row.height);assert.ok(coordinates)
 const metrics=compareNoise(data,data,coordinates,row)
 assert.equal(metrics.contractViolations,0);assert.equal(metrics.facBroadcastDifferences,0)
 const input=await words(nativeFolder,join(nativeFolder,row.inputFile),row.inputSha256,row.width,row.height)
 for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++){
  const index=(y*row.width+x)*4,expected=[word(x/16384),word(y/16384),word((x+3*y)/65536),word(1)]
  for(let lane=0;lane<4;lane++)assert.equal(input[index+lane],expected[lane],'Independent orientation marker changed')
 }
 if(row.saved)await pin(await owned(nativeFolder,join(nativeFolder,row.sourceFile)),row.sourceSha256)
 nativeData.set(row.case,data);nativeRecords.push({case:row.case,pixelSha256:row.pixelSha256,programSha256:row.programSha256,comparedWords:data.length,latticeControls:metrics.latticeControls,noiseOperations:program.ops.filter(op=>op.kind==='noise-texture').length})
}
for(const row of q.cases){
 if(row.route==='direct')continue
 const direct=q.cases.find(entry=>entry.route==='direct'&&entry.width===row.width&&entry.height===row.height&&entry.output===row.output)
 assert.ok(direct);assert.deepEqual(nativeData.get(row.case),nativeData.get(direct.case),'Native repeated/group/mean identity must match actual direct Noise')
}
for(const [w,h]of extents){
 const fac=cases.find(row=>row.route==='direct'&&row.width===w&&row.height===h&&row.output==='Fac'),color=cases.find(row=>row.route==='direct'&&row.width===w&&row.height===h&&row.output==='Color')
 assertRedFac(nativeData.get(fac.case),nativeData.get(color.case))
}
for(const row of q.endpointControls){
 const data=await words(nativeFolder,join(nativeFolder,row.pixelFile),row.pixelSha256,row.width,row.height)
 for(let i=0;i<data.length;i+=4){assert.equal(data[i],word(.5));assert.equal(data[i+3],word(1));if(row.output==='Fac')assert.deepEqual([...data.subarray(i,i+4)],[word(.5),word(.5),word(.5),word(1)]);else assert.deepEqual([...data.subarray(i,i+4)],[...data.subarray(0,4)])}
 if(row.output==='Color'){
  const center=nativeData.get('13x9-Color-direct-defaults'),index=(4*13+6)*4
  assert.deepEqual([...data.subarray(0,4)],[...center.subarray(index,index+4)],'Native Scale-zero Color equals actual direct origin')
 }
 controls.push({case:row.case,sha256:row.pixelSha256,comparedWords:data.length,runtimeConsumerCredit:0})
}
const finalPath=join(nativeFolder,'final-proof.json'),finalPin=hash(await readFile(finalPath)),f=assertFinal(await json(finalPath),q,{built:true,nativeSha256:qPin})
for(const entry of f.provenance){await pin(join(root,entry.source),entry.sha256);await pin(join(root,entry.artifact),entry.sha256)}
for(const row of f.rows){
 for(const kind of ['manifest','glb','presentation','module'])await pin(await owned(nativeFolder,row[kind+'Path']),row[kind+'Sha256'])
 const manifest=await json(row.manifestPath);assert.deepEqual(manifest.sourcePresentation,row.presentationPointer)
 const bytes=await readFile(row.presentationPath);assert.equal(bytes.length,row.presentationPointer.bytes);assert.equal(hash(bytes).slice(0,16),row.presentationPointer.hash)
 const presentation=JSON.parse(bytes),source=q.cases.find(entry=>entry.case===row.case)
 assertProgram(presentation.compositor,source)
 const original=await json(join(nativeFolder,source.programFile));for(const key of ['status','ops','passes','output'])assert.deepEqual(presentation.compositor[key],original[key],'Saved Final source IR differs')
 await pin(join(nativeFolder,source.sourceFile),source.sourceSha256)
}
const archive=await validateNativeArchive(f.nativeArchive,nativeFolder,{expectedFinalSources:await Promise.all(expectedFinalCases().map(row=>realpath(join(nativeFolder,row.case+'.blend')))),expectedScripts:['reference.py','policy.py'].map(name=>({path:join(import.meta.dirname,name),invocations:1})),helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
assert.equal(archive.pythonInvocations,10);assert.equal(archive.finalInvocations,8);assert.equal(archive.uniqueCachePrefixes,10)
assert.equal(f.nativeArchive.proof.invocations.length,11);assert.equal(f.nativeArchive.proof.invocations.filter(row=>JSON.stringify(row.result.args)==='["--version"]').length,1)
const policy=assertPolicy(await json(join(nativeFolder,'policy.json')))
const {provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Default CPU Noise field independent close'})
let runtimeFingerprint,primaryWords=0,caseRuns=0,wordDifferences=0,maximumUlps=0,maximumAbsoluteError=0,resizeFrames=0,lifecycleCycles=0
const runs=[]
const metricKeys=['comparedWords','wordDifferences','contractViolations','maxUlps','maxAbsoluteError','alphaDifferences','latticeControls','latticeDifferences','facBroadcastDifferences']
const normalize=(data,width,height,flip)=>{if(!flip)return data;const copy=new Uint32Array(data.length);for(let y=0;y<height;y++)copy.set(data.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);return copy}
for(const profile of ['metal','software'])for(const phase of ['raw','final']){
 const browser=join(nativeFolder,'browser-'+phase+'-'+profile),path=join(browser,'report.json'),report=assertBrowserRows(await json(path),q,f,{profile,final:phase==='final'})
 assert.equal(report.provenance.nativeQualificationSha256,qPin);if(phase==='final')assert.equal(report.provenance.finalProofSha256,finalPin)
 const fingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(browser,'runtime'),fixtureDirectory:join(browser,'fixture'),fixtureSourceDirectory:import.meta.dirname,fixtureNames})
 runtimeFingerprint??=fingerprint;assert.equal(fingerprint,runtimeFingerprint)
 for(const [name,key]of [['run.mjs','runnerSha256'],['protocol.mjs','protocolSha256']])await pin(join(import.meta.dirname,name),report.provenance[key])
 if(phase==='final'){
  const generated=join(browser,'generated');assert.equal((await lstat(generated)).isSymbolicLink(),false)
  assert.deepEqual((await readdir(generated)).sort(),f.rows.map(row=>basename(row.modulePath)).sort())
  assert.deepEqual(report.provenance.generatedFiles,f.rows.map(row=>({name:basename(row.modulePath),sha256:row.moduleSha256,source:row.modulePath})))
  for(const row of f.rows)await pin(await owned(browser,join(generated,basename(row.modulePath))),row.moduleSha256)
 }else assert.deepEqual(report.provenance.generatedFiles??[],[])
 for(const api of report.rows){
  for(const control of api.coordinateControls){
   const data=await words(browser,join(browser,control.actualFile),control.actualSha256,control.width,control.height)
   assert.deepEqual(normalize(data,control.width,control.height,control.rowFlip),coordinateData.get(control.width+'x'+control.height),'Actual GPU coordinate words changed before Noise evaluation')
  }
  const observations=[]
  for(const row of api.rows){
   const all=[row,...row.resizeResults]
   for(const frame of all){
    const source=q.cases.find(entry=>entry.case===frame.case),data=await words(browser,join(browser,frame.actualFile),frame.actualSha256,source.width,source.height)
    const metrics=compareNoise(data,nativeData.get(frame.case),coordinateData.get(source.width+'x'+source.height),source,frame.rowFlip)
    for(const key of metricKeys)assert.equal(frame[key],metrics[key],'Archived actual words disagree with '+frame.case+' '+key)
    assert.equal(metrics.contractViolations,0);assert.equal(metrics.facBroadcastDifferences,0)
    maximumUlps=Math.max(maximumUlps,metrics.maxUlps);maximumAbsoluteError=Math.max(maximumAbsoluteError,metrics.maxAbsoluteError)
    if(source.route==='direct'&&row.route==='direct')observations.push({cohort:row.width+'x'+row.height+'->'+source.width+'x'+source.height+':'+(frame===row?'primary':'resize'),output:source.output,words:normalize(data,source.width,source.height,frame.rowFlip)})
    if(frame===row){primaryWords+=metrics.comparedWords;caseRuns++;wordDifferences+=metrics.wordDifferences}
   }
   resizeFrames+=row.resizeFrames;lifecycleCycles+=row.lifecycleCycles??0
  }
  assertRedFacObservations(observations)
 }
 runs.push({path:relative(root,path),sha256:hash(await readFile(path)),profile,phase,browserVersion:report.browserVersion,actualApis:report.rows.map(api=>({backend:api.backend,gpu:api.gpu,cases:api.rows.length,savedDispose:api.savedDispose}))})
}
assert.equal(caseRuns,4*(cases.length+expectedFinalCases().length));assert.equal(primaryWords,4*[cases,expectedFinalCases()].flat().reduce((total,row)=>total+row.width*row.height*4,0));assert.equal(resizeFrames,352);assert.equal(lifecycleCycles,96)
const result={schemaVersion:1,status:'QUALIFIED_PARTIAL_COMPOSITOR_NOISE_DEFAULT_FIELD',nativeGraphs:26,nativeOracleControls:15,nativeRenders:41,savedFinalScenes:8,browserCaseRuns:caseRuns,primaryFloat32Words:primaryWords,wordDifferences,contractViolations:0,maxUlps:maximumUlps,maxAbsoluteError:maximumAbsoluteError,precision,resizeFrames,lifecycleCycles,uniqueActualPythonPrefixes:archive.uniqueCachePrefixes,scope:'Pinned Blender5.3 macOS arm64 CPU compositor default2D normalized FBM Fac/Color with original scalar defaults and own unlinked Uniform Vector. Compensated BLI fade, bounded approximate 8ULP AND absolute2^-20 RGB; exact alpha, scaled lattice and Color.red/Fac. No linked/computed controls, native GPU/EEVEE, spatial/image/pass mixtures, arbitrary amplification, whole scene/BSDF or other versions/hosts credit.',policy,closedReader:{runtimeFingerprint,verifierSha256:hash(await readFile(import.meta.filename)),runtimeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs'))),nativeArchiveHelperSha256:hash(await readFile(join(root,'scripts/lib/native-proof-archive.mjs')))},sources:[{native:{path:relative(root,qPath),sha256:qPin},final:{path:relative(root,finalPath),sha256:finalPin},sourceHashes:q.sourceHashes,nativeArchive:archive}],nativeRecords,controls,runs,rawArtifacts:{machineLocal:true,ignored:true,path:relative(root,directory)}}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_NOISE_DEFAULT_FIELD_QUALIFIED '+JSON.stringify({caseRuns,primaryWords,wordDifferences,maxUlps:maximumUlps,resizeFrames,lifecycleCycles}))
