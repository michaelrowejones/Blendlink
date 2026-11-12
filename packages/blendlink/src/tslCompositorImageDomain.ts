import { FloatType, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { ownBlurRtt } from './tslCompositorBlur.js'

const { Fn, clamp, ivec2, rtt, select, textureSize, uv, vec4 } = TSL as unknown as Record<
  'Fn' | 'clamp' | 'ivec2' | 'rtt' | 'select' | 'textureSize' | 'uv' | 'vec4',
  (...arguments_: TslEffectNode[]) => TslEffectNode>

/** A real finite pixel window with a deferred origin, not an already clipped field. */
export interface CompositorImageOrigin {
  x: number
  y: number
  roots: { node: TslEffectNode, extent?: (renderer: TslEffectNode) => readonly [number, number] }[]
}

export function mergeImageOrigins(origins: (CompositorImageOrigin | null)[], fail: (message: string) => never): CompositorImageOrigin | null {
  const fields = origins.filter((value): value is CompositorImageOrigin => value !== null)
  if (!fields.length) return null
  const first = fields[0]!
  if (fields.some(value => value.x !== first.x || value.y !== first.y))
    fail('Inputs with different image origins require native cross-domain realization')
  return { x: first.x, y: first.y, roots: [...new Set(fields.flatMap(value => value.roots))] }
}

export function translatedImageOrigin(op: SourceCompositorOperation, input: CompositorImageOrigin | null,
  fail: (message: string) => never): CompositorImageOrigin | null {
  const delta = op.properties.image_translation
  if (op.type !== 'RGBA' || op.inputs.Image?.value.type !== 'RGBA'
    || op.properties.image_domain_model !== 'deferred-integer-origin-v1'
    || !Array.isArray(delta) || delta.length !== 2
    || delta.some(value => !Number.isInteger(value) || Math.abs(value) > 8192))
    fail('Translate requires its bounded deferred integer-origin model')
  if (input === null) return null
  const x = input.x + delta[0], y = input.y + delta[1]
  if (Math.abs(x) > 8192 || Math.abs(y) > 8192)
    fail('Composed Translate offsets must remain between -8192 and 8192 pixels')
  return { x, y, roots: input.roots }
}

/** Realize once, after neighborhood/pointwise processing, preserving off-canvas
 * pixels until this boundary. The first model has equal-sized render windows;
 * unequal extents refuse rather than silently stretching or discarding origins. */
export function realizeIntegerImageOrigin(input: TslEffectNode, origin: CompositorImageOrigin,
  resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  const image = rtt(input, 1, 1, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(image))
  const updateBefore = image.updateBefore.bind(image), size = new Vector2(), viewport = new Vector4(), scissor = new Vector4()
  image.updateBefore = (frame: TslEffectNode): void => {
    const renderer = frame.renderer
    renderer.getViewport(viewport); renderer.getScissor(scissor)
    const state = RendererUtils.resetRendererState(renderer, undefined as never)
    try {
      renderer.getDrawingBufferSize(size)
      const width = size.x, height = size.y
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
        fail('Translate requires a finite nonempty compositing image extent')
      for (const root of origin.roots) {
        if (root.extent) {
          const [rootWidth, rootHeight] = root.extent(renderer)
          if (rootWidth !== width || rootHeight !== height)
            fail('Translate requires matching source/render image extents; arbitrary data/display windows need native domain realization')
          continue
        }
        let source = root.node
        if (source.isPassNode) source = source.getTextureNode()
        while (source.referenceNode && source.referenceNode !== source) source = source.referenceNode
        const pass = source.passNode
        let rootWidth: number, rootHeight: number
        if (source.isRTTNode && source.autoResize || pass) {
          const scale = pass?.getResolutionScale?.() ?? 1
          rootWidth = Math.floor(width * scale); rootHeight = Math.floor(height * scale)
        } else {
          rootWidth = source.value?.image?.width; rootHeight = source.value?.image?.height
        }
        if (rootWidth !== width || rootHeight !== height)
          fail('Translate requires matching source/render image extents; arbitrary data/display windows need native domain realization')
      }
      if (image.renderTarget.width !== width || image.renderTarget.height !== height) image.setSize(width, height)
      updateBefore(frame)
    } finally {
      RendererUtils.restoreRendererState(renderer, state)
      renderer.setViewport(viewport); renderer.setScissor(scissor)
    }
  }
  return Fn(() => {
    const dimensions = ivec2(textureSize(image))
    const coordinate = ivec2(uv().mul(dimensions)).sub(ivec2(origin.x, origin.y))
    const inside = coordinate.x.greaterThanEqual(0).and(coordinate.y.greaterThanEqual(0))
      .and(coordinate.x.lessThan(dimensions.x)).and(coordinate.y.lessThan(dimensions.y))
    // Clamp the inactive texture fetch too: out-of-bounds GLSL texelFetch is
    // undefined, even when a later select discards its value.
    return select(inside, image.load(clamp(coordinate, ivec2(0), dimensions.sub(1))), vec4(0))
  })()
}
