import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, abs, float, max, min, select } = TSL as unknown as Record<
  'Fn' | 'abs' | 'float' | 'max' | 'min' | 'select', (...values: TslEffectNode[]) => TslEffectNode>

/** Strict HSV keying, with the legacy CPU hue-wrap stage kept separate. */
export function buildCompositorColorKey(op: SourceCompositorOperation,
  input: (name: string) => TslEffectNode, device: unknown,
  rgbToHsv: (color: TslEffectNode) => TslEffectNode, fail: (message: string) => never): TslEffectNode {
  const p = op.properties, settings = p.color_key_settings
  if (device !== 'CPU' || p.evaluation_device !== 'CPU')
    return fail('Color Key currently requires CPU source compositing; native GPU hue threshold precision remains unported')
  if (p.color_key_model !== 'native-color-key-cpu-v1' || !['legacy', 'modern'].includes(String(p.color_key_schema))
    || !Array.isArray(settings) || settings.length !== 3
    || !settings.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 && (x === 0 || x >= 2 ** -126))
    || !['Image', 'Matte'].includes(op.source.output))
    return fail('Color Key requires its verified native model and finite fixed thresholds')
  const [hue, saturation, value] = settings as number[]
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
