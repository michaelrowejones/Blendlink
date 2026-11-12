import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { PORTABLE_TRIG_REDUCTION_LIMIT, buildPortableTrigParts, buildPortableSine, buildPortableCosine } from './tslPortableTrig.js'

const { Fn, abs, bitcast, clamp, float, select, sign, sqrt, uint } = TSL as unknown as Record<
  'Fn' | 'abs' | 'bitcast' | 'clamp' | 'float' | 'select' | 'sign' | 'sqrt' | 'uint', (...args: TslEffectNode[]) => TslEffectNode
>

export { PORTABLE_TRIG_REDUCTION_LIMIT as COMPOSITOR_TRIG_REDUCTION_LIMIT } from './tslPortableTrig.js'

// Near an odd pi/2 multiple, rounding the reduced phase before a reciprocal
// amplifies its last bit. Keep the two-part phase through one division-residual
// correction. The t/3 cotangent term is included before final float rounding.
const tangentPole = Fn(([high, low]: TslEffectNode[]) => {
  const phase = high.add(low).toVar(), denominator = select(phase.equal(0), 1, phase).toVar()
  const quotient = float(1).div(denominator).toVar()
  const highQ = bitcast(bitcast(quotient, 'uint').bitAnd(uint(0xfffff000)), 'float').toVar()
  const lowQ = quotient.sub(highQ).toVar()
  const productError = (value: TslEffectNode, product: TslEffectNode): TslEffectNode => {
    const head = bitcast(bitcast(value, 'uint').bitAnd(uint(0xfffff000)), 'float').toVar()
    const tail = value.sub(head).toVar()
    return highQ.mul(head).sub(product).add(highQ.mul(tail)).add(lowQ.mul(head)).add(lowQ.mul(tail))
  }
  const first = quotient.mul(high).toVar(), second = quotient.mul(low).toVar()
  const firstError = productError(high, first).toVar(), secondError = productError(low, second).toVar()
  const residual = float(1).sub(first).sub(second).sub(firstError).sub(secondError).toVar()
  return quotient.add(residual.div(denominator).sub(phase.div(3))).negate()
}).setLayout({ name: 'blendlinkCompositorTangentPoleV1', type: 'float', inputs: [
  { name: 'high', type: 'float' }, { name: 'low', type: 'float' },
] })

// https://dlmf.nist.gov/4.24.E1. Reducing to |x|<=.5 bounds the omitted
// positive series tail by2.5e-8 before float32 rounding. The square-root
// identities avoid cancellation in acos near either endpoint.
function asinSmall(value: TslEffectNode): TslEffectNode {
  const square = value.mul(value)
  let polynomial = float(6435 / 557056)
  for (const coefficient of [143 / 10240, 231 / 13312, 63 / 2816, 35 / 1152, 5 / 112, 3 / 40, 1 / 6, 1])
    polynomial = polynomial.mul(square).add(coefficient)
  return value.mul(polynomial)
}

const inverse = Fn(([input, cosine]: TslEffectNode[]) => {
  const value = clamp(input, -1, 1).toVar(), magnitude = abs(value).toVar()
  const root = sqrt(float(1).sub(magnitude).mul(0.5)).toVar()
  const small = asinSmall(value).toVar(), edge = asinSmall(root).mul(2).toVar()
  const arcsine = select(magnitude.lessThanEqual(0.5), small,
    select(value.lessThan(0), edge.sub(Math.PI / 2), float(Math.PI / 2).sub(edge)))
  const arccosine = select(magnitude.lessThanEqual(0.5), float(Math.PI / 2).sub(small),
    select(value.lessThan(0), float(Math.PI).sub(edge), edge))
  return select(cosine, arccosine, arcsine)
}).setLayout({ name: 'blendlinkCompositorInverseTrigV1', type: 'float', inputs: [
  { name: 'value', type: 'float' }, { name: 'cosine', type: 'bool' },
] })

// Mesa GLSL builtin_functions.cpp asin_expr, _asin and _acos. These native
// builtins use different low-degree polynomials, not accurate mathematical
// inverses. Preserve their actual authored pixels explicitly.
const mesaInverse = Fn(([input, cosine]: TslEffectNode[]) => {
  const value = clamp(input, -1, 1).toVar(), magnitude = abs(value).toVar()
  const p0 = select(cosine, .08132463, .086566724), p1 = select(cosine, -.02363318, -.03102955)
  const polynomial = p0.add(magnitude.mul(p1)).mul(magnitude)
    .add(Math.fround(Math.fround(Math.PI / 4) - 1)).mul(magnitude).add(Math.PI / 2)
  const arcsine = sign(value).mul(float(Math.PI / 2).sub(sqrt(float(1).sub(magnitude)).mul(polynomial)))
  return select(cosine, float(Math.PI / 2).sub(arcsine), arcsine)
}).setLayout({ name: 'blendlinkCompositorMesaInverseTrigV1', type: 'float', inputs: [
  { name: 'value', type: 'float' }, { name: 'cosine', type: 'bool' },
] })

/** Fresh exports opt into bounded native-aware math. Old schema1 documents retain
 * their previous intrinsic behavior. Huge arguments use the prior intrinsic;
 * the polynomial reduction makes no claim about their phase accuracy. */
export function buildCompositorMathPrecision(op: SourceCompositorOperation, value: TslEffectNode,
  intrinsic: TslEffectNode, fail: (message: string) => never): TslEffectNode {
  const model = op.properties.math_precision_model
  if (model === undefined) return intrinsic
  if (model !== 'portable-f32-v1') return fail('Compositor Math has no verified precision model')
  const operation = op.properties.operation
  if (operation === 'ARCSINE' || operation === 'ARCCOSINE') {
    const backend = op.properties.math_gpu_intrinsic_model
    if (backend !== undefined && backend !== 'mesa-glsl-v1') return fail('Compositor Math has no verified native GPU intrinsic model')
    return (backend === 'mesa-glsl-v1' ? mesaInverse : inverse)(value, float(operation === 'ARCCOSINE' ? 1 : 0).notEqual(0))
  }
  if (operation === 'POWER' && op.properties.math_fixed_power_exponent === -1)
    return select(value.equal(0), 0, float(1).div(select(value.equal(0), 1, value)))
  if (operation === 'SINE') return buildPortableSine(value, intrinsic)
  if (operation === 'COSINE') return buildPortableCosine(value, intrinsic)
  if (operation !== 'TANGENT') return intrinsic
  const values = buildPortableTrigParts(value)
  const phase = values.z.add(values.w)
  const tangent = select(abs(phase).lessThan(2 ** -12).and(abs(values.x).greaterThan(abs(values.y))),
    tangentPole(values.z, values.w), values.x.div(select(values.y.equal(0), 1, values.y)))
  return select(abs(value).lessThanEqual(PORTABLE_TRIG_REDUCTION_LIMIT), tangent, intrinsic)
}
