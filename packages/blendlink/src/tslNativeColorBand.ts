import * as TSL from 'three/tsl'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'

type Node = any
const { abs, floor, mix, packHalf2x16, select, uint, unpackHalf2x16, vec2, vec3 } = TSL as unknown as Record<
  'abs' | 'floor' | 'mix' | 'packHalf2x16' | 'select' | 'uint' | 'unpackHalf2x16' | 'vec2' | 'vec3', (...args: Node[]) => Node
>

/** Blender material color bands use a normalized linear GPU sampler. The
 * caller supplies its texel position and clamps edge loads. Table storage
 * changed from RGBA16F to RGBA32F in Blender 5.3. This precision belongs to
 * the node itself, independently of the eventual scene render target. */
export function buildNativeColorBandSample(
  expression: TslIrExpression,
  position: TslExpression,
  sample: (index: TslExpression) => TslExpression,
  fail: (message: string) => never,
): TslExpression {
  if (expression.filterFractionBits !== 8 && expression.filterFractionBits !== 0)
    return fail('Native color band interpolation has no verified precision model')
  if (!['rgba16f', 'rgba32f'].includes(String(expression.tableStorage)) ||
      !['rgba16f', 'rgba32f'].includes(String(expression.sampleStorage)) ||
      expression.tableStorage === 'rgba32f' && expression.sampleStorage !== 'rgba32f')
    return fail('Native color band has no verified storage model')
  const value = position as Node
  const low = floor(value)
  const fraction = expression.filterFractionBits === 8
    ? floor(value.sub(low).mul(256).add(0.5)).div(256) : value.sub(low)
  const color = mix(sample(low), sample(low.add(1)), fraction).xyz
  if (expression.sampleStorage !== 'rgba16f') return color as TslExpression
  const rounded = vec3(unpackHalf2x16(packHalf2x16(color.xy)),
    unpackHalf2x16(packHalf2x16(vec2(color.z, 0))).x)
  // Earlier schema1 programs did not record sampler tie behavior and used RNE.
  // Keep those documents stable; a fresh export opts into native nearest-away.
  const rounding = expression.sampleRounding ?? 'nearest-even'
  if (rounding === 'nearest-even') return rounded as TslExpression
  if (rounding !== 'nearest-away') return fail('Native half color band has no verified sample rounding model')
  // Metal rounds exact half ties away from zero. Recover the next outward
  // half via integer bits: log2/exp2 spacing can itself be approximate on
  // shader backends and must not decide exact midpoint equality. Clamp the
  // neighbor at finite half max; interpolation stays inside finite texels.
  const channel = (value: Node, nearest: Node): Node => {
    const magnitude = abs(value), inward = abs(nearest)
    const bits = packHalf2x16(vec2(inward, 0)).bitAnd(uint(0xffff))
    const nextBits = select(bits.lessThan(uint(0x7bff)), bits.add(uint(1)), uint(0x7bff))
    const outward = unpackHalf2x16(uint(nextBits)).x
    const tie = magnitude.greaterThan(inward).and(magnitude.equal(inward.add(outward).mul(.5)))
    return select(tie, outward.mul(select(value.lessThan(0), -1, 1)), nearest)
  }
  return vec3(channel(color.x, rounded.x), channel(color.y, rounded.y), channel(color.z, rounded.z)) as TslExpression
}
