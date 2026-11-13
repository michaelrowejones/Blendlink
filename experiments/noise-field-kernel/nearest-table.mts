/* SPDX-License-Identifier: Apache-2.0 */
import { foldStaticNoise4dColor } from '../../packages/blendlink/src/staticNoise4d.js'
import { usesNoiseFieldBarrier } from '../../packages/blendlink/src/tslNoiseFieldBarrier.js'
import type { TslIrExpression } from '../../packages/blendlink/src/tslNodeRecipe.js'
const F = Math.fround
const ordinary = (value: number): boolean => Number.isFinite(value) && (value === 0 || Math.abs(value) >= 2 ** -126)
const expression = (value: unknown): TslIrExpression => value as TslIrExpression

/** Explicit research-only pointwise specialization. Every immutable nearest
 * input texel is evaluated by the existing pure kernel, never native readback.
 * The original nearest coordinate/wrapping semantics remain in the image IR. */
export function lowerNearestNoiseField(ir: TslIrExpression) {
  if (!usesNoiseFieldBarrier(ir)) return undefined
  const supported = new Set(['op','normalize','output','dimensions','detail','roughness','lacunarity','scale','noiseType',
    'evaluationModel','offsetModel','perlinModel','input','w','colorOffsets'])
  if (Object.keys(ir).some(key => !supported.has(key))) return undefined

  const started = performance.now(), image = expression(ir.input), w = expression(ir.w)
  const pixels = image.pixels as number[], scale = expression(ir.scale).value as number
  const scalar = (value: TslIrExpression): boolean => value.op === 'const_float'
    && Object.keys(value).every(key => key === 'op' || key === 'value')
  if (!scalar(expression(ir.scale)) || (w.op === 'const_float' ? !scalar(w)
    : !scalar(expression(w.b)) || !scalar(expression(w.c)))) return undefined
  // Half-subnormal native image sampling has not been certified by this profile.
  if (pixels.some(value => value !== 0 && Math.abs(value) < 2 ** -14)) return undefined
  const offsets = ir.colorOffsets
  if (!Array.isArray(offsets) || offsets.length !== 2 || !offsets.every(offset => Array.isArray(offset) && offset.length === 4
    && offset.every(value => typeof value === 'number' && ordinary(value) && F(value) === value))) return undefined
  const wValue = (index: number): number => w.op === 'const_float' ? w.value as number : F(F(pixels[index + 1]! * .5) + .125)
  const low = [Infinity, Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity, -Infinity]
  for (let index = 0; index < pixels.length; index += 4) {
    const point = [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!, wValue(index)].map(value => F(value * scale))
    point.forEach((value, axis) => { low[axis] = Math.min(low[axis]!, value); high[axis] = Math.max(high[axis]!, value) })
  }
  // Independent monotone interval proof of every seeded octave. Exact kernel
  // evaluation checks each individual sample again; neither stage trusts a
  // source-supplied bound or a finite list of expected native output pixels.
  const detail = F(ir.detail as number), count = Math.floor(detail), fraction = F(detail - count)
  const lacunarity = F((ir.lacunarity ?? 2) as number)
  if (!Number.isFinite(lacunarity) || Math.abs(lacunarity) > 2) return undefined
  let maximum = 0
  for (const offset of [[0,0,0,0], ...offsets]) {
    const start = low.map((value, axis) => F(value + offset[axis])), end = high.map((value, axis) => F(value + offset[axis]))
    let frequency = 1
    for (let index = 0; index <= count + (fraction !== 0 ? 1 : 0); index++) {
      for (let axis = 0; axis < 4; axis++) {
        const a = F(start[axis]! * frequency), b = F(end[axis]! * frequency)
        if (!ordinary(a) || !ordinary(b) || Math.max(Math.abs(a), Math.abs(b)) >= 90000) return undefined
        maximum = Math.max(maximum, Math.abs(a), Math.abs(b))
      }
      frequency = F(frequency * lacunarity)
    }
  }
  const output = new Float32Array(pixels.length), memo = new Map<string, readonly number[]>()
  const pointBits = new Float32Array(4), words = new Uint32Array(pointBits.buffer)
  let minimum = Infinity, maxOutput = -Infinity
  for (let index = 0; index < pixels.length; index += 4) {
    const value = wValue(index)
    pointBits.set([pixels[index]!, pixels[index + 1]!, pixels[index + 2]!, value])
    const key = words.join(',') // Retains signed zero; no pixel/source hashes grant admission.
    let color = memo.get(key)
    if (!color) {
      color = foldStaticNoise4dColor({ ...ir, input: { op: 'const_vec3', value: Array.from(pointBits.subarray(0, 3)) },
        w: { op: 'const_float', value } })
      if (!color) return undefined
      memo.set(key, color)
    }
    for (let axis = 0; axis < 3; axis++) {
      output[index + axis] = color[axis]!
      minimum = Math.min(minimum, color[axis]!); maxOutput = Math.max(maxOutput, color[axis]!)
    }
    output[index + 3] = 1
  }
  return { image: { ...image, pixels: Array.from(output) }, stats: {
    pixels: pixels.length / 4, uniquePoints: memo.size, inputBytes: pixels.length * 4, outputBytes: output.byteLength,
    kernelDomainMaximum: maximum, minimum, maximum: maxOutput, prepareMilliseconds: performance.now() - started,
  } }
}
