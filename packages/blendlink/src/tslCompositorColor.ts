import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, bitcast, clamp, dot, float, fract, max, min, mix, pow, select, uint, vec3, vec4 } = TSL as unknown as Record<
  'Fn' | 'bitcast' | 'clamp' | 'dot' | 'float' | 'fract' | 'max' | 'min' | 'mix' | 'pow' | 'select' | 'uint' | 'vec3' | 'vec4',
  (...args: TslEffectNode[]) => TslEffectNode
>

// CPU division also precedes discontinuous Posterize bins and tonal regions.
// GPU reciprocal approximations can cross those boundaries by one step. A
// split product recovers the division residual, without an arbitrary epsilon
// that would move genuinely neighboring image values across the boundary.
const compositorCpuDivision = Fn(([value, divisor]: TslEffectNode[]) => {
  const quotient = value.div(divisor).toVar()
  const product = quotient.mul(divisor).toVar()
  const highQ = vec3(...['r', 'g', 'b'].map(channel =>
    bitcast(bitcast(quotient[channel], 'uint').bitAnd(uint(0xfffff000)), 'float'))).toVar()
  const highD = bitcast(bitcast(divisor, 'uint').bitAnd(uint(0xfffff000)), 'float').toVar()
  const lowQ = quotient.sub(highQ).toVar(), lowD = divisor.sub(highD).toVar()
  const error = highQ.mul(highD).sub(product).add(highQ.mul(lowD)).add(lowQ.mul(highD)).add(lowQ.mul(lowD)).toVar()
  return quotient.add(value.sub(product).sub(error).div(divisor))
}).setLayout({ name: 'blendlinkCompositorCpuDivide', type: 'vec3', inputs: [
  { name: 'value', type: 'vec3' }, { name: 'divisor', type: 'float' },
] })

export interface CompositorColorOptions {
  device: unknown
  luminance: readonly number[]
  rgbToHsv(color: TslEffectNode): TslEffectNode
  hsvToRgb(color: TslEffectNode): TslEffectNode
  fail(message: string): never
}

/** Native pointwise color operations; the caller supplies its proven device
 * conversion functions and working-space luminance coefficients. */
export function buildCompositorColorOperation(op: SourceCompositorOperation,
  input: (name: string) => TslEffectNode, options: CompositorColorOptions): TslEffectNode {
  if (op.kind === 'exposure') {
    return Fn(() => {
      const color = input('Image').toVar()
      return vec4(color.rgb.mul(pow(2, input('Exposure'))), color.a)
    })()
  }
  if (op.kind === 'posterize') {
    return Fn(() => {
      const color = input('Image').toVar(), steps = clamp(input('Steps'), 2, 1024).toVar()
      if (op.properties.legacy_posterize_reciprocal && options.device === 'CPU') {
        const inverse = float(1).div(steps).toVar()
        return vec4(compositorCpuDivision(color.rgb, inverse).floor().mul(inverse), color.a)
      }
      return vec4(color.rgb.mul(steps).floor().div(steps), color.a)
    })()
  }
  if (op.kind === 'hue-saturation-value') {
    if (!['CPU', 'GPU'].includes(String(options.device))) options.fail('Hue/Saturation has no verified compositor device')
    return Fn(() => {
      const color = input('Image').toVar(), hsv = options.rgbToHsv(color.rgb).toVar()
      const shifted = hsv.x.add(input('Hue').sub(0.5))
      const hue = op.properties.legacy_hue_wrap && options.device === 'CPU'
        ? select(shifted.greaterThan(1), shifted.sub(1), select(shifted.lessThan(0), shifted.add(1), shifted))
        : fract(hsv.x.add(input('Hue')).add(0.5))
      const changed = options.hsvToRgb(vec3(hue, hsv.y.mul(input('Saturation')), hsv.z.mul(input('Value'))))
      return vec4(mix(color.rgb, max(changed, 0), input('Fac')), color.a)
    })()
  }
  if (op.kind !== 'color-correction') return options.fail('Unknown native pointwise color operation ' + op.kind)
  const model = op.properties.color_correction_model
  if (model !== 'legacy' && model !== 'modern') options.fail('Color Correction has no verified negative-color model')
  return Fn(() => {
    const color = input('Image').toVar()
    const rg = color.r.add(color.g).toVar(), sum = rg.add(color.b).toVar()
    const level = (options.device === 'CPU' ? compositorCpuDivision(vec3(sum), float(3)).x : sum.div(3)).toVar()
    const start = input('Midtones Start').toVar(), end = input('Midtones End').toVar()
    const rising = level.sub(start).mul(5).add(0.5), falling = level.sub(end).mul(5).add(0.5)
    const weights = select(level.lessThan(start.sub(0.1)), vec3(1, 0, 0),
      select(level.lessThan(start.add(0.1)), vec3(float(1).sub(rising), rising, 0),
        select(level.lessThan(end.sub(0.1)), vec3(0, 1, 0),
          select(level.lessThan(end.add(0.1)), vec3(0, float(1).sub(falling), falling), vec3(0, 0, 1))))).toVar()
    const region = (name: string): TslEffectNode => weights.x.mul(input('Shadows ' + name))
      .add(weights.y.mul(input('Midtones ' + name))).add(weights.z.mul(input('Highlights ' + name)))
    const saturation = region('Saturation').mul(input('Master Saturation')).toVar()
    const contrast = region('Contrast').mul(input('Master Contrast')).toVar()
    const gamma = region('Gamma').mul(input('Master Gamma')).toVar()
    const gain = region('Gain').mul(input('Master Gain')).toVar()
    const offset = region('Offset').add(input('Master Offset')).toVar()
    const luma = dot(color.rgb, vec3(...options.luminance)).toVar()
    const contrasted = color.rgb.sub(luma).mul(saturation).add(luma).sub(0.5).mul(contrast).add(0.5).toVar()
    const changed = contrasted.mul(gain).add(offset).toVar()
    const base = (model === 'modern' ? max(min(color.rgb, 0), changed) : changed).toVar()
    const inverseGamma = float(1).div(gamma).toVar()
    const fallback = model === 'modern' ? base : contrasted
    const corrected = vec3(...['r', 'g', 'b'].map(channel => {
      const invalid = model === 'modern' ? base[channel].lessThan(0)
        .or(base[channel].equal(0).and(inverseGamma.lessThanEqual(0))) : base[channel].lessThan(0)
      return select(invalid, fallback[channel], pow(select(invalid, 1, max(base[channel], 0)), inverseGamma))
    }))
    const masked = mix(color.rgb, corrected, min(input('Mask'), 1)).toVar()
    return vec4(select(input('Apply On Red'), masked.r, color.r),
      select(input('Apply On Green'), masked.g, color.g), select(input('Apply On Blue'), masked.b, color.b), color.a)
  })()
}
