/* SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 * SPDX-FileCopyrightText: 2026 SceneToWeb contributors
 * SPDX-License-Identifier: Apache-2.0
 * Adapted from Cycles kernel/svm/brick.h for Three.js node expressions.
 * See assets/blender-spectral-NOTICE.txt and LICENSES.md. */
import * as TSL from 'three/tsl'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'

type Node = any
const { bitcast, clamp, float, floor, Fn, int, min, select, uint } = TSL as unknown as Record<
  'bitcast' | 'clamp' | 'float' | 'floor' | 'Fn' | 'int' | 'min' | 'select' | 'uint', (...args: Node[]) => Node
>
const noise = Fn(([incoming]: Node[]) => {
  let n = incoming.add(uint(1013)).bitAnd(uint(0x7fffffff))
  n = n.shiftRight(uint(13)).bitXor(n)
  const value = n.mul(n.mul(n).mul(uint(60493)).add(uint(19990303))).add(uint(1376312589)).bitAnd(uint(0x7fffffff))
  return float(value).div(1073741824).mul(0.5)
}).setLayout({ name: 'blendlinkBrickNoise', type: 'float', inputs: [{ name: 'incoming', type: 'uint' }] })

export function buildTslBrickNode(
  expression: TslIrExpression,
  build: (expression: TslIrExpression) => TslExpression,
  fail: (message: string) => never,
): TslExpression {
  const child = (key: string): Node => {
    const value = expression[key]
    if (!value || typeof value !== 'object' || typeof (value as TslIrExpression).op !== 'string')
      return fail('Brick Texture requires an expression for ' + key)
    return build(value as TslIrExpression)
  }
  const property = (key: string, integer = false): number => {
    const value = expression[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || (integer && (!Number.isInteger(value) || value < 0 || value > 99)))
      return fail('Brick Texture has an invalid ' + key)
    return value
  }
  if (!['color', 'fac'].includes(String(expression.output))) return fail('Brick Texture has an unknown output')
  const offsetAmount = property('offsetAmount'), offsetFrequency = property('offsetFrequency', true)
  const squashAmount = property('squashAmount'), squashFrequency = property('squashFrequency', true)
  const p = child('vector').mul(child('scale'))
  let width = child('brickWidth')
  const height = child('rowHeight')
  const row = floor(p.y.div(height))
  let offset = float(0)
  if (offsetFrequency && squashFrequency) {
    // Only divisibility matters; signed modulo and floored modulo agree at zero.
    const squashRow = row.sub(floor(row.div(squashFrequency)).mul(squashFrequency)).equal(0)
    width = width.mul(select(squashRow, float(squashAmount), float(1)))
    const offsetRow = row.sub(floor(row.div(offsetFrequency)).mul(offsetFrequency)).equal(0)
    offset = select(offsetRow, width.mul(offsetAmount), float(0))
  }
  const brick = floor(p.x.add(offset).div(width))
  const x = p.x.add(offset).sub(width.mul(brick)), y = p.y.sub(height.mul(row))
  const cell = bitcast(int(row), 'uint').shiftLeft(uint(16)).add(bitcast(int(brick), 'uint').bitAnd(uint(0xffff)))
  const tint = clamp(noise(cell).add(child('bias')), 0, 1)
  const distance = min(min(x, y), min(width.sub(x), height.sub(y)))
  const size = child('mortarSize'), smooth = child('mortarSmooth')
  // Inactive branches must remain finite for WGSL constant folding as well.
  const normalized = float(1).sub(distance.div(select(size.equal(0), float(1), size)))
  const t = clamp(normalized.div(select(smooth.equal(0), float(1), smooth)), 0, 1)
  const mortar = select(distance.greaterThanEqual(size), float(0),
    select(smooth.equal(0), float(1), t.mul(t).mul(float(3).sub(t.mul(2)))))
  if (expression.output === 'fac') return mortar as TslExpression
  const first = child('color1'), second = child('color2'), mortarColor = child('mortar')
  const brickColor = first.mul(float(1).sub(tint)).add(second.mul(tint))
  return brickColor.mul(float(1).sub(mortar)).add(mortarColor.mul(mortar)) as TslExpression
}
