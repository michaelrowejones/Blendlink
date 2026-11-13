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
    expect(()=>build({distortion:.37})).toThrow(/requires verified Metal/)
  })
  it('admits nonzero Distortion only under the earned Metal 1D shader model',()=>{
    for (const distortion of [-1,.37,1,2**-35]) for(const output of ['fac','color']) {
      const changes={dimensions:1,input:scalar(.25),output,distortion,evaluationModel:'shader',
        distortionModel:'metal-1d-fma-f32-v1',distortionOffsets:[[111]],colorOffsets:[[123],[157]]}
      expect(build(changes)).toBeTruthy()
      for(const invalid of [{distortionModel:undefined},{distortionModel:'future'},
        {dimensions:2,input:{op:'uv'},colorOffsets:[[1,2],[3,4]]},{nativeGpuBackend:'OPENGL',perlinModel:'native-standard-f32'},
        {evaluationModel:'shader-mf'},{distortionOffsets:[]},{distortionOffsets:[[Number.NaN]]}])
        expect(()=>build({...changes,...invalid})).toThrow()
    }
  })
  it('independently reproves the actual native-MF inputs rather than trusting stage labels',()=>{
    const child:TslIrExpression={op:'noise_normalized',normalize:true,noiseType:'FBM',output:'fac',dimensions:3,
      detail:0,roughness:.5,lacunarity:2,scale:scalar(1),input:{op:'const_vec3',value:[.375,Math.fround(-.173),.625]},
      evaluationModel:'shader-mf',perlinModel:'mf-periodic-f32'}
    const rho:TslIrExpression={op:'clamp01',input:child}
    for(const dimensions of [1,2,3,4]) {
      const changes={dimensions,input:dimensions===1?scalar(.25):{op:'const_vec3',value:[.125,.25,.375]},
        roughnessNode:rho,w:scalar(.125),distortion:.37,evaluationModel:'shader-mf',perlinModel:'mf-periodic-f32',
        distortionModel:'native-mf-f32-v1',distortionOffsets:Array.from({length:dimensions},()=>Array(dimensions).fill(123))}
      expect(build(changes)).toBeTruthy()
      for(const invalid of [{input:{op:'uv',constant:true}}, {roughnessNode:roughness},
        {roughnessNode:{...rho,input:{...child,input:{op:'uv'},evaluationModel:'shader-mf'}}},
        {roughnessNode:{...rho,input:{...child,perlinModel:'eevee-metal-periodic-f32'}}},
        {nativeGpuBackend:'OPENGL'},{evaluationModel:'shader'}, {distortionModel:'metal-1d-fma-f32-v1'},
        ...(dimensions===4?[{w:{op:'separate',channel:'x',input:{op:'uv'}}}]:[])])
        expect(()=>build({...changes,...invalid})).toThrow()
    }
    expect(()=>build({distortion:0,distortionModel:'native-mf-f32-v1'})).toThrow(/unused Distortion/)
  })
  it('keeps the prior varying opcode available without the new source metadata',()=>{
    expect(build({op:'noise_varying',sourceEngine:undefined,perlinModel:undefined,distortion:.37,distortionOffsets:[[1,2,3],[4,5,6],[7,8,9]]})).toBeTruthy()
  })
})
