import * as TSL from 'three/tsl'
import type { CompositorValue, SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, If, bitcast, float, max, min, select, uint, uniform } = TSL as unknown as Record<
  'Fn' | 'If' | 'bitcast' | 'float' | 'max' | 'min' | 'select' | 'uint' | 'uniform',
  (...args: TslEffectNode[]) => TslEffectNode>
export const CHANNEL_KEY_PROFILE = 'native-rgb-channel-key-pow2-v1'
const sentinel = uniform(0x7fc00000, 'uint')

function literal(value: CompositorValue | undefined, ops: readonly SourceCompositorOperation[]): number | undefined {
  if (value?.type !== 'VALUE') return
  const source = value.kind === 'ref' ? ops.find(op => op.id === value.node) : undefined
  const number = value.kind === 'constant' ? value.value
    : source?.kind === 'value' && source.type === 'VALUE' ? source.value : undefined
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

function makeKernel(metal: boolean): TslEffectNode { return Fn(([color, key, first, second, low, high, inverse, mask]: TslEffectNode[]) => {
  const round = (value: TslEffectNode) => {
    const bits = bitcast(value, 'uint').toVar()
    return bitcast(select(bits.equal(mask), uint(0), bits), 'float').toVar()
  }
  const chosen = color.element(key), limit = max(color.element(first), color.element(second)), delta = round(chosen.sub(limit))
  const alpha = round(float(1).sub(delta)).toVar(), result = float(0).toVar()
  If(alpha.greaterThan(high), () => { result.assign(color.a) })
    .ElseIf(alpha.lessThan(low), () => { result.assign(0) })
    .Else(() => {
      // Measured native Metal reassociates the interior only. Endpoints still
      // compare the rounded alpha; MF-folded modern constants keep CPU staging.
      const numerator = metal ? round(round(float(1).sub(low)).sub(delta)) : round(alpha.sub(low))
      result.assign(round(numerator.mul(inverse)))
    })
  return min(result, color.a)
}).setLayout({ name: 'blendlinkRgbChannelKey' + (metal ? 'Metal' : 'Cpu') + 'Pow2V1', type: 'float', inputs: [
  { name: 'color', type: 'vec4' }, { name: 'key', type: 'int' }, { name: 'first', type: 'int' }, { name: 'second', type: 'int' },
  { name: 'low', type: 'float' }, { name: 'high', type: 'float' }, { name: 'inverse', type: 'float' }, { name: 'mask', type: 'uint' },
] }) }
const cpuKernel = makeKernel(false), metalKernel = makeKernel(true)

/** Channel differences key finite RGB directly. Keep strict endpoints, the
 * existing alpha cap and whole-RGBA multiplication, including signed/HDR alpha. */
export function buildCompositorChannelKey(op: SourceCompositorOperation, image: TslEffectNode,
  device: unknown, ops: readonly SourceCompositorOperation[], fail: (message: string) => never): TslEffectNode {
  const p = op.properties, channels = ['R', 'G', 'B'], key = channels.indexOf(String(p.channel_key_channel))
  const limit = channels.indexOf(String(p.channel_key_limit_channel)), limits = p.channel_key_limits
  const sources = p.channel_key_limit_sources, version = p.channel_key_native_version
  if (p.channel_key_model !== CHANNEL_KEY_PROFILE || !['legacy', 'modern'].includes(String(p.channel_key_schema))
    || p.channel_key_space !== 'RGB' || key < 0 || limit < 0 || !['MAX', 'SINGLE'].includes(String(p.channel_key_limit_method))
    || !Array.isArray(limits) || limits.length !== 2 || !limits.every(value => typeof value === 'number' && Number.isFinite(value) && Math.fround(value) === value && value >= 0 && value <= 1)
    || !['Image', 'Matte'].includes(op.source.output) || op.type !== (op.source.output === 'Image' ? 'RGBA' : 'VALUE')
    || op.inputs.Image?.value.type !== 'RGBA')
    return fail('Channel Key requires its verified RGB model, channels and fixed finite [0,1] limits')
  if (!Array.isArray(version) || version.length !== 3 || !version.every(value => Number.isInteger(value) && value >= 0)
    || !Array.isArray(sources) || sources.length !== 2 || !sources.every(value =>
      p.channel_key_schema === 'legacy' ? value === 'property' : ['socket-default', 'linked-literal'].includes(String(value)))
    || sources.some((source, index) => source !== 'linked-literal' && op.inputs[index === 0 ? 'Minimum' : 'Maximum']?.value.kind !== 'constant'))
    return fail('Channel Key requires native version and fixed-control source provenance')
  if (!['CPU', 'GPU'].includes(String(device)) || !['CPU', 'GPU'].includes(String(p.evaluation_device))
    || p.evaluation_device === 'GPU' && p.native_gpu_backend !== 'METAL')
    return fail('Channel Key requires CPU source compositing or the verified Metal GPU source backend')
  if (p.evaluation_device === 'GPU' && ![[4, 2], [5, 2], [5, 3]].some(([major, minor]) => version[0] === major && version[1] === minor))
    return fail('Channel Key GPU arithmetic is verified for Blender4.2/5.2/5.3 only')
  const legacySource = version[0] === 4 && version[1] === 2
  if (p.evaluation_device === 'GPU' && ((p.channel_key_schema === 'legacy') !== legacySource
    || p.single_value_device !== (legacySource ? 'GPU' : 'CPU')))
    return fail('Channel Key GPU source version, schema and constant evaluator must agree')
  const [low, high] = limits as [number, number], span = Math.fround(high - low)
  if (low >= high || span < 1/64 || !Number.isInteger(Math.log2(span)))
    return fail('Channel Key requires ordered limits with a power-of-two Float32 span within [1/64,1]')
  if (literal(op.inputs.Minimum?.value, ops) !== low || literal(op.inputs.Maximum?.value, ops) !== high)
    return fail('Channel Key limits must match independently verified scalar literals or Value/group inputs')
  const indices = p.channel_key_limit_method === 'MAX' ? [(key + 1) % 3, (key + 2) % 3] : [limit, limit]
  // Measured 5.2 Metal retains staging for linked Minimum, including constant
  // group defaults. Its default socket and 5.3 use the reassociated numerator.
  const reassociated = device === 'GPU' && !(version[0] === 5 && version[1] === 2 && sources[0] === 'linked-literal')
  const matte = (reassociated ? metalKernel : cpuKernel)(image, key, indices[0], indices[1], low, high, 1/span, sentinel)
  return op.source.output === 'Matte' ? matte : image.mul(matte)
}
