/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from '../../scripts/lib/runtime-proof-archive.mjs'
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]);assert.ok(process.argv[2])
const read=async file=>JSON.parse(await readFile(file)),plan=await read(join(import.meta.dirname,'cases.json')),native=await read(join(directory,'native.json')),nativeClosed=await read(join(directory,'native-closed.json'))
assert.equal(native.status,'CAPTURED_VECTOR_ROTATE_NATIVE_PILOT');assert.equal(native.gpuInitializations,0);assert.equal(native.supportCredit,0);assert.equal(hash(await readFile(join(directory,'native.json'))),nativeClosed.nativeSha256)
assert.deepEqual(native.cases.map(row=>row.case),plan.cases.map(row=>row.case));assert.equal(native.cases.length,22)
const source=await read(join(directory,'source.json'));assert.deepEqual(source.cases.map(row=>row.program),native.cases.map(row=>row.program))
for(const [file,pin]of Object.entries(nativeClosed.sourcePins))assert.equal(hash(await readFile(join(root,file))),pin,'Native source changed: '+file)
const nativeArchive=await validateNativeArchive(await read(join(directory,'native-archive.json')),directory,{expectedScripts:[{path:join(root,'experiments/compositor-vector-rotate/pilot.py'),invocations:2}],expectedFinalSources:[],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
const bytes=async(folder,pin)=>{const data=await readFile(join(folder,pin.file??pin.rawFile));assert.equal(hash(data),pin.sha256??pin.rawSha256);if(pin.bytes!==undefined)assert.equal(data.length,pin.bytes);return data}
const words=buffer=>Array.from({length:buffer.length/4},(_,i)=>buffer.readUInt32LE(i*4))
const equalWords=(actual,expected)=>{assert.equal(actual.length,expected.length);for(let i=0;i<actual.length;i++)assert.equal(actual[i],expected[i],'Raw word '+i)}
const rotate=(value,bits)=>((value<<bits)|(value>>>(32-bits)))>>>0
function hash32(...items){
 let a=(0xdeadbeef+(items.length<<2)+13)>>>0,b=a,c=a;a=(a+items[0])>>>0;if(items.length>1)b=(b+items[1])>>>0
 c=((c^b)-rotate(b,14))>>>0;a=((a^c)-rotate(c,11))>>>0;b=((b^a)-rotate(a,25))>>>0;c=((c^b)-rotate(b,16))>>>0;a=((a^c)-rotate(c,4))>>>0;b=((b^a)-rotate(a,14))>>>0;return((c^b)-rotate(b,24))>>>0
}
const hashWord=value=>hash32(hash32(value),0),expected=new Map(),pixelExpected=new Map()
let nativeWords=0,preStoreWords=0
for(const row of native.cases){
 const spec=plan.cases.find(candidate=>candidate.case===row.case);for(const key of Object.keys(spec))assert.deepEqual(row[key],spec[key])
 const program=await bytes(directory,row.program);assert.equal(JSON.parse(program).status,'extracted')
 const raw=await bytes(directory,row.pixels),values=words(raw);assert.equal(raw.length,row.width*row.height*16)
 const low=await bytes(directory,row.preStoreLow),high=await bytes(directory,row.preStoreHigh),hashes=words(await bytes(directory,row.preStoreHashes));assert.equal(low.length,raw.length);assert.equal(high.length,raw.length);assert.equal(hashes.length,row.width*row.height*3)
 for(let pixel=0;pixel<row.width*row.height;pixel++)for(let lane=0;lane<4;lane++){
  const index=pixel*4+lane,bits=values[index],magnitude=bits&0x7fffffff;assert.ok(bits!==0x80000000&&(magnitude===0||magnitude>=0x00800000&&magnitude<0x7f800000))
  if(lane===3){assert.equal(bits,0x3f800000);assert.equal(low.readUInt32LE(index*4),0x3f800000);assert.equal(high.readUInt32LE(index*4),0x3f800000);continue}
  const lo=low.readFloatLE(index*4),hi=high.readFloatLE(index*4);assert.ok(Number.isInteger(lo)&&lo>=0&&lo<65536&&Number.isInteger(hi)&&hi>=-32768&&hi<32768)
  const actual=((hi&65535)*65536+lo)>>>0;assert.equal(actual,hashes[pixel*3+lane]);assert.equal(actual,hashWord(bits));preStoreWords++
 }
 expected.set(row.case,values);nativeWords+=values.length
}
for(const row of native.pixelControls){const raw=await bytes(directory,row),values=words(raw);assert.equal(raw.length,row.width*row.height*16);for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++){const offset=(y*row.width+x)*16;assert.equal(raw.readFloatLE(offset),x);assert.equal(raw.readFloatLE(offset+4),row.nativeDomainFlipY?row.height-1-y:y);assert.equal(raw.readFloatLE(offset+8),0);assert.equal(raw.readFloatLE(offset+12),1)}pixelExpected.set(row.width+'x'+row.height,values)}
assert.equal(native.nativeRenders,native.cases.length*3+native.pixelControls.length);assert.equal(preStoreWords,native.preStoreComponentWords)
const {provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Vector Rotate pilot close'})
let comparedWords=0,orientationWords=0,runtimeFingerprint;const reports=[]
for(const profile of['metal','software']){
 const folder=join(directory,'browser-r2-'+profile),path=join(folder,'report.json'),report=await read(path)
 assert.equal(report.status,'PASSED_RESEARCH_ONLY_VECTOR_ROTATE_BUILT_PILOT');assert.equal(report.profile,profile);assert.equal(report.supportCredit,0)
 assert.equal(report.provenance.nativeSha256,hash(await readFile(join(directory,'native.json'))));assert.equal(report.provenance.runnerSha256,hash(await readFile(join(import.meta.dirname,'run-pilot.mjs'))));assert.equal(report.provenance.rawArchiveSha256,hash(await readFile(join(import.meta.dirname,'raw-words.mjs'))))
 const fingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(folder,'runtime'),fixtureDirectory:join(folder,'fixture'),fixtureSourceDirectory:import.meta.dirname,fixtureNames:['pilot-browser.js','index.html']});if(runtimeFingerprint)assert.equal(fingerprint,runtimeFingerprint);runtimeFingerprint=fingerprint
 assert.deepEqual(report.rows.map(row=>row.backend),['webgpu','webgl2'])
 for(const api of report.rows){
  assert.equal(api.status,'PASSED_RESEARCH_ONLY_VECTOR_ROTATE_BROWSER_PILOT');assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[])
  if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
  assert.deepEqual(api.rows.map(row=>row.case),native.cases.map(row=>row.case));assert.deepEqual(api.orientation.map(row=>[row.width,row.height]),native.pixelControls.map(row=>[row.width,row.height]))
  for(const row of api.orientation){const raw=await bytes(folder,row),value=words(raw);equalWords(value,pixelExpected.get(row.width+'x'+row.height));assert.equal(row.words,value.length);assert.equal(row.wordDifferences,0);orientationWords+=value.length}
  for(const row of api.rows){
   const spec=native.cases.find(candidate=>candidate.case===row.case);for(const key of['width','height','pixelRatio','kind'])assert.equal(row[key],spec[key])
   assert.deepEqual(row.samples.map(sample=>sample.frame),[0,1]);assert.equal(row.rowBindings,spec.kind==='normalized'?1:0);assert.equal(row.maximumRowBytes,spec.kind==='normalized'?Math.max(spec.width,spec.height)*8:0);assert.equal(row.warmUploads,0);assert.equal(row.callerClearPreserved,true)
   assert.ok(spec.kind==='normalized'?row.producerEntries>=2&&row.producerEntries<=3:row.producerEntries===0)
   for(const sample of row.samples){const raw=await bytes(folder,sample),value=words(raw);equalWords(value,expected.get(row.case));assert.equal(sample.words,value.length);assert.equal(sample.wordDifferences,0);assert.equal(sample.rowUploads,sample.frame===0&&spec.kind==='normalized'?1:0);comparedWords+=value.length}
  }
  assert.deepEqual(api.negatives.map(row=>row.kind),['replaced-producer','invalid-extent']);assert.match(api.negatives[0].error,/Vector Rotate.*PassNode/);assert.match(api.negatives[1].error,/physical extents/)
  assert.deepEqual(api.savedDispose.perHandleDestroys,[1]);assert.equal(api.savedDispose.physicalDestroys,1);assert.equal(api.savedDispose.distinctHandles,1);assert.equal(api.savedDispose.externalDevice,api.backend==='webgpu')
 }
 reports.push({profile,path,sha256:hash(await readFile(path))})
}
const result={schemaVersion:1,status:'CLOSED_RESEARCH_ONLY_VECTOR_ROTATE_BUILT_PILOT',supportCredit:0,FinalCredit:0,nativeCases:native.cases.length,nativeRenders:native.nativeRenders,nativeOutputWords:nativeWords,preStoreComponentHashWords:preStoreWords,browserCases:native.cases.length*4,browserFrames:native.cases.length*8,comparedWords,wordDifferences:0,independentOrientationWords:orientationWords,savedOriginalDisposeOwnedHandles:4,runtimeFingerprint,nativeArchive,sourcePins:nativeClosed.sourcePins,reports,nativeReportSha256:hash(await readFile(join(directory,'native.json'))),pilotLimitations:['No saved Final/public preparation qualification.','No capability promotion.','Original browser-r1 records are retained unclosed because their serializer removed numeric word counts; fresh browser-r2 records are authoritative for this pilot.']}
await writeFile(resolve(process.argv[3]??join(directory,'pilot-closed.json')),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,comparedWords,wordDifferences:0,runtimeFingerprint}))
