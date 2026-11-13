import { FloatType, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import type { CompositorImageOrigin } from './tslCompositorImageDomain.js'
import { validateCompositorExtent } from './tslCompositorImageDomain.js'
import { compositorCropBounds } from './tslCompositorCrop.js'
import { ownBlurRtt } from './tslCompositorBlur.js'

const { Fn, ivec2, rtt, uniform, uv } = TSL as unknown as Record<
  'Fn' | 'ivec2' | 'rtt' | 'uniform' | 'uv', (...values: TslEffectNode[]) => TslEffectNode>

export function buildResizedCompositorCrop(op: SourceCompositorOperation, input: TslEffectNode, single: boolean,
  domain: CompositorImageOrigin | null, resources: { dispose(): void }[], fail: (message: string) => never): {
    node: TslEffectNode, domain: CompositorImageOrigin | null
  } {
  if (op.properties.crop_model !== 'modern-cpu-size-v1' || op.properties.evaluation_device !== 'CPU'
    || op.type !== 'RGBA' || op.inputs.Image?.value.type !== 'RGBA'
    || op.inputs.Image.value.kind === 'convert' && op.inputs.Image.value.fromType !== 'RGBA')
    return fail('Resized Crop requires its verified modern CPU Color-image model')
  const authored = op.properties.crop_rectangle
  try { compositorCropBounds('modern-int-mask-v1', authored, 1, 1) } catch (error) { return fail((error as Error).message) }
  // An already installed graph keeps its own rectangle while an application
  // edits/reapplies the source document. Never mutate or freeze caller IR.
  const rectangle = (authored as number[]).slice()
  if (single) return { node: input, domain: null }
  if (!domain || domain.x !== 0 || domain.y !== 0 || domain.affineMatrix || domain.croppedWindow)
    return fail('Resized Crop requires an unshifted verified finite input canvas')
  if (domain.staticWindow && domain.staticWindow.model !== 'modern-cpu-v1')
    return fail('Resized Crop requires its modern CPU static input-window model')
  const source = domain, size = new Vector2()
  const extent = (renderer: TslEffectNode): [number, number] => {
    if (source.staticWindow) return [source.staticWindow.width, source.staticWindow.height]
    renderer.getDrawingBufferSize(size)
    validateCompositorExtent(source, renderer, size.x, size.y, fail)
    return [size.x, size.y]
  }
  const bounds = (renderer: TslEffectNode): [number, number, number, number] => {
    const [width, height] = extent(renderer)
    try { return compositorCropBounds('modern-int-mask-v1', rectangle, width, height) }
    catch (error) { return fail((error as Error).message) }
  }
  const window = { resolve(renderer: TslEffectNode) {
    const [x0, y0, x1, y1] = bounds(renderer)
    return { width: x1 - x0, height: y1 - y0, model: 'modern-cpu-v1' as const }
  } }
  const image = rtt(input, 1, 1, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(image))
  const lower = uniform(new Vector2()), dimensions = uniform(new Vector2(1, 1))
  const update = image.updateBefore.bind(image), viewport = new Vector4(), scissor = new Vector4()
  let previous = ''
  image.updateBefore = (frame: TslEffectNode): void => {
    const renderer = frame.renderer
    renderer.getViewport(viewport); renderer.getScissor(scissor)
    const state = RendererUtils.resetRendererState(renderer, undefined as never)
    try {
      const [width, height] = extent(renderer), next = width + ':' + height
      if (next !== previous) {
        const [x0, y0, x1, y1] = bounds(renderer)
        lower.value.set(x0, y0); dimensions.value.set(x1 - x0, y1 - y0)
        image.setSize(width, height); previous = next
      }
      update(frame)
    } finally {
      RendererUtils.restoreRendererState(renderer, state)
      renderer.setViewport(viewport); renderer.setScissor(scissor)
    }
  }
  const node = Fn(() => image.load(ivec2(uv().mul(dimensions)).add(ivec2(lower))))()
  return { node, domain: { ...domain, staticWindow: undefined, croppedWindow: window } }
}
