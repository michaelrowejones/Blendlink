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
  cross,
  dot,
  float,
  floor,
  fract,
  length,
  mix,
  max,
  min,
  mx_noise_float,
  normalize,
  normalWorld,
  positionGeometry,
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
  vec4,
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
  lessThanEqual(value: TslExprLike): TslExpression
  bitXor(value: TslExprLike): TslExpression
  bitOr(value: TslExprLike): TslExpression
  bitAnd(value: TslExprLike): TslExpression
  greaterThan(value: TslExprLike): TslExpression
  and(value: TslExprLike): TslExpression
  toVar(name?: string): TslExpression
  shiftLeft(value: TslExprLike): TslExpression
  shiftRight(value: TslExprLike): TslExpression
  x: TslExpression
  y: TslExpression
  z: TslExpression
  w: TslExpression
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
const tslUv = uv as unknown as (index?: number) => TslExpression
const tslNoise = mx_noise_float as unknown as (
  position: TslExprLike,
) => TslExpression
const tslVec2 = vec2 as unknown as (...values: TslExprLike[]) => TslExpression
const tslVec4 = vec4 as unknown as (...values: TslExprLike[]) => TslExpression
type TslFnLayout = {
  name: string
  type: string
  inputs: Array<{ name: string; type: string }>
}
const tslFn = (TSLX as Record<string, unknown>).Fn as (
  callback: (args: TslExpression[]) => TslExpression,
) => ((...args: TslExprLike[]) => TslExpression) & {
  setLayout(layout: TslFnLayout): (...args: TslExprLike[]) => TslExpression
}
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
const tslPositionGeometry = positionGeometry as unknown as TslExpression

/** Object-space position in BLENDER'S Z-up basis. The exporter converts
 * Blender (x, y, z) to glTF (x, z, -y); the inverse swizzle recovers
 * Blender coordinates from GLB-loaded geometry: blender = (x, -z, y). */
function blenderObjectPosition(): TslExpression {
  if (activeOptions.objectSpace?.basis === 'gltf-y-up') {
    return tslVec3(
      tslPositionGeometry.x,
      tslPositionGeometry.z.negate(),
      tslPositionGeometry.y,
    )
  }
  return tslPositionGeometry
}
const tslNormalLocal = (
  (TSLX as Record<string, unknown>).normalLocal as unknown as TslExpression
)
const tslNormalWorld = normalWorld as unknown as TslExpression

export interface BuildTslOptions {
  /** Harness override: an analytic view cosine (dot(N, V)) computed from
   * a known camera contract, replacing the runtime camera builtins so the
   * dielectric formulas gate independently of screen-space rendering. */
  viewCos?: TslExpression
  /** Blender texspace for Generated coordinates: generated =
   * (position - location) / (2 * size) + 0.5 (measured on the tile
   * proxy). The runtime supplies the mesh's texspace_location/size; the
   * harness supplies the tile quad's ((0,0,0), (1,1,1)). */
  generatedTexspace?: {
    location: [number, number, number]
    size: [number, number, number]
  }
  /** Light-contract override for shader_to_rgb_diffuse: the effective
   * diffuse irradiance (light color x strength x cos(theta) / pi under
   * the fixed-sun contract the EEVEE reference renders with). The
   * production runtime wires the scene's lighting here — Phase 4's
   * application seam, like viewCos. */
  diffuseIrradiance?: TslExpression
  /** Geometry basis for object_coords/generated. The default
   * 'blender-z-up' keeps the harness contract (its quads are authored in
   * Blender's basis). 'gltf-y-up' converts GLB-loaded geometry back into
   * Blender space with the exporter-inverse swizzle (x, -z, y) before the
   * coordinate formulas apply. Skinned/instanced meshes are out of this
   * contract until a cell earns them. */
  objectSpace?: { basis: 'blender-z-up' | 'gltf-y-up' }
  /** Resolve a Blender UV map name to its exported TEXCOORD index. Without
   * a resolver, named maps keep the measurement contract (the harness
   * materializes named maps as identity proxies on uv slot 0). */
  uvChannel?: (uvMap: string) => number
  /** Resolve a Blender color-layer name to the exported three attribute
   * name. Without a resolver, COLOR_0's 'color' attribute applies. */
  colorAttribute?: (layer: string) => string
  /** Resolve a texture_ref IR op to a loaded three texture (the runtime
   * steals the decoded texture from the generated material's GLB slot).
   * texture_ref documents refuse to build without this resolver. */
  textures?: (ref: Record<string, unknown>) => unknown
  /** Resolve an attribute_object IR op (a per-object custom property —
   * the shared-material per-object-tint pattern) to a vec3 expression.
   * The runtime supplies a per-object uniform reading exported extras;
   * the harness supplies the fixture constant. Refuses without it. */
  objectAttribute?: (name: string) => TslExpression
  /** Collects every DataTexture the build allocates (ramp/curve LUTs,
   * embedded tex_image pixels) so the applying runtime can dispose them
   * with the material. Create with createTslBuildResources(). */
  resources?: TslBuildResources
}

export interface TslBuildResources {
  readonly textures: unknown[]
  dispose(): void
}

/** One handle per applied material: pass as BuildTslOptions.resources for
 * every channel build of that material, dispose when the material leaves. */
export function createTslBuildResources(): TslBuildResources {
  const textures: Array<{ dispose(): void }> = []
  return {
    textures,
    dispose() {
      for (const entry of textures.splice(0)) entry.dispose()
    },
  }
}

let activeOptions: BuildTslOptions = {}
// Content-addressed LUT cache, reset per build. ellie.hair_mesh carries
// 40 LUT nodes over only 5 distinct tables; without dedup the chain
// requests 40 sampled-texture bindings against WebGPU's default 16 and
// the pipeline never validates.
let lutCache = new Map<string, { lut: DataTexture, samples: number }>()

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
  // The single-octave primitive. Defaults to MaterialX's Perlin, which the
  // 2D/3D cells prove agrees with Blender's; 1D has no MaterialX counterpart
  // at all and runs Blender's own ported perlin1d instead.
  octaveFn: (position: TslExpression) => TslExpression = tslNoise,
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
    sum = sum.add(octaveFn(position.mul(frequency)).mul(amplitude))
    maxAmplitude += amplitude
    amplitude *= amplitudeRatio
    frequency *= lacunarity
  }
  let normalized = sum.div(maxAmplitude)
  if (remainder > 1e-9) {
    const extra = sum
      .add(octaveFn(position.mul(frequency)).mul(amplitude))
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
      // diverge. A named uvMap resolves through the runtime's
      // uvName->TEXCOORD map; without a resolver the measurement contract
      // holds (named maps are materialized as identity proxies on slot 0).
      const uvMap = expression.uvMap
      const channel = typeof uvMap === 'string' && uvMap && activeOptions.uvChannel
        ? activeOptions.uvChannel(uvMap)
        : 0
      // Three binds only TEXCOORD_0..3 (its GLTFLoader ATTRIBUTES table stops
      // at 'uv3'); a higher channel silently becomes vec2(0,0).
      if (!Number.isInteger(channel) || channel < 0 || channel > 3) {
        return fail(
          `BuildTslOptions.uvChannel resolved ${JSON.stringify(uvMap)} to invalid index ${channel}`
          + ' (expected glTF TEXCOORD channel 0, 1, 2, or 3)',
        )
      }
      const coordinates = tslUv(channel)
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
    case 'vector_math':
      return buildVectorMath(expression)
    case 'vector_rotate':
      return buildVectorRotate(expression)
    case 'mapping':
      return buildMapping(expression)
    case 'color_ramp':
      return buildColorRamp(expression, 'color')
    case 'ramp_alpha':
      return buildColorRamp(child(expression, 'input'), 'alpha')
    case 'mix_color': {
      // Guard, atomic with the emitter's implicit COLOR->FLOAT
      // conversion: a vector-typed factor would fan the per-channel
      // blend builders out to vec3 lanes and tslVec3 would TRUNCATE the
      // join to the x-channel -- silently, reproducing the plants.leaf
      // corpus failure. The emitter now wraps colour sources in
      // rgb_to_bw; any IR that still carries a vector factor is a
      // contract violation and must fail loudly.
      const factorOp = (expression.factor as TslIrExpression | undefined)?.op
      const vectorProducers = new Set([
        'const_vec3', 'combine', 'mix_color', 'curve_rgb', 'color_ramp',
        'vertex_color', 'tex_checker', 'hsv_to_rgb', 'object_coords',
        'generated', 'uv', 'mapping', 'attribute_object', 'vector_rotate',
      ])
      if (typeof factorOp === 'string' && vectorProducers.has(factorOp)) {
        fail(
          `IR mix_color factor is vector-typed (${factorOp}); the emitter `
          + 'must wrap colour sources in rgb_to_bw',
        )
      }
      return buildMixColor(expression)
    }
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
      } else if (expression.interpolation === 'SMOOTHERSTEP') {
        // Quintic ease: t^3 (t (6t - 15) + 10).
        const t = tslClamp(factor, 0.0, 1.0)
        factor = t.mul(t).mul(t).mul(
          t.mul(t.mul(6.0).sub(15.0)).add(10.0),
        )
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
      const { lut, samples } = buildLutTexture(expression)
      const factor = tslClamp(build(child(expression, 'input')), 0.0, 1.0)
      const mixed = sampleLut(lut, samples, factor)
      if (expression.channel === 'alpha') {
        return (mixed as unknown as { w: TslExpression }).w
      }
      return tslVec3(mixed.x, mixed.y, mixed.z)
    }
    case 'curve_rgb': {
      // RGB Curves through the same sampled-LUT route Cycles itself uses:
      // the emitter filled the table with channel(composite(x)) via
      // Blender's own evaluator, and each channel samples it at its own
      // value before the factor lerp back toward the input.
      const { lut, samples } = buildLutTexture(expression)
      const input = build(child(expression, 'input'))
      const factor = build(child(expression, 'factor'))
      const curveChannel = (
        value: TslExpression,
        pick: (sample: TslExpression) => TslExpression,
      ): TslExpression => pick(
        sampleLut(lut, samples, tslClamp(value, 0.0, 1.0)),
      )
      const curved = tslVec3(
        curveChannel(input.x, sample => sample.x),
        curveChannel(input.y, sample => sample.y),
        curveChannel(input.z, sample => sample.z),
      )
      return tslMix(input, curved, factor)
    }
    case 'attribute_object': {
      // A per-object custom property. Cycles reads obj["name"]; the
      // resolver supplies the per-object vec3 (runtime: a uniform with
      // onObjectUpdate over exported extras; harness: the fixture value).
      const resolver = activeOptions.objectAttribute
      if (!resolver) {
        return fail('IR attribute_object needs BuildTslOptions.objectAttribute')
      }
      const name = expression.name
      if (typeof name !== 'string' || name.length === 0) {
        return fail('IR attribute_object needs a property name')
      }
      const value = resolver(name)
      if (!value) {
        return fail(
          `BuildTslOptions.objectAttribute resolved nothing for ${JSON.stringify(name)}`,
        )
      }
      if (expression.output === 'fac') {
        // Cycles: Fac of an object attribute is the component average.
        const lanes = value as unknown as {
          x: TslExpression; y: TslExpression; z: TslExpression
        }
        return lanes.x.add(lanes.y).add(lanes.z).mul(1.0 / 3.0)
      }
      return value
    }
    case 'vertex_color': {
      // The glTF path ships the active color attribute as COLOR_0, which
      // three exposes as the 'color' geometry attribute; a named layer
      // resolves through the runtime's attribute map when supplied.
      const layer = expression.layer
      const attributeName = typeof layer === 'string' && layer && activeOptions.colorAttribute
        ? activeOptions.colorAttribute(layer)
        : 'color'
      if (typeof attributeName !== 'string' || attributeName.length === 0) {
        return fail(
          `BuildTslOptions.colorAttribute resolved ${JSON.stringify(layer)} to an empty name`,
        )
      }
      return tslAttribute(attributeName)
    }
    case 'shader_to_rgb_diffuse': {
      // EEVEE's Shader to RGB over a Diffuse BSDF: albedo times the
      // diffuse irradiance. The harness supplies the light-contract
      // value; production wires real lighting (Phase 4).
      if (!activeOptions.diffuseIrradiance) {
        return fail(
          'IR shader_to_rgb_diffuse needs BuildTslOptions.diffuseIrradiance',
        )
      }
      return build(child(expression, 'color'))
        .mul(activeOptions.diffuseIrradiance)
    }
    case 'object_coords':
      // Blender Object texture coordinates = object-space position, in
      // BLENDER'S Z-up basis. blenderObjectPosition() supplies that
      // contract for both authored-Z-up harness geometry and GLB-loaded
      // Y-up geometry (via BuildTslOptions.objectSpace).
      return blenderObjectPosition()
    case 'generated': {
      // Blender Generated coordinates over the mesh texspace (measured:
      // (p - location) / (2 * size) + 0.5; a degenerate axis reads 0.5).
      // The texspace is Blender-space, so the basis conversion applies to
      // the position before the formula.
      const texspace = activeOptions.generatedTexspace
      if (!texspace) {
        return fail(
          'IR generated coordinates need BuildTslOptions.generatedTexspace',
        )
      }
      const safe = texspace.size.map(
        (component) => (component === 0 ? 1 : component),
      )
      return blenderObjectPosition()
        .sub(tslVec3(...texspace.location))
        .div(tslVec3(safe[0] * 2, safe[1] * 2, safe[2] * 2))
        .add(0.5)
    }
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
      const dimensions = scalar(expression, 'dimensions')
      let position = build(child(expression, 'input'))
      if (dimensions === 4) {
        // Blender scales the WHOLE float4(co, w), so w joins before the
        // scale multiply, not after.
        position = tslVec4(position, build(child(expression, 'w')))
      }
      position = position.mul(build(child(expression, 'scale')))
      // dimensions === 1 needs no coordinate surgery: the emitter sends the W
      // socket as a scalar, and perlin1d consumes it directly.
      // The per-dimension single octave: 2D/3D ride MaterialX (proven to
      // agree with Blender by the noise-2d / noise-scale cells); 1D and 4D
      // are Blender's own perlins ported, because three has neither arity.
      const octaveForDimension = dimensions === 1 ? perlin1d
        : dimensions === 4 ? perlin4d
          : tslNoise
      if (dimensions === 2) {
        // Blender's 2D noise is a genuinely different Perlin dimension,
        // matched by mx_noise_float's vec2 overload (the noise-2d cell).
        position = tslVec2(position.x, position.y)
      }
      // Distortion perturbs the scaled coordinate before any octave runs.
      // One SIGNED single octave per component — tslNoise, not the fBM —
      // sampled at the emitter-folded low hash offsets. Verbatim from
      // noisetex.h and gpu_shader_material_tex_noise.glsl, which agree.
      if (typeof expression.distortion === 'number') {
        const offsets = expression.distortionOffsets as number[][]
        // Lane count follows the dimension, and the lane noise is the SAME
        // dimension's snoise — perlin1d/perlin4d where MaterialX has no
        // arity. offset/lane vectors match: 1D shifts by a scalar.
        const shift = (offset: number[]): TslExpression => (
          dimensions === 1 ? position.add(offset[0]!)
            : dimensions === 2 ? position.add(tslVec2(offset[0], offset[1]))
              : dimensions === 4
                ? position.add(tslVec4(offset[0], offset[1], offset[2], offset[3]))
                : position.add(tslVec3(offset[0], offset[1], offset[2]))
        )
        const lanes = offsets.map((offset) => octaveForDimension(shift(offset)))
        position = position.add(
          (dimensions === 1 ? lanes[0]!
            : dimensions === 2 ? tslVec2(lanes[0], lanes[1])
              : dimensions === 4
                ? tslVec4(lanes[0], lanes[1], lanes[2], lanes[3])
                : tslVec3(lanes[0], lanes[1], lanes[2])
          ).mul(expression.distortion),
        )
      }
      const detail = scalar(expression, 'detail')
      const roughness = scalar(expression, 'roughness')
      const lacunarity = typeof expression.lacunarity === 'number'
        ? expression.lacunarity : 2.0
      const fac = blenderNoiseFac(
        position, detail, roughness, lacunarity, octaveForDimension,
      )
      if (expression.output !== 'color') return fac
      // Color lanes are the same fBM at constant hash-derived offsets
      // (the emitter precomputed noisetex.h's random offsets).
      const offsets = expression.colorOffsets as number[][]
      const shifted = (offset: number[]): TslExpression => (
        dimensions === 1 ? position.add(offset[0]!)
          : dimensions === 2 ? position.add(tslVec2(offset[0], offset[1]))
            : dimensions === 4
              ? position.add(tslVec4(offset[0], offset[1], offset[2], offset[3]))
              : position.add(tslVec3(offset[0], offset[1], offset[2]))
      )
      return tslVec3(
        fac,
        blenderNoiseFac(
          shifted(offsets[0]), detail, roughness, lacunarity, octaveForDimension,
        ),
        blenderNoiseFac(
          shifted(offsets[1]), detail, roughness, lacunarity, octaveForDimension,
        ),
      )
    }
    case 'rgb_to_hsv':
      return blenderRgbToHsv(build(child(expression, 'input')))
    case 'hsv_to_rgb':
      return blenderHsvToRgb(build(child(expression, 'input')))
    case 'invert': {
      const input = build(child(expression, 'input'))
      return tslMix(
        input, tslOneMinus(input), build(child(expression, 'factor')),
      )
    }
    case 'gamma': {
      // Cycles: only strictly positive components are raised; zero and
      // negative pass through unchanged.
      const input = build(child(expression, 'input'))
      const gamma = build(child(expression, 'gamma'))
      const channel = (c: TslExpression): TslExpression => tslSelect(
        c.lessThanEqual(0.0), c, tslPow(tslMax(c, 1e-38), gamma),
      )
      return tslVec3(channel(input.x), channel(input.y), channel(input.z))
    }
    case 'bright_contrast': {
      // a = 1 + contrast, b = brightness - contrast/2; max(a*c + b, 0).
      const input = build(child(expression, 'input'))
      const bright = build(child(expression, 'bright'))
      const contrast = build(child(expression, 'contrast'))
      return tslMax(
        input.mul(contrast.add(1.0)).add(bright.sub(contrast.mul(0.5))),
        tslFloat(0.0),
      )
    }
    case 'rgb_to_bw':
      // Rec.709 luminance, the Standard-config working space's Y row.
      return tslDot(
        build(child(expression, 'input')),
        tslVec3(0.2126729, 0.7151522, 0.0721750),
      )
    case 'hue_sat': {
      const input = build(child(expression, 'input'))
      const hsv = blenderRgbToHsv(input)
      const shifted = blenderHsvToRgb(tslVec3(
        tslFract(hsv.x.add(build(child(expression, 'hue'))).add(0.5)),
        tslClamp(
          hsv.y.mul(build(child(expression, 'saturation'))), 0.0, 1.0,
        ),
        hsv.z.mul(build(child(expression, 'value'))),
      ))
      return tslMax(
        tslMix(input, shifted, build(child(expression, 'factor'))),
        tslFloat(0.0),
      )
    }
    case 'tex_checker': {
      // Cycles svm_checker: epsilon-nudged cell parity in all three axes.
      const p = build(child(expression, 'vector'))
        .mul(build(child(expression, 'scale')))
        .add(0.000001).mul(0.999999)
      const parity = (value: TslExpression): TslExpression => {
        const m = tslAbs(tslFloor(value))
        return m.sub(tslFloor(m.mul(0.5)).mul(2.0))
      }
      const xyEqual = tslSelect(
        parity(p.x).equal(parity(p.y)), tslFloat(1.0), tslFloat(0.0),
      )
      const check = xyEqual.equal(parity(p.z))
      if (expression.output === 'fac') {
        return tslSelect(check, tslFloat(1.0), tslFloat(0.0))
      }
      return tslSelect(
        check,
        build(child(expression, 'color1')),
        build(child(expression, 'color2')),
      )
    }
    case 'tex_gradient': {
      const p = build(child(expression, 'vector'))
      const gradientType = String(expression.gradientType)
      let result: TslExpression
      switch (gradientType) {
        case 'LINEAR': result = p.x; break
        case 'QUADRATIC': {
          const r = tslMax(p.x, 0.0)
          result = r.mul(r)
          break
        }
        case 'EASING': {
          // smoothstep of the clamped coordinate: 3r^2 - 2r^3.
          const r = tslClamp(p.x, 0.0, 1.0)
          const t = r.mul(r)
          result = t.mul(3.0).sub(t.mul(r).mul(2.0))
          break
        }
        case 'DIAGONAL': result = p.x.add(p.y).mul(0.5); break
        case 'RADIAL':
          result = tslAtan2(p.y, p.x).div(2 * Math.PI).add(0.5)
          break
        case 'QUADRATIC_SPHERE': {
          const r = tslMax(tslOneMinus(tslLength(p)), 0.0)
          result = r.mul(r)
          break
        }
        case 'SPHERICAL':
          result = tslMax(tslOneMinus(tslLength(p)), 0.0)
          break
        default:
          return fail(`IR gradient type ${gradientType}`)
      }
      // Cycles saturates the gradient before both outputs.
      return tslClamp(result, 0.0, 1.0)
    }
    case 'tex_magic': {
      // Cycles svm_magic: the fixed trig cascade, unrolled to the node's
      // depth; the final shrink by 2*distortion is skipped when the
      // distortion is zero (runtime branch, scalar condition).
      const depth = scalar(expression, 'depth')
      const scaled = build(child(expression, 'vector'))
        .mul(build(child(expression, 'scale')))
      // Cycles wraps each component into [-2pi, 2pi) with C fmod before
      // the cascade to keep large coordinates out of NaN territory.
      const p = tslVec3(
        blenderModulo(scaled.x, tslFloat(2 * Math.PI)),
        blenderModulo(scaled.y, tslFloat(2 * Math.PI)),
        blenderModulo(scaled.z, tslFloat(2 * Math.PI)),
      )
      const distortion = build(child(expression, 'distortion'))
      let x = tslSin(p.x.add(p.y).add(p.z).mul(5.0))
      let y = tslCos(p.x.negate().add(p.y).sub(p.z).mul(5.0))
      let z = tslCos(p.x.negate().sub(p.y).add(p.z).mul(5.0)).negate()
      if (depth > 0) {
        x = x.mul(distortion)
        y = y.mul(distortion)
        z = z.mul(distortion)
        y = tslCos(x.sub(y).add(z)).negate().mul(distortion)
      }
      if (depth > 1) x = tslCos(x.sub(y).sub(z)).mul(distortion)
      if (depth > 2) z = tslSin(x.negate().sub(y).sub(z)).mul(distortion)
      if (depth > 3) {
        x = tslCos(x.negate().add(y).sub(z)).negate().mul(distortion)
      }
      if (depth > 4) {
        y = tslSin(x.negate().add(y).add(z)).negate().mul(distortion)
      }
      if (depth > 5) {
        y = tslCos(x.negate().add(y).add(z)).negate().mul(distortion)
      }
      if (depth > 6) x = tslCos(x.add(y).add(z)).mul(distortion)
      if (depth > 7) z = tslSin(x.add(y).sub(z)).mul(distortion)
      if (depth > 8) {
        x = tslCos(x.negate().sub(y).add(z)).negate().mul(distortion)
      }
      if (depth > 9) y = tslSin(x.sub(y).add(z)).negate().mul(distortion)
      const divisor = distortion.mul(2.0)
      const shrink = (value: TslExpression): TslExpression => tslSelect(
        distortion.equal(0.0), value, value.div(guardedDivisor(divisor)),
      )
      const color = tslVec3(
        tslFloat(0.5).sub(shrink(x)),
        tslFloat(0.5).sub(shrink(y)),
        tslFloat(0.5).sub(shrink(z)),
      )
      if (expression.output === 'fac') {
        return color.x.add(color.y).add(color.z).div(3.0)
      }
      return color
    }
    case 'tex_wave': {
      const p = build(child(expression, 'vector'))
        .mul(build(child(expression, 'scale')))
        .add(0.000001).mul(0.999999)
      const waveType = String(expression.waveType)
      let n: TslExpression
      if (waveType === 'BANDS') {
        const direction = String(expression.bandsDirection)
        if (direction === 'X') n = p.x.mul(20.0)
        else if (direction === 'Y') n = p.y.mul(20.0)
        else if (direction === 'Z') n = p.z.mul(20.0)
        else n = p.x.add(p.y).add(p.z).mul(10.0)
      } else {
        const direction = String(expression.ringsDirection)
        let axis = p
        if (direction === 'X') axis = tslVec3(0.0, p.y, p.z)
        else if (direction === 'Y') axis = tslVec3(p.x, 0.0, p.z)
        else if (direction === 'Z') axis = tslVec3(p.x, p.y, 0.0)
        n = tslLength(axis).mul(20.0)
      }
      n = n.add(build(child(expression, 'phase')))
      const distortion = scalar(expression, 'distortion')
      if (distortion !== 0) {
        // The distortion term is the RAW fractal in [-1, 1]; blenderNoise-
        // Fac returns the Fac remap, so 2f - 1 recovers it exactly.
        const fac = blenderNoiseFac(
          p.mul(build(child(expression, 'detailScale'))),
          scalar(expression, 'detail'),
          scalar(expression, 'detailRoughness'),
          2.0,
        )
        n = n.add(fac.mul(2.0).sub(1.0).mul(distortion))
      }
      const profile = String(expression.profile)
      if (profile === 'SIN') {
        return tslFloat(0.5).add(tslSin(n.sub(Math.PI / 2)).mul(0.5))
      }
      const cycles = n.div(2 * Math.PI)
      if (profile === 'SAW') return cycles.sub(tslFloor(cycles))
      if (profile === 'TRI') {
        return tslAbs(cycles.sub(tslFloor(cycles.add(0.5)))).mul(2.0)
      }
      return fail(`IR wave profile ${profile}`)
    }
    case 'texture_ref': {
      // Large-image transport (Phase 4 Track C): the image ships through
      // the generated material's GLB texture slot and the runtime resolver
      // hands back the decoded three texture. Hardware sampling applies —
      // the named fidelity notes (KTX2 lossiness, filtering vs the
      // byte-exact manual-bilinear oracle at texel edges, byte-space alpha
      // pre-association at publish) live with the exporter cell.
      const resolver = activeOptions.textures
      if (!resolver) {
        return fail('IR texture_ref needs BuildTslOptions.textures')
      }
      const ref = expression.ref
      if (!ref || typeof ref !== 'object') {
        return fail('IR texture_ref needs a ref object')
      }
      const map = resolver(ref as Record<string, unknown>)
      if (!map) {
        return fail(
          `BuildTslOptions.textures resolved no texture for ${JSON.stringify(ref)}`,
        )
      }
      const vector = build(child(expression, 'vector'))
      const sampled: TslExpression = tslTexture(
        map as never, tslVec2(vector.x, vector.y),
      )
      const lanes = sampled as unknown as {
        a: TslExpression
        r: TslExpression
        g: TslExpression
        b: TslExpression
      }
      return expression.output === 'alpha'
        ? lanes.a
        : tslVec3(lanes.r, lanes.g, lanes.b)
    }
    case 'tex_image': {
      // Cycles-style manual sampling over an embedded RGBA float image:
      // nearest-filtered texel reads (no float32-filterable dependency),
      // bilinear taps at u*W - 0.5, and per-tap REPEAT (floored modulo)
      // or EXTEND (clamp) index wrapping. Pixels arrive linearized (the
      // emitter applies exact IEC sRGB decode for byte images). Rows are
      // bottom-up on both sides (Blender pixels and DataTexture agree).
      const width = scalar(expression, 'width')
      const height = scalar(expression, 'height')
      const values = numbers(expression, 'pixels')
      if (values.length !== width * height * 4) {
        fail('IR tex_image pixels do not match its dimensions')
      }
      const data = new Float32Array(values)
      const map = new DataTexture(data, width, height, RGBAFormat, FloatType)
      map.minFilter = NearestFilter
      map.magFilter = NearestFilter
      map.wrapS = ClampToEdgeWrapping
      map.wrapT = ClampToEdgeWrapping
      map.generateMipmaps = false
      map.needsUpdate = true
      activeOptions.resources?.textures.push(map)
      const vector = build(child(expression, 'vector'))
      let coordU = vector.x
      let coordV = vector.y
      if (expression.projection === 'box') {
        // Cycles sharp box mapping (blend 0): the dominant |N| axis in
        // OBJECT space picks the plane, with the measured sign-dependent
        // flips: x-plane (Nx<0 ? 1-y : y, z); y-plane (Ny>0 ? 1-x : x,
        // z); z-plane (Nz>0 ? 1-y : y, x). The flat harness tile gates
        // the +Z branch exactly; the other branches carry the same
        // ported formula (named bound in the cell notes).
        const n = tslNormalLocal
        const ax = tslAbs(n.x)
        const ay = tslAbs(n.y)
        const az = tslAbs(n.z)
        const xDominant = ax.greaterThan(ay).and(ax.greaterThan(az))
        const yDominant = ay.greaterThan(ax).and(ay.greaterThan(az))
        const flip = (
          condition: TslExpression, value: TslExpression,
        ): TslExpression => tslSelect(
          condition, tslOneMinus(value), value,
        )
        const xPlaneU = flip(n.x.lessThan(0.0), vector.y)
        const yPlaneU = flip(n.y.greaterThan(0.0), vector.x)
        const zPlaneU = flip(n.z.greaterThan(0.0), vector.y)
        coordU = tslSelect(
          xDominant, xPlaneU, tslSelect(yDominant, yPlaneU, zPlaneU),
        )
        coordV = tslSelect(
          xDominant, vector.z, tslSelect(yDominant, vector.z, vector.x),
        )
      }
      const extension = String(expression.extension)
      const wrapIndex = (
        index: TslExpression, size: number,
      ): TslExpression => (
        extension === 'REPEAT'
          ? index.sub(tslFloor(index.div(size)).mul(size))
          : tslClamp(index, 0.0, size - 1)
      )
      const texel = (
        ix: TslExpression, iy: TslExpression,
      ): TslExpression => tslTexture(map, tslVec2(
        wrapIndex(ix, width).add(0.5).div(width),
        wrapIndex(iy, height).add(0.5).div(height),
      ))
      let sample: TslExpression
      if (expression.interpolation === 'Closest') {
        sample = texel(
          tslFloor(coordU.mul(width)),
          tslFloor(coordV.mul(height)),
        )
      } else if (expression.interpolation === 'Cubic') {
        // Cubic B-spline over a 4x4 neighbourhood, taps at ix-1..ix+2.
        // Weights transcribed from SET_CUBIC_SPLINE_WEIGHTS in
        // intern/cycles/kernel/device/cpu/image.h, in Horner form as Blender
        // writes them; three's own TextureBicubic w0..w3 are the same basis,
        // but its 4-tap trick leans on the hardware sampler's bilinear filter
        // and mip chain, so it cannot be reused here — every other branch in
        // this function fetches texels explicitly to keep Blender's wrap and
        // texel-centre semantics exact, and cubic has to match that.
        const x = coordU.mul(width).sub(0.5)
        const y = coordV.mul(height).sub(0.5)
        const ix = tslFloor(x)
        const iy = tslFloor(y)
        const splineWeights = (t: TslExpression): TslExpression[] => [
          t.mul(-1.0 / 6.0).add(0.5).mul(t).sub(0.5).mul(t).add(1.0 / 6.0),
          t.mul(0.5).sub(1.0).mul(t).mul(t).add(2.0 / 3.0),
          t.mul(-0.5).add(0.5).mul(t).add(0.5).mul(t).add(1.0 / 6.0),
          t.mul(t).mul(t).mul(1.0 / 6.0),
        ]
        const wx = splineWeights(x.sub(ix))
        const wy = splineWeights(y.sub(iy))
        let accumulated: TslExpression | undefined
        for (let row = 0; row < 4; row += 1) {
          for (let column = 0; column < 4; column += 1) {
            const tap = texel(
              ix.add(column - 1), iy.add(row - 1),
            ).mul(wx[column]!.mul(wy[row]!))
            accumulated = accumulated ? accumulated.add(tap) : tap
          }
        }
        sample = accumulated!
      } else {
        const x = coordU.mul(width).sub(0.5)
        const y = coordV.mul(height).sub(0.5)
        const ix = tslFloor(x)
        const iy = tslFloor(y)
        const fx = x.sub(ix)
        const fy = y.sub(iy)
        const bottom = tslMix(
          texel(ix, iy), texel(ix.add(1.0), iy), fx,
        )
        const top = tslMix(
          texel(ix, iy.add(1.0)), texel(ix.add(1.0), iy.add(1.0)), fx,
        )
        sample = tslMix(bottom, top, fy)
      }
      if (expression.output === 'alpha') {
        return (sample as unknown as { w: TslExpression }).w
      }
      // sRGB images arrive alpha-associated from the emitter (Cycles
      // associates at load and never divides back — measured); nothing
      // to do here beyond sampling.
      return tslVec3(sample.x, sample.y, sample.z)
    }
    case 'tex_white_noise': {
      const p = build(child(expression, 'vector'))
      const dimensions = scalar(expression, 'dimensions')
      if (dimensions === 1) {
        // 1D hashes the W scalar's raw bits; Color re-hashes with the
        // vec2 hash at literal lanes 1 and 2 (hash_float_to_vec3).
        return expression.output === 'color'
          ? hashFloat1ToFloat3(p)
          : hashFloat1ToFloat(p)
      }
      if (dimensions === 4) {
        const w = build(child(expression, 'w'))
        return expression.output === 'color'
          ? hashFloat4ToFloat3(p.x, p.y, p.z, w)
          : hashFloat4ToFloat(p.x, p.y, p.z, w)
      }
      if (expression.output === 'color') {
        return dimensions === 2
          ? hashFloat2ToFloat3(p.x, p.y)
          : hashFloat3ToFloat3(p.x, p.y, p.z)
      }
      return dimensions === 2
        ? hashFloat2ToFloat(p.x, p.y)
        : hashFloat3ToFloat(p.x, p.y, p.z)
    }
    case 'tex_voronoi': {
      // Blender 4.x+ voronoi_f1, Euclidean, single layer: jittered points
      // in the 9 (2D) or 27 (3D) neighbor cells, jitter from the SIGNED
      // integer PCG (hash_pcg3d_i / hash_pcg2d_i — measured: NOT White
      // Noise's Jenkins), argmin tracked with scalar selects so the Color
      // hash can rerun on the winning cell.
      const dimensions = scalar(expression, 'dimensions')
      const coord = build(child(expression, 'vector'))
        .mul(build(child(expression, 'scale')))
      const randomness = tslClamp(
        build(child(expression, 'randomness')), 0.0, 1.0,
      )
      const cell = tslFloor(coord)
      const local = coord.sub(cell)
      const cellIntX = tslIntOf(cell.x)
      const cellIntY = tslIntOf(cell.y)
      const cellIntZ = tslIntOf(cell.z)
      if (expression.feature === 'smooth_f1') {
        // Cycles voronoi_smooth_f1: a running h-chain over the 5^d
        // neighborhood — h is 1 on the first cell, then the smoothstep
        // of the distance gap; each accumulator lerps by h and subtracts
        // the polynomial correction. Smoothness is a nonzero emit-time
        // constant (zero falls back to F1 in the emitter, like Cycles).
        const smoothness = scalar(expression, 'smoothness')
        const smoothstep01 = (value: TslExpression): TslExpression => {
          const t = tslClamp(value, 0.0, 1.0)
          return t.mul(t).mul(tslFloat(3.0).sub(t.mul(2.0)))
        }
        let smoothDistance = tslFloat(0.0)
        let smoothR = tslFloat(0.0)
        let smoothG = tslFloat(0.0)
        let smoothB = tslFloat(0.0)
        let first = true
        const range = [-2, -1, 0, 1, 2]
        const zRange = dimensions === 2 ? [0] : range
        for (const k of zRange) {
          for (const j of range) {
            for (const i of range) {
              const neighborX = cellIntX.add(tslIntOf(i))
              const neighborY = cellIntY.add(tslIntOf(j))
              const neighborZ = cellIntZ.add(tslIntOf(k))
              let jitterR: TslExpression
              let jitterG: TslExpression
              let jitterB: TslExpression
              let dx: TslExpression
              let dy: TslExpression
              let dz = tslFloat(0.0)
              if (dimensions === 2) {
                const [jitterX, jitterY] = hashInt2ToFloat2(
                  neighborX, neighborY,
                )
                // 2D color still routes through the 3D hash with z = 0.
                const [r, g, b] = hashInt3ToFloat3(
                  neighborX, neighborY, tslIntOf(0),
                )
                jitterR = r; jitterG = g; jitterB = b
                dx = jitterX.mul(randomness).add(i).sub(local.x)
                dy = jitterY.mul(randomness).add(j).sub(local.y)
              } else {
                const [r, g, b] = hashInt3ToFloat3(
                  neighborX, neighborY, neighborZ,
                )
                jitterR = r; jitterG = g; jitterB = b
                dx = jitterR.mul(randomness).add(i).sub(local.x)
                dy = jitterG.mul(randomness).add(j).sub(local.y)
                dz = jitterB.mul(randomness).add(k).sub(local.z)
              }
              const distance = tslSqrt(
                dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz)),
              )
              const h = first
                ? tslFloat(1.0)
                : smoothstep01(
                  tslFloat(0.5).add(
                    smoothDistance.sub(distance).mul(0.5 / smoothness),
                  ),
                ).toVar()
              first = false
              const correction = h.mul(tslOneMinus(h)).mul(smoothness)
              // toVar flattens the accumulator chains into sequential
              // statements — a 125-deep nested mix(...) tree measured
              // "maximum parser recursive depth reached" in Tint.
              smoothDistance = tslMix(smoothDistance, distance, h)
                .sub(correction).toVar()
              const colorCorrection = correction.div(1.0 + 3.0 * smoothness)
              smoothR = tslMix(smoothR, jitterR, h)
                .sub(colorCorrection).toVar()
              smoothG = tslMix(smoothG, jitterG, h)
                .sub(colorCorrection).toVar()
              smoothB = tslMix(smoothB, jitterB, h)
                .sub(colorCorrection).toVar()
            }
          }
        }
        if (expression.output === 'color') {
          return tslVec3(smoothR, smoothG, smoothB)
        }
        return smoothDistance
      }
      let minDistance = tslFloat(1e10)
      let winXExpr = tslIntOf(0)
      let winYExpr = tslIntOf(0)
      let winZExpr = tslIntOf(0)
      const zOffsets = dimensions === 2 ? [0] : [-1, 0, 1]
      for (const k of zOffsets) {
        for (const j of [-1, 0, 1]) {
          for (const i of [-1, 0, 1]) {
            const neighborX = cellIntX.add(tslIntOf(i))
            const neighborY = cellIntY.add(tslIntOf(j))
            const neighborZ = cellIntZ.add(tslIntOf(k))
            let dx: TslExpression
            let dy: TslExpression
            let dz = tslFloat(0.0)
            if (dimensions === 2) {
              const [jitterX, jitterY] = hashInt2ToFloat2(
                neighborX, neighborY,
              )
              dx = jitterX.mul(randomness).add(i).sub(local.x)
              dy = jitterY.mul(randomness).add(j).sub(local.y)
            } else {
              const [jitterX, jitterY, jitterZ] = hashInt3ToFloat3(
                neighborX, neighborY, neighborZ,
              )
              dx = jitterX.mul(randomness).add(i).sub(local.x)
              dy = jitterY.mul(randomness).add(j).sub(local.y)
              dz = jitterZ.mul(randomness).add(k).sub(local.z)
            }
            const distance = tslSqrt(
              dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz)),
            )
            const closer = distance.lessThan(minDistance).toVar()
            minDistance = tslSelect(closer, distance, minDistance).toVar()
            winXExpr = tslSelect(closer, neighborX, winXExpr).toVar()
            winYExpr = tslSelect(closer, neighborY, winYExpr).toVar()
            winZExpr = tslSelect(closer, neighborZ, winZExpr).toVar()
          }
        }
      }
      if (expression.output === 'color') {
        if (dimensions === 2) {
          // hash_int2_to_float3 routes through the 3D hash with z = 0.
          const [r, g, b] = hashInt3ToFloat3(
            winXExpr, winYExpr, tslIntOf(0),
          )
          return tslVec3(r, g, b)
        }
        const [r, g, b] = hashInt3ToFloat3(winXExpr, winYExpr, winZExpr)
        return tslVec3(r, g, b)
      }
      return minDistance
    }
    default:
      return fail(`IR op ${expression.op} has no proven TSL mapping`)
  }
}

const tslCross = cross as unknown as (
  a: TslExprLike, b: TslExprLike,
) => TslExpression
const tslDot = dot as unknown as (
  a: TslExprLike, b: TslExprLike,
) => TslExpression
const tslLength = length as unknown as (value: TslExprLike) => TslExpression

// --- Blender's Jenkins lookup3 hash, the basis of White Noise and
// Voronoi.  Inputs are the RAW IEEE-754 bits of the float coordinates
// (__float_as_uint), so engines agree exactly when the coordinate
// computation is bit-identical — integer-valued cell floats always are.
const tslUintOf = (
  (TSLX as Record<string, unknown>).uint as (value: TslExprLike) => TslExpression
)
const tslBitcast = (
  (TSLX as Record<string, unknown>).bitcast as (
    value: TslExprLike, type: string,
  ) => TslExpression
)

function uintRotate(value: TslExpression, bits: number): TslExpression {
  return value.shiftLeft(tslUintOf(bits))
    .bitOr(value.shiftRight(tslUintOf(32 - bits)))
}

function jenkinsFinal(
  a0: TslExpression, b0: TslExpression, c0: TslExpression,
): TslExpression {
  let a = a0
  let b = b0
  let c = c0
  c = c.bitXor(b).sub(uintRotate(b, 14))
  a = a.bitXor(c).sub(uintRotate(c, 11))
  b = b.bitXor(a).sub(uintRotate(a, 25))
  c = c.bitXor(b).sub(uintRotate(b, 16))
  a = a.bitXor(c).sub(uintRotate(c, 4))
  b = b.bitXor(a).sub(uintRotate(a, 14))
  c = c.bitXor(b).sub(uintRotate(b, 24))
  return c
}

function jenkinsMix(
  a0: TslExpression, b0: TslExpression, c0: TslExpression,
): [TslExpression, TslExpression, TslExpression] {
  let a = a0
  let b = b0
  let c = c0
  a = a.sub(c); a = a.bitXor(uintRotate(c, 4)); c = c.add(b)
  b = b.sub(a); b = b.bitXor(uintRotate(a, 6)); a = a.add(c)
  c = c.sub(b); c = c.bitXor(uintRotate(b, 8)); b = b.add(a)
  a = a.sub(c); a = a.bitXor(uintRotate(c, 16)); c = c.add(b)
  b = b.sub(a); b = b.bitXor(uintRotate(a, 19)); a = a.add(c)
  c = c.sub(b); c = c.bitXor(uintRotate(b, 4)); b = b.add(a)
  return [a, b, c]
}

function floatBits(value: TslExpression): TslExpression {
  return tslBitcast(value, 'uint')
}

/** Blender's `hash_uint` — the 1-argument member of the same family.
 *
 * The arity is encoded in the seed: `0xdeadbeef + (N << 2) + 13`, so this is
 * not `hashUint2(x, 0)` and substituting one for the other silently produces a
 * different field.
 *
 * The `.toVar()` calls are load-bearing, not style. WGSL evaluates all-literal
 * subexpressions as CONST-expressions, and a const-expression that overflows
 * u32 is a compile ERROR, not a wrap — Tint: "'305419896 << 14' cannot be
 * represented as 'u32'". hashUint2/3/4 never hit this because every one of
 * their b/c operands mixes in a runtime key; here b and c stay literal seeds,
 * so without the vars the whole Jenkins mix folds at compile time, the shader
 * never builds, and the readback silently returns the PREVIOUS render —
 * measured as a plausible-looking 1.79e-1 divergence before the stage-by-stage
 * bisection (experiments/tsl-node-differential/run-debug1d.mjs) isolated it.
 */
function hashUint1(kx: TslExpression): TslExpression {
  const seed = 0xdeadbeef + (1 << 2) + 13
  const b = tslUintOf(seed).toVar()
  const c = tslUintOf(seed).toVar()
  return jenkinsFinal(tslUintOf(seed).add(kx), b, c)
}

/** Blender's `fade` — the quintic Perlin ease, t^3(t(6t-15)+10). */
function perlinFade(t: TslExpression): TslExpression {
  return t.mul(t).mul(t).mul(t.mul(t.mul(6.0).sub(15.0)).add(10.0))
}

/** Blender's `grad1`, verbatim from intern/cycles/kernel/svm/noise.h:
 *
 *   int h = hash & 15; float g = 1 + (h & 7);
 *   return negate_if(g, h & 8) * x;
 */
const perlinGrad1 = tslFn(([hash, x]) => {
  const h = hash!.bitAnd(tslUintOf(15))
  const g = tslFloat(h.bitAnd(tslUintOf(7))).add(1.0)
  const positive = h.bitAnd(tslUintOf(8)).equal(tslUintOf(0))
  return tslSelect(positive, g, g.negate()).mul(x!)
}).setLayout({
  // Fn + layout, matching three's own mx_gradient_float, and it is
  // load-bearing: TSL emits a .toVar()'s assignment at its FIRST USE site,
  // and select() compiles to if/else, so a var first read inside a select
  // that sits in an inline DAG gets a CONDITIONAL assignment -- fragments
  // taking the other branch read an unassigned var<private>. Measured on the
  // 4D bilinear: taps individually exact, composition off by 1.4e-1 at
  // lattice corners. Arguments to a laid-out Fn are evaluated at the call
  // site, unconditionally, which closes the hazard for every caller.
  name: 'blenderPerlinGrad1',
  type: 'float',
  inputs: [{ name: 'hash', type: 'uint' }, { name: 'x', type: 'float' }],
})

/** Blender's `perlin_1d` with `noise_scale1`'s 0.25 normalisation folded in.
 *
 * three has no 1D Perlin at all — `mx_perlin_noise_float` is an overloadingFn
 * over vec2 and vec3 only — so this is a direct port of Blender's rather than
 * a MaterialX mapping. GPU-vs-CPU bisection measured every stage (hash,
 * gradient, fade, full perlin) agreeing to 4.2e-8; the gated `noise-1d` cells
 * hold the Blender-vs-TSL claim.
 */
function perlin1d(x: TslExpression): TslExpression {
  const ix = tslFloor(x)
  const fx = x.sub(ix)
  // Blender keeps X as a signed int and hands it to hash_uint, which C
  // reinterprets as two's complement. A WGSL value conversion u32(i32) is
  // undefined for negatives, so bitcast is the only well-defined spelling and
  // negative coordinates are entirely normal here.
  const X = tslBitcast(tslIntOf(ix), 'uint')
  const u = perlinFade(fx)
  const result = tslMix(
    perlinGrad1(hashUint1(X), fx),
    perlinGrad1(hashUint1(X.add(tslUintOf(1))), fx.sub(1.0)),
    u,
  )
  return result.mul(0.25)
}

const perlinGrad4 = tslFn(([hash, x, y, z, w]) => {
  const h = hash!.bitAnd(tslUintOf(31))
  const u = tslSelect(h.lessThan(tslUintOf(24)), x!, y!)
  const v = tslSelect(h.lessThan(tslUintOf(16)), y!, z!)
  const s = tslSelect(h.lessThan(tslUintOf(8)), z!, w!)
  return tslSelect(h.bitAnd(tslUintOf(1)).equal(tslUintOf(0)), u, u.negate())
    .add(tslSelect(h.bitAnd(tslUintOf(2)).equal(tslUintOf(0)), v, v.negate()))
    .add(tslSelect(h.bitAnd(tslUintOf(4)).equal(tslUintOf(0)), s, s.negate()))
}).setLayout({
  // Same rationale as perlinGrad1's layout, and this is the function where
  // the hazard was actually caught: run-debug1d.mjs measured the inline-DAG
  // form corrupting the outer fade var at lattice corners.
  name: 'blenderPerlinGrad4',
  type: 'float',
  inputs: [
    { name: 'hash', type: 'uint' },
    { name: 'x', type: 'float' },
    { name: 'y', type: 'float' },
    { name: 'z', type: 'float' },
    { name: 'w', type: 'float' },
  ],
})

/** Blender's `perlin_4d` with `noise_scale4`'s 0.8344 folded in.
 *
 * Sixteen `grad4(hashUint4(...))` taps, x-fastest lattice order, combined by
 * `quad_mix` = two `tri_mix` (x innermost, then y, then z) mixed along w —
 * the nested tslMix form is the same polynomial up to fp reassociation.
 * `hashUint4` is the already-proven arity (white-noise 4D gates it), so
 * unlike hashUint1 there is no const-fold trap: every operand mixes in a
 * runtime key. `snoise_4d`'s |p| >= 1e6 fmod precision guard is deliberately
 * omitted — corpus coordinates are orders of magnitude below it.
 * Taps and lattice coords are `.toVar()`d to keep the WGSL flat: at detail 6
 * this function instantiates up to 7 octaves x 16 Jenkins hashes.
 */
function perlin4d(p: TslExpression): TslExpression {
  const ix = tslFloor(p.x)
  const iy = tslFloor(p.y)
  const iz = tslFloor(p.z)
  const iw = tslFloor(p.w)
  const fx = p.x.sub(ix).toVar()
  const fy = p.y.sub(iy).toVar()
  const fz = p.z.sub(iz).toVar()
  const fw = p.w.sub(iw).toVar()
  const X = tslBitcast(tslIntOf(ix), 'uint').toVar()
  const Y = tslBitcast(tslIntOf(iy), 'uint').toVar()
  const Z = tslBitcast(tslIntOf(iz), 'uint').toVar()
  const W = tslBitcast(tslIntOf(iw), 'uint').toVar()
  const u = perlinFade(fx).toVar()
  const v = perlinFade(fy).toVar()
  const t = perlinFade(fz).toVar()
  const sw = perlinFade(fw).toVar()
  const one = tslUintOf(1)
  const tap = (i: number, j: number, k: number, l: number): TslExpression =>
    perlinGrad4(
      hashUint4(
        i ? X.add(one) : X, j ? Y.add(one) : Y,
        k ? Z.add(one) : Z, l ? W.add(one) : W,
      ),
      i ? fx.sub(1.0) : fx, j ? fy.sub(1.0) : fy,
      k ? fz.sub(1.0) : fz, l ? fw.sub(1.0) : fw,
    ).toVar()
  const tri = (l: number): TslExpression => tslMix(
    tslMix(
      tslMix(tap(0, 0, 0, l), tap(1, 0, 0, l), u),
      tslMix(tap(0, 1, 0, l), tap(1, 1, 0, l), u), v,
    ),
    tslMix(
      tslMix(tap(0, 0, 1, l), tap(1, 0, 1, l), u),
      tslMix(tap(0, 1, 1, l), tap(1, 1, 1, l), u), v,
    ), t,
  )
  return tslMix(tri(0), tri(1), sw).mul(0.8344)
}

function hashUint2(kx: TslExpression, ky: TslExpression): TslExpression {
  const seed = 0xdeadbeef + (2 << 2) + 13
  return jenkinsFinal(
    tslUintOf(seed).add(kx), tslUintOf(seed).add(ky), tslUintOf(seed),
  )
}

function hashUint3(
  kx: TslExpression, ky: TslExpression, kz: TslExpression,
): TslExpression {
  const seed = 0xdeadbeef + (3 << 2) + 13
  return jenkinsFinal(
    tslUintOf(seed).add(kx),
    tslUintOf(seed).add(ky),
    tslUintOf(seed).add(kz),
  )
}

function hashUint4(
  kx: TslExpression, ky: TslExpression, kz: TslExpression, kw: TslExpression,
): TslExpression {
  const seed = 0xdeadbeef + (4 << 2) + 13
  const [a, b, c] = jenkinsMix(
    tslUintOf(seed).add(kx),
    tslUintOf(seed).add(ky),
    tslUintOf(seed).add(kz),
  )
  return jenkinsFinal(a.add(kw), b, c)
}

const uintToUnitFloat = (value: TslExpression): TslExpression =>
  tslFloat(value).div(4294967295.0)

function hashFloat1ToFloat(w: TslExpression): TslExpression {
  return uintToUnitFloat(hashUint1(floatBits(w)))
}

/** Cycles/EEVEE hash_float_to_vec3, verbatim:
 *   float3(hash_float_to_float(k),
 *          hash_vec2_to_float(float2(k, 1.0)),
 *          hash_vec2_to_float(float2(k, 2.0)))
 */
function hashFloat1ToFloat3(w: TslExpression): TslExpression {
  return tslVec3(
    hashFloat1ToFloat(w),
    hashFloat2ToFloat(w, tslFloat(1.0)),
    hashFloat2ToFloat(w, tslFloat(2.0)),
  )
}

/** Cycles/EEVEE hash_vec4_to_vec3, verbatim: the SAME 4-lane hash over
 * the xyzw, zxwy and wzyx swizzles of one coordinate. */
function hashFloat4ToFloat3(
  x: TslExpression, y: TslExpression, z: TslExpression, w: TslExpression,
): TslExpression {
  return tslVec3(
    hashFloat4ToFloat(x, y, z, w),
    hashFloat4ToFloat(z, x, w, y),
    hashFloat4ToFloat(w, z, y, x),
  )
}

function hashFloat2ToFloat(
  x: TslExpression, y: TslExpression,
): TslExpression {
  return uintToUnitFloat(hashUint2(floatBits(x), floatBits(y)))
}

function hashFloat3ToFloat(
  x: TslExpression, y: TslExpression, z: TslExpression,
): TslExpression {
  return uintToUnitFloat(hashUint3(floatBits(x), floatBits(y), floatBits(z)))
}

function hashFloat4ToFloat(
  x: TslExpression, y: TslExpression, z: TslExpression, w: TslExpression,
): TslExpression {
  return uintToUnitFloat(
    hashUint4(floatBits(x), floatBits(y), floatBits(z), floatBits(w)),
  )
}

/** Cycles hash_float3_to_float3: the 4D hash with w = 1 and w = 2 fills
 * the second and third lanes. */
function hashFloat3ToFloat3(
  x: TslExpression, y: TslExpression, z: TslExpression,
): TslExpression {
  const one = tslFloat(1.0)
  const two = tslFloat(2.0)
  return tslVec3(
    hashFloat3ToFloat(x, y, z),
    hashFloat4ToFloat(x, y, z, one),
    hashFloat4ToFloat(x, y, z, two),
  )
}

/** Cycles hash_float2_to_float2: 2D Voronoi's point jitter. */
function hashFloat2ToFloat2(
  x: TslExpression, y: TslExpression,
): [TslExpression, TslExpression] {
  return [
    hashFloat2ToFloat(x, y),
    hashFloat3ToFloat(x, y, tslFloat(1.0)),
  ]
}

function hashFloat2ToFloat3(
  x: TslExpression, y: TslExpression,
): TslExpression {
  return tslVec3(
    hashFloat2ToFloat(x, y),
    hashFloat3ToFloat(x, y, tslFloat(1.0)),
    hashFloat3ToFloat(x, y, tslFloat(2.0)),
  )
}

// --- Blender hash_pcg3d_i / hash_pcg2d_i: SIGNED 32-bit PCG on integer
// cell coordinates — the 4.x+ Voronoi jitter hash, distinct from White
// Noise's Jenkins-on-float-bits.  Verified against baked ground truth;
// the arithmetic (sign-replicating) shift is load-bearing, and WGSL's
// i32 >> is exactly that.  Shift amounts must be u32 in WGSL.
const tslIntOf = (
  (TSLX as Record<string, unknown>).int as (value: TslExprLike) => TslExpression
)

function pcg3dSigned(
  x: TslExpression, y: TslExpression, z: TslExpression,
): [TslExpression, TslExpression, TslExpression] {
  const multiplier = tslIntOf(1664525)
  const increment = tslIntOf(1013904223)
  const shift = tslUintOf(16)
  let vx = x.mul(multiplier).add(increment)
  let vy = y.mul(multiplier).add(increment)
  let vz = z.mul(multiplier).add(increment)
  vx = vx.add(vy.mul(vz))
  vy = vy.add(vz.mul(vx))
  vz = vz.add(vx.mul(vy))
  vx = vx.bitXor(vx.shiftRight(shift))
  vy = vy.bitXor(vy.shiftRight(shift))
  vz = vz.bitXor(vz.shiftRight(shift))
  vx = vx.add(vy.mul(vz))
  vy = vy.add(vz.mul(vx))
  vz = vz.add(vx.mul(vy))
  const mask = tslIntOf(0x7FFFFFFF)
  return [vx.bitAnd(mask), vy.bitAnd(mask), vz.bitAnd(mask)]
}

function pcg2dSigned(
  x: TslExpression, y: TslExpression,
): [TslExpression, TslExpression] {
  const multiplier = tslIntOf(1664525)
  const increment = tslIntOf(1013904223)
  const shift = tslUintOf(16)
  let vx = x.mul(multiplier).add(increment)
  let vy = y.mul(multiplier).add(increment)
  vx = vx.add(vy.mul(multiplier))
  vy = vy.add(vx.mul(multiplier))
  vx = vx.bitXor(vx.shiftRight(shift))
  vy = vy.bitXor(vy.shiftRight(shift))
  vx = vx.add(vy.mul(multiplier))
  vy = vy.add(vx.mul(multiplier))
  const mask = tslIntOf(0x7FFFFFFF)
  return [vx.bitAnd(mask), vy.bitAnd(mask)]
}

const signedHashUnit = (value: TslExpression): TslExpression =>
  tslFloat(value).div(2147483647.0)

function hashInt3ToFloat3(
  x: TslExpression, y: TslExpression, z: TslExpression,
): [TslExpression, TslExpression, TslExpression] {
  const [hx, hy, hz] = pcg3dSigned(x, y, z)
  return [signedHashUnit(hx), signedHashUnit(hy), signedHashUnit(hz)]
}

function hashInt2ToFloat2(
  x: TslExpression, y: TslExpression,
): [TslExpression, TslExpression] {
  const [hx, hy] = pcg2dSigned(x, y)
  return [signedHashUnit(hx), signedHashUnit(hy)]
}

/** Refuse, by name, a chain that requests more sampled textures than a
 * WebGPU pipeline can bind. The default per-stage limit is 16 and three
 * uses some bindings itself, so the budget is deliberately below it.
 * Without this the pipeline fails validation asynchronously and, before
 * the harness learned to surface that, the readback silently returned
 * the PREVIOUS render -- ellie.hair_mesh measured as a bit-exact copy of
 * the gums constant and was misdiagnosed as a mapping defect. */
function assertSampledTextureBudget(texturesBefore: number): void {
  const total = activeOptions.resources?.textures.length ?? 0
  const sampled = total - texturesBefore
  const budget = 14
  if (sampled > budget) {
    fail(
      `chain binds ${sampled} sampled textures; the WebGPU default `
      + `per-stage limit is 16 and the budget is ${budget}`,
    )
  }
}

function buildLutTexture(
  expression: TslIrExpression,
): { lut: DataTexture, samples: number } {
  const samples = scalar(expression, 'samples')
  const values = numbers(expression, 'values')
  if (values.length !== samples * 4) {
    fail(`IR ${expression.op} values do not match its sample count`)
  }
  // Content-addressed: identical tables share one DataTexture. Semantic
  // identity (same bytes, nearest-filtered, clamped), measured on the
  // hair chain as 40 nodes -> 5 textures.
  const cacheKey = `${samples}:${values.join(',')}`
  const cached = lutCache.get(cacheKey)
  if (cached) return cached
  const data = new Float32Array(values)
  const lut = new DataTexture(data, samples, 1, RGBAFormat, FloatType)
  lut.minFilter = NearestFilter
  lut.magFilter = NearestFilter
  lut.wrapS = ClampToEdgeWrapping
  lut.wrapT = ClampToEdgeWrapping
  lut.generateMipmaps = false
  lut.needsUpdate = true
  activeOptions.resources?.textures.push(lut)
  const entry = { lut, samples }
  lutCache.set(cacheKey, entry)
  return entry
}

/** Manual two-texel lerp over a nearest-filtered LUT row; the factor must
 * already be clamped to [0, 1]. */
function sampleLut(
  lut: DataTexture, samples: number, factor: TslExpression,
): TslExpression {
  const scaled = factor.mul(samples - 1)
  const index = tslFloor(scaled)
  const blend = scaled.sub(index)
  const coordinate = (offset: number) => tslVec2(
    index.add(offset + 0.5).div(samples), 0.5,
  )
  const low = tslTexture(lut, coordinate(0))
  const high = tslTexture(lut, coordinate(1))
  return tslMix(low, high, blend)
}

/** Blender's Vector Rotate for every fixed-axis mode.
 *
 * Transcribed term by term from `rotate_around_axis` in
 * `intern/cycles/util/math_float3.h` — Rodrigues written out as nine
 * coefficients rather than a matrix, which is how Blender writes it:
 *
 *   r.x = ((c + (1-c)*a.x*a.x) * p.x)
 *       + (((1-c)*a.x*a.y - a.z*s) * p.y)
 *       + (((1-c)*a.x*a.z + a.y*s) * p.z);
 *
 * and cyclically for y and z. The sintheta term is NEGATIVE on the
 * lower-index partner and positive on the higher in each row, which is the
 * detail worth transcribing carefully rather than deriving.
 *
 * Center is applied by the node, not the helper: subtract before, add after.
 */
function buildVectorRotate(expression: TslIrExpression): TslExpression {
  const center = expression.center as number[]
  const centered = build(child(expression, 'input'))
    .sub(tslVec3(center[0], center[1], center[2]))
  const angle = build(child(expression, 'angle'))
  const rawAxis = build(child(expression, 'axis'))
  // A literal axis is already unit length; only a linked one needs the
  // normalize, and Blender leaves the vector untouched when it is zero.
  const axis = expression.normalizeAxis === true ? tslNormalize(rawAxis) : rawAxis
  const cosTheta = tslCos(angle)
  const sinTheta = tslSin(angle)
  const oneMinus = tslFloat(1.0).sub(cosTheta)
  const term = (
    diagonal: TslExpression,
    offDiagonalA: TslExpression,
    offDiagonalB: TslExpression,
  ): TslExpression => diagonal.add(offDiagonalA).add(offDiagonalB)
  const rotated = tslVec3(
    term(
      cosTheta.add(oneMinus.mul(axis.x).mul(axis.x)).mul(centered.x),
      oneMinus.mul(axis.x).mul(axis.y).sub(axis.z.mul(sinTheta)).mul(centered.y),
      oneMinus.mul(axis.x).mul(axis.z).add(axis.y.mul(sinTheta)).mul(centered.z),
    ),
    term(
      oneMinus.mul(axis.x).mul(axis.y).add(axis.z.mul(sinTheta)).mul(centered.x),
      cosTheta.add(oneMinus.mul(axis.y).mul(axis.y)).mul(centered.y),
      oneMinus.mul(axis.y).mul(axis.z).sub(axis.x.mul(sinTheta)).mul(centered.z),
    ),
    term(
      oneMinus.mul(axis.x).mul(axis.z).sub(axis.y.mul(sinTheta)).mul(centered.x),
      oneMinus.mul(axis.y).mul(axis.z).add(axis.x.mul(sinTheta)).mul(centered.y),
      cosTheta.add(oneMinus.mul(axis.z).mul(axis.z)).mul(centered.z),
    ),
  )
  return rotated.add(tslVec3(center[0], center[1], center[2]))
}

function buildVectorMath(expression: TslIrExpression): TslExpression {
  const operation = String(expression.operation)
  const a = build(child(expression, 'a'))
  const b = () => build(child(expression, 'b'))
  // Anything with a per-component branch is built with scalar selects: a
  // vector-condition select collapses to one lane (measured 2026-07-27).
  const perChannel = (
    fn: (aChannel: TslExpression, bChannel: TslExpression) => TslExpression,
  ): TslExpression => {
    const bv = b()
    return tslVec3(fn(a.x, bv.x), fn(a.y, bv.y), fn(a.z, bv.z))
  }
  switch (operation) {
    case 'ADD': return a.add(b())
    case 'SUBTRACT': return a.sub(b())
    case 'MULTIPLY': return a.mul(b())
    case 'MULTIPLY_ADD':
      return a.mul(b()).add(build(child(expression, 'c')))
    case 'DIVIDE': return perChannel(blenderDivide)
    case 'MODULO': return perChannel(blenderModulo)
    case 'SNAP': return perChannel((aChannel, bChannel) => tslSelect(
      bChannel.equal(0.0), tslFloat(0.0),
      tslFloor(aChannel.div(guardedDivisor(bChannel))).mul(bChannel),
    ))
    case 'WRAP': {
      const bv = b()
      const cv = build(child(expression, 'c'))
      const channel = (
        value: TslExpression, maxValue: TslExpression,
        minValue: TslExpression,
      ): TslExpression => {
        const range = maxValue.sub(minValue)
        const wrapped = value.sub(range.mul(
          tslFloor(value.sub(minValue).div(guardedDivisor(range))),
        ))
        return tslSelect(range.equal(0.0), minValue, wrapped)
      }
      return tslVec3(
        channel(a.x, bv.x, cv.x),
        channel(a.y, bv.y, cv.y),
        channel(a.z, bv.z, cv.z),
      )
    }
    case 'CROSS_PRODUCT': return tslCross(a, b())
    case 'DOT_PRODUCT': return tslDot(a, b())
    case 'DISTANCE': return tslLength(a.sub(b()))
    case 'LENGTH': return tslLength(a)
    case 'NORMALIZE': {
      // Cycles safe_normalize: a zero-length vector stays zero.
      const magnitude = tslLength(a)
      return tslSelect(
        magnitude.equal(0.0), tslVec3(0.0, 0.0, 0.0),
        a.div(guardedDivisor(magnitude)),
      )
    }
    case 'MINIMUM': return tslMin(a, b())
    case 'MAXIMUM': return tslMax(a, b())
    case 'ABSOLUTE': return tslAbs(a)
    case 'FLOOR': return tslFloor(a)
    case 'CEIL': return tslCeil(a)
    case 'FRACTION': return tslFract(a)
    case 'SINE': return tslSin(a)
    case 'COSINE': return tslCos(a)
    case 'TANGENT':
      // tslTan's fallback divides through the scalar-shaped safe divide,
      // so the vector op applies it per channel either way.
      return tslVec3(tslTan(a.x), tslTan(a.y), tslTan(a.z))
    default:
      return fail(
        `IR vector math operation ${operation} has no proven TSL mapping`,
      )
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

/** Cycles rgb_to_hsv: hue from the dominant-channel branch, s = delta/max,
 * v = max; h wraps negative by +1 and collapses to 0 when s is 0.  The
 * channel comparisons run on the same float values both engines computed,
 * so the branch decisions agree except on exact ties (equal channels),
 * where s = 0 hides the hue anyway. */
function blenderRgbToHsv(rgb: TslExpression): TslExpression {
  const r = rgb.x
  const g = rgb.y
  const b = rgb.z
  const cmax = tslMax(r, tslMax(g, b))
  const cmin = tslMin(r, tslMin(g, b))
  const cdelta = cmax.sub(cmin)
  const s = tslSelect(
    cmax.equal(0.0), tslFloat(0.0), cdelta.div(guardedDivisor(cmax)),
  )
  const safeDelta = guardedDivisor(cdelta)
  const cr = cmax.sub(r).div(safeDelta)
  const cg = cmax.sub(g).div(safeDelta)
  const cb = cmax.sub(b).div(safeDelta)
  const raw = tslSelect(
    r.equal(cmax), cb.sub(cg),
    tslSelect(
      g.equal(cmax), tslFloat(2.0).add(cr).sub(cb),
      tslFloat(4.0).add(cg).sub(cr),
    ),
  ).div(6.0)
  const wrapped = tslSelect(raw.lessThan(0.0), raw.add(1.0), raw)
  const h = tslSelect(s.equal(0.0), tslFloat(0.0), wrapped)
  return tslVec3(h, s, cmax)
}

/** Cycles hsv_to_rgb: the sextant switch (i = floor(6h), h == 1 wraps to
 * 0 first) picked with scalar selects; s = 0 short-circuits to gray. */
function blenderHsvToRgb(hsv: TslExpression): TslExpression {
  const s = hsv.y
  const v = hsv.z
  const h = tslSelect(hsv.x.equal(1.0), tslFloat(0.0), hsv.x).mul(6.0)
  const i = tslFloor(h)
  const f = h.sub(i)
  const p = v.mul(tslOneMinus(s))
  const q = v.mul(tslOneMinus(s.mul(f)))
  const t = v.mul(tslOneMinus(s.mul(tslOneMinus(f))))
  const pick = (
    c0: TslExpression, c1: TslExpression, c2: TslExpression,
    c3: TslExpression, c4: TslExpression, c5: TslExpression,
  ): TslExpression => tslSelect(
    i.lessThan(1.0), c0,
    tslSelect(
      i.lessThan(2.0), c1,
      tslSelect(
        i.lessThan(3.0), c2,
        tslSelect(
          i.lessThan(4.0), c3,
          tslSelect(i.lessThan(5.0), c4, c5),
        ),
      ),
    ),
  )
  const gray = s.equal(0.0)
  return tslVec3(
    tslSelect(gray, v, pick(v, q, p, p, t, v)),
    tslSelect(gray, v, pick(t, v, v, q, p, p)),
    tslSelect(gray, v, pick(p, p, t, v, v, q)),
  )
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
    case 'SUBTRACT': blended = tslMix(a, a.sub(b), factor); break
    case 'DIFFERENCE': blended = tslMix(a, tslAbs(a.sub(b)), factor); break
    case 'DARKEN': blended = tslMix(a, tslMin(a, b), factor); break
    case 'LIGHTEN':
      // Measured 2026-07-27: Cycles interps toward max(a, b) — the legacy
      // compositor's asymmetric max(a, b*t) form diverged at 0.155.
      blended = tslMix(a, tslMax(a, b), factor)
      break
    case 'SCREEN': {
      // 1 - (tm + t * (1 - b)) * (1 - a).
      const tm = tslOneMinus(factor)
      blended = tslOneMinus(
        tm.add(factor.mul(tslOneMinus(b))).mul(tslOneMinus(a)),
      )
      break
    }
    case 'EXCLUSION':
      blended = tslMax(
        tslMix(a, a.add(b).sub(a.mul(b).mul(2.0)), factor), tslFloat(0.0),
      )
      break
    case 'SOFT_LIGHT': {
      // tm*a + t*((1-a)*b*a + a*(1 - (1-b)*(1-a))).
      const screen = tslOneMinus(tslOneMinus(b).mul(tslOneMinus(a)))
      blended = tslOneMinus(factor).mul(a).add(
        factor.mul(
          tslOneMinus(a).mul(b).mul(a).add(a.mul(screen)),
        ),
      )
      break
    }
    case 'LINEAR_LIGHT':
      blended = a.add(factor.mul(b.mul(2.0).sub(1.0)))
      break
    case 'DODGE': {
      // Per channel: a != 0 -> tmp = 1 - t*b; tmp <= 0 -> 1,
      // else min(a / tmp, 1).
      const channel = (
        aChannel: TslExpression, bChannel: TslExpression,
      ): TslExpression => {
        const tmp = tslOneMinus(factor.mul(bChannel))
        const dodged = tslSelect(
          tmp.lessThanEqual(0.0), tslFloat(1.0),
          tslMin(aChannel.div(guardedDivisor(tmp)), 1.0),
        )
        return tslSelect(aChannel.equal(0.0), aChannel, dodged)
      }
      blended = tslVec3(
        channel(a.x, b.x), channel(a.y, b.y), channel(a.z, b.z),
      )
      break
    }
    case 'BURN': {
      // Per channel: tmp = tm + t*b; tmp <= 0 -> 0,
      // else clamp(1 - (1-a)/tmp, 0, 1).
      const inverse = tslOneMinus(factor)
      const channel = (
        aChannel: TslExpression, bChannel: TslExpression,
      ): TslExpression => {
        const tmp = inverse.add(factor.mul(bChannel))
        const burned = tslClamp(
          tslOneMinus(tslOneMinus(aChannel).div(guardedDivisor(tmp))),
          0.0, 1.0,
        )
        return tslSelect(tmp.lessThanEqual(0.0), tslFloat(0.0), burned)
      }
      blended = tslVec3(
        channel(a.x, b.x), channel(a.y, b.y), channel(a.z, b.z),
      )
      break
    }
    case 'HUE': {
      // B's hue grafted onto A's saturation/value, gated on B having any
      // saturation at all, then lerped by the factor.
      const hsvA = blenderRgbToHsv(a)
      const hsvB = blenderRgbToHsv(b)
      const grafted = blenderHsvToRgb(tslVec3(hsvB.x, hsvA.y, hsvA.z))
      blended = tslSelect(
        hsvB.y.equal(0.0), a, tslMix(a, grafted, factor),
      )
      break
    }
    case 'SATURATION': {
      // A's saturation lerped toward B's, only when A has saturation.
      const hsvA = blenderRgbToHsv(a)
      const hsvB = blenderRgbToHsv(b)
      const converted = blenderHsvToRgb(
        tslVec3(hsvA.x, tslMix(hsvA.y, hsvB.y, factor), hsvA.z),
      )
      blended = tslSelect(hsvA.y.equal(0.0), a, converted)
      break
    }
    case 'VALUE': {
      // A's value lerped toward B's; no gate in Cycles for this one.
      const hsvA = blenderRgbToHsv(a)
      const hsvB = blenderRgbToHsv(b)
      blended = blenderHsvToRgb(
        tslVec3(hsvA.x, hsvA.y, tslMix(hsvA.z, hsvB.z, factor)),
      )
      break
    }
    case 'COLOR': {
      // B's hue AND saturation over A's value, gated like HUE.
      const hsvA = blenderRgbToHsv(a)
      const hsvB = blenderRgbToHsv(b)
      const grafted = blenderHsvToRgb(tslVec3(hsvB.x, hsvB.y, hsvA.z))
      blended = tslSelect(
        hsvB.y.equal(0.0), a, tslMix(a, grafted, factor),
      )
      break
    }
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

function assertTslIrDocument(document: TslIrDocument): void {
  if (document?.schemaVersion !== 1
    || document.model !== 'blendlink-tsl-ir-v1') {
    throw new TslIrError(
      `unsupported TSL IR document: ${JSON.stringify({
        schemaVersion: document?.schemaVersion,
        model: document?.model,
      })}`,
    )
  }
}

/** Build one channel's TSL color expression from its IR document. */
export function buildTslColorNode(
  document: TslIrDocument, options: BuildTslOptions = {},
): TslExpression {
  assertTslIrDocument(document)
  activeOptions = options
  lutCache = new Map()
  const texturesBefore = options.resources?.textures.length ?? 0
  try {
    const built = build(document.output)
    assertSampledTextureBudget(texturesBefore)
    // A scalar channel broadcasts to RGB, matching Blender's implicit
    // float -> color conversion.
    return tslVec3(built)
  } finally {
    activeOptions = {}
    lutCache = new Map()
  }
}

/** Build a scalar channel (roughness/metalness/alpha) without the RGB
 * broadcast. The document must be scalar-typed IR (float-socket output);
 * color-typed documents belong on buildTslColorNode. */
export function buildTslScalarNode(
  document: TslIrDocument, options: BuildTslOptions = {},
): TslExpression {
  assertTslIrDocument(document)
  activeOptions = options
  lutCache = new Map()
  const texturesBefore = options.resources?.textures.length ?? 0
  try {
    const built = build(document.output)
    assertSampledTextureBudget(texturesBefore)
    return built
  } finally {
    activeOptions = {}
  }
}
