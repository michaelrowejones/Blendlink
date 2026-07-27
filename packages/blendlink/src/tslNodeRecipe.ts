/** MTLX-TSL-001: build TSL nodes from the Blender-channel IR.
 *
 * The back half of the node compiler. `tsl_ir.py` walks a Blender channel
 * graph and emits this JSON; `buildTslColorNode` turns it into a TSL
 * expression. Every op here is backed by a gated cell in
 * `experiments/tsl-node-differential` — the harness drives THIS module, so
 * a cell proves the exact production mapping, not a lookalike.
 *
 * Blender guards its math against undefined GPU behavior; the wrappers
 * below reproduce Cycles' semantics exactly (proven by the safe-math
 * cells): divide-by-zero yields 0, modulo is C fmod (truncated, sign of
 * the dividend), and pow with a negative base is defined only for integer
 * exponents.
 */
import {
  abs,
  clamp,
  cos,
  float,
  floor,
  mix,
  max,
  min,
  mx_noise_float,
  pow,
  select,
  sign,
  sin,
  step,
  oneMinus,
  uv,
  vec3,
} from 'three/tsl'

/** The published TSL typings are per-node VarNode generics that do not
 * unify across expression kinds; this opaque structural view is the stable
 * surface the IR builder needs. Runtime objects are ordinary TSL nodes. */
export interface TslExpression {
  add(value: TslExprLike): TslExpression
  sub(value: TslExprLike): TslExpression
  mul(value: TslExprLike): TslExpression
  div(value: TslExprLike): TslExpression
  negate(): TslExpression
  equal(value: TslExprLike): TslExpression
  lessThan(value: TslExprLike): TslExpression
  x: TslExpression
  y: TslExpression
  z: TslExpression
}
export type TslExprLike = TslExpression | number

const tslFloat = float as unknown as (value: TslExprLike) => TslExpression
const tslVec3 = vec3 as unknown as (...values: TslExprLike[]) => TslExpression
const tslClamp = clamp as unknown as (
  value: TslExprLike, low: TslExprLike, high: TslExprLike,
) => TslExpression
const tslMix = mix as unknown as (
  a: TslExprLike, b: TslExprLike, factor: TslExprLike,
) => TslExpression
const tslSelect = select as unknown as (
  condition: TslExpression, a: TslExprLike, b: TslExprLike,
) => TslExpression
const tslStep = step as unknown as (
  edge: TslExprLike, value: TslExprLike,
) => TslExpression
const tslFloor = floor as unknown as (value: TslExprLike) => TslExpression
const tslAbs = abs as unknown as (value: TslExprLike) => TslExpression
const tslSign = sign as unknown as (value: TslExprLike) => TslExpression
const tslPow = pow as unknown as (
  base: TslExprLike, exponent: TslExprLike,
) => TslExpression
const tslMin = min as unknown as (
  a: TslExprLike, b: TslExprLike,
) => TslExpression
const tslMax = max as unknown as (
  a: TslExprLike, b: TslExprLike,
) => TslExpression
const tslSin = sin as unknown as (value: TslExprLike) => TslExpression
const tslCos = cos as unknown as (value: TslExprLike) => TslExpression
const tslOneMinus = oneMinus as unknown as (
  value: TslExprLike,
) => TslExpression
const tslUv = uv as unknown as () => TslExpression
const tslNoise = mx_noise_float as unknown as (
  position: TslExprLike,
) => TslExpression

export interface TslIrDocument {
  schemaVersion: 1
  model: 'blendlink-tsl-ir-v1'
  output: TslIrExpression
}

export type TslIrExpression = Record<string, unknown> & { op: string }

export class TslIrError extends Error {}

/** Cycles safe divide: b == 0 -> 0, never inf/NaN. */
export function blenderDivide(
  a: TslExpression, b: TslExpression,
): TslExpression {
  return tslSelect(b.equal(0.0), tslFloat(0.0), a.div(b))
}

/** C fmod (truncated, sign of the dividend) with the b == 0 guard. GLSL's
 * floored mod carries the divisor's sign and disagrees for negative
 * dividends. */
export function blenderModulo(
  a: TslExpression, b: TslExpression,
): TslExpression {
  const quotient = a.div(b)
  const truncated = tslSign(quotient).mul(tslFloor(tslAbs(quotient)))
  return tslSelect(b.equal(0.0), tslFloat(0.0), a.sub(b.mul(truncated)))
}

/** Cycles compatible pow: negative base only for integer exponents, with
 * the sign of an odd exponent; zero base -> exponent == 0 ? 1 : 0. */
export function blenderPower(
  base: TslExpression, exponent: TslExpression,
): TslExpression {
  const isInteger = tslFloor(exponent).equal(exponent)
  const magnitude = tslPow(tslAbs(base), exponent)
  const oddExponent = blenderModulo(exponent, tslFloat(2.0)).equal(1.0)
  const signedMagnitude = tslSelect(
    oddExponent, magnitude.negate(), magnitude,
  )
  const negativeBase = tslSelect(isInteger, signedMagnitude, tslFloat(0.0))
  const zeroBase = tslSelect(
    exponent.equal(0.0), tslFloat(1.0), tslFloat(0.0),
  )
  return tslSelect(
    base.lessThan(0.0), negativeBase,
    tslSelect(base.equal(0.0), zeroBase, tslPow(base, exponent)),
  )
}

/** Blender's fractal noise composition over the shared base Perlin octave.
 *
 * Measured 2026-07-27: the base octave is implementation-identical to
 * three's `mx_noise_float` (1.2e-4), while MaterialX's own fBM diverges
 * (4.6e-2) because Blender normalizes by the amplitude sum. This is
 * Cycles' loop: `i <= floor(detail)` octaves, amplitude ratio = roughness,
 * frequency ratio = lacunarity, fractional detail blends one extra
 * octave, and the normalized sum remaps to the 0..1 Fac. Detail,
 * roughness, and lacunarity are IR constants (the emitter refuses linked
 * inputs), so the loop unrolls in JS.
 */
export function blenderNoiseFac(
  position: TslExpression,
  detail: number,
  roughness: number,
  lacunarity: number,
): TslExpression {
  const clampedDetail = Math.min(Math.max(detail, 0), 15)
  const octaves = Math.floor(clampedDetail)
  const remainder = clampedDetail - octaves
  const amplitudeRatio = Math.min(Math.max(roughness, 0), 1)
  let frequency = 1
  let amplitude = 1
  let maxAmplitude = 0
  let sum = tslFloat(0.0)
  for (let octave = 0; octave <= octaves; octave += 1) {
    sum = sum.add(tslNoise(position.mul(frequency)).mul(amplitude))
    maxAmplitude += amplitude
    amplitude *= amplitudeRatio
    frequency *= lacunarity
  }
  let normalized = sum.div(maxAmplitude)
  if (remainder > 1e-9) {
    const extra = sum
      .add(tslNoise(position.mul(frequency)).mul(amplitude))
      .div(maxAmplitude + amplitude)
    normalized = tslMix(normalized, extra, remainder)
  }
  return normalized.mul(0.5).add(0.5)
}

function fail(message: string): never {
  throw new TslIrError(message)
}

function scalar(expression: TslIrExpression, key: string): number {
  const value = expression[key]
  if (typeof value !== 'number') {
    fail(`IR ${expression.op}.${key} is not a number`)
  }
  return value
}

function numbers(expression: TslIrExpression, key: string): number[] {
  const value = expression[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number')) {
    fail(`IR ${expression.op}.${key} is not a number list`)
  }
  return value as number[]
}

function child(expression: TslIrExpression, key: string): TslIrExpression {
  const value = expression[key]
  if (typeof value !== 'object' || value === null
    || typeof (value as TslIrExpression).op !== 'string') {
    fail(`IR ${expression.op}.${key} is not an expression`)
  }
  return value as TslIrExpression
}

function build(expression: TslIrExpression): TslExpression {
  switch (expression.op) {
    case 'const_float':
      return tslFloat(scalar(expression, 'value'))
    case 'const_vec3': {
      const value = numbers(expression, 'value')
      if (value.length < 3) fail('IR const_vec3 needs three components')
      return tslVec3(value[0]!, value[1]!, value[2]!)
    }
    case 'uv': {
      // Blender's TexCoord.UV is a 3D vector with z = 0; a bare 2D uv()
      // would route vector consumers (noise) into their 2D overloads and
      // diverge. A named uvMap resolves to TEXCOORD selection at the
      // material integration layer; the expression samples uv(0).
      const coordinates = tslUv()
      return tslVec3(coordinates.x, coordinates.y, 0.0)
    }
    case 'separate': {
      const input = build(child(expression, 'input'))
      const channel = expression.channel
      if (channel === 'x') return input.x
      if (channel === 'y') return input.y
      if (channel === 'z') return input.z
      return fail(`IR separate channel ${String(channel)}`)
    }
    case 'combine':
      return tslVec3(
        build(child(expression, 'x')),
        build(child(expression, 'y')),
        build(child(expression, 'z')),
      )
    case 'clamp01':
      return tslClamp(build(child(expression, 'input')), 0.0, 1.0)
    case 'math':
      return buildMath(expression)
    case 'vector_scale':
      return build(child(expression, 'input'))
        .mul(build(child(expression, 'scale')))
    case 'vector_math': {
      const a = build(child(expression, 'a'))
      const b = build(child(expression, 'b'))
      if (expression.operation === 'ADD') return a.add(b)
      return fail(`IR vector_math operation ${String(expression.operation)}`)
    }
    case 'mapping':
      return buildMapping(expression)
    case 'color_ramp':
      return buildColorRamp(expression, 'color')
    case 'ramp_alpha':
      return buildColorRamp(child(expression, 'input'), 'alpha')
    case 'mix_color':
      return buildMixColor(expression)
    case 'noise': {
      const position = build(child(expression, 'input'))
        .mul(build(child(expression, 'scale')))
      return blenderNoiseFac(
        position,
        scalar(expression, 'detail'),
        scalar(expression, 'roughness'),
        typeof expression.lacunarity === 'number'
          ? expression.lacunarity : 2.0,
      )
    }
    default:
      return fail(`IR op ${expression.op} has no proven TSL mapping`)
  }
}

function buildMath(expression: TslIrExpression): TslExpression {
  const operation = String(expression.operation)
  const a = build(child(expression, 'a'))
  const b = () => build(child(expression, 'b'))
  switch (operation) {
    case 'ADD': return a.add(b())
    case 'SUBTRACT': return a.sub(b())
    case 'MULTIPLY': return a.mul(b())
    case 'DIVIDE': return blenderDivide(a, b())
    case 'MULTIPLY_ADD':
      return a.mul(b()).add(build(child(expression, 'c')))
    case 'POWER': return blenderPower(a, b())
    case 'MINIMUM': return tslMin(a, b())
    case 'MAXIMUM': return tslMax(a, b())
    // step treats exact equality as >=; Blender's comparisons are strict.
    // The difference is measure-zero and never lands on cell texels.
    case 'GREATER_THAN': return tslStep(b(), a)
    case 'LESS_THAN': return tslOneMinus(tslStep(b(), a))
    case 'MODULO': return blenderModulo(a, b())
    case 'FLOOR': return tslFloor(a)
    case 'SINE': return tslSin(a)
    case 'COSINE': return tslCos(a)
    default:
      return fail(`IR math operation ${operation} has no proven TSL mapping`)
  }
}

function buildMapping(expression: TslIrExpression): TslExpression {
  const input = build(child(expression, 'input'))
  const location = numbers(expression, 'location')
  const rotation = numbers(expression, 'rotation')
  const scale = numbers(expression, 'scale')
  if (Math.abs(rotation[0]!) > 1e-9 || Math.abs(rotation[1]!) > 1e-9) {
    fail('IR mapping supports Z rotation only (the proven cell)')
  }
  const cosine = Math.cos(rotation[2]!)
  const sine = Math.sin(rotation[2]!)
  if (expression.vectorType === 'POINT') {
    // Proven order: scale, then rotate, then translate.
    const scaled = tslVec3(
      input.x.mul(scale[0]!), input.y.mul(scale[1]!), input.z.mul(scale[2]!),
    )
    return tslVec3(
      scaled.x.mul(cosine).sub(scaled.y.mul(sine)).add(location[0]!),
      scaled.x.mul(sine).add(scaled.y.mul(cosine)).add(location[1]!),
      scaled.z.add(location[2]!),
    )
  }
  if (expression.vectorType === 'TEXTURE') {
    // Proven inverse: subtract, inverse-rotate, then divide by scale.
    const moved = tslVec3(
      input.x.sub(location[0]!), input.y.sub(location[1]!),
      input.z.sub(location[2]!),
    )
    const rotated = tslVec3(
      moved.x.mul(cosine).add(moved.y.mul(sine)),
      moved.x.mul(-sine).add(moved.y.mul(cosine)),
      moved.z,
    )
    return tslVec3(
      rotated.x.div(scale[0]!), rotated.y.div(scale[1]!),
      rotated.z.div(scale[2]!),
    )
  }
  return fail(`IR mapping type ${String(expression.vectorType)}`)
}

interface RampStop { position: number; color: number[] }

function buildColorRamp(
  expression: TslIrExpression, output: 'color' | 'alpha',
): TslExpression {
  const stops = expression.stops as RampStop[]
  if (!Array.isArray(stops) || stops.length === 0) {
    fail('IR color_ramp needs stops')
  }
  const factor = tslClamp(build(child(expression, 'input')), 0.0, 1.0)
  const value = (stop: RampStop) => output === 'color'
    ? tslVec3(stop.color[0]!, stop.color[1]!, stop.color[2]!)
    : tslFloat(stop.color[3]!)
  let accumulated = value(stops[0]!)
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1]!
    const current = stops[index]!
    if (expression.interpolation === 'CONSTANT') {
      accumulated = tslSelect(
        factor.lessThan(current.position), accumulated, value(current),
      )
      continue
    }
    const span = current.position - previous.position
    const blend = span <= 1e-9
      ? tslStep(current.position, factor)
      : tslClamp(factor.sub(previous.position).div(span), 0.0, 1.0)
    accumulated = tslMix(accumulated, value(current), blend)
  }
  return accumulated
}

function buildMixColor(expression: TslIrExpression): TslExpression {
  let factor = build(child(expression, 'factor'))
  if (expression.clampFactor !== false) {
    factor = tslClamp(factor, 0.0, 1.0)
  }
  const a = build(child(expression, 'a'))
  const b = build(child(expression, 'b'))
  let blended: TslExpression
  switch (expression.blendType) {
    case 'MIX': blended = tslMix(a, b, factor); break
    case 'MULTIPLY': blended = tslMix(a, a.mul(b), factor); break
    case 'ADD': blended = tslMix(a, a.add(b), factor); break
    default:
      return fail(`IR mix blend ${String(expression.blendType)}`)
  }
  if (expression.clampResult === true) {
    blended = tslClamp(blended, 0.0, 1.0)
  }
  return blended
}

/** Build one channel's TSL color expression from its IR document. */
export function buildTslColorNode(document: TslIrDocument): TslExpression {
  if (document?.schemaVersion !== 1
    || document.model !== 'blendlink-tsl-ir-v1') {
    throw new TslIrError(
      `unsupported TSL IR document: ${JSON.stringify({
        schemaVersion: document?.schemaVersion,
        model: document?.model,
      })}`,
    )
  }
  const built = build(document.output)
  // A scalar channel broadcasts to RGB, matching Blender's implicit
  // float -> color conversion.
  return tslVec3(built)
}
