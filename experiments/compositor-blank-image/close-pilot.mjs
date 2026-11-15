/* SPDX-License-Identifier: MIT */
/** CPU-only second closure. Retains the first pilot receipt verbatim. */
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from '../../scripts/lib/runtime-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]);assert.ok(process.argv[2])
const originalBytes=await readFile(join(directory,'pilot-closed.json')),original=JSON.parse(originalBytes),source=JSON.parse(await readFile(join(directory,'pilot-source.json'))),pins=JSON.parse(await readFile(join(directory,'source-pins.json')))
assert.equal(original.status,'CLOSED_BLANK_IMAGE_RAW_PILOT');assert.equal(original.supportCredit,0);assert.equal(original.finalCredit,0)
for(const [file,pin]of Object.entries(pins))assert.equal(hash(await readFile(join(root,file))),pin)
assert.equal(hash(await readFile(join(directory,'pilot-source.json'))),original.nativeSourceSha256);assert.equal(hash(await readFile(join(directory,'native-archive.json'))),original.nativeArchiveSha256)
const {provenance:current}=await captureRuntimeProvenance({root,built:true,label:'Blank Image independent pilot closure'}),reports=[];let runtimeFingerprint,primaryWords=0
for(const profile of['metal','software']){
 const file=profile+'/report.json',bytes=await readFile(join(directory,file)),report=JSON.parse(bytes);assert.equal(report.status,'PASSED_BLANK_IMAGE_RAW_PILOT');assert.equal(hash(bytes),original.reports.find(r=>r.profile===profile).sha256)
 const fingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(directory,profile,'runtime'),fixtureDirectory:join(directory,profile,'fixture'),fixtureSourceDirectory:import.meta.dirname,fixtureNames:['pilot-browser.js','pilot-index.html']});if(runtimeFingerprint)assert.equal(fingerprint,runtimeFingerprint);runtimeFingerprint=fingerprint
 assert.deepEqual(report.rows.map(row=>row.backend),['webgpu','webgl2'])
 for(const row of report.rows){
  assert.deepEqual(row.rows.map(result=>result.case),source.rows.map(result=>result.case));assert.equal(row.gpu.api,row.backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(row.errors,[]);assert.deepEqual(row.pageErrors,[]);assert.equal(row.remainingTextures,0);assert.equal(row.remainingRenderTargets,0)
  if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}else assert.match(JSON.stringify(row.gpu),/swiftshader/i)
  for(const [index,result]of row.rows.entries()){
   const expected=source.rows[index];assert.equal(result.wordCount,expected.width*expected.height*4);assert.equal(result.exactWordDifferences,0);assert.equal(result.firstUploads,2);assert.equal(result.warmUploads,0);assert.equal(result.drawCalls,1);assert.equal(result.mappingTextures,2);assert.equal(result.mappingBytes,262144);assert.equal(result.sourceRenderTargets,0);assert.equal(result.dprRecovery,true);assert.match(result.invalidViewportRefusal,/Blank Image.*full-frame/);primaryWords+=result.wordCount
   assert.equal(hash(await readFile(join(directory,expected.programFile))),expected.programSha256);assert.equal(hash(await readFile(expected.pixelFile)),expected.pixelSha256)
  }
 }
 reports.push({file,sha256:hash(bytes),adapters:report.rows.map(row=>({backend:row.backend,gpu:row.gpu}))})
}
const result={status:'CLOSED_BLANK_IMAGE_RAW_PILOT_REVIEW',supportCredit:0,finalCredit:0,runtimeFingerprint,originalReceipt:{file:'pilot-closed.json',sha256:hash(originalBytes)},sourcePinsSha256:hash(await readFile(join(directory,'source-pins.json'))),nativeSourceSha256:original.nativeSourceSha256,nativeArchiveSha256:original.nativeArchiveSha256,producerCases:source.rows.length,browserCases:source.rows.length*4,primaryWords,exactWordDifferences:0,mappingBytesPerPipeline:262144,sourceRenderTargetsPerPipeline:0,firstUploads:2,warmUploads:0,drawCallsPerFrame:1,remainingTextures:0,remainingRenderTargets:0,reports,limits:['Raw feasibility only; no actual saved Final or category promotion.','Retained independently rendered native CPU references; source programs freshly extracted without rendering.','Native Image Info and coordinates consumer controls remain unqualified.','First-frame comparisons are independent raw native words; same-physical-extent DPR and invalid-viewport recovery are repeated pixel checks.','Source-sized constant RTT is absent; two existing coordinate tables remain allocated.','No larger physical resize, partial allocation, saved renderer disposal or public installer proof in this pilot.']}
await writeFile(join(directory,'pilot-review.json'),JSON.stringify(result,null,2)+'\n');console.log(result.status,primaryWords)
