import { describe,expect,it } from 'vitest'
import { buildTslColorNode,type TslIrDocument,type TslIrExpression } from './tslNodeRecipe.js'
import { hasExactMfNoiseCoordinates,hasPortableNoiseConstantArithmetic,NATIVE_MF_NOISE_INPUT_MESSAGE,NATIVE_SHADER_NOISE_INPUT_MESSAGE } from './tslNoiseInputPrecision.js'
const scalar=(value:number):TslIrExpression=>({op:'const_float',value})
const vector:TslIrExpression={op:'const_vec3',value:[.125,-.375,.625]}
const arithmetic=(operation:string,a:TslIrExpression,b:TslIrExpression):TslIrExpression=>({op:'math',operation,a,b})
const cancellation=arithmetic('SUBTRACT',arithmetic('SUBTRACT',arithmetic('ADD',scalar(1e8),scalar(1)),scalar(1e8)),scalar(1))
const inner:TslIrExpression={op:'noise_normalized',noiseType:'FBM',normalize:true,perlinModel:'mf-periodic-f32',evaluationModel:'shader-mf',
  dimensions:3,output:'fac',detail:0,roughness:.5,lacunarity:2,input:vector,scale:scalar(1)}
const base:TslIrExpression={op:'noise_varying_native',noiseType:'FBM',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',normalize:true,
  perlinModel:'mf-periodic-f32',evaluationModel:'shader-mf',dimensions:3,output:'fac',detail:2,roughness:1,lacunarity:1.7,
  roughnessNode:{op:'clamp01',input:inner},input:vector,scale:scalar(1),distortion:Math.fround(.37),
  distortionModel:'native-mf-f32-v1',distortionOffsets:[[111,112,113],[114,115,116],[117,118,119]]}
const build=(expression:TslIrExpression)=>buildTslColorNode({schemaVersion:1,model:'blendlink-tsl-ir-v1',output:expression} as TslIrDocument)
describe('new MF Noise input precision admission',()=>{
  it('requires actual exact coordinates rather than uniform-stage annotations',()=>{
    for(const dimensions of [1,3,4]) {
      const input=dimensions===1?cancellation:{op:'combine',x:cancellation,y:scalar(-.375),z:scalar(.625)}
      const expression={...base,dimensions,input,w:cancellation,distortionOffsets:Array.from({length:dimensions},()=>Array(dimensions).fill(123))}
      expect(hasExactMfNoiseCoordinates(expression)).toBe(false)
      expect(()=>build({...expression,inputRange:[-1,1],exactArithmetic:true})).toThrow(NATIVE_MF_NOISE_INPUT_MESSAGE)
    }
  })
  it('rejects inexact closed arithmetic islands inside an otherwise opaque Roughness tree',()=>{
    const scaled=arithmetic('MULTIPLY',inner,scalar(Math.fround(.01)))
    for(const claimed of [cancellation,{...cancellation,sourceProof:inner,exact:true,range:[-1,-1]}]) {
      const expression={...base,roughnessNode:{op:'clamp01',input:arithmetic('ADD',scaled,claimed)}}
      expect(hasPortableNoiseConstantArithmetic(expression)).toBe(false)
      expect(()=>build(expression)).toThrow(NATIVE_MF_NOISE_INPUT_MESSAGE)
    }
    const gap=arithmetic('ADD',scalar(Math.fround(1e30)),scalar(1))
    expect(hasPortableNoiseConstantArithmetic({...base,roughnessNode:{op:'clamp01',input:arithmetic('ADD',scaled,gap)}})).toBe(false)
  })
  it('preserves literal coordinates and the earned exact binary affine W plumbing',()=>{
    const w:TslIrExpression={op:'math',operation:'MULTIPLY_ADD',a:{op:'separate',channel:'y',input:vector},b:scalar(.5),c:scalar(.125)}
    for(const dimensions of [1,3,4]) {
      const expression={...base,dimensions,input:dimensions===1?w:vector,w,
        distortionOffsets:Array.from({length:dimensions},()=>Array(dimensions).fill(123))}
      expect(hasExactMfNoiseCoordinates(expression)).toBe(true)
      expect(hasPortableNoiseConstantArithmetic(expression)).toBe(true)
      expect(build(expression)).toBeTruthy()
    }
  })
  it('checks coordinates inside nested MF Noise and refuses unsupported constant arithmetic',()=>{
    const child={...inner,input:{op:'combine',x:cancellation,y:scalar(0),z:scalar(0)}}
    expect(()=>build({...base,roughnessNode:{op:'clamp01',input:child}})).toThrow(NATIVE_MF_NOISE_INPUT_MESSAGE)
    const power=arithmetic('POWER',scalar(2),scalar(2))
    expect(hasPortableNoiseConstantArithmetic({...base,roughnessNode:{op:'clamp01',input:{...power,sourceProof:inner}}})).toBe(false)
  })
  it('also refuses the witnessed constant islands in the fresh scalar shader profile',()=>{
    const expression={...base,dimensions:1,input:cancellation,evaluationModel:'shader',perlinModel:'eevee-metal-periodic-f32',
      distortionModel:'metal-1d-fma-f32-v1',distortionOffsets:[[123]]}
    expect(()=>build(expression)).toThrow(NATIVE_SHADER_NOISE_INPUT_MESSAGE)
    expect(()=>build({...expression,input:scalar(.25),roughnessNode:{op:'clamp01',input:arithmetic('ADD',arithmetic('MULTIPLY',inner,scalar(Math.fround(.01))),cancellation)}}))
      .toThrow(NATIVE_SHADER_NOISE_INPUT_MESSAGE)
  })
})
