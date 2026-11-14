/* SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 * SPDX-FileCopyrightText: 2026 SceneToWeb contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapted spectral color mathematics from Cycles kernel/svm/math_util.h.
 * Modified for Three.js expressions and explicit serialized color matrices.
 * See assets/blender-spectral-NOTICE.txt and LICENSES.md.
 */
import * as TSL from 'three/tsl'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'
import { buildNativeColorBandSample } from './tslNativeColorBand.js'

// Three's expression proxies carry vector and scalar operators dynamically.
type Node = any
const { ceil, clamp, float, floor, max, mix, select, vec3 } = TSL as unknown as Record<
  'ceil' | 'clamp' | 'float' | 'floor' | 'max' | 'mix' | 'select' | 'vec3', (...args: Node[]) => Node
>
/** Shared source polynomial, with explicit primitive ordering per native evaluator.
 * Existing shader models retain direct division; IMB CPU MF stages 1/T first. */
export function buildBlackbodyPolynomial(temperature:Node,index:number,red:readonly number[],green:readonly number[],blue:readonly number[],stage:'direct-division'|'native-reciprocal'='direct-division'):Node {
  const r=red.slice(index*3,index*3+3),g=green.slice(index*3,index*3+3),b=blue.slice(index*4,index*4+4)
  const inverse=stage==='native-reciprocal'?float(1).div(temperature).toVar():null
  return vec3((inverse?inverse.mul(r[0]):float(r[0]!).div(temperature)).add(temperature.mul(r[1])).add(r[2]),
    (inverse?inverse.mul(g[0]):float(g[0]!).div(temperature)).add(temperature.mul(g[1])).add(g[2]),
    temperature.mul(b[0]).add(b[1]).mul(temperature).add(b[2]).mul(temperature).add(b[3]))
}
export function buildTslSpectralNode(
  expression: TslIrExpression,
  input: TslExpression,
  sample: (index: TslExpression) => TslExpression,
  fail: (message: string) => never,
): TslExpression {
  const numbers = (name: string, size: number): number[] => {
    const value = expression[name]
    if (!Array.isArray(value) || value.length !== size ||
        !value.every(item => typeof item === 'number' && Number.isFinite(item)))
      return fail(`Spectral ${name} requires ${size} finite values`)
    return value
  }
  if (!['blackbody', 'wavelength'].includes(String(expression.kind))) return fail('Unknown spectral color kind')
  const matrix = numbers('matrix', 9)
  const convert = (color: Node): Node => vec3(...[0, 3, 6].map(row =>
    color.x.mul(matrix[row]).add(color.y.mul(matrix[row + 1])).add(color.z.mul(matrix[row + 2]))))
  const value = input as Node
  const read = (index: Node): Node => sample(index)
  if (expression.model === 'eevee-table') {
    if (expression.samples !== 257) return fail('Native EEVEE spectral tables require 257 samples')
    const factor = expression.kind === 'blackbody' ? value.sub(800).div(11200) : value.sub(380).div(400)
    // A normalized GPU linear sampler uses x * width - .5. Edge texels
    // repeat; this differs from a CPU table indexed by x * (width - 1).
    const position = clamp(factor, 0, 1).mul(257).sub(0.5)
    const color = buildNativeColorBandSample(expression, position, read, fail) as Node
    return (expression.kind === 'wavelength' ? clamp(color.mul(1 / 2.52), 0, 1) : color) as TslExpression
  }
  if (expression.model !== 'cycles') return fail('Unknown spectral evaluation model')
  if (expression.kind === 'blackbody') {
    const red = numbers('rCoefficients', 21), green = numbers('gCoefficients', 21), blue = numbers('bCoefficients', 28)
    // Guard inactive branches too: WGSL constant folding rejects division by
    // zero even when a select chooses the below-range native endpoint.
    const temperature = clamp(value, 800, 12000)
    const polynomial = (index: number): Node => buildBlackbodyPolynomial(temperature,index,red,green,blue)
    let color = polynomial(0)
    for (const [index, boundary] of [965, 1167, 1449, 1902, 3315, 6365].entries())
      color = select(value.greaterThanEqual(boundary), polynomial(index + 1), color)
    color = select(value.lessThan(800), vec3(5.413294490189271, -0.20319390035873933, -0.0822535242887164), color)
    color = select(value.greaterThanEqual(12000), vec3(0.8262954810464208, 0.9945080501520986, 1.566307710274283), color)
    return max(convert(color), 0) as TslExpression
  }
  if (expression.samples !== 81) return fail('Cycles wavelength requires 81 native CIE samples')
  const position = value.sub(380).mul(0.2)
  // Native C++ casts toward zero: 375 < lambda < 380 extrapolates bin0.
  const index = select(position.lessThan(0), ceil(position), floor(position))
  const color = mix(read(index), read(index.add(1)), position.sub(index)).xyz
  return select(index.lessThan(0).or(index.greaterThanEqual(80)), vec3(0),
    max(convert(color).mul(1 / 2.52), 0)) as TslExpression
}
