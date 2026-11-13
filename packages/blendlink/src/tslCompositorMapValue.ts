import * as TSL from 'three/tsl'
import type { CompositorValue, SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { certifyMapValueDomain, MAP_VALUE_DOMAIN_MODEL } from './tslCompositorMapValueDomain.js'

const { Fn, If, bitcast, select, uint, uniform } = TSL as unknown as Record<
  'Fn' | 'If' | 'bitcast' | 'select' | 'uint' | 'uniform', (...args: TslEffectNode[]) => TslEffectNode>
export const MAP_VALUE_PROFILE = 'native-legacy-map-value-f32-v1'
const sentinel = uniform(0x7fc00000, 'uint')
const round = (input: TslEffectNode, mask: TslEffectNode): TslEffectNode => {
  const bits = bitcast(input, 'uint').toVar()
  return bitcast(select(bits.equal(mask), uint(0), bits), 'float').toVar()
}
const scalar = (value: number): TslEffectNode => {
  // Preserve Float32 controls including signed zero in both shader languages.
  const bytes = new ArrayBuffer(4), view = new DataView(bytes)
  view.setFloat32(0, value, true)
  return bitcast(uint(view.getUint32(0, true)), 'float')
}
// Exact Float32 division by three. Its odd denominator cannot have a halfway
// remainder, so an integer significand quotient/remainder rounds unambiguously.
const divideThree = Fn(([value]: TslEffectNode[]) => {
  const word = bitcast(value, 'uint').toVar(), sign = word.bitAnd(uint(0x80000000)).toVar()
  const exponent = word.shiftRight(uint(23)).bitAnd(uint(255)).toVar()
  const mantissa = word.bitAnd(uint(0x7fffff)).toVar(), result = word.toVar()
  If(exponent.lessThan(uint(255)), () => {
    const normalMantissa = mantissa.bitOr(uint(0x800000)).toVar()
    const numerator = uint(0).toVar(), outputExponent = uint(0).toVar()
    If(exponent.lessThanEqual(uint(2)), () => {
      numerator.assign(select(exponent.equal(uint(0)), mantissa, normalMantissa)
        .shiftLeft(select(exponent.equal(uint(2)), uint(1), uint(0))))
    }).Else(() => {
      const high = normalMantissa.greaterThanEqual(uint(12582912))
      numerator.assign(normalMantissa.shiftLeft(select(high, uint(1), uint(2))))
      outputExponent.assign(exponent.sub(select(high, uint(1), uint(2))))
    })
    const quotient = numerator.div(uint(3)).toVar()
    quotient.addAssign(select(numerator.sub(quotient.mul(uint(3))).greaterThanEqual(uint(2)), uint(1), uint(0)))
    result.assign(sign.bitOr(select(exponent.lessThanEqual(uint(2)), quotient,
      outputExponent.shiftLeft(uint(23)).bitOr(quotient.bitAnd(uint(0x7fffff))))))
  })
  return bitcast(result, 'float')
}).setLayout({ name: 'blendlinkLegacyMeanDivideThreeV1', type: 'float', inputs: [{ name: 'value', type: 'float' }] })
const meanCpu = Fn(([vector, mask]: TslEffectNode[]) => divideThree(round(round(vector.x.add(vector.y), mask).add(vector.z), mask)))
  .setLayout({ name: 'blendlinkLegacyMapValueMeanCpuV1', type: 'float', inputs: [{ name: 'vector', type: 'vec3' }, { name: 'mask', type: 'uint' }] })
const meanGpu = Fn(([vector, mask]: TslEffectNode[]) => round(round(round(vector.x.add(vector.y), mask).add(vector.z), mask).mul(scalar(1/3)), mask))
  .setLayout({ name: 'blendlinkLegacyMapValueMeanGpuV1', type: 'float', inputs: [{ name: 'vector', type: 'vec3' }, { name: 'mask', type: 'uint' }] })
const kernel = Fn(([value, offset, size, low, high, useMin, useMax, mask]: TslEffectNode[]) => {
  const round = (input: TslEffectNode) => {
    const bits = bitcast(input, 'uint').toVar()
    return bitcast(select(bits.equal(mask), uint(0), bits), 'float').toVar()
  }
  const result = round(round(value.add(offset)).mul(size)).toVar()
  If(useMin.and(result.lessThan(low)), () => { result.assign(low) })
  If(useMax.and(result.greaterThan(high)), () => { result.assign(high) })
  return result
}).setLayout({ name: 'blendlinkLegacyMapValueF32V1', type: 'float', inputs: [
  { name: 'value', type: 'float' }, { name: 'offset', type: 'float' }, { name: 'size', type: 'float' },
  { name: 'low', type: 'float' }, { name: 'high', type: 'float' },
  { name: 'useMin', type: 'bool' }, { name: 'useMax', type: 'bool' }, { name: 'mask', type: 'uint' },
] })

export function buildCompositorMapValue(op: SourceCompositorOperation, resolve: (value: CompositorValue) => TslEffectNode,
  operations: readonly SourceCompositorOperation[], fail: (message: string) => never): TslEffectNode {
  const p = op.properties, controls = p.map_value_controls, version = p.map_value_native_version
  if (p.map_value_model !== MAP_VALUE_PROFILE || !Array.isArray(version) || version.length !== 3
    || version[0] !== 4 || version[1] !== 2 || version[2] !== 0 || op.type !== 'VALUE'
    || op.source.nodeType !== 'CompositorNodeMapValue' || op.source.output !== 'Value'
    || op.inputs.Value?.socketType !== 'VALUE' || op.inputs.Value?.value.type !== 'VALUE'
    || typeof p.map_value_use_min !== 'boolean' || typeof p.map_value_use_max !== 'boolean'
    || !Array.isArray(controls) || controls.length !== 4)
    return fail('Map Value requires its verified Blender 4.2.0 scalar schema and fixed controls')
  for (let index = 0; index < 4; index++) {
    const active = index < 2 || (index === 2 ? p.map_value_use_min : p.map_value_use_max), number = controls[index]
    if (active ? typeof number !== 'number' || !Number.isFinite(number) || Math.fround(number) !== number
      || Math.abs(number) > 1000 || number !== 0 && Math.abs(number) < 2 ** -126 : number !== null)
      return fail('Map Value controls require finite normal Float32 values within native +/-1000, with zero allowed')
  }
  if (!['CPU', 'GPU'].includes(String(p.evaluation_device))
    || p.evaluation_device === 'GPU' && p.native_gpu_backend !== 'METAL')
    return fail('Map Value requires CPU source compositing or the verified Metal GPU source backend')
  const incoming = op.inputs.Value!.value
  const byId = new Map(operations.map(entry => [entry.id, entry])), remaining = { count: 256 }
  const qualified = (v: CompositorValue | undefined, boundary = false): boolean => {
    if (--remaining.count < 0 || !v) return false
    if (v.kind === 'convert')
      return !(v.type === 'VALUE' && ['RGBA', 'VECTOR'].includes(String(v.fromType)) && !boundary) && qualified(v.input)
    if (v.kind === 'ref') {
      const source = byId.get(v.node ?? '')
      return !!source && (source.kind === 'map-value' || Object.values(source.inputs).every(input => qualified(input.value)))
    }
    return v.kind === 'constant'
  }
  if (!qualified(incoming, true))
    return fail('Map Value requires explicit channel separation for legacy scalar conversions farther upstream, within the qualified 256-input dependency budget')
  const mean = incoming.kind === 'convert' && incoming.type === 'VALUE' && ['RGBA', 'VECTOR'].includes(String(incoming.fromType))
  if (p.map_value_input_model !== (mean ? 'legacy-mean-v1' : 'scalar-v1')
    || mean && (!incoming.input || incoming.input.type !== incoming.fromType))
    return fail('Map Value requires an independently verified scalar or native legacy mean input conversion')
  if (mean && p.evaluation_device === 'GPU' && controls[0] !== 0)
    return fail('Map Value GPU implicit color/vector averaging requires Offset zero; use explicit channel separation for nonzero Offset')
  const proof = certifyMapValueDomain(incoming, operations, controls, p.map_value_use_min, p.map_value_use_max, p.evaluation_device)
  if (!proof || p.map_value_domain_model !== MAP_VALUE_DOMAIN_MODEL || JSON.stringify(proof) !== JSON.stringify(p.map_value_domain))
    return fail('Map Value requires fixed safe inputs or authored Min/Max input bounds away from zero, with finite normal-or-zero add/multiply results; unknown fields and underflow/overflow need source evaluation')
  const value = mean ? (p.evaluation_device === 'GPU' ? meanGpu : meanCpu)(
    incoming.fromType === 'RGBA' ? resolve(incoming.input!).rgb : resolve(incoming.input!), sentinel) : resolve(incoming)
  return kernel(value, scalar(controls[0] as number), scalar(controls[1] as number),
    scalar(controls[2] as number ?? 0), scalar(controls[3] as number ?? 1), p.map_value_use_min, p.map_value_use_max, sentinel)
}
