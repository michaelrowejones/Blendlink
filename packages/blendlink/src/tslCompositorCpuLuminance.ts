import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, bitcast, select, uint } = TSL as unknown as Record<
  'Fn' | 'bitcast' | 'select' | 'uint', (...values: TslEffectNode[]) => TslEffectNode>

/** Explicitly qualified FTZ/DAZ CPU stages, retaining a zero's sign.
 * Integer inspection also prevents GPU contraction across a Float32 stage. */
export const compositorCpuLuminanceStage = (value: TslEffectNode): TslEffectNode => {
  const bits = bitcast(value, 'uint').toVar()
  return bitcast(select(bits.bitAnd(uint(0x7f800000)).equal(uint(0)),
    bits.bitAnd(uint(0x80000000)), bits), 'float').toVar()
}

/** Native CPU dot: three independent products followed by (r+g)+b. */
export const compositorCpuLuminanceDot = Fn(([color, coefficients]: TslEffectNode[]) => {
  const stage = compositorCpuLuminanceStage
  const products = ['r', 'g', 'b'].map(channel => stage(stage(color[channel]).mul(coefficients[channel])))
  return stage(stage(products[0]!.add(products[1])).add(products[2]))
}).setLayout({ name: 'blendlinkCompositorCpuLuminanceDotV1', type: 'float', inputs: [
  { name: 'color', type: 'vec3' }, { name: 'coefficients', type: 'vec3' },
] })
