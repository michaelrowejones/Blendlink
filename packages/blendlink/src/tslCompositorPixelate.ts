import { FloatType, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import type { CompositorImageOrigin } from './tslCompositorImageDomain.js'
import { validateCompositorExtent } from './tslCompositorImageDomain.js'
import { ownBlurRtt } from './tslCompositorBlur.js'

const { Fn, Loop, float, int, ivec2, min, rtt, uniform, uv, vec4 } = TSL as unknown as Record<
  'Fn' | 'Loop' | 'float' | 'int' | 'ivec2' | 'min' | 'rtt' | 'uniform' | 'uv' | 'vec4',
  (...values: TslEffectNode[]) => TslEffectNode>

export function pixelateSize(op: SourceCompositorOperation): number {
  const size = op.properties.pixelate_size
  if (op.properties.pixelate_model !== 'native-block-mean-v1'
    || !['CPU', 'GPU'].includes(String(op.properties.evaluation_device))
    || !Number.isInteger(size) || Number(size) < 1 || Number(size) > 16)
    throw new Error('Pixelate requires its verified fixed integer block model and Size 1..16')
  return size as number
}

/** Compute each block once, then copy its mean with exact integer loads.
 * This keeps the sampling work linear in input pixels, including partial edge
 * blocks, instead of recomputing a full neighborhood at every output pixel. */
export function buildCompositorPixelate(op: SourceCompositorOperation, input: TslEffectNode, single: boolean,
  domain: CompositorImageOrigin | null, resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  let size: number
  try { size = pixelateSize(op) } catch (error) { return fail((error as Error).message) }
  if (op.type !== 'RGBA' || op.inputs.Color?.value.type !== 'RGBA'
    || op.inputs.Color.value.kind === 'convert' && op.inputs.Color.value.fromType !== 'RGBA')
    return fail('Pixelate currently requires a Color image without scalar/vector conversion')
  if (single || size === 1) return input
  if (!domain || domain.x !== 0 || domain.y !== 0 || domain.affineMatrix || domain.staticWindow || domain.croppedWindow)
    return fail('Pixelate requires an unshifted verified render canvas')
  const physical = new Vector2(), dimensions = uniform(new Vector2(1, 1)), blocks = uniform(new Vector2(1, 1))
  const image = rtt(input, 1, 1, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(image))
  const mean = rtt(Fn(() => {
    const origin = ivec2(uv().mul(blocks)).mul(int(size)), end = min(origin.add(ivec2(size)), ivec2(dimensions))
    const sum = vec4(0).toVar()
    Loop({ start: origin.y, end: end.y, type: 'int', condition: '<', name: 'row' }, ({ row }: TslEffectNode) => {
      Loop({ start: origin.x, end: end.x, type: 'int', condition: '<', name: 'column' }, ({ column }: TslEffectNode) => {
        sum.addAssign(image.load(ivec2(column, row)))
      })
    })
    const count = end.sub(origin)
    return sum.div(float(count.x.mul(count.y)))
  })(), 1, 1, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(mean))
  let previous = ''
  const updateExtent = (renderer: TslEffectNode): void => {
    renderer.getDrawingBufferSize(physical)
    validateCompositorExtent(domain, renderer, physical.x, physical.y, fail)
    if (physical.x < 1 || physical.y < 1 || physical.x > 8192 || physical.y > 8192
      || !Number.isInteger(physical.x) || !Number.isInteger(physical.y)) return fail('Pixelate requires finite render extents 1..8192 per axis')
    const next = physical.x + ':' + physical.y
    if (next === previous) return
    dimensions.value.copy(physical); blocks.value.set(Math.ceil(physical.x / size), Math.ceil(physical.y / size))
    image.setSize(physical.x, physical.y); mean.setSize(blocks.value.x, blocks.value.y); previous = next
  }
  for (const pass of [image, mean]) {
    const update = pass.updateBefore.bind(pass), viewport = new Vector4(), scissor = new Vector4()
    pass.updateBefore = (frame: TslEffectNode): void => {
      const renderer = frame.renderer
      renderer.getViewport(viewport); renderer.getScissor(scissor)
      const state = RendererUtils.resetRendererState(renderer, undefined as never)
      try { updateExtent(renderer); update(frame) }
      finally { RendererUtils.restoreRendererState(renderer, state); renderer.setViewport(viewport); renderer.setScissor(scissor) }
    }
  }
  return Fn(() => mean.load(ivec2(uv().mul(dimensions)).div(int(size))))()
}
