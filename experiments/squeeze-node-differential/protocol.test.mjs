import assert from 'node:assert/strict'
import test from 'node:test'
import {assertSqueezeBackend,assertSqueezeApiSet,assertSqueezeSourceNA,assertSqueezeLinuxCanary} from './protocol.mjs'
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
test('the production canary rejects source N/A, changed native profiles, missing cases and fallback-only reports',()=>{
 const cases=Array.from({length:26},(_,i)=>({id:i?'case-'+i:'calibration'}))
 const row=backend=>({backend,gpu:{api:backend==='webgpu'?'WebGPU':'WebGL2',renderer:'SwiftShader'},failures:[],pageErrors:[],rows:cases.map(item=>({...item,max:0,remainingTextures:0}))})
 const report=()=>({status:'passed',built:true,rows:[row('webgpu'),row('webgl2')]})
 const packet={suite:{status:'passed',productionCases:25},references:{version:[5,2,0],build:'fbe6228777e7',backend:{backend:'OPENGL',renderer:'llvmpipe (LLVM 20.1.2, 256 bits)'},sourcePreserved:true,cases},reports:{raw:report(),final:report()}}
 assertSqueezeLinuxCanary(packet)
 for(const mutate of [
  p=>{p.suite.status='SOURCE_ATTESTATION_NA';p.suite.productionCases=0},
  p=>{p.references.build='unknown'},p=>{p.references.backend.renderer='unmeasured driver'},
  p=>{p.references.version=[5,3,0]},p=>{p.references.cases.pop()},
  p=>{p.reports.raw.rows=[row('webgl2'),row('webgl2')]},
  p=>{p.reports.final.rows[0].rows.pop()},p=>{p.reports.final.rows[0].rows[0].remainingTextures=1},
  p=>{p.reports.final.rows[0].rows[0].max=NaN},
 ]){const changed=structuredClone(packet);mutate(changed);assert.throws(()=>assertSqueezeLinuxCanary(changed))}
})
