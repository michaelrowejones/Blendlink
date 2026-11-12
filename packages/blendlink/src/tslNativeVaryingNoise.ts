import type { TslIrExpression, TslExpression } from './tslNodeRecipe.js'
import { isUnitRoughnessExpression, buildTslVaryingFbm } from './tslVaryingNoise.js'

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
  if (expression.distortion !== undefined && expression.distortion !== 0)
    fail('IR native normalized live Roughness requires Distortion = 0; nonzero Distortion needs source baking')
  if (expression.output === 'color' && (!Array.isArray(expression.colorOffsets) || expression.colorOffsets.length !== 2 ||
      !expression.colorOffsets.every(offset => Array.isArray(offset) && offset.length === expression.dimensions && offset.every(finite))))
    fail('IR native varying Noise Color requires two verified finite dimension-matched seed offsets')
  const scale = expression.scale as TslIrExpression | undefined
  if (scale?.op !== 'const_float' || !finite(scale.value) || Math.abs(scale.value) > 80 ||
      !finite(expression.lacunarity) || Math.abs(expression.lacunarity) > 2 ||
      expression.distortion !== undefined && (!finite(expression.distortion) || Math.abs(expression.distortion) > 1))
    fail('IR native varying Noise exceeds its verified finite static controls')
}

export function buildNativeVaryingFbm(position:TslExpression,detail:number,lacunarity:number,
  roughness:TslExpression,octave:(point:TslExpression)=>TslExpression):TslExpression {
  return buildTslVaryingFbm(position,detail,lacunarity,roughness,true,octave)
}
