// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import{evaluateMipModels as before}from'./model-check-unorm-store.mjs'
import{evaluateMipModels as after}from'./model-check-bsl-f32.mjs'
const native=process.env.BOX_STORAGE_NATIVE
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
test('source Float32 transfer correction preserves normal LOD passes and unchanged sRGB failures', {skip:native?false:'Requires immutable native-r3 artifacts'},async()=>{
 const a=await before(native),b=await after(native)
 const srgb=r=>r.rows.filter(x=>x.image==='Plaster-Overlay.png')
 assert.deepEqual(srgb(b),srgb(a))
 const normals=b.rows.filter(x=>x.image==='Plaster-normal.png'&&x.model==='native-paired-shared-srgb')
 assert.equal(normals.length,11);assert.ok(normals.every(x=>x.violations===0))
 assert.ok(srgb(b).some(x=>x.violations>0));assert.equal(b.supportCredit,0)
 const pins=JSON.parse(await readFile(new URL('unorm-store-evidence.json',import.meta.url))).nativeSourcePins
 for(const[path,hash]of Object.entries(pins))assert.equal(sha(await readFile(path)),hash)
})

const prior=process.env.BOX_PAIRED_PRIOR
const producer=process.env.BOX_NATIVE_PRODUCER
test('the combined source-domain reader refuses borrowing the prior GPU-UNORM experiment', {skip:native&&prior&&producer?false:'Requires immutable prior browser and producer artifacts'},async()=>{
 const{closePaired}=await import('./paired-check.mjs')
 await assert.rejects(()=>closePaired(native,prior,producer),/WebGPU-sRGB\/CPU-UNORM/)
})
