import * as TSL from 'three/tsl'
import { compositorGrayscale } from './tslCompositorGray.js'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, abs, distance, float, max, min, select } = TSL as unknown as Record<
  'Fn' | 'abs' | 'distance' | 'float' | 'max' | 'min' | 'select', (...values: TslEffectNode[]) => TslEffectNode>

/** Strict HSV keying, with the legacy CPU hue-wrap stage kept separate. */
export function buildCompositorColorKey(op: SourceCompositorOperation,
  input: (name: string) => TslEffectNode, device: unknown,
  rgbToHsv: (color: TslEffectNode) => TslEffectNode, fail: (message: string) => never, operations: readonly SourceCompositorOperation[] = []): TslEffectNode {
  const p = op.properties, settings = p.color_key_settings
  const gpuModel = p.color_key_model === 'native-color-key-gray-v1' || p.color_key_model === 'native-color-key-dead-v1'
  if (!gpuModel && (device !== 'CPU' || p.evaluation_device !== 'CPU'))
    return fail('Color Key currently requires CPU source compositing; native GPU hue threshold precision remains unported')
  if ((gpuModel ? p.evaluation_device !== 'GPU' || !['CPU', 'GPU'].includes(String(device)) : p.color_key_model !== 'native-color-key-cpu-v1') || !['legacy', 'modern'].includes(String(p.color_key_schema))
    || !Array.isArray(settings) || settings.length !== 3
    || !settings.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 && (x === 0 || x >= 2 ** -126))
    || !['Image', 'Matte'].includes(op.source.output))
    return fail('Color Key requires its verified native model and finite fixed thresholds')
  const [hue, saturation, value] = settings as number[]
  if (gpuModel) {
    const dead = saturation === 0 || value === 0
    if (p.color_key_model === 'native-color-key-dead-v1' && !dead)
      return fail('Color Key dead predicate requires an exact zero Saturation or Value threshold')
    if (p.color_key_model === 'native-color-key-gray-v1' && (!op.inputs.Image || !op.inputs['Key Color'] ||
      !compositorGrayscale(op.inputs.Image.value, operations) || !compositorGrayscale(op.inputs['Key Color'].value, operations)))
      return fail('Color Key GPU grayscale model requires independently proven replicated scalar RGB inputs')
    if (p.color_key_model === 'native-color-key-gray-v1' && hue! > 0 && hue! < 2 ** -125)
      return fail('Color Key GPU grayscale Hue must be zero or at least 2^-125 so its half threshold remains normal')
    return Fn(() => {
      const color = input('Image').toVar()
      if (dead || hue === 0) return op.source.output === 'Matte' ? color.a : color.mul(color.a)
      const key = input('Key Color').toVar()
      const keyed = distance(color.r, key.r).lessThan(value)
      const matte = select(keyed, 0, color.a).toVar()
      return op.source.output === 'Matte' ? matte : color.mul(matte)
    })()
  }
  return Fn(() => {
    const color = input('Image').toVar(), key = input('Key Color').toVar()
    const a = rgbToHsv(color.rgb).toVar(), b = rgbToHsv(key.rgb).toVar()
    const difference = abs(a.x.sub(b.x)).toVar()
    const hueMatch = p.color_key_schema === 'legacy' && device === 'CPU'
      ? difference.mul(2).lessThan(hue).or(float(2).sub(difference.mul(2)).lessThan(hue))
      : difference.lessThan(hue! * .5).or(min(a.x, b.x).add(float(1).sub(max(a.x, b.x))).lessThan(hue! * .5))
    const keyed = hueMatch.and(abs(a.y.sub(b.y)).lessThan(saturation)).and(abs(a.z.sub(b.z)).lessThan(value))
    const matte = select(keyed, 0, color.a).toVar()
    return op.source.output === 'Matte' ? matte : color.mul(matte)
  })()
}
