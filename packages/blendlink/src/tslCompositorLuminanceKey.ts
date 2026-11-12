import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, clamp, dot, min, select, vec3 } = TSL as unknown as Record<
  'Fn' | 'clamp' | 'dot' | 'min' | 'select' | 'vec3', (...values: TslEffectNode[]) => TslEffectNode>

/** Independent expression for the authored luminance ramp and alpha cap.
 * The legacy CPU compositor tests the endpoints before dividing; modern
 * schemas and the legacy GPU use the clamped ramp, including reversed limits. */
export function buildCompositorLuminanceKey(op: SourceCompositorOperation,
  image: TslEffectNode, coefficients: readonly number[], fail: (message: string) => never): TslEffectNode {
  const limits = op.properties.luminance_key_limits, schema = op.properties.luminance_key_schema
  if (op.properties.luminance_key_model !== 'native-luminance-key-v1'
    || !['legacy-branch', 'linear-ramp'].includes(String(schema))
    || !Array.isArray(limits) || limits.length !== 2
    || !limits.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
    || Math.abs(limits[1] - limits[0]) < 1 / 64)
    return fail('Luminance Key requires its native model and fixed [0,1] thresholds separated by at least 1/64')
  if (coefficients.length !== 3 || !coefficients.every(value => Number.isFinite(value)))
    return fail('Luminance Key requires finite source luminance coefficients')
  if (!['Image', 'Matte'].includes(op.source.output)) return fail('Luminance Key requires Image or Matte output')
  return Fn(() => {
    const color = image.toVar(), luminance = dot(color.rgb, vec3(...coefficients)).toVar()
    const ramp = luminance.sub(limits[0]).div(limits[1] - limits[0])
    const alpha = schema === 'legacy-branch'
      ? select(luminance.greaterThan(limits[1]), 1, select(luminance.lessThan(limits[0]), 0, ramp))
      : clamp(ramp, 0, 1)
    const matte = min(alpha, color.a).toVar()
    return op.source.output === 'Matte' ? matte : color.mul(matte)
  })()
}
