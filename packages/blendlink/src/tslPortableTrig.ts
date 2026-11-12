import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, abs, clamp, cos, float, floor, select, sin, vec2, vec4 } = TSL as unknown as Record<
  'Fn' | 'abs' | 'clamp' | 'cos' | 'float' | 'floor' | 'select' | 'sin' | 'vec2' | 'vec4',
  (...args: TslEffectNode[]) => TslEffectNode
>

// Factorial series: https://dlmf.nist.gov/4.19.E1 and4.19.E2. Reduction uses
// three rational pi/2 parts plus its float32 residual. Products with the
// rational parts are exact inside this bound; no rounded pi is subtracted.
export const PORTABLE_TRIG_REDUCTION_LIMIT = 8192
const sinCos = Fn(([angle]: TslEffectNode[]) => {
  const quadrant = floor(angle.mul(2 / Math.PI).add(0.5)).toVar()
  const high = angle.sub(quadrant.mul(201 / 128)).toVar()
  const middle = high.sub(quadrant.mul(2029 / 4194304)).toVar()
  const lowProduct = quadrant.mul(1297 / 17179869184).toVar()
  const low = middle.sub(lowProduct).toVar()
  const virtual = low.sub(middle).toVar()
  const lowError = middle.sub(low.sub(virtual)).sub(lowProduct.add(virtual)).toVar()
  const tail = lowError.sub(quadrant.mul(2.563344151594519e-12)).toVar()
  const reduced = low.add(tail).toVar(), square = reduced.mul(reduced).toVar()
  let sine = float(-1 / 6227020800)
  for (const coefficient of [1 / 39916800, -1 / 362880, 1 / 5040, -1 / 120, 1 / 6])
    sine = sine.mul(square).add(coefficient)
  sine = reduced.mul(float(1).sub(square.mul(sine)))
  let cosine = float(-1 / 87178291200)
  for (const coefficient of [1 / 479001600, -1 / 3628800, 1 / 40320, -1 / 720, 1 / 24, -1 / 2])
    cosine = cosine.mul(square).add(coefficient)
  cosine = cosine.mul(square).add(1)
  const part = quadrant.sub(floor(quadrant.mul(0.25)).mul(4)).toVar()
  const pair = select(part.equal(0), vec2(sine, cosine), select(part.equal(1), vec2(cosine, sine.negate()),
    select(part.equal(2), vec2(sine.negate(), cosine.negate()), vec2(cosine.negate(), sine))))
  return vec4(pair, low, tail)
}).setLayout({ name: 'blendlinkPortableSinCosV1', type: 'vec4', inputs: [{ name: 'angle', type: 'float' }] })

/** Bounded sin/cos in xy and a two-part reduced phase in zw for accurate
 * cotangent reconstruction. Callers must retain the original intrinsic outside
 * the documented bound; the input here is clamped for safe inactive branches. */
export function buildPortableTrigParts(value: TslEffectNode): TslEffectNode {
  return sinCos(clamp(value, -PORTABLE_TRIG_REDUCTION_LIMIT, PORTABLE_TRIG_REDUCTION_LIMIT))
}

/** Pure scalar sine with a proven bounded reduction and prior intrinsic beyond
 * that bound. No shader/compositor color or native evaluation semantics apply. */
export function buildPortableSine(value: TslEffectNode, intrinsic = sin(value)): TslEffectNode {
  return select(abs(value).lessThanEqual(PORTABLE_TRIG_REDUCTION_LIMIT), buildPortableTrigParts(value).x, intrinsic)
}

export function buildPortableCosine(value: TslEffectNode, intrinsic = cos(value)): TslEffectNode {
  return select(abs(value).lessThanEqual(PORTABLE_TRIG_REDUCTION_LIMIT), buildPortableTrigParts(value).y, intrinsic)
}
