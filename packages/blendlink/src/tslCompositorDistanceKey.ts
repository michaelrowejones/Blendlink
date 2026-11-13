import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { compositorCpuSqrt } from './tslCompositorCpuSqrt.js'
import { compositorCpuDistanceRatio } from './tslCompositorCpuDistanceRatio.js'

const { Fn, abs, bitcast, float, max, min, select, uint, vec3 } = TSL as unknown as Record<
  'Fn' | 'abs' | 'bitcast' | 'float' | 'max' | 'min' | 'select' | 'uint' | 'vec3',
  (...values: TslEffectNode[]) => TslEffectNode>
const rounded = (value: TslEffectNode): TslEffectNode => {
  const word = bitcast(value, 'uint').toVar()
  return bitcast(select(word.equal(uint(0x7fc00000)), uint(0), word), 'float').toVar()
}

/** Native RGB Euclidean distance key. Legacy CPU strict comparisons and
 * negative-alpha behavior differ from modern CPU and are kept explicit. */
export function buildCompositorDistanceKey(op: SourceCompositorOperation, input: (name: string) => TslEffectNode,
  device: unknown, fail: (message: string) => never): TslEffectNode {
  const schema = op.properties.distance_key_schema, settings = op.properties.distance_key_settings
  if (op.properties.distance_key_model !== 'native-rgb-distance-cpu-v1' || typeof schema !== 'string' || !['legacy', 'modern'].includes(schema)
    || !Array.isArray(settings) || settings.length !== 2
    || ![0, 1].every(index => typeof settings[index] === 'number' && Number.isFinite(settings[index]) && settings[index] >= 0 && settings[index] <= 1)
    || settings[1] !== 0 && settings[1] < 1 / 64 || settings[0] !== 0 && settings[0] < 2 ** -50)
    return fail('Distance Key requires its native RGB model and fixed bounded Tolerance/Falloff')
  if (device !== 'CPU') return fail('Distance Key requires the native CPU distance evaluator; GPU field thresholds remain unqualified')
  if (schema === 'modern' && settings[0] === 0)
    return fail('Modern Distance Key with zero Tolerance requires a version-qualified tiny-distance model; use a supported positive Tolerance or source baking')
  if (schema === 'legacy' && settings[0] === 0 && settings[1] !== 0)
    return fail('Legacy Distance Key with zero Tolerance and positive Falloff requires preserved subnormal distances; use positive Tolerance, zero Falloff or source baking')
  if (op.properties.evaluation_device !== 'CPU' && op.properties.evaluation_device !== 'GPU'
    || op.properties.evaluation_device === 'GPU' && (schema !== 'modern' || op.properties.single_value_device !== 'CPU'))
    return fail('Distance Key CPU folding requires a verified source evaluator/schema')
  if (!['Image', 'Matte'].includes(op.source.output)) return fail('Distance Key requires Image or Matte output')
  if (op.type !== (op.source.output === 'Matte' ? 'VALUE' : 'RGBA')
    || op.inputs.Image?.value.type !== 'RGBA' || op.inputs['Key Color']?.value.type !== 'RGBA')
    return fail('Distance Key requires native Color inputs and matching Image/Matte output types')
  const [tolerance, falloff] = settings.map(Math.fround), upper = Math.fround(tolerance! + falloff!)
  const image = input('Image'), key = input('Key Color'), output = op.source.output
  if (schema === 'legacy' && tolerance === 0 && falloff === 0)
    return Fn(() => output === 'Matte' ? image.a : image.mul(image.a))()
  return Fn(() => {
    const color = image.toVar(), delta = min(abs(color.rgb.sub(key.rgb)), vec3(8)).toVar()
    const square = ['r', 'g', 'b'].map(channel => rounded(delta[channel].mul(delta[channel])))
    const sum = rounded(rounded(square[0]!.add(square[1])).add(square[2]))
    const difference = compositorCpuSqrt(sum).toVar()
    const quotient = falloff === 0 ? float(0)
      : compositorCpuDistanceRatio(max(rounded(difference.sub(tolerance)), 0), float(falloff))
    let matte: TslEffectNode
    if (schema === 'legacy')
      matte = select(difference.lessThan(tolerance), 0,
        select(difference.lessThan(upper), min(quotient, color.a), color.a))
    else matte = min(select(difference.greaterThan(upper), color.a, max(quotient, 0)), color.a)
    matte = matte.toVar()
    return output === 'Matte' ? matte : color.mul(matte)
  })()
}
