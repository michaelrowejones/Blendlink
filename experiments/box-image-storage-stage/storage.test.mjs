// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeStage } from './compare.mjs'
import { orientedDiagnostic } from './orientation-check.mjs'
import { evaluateMipModels } from './model-check.mjs'
const native=process.env.BOX_STORAGE_NATIVE,browser=process.env.BOX_STORAGE_BROWSER,skip=native&&browser?false:'Requires immutable storage-stage native/browser artifacts'
test('frozen failed matrix replays byte-identically, with observed native/candidate byte formats', {skip},async()=>{
 const result=await closeStage(native,browser)
 assert.equal(JSON.stringify(result,null,2)+'\n',await readFile(join(browser,'closed.json'),'utf8'))
 const n=JSON.parse(await readFile(join(native,'native.json'))),b=JSON.parse(await readFile(join(browser,'browser.json')))
 assert.deepEqual(n.textureObservations.map(i=>i.gpuFormat),['SRGB8_A8','RGBA8'])
 for(const t of n.textureObservations){assert.equal(t.isFloat,false);assert.deepEqual(t.observedMipSizes,Array.from({length:11},(_,i)=>[1024>>i,1024>>i]))}
 assert.deepEqual(b.apis[0].actualTextureFormats.map(i=>i.webgpu),['rgba8unorm-srgb','rgba8unorm'])
 assert.deepEqual(b.apis[1].actualTextureFormats.map(i=>i.webglInternalFormat),[35907,32856])
 assert.equal(result.stageTotals.find(r=>r.kind==='normal').violations,53)
 assert.ok(result.lodRows.some(r=>r.kind==='linear'&&r.violations>0));assert.equal(result.supportCredit,0)
})
test('one backend row-origin correction closes independent face, position, normal and linked-weight controls', {skip},async()=>{
 const result=await orientedDiagnostic(native,browser)
 for(const kind of ['mask','input','normal','weights','face','position'])assert.equal(result.stageTotals.find(r=>r.kind===kind).violations,0,kind)
 assert.equal(result.stageTotals.find(r=>r.kind==='face').maxAbs,0)
 assert.ok(result.stageTotals.find(r=>r.kind==='sampler').violations>0)
 assert.equal(result.supportCredit,0)
})
test('source-paired intermediate improves all even Non-Color LODs while retaining unresolved odd/sRGB failures', {skip},async()=>{
 const result=await evaluateMipModels(native),normal=result.rows.filter(r=>r.image==='Plaster-normal.png')
 for(const level of [2,4,6,8,10]){
  assert.equal(normal.find(r=>r.model==='native-paired-shared-srgb'&&r.level===level).violations,0)
  assert.ok(normal.find(r=>r.model==='stored-box'&&r.level===level).violations>0)
 }
 assert.ok(normal.some(r=>r.model==='native-paired-shared-srgb'&&r.level%2===1&&r.violations>0))
 assert.ok(result.rows.some(r=>r.image==='Plaster-Overlay.png'&&r.violations>0))
 assert.ok(result.fetchBaseAlias.every(r=>r.violations===0))
 assert.equal(result.supportCredit,0)
})
