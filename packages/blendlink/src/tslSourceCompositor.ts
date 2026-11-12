import * as TSL from 'three/tsl'
import { DataTexture, FloatType, RGBAFormat } from 'three'
import type {
  CompositorValue,
  SourceCompositorOperation,
  SourceCompositorProgram,
} from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { blenderRgbToHsv, blenderHsvToRgb, blenderDivide, buildTslMathOperation, buildTslBlendOperation } from './tslNodeRecipe.js'
import { buildBlenderBloom } from './tslBlenderBloom.js'

const {
  abs,
  clamp,
  dot,
  Fn,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  pow,
  select,
  vec2,
  vec3,
  vec4,
  ivec2,
  textureSize,
  textureLoad,
  uv,
  rtt,
  convertToTexture,
} = TSL as unknown as {
  [
    K in
      | 'abs'
      | 'clamp'
      | 'dot'
      | 'Fn'
      | 'float'
      | 'floor'
      | 'fract'
      | 'max'
      | 'min'
      | 'mix'
      | 'pow'
      | 'select'
      | 'vec2'
      | 'vec3'
      | 'vec4'
      | 'ivec2'
      | 'textureSize'
      | 'textureLoad'
      | 'uv'
      | 'rtt'
      | 'convertToTexture'
  ]: (...args: TslEffectNode[]) => TslEffectNode
}

export class SourceCompositorUnsupported extends Error {}

export interface BuiltSourceCompositor {
  node: TslEffectNode
  dispose(): void
}

/** Blender's separable Gaussian includes the fractional radius's final tap. */
export function blenderGaussianWeights(radius: number): number[] {
  if (!Number.isFinite(radius) || radius < 0 || radius > 128) {
    throw new SourceCompositorUnsupported(
      'Gaussian Blur requires a constant radius between 0 and 128 pixels per axis',
    )
  }
  if (radius === 0) return [1]
  const weights = Array.from({ length: Math.ceil(radius) + 1 }, (_, i) =>
    Math.exp(-4.5 * (i / radius) ** 2),
  )
  const total = weights[0]! + 2 * weights.slice(1).reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => weight / total)
}

function hueBasis(hue: TslEffectNode): TslEffectNode {
  const phase = hue.mul(6)
  return vec3(clamp(abs(phase.sub(3)).sub(1), 0, 1),
    clamp(float(2).sub(abs(phase.sub(2))), 0, 1),
    clamp(float(2).sub(abs(phase.sub(4))), 0, 1))
}

function compositorRgbToHsl(color: TslEffectNode, device: unknown): TslEffectNode {
  const high = max(color.r, max(color.g, color.b))
  const low = min(color.r, min(color.g, color.b))
  const delta = high.sub(low)
  const gray = high.equal(low)
  const safeDelta = select(gray, 1, delta)
  const lightness = min(high.add(low).mul(0.5), 1)
  // Blender's GPU compiler groups the extrema sum; this matters near the
  // saturation singularity even though the two formulas are algebraically equal.
  const upperDivisor = device === 'GPU' ? float(2).sub(high.add(low)) : float(2).sub(high).sub(low)
  const divisor = select(lightness.greaterThan(0.5), upperDivisor, high.add(low))
  const saturation = select(gray, 0, delta.div(select(gray, 1, divisor)))
  const hue = select(high.equal(color.r),
    color.g.sub(color.b).div(safeDelta).add(select(color.g.lessThan(color.b), 6, 0)),
    select(high.equal(color.g), color.b.sub(color.r).div(safeDelta).add(2),
      color.r.sub(color.g).div(safeDelta).add(4))).div(6)
  return vec3(select(gray, 0, hue), saturation, lightness)
}

function compositorHsvToRgb(color: TslEffectNode, device: unknown): TslEffectNode {
  if (device === 'CPU') return hueBasis(color.x).sub(1).mul(color.y).add(1).mul(color.z)
  if (device !== 'GPU') throw new SourceCompositorUnsupported('HSV combination has no verified compositor device')
  // Blender's GPU sextant default also handles negative Hue. The shared
  // shader helper's ordinary0..1 hue path remains the same.
  const ordinary = blenderHsvToRgb(color) as TslEffectNode
  const p = color.z.mul(float(1).sub(color.y))
  const q = color.z.mul(float(1).sub(color.y.mul(fract(color.x.mul(6)))))
  return select(color.x.lessThan(0), vec3(color.z, p, q), ordinary)
}

function compositorRgbToHsv(color: TslEffectNode, device: unknown): TslEffectNode {
  if (device === 'GPU') return blenderRgbToHsv(color)
  if (device !== 'CPU') throw new SourceCompositorUnsupported('HSV separation has no verified compositor device')
  const swapGB = color.g.lessThan(color.b)
  const g = select(swapGB, color.b, color.g), b = select(swapGB, color.g, color.b)
  const k = select(swapGB, -1, 0), swapRG = color.r.lessThan(g)
  const high = select(swapRG, g, color.r), second = select(swapRG, color.r, g)
  const low = select(swapRG, min(color.r, b), b)
  const offset = select(swapRG, float(-2 / 6).sub(k), k), delta = high.sub(low)
  return vec3(abs(offset.add(second.sub(b).div(delta.mul(6).add(1e-20)))), delta.div(high.add(1e-20)), high)
}

function compositorYuvYcc(color: TslEffectNode, mode: unknown, yccMode: unknown, reverse: boolean): TslEffectNode {
  const matrix = (rows: number[][], source = color): TslEffectNode =>
    vec3(...rows.map(row => dot(source, vec3(...row))))
  if (mode === 'YUV') return matrix(reverse
    ? [[1, 0, 1.28033], [1, -0.21482, -0.38059], [1, 2.12798, 0]]
    : [[0.2126, 0.7152, 0.0722], [-0.09991, -0.33609, 0.436], [0.615, -0.55861, -0.05639]])
  if (mode !== 'YCC' || !['ITUBT601', 'ITUBT709', 'JFIF'].includes(String(yccMode)))
    throw new SourceCompositorUnsupported('YCC requires ITU BT.601, ITU BT.709 or JPEG/JFIF coefficients')
  if (!reverse) {
    const rows = yccMode === 'ITUBT601' ? [[0.257, 0.504, 0.098], [-0.148, -0.291, 0.439], [0.439, -0.368, -0.071]]
      : yccMode === 'ITUBT709' ? [[0.183, 0.614, 0.062], [-0.101, -0.338, 0.439], [0.439, -0.399, -0.040]]
        : [[0.299, 0.587, 0.114], [-0.16874, -0.33126, 0.5], [0.5, -0.41869, -0.08131]]
    return matrix(rows, color.mul(255)).add(vec3(yccMode === 'JFIF' ? 0 : 16, 128, 128)).div(255)
  }
  if (yccMode === 'JFIF') return matrix([[1, 0, 1.402], [1, -0.34414, -0.71414], [1, 1.772, 0]], color.mul(255))
    .add(vec3(-179.456, 135.45984, -226.816)).div(255)
  const rows = yccMode === 'ITUBT601' ? [[1.164, 0, 1.596], [1.164, -0.392, -0.813], [1.164, 2.017, 0]]
    : [[1.164, 0, 1.793], [1.164, -0.213, -0.534], [1.164, 2.115, 0]]
  return matrix(rows, color.mul(255).sub(vec3(16, 128, 128))).div(255)
}

// Function arguments evaluate complete incoming colors before conditional code.
// An inline select can initialize a shared Combine Color temporary in only one
// branch, leaving its RGB/alpha undefined in the other branch.
const alphaOverFunctions: Record<string, TslEffectNode> = Object.fromEntries(
  ['Over', 'Disjoint Over', 'Conjoint Over'].map((type, index) => [type,
    Fn(([back, front, factor, straight]: TslEffectNode[]) => {
      const a = clamp(front.a, 0, 1), backgroundAlpha = clamp(back.a, 0, 1)
      const foreground = select(straight, vec4(front.rgb.mul(a), a), front).toVar()
      let composed: TslEffectNode
      if (type === 'Disjoint Over') {
        const normalized = select(backgroundAlpha.equal(0), vec4(0),
          back.div(select(backgroundAlpha.equal(0), 1, backgroundAlpha)))
        composed = select(a.add(backgroundAlpha).lessThan(1), foreground.add(back),
          foreground.add(normalized.mul(float(1).sub(a))))
      } else if (type === 'Conjoint Over') {
        composed = select(a.greaterThan(backgroundAlpha), foreground,
          foreground.add(back.mul(float(1).sub(blenderDivide(a, backgroundAlpha)))))
      } else composed = foreground.add(back.mul(float(1).sub(a)))
      return mix(back, composed, factor)
    }).setLayout({ name: 'blendlinkAlphaOver' + index, type: 'vec4', inputs: [
      { name: 'background', type: 'vec4' }, { name: 'foreground', type: 'vec4' },
      { name: 'factor', type: 'float' }, { name: 'straight', type: 'bool' },
    ] }),
  ]),
)

const legacyAlphaOver = Fn(([back, front, factor, premul, straight]: TslEffectNode[]) => {
  const mixed = premul.notEqual(0)
  const scale = select(mixed, float(1).sub(premul).add(front.a.mul(premul)), select(straight, front.a, 1))
  const inverse = float(1).sub(factor.mul(front.a))
  const composed = vec4(back.rgb.mul(inverse).add(front.rgb.mul(factor).mul(scale)),
    back.a.mul(inverse).add(factor.mul(front.a)))
  const empty = select(mixed.or(straight), front.a.lessThanEqual(0), front.a.lessThan(0))
  return select(empty, back, select(factor.equal(1).and(front.a.greaterThanEqual(1)), front, composed))
}).setLayout({ name: 'blendlinkLegacyAlphaOver', type: 'vec4', inputs: [
  { name: 'background', type: 'vec4' }, { name: 'foreground', type: 'vec4' },
  { name: 'factor', type: 'float' }, { name: 'premultiply', type: 'float' }, { name: 'straight', type: 'bool' },
] })

const blendModes = new Set(['MIX', 'MULTIPLY', 'ADD', 'SUBTRACT', 'DIFFERENCE', 'DARKEN', 'LIGHTEN',
  'SCREEN', 'EXCLUSION', 'SOFT_LIGHT', 'LINEAR_LIGHT', 'DODGE', 'BURN', 'HUE', 'SATURATION', 'VALUE', 'COLOR', 'DIVIDE', 'OVERLAY'])
const compositorBlendFunctions = new Map<string, TslEffectNode>()
function compositorBlend(mode: string, device: unknown, legacy: boolean): TslEffectNode {
  if (!blendModes.has(mode)) throw new SourceCompositorUnsupported('Mix mode ' + mode + ' has no verified mapping')
  if (!['CPU', 'GPU'].includes(String(device))) throw new SourceCompositorUnsupported('Mix has no verified color-conversion device')
  const key = mode + device + (legacy ? 'Legacy' : 'Shared')
  if (!compositorBlendFunctions.has(key)) {
    const operation = Fn(([a, b, factor]: TslEffectNode[]) => {
      if (legacy && mode === 'DIVIDE') return vec3(...['r', 'g', 'b'].map(channel =>
        select(b[channel].equal(0), 0, mix(a[channel], blenderDivide(a[channel], b[channel]), factor))))
      if (['HUE', 'SATURATION', 'VALUE', 'COLOR'].includes(mode)) {
        const aHsv = compositorRgbToHsv(a, device), bHsv = compositorRgbToHsv(b, device)
        if (mode === 'HUE') return select(bHsv.y.equal(0), a,
          mix(a, compositorHsvToRgb(vec3(bHsv.x, aHsv.y, aHsv.z), device), factor))
        if (mode === 'SATURATION') return select(aHsv.y.equal(0), a,
          compositorHsvToRgb(vec3(aHsv.x, mix(aHsv.y, bHsv.y, factor), aHsv.z), device))
        if (mode === 'VALUE') return compositorHsvToRgb(vec3(aHsv.x, aHsv.y, mix(aHsv.z, bHsv.z, factor)), device)
        return select(bHsv.y.equal(0), a,
          mix(a, compositorHsvToRgb(vec3(bHsv.x, bHsv.y, aHsv.z), device), factor))
      }
      return buildTslBlendOperation(mode, a, b, factor)
    }).setLayout({ name: 'blendlinkCompositorMix' + key, type: 'vec3', inputs: [
      { name: 'a', type: 'vec3' }, { name: 'b', type: 'vec3' }, { name: 'factor', type: 'float' },
    ] })
    compositorBlendFunctions.set(key, operation)
  }
  return compositorBlendFunctions.get(key)!
}

interface RampStop { position: number; color: number[] }

function buildCompositorRamp(op: SourceCompositorOperation, factor: TslEffectNode,
  single: boolean, resources: { dispose(): void }[]): TslEffectNode {
  const { color_mode: mode, interpolation, hue_interpolation: direction, color_conversion_device: device } = op.properties
  if (!['RGB', 'HSV', 'HSL'].includes(String(mode))
    || !['LINEAR', 'EASE', 'CONSTANT', 'CARDINAL', 'B_SPLINE'].includes(String(interpolation))
    || !['NEAR', 'FAR', 'CW', 'CCW'].includes(String(direction))
    || !['CPU', 'GPU'].includes(String(device)))
    throw new SourceCompositorUnsupported('Color Ramp has an unverified color/interpolation/device model')
  const stops = op.properties.stops as RampStop[]
  if (!Array.isArray(stops) || !stops.length || stops.length > 32
    || stops.some((stop, index) => !Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1
      || (index > 0 && stop.position < stops[index - 1]!.position) || !Array.isArray(stop.color)
      || stop.color.length !== 4 || stop.color.some(channel => !Number.isFinite(channel))))
    throw new SourceCompositorUnsupported('Color Ramp requires finite ordered stops')
  const color = (stop: RampStop): TslEffectNode => vec4(...stop.color)
  if (stops.length === 1) return color(stops[0]!)
  const gpu = device === 'GPU' && !single
  const analyticGpu = mode === 'RGB' && stops.length === 2 && ['LINEAR', 'EASE', 'CONSTANT'].includes(String(interpolation))
  if (gpu && !analyticGpu) {
    const samples = op.properties.samples, values = op.properties.values
    if (samples !== 257 || !Array.isArray(values) || values.length !== 257 * 4
      || values.some(value => typeof value !== 'number' || !Number.isFinite(value)))
      throw new SourceCompositorUnsupported('Color Ramp requires its native 257-entry GPU table')
    const texture = new DataTexture(new Float32Array(values), 257, 1, RGBAFormat, FloatType)
    texture.needsUpdate = true
    resources.push(texture)
    const coordinate = clamp(factor, 0, 1).mul(256)
    const low = floor(coordinate)
    const first = textureLoad(texture, ivec2(low, 0))
    if (interpolation === 'CONSTANT') return first
    if (op.properties.gpu_filter_fraction_bits !== 8)
      throw new SourceCompositorUnsupported('Color Ramp GPU lookup has no verified native filter precision')
    const blend = floor(fract(coordinate).mul(256).add(0.5)).div(256)
    return mix(first, textureLoad(texture, ivec2(min(low.add(1), 256), 0)), blend)
  }
  if (analyticGpu && gpu && interpolation === 'CONSTANT')
    return select(factor.greaterThan(stops[1]!.position), color(stops[1]!), color(stops[0]!))
  const spline = mode === 'RGB' && ['CARDINAL', 'B_SPLINE'].includes(String(interpolation))
  if (spline) {
    const segment = (a: number): TslEffectNode => {
      const left = stops[Math.max(a - 1, 0)]!, right = stops[Math.min(a, stops.length - 1)]!
      const leftPosition = a === 0 ? 0 : left.position, rightPosition = a === stops.length ? 1 : right.position
      const f = leftPosition === rightPosition ? float(a === stops.length ? 1 : 0)
        : clamp(factor.sub(rightPosition).div(leftPosition - rightPosition), 0, 1)
      const f2 = f.mul(f), f3 = f2.mul(f)
      const weights = interpolation === 'CARDINAL' ? [
        f3.mul(-0.71).add(f2.mul(1.42)).sub(f.mul(0.71)),
        f3.mul(1.29).sub(f2.mul(2.29)).add(1),
        f3.mul(-1.29).add(f2.mul(1.58)).add(f.mul(0.71)),
        f3.mul(0.71).sub(f2.mul(0.71)),
      ] : [
        f3.mul(-0.16666666).add(f2.mul(0.5)).sub(f.mul(0.5)).add(0.16666666),
        f3.mul(0.5).sub(f2).add(0.66666666),
        f3.mul(-0.5).add(f2.mul(0.5)).add(f.mul(0.5)).add(0.16666666),
        f3.mul(0.16666666),
      ]
      const previous = a < 2 ? left : stops[a - 2]!
      const next = a >= stops.length - 1 ? right : stops[a + 1]!
      return clamp(color(previous).mul(weights[3]).add(color(left).mul(weights[2]))
        .add(color(right).mul(weights[1])).add(color(next).mul(weights[0])), 0, 1)
    }
    let result = segment(stops.length)
    for (let a = stops.length - 1; a >= 0; a--) result = select(factor.lessThan(stops[a]!.position), segment(a), result)
    return result
  }
  let result = color(stops.at(-1)!)
  for (let index = stops.length - 2; index >= 0; index--) {
    const left = stops[index]!, right = stops[index + 1]!
    let t = right.position === left.position ? float(1)
      : clamp(factor.sub(left.position).div(right.position - left.position), 0, 1)
    let segment: TslEffectNode
    if (mode === 'RGB') {
      if (interpolation === 'EASE') t = t.mul(t).mul(float(3).sub(t.mul(2)))
      segment = interpolation === 'CONSTANT' ? color(left) : mix(color(left), color(right), t)
    } else {
      const convert = (stop: RampStop): TslEffectNode => mode === 'HSV'
        ? blenderRgbToHsv(color(stop).rgb) : compositorRgbToHsl(color(stop).rgb, 'CPU')
      const l = convert(left), r = convert(right), difference = l.x.sub(r.x)
      const addRight = direction === 'NEAR' ? r.x.lessThan(l.x).and(difference.greaterThan(0.5))
        : direction === 'FAR' ? r.x.equal(l.x).or(r.x.lessThan(l.x).and(difference.lessThan(0.5)))
          : direction === 'CW' ? r.x.lessThan(l.x) : float(0).equal(1)
      const addLeft = direction === 'NEAR' ? r.x.greaterThan(l.x).and(difference.lessThan(-0.5))
        : direction === 'FAR' ? r.x.greaterThan(l.x).and(difference.greaterThan(-0.5))
          : direction === 'CCW' ? r.x.greaterThan(l.x) : float(0).equal(1)
      const hue = mix(select(addLeft, l.x.add(1), l.x), select(addRight, r.x.add(1), r.x), t)
      const hsl = vec3(select(hue.greaterThanEqual(1), hue.sub(1), hue), mix(l.y, r.y, t), mix(l.z, r.z, t))
      const rgb = mode === 'HSV' ? compositorHsvToRgb(hsl, 'CPU')
        : hueBasis(hsl.x).sub(0.5).mul(float(1).sub(abs(hsl.z.mul(2).sub(1))).mul(hsl.y)).add(hsl.z)
      segment = vec4(rgb, mix(float(left.color[3]), float(right.color[3]), t))
    }
    result = select(factor.lessThan(right.position), segment, result)
  }
  return select(factor.lessThanEqual(stops[0]!.position), color(stops[0]!), result)
}

function buildCompositorCurves(op: SourceCompositorOperation,
  input: (name: string) => TslEffectNode, single: boolean,
  resources: { dispose(): void }[]): TslEffectNode {
  const p = op.properties
  const ranges = p.curve_ranges as number[][], values = p.curve_values as number[][]
  const slopes = p.curve_slopes as number[][]
  const compositorRgb = op.source.nodeType === 'CompositorNodeCurveRGB'
  const shaderRgb = op.source.nodeType === 'ShaderNodeRGBCurve'
  const scalar = op.source.nodeType === 'ShaderNodeFloatCurve'
  const expected = compositorRgb || shaderRgb ? 4 : scalar ? 1 : 3
  if (!['CPU', 'GPU'].includes(String(p.color_conversion_device))
    || !Array.isArray(ranges) || ranges.length !== expected || !Array.isArray(values) || values.length !== expected
    || !Array.isArray(slopes) || slopes.length !== expected
    || ranges.some(row => !Array.isArray(row) || row.length !== 2 || !row.every(Number.isFinite) || row[1]! <= row[0]!)
    || values.some(row => !Array.isArray(row) || row.length !== 257 || !row.every(Number.isFinite))
    || slopes.some(row => !Array.isArray(row) || row.length !== 2 || !row.every(Number.isFinite)))
    throw new SourceCompositorUnsupported('Curves require finite native tables, ranges and slopes')
  const gpu = p.color_conversion_device === 'GPU' && !single
  if (gpu && p.gpu_filter_fraction_bits !== 8)
    throw new SourceCompositorUnsupported('Curves GPU lookup has no verified native filter precision')
  const makeTexture = (tables: number[][]): DataTexture => {
    const pixels = new Float32Array(257 * 4)
    for (let index = 0; index < 257; index++) for (let channel = 0; channel < tables.length; channel++)
      pixels[index * 4 + channel] = tables[channel]![index]!
    const texture = new DataTexture(pixels, 257, 1, RGBAFormat, FloatType)
    texture.needsUpdate = true
    resources.push(texture)
    return texture
  }
  const texture = makeTexture(values)
  const evaluate = (parameter: TslEffectNode, channel: number, table = texture,
    extension = slopes[channel]!): TslEffectNode => {
    const [low, high] = ranges[channel]!
    const coordinate = clamp(parameter.sub(low).div(high! - low!), 0, 1).mul(256)
    const index = floor(coordinate), key = ['r', 'g', 'b', 'a'][channel]!
    const a = textureLoad(table, ivec2(index, 0))[key]
    const b = textureLoad(table, ivec2(min(index.add(1), 256), 0))[key]
    const fraction = gpu ? floor(fract(coordinate).mul(256).add(0.5)).div(256) : fract(coordinate)
    const sampled = mix(a, b, fraction)
    const first = textureLoad(table, ivec2(0, 0))[key], last = textureLoad(table, ivec2(256, 0))[key]
    return select(parameter.lessThan(low), first.add(parameter.sub(low).mul(extension[0])),
      select(parameter.greaterThan(high), last.add(parameter.sub(high).mul(extension[1])), sampled))
  }
  const factor = op.inputs.Fac ? input('Fac') : float(1)
  if (scalar) {
    let curved = evaluate(input('Value'), 0)
    if (!gpu && p.curve_clip) {
      const clip = p.curve_clip_y as number[]
      if (!Array.isArray(clip) || clip.length !== 2 || !clip.every(Number.isFinite))
        throw new SourceCompositorUnsupported('Float Curves requires its native output clipping range')
      curved = clamp(curved, clip[0], clip[1])
    }
    return mix(input('Value'), curved, factor)
  }
  if (!compositorRgb && !shaderRgb) {
    const vector = input('Vector')
    return mix(vector, vec3(...['x', 'y', 'z'].map((axis, index) => evaluate(vector[axis], index))), factor)
  }
  const color = input('Image')
  const balanced = compositorRgb ? color.rgb.sub(input('Black Level').rgb)
    .div(max(input('White Level').rgb.sub(input('Black Level').rgb), 1e-5)) : color.rgb
  let curved: TslEffectNode
  if (compositorRgb && p.curve_tone === 'FILMLIKE') {
    const low = min(balanced.r, min(balanced.g, balanced.b)), high = max(balanced.r, max(balanced.g, balanced.b))
    const mappedLow = evaluate(low, 3), mappedHigh = evaluate(high, 3)
    const scale = blenderDivide(mappedHigh.sub(mappedLow), high.sub(low))
    curved = vec3(...['r', 'g', 'b'].map(axis => select(balanced[axis].equal(high), mappedHigh,
      select(balanced[axis].equal(low), mappedLow, mappedLow.add(balanced[axis].sub(low).mul(scale))))))
  } else if (compositorRgb && p.curve_tone !== 'STANDARD') {
    throw new SourceCompositorUnsupported('RGB Curves requires Standard or Film Like tone')
  } else if (compositorRgb && !gpu) {
    const tables = p.curve_premultiplied as number[][]
    if (!Array.isArray(tables) || tables.length !== 3
      || tables.some(row => !Array.isArray(row) || row.length !== 257 || !row.every(Number.isFinite)))
      throw new SourceCompositorUnsupported('RGB Curves requires its native CPU premultiplied tables')
    const premultiplied = makeTexture(tables)
    curved = vec3(...['r', 'g', 'b'].map((axis, index) => evaluate(balanced[axis], index, premultiplied,
      [slopes[index]![0]! * slopes[3]![0]!, slopes[index]![1]! * slopes[3]![1]!]))
    )
  } else {
    curved = vec3(...['r', 'g', 'b'].map((axis, index) => evaluate(evaluate(balanced[axis], 3), index)))
  }
  return vec4(mix(color.rgb, curved, compositorRgb ? clamp(factor, 0, 1) : factor),
    shaderRgb && !gpu ? 1 : color.a)
}

/** A complete graph builds or refuses; a partial branch never replaces Combined. */
export function buildSourceCompositor(
  program: SourceCompositorProgram,
  resolvePass: (pass: NonNullable<SourceCompositorOperation['pass']>) => TslEffectNode | null,
): BuiltSourceCompositor {
  const resources: { dispose(): void }[] = []
  const dispose = (): void => {
    for (const resource of resources.splice(0).reverse()) resource.dispose()
  }
  try {
    if (
      program.version !== 1 ||
      program.status !== 'extracted' ||
      !program.output ||
      program.ops.length > 2048
    ) {
      throw new SourceCompositorUnsupported(
        program.diagnostics
          .map((d) => `${d.path.join(' / ')} / ${d.node}: ${d.message}`)
          .join('; ') || 'Unsupported compositor graph',
      )
    }
    const nodes = new Map<string, TslEffectNode>()
    const singleValues = new Set<string>()
    const isSingleValue = (v: CompositorValue): boolean =>
      v.kind === 'constant' ||
      (v.kind === 'ref' && !!v.node && singleValues.has(v.node)) ||
      (v.kind === 'convert' && !!v.input && isSingleValue(v.input))
    function value(v: CompositorValue): TslEffectNode {
      if (v.kind === 'ref') {
        if (!v.node || !nodes.has(v.node))
          throw new SourceCompositorUnsupported('Compositor reference is missing or cyclic')
        return nodes.get(v.node)
      }
      if (v.kind === 'convert' && v.input) {
        const input = value(v.input)
        if (v.type === v.fromType) return input
        if (v.fromType === 'VALUE' && v.type === 'RGBA') return vec4(vec3(input), 1)
        if (v.fromType === 'RGBA' && v.type === 'VALUE')
          return dot(input.rgb, vec3(...(program.luminance ?? [0.2126, 0.7152, 0.0722])))
        if (v.fromType === 'RGBA' && v.type === 'VECTOR') return input.rgb
        if (v.fromType === 'VECTOR' && v.type === 'RGBA') return vec4(input, 1)
        if (v.fromType === 'VALUE' && v.type === 'VECTOR') return vec3(input)
        if (v.fromType === 'VECTOR' && v.type === 'VALUE') return dot(input, vec3(1 / 3))
        if (v.fromType === 'VALUE' && v.type === 'BOOLEAN') return input.greaterThan(0)
        if (v.fromType === 'BOOLEAN' && v.type === 'VALUE') return select(input, 1, 0)
        // Other conversions require Blender's compositor-specific semantics.
        throw new SourceCompositorUnsupported(
          `Compositor conversion ${v.fromType} to ${v.type} is unsupported`,
        )
      }
      if (v.kind === 'constant') {
        if (v.type === 'VALUE' && typeof v.value === 'number' && Number.isFinite(v.value))
          return float(v.value)
        if (v.type === 'BOOLEAN' && typeof v.value === 'boolean') return float(v.value ? 1 : 0).notEqual(0)
        if (v.type === 'VECTOR' && Array.isArray(v.value) && v.value.length === 3
          && v.value.every(n => typeof n === 'number' && Number.isFinite(n))) return vec3(...v.value)
        if (
          v.type === 'RGBA' &&
          Array.isArray(v.value) &&
          v.value.length === 4 &&
          v.value.every((n) => typeof n === 'number' && Number.isFinite(n))
        )
          return vec4(...v.value)
      }
      throw new SourceCompositorUnsupported(`Unsupported compositor value type ${v.type}`)
    }
    for (const op of program.ops) {
      const input = (name: string): TslEffectNode => {
        if (!op.inputs[name]) throw new SourceCompositorUnsupported(`Missing input ${name}`)
        return value(op.inputs[name]!.value)
      }
      const constant = (name: string): unknown => {
        const v = op.inputs[name]?.value
        if (v?.kind !== 'constant')
          throw new SourceCompositorUnsupported(`${name} requires a constant setting`)
        return v.value
      }
      let node: TslEffectNode
      try {
        switch (op.kind) {
          case 'blur': {
            if (
              constant('Type') !== 'Gaussian' ||
              constant('Extend Bounds') ||
              !constant('Separable')
            ) {
              throw new SourceCompositorUnsupported(
                'Blur supports separable Gaussian with Extend Bounds disabled',
              )
            }
            const size = constant('Size')
            if (
              !Array.isArray(size) ||
              size.length !== 2 ||
              !size.every((n) => typeof n === 'number')
            ) {
              throw new SourceCompositorUnsupported('Blur Size requires two constant pixel radii')
            }
            const weights = size.map(blenderGaussianWeights)
            node = input('Image')
            for (let axis = 0; axis < 2; axis++) {
              const taps = weights[axis]!
              if (taps.length === 1) continue
              const image = convertToTexture(node, null, null, {
                type: FloatType,
                depthBuffer: false,
              })
              if (image !== node) resources.push(image)
              const dimensions = textureSize(image)
              const center = ivec2(uv().mul(dimensions))
              const sample = (offset: number): TslEffectNode =>
                image.load(
                  clamp(
                    center.add(ivec2(axis === 0 ? offset : 0, axis === 1 ? offset : 0)),
                    ivec2(0),
                    ivec2(dimensions).sub(1),
                  ),
                )
              let sum = sample(0).mul(taps[0])
              for (let offset = 1; offset < taps.length; offset++)
                sum = sum.add(sample(-offset).add(sample(offset)).mul(taps[offset]))
              node = rtt(sum, null, null, { type: FloatType, depthBuffer: false })
              resources.push(node)
            }
            break
          }
          case 'glare': {
            const image = input('Image')
            // Blender skips the filter for a single-value image socket. A
            // spatially uniform texture is still an image and must be filtered.
            const imageValue = op.inputs.Image!.value
            if (isSingleValue(imageValue)) {
              node = op.source.output === 'Image' ? image : vec4(0)
              break
            }
            const smoothMin = (
              a: TslEffectNode,
              b: TslEffectNode,
              smoothing: TslEffectNode,
            ): TslEffectNode => {
              const safe = max(smoothing, 1e-20)
              const h = max(smoothing.sub(abs(a.sub(b))), 0).div(safe)
              return min(a, b).sub(h.mul(h).mul(smoothing).mul(0.25))
            }
            const threshold = max(input('Highlights Threshold'), 0)
            const upper = constant('Clamp Highlights')
              ? threshold.add(max(input('Maximum Highlights'), 0))
              : float(3.4028234663852886e38)
            const softness = max(input('Highlights Smoothness'), 0)
            const lowerSmoothness = min(min(softness, threshold), upper.sub(threshold))
            const upperSmoothness = min(min(softness, upper), upper.sub(threshold))
            const highlight = (color: TslEffectNode): TslEffectNode => {
              const hsv = blenderRgbToHsv(color.rgb) as TslEffectNode
              const value = smoothMin(
                upper,
                smoothMin(threshold.negate(), hsv.z.negate(), lowerSmoothness).negate(),
                upperSmoothness,
              ).sub(threshold)
              return vec4(blenderHsvToRgb(vec3(hsv.xy, value)), 1)
            }
            const highlightsOnly = op.source.output === 'Highlights'
            if (!highlightsOnly && constant('Type') !== 'Bloom')
              throw new SourceCompositorUnsupported(
                'Glare supports Bloom and the Highlights output; this mode needs a different spatial kernel',
              )
            const quality = constant('Quality')
            const qualityFactor =
              quality === 'High' ? 1 : quality === 'Medium' ? 2 : quality === 'Low' ? 4 : 0
            if (!qualityFactor)
              throw new SourceCompositorUnsupported(`Unknown Glare quality ${String(quality)}`)
            const size = constant('Size')
            if (typeof size !== 'number' || !Number.isFinite(size) || size < 0 || size > 1) {
              throw new SourceCompositorUnsupported(
                'Glare Size requires a constant between 0 and 1',
              )
            }
            const bloom = buildBlenderBloom(image, highlight, size, qualityFactor, highlightsOnly)
            resources.push(bloom)
            if (highlightsOnly) {
              node = bloom.node
              break
            }
            const bloomHsv = blenderRgbToHsv(bloom.node.rgb) as TslEffectNode
            const saturated = blenderHsvToRgb(
              vec3(
                bloomHsv.x,
                clamp(bloomHsv.y.mul(max(input('Saturation'), 0)), 0, 1),
                bloomHsv.z,
              ),
            )
            const adjusted = saturated.mul(input('Tint').rgb).mul(max(input('Strength'), 0))
            if (op.source.output === 'Glare') node = vec4(adjusted, 1)
            else if (op.source.output === 'Image')
              node = vec4(max(image.rgb, 0).add(adjusted), max(image.a, 0))
            else throw new SourceCompositorUnsupported(`Unknown Glare output ${op.source.output}`)
            break
          }
          case 'render-pass': {
            if (!op.pass) throw new SourceCompositorUnsupported('Missing render pass identity')
            node = resolvePass(op.pass)
            if (!node)
              throw new SourceCompositorUnsupported(
                `Render pass ${op.pass.viewLayer} / ${op.pass.name} needs a runtime pass provider`,
              )
            break
          }
          case 'rgb':
          case 'value':
            node = value({ kind: 'constant', type: op.type, value: op.value })
            break
          case 'exposure': {
            const color = input('Image')
            node = vec4(color.rgb.mul(pow(2, input('Exposure'))), color.a)
            break
          }
          case 'rgb-to-bw':
            node = dot(input('Image').rgb, vec3(...(program.luminance ?? [0.2126, 0.7152, 0.0722])))
            break
          case 'color-ramp': {
            const ramp = buildCompositorRamp(op, input('Fac'), isSingleValue(op.inputs.Fac!.value), resources)
            node = op.source.output === 'Alpha' ? ramp.a : ramp
            break
          }
          case 'curves':
            node = buildCompositorCurves(op, input,
              Object.values(op.inputs).every(input => isSingleValue(input.value)), resources)
            break
          case 'clamp': {
            const low = input('Min'), high = input('Max')
            if (op.properties.clamp_type === 'MINMAX') node = min(max(input('Value'), low), high)
            else if (op.properties.clamp_type === 'RANGE') node = clamp(input('Value'), min(low, high), max(low, high))
            else throw new SourceCompositorUnsupported('Clamp requires Min Max or Range mode')
            break
          }
          case 'map-range': {
            const vector = op.properties.data_type === 'FLOAT_VECTOR'
            if (op.properties.data_type !== 'FLOAT' && !vector)
              throw new SourceCompositorUnsupported('Map Range requires Float or Vector data')
            const interpolation = op.properties.interpolation_type
            if (!['LINEAR', 'STEPPED', 'SMOOTHSTEP', 'SMOOTHERSTEP'].includes(String(interpolation)))
              throw new SourceCompositorUnsupported('Map Range requires a verified interpolation mode')
            if (!['legacy', 'CPU', 'GPU'].includes(String(op.properties.map_range_model)))
              throw new SourceCompositorUnsupported('Map Range has no verified compositor model')
            const single = Object.values(op.inputs).every(input => isSingleValue(input.value))
            const model = op.properties.map_range_model === 'legacy' ? 'legacy'
              : single ? 'CPU' : op.properties.map_range_model
            const component = (axis?: string): TslEffectNode => {
              const part = (name: string): TslEffectNode => axis ? input(name)[axis] : input(name)
              const low = part('From Min'), high = part('From Max')
              const targetLow = part('To Min'), targetHigh = part('To Max')
              let factor = blenderDivide(part('Value').sub(low), high.sub(low))
              if (interpolation === 'STEPPED') {
                const steps = part('Steps')
                factor = blenderDivide(floor(factor.mul(steps.add(1))), steps)
              } else if (interpolation === 'SMOOTHSTEP' || interpolation === 'SMOOTHERSTEP') {
                const t = clamp(factor, 0, 1)
                factor = interpolation === 'SMOOTHSTEP' ? t.mul(t).mul(float(3).sub(t.mul(2)))
                  : t.mul(t).mul(t).mul(t.mul(t.mul(6).sub(15)).add(10))
              }
              let result = targetLow.add(factor.mul(targetHigh.sub(targetLow)))
              if (!vector && model === 'GPU') result = select(high.equal(low), 0, result)
              if (op.properties.clamp && ['LINEAR', 'STEPPED'].includes(String(interpolation)))
                result = clamp(result, min(targetLow, targetHigh), max(targetLow, targetHigh))
              if (model === 'legacy') result = select(high.equal(low), 0, result)
              return result
            }
            node = vector ? vec3(component('x'), component('y'), component('z')) : component()
            break
          }
          case 'gamma': {
            const color = input('Color')
            node = vec4(
              vec3(
                ...['r', 'g', 'b'].map((c) =>
                  select(color[c].greaterThan(0), pow(max(color[c], 0), input('Gamma')), color[c]),
                ),
              ),
              color.a,
            )
            break
          }
          case 'brightness-contrast': {
            if (op.properties.use_premultiply !== undefined && typeof op.properties.use_premultiply !== 'boolean')
              throw new SourceCompositorUnsupported('Brightness/Contrast requires a boolean premultiply setting')
            const color = input('Image'),
              brightness = input('Bright').div(100),
              contrast = input('Contrast').div(200)
            const positive = float(1).div(max(float(1).sub(contrast.mul(2)), 1.1920928955078125e-7))
            const negative = max(float(1).add(contrast.mul(2)), 0)
            const slope = select(contrast.greaterThan(0), positive, negative)
            const offset = select(
              contrast.greaterThan(0),
              slope.mul(brightness.sub(contrast)),
              slope.mul(brightness).sub(contrast),
            )
            const straight = op.properties.use_premultiply
              ? select(color.a.equal(0).or(color.a.equal(1)), color.rgb,
                color.rgb.div(select(color.a.equal(0), 1, color.a))) : color.rgb
            const changed = straight.mul(slope).add(offset)
            node = vec4(op.properties.use_premultiply ? changed.mul(color.a) : changed, color.a)
            break
          }
          case 'separate-color': {
            const color = input('Image')
            if (!['RGB', 'HSV', 'HSL', 'YUV', 'YCC'].includes(String(op.properties.mode)))
              throw new SourceCompositorUnsupported('Separate Color has an unknown color model')
            const channel = ({ Red: 'x', Green: 'y', Blue: 'z', Alpha: 'w',
              R: 'x', G: 'y', B: 'z', A: 'w', H: 'x', S: 'y', V: 'z',
              Y: 'x', U: 'y', Cb: 'y', Cr: 'z' } as Record<string, string>)[op.source.output]
            if (!channel) throw new SourceCompositorUnsupported('Separate Color has an unknown output channel')
            if (channel === 'w') { node = color.a; break }
            if (op.properties.mode === 'RGB') node = color[channel]
            else if (op.properties.mode === 'HSV') node = compositorRgbToHsv(color.rgb,
              isSingleValue(op.inputs.Image!.value) ? 'CPU' : op.properties.color_conversion_device)[channel]
            else if (op.properties.mode === 'HSL') {
              if (!['CPU', 'GPU'].includes(String(op.properties.color_conversion_device)))
                throw new SourceCompositorUnsupported('HSL separation has no verified compositor device')
              node = compositorRgbToHsl(color.rgb, isSingleValue(op.inputs.Image!.value)
                ? 'CPU' : op.properties.color_conversion_device)[channel]
            }
            else node = compositorYuvYcc(color.rgb, op.properties.mode, op.properties.ycc_mode, false)[channel]
            break
          }
          case 'combine-color': {
            const channels = vec3(input('Red'), input('Green'), input('Blue'))
            let color: TslEffectNode
            if (op.properties.mode === 'RGB') color = channels
            else if (op.properties.mode === 'HSV') {
              if (!['CPU', 'GPU'].includes(String(op.properties.color_conversion_device)))
                throw new SourceCompositorUnsupported('HSV combination has no verified compositor device')
              const single = Object.values(op.inputs).every(input => isSingleValue(input.value))
              color = compositorHsvToRgb(channels, single ? 'CPU' : op.properties.color_conversion_device)
              if (typeof op.properties.legacy_hsv_clamp !== 'boolean')
                throw new SourceCompositorUnsupported('HSV combination has no verified clamp model')
              if (op.properties.legacy_hsv_clamp) color = max(color, 0)
            } else if (op.properties.mode === 'HSL') {
              if (!['CPU', 'GPU'].includes(String(op.properties.color_conversion_device)))
                throw new SourceCompositorUnsupported('HSL combination has no verified compositor device')
              if (typeof op.properties.legacy_hsl_clamp !== 'boolean')
                throw new SourceCompositorUnsupported('HSL combination has no verified clamp model')
              const chroma = float(1).sub(abs(channels.z.mul(2).sub(1))).mul(channels.y)
              color = hueBasis(channels.x).sub(0.5).mul(chroma).add(channels.z)
              const single = Object.values(op.inputs).every(input => isSingleValue(input.value))
              if (op.properties.legacy_hsl_clamp || (!single && op.properties.color_conversion_device === 'GPU'))
                color = max(color, 0)
            } else if (op.properties.mode === 'YUV' || op.properties.mode === 'YCC') {
              color = compositorYuvYcc(channels, op.properties.mode, op.properties.ycc_mode, true)
            } else throw new SourceCompositorUnsupported('Combine Color has an unknown color model')
            node = vec4(color, input('Alpha'))
            break
          }
          case 'color-balance': {
            const model = op.properties.color_balance_model
            if (model !== 'linear' && model !== 'legacy-srgb')
              throw new SourceCompositorUnsupported('Color Balance has no verified color model')
            const color = input('Image')
            const mode = constant('Type')
            const product = (name: string): TslEffectNode => input('Color ' + name).rgb.mul(input('Base ' + name))
            const offset = (name: string): TslEffectNode => input('Color ' + name).rgb.add(input('Base ' + name))
            let balanced: TslEffectNode
            if (mode === 'Lift/Gamma/Gain') {
              // TSL select is scalar control flow, so transfer-function branch
              // decisions must be made independently for each color channel.
              const toSrgb = (linear: TslEffectNode): TslEffectNode => vec3(...['r', 'g', 'b'].map(c => select(
                linear[c].lessThan(0.0031308), max(linear[c], 0).mul(12.92),
                pow(max(linear[c], 0), 1 / 2.4).mul(1.055).sub(0.055),
              )))
              const toLinear = (srgb: TslEffectNode): TslEffectNode => vec3(...['r', 'g', 'b'].map(c => select(
                srgb[c].lessThan(0.04045), max(srgb[c], 0).div(12.92),
                pow(max(srgb[c].add(0.055).div(1.055), 0), 2.4),
              )))
              const source = model === 'legacy-srgb' ? toSrgb(color.rgb) : color.rgb
              const lifted = source.sub(1).mul(vec3(2).sub(offset('Lift'))).add(1)
              const gained = max(lifted.mul(product('Gain')), 0)
              const gamma = product('Gamma')
              const safeGamma = model === 'legacy-srgb'
                ? vec3(...['r', 'g', 'b'].map(c => select(gamma[c].equal(0), 1e-6, gamma[c])))
                : max(gamma, 1e-6)
              balanced = pow(model === 'legacy-srgb' ? toLinear(gained) : gained, vec3(1).div(safeGamma))
            } else if (mode === 'Offset/Power/Slope (ASC-CDL)') {
              balanced = pow(max(color.rgb.mul(product('Slope')).add(offset('Offset')), 0), product('Power'))
            } else {
              throw new SourceCompositorUnsupported('Color Balance supports Lift/Gamma/Gain and ASC-CDL; White Point needs a verified chromatic-adaptation mapping')
            }
            // Blender caps only the upper factor bound and preserves input alpha.
            node = vec4(mix(color.rgb, balanced, min(input('Fac'), 1)), color.a)
            break
          }
          case 'hue-saturation-value': {
            const color = input('Image'),
              hsv = blenderRgbToHsv(color.rgb) as TslEffectNode
            const changed = blenderHsvToRgb(
              vec3(
                fract(hsv.x.add(input('Hue')).sub(0.5)),
                hsv.y.mul(input('Saturation')),
                hsv.z.mul(input('Value')),
              ),
            )
            node = vec4(mix(color.rgb, max(changed, 0), input('Fac')), color.a)
            break
          }
          case 'mix-rgb':
          case 'mix': {
            const modern = op.kind === 'mix'
            const data = modern ? op.properties.data_type : 'RGBA'
            if (!['RGBA', 'FLOAT', 'VECTOR'].includes(String(data)))
              throw new SourceCompositorUnsupported('Mix requires a verified Float, Vector or Color socket model')
            const suffix = data === 'FLOAT' ? 'Float' : data === 'VECTOR' ? 'Vector' : 'Color'
            const nonuniform = data === 'VECTOR' && op.properties.factor_mode === 'NON_UNIFORM'
            let factor = input(modern ? nonuniform ? 'Factor_Vector' : 'Factor_Float' : 'Fac')
            const legacy = op.source.nodeType === 'CompositorNodeMixRGB'
            if ((!modern && !legacy) || (modern && op.properties.clamp_factor)) factor = clamp(factor, 0, 1)
            const a = input(modern ? 'A_' + suffix : 'Color1'), b = input(modern ? 'B_' + suffix : 'Color2')
            if (data !== 'RGBA') node = mix(a, b, factor)
            else {
              if (legacy && op.properties.use_alpha) factor = factor.mul(b.a)
              const single = Object.values(op.inputs).every(input => isSingleValue(input.value))
              const device = single ? 'CPU' : op.properties.color_conversion_device
              const mode = String(op.properties.blend_type)
              const rgb = compositorBlend(mode, device, legacy)(a.rgb, b.rgb, factor)
              const alpha = mode === 'MIX' && (modern || (!legacy && device === 'CPU')) ? mix(a.a, b.a, factor) : a.a
              node = vec4(rgb, alpha)
              if (op.properties.use_clamp || op.properties.clamp_result)
                node = !modern && !legacy && device === 'GPU' ? vec4(clamp(rgb, 0, 1), 0) : clamp(node, 0, 1)
            }
            break
          }
          case 'invert': {
            const color = input('Color'),
              factor = input('Fac')
            const rgb = select(input('Invert Color'), mix(color.rgb, vec3(1).sub(color.rgb), factor), color.rgb)
            const alpha = select(input('Invert Alpha'), mix(color.a, float(1).sub(color.a), factor), color.a)
            node = vec4(rgb, alpha)
            break
          }
          case 'math': {
            if (op.properties.operation === 'POWER') {
              const first = op.inputs.Value?.value, second = op.inputs.Value_001?.value
              if (first?.kind === 'constant' && first.value === 0 && second?.kind === 'constant'
                  && typeof second.value === 'number' && second.value < 0) {
                throw new SourceCompositorUnsupported('Zero raised to a negative power produces non-finite compositor pixels in Blender')
              }
            }
            if (op.source.nodeType === 'CompositorNodeMath' && op.properties.operation === 'LOGARITHM') {
              const base = constant('Value_001')
              if (typeof base !== 'number' || !Number.isFinite(base) || base === 1) {
                throw new SourceCompositorUnsupported('Legacy compositor Logarithm requires a fixed base other than 1; Blender can produce non-finite pixels')
              }
            }
            try {
              node = buildTslMathOperation(
                String(op.properties.operation), input('Value'),
                () => input('Value_001'), () => input('Value_002'),
              )
            } catch (error) {
              throw new SourceCompositorUnsupported(error instanceof Error ? error.message : String(error))
            }
            const legacyMath = op.source.nodeType === 'CompositorNodeMath'
            if (op.properties.operation === 'ROUND') {
              const a = input('Value')
              // Legacy compositor roundf uses half-away; modern shared Math
              // uses floor(x + .5). Preserve the authored Blender model.
              const magnitude = floor(abs(a).add(.5))
              node = legacyMath ? select(a.lessThan(0), magnitude.negate(), magnitude) : floor(a.add(.5))
            } else if (legacyMath && ['ARCSINE', 'ARCCOSINE'].includes(String(op.properties.operation))) {
              node = select(abs(input('Value')).greaterThan(1), 0, node)
            }
            if (op.properties.use_clamp) node = clamp(node, 0, 1)
            break
          }
          case 'alpha-over': {
            const back = input('Background'),
              front = input('Foreground'),
              factor = input('Fac')
            if (op.properties.alpha_over_model === 'legacy') {
              const premul = op.properties.legacy_premul, straight = op.properties.legacy_straight
              if (typeof premul !== 'number' || !Number.isFinite(premul) || premul < 0 || premul > 1 || typeof straight !== 'boolean')
                throw new SourceCompositorUnsupported('Legacy Alpha Over requires verified premultiply settings')
              node = legacyAlphaOver(back, front, factor, float(premul), float(straight ? 1 : 0).notEqual(0))
            } else {
              const compose = alphaOverFunctions[String(constant('Type'))]
              if (!compose) throw new SourceCompositorUnsupported('Alpha Over requires Over, Disjoint Over or Conjoint Over mode')
              node = compose(back, front, factor, input('Straight Alpha'))
            }
            break
          }
          default:
            throw new SourceCompositorUnsupported(
              `Compositor ${op.kind} is not supported by this runtime`,
            )
        }
      } catch (error) {
        if (error instanceof SourceCompositorUnsupported)
          throw new SourceCompositorUnsupported(
            `${op.source.path.join(' / ')} / ${op.source.node} [${op.source.output}]: ${error.message}`,
          )
        throw error
      }
      nodes.set(op.id, node)
      if (
        op.kind !== 'render-pass' &&
        Object.values(op.inputs).every((input) => isSingleValue(input.value))
      )
        singleValues.add(op.id)
    }
    return { node: value(program.output), dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
