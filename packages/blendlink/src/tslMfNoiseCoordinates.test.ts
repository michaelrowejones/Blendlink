import {describe,it,expect} from 'vitest'
import {evaluateMfNoiseCoordinate,hasValidMfCoordinateSource,MF_COORDINATE_MODEL} from './tslMfNoiseCoordinates.js'
import {buildTslColorNode,type TslIrDocument,type TslIrExpression as IR} from './tslNodeRecipe.js'
const f=(value:number):IR=>({op:'const_float',value})
const math=(operation:string,a:IR,b:IR):IR=>({op:'math',operation,a,b})
const cancellation=math('SUBTRACT',math('SUBTRACT',math('ADD',f(1e8),f(1)),f(1e8)),f(1))
const point:IR={op:'const_vec3',value:[.125,-.375,.625]}
const source:IR={op:'combine',x:cancellation,y:f(-.375),z:f(.625)}
const base:IR={op:'noise_varying_native',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',normalize:true,noiseType:'FBM',
  perlinModel:'mf-periodic-f32',evaluationModel:'shader-mf',dimensions:3,output:'fac',detail:2,roughness:1,lacunarity:1.7,
  roughnessNode:{op:'clamp01',input:{op:'noise_normalized',noiseType:'FBM',normalize:true,perlinModel:'mf-periodic-f32',evaluationModel:'shader-mf',dimensions:3,output:'fac',detail:0,roughness:.5,lacunarity:2,input:point,scale:f(1)}},
  input:{op:'const_vec3',value:[-1,-.375,.625]},scale:f(1),distortion:Math.fround(.37),distortionModel:MF_COORDINATE_MODEL,
  distortionOffsets:[[111,112,113],[114,115,116],[117,118,119]],mfCoordinateSource:{input:source}}
const validate=(ir:IR)=>buildTslColorNode({schemaVersion:1,model:'blendlink-tsl-ir-v1',output:ir} as TslIrDocument)
describe('bounded MF coordinate canonicalization',()=>{
  it('rounds every separate ADD/SUB/MUL stage and preserves vector shape',()=>{
    expect(evaluateMfNoiseCoordinate(cancellation)).toBe(-1)
    expect(evaluateMfNoiseCoordinate(source)).toEqual([-1,-.375,.625])
    const multiply=math('MULTIPLY',f(Math.fround(1.3)),f(Math.fround(.7)))
    expect(evaluateMfNoiseCoordinate(multiply)).toBe(Math.fround(Math.fround(1.3)*Math.fround(.7)))
    expect(evaluateMfNoiseCoordinate({op:'vector_scale',input:{op:'vector_math',operation:'ADD',a:source,b:point},scale:f(.5)})).toEqual([-.4375,-.375,.625])
    expect(hasValidMfCoordinateSource(base)).toBe(true)
    expect(()=>validate(base)).not.toThrow()
  })
  it('independently checks the recorded source and literal words',()=>{
    for(const changed of [
      {...base,input:point},
      {...base,mfCoordinateSource:{input:point}},
      {...base,mfCoordinateSource:{}},
      {...base,mfCoordinateSource:{input:source,w:cancellation}},
      {...base,mfCoordinateSource:{input:source,proof:true}},
      {...base,distortionModel:'native-mf-f32-v1'},
      {...base,distortion:0},
      {...base,nativeGpuBackend:'OPENGL'},
      {...base,evaluationModel:'shader'},
    ])expect(()=>validate(changed)).toThrow()
    const wrong={...base,input:{op:'const_vec3',value:[-1,-.375,.625+2**-24]}}
    expect(hasValidMfCoordinateSource(wrong)).toBe(false)
  })
  it('does not admit unknown, contracted, underflowing or unbounded arithmetic',()=>{
    for(const bad of [
      {...math('MULTIPLY_ADD',f(.1),f(.2)),c:f(.3)},
      math('DIVIDE',f(1),f(3)),
      math('MULTIPLY',f(2**-100),f(2**-100)),
      math('SUBTRACT',math('MULTIPLY',f(2**30),f(4)),f(2**31)),
      math('ADD',f(1e8),f(1)),
      {op:'attribute_object',range:[0,1],value:-1},
      {op:'math',operation:'POWER',a:f(2),b:f(2),exact:true},
    ])expect(evaluateMfNoiseCoordinate(bad)).toBeUndefined()
    let deep=f(1);for(let i=0;i<34;i++)deep=math('ADD',deep,f(0))
    expect(evaluateMfNoiseCoordinate(deep)).toBeUndefined()
    const cycle:IR={op:'math',operation:'ADD',b:f(0)};cycle.a=cycle
    expect(evaluateMfNoiseCoordinate(cycle)).toBeUndefined()
  })
  it('retains the refusal for an inexact Roughness island and nested coordinates',()=>{
    const child=(base.roughnessNode as IR).input as IR
    const rho={op:'clamp01',input:math('ADD',math('MULTIPLY',child,f(Math.fround(.01))),cancellation)}
    expect(()=>validate({...base,roughnessNode:rho})).toThrow('portable constant arithmetic')
    expect(()=>validate({...base,roughnessNode:{op:'clamp01',input:{...child,input:source}}})).toThrow('portable constant arithmetic')
  })
})
