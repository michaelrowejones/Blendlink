/* SPDX-FileCopyrightText: 2026 Blender Authors
 * SPDX-FileCopyrightText: 2026 Blendlink contributors
 * SPDX-License-Identifier: Apache-2.0
 * Integer operations adapted from Cycles kernel/svm/integer_math.h. */
import * as TSL from 'three/tsl'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'

type Node = any
const { abs, acos, asin, bool, clamp, dot, float, Fn, If, int, length, Loop,
  max, min, select, vec3, vec4 } = TSL as unknown as Record<string, (...args: Node[]) => Node>
const MIN = -2147483648
const integerFunction = (name: string, count: number, callback: (args: Node[]) => Node): Node =>
  Fn!(callback).setLayout({ name: 'blendlinkInteger' + name, type: 'int',
    inputs: Array.from({ length: count }, (_, index) => ({ name: 'arg' + index, type: 'int' })) })
const quotient = integerFunction('Quotient', 2, ([a, b]) => {
  const overflow = a.equal(int!(MIN)).and(b.equal(int!(-1)))
  const divisor = select!(b.equal(int!(0)).or(overflow), int!(1), b)
  return select!(b.equal(int!(0)), int!(0), select!(overflow, int!(MIN), a.div(divisor)))
})
const remainder = (a: Node, b: Node): Node => a.sub(quotient(a, b).mul(b))
const flooredQuotient = integerFunction('Floor', 2, ([a, b]) => {
  const q = quotient(a, b)
  return select!(b.equal(int!(0)), int!(0), q.sub(select!(
    remainder(a, b).notEqual(int!(0)).and(a.lessThan(int!(0)).notEqual(b.lessThan(int!(0)))), int!(1), int!(0))))
})
const gcd = integerFunction('Gcd', 2, ([incomingA, incomingB]) => {
  const a = abs!(incomingA).toVar(), b = abs!(incomingB).toVar()
  // Euclid needs at most46 steps for32-bit inputs. Keep a static upper bound
  // so both browser shader compilers can verify termination.
  Loop!({ start: 0, end: 48, type: 'int' }, () => {
    If!(b.notEqual(int!(0)), () => {
      const previous = b.toVar()
      b.assign(remainder(a, b)); a.assign(previous)
    })
  })
  return a
})
const power = integerFunction('Power', 2, ([incomingBase, incomingExponent]) => {
  const base = incomingBase.toVar(), exponent = incomingExponent.toVar(), result = int!(1).toVar()
  Loop!({ start: 0, end: 31, type: 'int' }, () => {
    If!(exponent.greaterThan(int!(0)), () => {
      If!(exponent.bitAnd(int!(1)).notEqual(int!(0)), () => { result.mulAssign(base) })
      exponent.assign(exponent.shiftRight(int!(1))); base.mulAssign(base)
    })
  })
  return select!(incomingExponent.lessThan(int!(0)),
    select!(abs!(incomingBase).equal(int!(1)),
      select!(incomingBase.lessThan(int!(0)).and(incomingExponent.bitAnd(int!(1)).notEqual(int!(0))), int!(-1), int!(1)), int!(0)), result)
})

const integerOperations: Record<string, Node> = {
  ADD: integerFunction('Add', 2, ([a, b]) => a.add(b)),
  SUBTRACT: integerFunction('Subtract', 2, ([a, b]) => a.sub(b)),
  MULTIPLY: integerFunction('Multiply', 2, ([a, b]) => a.mul(b)),
  MULTIPLY_ADD: integerFunction('MultiplyAdd', 3, ([a, b, c]) => a.mul(b).add(c)),
  DIVIDE: quotient,
  DIVIDE_FLOOR: flooredQuotient,
  DIVIDE_CEIL: integerFunction('Ceil', 2, ([a, b]) => select!(b.equal(int!(0)), int!(0), flooredQuotient(a, b.negate()).negate())),
  DIVIDE_ROUND: integerFunction('Round', 2, ([a, b]) => {
    const divisor = abs!(b), sign = select!(b.greaterThan(int!(0)), int!(1), select!(b.lessThan(int!(0)), int!(-1), int!(0)))
    const numerator = select!(a.greaterThanEqual(int!(0)), a, a.negate()).mul(int!(2)).add(divisor)
    const rounded = quotient(numerator, divisor.mul(int!(2))).mul(sign)
    return select!(a.greaterThanEqual(int!(0)), rounded, rounded.negate())
  }),
  MODULO: integerFunction('Modulo', 2, ([a, b]) => select!(b.equal(int!(0)), int!(0), remainder(a, b))),
  FLOORED_MODULO: integerFunction('FlooredModulo', 2, ([a, b]) => select!(b.equal(int!(0)), int!(0), a.sub(flooredQuotient(a, b).mul(b)))),
  ABSOLUTE: integerFunction('Absolute', 1, ([a]) => abs!(a)),
  NEGATE: integerFunction('Negate', 1, ([a]) => a.negate()),
  SIGN: integerFunction('Sign', 1, ([a]) => select!(a.greaterThan(int!(0)), int!(1), select!(a.lessThan(int!(0)), int!(-1), int!(0)))),
  MINIMUM: integerFunction('Minimum', 2, ([a, b]) => select!(a.lessThan(b), a, b)),
  MAXIMUM: integerFunction('Maximum', 2, ([a, b]) => select!(a.greaterThan(b), a, b)),
  POWER: power,
  GCD: gcd,
  LCM: integerFunction('Lcm', 2, ([a, b]) => abs!(quotient(a, gcd(a, b)).mul(b))),
}
const cpuLcm = integerFunction('CpuLcm', 2, ([a, b]) => quotient(abs!(a), gcd(a, b)).mul(abs!(b)))
const cyclesFlooredModulo = integerFunction('CyclesFlooredModulo', 2, ([a, b]) =>
  select!(b.equal(int!(0)), int!(0), remainder(remainder(a, b).add(b), b)))

export function buildSharedInteger(operation: string, inputs: Node[], model = 'GPU'): Node {
  if (!['CPU', 'GPU', 'CYCLES'].includes(model)) throw new Error('Unknown Integer Math evaluation model ' + model)
  const fn = operation === 'LCM' && model === 'CPU' ? cpuLcm
    : operation === 'FLOORED_MODULO' && model !== 'GPU' ? cyclesFlooredModulo : integerOperations[operation]
  if (!fn) throw new Error('Unknown Integer Math operation ' + operation)
  const count = ['ABSOLUTE', 'NEGATE', 'SIGN'].includes(operation) ? 1 : operation === 'MULTIPLY_ADD' ? 3 : 2
  if (inputs.length !== count) throw new Error('Integer Math input count does not match ' + operation)
  return fn(...inputs.map(input => int!(input)))
}

export function buildSharedBoolean(operation: string, a: Node, b?: Node): Node {
  switch (operation) {
    case 'NOT': return a.not()
    case 'AND': return a.and(b)
    case 'OR': return a.or(b)
    case 'XOR': return a.notEqual(b)
    case 'XNOR': return a.equal(b)
    case 'NAND': return a.and(b).not()
    case 'NOR': return a.or(b).not()
    case 'IMPLY': return a.not().or(b)
    case 'NIMPLY': return a.and(b.not())
    default: throw new Error('Unknown Boolean Math operation ' + operation)
  }
}

export function sharedTypedConstant(type: string, value: unknown): Node {
  if (type === 'BOOLEAN' && typeof value === 'boolean') return bool!(value)
  if (type === 'INT' && typeof value === 'number' && Number.isInteger(value) && value >= MIN && value <= 2147483647)
    return int!(value)
  throw new Error('Invalid shared utility ' + type + ' constant')
}

export function sharedTypedConversion(input: Node, from: string, to: string, rgba = false): Node {
  if (from === to) return input
  if (from === 'BOOLEAN') {
    if (to === 'INT') return select!(input, int!(1), int!(0))
    input = select!(input, float!(1), float!(0)); from = 'VALUE'
  } else if (from === 'INT') {
    if (to === 'BOOLEAN') return input.greaterThan(int!(0))
    input = float!(input); from = 'VALUE'
  }
  if (from === 'VALUE') {
    if (to === 'BOOLEAN') return input.greaterThan(float!(0))
    // Native float→integer truncates toward zero in the finite int32 domain.
    if (to === 'INT') return int!(input)
    if (to === 'VALUE') return input
    if (to === 'VECTOR') return vec3!(input)
    if (to === 'RGBA') return rgba ? vec4!(vec3!(input), 1) : vec3!(input)
  }
  throw new Error('Unsupported shared utility conversion ' + from + ' to ' + to)
}

function scalarCompare(operation: string, a: Node, b: Node, epsilon?: Node): Node {
  switch (operation) {
    case 'LESS_THAN': return a.lessThan(b)
    case 'LESS_EQUAL': return a.lessThanEqual(b)
    case 'GREATER_THAN': return a.greaterThan(b)
    case 'GREATER_EQUAL': return a.greaterThanEqual(b)
    case 'EQUAL': return epsilon ? abs!(a.sub(b)).lessThanEqual(epsilon) : a.equal(b)
    case 'NOT_EQUAL': return epsilon ? abs!(a.sub(b)).greaterThan(epsilon) : a.notEqual(b)
    default: throw new Error('Unknown Compare operation ' + operation)
  }
}

export function buildSharedCompare(properties: Record<string, unknown>, inputs: Record<string, Node>, luminance: readonly number[]): Node {
  const type = properties.data_type, operation = String(properties.operation), mode = properties.mode
  const a = inputs.A, b = inputs.B, epsilon = inputs.Epsilon
  if (type === 'FLOAT' || type === 'INT') return scalarCompare(operation, a, b, type === 'INT' ? undefined : epsilon)
  if (type === 'RGBA') {
    if (operation === 'BRIGHTER' || operation === 'DARKER') {
      const weights = vec3!(...luminance)
      return scalarCompare(operation === 'BRIGHTER' ? 'GREATER_THAN' : 'LESS_THAN', dot!(a.rgb, weights), dot!(b.rgb, weights))
    }
    const channels = ['r', 'g', 'b'] // Native color comparisons ignore alpha.
    const results = channels.map(channel => scalarCompare(operation, a[channel], b[channel], epsilon))
    return results.reduce((value, next) => operation === 'NOT_EQUAL' ? value.or(next) : value.and(next))
  }
  if (type === 'VECTOR') {
    if (mode === 'ELEMENT') {
      const results = ['x', 'y', 'z'].map(channel => scalarCompare(operation, a[channel], b[channel], epsilon))
      return results.reduce((value, next) => operation === 'NOT_EQUAL' ? value.or(next) : value.and(next))
    }
    if (mode === 'AVERAGE') return scalarCompare(operation, a.x.add(a.y).add(a.z).div(3), b.x.add(b.y).add(b.z).div(3), epsilon)
    if (mode === 'LENGTH') return scalarCompare(operation, length!(a), length!(b), epsilon)
    if (mode === 'DOT_PRODUCT') return scalarCompare(operation, dot!(a, b), inputs.C, epsilon)
    if (mode === 'DIRECTION') {
      const normalize = (v: Node): Node => v.div(select!(length!(v).equal(0), float!(1), length!(v)))
      const na = normalize(a), nb = normalize(b), opposite = dot!(na, nb).lessThan(0)
      const distance = length!(select!(opposite, na.add(nb), na.sub(nb))).mul(0.5)
      const angle = asin!(clamp!(distance, 0, 1)).mul(2)
      return scalarCompare(operation, select!(opposite, float!(Math.PI).sub(angle), angle), inputs.Angle, epsilon)
    }
  }
  throw new Error('Unsupported Compare type or mode ' + String(type) + '/' + String(mode))
}

export function buildSharedUtilityIr(expression: TslIrExpression,
  build: (expression: TslIrExpression) => TslExpression): TslExpression {
  const child = (key: string): Node => {
    const value = expression[key]
    if (!value || typeof value !== 'object' || typeof (value as TslIrExpression).op !== 'string') throw new Error('Shared utility missing ' + key)
    return build(value as TslIrExpression)
  }
  if (expression.op === 'typed_const') return sharedTypedConstant(String(expression.type), expression.value)
  if (expression.op === 'typed_convert') return sharedTypedConversion(child('input'), String(expression.fromType), String(expression.toType))
  if (expression.op === 'boolean_math') return buildSharedBoolean(String(expression.operation), child('a'), expression.operation === 'NOT' ? undefined : child('b'))
  if (expression.op === 'integer_math') return buildSharedInteger(String(expression.operation),
    ['a', ...(expression.b ? ['b'] : []), ...(expression.c ? ['c'] : [])].map(child), String(expression.model))
  throw new Error('Unknown shared utility IR ' + expression.op)
}
