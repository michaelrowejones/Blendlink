import type { TslIrExpression, TslExpression } from './tslNodeRecipe.js'
import { isUnitRoughnessExpression, buildTslVaryingFbm } from './tslVaryingNoise.js'
import { bitcast, uint, float, select } from 'three/tsl'
import { buildNativeNoiseFma } from './tslNativeNoisePrecision.js'
import { MF_COORDINATE_MODEL, hasValidMfCoordinateSource } from './tslMfNoiseCoordinates.js'
import { hasExactMfNoiseCoordinates, hasPortableNoiseConstantArithmetic, NATIVE_MF_NOISE_INPUT_MESSAGE, NATIVE_SHADER_NOISE_INPUT_MESSAGE } from './tslNoiseInputPrecision.js'

const scalar=float as unknown as (value:number)=>TslExpression
const integer=uint as unknown as (value:number)=>TslExpression
const cast=bitcast as unknown as (value:TslExpression,type:string)=>TslExpression
const choose=select as unknown as (test:TslExpression,yes:TslExpression,no:TslExpression)=>TslExpression
const rounded=(value:TslExpression):TslExpression=>{
  const bits=cast(value,'uint').toVar()
  return cast(choose(bits.equal(integer(0x7fc00000)),integer(0),bits),'float')
}

/** Fresh scalar Metal source model only. Explicit finite float32 stages keep
 * software backends from substituting a different mix/fade contraction. */
export function nativeMetalVaryingFade(t:TslExpression):TslExpression {
  const linear=buildNativeNoiseFma(t,scalar(6),scalar(-15))
  const polynomial=buildNativeNoiseFma(t,linear,scalar(10))
  const cube=rounded(rounded(t.mul(t)).mul(t))
  return rounded(cube.mul(polynomial))
}

export function nativeMetalVaryingMix(a:TslExpression,b:TslExpression,t:TslExpression):TslExpression {
  return buildNativeNoiseFma(b,t,buildNativeNoiseFma(a.negate(),t,a))
}

function nativeDistortionMfInputs(expression:TslIrExpression):boolean {
  if(!hasExactMfNoiseCoordinates(expression) || !hasPortableNoiseConstantArithmetic(expression)) return false
  const constant=(value:unknown):boolean=>{
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const node=value as TslIrExpression
    if (['const_float','const_vec3'].includes(node.op)) return true
    if (node.op==='noise_normalized') {
      if (node.perlinModel!=='mf-periodic-f32' || node.evaluationModel!=='shader-mf' || !hasExactMfNoiseCoordinates(node)) return false
    } else if (!['math','vector_math','mapping','vector_rotate','vector_scale','combine','separate','clamp01','clamp_minmax'].includes(node.op)) return false
    const children:unknown[]=[]
    const collect=(item:unknown):void=>{
      if (!item || typeof item!=='object') return
      if (Array.isArray(item)) item.forEach(collect)
      else if ('op' in item) children.push(item)
      else Object.values(item).forEach(collect)
    }
    for (const [key,item] of Object.entries(node)) if(key!=='op') collect(item)
    return children.length>0 && children.every(constant)
  }
  return ['input','scale','roughnessNode',...(expression.dimensions===4?['w']:[])].every(key=>constant(expression[key]))
}

/** Independent admission for the versioned native live-amplitude capability.
 * Legacy noise_varying retains its existing primitive and serialized meaning. */
export function validateNativeVaryingNoise(expression: TslIrExpression,
  fail: (message: string) => never): void {
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  if (expression.sourceEngine !== 'EEVEE' || expression.normalize !== true || expression.noiseType !== 'FBM')
    fail('IR native varying Noise requires explicit EEVEE normalized FBM')
  if (!['METAL','OPENGL'].includes(String(expression.nativeGpuBackend)) ||
      expression.perlinModel === 'eevee-metal-periodic-f32' && expression.nativeGpuBackend !== 'METAL' ||
      expression.perlinModel === 'native-standard-f32' && expression.nativeGpuBackend !== 'OPENGL')
    fail('IR native varying Noise requires a compatible verified EEVEE GPU backend')
  if (!['native-standard-f32','eevee-metal-periodic-f32','mf-periodic-f32'].includes(String(expression.perlinModel)))
    fail('IR native varying Noise has no verified EEVEE source Perlin model')
  if (!finite(expression.dimensions) || ![1,2,3,4].includes(expression.dimensions) ||
      !['fac','color'].includes(String(expression.output)))
    fail('IR native varying Noise requires a verified dimension and output')
  if (!finite(expression.detail) || expression.detail > 2 || expression.roughness !== 1 ||
      !isUnitRoughnessExpression(expression.roughnessNode as TslIrExpression | undefined))
    fail('IR native varying Noise needs static Detail <=2 and an independently proven [0,1] scalar Roughness')
  if (expression.output === 'color' && (!Array.isArray(expression.colorOffsets) || expression.colorOffsets.length !== 2 ||
      !expression.colorOffsets.every(offset => Array.isArray(offset) && offset.length === expression.dimensions && offset.every(finite))))
    fail('IR native varying Noise Color requires two verified finite dimension-matched seed offsets')
  const scale = expression.scale as TslIrExpression | undefined
  if (scale?.op !== 'const_float' || !finite(scale.value) || Math.abs(scale.value) > 80 ||
      !finite(expression.lacunarity) || Math.abs(expression.lacunarity) > 2 ||
      expression.distortion !== undefined && (!finite(expression.distortion) || Math.abs(expression.distortion) > 1))
    fail('IR native varying Noise exceeds its verified finite static controls')
  if (expression.distortion !== undefined && expression.distortion !== 0) {
    const metal=expression.nativeGpuBackend==='METAL'
    const shader=metal && expression.dimensions===1 && expression.perlinModel==='eevee-metal-periodic-f32' && expression.evaluationModel==='shader'
    if(shader && !hasPortableNoiseConstantArithmetic(expression)) fail('IR '+NATIVE_SHADER_NOISE_INPUT_MESSAGE)
    const mf=metal && expression.perlinModel==='mf-periodic-f32' && expression.evaluationModel==='shader-mf' && nativeDistortionMfInputs(expression)
    if(metal && expression.perlinModel==='mf-periodic-f32' && expression.evaluationModel==='shader-mf' && !mf)
      fail('IR '+NATIVE_MF_NOISE_INPUT_MESSAGE)
    const canonicalMf=expression.distortionModel===MF_COORDINATE_MODEL
    if(canonicalMf && (!mf || !hasValidMfCoordinateSource(expression)))
      fail('IR native MF coordinate literals do not match qualified Float32 source arithmetic; use source baking')
    if(expression.mfCoordinateSource!==undefined && !canonicalMf)
      fail('IR native MF coordinate source requires its versioned precision model')
    if (!(shader && expression.distortionModel==='metal-1d-fma-f32-v1' || mf && (expression.distortionModel==='native-mf-f32-v1' || canonicalMf)))
      fail('IR native normalized live Roughness nonzero Distortion requires verified Metal 1D shader or native MF inputs; use source baking')
    if (!Array.isArray(expression.distortionOffsets) || expression.distortionOffsets.length!==expression.dimensions ||
        !expression.distortionOffsets.every(offset=>Array.isArray(offset) && offset.length===expression.dimensions && offset.every(finite)))
      fail('IR native varying Noise Distortion requires verified finite dimension-matched seed offsets')
  } else if (expression.distortionModel!==undefined || expression.mfCoordinateSource!==undefined) {
    fail('IR native varying Noise has an unused Distortion precision model')
  }
}

export function buildNativeVaryingFbm(position:TslExpression,detail:number,lacunarity:number,
  roughness:TslExpression,octave:(point:TslExpression)=>TslExpression):TslExpression {
  return buildTslVaryingFbm(position,detail,lacunarity,roughness,true,octave)
}
