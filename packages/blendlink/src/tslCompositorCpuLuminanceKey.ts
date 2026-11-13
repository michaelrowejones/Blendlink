import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'
import { compositorCpuLuminanceDot, compositorCpuLuminanceStage } from './tslCompositorCpuLuminance.js'
import { compositorCpuLuminanceRatio, compositorCpuLuminanceRatioBits } from './tslCompositorCpuLuminanceRatio.js'
import { lumaGradualAddBits, lumaGradualDotBits, lumaGradualLess, lumaGradualMultiplyBits } from './tslCompositorLumaGradual.js'

const { Fn, abs, bitcast, float, min, select, uint, vec3, vec4 } = TSL as unknown as Record<
  'Fn' | 'abs' | 'bitcast' | 'float' | 'min' | 'select' | 'uint' | 'vec3' | 'vec4', (...values: TslEffectNode[]) => TslEffectNode>


function floatWord(value: number): number {
  const buffer = new ArrayBuffer(4), view = new DataView(buffer)
  view.setFloat32(0, value, true)
  return view.getUint32(0, true)
}


/** Private arithmetic kernel, called only after document admission. Direct
 * experiments may qualify an unmeasured native CPU profile with this function;
 * doing so does not grant that profile production document admission. */
export function buildCompositorCpuLuminanceKey(image: TslEffectNode, limits: readonly number[], output: 'Image' | 'Matte',
  profile: 'gradual-rne' | 'ftz-daz-rne'): TslEffectNode {
  const [low, high] = limits.map(Math.fround), denominator = Math.fround(high! - low!)
  const known = [.2126, .7152, .0722].map(Math.fround)
  const weights = vec3(...known), divisor = float(Math.abs(denominator)), reversed = denominator < 0
  const exactScale = Number.isInteger(Math.log2(Math.abs(denominator))) ? 1 / Math.abs(denominator) : null
  if (profile === 'gradual-rne') {
    const lowWord = uint(floatWord(low!)), lower = uint(floatWord(Math.min(low!, high!))), upper = uint(floatWord(Math.max(low!, high!)))
    const denominatorWord = uint(floatWord(Math.abs(denominator)))
    return Fn(() => {
      const color = image.toVar(), luminance = lumaGradualDotBits(color.rgb, weights).toVar()
      const numerator = lumaGradualAddBits(luminance, lowWord.bitXor(uint(0x80000000))).toVar()
      const positive = numerator.bitAnd(uint(0x7fffffff)), magnitude = select(positive.lessThan(denominatorWord), positive, denominatorWord)
      const ratio = exactScale === 1 ? magnitude : exactScale !== null
        ? lumaGradualMultiplyBits(magnitude, uint(floatWord(exactScale)))
        : compositorCpuLuminanceRatioBits(magnitude, denominatorWord)
      const signed = ratio.bitOr(numerator.bitAnd(uint(0x80000000)).bitXor(uint(reversed ? 0x80000000 : 0)))
      const ramp = select(lumaGradualLess(luminance, lower), uint(reversed ? 0x3f800000 : 0),
        select(lumaGradualLess(upper, luminance), uint(reversed ? 0 : 0x3f800000), signed)).toVar()
      const alpha = bitcast(color.a, 'uint'), capped = select(lumaGradualLess(alpha, ramp), alpha, ramp)
      const matte = select(luminance.bitAnd(uint(0x7fffffff)).greaterThan(uint(0x7f800000)), luminance, capped).toVar()
      return output === 'Matte' ? bitcast(matte, 'float') : vec4(...['r', 'g', 'b', 'a'].map(channel =>
        bitcast(lumaGradualMultiplyBits(bitcast(color[channel], 'uint'), matte), 'float')))
    })()
  }
  return Fn(() => {
    const stage = compositorCpuLuminanceStage, color = image.toVar()
    const luminance = compositorCpuLuminanceDot(color.rgb, weights).toVar()
    const numerator = stage(luminance.sub(low)), magnitude = min(abs(numerator), Math.abs(denominator)).toVar()
    // CPU stages flush every subnormal to signed zero. The bounded absolute
    // numerator is consequently zero or normal, <=1; the divisor is [1/64,1].
    // Power-of-two scaling is exact for this normal-or-zero domain and
    // avoids the integer divider for the ordinary default0..1 ramp.
    const quotient = (exactScale === null ? compositorCpuLuminanceRatio(magnitude, divisor)
      : stage(magnitude.mul(exactScale))).toVar()
    const sign = bitcast(numerator, 'uint').bitAnd(uint(0x80000000)).bitXor(uint(reversed ? 0x80000000 : 0))
    const signed = bitcast(bitcast(quotient, 'uint').bitOr(sign), 'float')
    const ramp = select(luminance.lessThan(Math.min(low!, high!)), reversed ? 1 : 0,
      select(luminance.greaterThan(Math.max(low!, high!)), reversed ? 0 : 1, signed)).toVar()
    const alpha = stage(color.a), matte = select(alpha.lessThan(ramp), alpha, ramp).toVar()
    return output === 'Matte' ? matte : vec4(...['r', 'g', 'b', 'a'].map(channel => stage(stage(color[channel]).mul(matte))))
  })()
}
