import {describe,it,expect} from 'vitest'
import {buildTslColorNode,type TslIrDocument,type TslIrExpression} from './tslNodeRecipe.js'
import {isUnitBoundedExpression} from './tslColorConversion.js'
import {isUnitRoughnessExpression} from './tslVaryingNoise.js'
import {normalInputBounds,normalMapCoefficientBounds} from './tslNormalInputBounds.js'
import {nativeModuloValidationError} from './tslMathModuloNative.js'
const scalar=(value:number):TslIrExpression=>({op:'const_float',value})
const remainder:TslIrExpression={op:'math_modulo_native',precisionModel:'mf-fmod100000-v1',inputModel:'literal-f32-v1',input:scalar(1638499968)}
const clamp:TslIrExpression={op:'clamp_minmax',value:remainder,min:scalar(0),max:scalar(1)}
const build=(output:TslIrExpression)=>buildTslColorNode({schemaVersion:1,model:'blendlink-tsl-ir-v1',output} as TslIrDocument)
describe('native scalar Modulo composition',()=>{
 it('keeps the raw range unrestricted and lets an authored Clamp certify scalar Roughness',()=>{
  expect(isUnitBoundedExpression({...remainder,range:[0,1],normalize:true})).toBe(false)
  expect(isUnitRoughnessExpression(remainder)).toBe(false)
  for(const input of [clamp,{op:'clamp01',input:remainder}]) {
   expect(isUnitRoughnessExpression(input)).toBe(true)
   expect(build({op:'noise_varying_native',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',noiseType:'FBM',normalize:true,
    dimensions:2,output:'fac',detail:2,roughness:1,roughnessNode:input,lacunarity:2,scale:scalar(1),
    input:{op:'const_vec3',value:[.125,.25,.375]},perlinModel:'mf-periodic-f32',evaluationModel:'shader-mf'})).toBeTruthy()
  }
 })
 it('supports existing factor/HSL dispatch without granting the raw remainder unit bounds',()=>{
  expect(build({op:'mix_color',blendType:'MIX',factor:clamp,a:scalar(.25),b:scalar(.75)})).toBeTruthy()
  expect(build({op:'color_convert',mode:'HSL',direction:'separate',model:'eevee-gpu',hslUpperDivisor:'sum-first',inputDomain:'unit-bounded-live',
   input:{op:'combine',x:clamp,y:scalar(.25),z:scalar(.5)}})).toBeTruthy()
  expect(()=>build({op:'color_convert',mode:'HSL',direction:'separate',model:'eevee-gpu',hslUpperDivisor:'sum-first',inputDomain:'unit-bounded-live',
   input:{op:'combine',x:remainder,y:scalar(.25),z:scalar(.5)}})).toThrow(/finite input domain/)
 })
 it('validates the finite primitive before using its clamped normal-input bounds',()=>{
  expect(()=>normalInputBounds(remainder,{})).toThrow(/finite range/)
  expect(normalInputBounds(clamp,{})).toEqual([[0,1],[0,1],[0,1]])
  expect(normalInputBounds({op:'clamp01',input:remainder},{})).toEqual([[0,1],[0,1],[0,1]])
  expect(normalMapCoefficientBounds({op:'const_vec3',value:[.75,.5,1]},clamp,'OPENGL',{}).minimum).toBeGreaterThan(0)
  for(const invalid of [{precisionModel:'future'},{inputModel:'future'},{input:scalar(1)},
   {input:scalar(-1e9)},{input:{op:'const_vec3',value:[1,2,3]}}]) {
   const child={...remainder,...invalid}
   expect(nativeModuloValidationError(child)).not.toBeNull()
   expect(()=>normalInputBounds({...clamp,value:child,range:[0,1]},{})).toThrow()
   expect(()=>build({...clamp,value:child})).toThrow()
  }
  expect(()=>normalInputBounds({...clamp,min:scalar(.1)},{})).toThrow()
  expect(()=>normalInputBounds({...clamp,max:scalar(17)},{})).toThrow()
 })
})
