import { FloatType } from 'three'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { ownBlurRtt as ownCompositorRtt } from './tslCompositorBlur.js'

const { Fn, clamp, convertToTexture, ivec2, max, mix, rtt, sqrt, textureSize, uv, vec3, vec4 } = TSL as unknown as Record<
  'Fn' | 'clamp' | 'convertToTexture' | 'ivec2' | 'max' | 'mix' | 'rtt' | 'sqrt' | 'textureSize' | 'uv' | 'vec3' | 'vec4',
  (...values: TslEffectNode[]) => TslEffectNode>
const KERNELS: Record<string, readonly number[]> = {
  Soften: [1, 2, 1, 2, 4, 2, 1, 2, 1].map(x => x / 16),
  'Box Sharpen': [-1,-1,-1,-1,9,-1,-1,-1,-1],
  'Diamond Sharpen': [0,-1,0,-1,5,-1,0,-1,0],
  Laplace: [-1/8,-1/8,-1/8,-1/8,1,-1/8,-1/8,-1/8,-1/8],
  Sobel: [1,0,-1,2,0,-2,1,0,-1],
  Prewitt: [1,0,-1,1,0,-1,1,0,-1],
  Kirsch: [5,-3,-2,5,-3,-2,5,-3,-2],
  Shadow: [1,2,1,0,1,0,-1,-2,-1],
}
const EDGES = new Set(['Laplace', 'Sobel', 'Prewitt', 'Kirsch'])

export function buildCompositorFilter(
  op: SourceCompositorOperation,
  input: TslEffectNode,
  factor: TslEffectNode,
  single: boolean,
  resources: { dispose(): void }[],
  fail: (message: string) => never,
): TslEffectNode {
  const mode = String(op.properties.filter_type)
  const kernel = Object.hasOwn(KERNELS, mode) ? KERNELS[mode] : undefined
  const schema = op.properties.filter_schema
  if (op.properties.spatial_model !== 'native-filter-v1' || !kernel || !['legacy', 'modern'].includes(String(schema)))
    return fail('Filter requires a verified native kernel and schema model')
  if (!['CPU', 'GPU'].includes(String(op.properties.evaluation_device)))
    return fail('Filter requires its native compositor device')
  // Modern Blender bypasses a single-value Image even when Factor is a field.
  // Legacy Blender instead evaluates its convolution on the constant value.
  if (single && schema === 'modern') return input
  const legacyCpu = schema === 'legacy' && op.properties.evaluation_device === 'CPU'
  const weights = legacyCpu && EDGES.has(mode)
    ? kernel.map((_, i) => kernel[(i % 3) * 3 + Math.floor(i / 3)]!) : kernel
  let image: TslEffectNode = input
  if (!single) {
    // Mapped TextureNodes must be materialized before loading neighboring pixels.
    const raw = input.isTextureNode && input.uvNode == null && input.sampler !== false
      && input.levelNode == null && input.biasNode == null && input.offsetNode == null
    image = (raw ? convertToTexture : rtt)(input, null, null, { type: FloatType, depthBuffer: false })
    if (image !== input && image.isRTTNode) resources.push(ownCompositorRtt(image))
  }
  const sample = (x: number, y: number): TslEffectNode => single ? input : image.load(clamp(
    ivec2(uv().mul(textureSize(image))).add(ivec2(x, y)), ivec2(0), ivec2(textureSize(image)).sub(1)))
  return Fn(() => {
    const original = sample(0, 0).toVar(), amount = factor.toVar()
    if (EDGES.has(mode)) {
      const horizontal = vec3(0).toVar(), vertical = vec3(0).toVar()
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const color = sample(x - 1, y - 1).rgb.toVar()
        horizontal.addAssign(color.mul(weights[y * 3 + x]!))
        vertical.addAssign(color.mul(weights[x * 3 + y]!))
      }
      const magnitude = sqrt(horizontal.mul(horizontal).add(vertical.mul(vertical)))
      const rgb = legacyCpu
        ? magnitude.mul(amount).add(original.rgb.mul(amount.oneMinus())) : mix(original.rgb, magnitude, amount)
      const output = vec4(rgb, original.a)
      // Legacy CPU clamps alpha too; other edge filters retain signed RGB/alpha.
      return legacyCpu ? max(output, 0) : output
    }
    const sum = vec4(0).toVar()
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++)
      sum.addAssign(sample(x - 1, y - 1).mul(weights[y * 3 + x]!))
    return max(legacyCpu ? sum.mul(amount).add(original.mul(amount.oneMinus())) : mix(original, sum, amount), 0)
  })()
}
