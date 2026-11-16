import assert from 'node:assert/strict'
import test from 'node:test'
import{readFile}from'node:fs/promises'
import{sourceCpuRawOrco,sourceOrcoAttribute,sourceGeneratedAttribute}from'./orco-attribute.mjs'
const directory=process.env.ORCO_CPU_NATIVE

test('native CPU field words survive per-vertex transport without an axis swizzle', {skip:directory?false:'Requires native CPU field capture'},async()=>{
 const native=JSON.parse(await readFile(directory+'/native.json'));let words=0
 for(const row of native.cases){
  const raw=sourceCpuRawOrco(row.positions.flat(),row.location,row.size),expected=Float32Array.from(row.nativeCpuRawOrco.flat())
  assert.deepEqual(new Uint32Array(raw.buffer),new Uint32Array(expected.buffer));words+=raw.length
  const attr=sourceOrcoAttribute(raw);assert.deepEqual(new Uint32Array(attr.array.buffer),new Uint32Array(raw.buffer));assert.equal(attr.normalized,false)
  assert.notStrictEqual(attr.array,raw)
  const wrong=sourceCpuRawOrco(row.positions.flat(),row.location.map(v=>v+.125),row.size)
  assert.notDeepEqual(new Uint32Array(wrong.buffer),new Uint32Array(expected.buffer))
 }
 assert.equal(words,36)
})
test('rejects unproved degenerate texspace and explicitly puts raw ORCO conversion before interpolation',()=>{
 assert.throws(()=>sourceCpuRawOrco([1,2,3],[0,0,0],[1,0,1]))
 assert.throws(()=>sourceOrcoAttribute(new Float32Array([NaN,0,0])))
 const field=sourceGeneratedAttribute();assert.equal(field.isVaryingNode,true)
})
