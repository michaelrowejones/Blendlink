import { clamp, float, floor, min, mix, select, vec3 } from 'three/tsl'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'
import { buildNativeColorBandSample } from './tslNativeColorBand.js'

type Node = any
/** The curve table models differ natively; none are surface texture bakes. */
export function buildTslCurveNode(
  expression: TslIrExpression, incoming: TslExpression, factor: TslExpression,
  sample: (index: Node) => Node, fail: (message: string) => never,
): TslExpression {
  const kind = String(expression.kind), model = String(expression.model)
  if (!['float', 'vector', 'rgb'].includes(kind)) return fail('Unknown native shader curve kind')
  if (!['cycles', 'shader-mf', 'eevee-gpu'].includes(model)) return fail('Unknown native shader curve evaluation model')
  const finite = (values: unknown, size: number): values is number[] => Array.isArray(values) &&
    values.length === size && values.every(value => typeof value === 'number' && Number.isFinite(value))
  if (expression.samples !== 257 || !finite(expression.values, 257 * 4)) return fail('Shader curves require 257 finite RGBA samples')
  const table = (parameter: Node, channel: number, low: number, high: number,
    slopes?: number[]): Node => {
    const normalized = parameter.sub(low).div(high - low)
    const coordinate = clamp(normalized, 0, 1).mul(256)
    const index = floor(coordinate), fraction = coordinate.sub(index)
    const lane = ['x', 'y', 'z', 'w'][channel]!
    const first = (sample(float(0)) as Node)[lane], last = (sample(float(256)) as Node)[lane]
    const sampled = model === 'eevee-gpu' ? (buildNativeColorBandSample(expression, coordinate as unknown as TslExpression,
      index => vec3(sample(clamp(index as Node, 0, 256))[lane]) as unknown as TslExpression, fail) as Node).x
      : mix((sample(index) as Node)[lane], (sample(min(index.add(1), 256)) as Node)[lane], fraction)
    if (model === 'cycles') {
      if (expression.extrapolate !== true) return sampled
      const before = first.add(first.sub((sample(float(1)) as Node)[lane]).mul(normalized.negate()).mul(256))
      const after = last.add(last.sub((sample(float(255)) as Node)[lane]).mul(normalized.sub(1)).mul(256))
      return select(normalized.lessThan(0), before, select(normalized.greaterThan(1), after, sampled))
    }
    return select(parameter.lessThan(low), first.add(parameter.sub(low).mul(slopes![0])),
      select(parameter.greaterThan(high), last.add(parameter.sub(high).mul(slopes![1])), sampled))
  }
  let evaluate: (parameter: Node, channel: number) => Node
  if (model === 'cycles') {
    const domain = expression.domain
    if (!finite(domain, 2) || domain[1]! <= domain[0]!) return fail('Cycles curves require a finite nonzero input domain')
    evaluate = (parameter, channel) => table(parameter, channel, domain[0]!, domain[1]!)
  } else {
    const count = kind === 'rgb' ? 4 : kind === 'vector' ? 3 : 1
    const ranges = expression.ranges as number[][], slopes = expression.slopes as number[][]
    if (!Array.isArray(ranges) || ranges.length !== count || !Array.isArray(slopes) || slopes.length !== count ||
      ranges.some(row => !finite(row, 2) || row[1]! <= row[0]!) || slopes.some(row => !finite(row, 2)))
      return fail('Shader MF curves require finite native per-channel ranges and slopes')
    evaluate = (parameter, channel) => table(parameter, channel, ranges[channel]![0]!, ranges[channel]![1]!, slopes[channel])
  }
  const value = incoming as Node
  let curved: Node
  if (kind === 'float') {
    curved = evaluate(value, 0)
    if (model === 'shader-mf' && expression.clip === true) {
      if (!finite(expression.clipY, 2) || expression.clipY[1]! < expression.clipY[0]!) return fail('Float Curve has an invalid clipping range')
      curved = clamp(curved, expression.clipY[0], expression.clipY[1])
    }
  } else {
    curved = vec3(...['x', 'y', 'z'].map((axis, channel) => evaluate(
      model !== 'cycles' && kind === 'rgb' ? evaluate(value[axis], 3) : value[axis], channel)))
    if (kind === 'rgb' && model === 'eevee-gpu' && expression.rgbIdentity === true)
      curved = vec3(...['x', 'y', 'z'].map(axis => evaluate(value[axis], 3)))
  }
  // Native shader Factor permits extrapolation, unlike compositor RGB Curves.
  return mix(value, curved, factor as Node) as unknown as TslExpression
}
