import assert from 'node:assert/strict'
import test from 'node:test'
import {assertSqueezeBackend,assertSqueezeApiSet,assertSqueezeSourceNA} from './protocol.mjs'
test('two WebGL2 fallbacks cannot impersonate requested WebGPU and unique API coverage',()=>{
 const gl={backend:'webgl2',gpu:{api:'WebGL2'}},wg={backend:'webgpu',gpu:{api:'WebGPU'}}
 assertSqueezeApiSet([wg,gl]);assertSqueezeBackend(wg,'webgpu')
 assert.throws(()=>assertSqueezeBackend(gl,'webgpu'),/cannot silently fall back/)
 assert.throws(()=>assertSqueezeApiSet([gl,gl]));assert.throws(()=>assertSqueezeApiSet([wg]))
 assert.throws(()=>assertSqueezeBackend({...wg,gpu:{api:'WebGL2'}},'webgpu'))
})
test('source N/A requires the current fixture, a named admission refusal and zero production cases',()=>{
 const packet={status:'SOURCE_ATTESTATION_NA',version:[4,2,0],productionCases:0,reason:'Squeeze Value source attestation is N/A in Blender 4.2 background export',fixtureSha256:'a'.repeat(64),nativeResearchRetained:'native_probe.py supports the actual native function independently'}
 assertSqueezeSourceNA(packet,'a'.repeat(64))
 for(const patch of [{productionCases:1},{status:'passed'},{fixtureSha256:'b'.repeat(64)},{version:[5,4,0]},{version:['4','2','0']},{reason:'Squeeze Value requires exact Float32 literals'}, {extra:true}])assert.throws(()=>assertSqueezeSourceNA({...packet,...patch},'a'.repeat(64)))
})
