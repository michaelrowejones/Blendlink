import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { buildCompositorCpuLuminanceKey } from './tslCompositorCpuLuminanceKey.js'

const { Fn, clamp, dot, min, select, vec3 } = TSL as unknown as Record<
  'Fn' | 'clamp' | 'dot' | 'min' | 'select' | 'vec3', (...values: TslEffectNode[]) => TslEffectNode>

export const CPU_LUMINANCE_KEY_MODEL = 'native-luminance-key-cpu-rne-v1'

function cpuProfile(value: unknown, version: readonly number[], sourceBuild: unknown): 'gradual-rne' | 'ftz-daz-rne' | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const p = value as Record<string, unknown>
  const keys = ['schemaVersion', 'mode', 'underflowWord', 'denormalInputWord', 'tieWords', 'sourcePlatform', 'sourceArchitecture']
  if (Object.keys(p).length !== keys.length || !keys.every(key => Object.hasOwn(p, key)) || p.schemaVersion !== 1
    || !Array.isArray(p.tieWords) || p.tieWords.length !== 2 || ![0x3f800000, 0x3f800002].every((word, index) =>
      Object.hasOwn(p.tieWords as number[], index) && (p.tieWords as number[])[index] === word)
    || !(p.sourcePlatform === 'darwin' && p.sourceArchitecture === 'arm64'
      || p.sourcePlatform === 'linux' && p.sourceArchitecture === 'x86_64'
        && version[0] === 5 && version[1] === 2 && version[2] === 0 && sourceBuild === 'fbe6228777e7')) return null
  if (p.mode === 'gradual-rne' && p.underflowWord === 0x00400000 && p.denormalInputWord === 0x00800000) return p.mode
  if (p.mode === 'ftz-daz-rne' && p.underflowWord === 0 && p.denormalInputWord === 0) return p.mode
  return null
}

/** Independent expression for the authored luminance ramp and alpha cap.
 * The legacy CPU compositor tests the endpoints before dividing; modern
 * schemas and the legacy GPU use the clamped ramp, including reversed limits. */
export function buildCompositorLuminanceKey(op: SourceCompositorOperation,
  image: TslEffectNode, coefficients: readonly number[], fail: (message: string) => never, device?: unknown): TslEffectNode {
  const limits = op.properties.luminance_key_limits, schema = op.properties.luminance_key_schema
  const cpu = op.properties.luminance_key_model === CPU_LUMINANCE_KEY_MODEL
  if ((!cpu && op.properties.luminance_key_model !== 'native-luminance-key-v1')
    || !['legacy-branch', 'linear-ramp'].includes(String(schema))
    || !Array.isArray(limits) || limits.length !== 2
    || ![0, 1].every(index => Object.hasOwn(limits, index) && typeof limits[index] === 'number'
      && Number.isFinite(limits[index]) && limits[index] >= 0 && limits[index] <= 1)
    || Math.abs(limits[1] - limits[0]) < 1 / 64)
    return fail('Luminance Key requires its native model and fixed [0,1] thresholds separated by at least 1/64')
  if (coefficients.length !== 3 || !coefficients.every(value => Number.isFinite(value)))
    return fail('Luminance Key requires finite source luminance coefficients')
  if (!['Image', 'Matte'].includes(op.source.output)) return fail('Luminance Key requires Image or Matte output')
  if (cpu) {
    const version = op.properties.luminance_key_source_version, stored = op.properties.luminance_key_coefficients
    if (!Array.isArray(version) || version.length !== 3 || ![[4, 2, 0], [5, 2, 0], [5, 3, 0]].some(
      known => known.every((part, index) => Object.hasOwn(version, index) && version[index] === part))
      || device !== 'CPU' || !['CPU', 'GPU'].includes(String(op.properties.evaluation_device))
      || op.properties.evaluation_device === 'GPU' && (version[0] === 4 || op.properties.single_value_device !== 'CPU'))
      return fail('Luminance Key CPU precision requires its measured source version and actual CPU evaluator')
    const known = [.2126, .7152, .0722].map(Math.fround)
    if (!Array.isArray(stored) || stored.length !== 3 || !known.every((value, index) =>
      Object.hasOwn(stored, index) && stored[index] === value && Math.fround(coefficients[index]!) === value))
      return fail('Luminance Key CPU precision requires its measured source Rec.709 coefficients')
    const profile = cpuProfile(op.properties.luminance_key_cpu_profile, version as number[], op.properties.luminance_key_source_build)
    if (profile === null || profile !== (version[0] === 5 && version[1] === 3 ? 'ftz-daz-rne' : 'gradual-rne')) return fail('Luminance Key CPU precision requires its verified Float32 mode certificate')
    const output = op.source.output, [low, high] = limits.map(Math.fround)
    if (schema === 'legacy-branch' && (version[0] !== 4 || low! >= high!) || version[0] === 4 && schema !== 'legacy-branch')
      return fail('Legacy Luminance Key CPU precision requires its ordered native thresholds')
    if (op.type !== (output === 'Matte' ? 'VALUE' : 'RGBA') || op.inputs.Image?.value.type !== 'RGBA')
      return fail('Luminance Key CPU precision requires native Color input and matching output types')
    return buildCompositorCpuLuminanceKey(image, [low!, high!], output as 'Image' | 'Matte', profile)
  }
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
