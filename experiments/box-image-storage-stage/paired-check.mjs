// SPDX-License-Identifier: GPL-3.0-or-later
// Extend the existing immutable-stage reader; no new numeric gate or oracle.
import assert from'node:assert/strict'
import{readFile,writeFile}from'node:fs/promises'
import{join,resolve}from'node:path'
import{createHash}from'node:crypto'
import{readRgb8Png,mipChain,byte}from'./mip-model-bsl-f32.mjs'

import{execFileSync}from'node:child_process'
import{pathToFileURL}from'node:url'
export async function closePaired(nativeDir,browserDir,producerRoot){
 assert.ok(producerRoot,'Exact retained native producer checkout is required')
 const frozen=resolve(producerRoot),expected='09b5310d8202fb191d1caeb335d169110b35c2f0'
 assert.equal(execFileSync('git',['-C',frozen,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),expected)
 for(const name of ['capture.py','geometry_fixture.py','compare.mjs','orientation-check.mjs']){
  const relative='experiments/box-image-storage-stage/'+name
  const bytes=await readFile(join(frozen,relative))
  assert.deepEqual(bytes,execFileSync('git',['-C',frozen,'show',expected+':'+relative]))
  assert.deepEqual(bytes,await readFile(new URL(name,import.meta.url)))
 }
 const{orientedDiagnostic}=await import(pathToFileURL(join(frozen,'experiments/box-image-storage-stage/orientation-check.mjs')))
 const{closeStage}=await import(pathToFileURL(join(frozen,'experiments/box-image-storage-stage/compare.mjs')))

 const oriented=await orientedDiagnostic(nativeDir,browserDir),raw=await closeStage(nativeDir,browserDir)
 const browser=JSON.parse(await readFile(join(browserDir,'browser.json'))),native=JSON.parse(await readFile(join(nativeDir,'native.json')))
 const sha=b=>createHash('sha256').update(b).digest('hex')
 for(const api of browser.apis){
  if(api.backend==='webgl2')assert.equal(api.webgpuAvailableAtStart,false)
  assert.ok(api.deviceLosses.every(loss=>api.backend==='webgl2'&&loss.owner==='generator'&&loss.reason==='destroyed'))
  const g=api.customMipGeneration;assert.equal(g.api,(api.backend==='webgpu'?'WebGPU':'WebGL2')+'-sRGB/CPU-UNORM');assert.match(JSON.stringify(g.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(g.gpu),/swiftshader/i)
  assert.equal(g.images.length,2)
  for(const image of g.images){
   const srgb=native.images.find(n=>n.name===image.image).colorSpace==='sRGB'
   assert.equal(image.model,srgb?(api.backend==='webgpu'?'paired-pow2-bsl-shared-srgb-typed-attachment-v1':'paired-pow2-bsl-shared-srgb-gl2-typed-v1'):'cpu-paired-unorm-store-no-extra-f32-v1');assert.deepEqual(image.errors,[])
   assert.equal(image.format,native.images.find(n=>n.name===image.image).colorSpace==='sRGB'?'rgba8unorm-srgb':'rgba8unorm')
   const cpuLevels=srgb?null:mipChain(readRgb8Png(await readFile(join(nativeDir,native.images.find(n=>n.name===image.image).file))),false,true)
   assert.equal(image.levels.length,11);assert.equal(image.ownedTextures,srgb?11:0);assert.equal(image.readbackBuffers,srgb&&api.backend==='webgpu'?10:0)
   for(const[level,mip]of image.levels.entries()){
    assert.equal(mip.width,1024>>level);assert.equal(mip.height,mip.width)
    const bytes=await readFile(join(browserDir,mip.file));assert.equal(bytes.length,mip.width*mip.height*4);assert.equal(sha(bytes),mip.sha256)
    if(cpuLevels)assert.deepEqual(bytes,Buffer.from(Uint8Array.from(cpuLevels[level].linear,byte)))
   }
  }
 }
 const lod=raw.lodRows.filter(r=>r.kind==='linear')
 assert.equal(lod.length,44)
 return{status:'CUSTOM_PAIRED_MIP_RESEARCH_ZERO_SUPPORT_CREDIT',supportCredit:0,installedSceneCredit:0,fullArchvizCredit:0,
  nativeProducer:{root:frozen,sourceCommit:expected},bound:2**-10,adapter:oriented.adapter,lodRows:lod,lodSummary:native.images.map(n=>{const rows=lod.filter(r=>r.image===n.name);return{image:n.name,rows:rows.length,words:rows.reduce((s,r)=>s+r.words,0),violations:rows.reduce((s,r)=>s+r.violations,0),maxAbs:Math.max(...rows.map(r=>r.maxAbs))}}),
  invalidPositiveLodFetchRowsRetained:raw.lodRows.filter(r=>r.kind==='fetch').length,
  stageTotals:oriented.stageTotals,rows:oriented.rows,nativeSha256:raw.nativeSha256,browserSha256:raw.browserSha256}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const result=await closePaired(resolve(process.argv[2]),resolve(process.argv[3]),process.argv[5]);await writeFile(resolve(process.argv[4]),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({lod:result.lodSummary,samplers:result.stageTotals.find(r=>r.kind==='sampler')}))
}
