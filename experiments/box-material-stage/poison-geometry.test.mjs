import assert from'node:assert/strict'
import{test}from'node:test'
import{BufferGeometry,Float32BufferAttribute,Uint8BufferAttribute,InterleavedBuffer,InterleavedBufferAttribute}from'three'
import{poisonGeometryPair}from'./poison-geometry.js'
test('both test geometries preserve indexed source bytes and own independent poison buffers',()=>{
 const source=new BufferGeometry().setIndex([0,1,2]).setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)).setAttribute('normal',new Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3)).setAttribute('color',new Uint8BufferAttribute([255,0,0,0,255,0,0,0,255],3,true)),pair=poisonGeometryPair(source)
 assert.deepEqual(Array.from(pair.positive.getAttribute('color').array),Array.from(pair.negative.getAttribute('color').array));assert.notEqual(pair.positive.getAttribute('color').array,pair.negative.getAttribute('color').array);assert.equal(pair.negative.getAttribute('color').itemSize,4)
 pair.assertSourceUnchanged();pair.positive.dispose();pair.negative.dispose();pair.assertSourceUnchanged();source.dispose()
})
test('interleaved source storage remains byte-identical and independent through scoped disposal',()=>{
 const storage=new InterleavedBuffer(new Float32Array([0,0,0,0,0,1,1,0,0,0,0,1,0,1,0,0,0,1]),6),source=new BufferGeometry().setAttribute('position',new InterleavedBufferAttribute(storage,3,0)).setAttribute('normal',new InterleavedBufferAttribute(storage,3,3)),pair=poisonGeometryPair(source)
 assert.notEqual(pair.positive.getAttribute('normal').data.array,storage.array);pair.positive.dispose();pair.negative.dispose();pair.assertSourceUnchanged();storage.array[0]=.5;assert.throws(()=>pair.assertSourceUnchanged(),/Caller attribute changed/);source.dispose()
})
