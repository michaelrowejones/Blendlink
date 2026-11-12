import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { compositorCpuDivision } from './tslCompositorColor.js'

const { Fn, clamp, float, fract, max, min, mix, select, vec3, vec4 } = TSL as unknown as Record<
  'Fn' | 'clamp' | 'float' | 'fract' | 'max' | 'min' | 'mix' | 'select' | 'vec3' | 'vec4', (...args: TslEffectNode[]) => TslEffectNode
>

// Native GLSL uses rounded hue division before a potentially steep curve.
// Multiplying by a rounded reciprocal changes 3.5/6 by one ULP, amplified by
// the lookup; the existing split-product division preserves that boundary.
function openGlHsv(rgb: TslEffectNode): TslEffectNode {
  const high = max(rgb.r, max(rgb.g, rgb.b)), low = min(rgb.r, min(rgb.g, rgb.b)), delta = high.sub(low)
  const saturation = select(high.equal(0), 0, delta.div(select(high.equal(0), 1, high)))
  const safeDelta = select(delta.equal(0), 1, delta)
  const cr = high.sub(rgb.r).div(safeDelta), cg = high.sub(rgb.g).div(safeDelta), cb = high.sub(rgb.b).div(safeDelta)
  const numerator = select(rgb.r.equal(high), cb.sub(cg),
    select(rgb.g.equal(high), float(2).add(cr).sub(cb), float(4).add(cg).sub(cr)))
  const raw = compositorCpuDivision(vec3(numerator), float(6)).x
  return vec3(select(saturation.equal(0), 0, select(raw.lessThan(0), raw.add(1), raw)), saturation, high)
}

export function buildCompositorHueCorrect(op: SourceCompositorOperation,
  input: (name: string) => TslEffectNode, options: {
    gpu: boolean
    evaluateCurve(parameter: TslEffectNode, channel: number): TslEffectNode
    rgbToHsv(color: TslEffectNode): TslEffectNode
    hsvToRgb(color: TslEffectNode): TslEffectNode
    fail(message: string): never
  }): TslEffectNode {
  if (op.properties.hue_correct_model !== 'native-curves-v1' || typeof op.properties.curve_clip !== 'boolean')
    options.fail('Hue Correct requires its native curve and clipping model')
  const samplingModel = op.properties.hue_curve_sampling_model
  if (samplingModel !== undefined && (samplingModel !== 'opengl-normalized-f32-v1'
    || op.properties.native_gpu_backend !== 'OPENGL'))
    options.fail('Hue Correct has no verified native curve sampling model')
  const clip = op.properties.curve_clip_y
  if (!Array.isArray(clip) || clip.length !== 2 || !clip.every(Number.isFinite) || clip[0] > clip[1])
    options.fail('Hue Correct requires finite curve clipping limits')
  return Fn(() => {
    const color = input('Image').toVar()
    const hsv = (options.gpu && samplingModel === 'opengl-normalized-f32-v1' ? openGlHsv(color.rgb)
      : options.rgbToHsv(color.rgb)).toVar()
    // Every curve is parameterized by the original hue, before its correction.
    const evaluate = (channel: number): TslEffectNode => {
      const value = options.evaluateCurve(hsv.x, channel)
      return !options.gpu && op.properties.curve_clip ? clamp(value, clip[0], clip[1]) : value
    }
    const adjusted = vec3(fract(hsv.x.add(evaluate(0)).sub(0.5)),
      clamp(hsv.y.mul(evaluate(1)).mul(2), 0, 1), hsv.z.mul(evaluate(2)).mul(2))
    const changed = max(options.hsvToRgb(adjusted), 0)
    return vec4(mix(color.rgb, changed, input('Fac')), color.a)
  })()
}
