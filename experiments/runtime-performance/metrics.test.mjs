import assert from 'node:assert/strict'
import test from 'node:test'
import {distribution,resourceSnapshot,validateBenchmarkConfig} from './metrics.mjs'
import {programDrawBindings} from './metrics.mjs'
test('mixed material meshes witness only their own installed node slots, never visible carrier slots',()=>{
 const carrier={},node={isNodeMaterial:true},otherNode={isNodeMaterial:true},mixed={material:[carrier,node,null]},other={material:otherNode},plain={material:carrier}
 const bindings=programDrawBindings([mixed,other,plain])
 assert.equal(bindings.size,2);assert.equal(bindings.get(mixed).has(node),true);assert.equal(bindings.get(mixed).has(carrier),false)
 assert.equal(bindings.get(mixed).has(otherNode),false);assert.equal(bindings.has(plain),false);assert.equal(mixed.material[0],carrier)
})
test('nearest-rank percentiles retain raw samples without mutating acquisition order',()=>{const x=[9,1,5,3,7],r=distribution(x);assert.deepEqual(r.samples,x);assert.equal(r.p50Ms,5);assert.equal(r.p95Ms,9);assert.deepEqual(x,[9,1,5,3,7]);assert.equal(distribution([0]).p95Ms,0)})
test('absent/invalid samples never become zero-valued measurements',()=>{for(const x of [[],[NaN],[Infinity],[-1],null])assert.throws(()=>distribution(x));assert.equal(resourceSnapshot({}).memory.textures,null);assert.equal(resourceSnapshot({info:{memory:{textures:0},render:{drawCalls:4,calls:100}}}).render.drawCalls,4)})
test('capture limits and animation policy are explicit',()=>{const c={width:320,height:180,dpr:1,warmupFrames:5,measuredFrames:30,repeats:1,gpuSamples:0,animation:'paused',fixedDeltaSeconds:1/60};assert.equal(validateBenchmarkConfig(c),c);for(const patch of [{dpr:NaN},{measuredFrames:0},{repeats:11},{width:9999},{animation:'authored'},{gpuSamples:-1}])assert.throws(()=>validateBenchmarkConfig({...c,...patch}))})
import {resolveWebglTimer} from './metrics.mjs'
test('GPU query durations come only from actual completed, non-disjoint query results',async()=>{
 for(const mode of ['ok','disjoint','timeout']){
  let time=0,deleted=0,polls=0
  const gl={QUERY_RESULT_AVAILABLE:1,QUERY_RESULT:2,getParameter:()=>mode==='disjoint',getQueryParameter:(_q,type)=>type===1?mode==='ok'&&++polls>1:2_000_000,deleteQuery:()=>deleted++}
  const result=await resolveWebglTimer(gl,{GPU_DISJOINT_EXT:3},{},{timeoutMs:3,now:()=>time,delay:async()=>{time++}})
  assert.equal(result.value,mode==='ok'?2:null);assert.equal(deleted,1);if(mode!=='ok')assert.ok(result.reason)
 }
})
import {captureOwnership,ownershipRestored} from './metrics.mjs'
test('ownership checks detect in-place material-array leaks and private geometry leaks',()=>{const mesh={material:[{},{}],geometry:{},onBeforeRender(){}};const original=[captureOwnership(mesh)];assert.equal(ownershipRestored(original),true);const slot=mesh.material[0];mesh.material[0]={};assert.equal(ownershipRestored(original),false);mesh.material[0]=slot;const geometry=mesh.geometry;mesh.geometry={};assert.equal(ownershipRestored(original),false);mesh.geometry=geometry;assert.equal(ownershipRestored(original),true)})
