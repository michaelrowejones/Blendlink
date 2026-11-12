import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, clamp, fract, max, mix, vec3, vec4 } = TSL as unknown as Record<
  'Fn' | 'clamp' | 'fract' | 'max' | 'mix' | 'vec3' | 'vec4', (...args: TslEffectNode[]) => TslEffectNode
>

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
  const clip = op.properties.curve_clip_y
  if (!Array.isArray(clip) || clip.length !== 2 || !clip.every(Number.isFinite) || clip[0] > clip[1])
    options.fail('Hue Correct requires finite curve clipping limits')
  return Fn(() => {
    const color = input('Image').toVar(), hsv = options.rgbToHsv(color.rgb).toVar()
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
