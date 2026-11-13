import { FloatType, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import type { CompositorImageOrigin } from './tslCompositorImageDomain.js'
import { validateCompositorExtent } from './tslCompositorImageDomain.js'
import { ownBlurRtt } from './tslCompositorBlur.js'

const { Fn, ivec2, rtt, select, uniform, uv, vec4 } = TSL as unknown as Record<
  'Fn' | 'ivec2' | 'rtt' | 'select' | 'uniform' | 'uv' | 'vec4', (...values: TslEffectNode[]) => TslEffectNode>

export type CropModel = 'modern-int-mask-v1' | 'legacy-int-mask-v1' | 'legacy-relative-mask-v1'

/** Integer lower-inclusive/upper-exclusive bounds, before output realization. */
export function compositorCropBounds(model: unknown, rectangle: unknown, width: number, height: number): [number, number, number, number] {
  if (typeof model !== 'string' || !['modern-int-mask-v1', 'legacy-int-mask-v1', 'legacy-relative-mask-v1'].includes(model)
    || !Array.isArray(rectangle) || rectangle.length !== 4
    || rectangle.some(value => typeof value !== 'number' || !Number.isFinite(value)
      || Math.abs(value) > 1048576 || (model === 'legacy-relative-mask-v1' ? value < 0 || value > 1 || Math.fround(value) !== value : !Number.isInteger(value) || model === 'legacy-int-mask-v1' && value < 0)))
    throw new Error('Crop requires its verified bounded native transparent-mask rectangle')
  if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 1 || Math.max(width, height) > 8192)
    throw new Error('Crop requires a finite nonempty input canvas of at most 8192 pixels per axis')
  const r = rectangle as number[]
  if (model === 'modern-int-mask-v1') {
    const x = Math.max(0, Math.min(r[0]!, width - 1)), y = Math.max(0, Math.min(r[1]!, height - 1))
    return [x, y, Math.min(width, x + Math.max(1, r[2]!)), Math.min(height, y + Math.max(1, r[3]!))]
  }
  const [x0, y0, x1, y1] = r.map((value, index) => model === 'legacy-relative-mask-v1'
    ? Math.trunc(Math.fround(value * (index % 2 === 0 ? width : height))) : Math.min(value, index % 2 === 0 ? width : height))
  // Blender updates lower first, then upper. Reversed boundaries collapse;
  // they are not swapped into a visible rectangle.
  return [Math.min(x0!, x1!), Math.min(y0!, y1!), x1!, y1!]
}

export function buildCompositorCrop(op: SourceCompositorOperation, input: TslEffectNode, single: boolean,
  domain: CompositorImageOrigin | null, resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  const model = op.properties.crop_model, rectangle = op.properties.crop_rectangle
  try { compositorCropBounds(model, rectangle, 1, 1) } catch (error) { return fail((error as Error).message) }
  if (op.type !== 'RGBA' || op.inputs.Image?.value.type !== 'RGBA'
    || op.inputs.Image.value.kind === 'convert' && op.inputs.Image.value.fromType !== 'RGBA'
    || !['CPU', 'GPU'].includes(String(op.properties.evaluation_device)))
    return fail('Crop requires a Color image and a verified native compositor device')
  if (domain?.x || domain?.y || domain?.affineMatrix)
    return fail('Crop after translated/affine images requires native input-local window realization')
  if (single) {
    if (model !== 'modern-int-mask-v1' && op.properties.evaluation_device === 'CPU')
      return fail('Legacy CPU Crop requires a finite image input; constant-image canvas evaluation remains unqualified')
    return input
  }
  if (!domain) return fail('Crop requires a verified finite image domain')
  const window = domain.staticWindow
  const image = rtt(input, window?.width ?? 1, window?.height ?? 1, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(image))
  const dimensions = uniform(new Vector2(1, 1)), lower = uniform(new Vector2()), upper = uniform(new Vector2())
  const update = image.updateBefore.bind(image), size = new Vector2(), viewport = new Vector4(), scissor = new Vector4()
  let previousWidth = 0, previousHeight = 0
  image.updateBefore = (frame: TslEffectNode): void => {
    const renderer = frame.renderer
    renderer.getViewport(viewport); renderer.getScissor(scissor)
    const state = RendererUtils.resetRendererState(renderer, undefined as never)
    try {
      if (window) size.set(window.width, window.height)
      else {
        renderer.getDrawingBufferSize(size)
        validateCompositorExtent(domain, renderer, size.x, size.y, fail)
      }
      if (size.x !== previousWidth || size.y !== previousHeight) {
        let bounds: [number, number, number, number]
        try { bounds = compositorCropBounds(model, rectangle, size.x, size.y) } catch (error) { return fail((error as Error).message) }
        dimensions.value.copy(size); lower.value.set(bounds[0], bounds[1]); upper.value.set(bounds[2], bounds[3])
        image.setSize(size.x, size.y); previousWidth = size.x; previousHeight = size.y
      }
      update(frame)
    } finally {
      RendererUtils.restoreRendererState(renderer, state)
      renderer.setViewport(viewport); renderer.setScissor(scissor)
    }
  }
  return Fn(() => {
    const position = ivec2(uv().mul(dimensions))
    const inside = position.x.greaterThanEqual(lower.x).and(position.y.greaterThanEqual(lower.y))
      .and(position.x.lessThan(upper.x)).and(position.y.lessThan(upper.y))
    return select(inside, image.load(position), vec4(0))
  })()
}
