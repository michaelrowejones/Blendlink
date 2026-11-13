import { FloatType } from 'three'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { ownBlurRtt as ownCompositorRtt } from './tslCompositorBlur.js'

const { Fn, convertToTexture, ivec2, rtt, textureSize, uv } = TSL as unknown as Record<
  'Fn' | 'convertToTexture' | 'ivec2' | 'rtt' | 'textureSize' | 'uv', (...values: TslEffectNode[]) => TslEffectNode>

/** Discrete native image rearrangement; never interpolate alpha or border pixels. */
export function buildCompositorFlip(op: SourceCompositorOperation, input: TslEffectNode,
  single: boolean, resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  const x = op.properties.flip_x, y = op.properties.flip_y
  if (op.properties.spatial_model !== 'native-flip-v1' || typeof x !== 'boolean' || typeof y !== 'boolean')
    return fail('Flip requires its native fixed-axis pixel model')
  if (single || !x && !y) return input
  // convertToTexture reuses TextureNode, including .load(mappedIndex).
  // Reusing that node and calling .load again would discard the first remap.
  const raw = input.isTextureNode && input.uvNode == null && input.sampler !== false
    && input.levelNode == null && input.biasNode == null && input.offsetNode == null
  const image = (raw ? convertToTexture : rtt)(input, null, null, { type: FloatType, depthBuffer: false })
  if (image !== input && image.isRTTNode) resources.push(ownCompositorRtt(image))
  const dimensions = textureSize(image)
  const position = ivec2(uv().mul(dimensions))
  const reflected = ivec2(dimensions).sub(1).sub(position)
  // A field expression preserves its mapped coordinates for every subsequent
  // spatial consumer. A bare TextureNode would expose the underlying image.
  return Fn(() => image.load(ivec2(x ? reflected.x : position.x, y ? reflected.y : position.y)))()
}
