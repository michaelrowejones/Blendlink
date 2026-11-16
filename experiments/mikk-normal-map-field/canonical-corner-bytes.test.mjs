import assert from'node:assert/strict'
import test from'node:test'
import{readFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js'
import{canonicalCornerBytes}from'./canonical-corner-bytes.mjs'
const sha=b=>createHash('sha256').update(b).digest('hex')
test('canonicalization validates identity and preserves words without changing source buffers',()=>{
 const array=new Float32Array([3,-0,1,2]),before=new Uint32Array(array.buffer).slice(),a={array,itemSize:2,count:2,normalized:false}
 assert.deepEqual(new Uint32Array(canonicalCornerBytes(a,[1,0],2).buffer),new Uint32Array(new Float32Array([1,2,3,-0]).buffer));assert.deepEqual(new Uint32Array(array.buffer),before)
 for(const ids of [[0,0],[-1,0],[0,2],[0,.5],[0]])assert.throws(()=>canonicalCornerBytes(a,ids,2))
 assert.throws(()=>canonicalCornerBytes({...a,normalized:true},[0,1],2))
})
test('actual GLTFLoader payloads match source-loop hashes despite exporter vertex reordering',async()=>{
 const directory='/tmp/scenetoweb-real-mikk-normal-native-r1/capture',report=JSON.parse(await readFile(directory+'/report.json'))
 let permuted=0
 for(const row of report.rows){const m=JSON.parse(await readFile(directory+'/'+row.file))
  for(const ex of m.exports){const bytes=await readFile(directory+'/'+ex.file),loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');let mesh;loaded.scene.traverse(o=>{if(o.isMesh)mesh=o});const ids=mesh.geometry.getAttribute('_stw_corner').array
   for(const name of ['_STW_FRAME_N','_STW_FRAME_T','_STW_FRAME_SIGN','_STW_CORNER']){const a=mesh.geometry.getAttribute(name.toLowerCase()),raw=new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength);assert.equal(sha(canonicalCornerBytes(a,ids,m.loops)),m.attributes[name].sha256);if(sha(raw)!==m.attributes[name].sha256)permuted++}
   mesh.geometry.dispose();mesh.material.dispose()
  }
 }
 assert.ok(permuted>0)
})
