import * as TSL from 'three/tsl'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'

type Node = any
const { floor, mix, packHalf2x16, unpackHalf2x16, vec2, vec3 } = TSL as unknown as Record<
  'floor' | 'mix' | 'packHalf2x16' | 'unpackHalf2x16' | 'vec2' | 'vec3', (...args: Node[]) => Node
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
  if (expression.filterFractionBits !== 8)
    return fail('Native color band interpolation has no verified precision model')
  if (!['rgba16f', 'rgba32f'].includes(String(expression.tableStorage)) ||
      expression.sampleStorage !== expression.tableStorage)
    return fail('Native color band has no verified storage model')
  const value = position as Node
  const low = floor(value)
  const fraction = floor(value.sub(low).mul(256).add(0.5)).div(256)
  const color = mix(sample(low), sample(low.add(1)), fraction).xyz
  return (expression.sampleStorage === 'rgba16f'
    ? vec3(unpackHalf2x16(packHalf2x16(color.xy)),
      unpackHalf2x16(packHalf2x16(vec2(color.z, 0))).x) : color) as TslExpression
}
