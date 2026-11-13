import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, select, vec4 } = TSL as unknown as Record<'Fn' | 'select' | 'vec4',
  (...values: TslEffectNode[]) => TslEffectNode>

export function buildCompositorAlphaConversion(op: SourceCompositorOperation,
  input: (name: string) => TslEffectNode, fail: (message: string) => never): TslEffectNode {
  if (op.properties.alpha_conversion_model !== 'native-alpha-v1')
    return fail('Alpha conversion requires its native color and zero-alpha model')
  const mode = op.properties.alpha_mode
  if (op.kind === 'set-alpha') {
    if (mode === 'Apply Mask') return input('Image').mul(input('Alpha'))
    if (mode === 'Replace Alpha') return vec4(input('Image').rgb, input('Alpha'))
    return fail('Set Alpha requires Apply Mask or Replace Alpha')
  }
  if (op.kind !== 'convert-alpha') return fail('Unknown alpha conversion operation')
  if (mode === 'To Premultiplied') return Fn(() => {
    const color = input('Image').toVar()
    return vec4(color.rgb.mul(color.a), color.a)
  })()
  if (mode === 'To Straight') return Fn(() => {
    const color = input('Image').toVar()
    // Native zero alpha preserves RGB, including hidden color and negatives.
    const divisor = select(color.a.equal(0), 1, color.a)
    return vec4(color.rgb.div(divisor), color.a)
  })()
  return fail('Alpha Convert requires To Premultiplied or To Straight')
}
