import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validatedBaseColorProgramMaterials } from './compiledMaterialPrograms.js'
import { inspectCompiledSceneConformance } from './compiledSceneConformance.js'
import type { SceneManifest } from './typegen.js'
const scalar=(value:number)=>({op:'const_float',value})
const output={op:'noise_varying_native',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',perlinModel:'eevee-metal-periodic-f32',
  normalize:true,noiseType:'FBM',output:'color',dimensions:3,detail:1.5,roughness:1,lacunarity:1.7,scale:scalar(1),input:{op:'uv'},
  colorOffsets:[[100,120,130],[150,160,170]],roughnessNode:{op:'clamp_minmax',value:{op:'separate',channel:'x',input:{op:'uv'}},min:scalar(0),max:scalar(1)}}
const gltf={materials:[{name:'Live.BLENDLINK_TSL',extras:{blendlink_source_material:'Live'}}],meshes:[{primitives:[{material:0,attributes:{POSITION:0,TEXCOORD_0:1}}]}]}
async function audit(changes:Record<string,unknown>={}){
 const bytes=new TextEncoder().encode(JSON.stringify({schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Live:{channels:{'Base Color':{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{...output,...changes}}}}}}}))
 const manifest={materialPrograms:{url:'/scene.materials.json',bytes:bytes.length,hash:createHash('sha256').update(bytes).digest('hex').slice(0,16),materials:1}} as Pick<SceneManifest,'materialPrograms'>
 const accepted=await validatedBaseColorProgramMaterials(gltf,manifest,bytes)
 return inspectCompiledSceneConformance({gltf,validatedBaseColorProgramMaterials:accepted}).issues.map(issue=>issue.code)
}
describe('published native live Roughness programs',()=>{
 it('accepts an actual valid program bound to a UV-bearing live-only Base Color carrier',async()=>{
  expect(await audit()).not.toContain('conformance.base-color-carrier-missing')
 })
 it('keeps publication blocked for forged bounds or an unearned source profile',async()=>{
  for(const changes of [{roughnessNode:{op:'separate',channel:'x',input:{op:'uv'},range:[0,1]},roughnessRange:[0,1]},
    {sourceEngine:'CYCLES'},{nativeGpuBackend:'VULKAN'},{perlinModel:'cycles-neon-fma'}])
   expect(await audit(changes)).toContain('conformance.base-color-carrier-missing')
 })
})
