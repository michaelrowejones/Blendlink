import { describe, expect, it } from 'vitest'
import { buildTslColorNode, type TslIrDocument, type TslIrExpression } from './tslNodeRecipe.js'
import { isUnitBoundedExpression } from './tslColorConversion.js'
import { isUnitRoughnessExpression } from './tslVaryingNoise.js'
const scalar=(value:number):TslIrExpression=>({op:'const_float',value})
const roughness:TslIrExpression={op:'clamp_minmax',value:{op:'separate',channel:'x',input:{op:'uv'}},min:scalar(0),max:scalar(1)}
const expression:TslIrExpression={op:'noise_varying_native',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',normalize:true,noiseType:'FBM',
  perlinModel:'eevee-metal-periodic-f32',dimensions:3,output:'fac',detail:1.5,roughness:1,roughnessNode:roughness,
  lacunarity:1.7,input:{op:'uv'},scale:scalar(1)}
const build=(changes:Partial<TslIrExpression>={})=>buildTslColorNode({schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{...expression,...changes}} as TslIrDocument)
describe('native normalized live Roughness capability',()=>{
  it('builds exact kernels in all dimensions and supported EEVEE stages',()=>{
    for(const dimensions of [1,2,3,4])for(const detail of [-.5,0,.5,1,1.5,2])for(const output of ['fac','color'])for(const perlinModel of ['native-standard-f32','eevee-metal-periodic-f32','mf-periodic-f32']){
      const offsets=Array.from({length:2},()=>Array(dimensions).fill(.25))
      expect(build({dimensions,detail,output,perlinModel,nativeGpuBackend:perlinModel==='native-standard-f32'?'OPENGL':'METAL',input:dimensions===1?scalar(.25):expression.input,w:scalar(.125),colorOffsets:offsets})).toBeTruthy()
    }
  })
  it('requires independently certified scalar controls and a measured source model',()=>{
    for(const changes of [{sourceEngine:'CYCLES'},{normalize:false},{noiseType:'MULTIFRACTAL'},
      {perlinModel:'cycles-neon-fma'},{perlinModel:'future'},{nativeGpuBackend:'VULKAN'},{perlinModel:'native-standard-f32'},{output:'alpha'},{dimensions:5},
      {output:'color',colorOffsets:[]},{output:'color',colorOffsets:[[1],[2]]},{detail:3},{detail:Number.NaN},{distortion:.37},{distortion:-1},{distortion:1},{roughness:.5},{roughnessNode:{op:'separate',channel:'x',input:{op:'uv'},range:[0,1]}},
      {roughnessNode:{op:'const_vec3',value:[.2,.3,.4]}},{scale:scalar(81)},{scale:{op:'uv'}},{lacunarity:3},{distortion:2}])
      expect(()=>build({...changes,roughnessRange:[0,1],amplitudeBound:0})).toThrow()
  })
  it('keeps 3D/4D HDR output and needs an authored Clamp for a unit contract',()=>{
    for(const dimensions of [3,4]){
      const noise={...expression,dimensions}
      expect(isUnitBoundedExpression(noise)).toBe(false)
      expect(isUnitRoughnessExpression({...noise,inputDomain:'unit-bounded-live'})).toBe(false)
      expect(isUnitRoughnessExpression({op:'clamp_minmax',value:noise,min:scalar(0),max:scalar(1)})).toBe(true)
    }
    expect(isUnitRoughnessExpression({...expression,dimensions:1,input:scalar(.25)})).toBe(false)
    expect(isUnitRoughnessExpression({...expression,dimensions:2})).toBe(false)
  })
  it('prunes zero Distortion without requiring unused offsets',()=>{
    expect(build({distortion:0})).toBeTruthy()
    expect(build({distortion:-0,distortionOffsets:'unused'})).toBeTruthy()
    expect(()=>build({distortion:.37})).toThrow(/requires Distortion = 0/)
  })
  it('keeps the prior varying opcode available without the new source metadata',()=>{
    expect(build({op:'noise_varying',sourceEngine:undefined,perlinModel:undefined,distortion:.37,distortionOffsets:[[1,2,3],[4,5,6],[7,8,9]]})).toBeTruthy()
  })
})
