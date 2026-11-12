import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, max, min, vec3, vec4 } = TSL as unknown as Record<
  'Fn' | 'max' | 'min' | 'vec3' | 'vec4', (...values: TslEffectNode[]) => TslEffectNode>

/** Independent spill suppression. Legacy CPU clamps only the upper factor
 * and scales the whole channel difference; modern/GPU scale the spill leg. */
export function buildCompositorSpill(op: SourceCompositorOperation,
  input: (name: string) => TslEffectNode, device: unknown, fail: (message: string) => never): TslEffectNode {
  const p = op.properties, channels = ['R','G','B'], spill = channels.indexOf(String(p.spill_channel))
  const limit = channels.indexOf(String(p.spill_limit_channel)), ratio = p.spill_ratio
  const custom = p.spill_custom_strength
  if (p.spill_model !== 'native-color-spill-v1' || !['legacy','modern'].includes(String(p.spill_schema))
    || !['CPU','GPU'].includes(String(device)) || spill < 0 || limit < 0
    || !['Single','Average'].includes(String(p.spill_limit_method))
    || typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 2
    || custom !== null && (!Array.isArray(custom) || custom.length !== 3
      || !custom.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 2)))
    return fail('Color Spill requires its verified native model and finite fixed controls')
  const selected = p.spill_limit_method === 'Average' ? [(spill + 1) % 3, (spill + 2) % 3] : [limit, limit]
  const scale = custom === null ? [0,0,0] : [...custom]
  scale[spill] = custom === null ? -1 : -scale[spill]!
  return Fn(() => {
    const color = input('Image').toVar(), parts = [color.r, color.g, color.b], factor = input('Fac')
    const average = parts[selected[0]!]!.add(parts[selected[1]!]!).mul(.5)
    const bound = average.mul(ratio)
    const excess = p.spill_schema === 'legacy' && device === 'CPU'
      ? min(factor, 1).mul(parts[spill]!.sub(bound)) : factor.mul(parts[spill]!).sub(bound)
    return vec4(color.rgb.add(vec3(...scale).mul(max(excess, 0))), color.a)
  })()
}
