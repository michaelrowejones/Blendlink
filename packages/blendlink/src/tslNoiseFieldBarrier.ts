/* SPDX-License-Identifier: Apache-2.0 */
import { uniform } from 'three/tsl'
import { evaluateStaticNoiseInput } from './staticNoise4d.js'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'

// Private and never updated. Experimental: actual hosted Subzero field
// execution must establish whether this prevents its GPU-process crash.
const neutral = uniform(0, 'float') as unknown as TslExpression
const expression = (value: unknown): TslIrExpression | undefined => value !== null && typeof value === 'object'
  && typeof (value as TslIrExpression).op === 'string' ? value as TslIrExpression : undefined
const literal = (ir: TslIrExpression | undefined, value: number): boolean => ir?.op === 'const_float' && ir.value === value

const exactHalf = (value: number): boolean => {
  const magnitude = Math.abs(value)
  const spacing = magnitude < 2 ** -14 ? 2 ** -24 : 2 ** (Math.floor(Math.log2(magnitude)) - 10)
  return magnitude <= 65504 && magnitude % spacing === 0
}
const exactProduct = (a: number, b: number): boolean => Number.isFinite(a * b) && Math.fround(a * b) === a * b

/** Semantic input certificate: exact native image upload and exact Float32
 * products/W arithmetic. Adding a private uniform must not break a native
 * mul+add contraction in an otherwise arbitrary coordinate expression. */
export function hasExactNoiseFieldCoordinates(ir: TslIrExpression): boolean {
  const scale = expression(ir.scale), image = expression(ir.input), w = expression(ir.w)
  if (!scale || ![40, 80].some(value => literal(scale, value)) || image?.op !== 'tex_image'
    || image.sourceImageStorage !== 'rgba32f' || image.sourceImageUploadRounding !== 'none'
    || image.output !== 'color' || image.interpolation !== 'Closest' || image.extension !== 'REPEAT'
    || (image.projection ?? 'flat') !== 'flat' || !['CYCLES', 'EEVEE'].includes(String(image.sourceEngine))
    || image.sourceEngine === 'EEVEE' && !['METAL', 'OPENGL'].includes(String(image.nativeGpuBackend))) return false
  // This profile samples the already-decoded linear Float32 payload directly.
  // Future transfer/working-space processing must earn a new certificate;
  // alpha1 alone cannot establish exact RGB products after such a transform.
  const allowed = new Set(['op', 'sourceEngine', 'sourceImageStorage', 'sourceImageUploadRounding', 'nativeGpuBackend',
    'width', 'height', 'pixels', 'interpolation', 'extension', 'output', 'projection', 'vector'])
  if (Object.keys(image).some(key => !allowed.has(key))) return false
  const coordinates = expression(image.vector)
  if (!coordinates || !['uv', 'uv_active'].includes(coordinates.op)
    || Object.keys(coordinates).some(key => !['op', 'channel'].includes(key))
    || coordinates.channel !== undefined && coordinates.channel !== 0) return false
  const width = image.width, height = image.height, pixels = image.pixels
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width * height > 16384 || !Array.isArray(pixels) || pixels.length !== width * height * 4) return false
  for (let index = 0; index < pixels.length; index++) {
    const value = pixels[index]
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 2 || Math.fround(value) !== value || !exactHalf(value) || !exactProduct(value, scale.value as number)
      || index % 4 === 3 && value !== 1) return false
  }
  if (w?.op === 'const_float' && typeof w.value === 'number' && Number.isFinite(w.value) && Math.abs(w.value) <= 2
    && Math.fround(w.value) === w.value && exactProduct(w.value, scale.value as number)) return true
  const channel = expression(w?.a), other = expression(channel?.input)
  if (w && Object.keys(w).some(key => !['op', 'operation', 'a', 'b', 'c'].includes(key))
    || channel && Object.keys(channel).some(key => !['op', 'channel', 'input'].includes(key))) return false
  if (!(w?.op === 'math' && w.operation === 'MULTIPLY_ADD' && literal(expression(w.b), .5)
    && literal(expression(w.c), .125) && channel?.op === 'separate' && channel.channel === 'y'
    && !!other && other.op === 'tex_image' && JSON.stringify(other) === JSON.stringify(image))) return false
  // Reuse the separately proven certificate, including its exponent-gap guard;
  // binary64 equality alone can lose tiny addends and falsely certify a sum.
  for (let index = 1; index < pixels.length; index += 4) {
    const value = evaluateStaticNoiseInput({ op: 'math', operation: 'MULTIPLY_ADD',
      a: { op: 'const_float', value: pixels[index] }, b: { op: 'const_float', value: .5 },
      c: { op: 'const_float', value: .125 } }, { exactArithmetic: true })
    if (typeof value !== 'number' || !exactProduct(value, scale.value as number)) return false
  }
  return true
}

/** Only the bounded fresh static-control FBM field workload. No legacy noise,
 * CPU literal folds, live Roughness, distortion or arbitrary coordinate math. */
export function usesNoiseFieldBarrier(ir: TslIrExpression): boolean {
  return ['noise_fractal', 'noise_normalized'].includes(ir.op) && ir.dimensions === 4 && ir.output === 'color'
    && (ir.noiseType ?? 'FBM') === 'FBM' && ir.evaluationModel === 'shader'
    && typeof ir.detail === 'number' && Number.isFinite(ir.detail) && ir.detail >= 4 && ir.detail <= 6
    && ir.roughnessNode === undefined && (ir.distortion ?? 0) === 0 && hasExactNoiseFieldCoordinates(ir)
}

export function buildNoiseFieldBarrier(ir: TslIrExpression, point: TslExpression): TslExpression {
  return usesNoiseFieldBarrier(ir) ? point.add(neutral).toVar() : point
}
