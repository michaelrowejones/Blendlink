/* SPDX-FileCopyrightText: 2009-2010 Sony Pictures Imageworks Inc., et al. All Rights Reserved.
 * SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 * SPDX-FileCopyrightText: 2026 SceneToWeb contributors
 * SPDX-License-Identifier: BSD-3-Clause AND Apache-2.0
 * Perlin/hash kernel adapted from Cycles kernel/svm/noise.h and util/hash.h.
 * FBM recurrence adapted from kernel/svm/fractal_noise.h (Apache-2.0). */
import type { TslIrExpression } from './tslNodeRecipe.js'

type Vector = readonly [number, number, number]
type Constant = number | Vector
const F = Math.fround, add = (a: number, b: number): number => F(a + b),
  sub = (a: number, b: number): number => F(a - b), mul = (a: number, b: number): number => F(a * b)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const ordinary = (value: number): boolean => Number.isFinite(value) && (value === 0 || Math.abs(value) >= 2 ** -126)
const literal = (value: unknown): value is number => finite(value) && F(value) === value && ordinary(value)

/** An executable subset, not a staticness claim supplied by the payload. No
 * textures, coordinates, uniforms, nested Noise or source readbacks enter it.
 * Ambiguous contracted multiply-add / approximate division stays on the GPU. */
export function evaluateStaticNoiseInput(expression: TslIrExpression,
  { exactArithmetic = false }: { exactArithmetic?: boolean } = {}): Constant | undefined {
  const exactSum = (a: number, b: number): boolean => a === 0 || b === 0
    || Math.abs(Math.floor(Math.log2(Math.abs(a))) - Math.floor(Math.log2(Math.abs(b)))) <= 24 && add(a, b) === a + b
  const sum = (a: number, b: number): number => exactArithmetic && !exactSum(a, b) ? NaN : add(a, b)
  const difference = (a: number, b: number): number => sum(a, -b)
  const product = (a: number, b: number): number => exactArithmetic && mul(a, b) !== a * b ? NaN : mul(a, b)
  let count = 0
  const visiting = new Set<object>()
  const visit = (value: unknown, depth: number): Constant | undefined => {
    if (!value || typeof value !== 'object' || depth > 32 || ++count > 256 || visiting.has(value)) return undefined
    const node = value as TslIrExpression
    visiting.add(node)
    const child = (key: string): Constant | undefined => visit(node[key], depth + 1)
    const scalar = (key: string): number | undefined => { const result = child(key); return typeof result === 'number' ? result : undefined }
    let result: Constant | undefined
    try {
      switch (node.op) {
        case 'const_float': if (literal(node.value)) result = node.value; break
        case 'const_vec3':
          if (Array.isArray(node.value) && node.value.length === 3 && node.value.every(literal)) result = node.value as unknown as Vector
          break
        case 'combine': {
          const parts = ['x', 'y', 'z'].map(scalar)
          if (parts.every(part => part !== undefined)) result = parts as unknown as Vector
          break
        }
        case 'separate': {
          const input = child('input'), axis = ['x', 'y', 'z'].indexOf(String(node.channel))
          if (Array.isArray(input) && axis >= 0) result = input[axis]
          break
        }
        case 'vector_scale': {
          const input = child('input'), scale = scalar('scale')
          if (Array.isArray(input) && scale !== undefined) result = input.map(part => product(part, scale)) as unknown as Vector
          break
        }
        case 'math': {
          const a = scalar('a'), b = 'b' in node ? scalar('b') : undefined, c = 'c' in node ? scalar('c') : undefined
          if (a === undefined) break
          if (node.operation === 'ADD' && b !== undefined) result = sum(a, b)
          else if (node.operation === 'SUBTRACT' && b !== undefined) result = difference(a, b)
          else if (node.operation === 'MULTIPLY' && b !== undefined) result = product(a, b)
          else if (node.operation === 'MULTIPLY_ADD' && b !== undefined && c !== undefined && mul(a, b) === a * b) result = sum(mul(a, b), c)
          else if (node.operation === 'DIVIDE' && b !== undefined && b !== 0 && F(a / b) === a / b) result = F(a / b)
          else if (node.operation === 'MINIMUM' && b !== undefined) result = Math.min(a, b)
          else if (node.operation === 'MAXIMUM' && b !== undefined) result = Math.max(a, b)
          else if (node.operation === 'ABSOLUTE') result = Math.abs(a)
          break
        }
        case 'vector_math': {
          const a = child('a'), b = child('b'), c = 'c' in node ? child('c') : undefined
          if (!Array.isArray(a) || !Array.isArray(b)) break
          const parts = a.map((part, axis) => {
            if (node.operation === 'ADD') return sum(part, b[axis]!)
            if (node.operation === 'SUBTRACT') return difference(part, b[axis]!)
            if (node.operation === 'MULTIPLY') return product(part, b[axis]!)
            if (node.operation === 'MULTIPLY_ADD' && Array.isArray(c) && mul(part, b[axis]!) === part * b[axis]!) return sum(mul(part, b[axis]!), c[axis]!)
            return NaN
          })
          if (parts.every(ordinary)) result = parts as unknown as Vector
          break
        }
      }
      if (result === undefined || !(typeof result === 'number' ? ordinary(result) : result.every(ordinary))) return undefined
      return result
    } finally { visiting.delete(node) }
  }
  return visit(expression, 0)
}

const rotate = (value: number, bits: number): number => (value << bits | value >>> (32 - bits)) >>> 0
function hash4(x: number, y: number, z: number, w: number): number {
  const seed = 0xdeadbeef + (4 << 2) + 13
  let a = (seed + x) >>> 0, b = (seed + y) >>> 0, c = (seed + z) >>> 0
  a = (a - c) >>> 0; a = (a ^ rotate(c, 4)) >>> 0; c = (c + b) >>> 0
  b = (b - a) >>> 0; b = (b ^ rotate(a, 6)) >>> 0; a = (a + c) >>> 0
  c = (c - b) >>> 0; c = (c ^ rotate(b, 8)) >>> 0; b = (b + a) >>> 0
  a = (a - c) >>> 0; a = (a ^ rotate(c, 16)) >>> 0; c = (c + b) >>> 0
  b = (b - a) >>> 0; b = (b ^ rotate(a, 19)) >>> 0; a = (a + c) >>> 0
  c = (c - b) >>> 0; c = (c ^ rotate(b, 4)) >>> 0; b = (b + a) >>> 0
  a = (a + w) >>> 0
  c = ((c ^ b) - rotate(b, 14)) >>> 0
  a = ((a ^ c) - rotate(c, 11)) >>> 0
  b = ((b ^ a) - rotate(a, 25)) >>> 0
  c = ((c ^ b) - rotate(b, 16)) >>> 0
  a = ((a ^ c) - rotate(c, 4)) >>> 0
  b = ((b ^ a) - rotate(a, 14)) >>> 0
  return ((c ^ b) - rotate(b, 24)) >>> 0
}
const fade = (t: number): number => mul(mul(mul(t, t), t), add(mul(t, sub(mul(t, 6), 15)), 10))
const mix = (a: number, b: number, t: number): number => add(mul(sub(1, t), a), mul(t, b))

/** Standard scalar kernel only. No periodic reduction is inferred here. */
export function staticStandardPerlin4d(point: readonly number[]): number {
  const lattice = point.map(Math.floor), fraction = point.map((value, axis) => sub(value, lattice[axis]!)), weights = fraction.map(fade)
  const gradient = (i: number, j: number, k: number, l: number): number => {
    const p = fraction.map((value, axis) => sub(value, [i, j, k, l][axis]!))
    const h = hash4((lattice[0]! + i) >>> 0, (lattice[1]! + j) >>> 0, (lattice[2]! + k) >>> 0, (lattice[3]! + l) >>> 0) & 31
    const u = h < 24 ? p[0]! : p[1]!, v = h < 16 ? p[1]! : p[2]!, s = h < 8 ? p[2]! : p[3]!
    return add(add(h & 1 ? -u : u, h & 2 ? -v : v), h & 4 ? -s : s)
  }
  const plane = (k: number, l: number): number => mix(mix(gradient(0, 0, k, l), gradient(1, 0, k, l), weights[0]!),
    mix(gradient(0, 1, k, l), gradient(1, 1, k, l), weights[0]!), weights[1]!)
  return mul(mix(mix(plane(0, 0), plane(1, 0), weights[2]!), mix(plane(0, 1), plane(1, 1), weights[2]!), weights[3]!), F(.8344))
}

/** Fresh 4D static Color only. Returning undefined leaves the existing GPU
 * graph untouched. Every evaluated seeded octave must prove reducer identity. */
export function foldStaticNoise4dColor(expression: TslIrExpression): Vector | undefined {
  if (!['noise_fractal', 'noise_normalized'].includes(expression.op) || expression.dimensions !== 4 || expression.output !== 'color'
    || expression.noiseType !== undefined && expression.noiseType !== 'FBM' || expression.roughnessNode !== undefined
    || expression.distortion !== undefined && expression.distortion !== 0) return undefined
  const normalized = expression.op === 'noise_normalized'
  if (normalized ? expression.normalize !== true || !['native-standard-f32', 'mf-periodic-f32', 'eevee-metal-periodic-f32'].includes(String(expression.perlinModel))
    : expression.normalize !== undefined && expression.normalize !== false || expression.perlinModel !== undefined && expression.perlinModel !== 'native-standard-f32') return undefined
  const { detail, roughness } = expression, lacunarity = expression.lacunarity ?? 2
  if (![detail, roughness, lacunarity].every(finite) || (detail as number) > 6 || (roughness as number) > 1 || Math.abs(lacunarity as number) > 2) return undefined
  const scaleNode = expression.scale as TslIrExpression | undefined
  if (scaleNode?.op !== 'const_float' || !literal(scaleNode.value) || Math.abs(scaleNode.value) > 80) return undefined
  // Native MF stores each operation in Float32. Legacy shader-constant folding
  // can retain wider intermediates, so only exact arithmetic is portable there.
  const options = { exactArithmetic: expression.evaluationModel !== 'shader-mf' }
  const input = evaluateStaticNoiseInput(expression.input as TslIrExpression, options), w = evaluateStaticNoiseInput(expression.w as TslIrExpression, options)
  if (!Array.isArray(input) || typeof w !== 'number') return undefined
  const offsets = expression.colorOffsets
  if (!Array.isArray(offsets) || offsets.length !== 2 || offsets.some(offset => !Array.isArray(offset) || offset.length !== 4 || !offset.every(literal))) return undefined
  if (expression.distortion === 0 && (!Array.isArray(expression.distortionOffsets) || expression.distortionOffsets.length !== 4
    || expression.distortionOffsets.some(offset => !Array.isArray(offset) || offset.length !== 4 || !offset.every(finite)))) return undefined
  const position = [...input, w].map(value => mul(value, F(scaleNode.value as number)))
  const amount = Math.max(0, F(detail as number)), count = Math.floor(amount), remainder = sub(amount, count)
  const ratio = Math.max(0, F(roughness as number)), lac = F(lacunarity as number)
  const fractal = (point: readonly number[]): number | undefined => {
    let frequency = 1, amplitude = 1, total = 0, sum = 0
    const octave = (): number | undefined => {
      const sample = point.map(value => mul(value, frequency))
      if (sample.some(value => !ordinary(value) || Math.abs(value) >= 90000)) return undefined
      return staticStandardPerlin4d(sample)
    }
    for (let index = 0; index <= count; index++) {
      const noise = octave(); if (noise === undefined) return undefined
      sum = add(sum, mul(noise, amplitude)); total = add(total, amplitude)
      amplitude = mul(amplitude, ratio); frequency = mul(frequency, lac)
    }
    const normalize = (value: number, weight: number): number => add(F(mul(.5, value) / weight), .5)
    if (remainder !== 0) {
      const noise = octave(); if (noise === undefined) return undefined
      const extra = add(sum, mul(noise, amplitude))
      return normalized ? mix(normalize(sum, total), normalize(extra, add(total, amplitude)), remainder) : mix(sum, extra, remainder)
    }
    return normalized ? normalize(sum, total) : sum
  }
  const results = [position, ...offsets.map(offset => position.map((value, axis) => add(value, F(offset[axis]))))].map(fractal)
  return results.every(value => value !== undefined && ordinary(value)) ? results as unknown as Vector : undefined
}
