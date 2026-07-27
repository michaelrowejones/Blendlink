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
  attribute,
  cameraPosition,
  clamp,
  cos,
  float,
  floor,
  fract,
  mix,
  max,
  min,
  mx_noise_float,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  select,
  sign,
  sin,
  sqrt,
  step,
  oneMinus,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
} from 'three'
// Optional/renamed exports resolve at runtime; missing ones get fallbacks
// built from proven primitives instead of hard import errors.
import * as TSLX from 'three/tsl'

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
const tslFract = fract as unknown as (value: TslExprLike) => TslExpression
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
const tslVec2 = vec2 as unknown as (...values: TslExprLike[]) => TslExpression
const tslAttribute = attribute as unknown as (name: string) => TslExpression
const tslTexture = texture as unknown as (
  map: DataTexture, coordinates: TslExpression,
) => TslExpression
const tslSqrt = sqrt as unknown as (value: TslExprLike) => TslExpression
type UnaryTsl = (value: TslExprLike) => TslExpression
type BinaryTsl = (a: TslExprLike, b: TslExprLike) => TslExpression
const optionalTsl = (name: string): UnaryTsl | undefined => (
  (TSLX as Record<string, unknown>)[name] as UnaryTsl | undefined
)
const optionalBinaryTsl = (name: string): BinaryTsl | undefined => (
  (TSLX as Record<string, unknown>)[name] as BinaryTsl | undefined
)
const tslExp = optionalTsl('exp')!
const tslLog = optionalTsl('log')!
const tslCeil = optionalTsl('ceil')!
const tslAsin = optionalTsl('asin')!
const tslAcos = optionalTsl('acos')!
const tslAtan = optionalTsl('atan')!
const tslInverseSqrtMaybe = optionalTsl('inverseSqrt')
const tslTruncMaybe = optionalTsl('trunc')
const tslTanMaybe = optionalTsl('tan')
const tslAtan2Maybe = optionalBinaryTsl('atan2')

function tslTrunc(value: TslExpression): TslExpression {
  if (tslTruncMaybe) return tslTruncMaybe(value)
  return tslSign(value).mul(tslFloor(tslAbs(value)))
}

/** Blender roundf: half away from zero — WGSL's round is half-to-even. */
function blenderRound(value: TslExpression): TslExpression {
  return tslSign(value).mul(tslFloor(tslAbs(value).add(0.5)))
}

function tslTan(value: TslExpression): TslExpression {
  if (tslTanMaybe) return tslTanMaybe(value)
  return blenderDivide(tslSin(value), tslCos(value))
}

function tslAtan2(y: TslExpression, x: TslExpression): TslExpression {
  if (tslAtan2Maybe) return tslAtan2Maybe(y, x)
  // three r16x folded atan2 into a two-argument atan overload.
  return (tslAtan as unknown as BinaryTsl)(y, x)
}

function tslSinh(value: TslExpression): TslExpression {
  const maybe = optionalTsl('sinh')
  if (maybe) return maybe(value)
  return tslExp(value).sub(tslExp(value.negate())).mul(0.5)
}

function tslCosh(value: TslExpression): TslExpression {
  const maybe = optionalTsl('cosh')
  if (maybe) return maybe(value)
  return tslExp(value).add(tslExp(value.negate())).mul(0.5)
}

function tslTanh(value: TslExpression): TslExpression {
  const maybe = optionalTsl('tanh')
  if (maybe) return maybe(value)
  const e2 = tslExp(value.mul(2.0))
  return blenderDivide(e2.sub(1.0), e2.add(1.0))
}
const tslNormalize = normalize as unknown as (
  value: TslExpression,
) => TslExpression
const tslCameraPosition = cameraPosition as unknown as TslExpression
const tslPositionWorld = positionWorld as unknown as TslExpression
const tslNormalWorld = normalWorld as unknown as TslExpression

export interface BuildTslOptions {
  /** Harness override: an analytic view cosine (dot(N, V)) computed from
   * a known camera contract, replacing the runtime camera builtins so the
   * dielectric formulas gate independently of screen-space rendering. */
  viewCos?: TslExpression
}

let activeOptions: BuildTslOptions = {}

/** Cycles fresnel_dielectric_cos for the front face: c = |cos|,
 * g2 = eta^2 - 1 + c^2; total internal reflection (g2 < 0) returns 1. */
export function blenderFresnelDielectric(
  cosine: TslExpression, eta: TslExpression,
): TslExpression {
  const c = tslAbs(cosine)
  const gSquared = eta.mul(eta).sub(1.0).add(c.mul(c))
  const g = tslSqrt(tslMax(gSquared, 1e-12))
  const first = blenderDivide(g.sub(c), g.add(c))
  const second = blenderDivide(
    c.mul(g.add(c)).sub(1.0), c.mul(g.sub(c)).add(1.0),
  )
  const reflectance = tslFloat(0.5).mul(first).mul(first)
    .mul(tslFloat(1.0).add(second.mul(second)))
  return tslSelect(gSquared.lessThan(0.0), tslFloat(1.0), reflectance)
}

export interface TslIrDocument {
  schemaVersion: 1
  model: 'blendlink-tsl-ir-v1'
  output: TslIrExpression
}

export type TslIrExpression = Record<string, unknown> & { op: string }

export class TslIrError extends Error {}

/** A divisor that can never be a constant zero: WGSL const-evaluates
 * literal divisions and rejects the whole shader on a division by zero,
 * so the guard must sit on the divisor itself, not around the result. */
function guardedDivisor(b: TslExpression): TslExpression {
  return tslSelect(b.equal(0.0), tslFloat(1.0), b)
}

/** Cycles safe divide: b == 0 -> 0, never inf/NaN. */
export function blenderDivide(
  a: TslExpression, b: TslExpression,
): TslExpression {
  return tslSelect(b.equal(0.0), tslFloat(0.0), a.div(guardedDivisor(b)))
}

/** C fmod (truncated, sign of the dividend) with the b == 0 guard. GLSL's
 * floored mod carries the divisor's sign and disagrees for negative
 * dividends. */
export function blenderModulo(
  a: TslExpression, b: TslExpression,
): TslExpression {
  const quotient = a.div(guardedDivisor(b))
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
    case 'map_range': {
      // Cycles map range with safe divide; SMOOTHSTEP applies the cubic
      // ease to the clamped factor; the clamp option clamps the result to
      // the ordered target range.
      const value = build(child(expression, 'value'))
      const fromMin = build(child(expression, 'fromMin'))
      const fromMax = build(child(expression, 'fromMax'))
      const toMin = build(child(expression, 'toMin'))
      const toMax = build(child(expression, 'toMax'))
      let factor = blenderDivide(
        value.sub(fromMin), fromMax.sub(fromMin),
      )
      if (expression.interpolation === 'SMOOTHSTEP') {
        const clamped = tslClamp(factor, 0.0, 1.0)
        factor = clamped.mul(clamped)
          .mul(tslFloat(3.0).sub(clamped.mul(2.0)))
      }
      const result = toMin.add(factor.mul(toMax.sub(toMin)))
      if (expression.clamp === false) return result
      return tslClamp(
        result, tslMin(toMin, toMax), tslMax(toMin, toMax),
      )
    }
    case 'clamp_minmax':
      // Blender's Clamp node in Min Max mode: min(max(value, min), max).
      return tslMin(
        tslMax(
          build(child(expression, 'value')),
          build(child(expression, 'min')),
        ),
        build(child(expression, 'max')),
      )
    case 'ramp_lut': {
      // A sampled colorband (B_SPLINE / CARDINAL / EASE): Blender's own
      // evaluate() filled the LUT, and the shader interpolates between
      // exact texels manually — nearest sampling avoids depending on the
      // optional float32-filterable WebGPU feature.
      const samples = scalar(expression, 'samples')
      const values = numbers(expression, 'values')
      if (values.length !== samples * 4) {
        fail('IR ramp_lut values do not match its sample count')
      }
      const data = new Float32Array(values)
      const lut = new DataTexture(data, samples, 1, RGBAFormat, FloatType)
      lut.minFilter = NearestFilter
      lut.magFilter = NearestFilter
      lut.wrapS = ClampToEdgeWrapping
      lut.wrapT = ClampToEdgeWrapping
      lut.generateMipmaps = false
      lut.needsUpdate = true
      const factor = tslClamp(build(child(expression, 'input')), 0.0, 1.0)
      const scaled = factor.mul(samples - 1)
      const index = tslFloor(scaled)
      const blend = scaled.sub(index)
      const coordinate = (offset: number) => tslVec2(
        index.add(offset + 0.5).div(samples), 0.5,
      )
      const low = tslTexture(lut, coordinate(0))
      const high = tslTexture(lut, coordinate(1))
      const mixed = tslMix(low, high, blend)
      if (expression.channel === 'alpha') {
        return (mixed as unknown as { w: TslExpression }).w
      }
      return tslVec3(mixed.x, mixed.y, mixed.z)
    }
    case 'vertex_color':
      // The glTF path ships the active color attribute as COLOR_0, which
      // three exposes as the 'color' geometry attribute.
      return tslAttribute('color')
    case 'view_cos': {
      // dot(N, V): the harness supplies an analytic override from its
      // known camera contract; production uses the runtime builtins.
      if (activeOptions.viewCos) return activeOptions.viewCos
      const view = tslNormalize(
        tslCameraPosition.sub(tslPositionWorld),
      ) as unknown as { dot(v: TslExpression): TslExpression }
      return (tslNormalWorld as unknown as {
        dot(v: TslExpression): TslExpression
      }).dot(view as unknown as TslExpression)
    }
    case 'fresnel': {
      // Cycles Fresnel node, front face: eta = max(ior, 1e-5).
      const eta = tslMax(build(child(expression, 'ior')), 1e-5)
      return blenderFresnelDielectric(build(child(expression, 'cos')), eta)
    }
    case 'layer_weight': {
      const cosine = build(child(expression, 'cos'))
      const blend = build(child(expression, 'blend'))
      if (expression.output === 'fresnel') {
        // eta = 1 / max(1 - blend, 1e-5) on the front face.
        const eta = blenderDivide(
          tslFloat(1.0), tslMax(tslOneMinus(blend), 1e-5),
        )
        return blenderFresnelDielectric(cosine, eta)
      }
      // Facing: f = |cos|; blend != 0.5 warps the exponent
      // (blend < 0.5 ? 2 blend : 0.5 / (1 - blend)); output 1 - f^e.
      const facing = tslAbs(cosine)
      const clamped = tslClamp(blend, 0.0, 1.0 - 1e-5)
      const exponent = tslSelect(
        clamped.lessThan(0.5),
        clamped.mul(2.0),
        blenderDivide(tslFloat(0.5), tslOneMinus(clamped)),
      )
      return tslOneMinus(tslPow(facing, exponent))
    }
    case 'noise': {
      let position = build(child(expression, 'input'))
        .mul(build(child(expression, 'scale')))
      if (expression.dimensions === 2) {
        // Blender's 2D noise is a genuinely different Perlin dimension,
        // matched by mx_noise_float's vec2 overload (the noise-2d cell).
        position = tslVec2(position.x, position.y)
      }
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
    case 'FLOORED_MODULO': {
      // Cycles: b != 0 ? a - floor(a / b) * b : 0 (GLSL-style mod).
      const divisor = b()
      return tslSelect(
        divisor.equal(0.0), tslFloat(0.0),
        a.sub(tslFloor(a.div(guardedDivisor(divisor))).mul(divisor)),
      )
    }
    case 'FLOOR': return tslFloor(a)
    case 'SINE': return tslSin(a)
    case 'COSINE': return tslCos(a)
    case 'PINGPONG': {
      // Cycles: b != 0 ? |fract((a - b) / (2b)) * 2b - b| : 0.
      const divisor = b()
      const cycle = guardedDivisor(divisor.mul(2.0))
      const bounced = tslAbs(
        tslFract(a.sub(divisor).div(cycle)).mul(divisor.mul(2.0)).sub(divisor),
      )
      return tslSelect(divisor.equal(0.0), tslFloat(0.0), bounced)
    }
    // --- the full-enum sweep, each op with Cycles' safe semantics ---
    case 'SQRT':
      return tslSelect(
        a.lessThan(0.0), tslFloat(0.0), tslSqrt(tslMax(a, 0.0)),
      )
    case 'INVERSE_SQRT': {
      const inverse = tslInverseSqrtMaybe
        ? tslInverseSqrtMaybe(tslMax(a, 1e-38))
        : blenderDivide(tslFloat(1.0), tslSqrt(tslMax(a, 1e-38)))
      return tslSelect(a.lessThan(1e-38), tslFloat(0.0), inverse)
    }
    case 'ABSOLUTE': return tslAbs(a)
    case 'EXPONENT': return tslExp(a)
    case 'LOGARITHM': {
      // safe_log: a > 0 and base > 0, log(a)/log(base), else 0 (a base of
      // one divides by zero and also yields 0 through the safe divide).
      const base = b()
      const value = blenderDivide(
        tslLog(tslMax(a, 1e-38)), tslLog(tslMax(base, 1e-38)),
      )
      return tslSelect(
        a.lessThan(1e-38), tslFloat(0.0),
        tslSelect(base.lessThan(1e-38), tslFloat(0.0), value),
      )
    }
    case 'CEIL': return tslCeil(a)
    case 'FRACT': return tslFract(a)
    case 'TRUNC': return tslTrunc(a)
    case 'ROUND': return blenderRound(a)
    case 'SNAP': {
      const divisor = b()
      return tslSelect(
        divisor.equal(0.0), tslFloat(0.0),
        tslFloor(a.div(guardedDivisor(divisor))).mul(divisor),
      )
    }
    case 'WRAP': {
      // wrapf(value, max, min): range = max - min;
      // range != 0 ? value - range * floor((value - min) / range) : min.
      const maxValue = b()
      const minValue = build(child(expression, 'c'))
      const range = maxValue.sub(minValue)
      const wrapped = a.sub(
        range.mul(tslFloor(a.sub(minValue).div(guardedDivisor(range)))),
      )
      return tslSelect(range.equal(0.0), minValue, wrapped)
    }
    case 'COMPARE':
      // Cycles: |a - b| <= max(epsilon, 1e-5) ? 1 : 0 — step(edge, x) is
      // x >= edge, exactly the inclusive comparison with args swapped.
      return tslStep(
        tslAbs(a.sub(b())),
        tslMax(build(child(expression, 'c')), 1e-5),
      )
    case 'SMOOTH_MIN':
    case 'SMOOTH_MAX': {
      // smoothminf(a, b, k): k != 0 ->
      //   h = max(k - |a - b|, 0) / k; min(a, b) - h^3 k / 6.
      const sign = operation === 'SMOOTH_MAX' ? -1 : 1
      const first = a.mul(sign)
      const second = b().mul(sign)
      const smoothing = build(child(expression, 'c'))
      const h = tslMax(smoothing.sub(tslAbs(first.sub(second))), 0.0)
        .div(guardedDivisor(smoothing))
      const smoothed = tslMin(first, second)
        .sub(h.mul(h).mul(h).mul(smoothing).mul(1.0 / 6.0))
      return tslSelect(
        smoothing.equal(0.0), tslMin(first, second), smoothed,
      ).mul(sign)
    }
    case 'SIGN': return tslSign(a)
    case 'TANGENT': return tslTan(a)
    case 'ARCSINE': return tslAsin(tslClamp(a, -1.0, 1.0))
    case 'ARCCOSINE': return tslAcos(tslClamp(a, -1.0, 1.0))
    case 'ARCTANGENT': return tslAtan(a)
    case 'ARCTAN2': return tslAtan2(a, b())
    case 'SINH': return tslSinh(a)
    case 'COSH': return tslCosh(a)
    case 'TANH': return tslTanh(a)
    case 'RADIANS': return a.mul(Math.PI / 180)
    case 'DEGREES': return a.mul(180 / Math.PI)
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
    case 'DIVIDE': {
      // Cycles per channel: b != 0 ? mix(a, a/b, f) : a — the zero-divisor
      // channel keeps A untouched (verified by the mix-divide cell). The
      // divisor goes through the const-safe guard: WGSL rejects a shader
      // whose constant lane divides by literal zero.
      const channel = (
        aChannel: TslExpression, bChannel: TslExpression,
      ): TslExpression => tslSelect(
        bChannel.equal(0.0), aChannel,
        tslMix(aChannel, aChannel.div(guardedDivisor(bChannel)), factor),
      )
      blended = tslVec3(
        channel(a.x, b.x), channel(a.y, b.y), channel(a.z, b.z),
      )
      break
    }
    case 'OVERLAY': {
      // Cycles folds the factor into the overlay formula per channel:
      // a < 0.5 ? a * (1 - f + 2 f b) : 1 - (1 - f + 2 f (1 - b)) (1 - a).
      // Built with scalar selects per channel — measured 2026-07-27: a
      // vector-condition select collapses to one lane here, sending every
      // channel down the first component's branch.
      const inverseFactor = tslOneMinus(factor)
      const channel = (
        aChannel: TslExpression, bChannel: TslExpression,
      ): TslExpression => {
        const dark = aChannel.mul(
          inverseFactor.add(factor.mul(2.0).mul(bChannel)),
        )
        const light = tslOneMinus(
          inverseFactor.add(factor.mul(2.0).mul(tslOneMinus(bChannel)))
            .mul(tslOneMinus(aChannel)),
        )
        return tslSelect(aChannel.lessThan(0.5), dark, light)
      }
      blended = tslVec3(
        channel(a.x, b.x), channel(a.y, b.y), channel(a.z, b.z),
      )
      break
    }
    default:
      return fail(`IR mix blend ${String(expression.blendType)}`)
  }
  if (expression.clampResult === true) {
    blended = tslClamp(blended, 0.0, 1.0)
  }
  return blended
}

/** Build one channel's TSL color expression from its IR document. */
export function buildTslColorNode(
  document: TslIrDocument, options: BuildTslOptions = {},
): TslExpression {
  if (document?.schemaVersion !== 1
    || document.model !== 'blendlink-tsl-ir-v1') {
    throw new TslIrError(
      `unsupported TSL IR document: ${JSON.stringify({
        schemaVersion: document?.schemaVersion,
        model: document?.model,
      })}`,
    )
  }
  activeOptions = options
  try {
    const built = build(document.output)
    // A scalar channel broadcasts to RGB, matching Blender's implicit
    // float -> color conversion.
    return tslVec3(built)
  } finally {
    activeOptions = {}
  }
}
