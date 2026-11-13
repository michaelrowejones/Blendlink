import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, abs, bitcast, float, min, select, uint, uniform, vec2, vec3 } = TSL as unknown as Record<
  'Fn' | 'abs' | 'bitcast' | 'float' | 'min' | 'select' | 'uint' | 'uniform' | 'vec2' | 'vec3',
  (...args: TslEffectNode[]) => TslEffectNode>

// The uniform comparison is opaque to fast-math optimizers. Finite values keep
// their exact bits; arithmetic cannot contract across these Float32 stages.
const sentinel = uniform(0x7fc00000, 'uint')
function rounded(value: TslEffectNode, mask: TslEffectNode): TslEffectNode {
  const bits = bitcast(value, 'uint').toVar()
  return bitcast(select(bits.equal(mask), uint(0), bits), 'float').toVar()
}

// A split-product residual corrects GPU reciprocal division at CPU boundaries.
// This helper is private to the fresh Chroma model; existing serialized color
// conversion and compositor operations keep their established arithmetic.
const divideCpu = Fn(([value, divisor, mask]: TslEffectNode[]) => {
  const round = (value: TslEffectNode) => rounded(value, mask)
  const q = round(value.div(divisor)), product = round(q.mul(divisor))
  const high = (value: TslEffectNode) => bitcast(bitcast(value, 'uint').bitAnd(uint(0xfffff000)), 'float').toVar()
  const hq = high(q), hd = high(divisor), lq = round(q.sub(hq)), ld = round(divisor.sub(hd))
  const error = round(round(round(round(round(hq.mul(hd)).sub(product))
    .add(round(hq.mul(ld)))).add(round(lq.mul(hd)))).add(round(lq.mul(ld))))
  const residual = round(round(value.sub(product)).sub(error))
  return round(q.add(round(residual.div(divisor))))
}).setLayout({ name: 'blendlinkChromaCpuDivideV1', type: 'float', inputs: [
  { name: 'value', type: 'float' }, { name: 'divisor', type: 'float' }, { name: 'mask', type: 'uint' },
] })

const f = Math.fround
function cpuKey(key: number[], legacy: boolean): number[] {
  const p = key.map(value => f(value * 255))
  const cb = f(f(f(f(f(-.101) * p[0]!) - f(f(.338) * p[1]!)) + f(f(.439) * p[2]!)) + 128)
  const cr = f(f(f(f(f(.439) * p[0]!) - f(f(.399) * p[1]!)) - f(f(.040) * p[2]!)) + 128)
  const divide = (value: number) => legacy ? f(value * f(1 / 255)) : f(value / 255)
  return [f(f(divide(cb) * 2) - 1), f(f(divide(cr) * 2) - 1)]
}

function colorChroma(color: TslEffectNode, legacy: boolean, mask: TslEffectNode): TslEffectNode {
  const round = (value: TslEffectNode) => rounded(value, mask)
  const c = color.mul(255).toVar(), r = round(c.r), g = round(c.g), b = round(c.b)
  const cb = round(round(round(round(r.mul(-.101)).sub(round(g.mul(.338)))).add(round(b.mul(.439)))).add(128))
  const cr = round(round(round(round(r.mul(.439)).sub(round(g.mul(.399)))).sub(round(b.mul(.040)))).add(128))
  // Legacy CPU multiplies a rounded reciprocal; modern CPU divides instead.
  const values = legacy ? vec3(round(cb.mul(f(1 / 255))), round(cr.mul(f(1 / 255))), 0)
    : vec3(divideCpu(cb, float(255), mask), divideCpu(cr, float(255), mask), 0)
  return vec2(round(round(values.x.mul(2)).sub(1)), round(round(values.y.mul(2)).sub(1)))
}

function makeKernel(legacy: boolean): TslEffectNode {
  return Fn(([givenColor, basis, acceptance, falloff, mask]: TslEffectNode[]) => {
    const round = (value: TslEffectNode) => rounded(value, mask)
    const color = givenColor.toVar(), cc = colorChroma(color.rgb, legacy, mask).toVar()
    const rotated = vec2(round(round(cc.x.mul(basis.x)).add(round(cc.y.mul(basis.y)))),
      round(round(cc.y.mul(basis.x)).sub(round(cc.x.mul(basis.y))))).toVar()
    const foreground = round(rotated.x.sub(divideCpu(abs(rotated.y), acceptance, mask))).toVar()
    const alpha = round(float(1).sub(divideCpu(foreground, falloff, mask)))
    return min(select(foreground.greaterThan(0), alpha, color.a), color.a)
  }).setLayout({ name: 'blendlinkChromaCpu' + (legacy ? 'Legacy' : 'Modern') + 'V1', type: 'float', inputs: [
    { name: 'color', type: 'vec4' }, { name: 'basis', type: 'vec2' },
    { name: 'acceptance', type: 'float' }, { name: 'falloff', type: 'float' }, { name: 'mask', type: 'uint' },
  ] })
}

// One parameterized function per schema: repeated instances/cascades must not
// emit duplicate named shader functions or capture another key's parameters.
const legacyKernel = makeKernel(true), modernKernel = makeKernel(false)

/** Independent BT.709 chroma-axis projection and soft wedge key. The matte is
 * capped by authored alpha, never lower-clamped, and multiplies full RGBA. */
export function buildCompositorChromaKey(op: SourceCompositorOperation, image: TslEffectNode,
  device: unknown, fail: (message: string) => never): TslEffectNode {
  const p = op.properties, controls = p.chroma_key_controls, key = p.chroma_key_rgb
  if (p.evaluation_device !== 'CPU' || device !== 'CPU')
    return fail("Chroma Key currently needs Blender's CPU compositor; GPU-authored threshold decisions are not yet verified. Set the compositor device to CPU")
  if (p.chroma_key_model !== 'native-cpu-fixed-chroma-key-v1' || !['legacy', 'modern'].includes(String(p.chroma_key_schema))
    || !Array.isArray(controls) || controls.length !== 3 || !controls.every(value => typeof value === 'number' && Number.isFinite(value))
    || !Array.isArray(key) || key.length !== 3 || !key.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1))
    return fail('Chroma Key requires its verified model, fixed RGB key and scalar controls')
  const [minimum, maximum, falloff] = controls as [number, number, number]
  if (minimum !== 0)
    return fail('Chroma Key currently requires Minimum (legacy Cutoff) = 0 for verified soft keying; positive angular cutoffs depend on unverified native atan2 rounding')
  if (maximum < f(Math.PI / 32) || maximum > f(Math.PI / 2) || falloff < 1 / 64 || falloff > 1)
    return fail('Chroma Key requires Maximum within [pi/32,pi/2] and Falloff within [1/64,1]')
  const legacy = p.chroma_key_schema === 'legacy', chroma = cpuKey(key as number[], legacy)
  if (Math.hypot(...chroma) < 1 / 32) return fail('Chroma Key needs a chromatic key with magnitude at least 1/32')
  const basis = p.chroma_key_basis, acceptance = p.chroma_key_acceptance
  if (!Array.isArray(basis) || basis.length !== 2 || !basis.every(value => typeof value === 'number' && Number.isFinite(value))
    || Math.abs(Math.hypot(...basis) - 1) > 2e-6 || basis[0] * chroma[0]! + basis[1] * chroma[1]! <= 0
    || Math.abs(basis[0] * chroma[1]! - basis[1] * chroma[0]!) > 2e-6
    || typeof acceptance !== 'number' || !Number.isFinite(acceptance)
    || Math.abs(acceptance - f(Math.tan(f(maximum / 2)))) > 2e-7)
    return fail('Chroma Key requires valid native CPU fixed-key basis and acceptance coefficients')
  if (!['Image', 'Matte'].includes(op.source.output)) return fail('Chroma Key requires Image or Matte output')
  const matte = (legacy ? legacyKernel : modernKernel)(image, vec2(...basis), float(acceptance), float(falloff), sentinel)
  return op.source.output === 'Matte' ? matte : image.mul(matte)
}
