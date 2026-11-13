import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { compositorCpuDistanceRatio } from './tslCompositorCpuDistanceRatio.js'

const { Fn, abs, bitcast, float, max, min, select, uint } = TSL as unknown as Record<
  'Fn' | 'abs' | 'bitcast' | 'float' | 'max' | 'min' | 'select' | 'uint', (...values: TslEffectNode[]) => TslEffectNode>

const rounded = (value: TslEffectNode): TslEffectNode => {
  const word = bitcast(value, 'uint').toVar()
  return bitcast(select(word.equal(uint(0x7fc00000)), uint(0), word), 'float').toVar()
}

export const DIFFERENCE_KEY_RNE_MODEL = 'native-difference-key-rne-v1'
export const DIFFERENCE_KEY_CPU_EXACT_MODEL = 'native-difference-key-cpu-exact-v2'
const measuredRneProfile:Record<string,string|number[]>={
  platform:'linux',architecture:'x86_64',blenderVersion:[5,2,0],blenderHash:'fbe6228777e7',
  requestedBackend:'OPENGL',renderer:'llvmpipe (LLVM 20.1.2, 256 bits)',vendor:'Mesa',
  version:'4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4',deviceType:'SOFTWARE',backend:'OPENGL',
}
/** The native context fields are rechecked independently from source emission.
 * A backend label or a claimed software-rendering flag is not this profile. */
export function isMeasuredDifferenceRneProfile(value:unknown):boolean {
  if(!value || typeof value!=='object' || Array.isArray(value))return false
  const profile=value as Record<string,unknown>
  if(Object.keys(profile).length!==Object.keys(measuredRneProfile).length)return false
  return Object.entries(measuredRneProfile).every(([key,expected])=>{
    if(!Object.hasOwn(profile,key))return false
    const actual=profile[key]
    return Array.isArray(expected)?Array.isArray(actual) && actual.length===expected.length
      && expected.every((part,index)=>Object.hasOwn(actual,index) && typeof actual[index]==='number'
        && Number.isInteger(actual[index]) && actual[index]===part):actual===expected
  })
}

/** Fixed positive divisor, with a two-sum residual correction. GPU reciprocal
 * multiplication can place a /3 result one ULP above the native CPU boundary.
 * Clipping individual distances to12 preserves every key decision (the
 * greatest threshold sum is2) and bounds all correction intermediates. */
const legacyMean = Fn(([red, green, blue]: TslEffectNode[]) => {
  const sum = rounded(rounded(min(red, 12).add(min(green, 12))).add(min(blue, 12)))
  const quotient = rounded(sum.div(3)), twice = rounded(quotient.mul(2))
  const product = rounded(twice.add(quotient)), bridge = rounded(product.sub(twice))
  const error = rounded(rounded(twice.sub(rounded(product.sub(bridge)))).add(rounded(quotient.sub(bridge))))
  const residual = rounded(rounded(sum.sub(product)).sub(error))
  return rounded(quotient.add(rounded(residual.div(3))))
}).setLayout({ name: 'blendlinkLegacyDifferenceMeanV1', type: 'float', inputs: [
  { name: 'red', type: 'float' }, { name: 'green', type: 'float' }, { name: 'blue', type: 'float' },
] })

/** This measured GPU dot3 reduces r+(g+b). Native modern constant inputs
 * fold through CPU instead and retain the original left-associated mean. */
const llvmpipeMean = Fn(([red, green, blue]: TslEffectNode[]) => {
  const sum = rounded(min(red, 12).add(rounded(min(green, 12).add(min(blue, 12)))))
  const quotient = rounded(sum.div(3)), twice = rounded(quotient.mul(2))
  const product = rounded(twice.add(quotient)), bridge = rounded(product.sub(twice))
  const error = rounded(rounded(twice.sub(rounded(product.sub(bridge)))).add(rounded(quotient.sub(bridge))))
  const residual = rounded(rounded(sum.sub(product)).sub(error))
  return rounded(quotient.add(rounded(residual.div(3))))
}).setLayout({ name: 'blendlinkLlvmPipeDifferenceMeanV1', type: 'float', inputs: [
  { name: 'red', type: 'float' }, { name: 'green', type: 'float' }, { name: 'blue', type: 'float' },
] })

/** Fresh CPU profile only. Dividing the rounded sum by four is exact in the
 * admitted normal domain, so (sum/4)/.75 rounds exactly as native sum/3.
 * Sums below2^-72 are already far below positive Tolerance>=2^-50; their
 * metric may become zero without changing either native matte branch. */
export const compositorCpuDifferenceMeanV2 = Fn(([red, green, blue]: TslEffectNode[]) => {
  const sum = rounded(rounded(min(red, 12).add(min(green, 12))).add(min(blue, 12)))
  const scaled = select(sum.greaterThanEqual(2 ** -72), rounded(sum.mul(.25)), 0)
  return compositorCpuDistanceRatio(scaled, float(.75))
}).setLayout({ name: 'blendlinkCpuDifferenceMeanV2', type: 'float', inputs: [
  { name: 'red', type: 'float' }, { name: 'green', type: 'float' }, { name: 'blue', type: 'float' },
] })

/** Independent average-RGB-distance key. Legacy CPU fully keyed pixels
 * become zero even for negative input alpha; modern/GPU retain the alpha cap. */
export function buildCompositorDifferenceKey(op: SourceCompositorOperation,
  input: (name: string) => TslEffectNode, device: unknown, fail: (message: string) => never): TslEffectNode {
  const settings = op.properties.difference_key_settings, schema = op.properties.difference_key_schema
  const exactCpu = op.properties.difference_key_model === DIFFERENCE_KEY_CPU_EXACT_MODEL
  const roundedGpu=op.properties.difference_key_model===DIFFERENCE_KEY_RNE_MODEL
  if ((op.properties.difference_key_model !== 'native-difference-key-v1' && !roundedGpu && !exactCpu)
    || !['legacy-cpu', 'modern'].includes(String(schema))
    || !Array.isArray(settings) || settings.length !== 2
    || !settings.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
    || settings[1] !== 0 && settings[1] < 1 / 64)
    return fail('Difference Key requires its native model, fixed [0,1] controls and zero or >=1/64 Falloff')
  if (exactCpu) {
    const version = op.properties.difference_key_native_version
    if (device !== 'CPU' || typeof schema !== 'string' || !Array.isArray(version) || version.length !== 3
      || ![0, 1, 2].every(index => Object.hasOwn(version, index)
        && typeof version[index] === 'number' && Number.isInteger(version[index]))
      || !['4,2,0', '5,2,0', '5,3,0'].includes(version.join(','))
      || (schema === 'legacy-cpu') !== (version[0] === 4)
      || ![0, 1].every(index => typeof settings[index] === 'number' && Number.isFinite(settings[index])
        && Math.fround(settings[index]) === settings[index])
      || settings[0] < 2 ** -50)
      return fail('Difference Key exact CPU profile requires measured source version, positive Tolerance >=2^-50 and native Float32 controls')
    if (op.properties.evaluation_device !== 'CPU' && !(op.properties.evaluation_device === 'GPU'
      && version[0] === 5 && op.properties.single_value_device === 'CPU'))
      return fail('Difference Key exact CPU folding requires the actual modern single-value evaluator')
    if (op.type !== (op.source.output === 'Matte' ? 'VALUE' : 'RGBA')
      || !['Image 1', 'Image 2'].every(name => op.inputs[name]?.value.type === 'RGBA'))
      return fail('Difference Key exact CPU profile requires native Color inputs and matching Image/Matte output')
  }
  if (!['CPU', 'GPU'].includes(String(device)) || schema === 'legacy-cpu' && device !== 'CPU')
    return fail('Difference Key requires a compatible native source evaluator')
  if (roundedGpu && (schema!=='modern' || op.properties.evaluation_device!=='GPU'
    || op.properties.native_gpu_backend!=='OPENGL' || !isMeasuredDifferenceRneProfile(op.properties.difference_key_gpu_profile)))
    return fail('Difference Key rounded mean requires its measured Blender 5.2 Mesa llvmpipe GPU source profile')
  if (!roundedGpu && op.properties.difference_key_gpu_profile!==undefined)
    return fail('Difference Key GPU source profile requires its versioned rounded-mean model')
  if (!['Image', 'Matte'].includes(op.source.output)) return fail('Difference Key requires Image or Matte output')
  const [tolerance, falloff] = [...settings], output = op.source.output
  const first = input('Image 1'), second = input('Image 2')
  return Fn(() => {
    const color = first.toVar(), delta = abs(color.rgb.sub(second.rgb)).toVar()
    const difference = (exactCpu ? compositorCpuDifferenceMeanV2(delta.r, delta.g, delta.b) : device === 'CPU' ? legacyMean(delta.r, delta.g, delta.b)
      : roundedGpu ? llvmpipeMean(delta.r, delta.g, delta.b)
      : delta.r.add(delta.g).add(delta.b).div(3)).toVar()
    const numerator = max(exactCpu ? rounded(difference.sub(tolerance)) : difference.sub(tolerance), 0)
    const ratio = falloff === 0 ? float(0) : exactCpu ? compositorCpuDistanceRatio(numerator, float(falloff)) : numerator.div(falloff)
    const opaque = difference.greaterThan(Math.fround(tolerance + falloff))
    let matte = min(select(opaque, color.a, ratio), color.a)
    if (schema === 'legacy-cpu') matte = select(difference.lessThanEqual(tolerance), 0, matte)
    matte = matte.toVar()
    return output === 'Matte' ? matte : color.mul(matte)
  })()
}
