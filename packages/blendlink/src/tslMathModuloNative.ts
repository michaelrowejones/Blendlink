/* SPDX-License-Identifier: Apache-2.0 */
import { Fn, bitcast, float, int, select, uint } from 'three/tsl'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'

type Node = any
const f = float as unknown as (value: Node) => Node
const i = int as unknown as (value: Node) => Node
const u = uint as unknown as (value: Node) => Node
const bits = bitcast as unknown as (value: Node, type: string) => Node
const choose = select as unknown as (condition: Node, a: Node, b: Node) => Node
const fn = Fn as unknown as (body: (inputs: Node[]) => Node) => { setLayout(layout: unknown): (value: Node) => Node }
const literal = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.fround(value) === value
const expression = (value: unknown): TslIrExpression | undefined => value !== null && typeof value === 'object' && typeof (value as TslIrExpression).op === 'string' ? value as TslIrExpression : undefined

/** Independent runtime admission uses actual image bytes and exact literals.
 * No serialized interval or source-only assertion can authorize int conversion. */
export function nativeModuloInputBounds(input: TslIrExpression): [number, number] | null {
  if (input.op === 'const_float' && literal(input.value)) return [input.value, input.value]
  const axis = ['x', 'y', 'z'].indexOf(String(input.channel))
  if (input.op !== 'separate' || axis < 0) return null
  const vector = expression(input.input)
  if (vector?.op !== 'vector_math' || vector.operation !== 'ADD') return null
  const image = expression(vector.a), offset = expression(vector.b)
  if (image?.op !== 'tex_image' || offset?.op !== 'const_vec3' || !Array.isArray(offset.value)
    || offset.value.length !== 3 || !offset.value.every(literal)) return null
  if (image.sourceEngine !== 'EEVEE' || image.nativeGpuBackend !== 'METAL'
    || image.sourceImageStorage !== 'rgba32f' || image.sourceImageUploadRounding !== 'none'
    || image.interpolation !== 'Closest' || image.output !== 'color'
    || !['REPEAT', 'EXTEND', 'CLIP'].includes(String(image.extension)) || (image.projection ?? 'flat') !== 'flat') return null
  if (!['uv', 'uv_active'].includes(String(expression(image.vector)?.op))) return null
  const width = image.width, height = image.height, pixels = image.pixels
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width * height > 16384 || !Array.isArray(pixels)
    || pixels.length !== width * height * 4 || !pixels.every(literal)) return null
  let minimum = image.extension === 'CLIP' ? 0 : Infinity, maximum = image.extension === 'CLIP' ? 0 : -Infinity
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] !== 1) return null
    minimum = Math.min(minimum, pixels[index + axis]!); maximum = Math.max(maximum, pixels[index + axis]!)
  }
  return [Math.fround(minimum + offset.value[axis]!), Math.fround(maximum + offset.value[axis]!)]
}
export function nativeModuloHalfExactImage(input: TslIrExpression): boolean {
  const vector = expression(input.input), image = expression(vector?.a)
  return image?.op === 'tex_image' && Array.isArray(image.pixels) && image.pixels.every(value => {
    if (!literal(value) || Math.abs(value) > 65504) return false
    const magnitude = Math.abs(value)
    const spacing = magnitude < 2 ** -14 ? 2 ** -24 : 2 ** (Math.floor(Math.log2(magnitude)) - 10)
    return magnitude % spacing === 0
  })
}
export function nativeModuloIntegerBand(bounds: [number, number] | null): boolean {
  return bounds !== null && (2 ** 24 <= bounds[0] && bounds[0] <= bounds[1] && bounds[1] < 2 ** 31
    || -(2 ** 31) < bounds[0] && bounds[0] <= bounds[1] && bounds[1] <= -(2 ** 24))
}

// In [2^24,2^31) every finite Float32 input is an exact signed32 integer.
// q*100000 is at most2147400000; both integer product and remainder fit int32.
// Metal's compatible_mod quotient is trunc(f32(a*f32(1/100000))); integer
// subtraction therefore reproduces its fused Float32 remainder exactly, even
// where quotient rounding crosses a boundary (1638499968 yields−32).
const metalModulo = fn(([point]) => {
  const product = point.mul(Math.fround(1 / 100000)).toVar()
  // An observable Float32 bit boundary prevents a wider constant-folded
  // product from changing the native reciprocal quotient before int conversion.
  const word = bits(product, 'uint').toVar()
  const rounded = bits(choose(word.bitAnd(u(0x7f800000)).equal(u(0x7f800000)), u(0), word), 'float')
  const quotient = i(rounded).toVar()
  return f(i(point).sub(quotient.mul(i(100000))))
}).setLayout({ name: 'blendlinkMetalMathMod100000V1', type: 'float', inputs: [{ name: 'point', type: 'float' }] })
const mfModulo = fn(([point]) => {
  const integer = i(point).toVar(), quotient = integer.div(i(100000)).toVar()
  const remainder = integer.sub(quotient.mul(i(100000))).toVar()
  const sign = bits(point, 'uint').bitAnd(u(0x80000000))
  return choose(remainder.equal(i(0)), bits(sign, 'float'), f(remainder))
}).setLayout({ name: 'blendlinkMfMathMod100000V1', type: 'float', inputs: [{ name: 'point', type: 'float' }] })

/** Shared finite scalar admission; range consumers must validate the actual
 * primitive rather than trusting its opcode or a supplied interval. */
export function nativeModuloValidationError(ir:TslIrExpression):string|null {
  if(ir.op!=='math_modulo_native') return 'Native fixed100000 Modulo requires its qualified scalar opcode'
  const input = expression(ir.input)
  if (!input || !nativeModuloIntegerBand(nativeModuloInputBounds(input))) return 'Native fixed100000 Modulo requires a same-sign Float32 input in [2^24,2^31)'
  const literalInput = ir.inputModel === 'literal-f32-v1' && input.op === 'const_float'
  const imageInput = input.op === 'separate' && (ir.inputModel === 'metal-f32-image-v1'
    || ir.inputModel === 'metal-half-exact-image-v1' && nativeModuloHalfExactImage(input))
  if (!literalInput && !imageInput) return 'Native fixed100000 Modulo input precision model is unqualified'
  if (ir.precisionModel === 'metal-mod100000-v1') return null
  if (ir.precisionModel === 'mf-fmod100000-v1' && input.op === 'const_float') {
    if ((input.value as number) < 0 && (input.value as number) % 100000 === 0)
      return 'Native MF fixed100000 Modulo negative-zero composition has no portable Math stage'
    return null
  }
  return 'Native fixed100000 Modulo precision model or constant evaluation stage is unqualified'
}

export function buildNativeMathModulo(ir: TslIrExpression, build: (ir: TslIrExpression) => TslExpression,
  fail: (message: string) => never): TslExpression {
  const error=nativeModuloValidationError(ir)
  if(error) return fail(error)
  const input=expression(ir.input)!
  return (ir.precisionModel==='metal-mod100000-v1'?metalModulo:mfModulo)(build(input)) as TslExpression
}
