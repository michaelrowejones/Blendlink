import { DataTexture, FloatType, RGBAFormat, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'
import { ownBlurRtt } from './tslCompositorBlur.js'
import { compositorFma32 } from './tslCompositorFma.js'
export { compositorFma32 } from './tslCompositorFma.js'

const { Fn, clamp, int, ivec2, rtt, select, textureLoad, textureSize, uv, vec4 } = TSL as unknown as Record<
  'Fn' | 'clamp' | 'int' | 'ivec2' | 'rtt' | 'select' | 'textureLoad' | 'textureSize' | 'uv' | 'vec4',
  (...args: TslEffectNode[]) => TslEffectNode>

export type CompositorSamplingModel = 'modern-cpu-v1' | 'modern-metal-v1' | 'legacy-cpu-v1' | 'legacy-metal-v1'
export interface CompositorSampling {
  model: CompositorSamplingModel
  interpolation: 'Nearest' | 'Bilinear'
}
export const COMPOSITOR_RESAMPLE_MAX_EXTENT = 8192
const F = Math.fround, add = (a: number, b: number): number => F(a + b),
  sub = (a: number, b: number): number => F(a - b), mul = (a: number, b: number): number => F(a * b)

/** Blender BLI_math_interp.hh, COM_TranslateOperation and realize_on_domain.
 * The table stores the two *independently rounded* native neighbor indices,
 * fraction, and the legacy CPU's pre-interpolation finite-window mask. */
export function compositorAxisMapping(size: number, from: number, to: number, sampling: CompositorSampling,
  legacyLocalDelta?: number): Float32Array {
  if (!Number.isInteger(size) || size < 1 || size > COMPOSITOR_RESAMPLE_MAX_EXTENT)
    throw new Error('Compositor resampling requires an image extent between 1 and 8192 pixels per axis')
  const result = new Float32Array(size * 4), half = F(size * .5), reciprocal = F(1 / size)
  const nearest = sampling.interpolation === 'Nearest'
  const inputOffset = nearest ? add(-half, F(2 ** -23 * 10000)) : -half
  const relative = add(-add(from, inputOffset), sub(to, half))
  const translation = add(mul(reciprocal, .5), mul(reciprocal, relative))
  for (let index = 0; index < size; index++) {
    let coordinate: number, valid = true, nearestIndex: number | undefined
    if (legacyLocalDelta !== undefined) {
      const delta = nearest ? Math.sign(legacyLocalDelta) * Math.floor(Math.abs(legacyLocalDelta) + .5) : legacyLocalDelta
      coordinate = add(sub(index, delta), Math.trunc(legacyLocalDelta))
      if (nearest) nearestIndex = Math.floor(coordinate)
      valid = coordinate >= 0 && coordinate < size
    } else if (sampling.model === 'legacy-cpu-v1') {
      coordinate = sub(index, sub(from, to))
    } else {
      let normalized: number
      if (sampling.model === 'legacy-metal-v1') {
        const shift = -add(sub(sub(from, to), half), half)
        normalized = mul(add(add(index, .5), shift), reciprocal)
      } else normalized = sampling.model === 'modern-metal-v1'
        ? compositorFma32(reciprocal, index, translation) : add(mul(reciprocal, index), translation)
      const unshifted = mul(normalized, size)
      if (nearest) nearestIndex = Math.floor(unshifted)
      coordinate = sampling.model.endsWith('metal-v1') && sampling.interpolation === 'Bilinear'
        ? Math.floor(unshifted * 256 + .5) / 256 - .5 : sub(unshifted, .5)
    }
    const lower = nearest ? nearestIndex ?? Math.floor(add(coordinate, .5)) : Math.floor(coordinate)
    const upper = nearest ? lower : sampling.model.endsWith('cpu-v1') ? Math.floor(add(coordinate, 1)) : lower + 1
    result.set([lower, upper, nearest ? 0 : sub(coordinate, lower), valid ? 1 : 0], index * 4)
  }
  return result
}

/** Materialize a raw finite field before remapping it. Returning an Fn producer
 * prevents a later .load() from replacing this operation's own coordinates. */
export function resampleCompositorField(input: TslEffectNode, from: readonly [number, number], to: readonly [number, number],
  sampling: CompositorSampling, resources: { dispose(): void }[],
  validateExtent: (renderer: TslEffectNode, width: number, height: number) => void,
  fail: (message: string) => never, legacyLocalDelta?: readonly [number, number]): TslEffectNode {
  const image = rtt(input, 1, 1, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(image))
  const tables = [0, 1].map(() => {
    const data = new Float32Array(COMPOSITOR_RESAMPLE_MAX_EXTENT * 4)
    const texture = new DataTexture(data, 256, COMPOSITOR_RESAMPLE_MAX_EXTENT / 256, RGBAFormat, FloatType)
    texture.needsUpdate = true
    let disposed = false
    resources.push({ dispose() { if (!disposed) { disposed = true; texture.dispose() } } })
    return { data, texture }
  })
  let lastWidth = 0, lastHeight = 0
  const updateBefore = image.updateBefore.bind(image), size = new Vector2(), viewport = new Vector4(), scissor = new Vector4()
  image.updateBefore = (frame: TslEffectNode): void => {
    const renderer = frame.renderer
    renderer.getViewport(viewport); renderer.getScissor(scissor)
    const state = RendererUtils.resetRendererState(renderer, undefined as never)
    try {
      renderer.getDrawingBufferSize(size)
      validateExtent(renderer, size.x, size.y)
      if (size.x !== lastWidth || size.y !== lastHeight) {
        // Validate both axes before changing resources; an invalid responsive
        // extent can recover on the next supported render without recompiling.
        let next: Float32Array[]
        try { next = [size.x, size.y].map((extent, axis) => compositorAxisMapping(extent,
          from[axis]!, to[axis]!, sampling, legacyLocalDelta?.[axis])) }
        catch (error) { return fail((error as Error).message) }
        next.forEach((mapping, axis) => { tables[axis]!.data.set(mapping); tables[axis]!.texture.needsUpdate = true })
        image.setSize(size.x, size.y)
        lastWidth = size.x; lastHeight = size.y
      }
      updateBefore(frame)
    } finally {
      RendererUtils.restoreRendererState(renderer, state)
      renderer.setViewport(viewport); renderer.setScissor(scissor)
    }
  }
  return Fn(() => {
    const dimensions = ivec2(textureSize(image)), coordinate = ivec2(uv().mul(dimensions))
    const mapping = (axis: number, index: TslEffectNode): TslEffectNode =>
      textureLoad(tables[axis]!.texture, ivec2(index.mod(int(256)), index.div(int(256))))
    const x = mapping(0, coordinate.x).toVar(), y = mapping(1, coordinate.y).toVar()
    const load = (px: TslEffectNode, py: TslEffectNode): TslEffectNode => {
      const index = ivec2(int(px), int(py))
      const inside = index.x.greaterThanEqual(0).and(index.y.greaterThanEqual(0))
        .and(index.x.lessThan(dimensions.x)).and(index.y.lessThan(dimensions.y))
      return select(inside, image.load(clamp(index, ivec2(0), dimensions.sub(1))), vec4(0))
    }
    if (sampling.interpolation === 'Nearest') return select(x.w.mul(y.w).equal(0), vec4(0), load(x.x, y.x))
    const a = load(x.x, y.x), b = load(x.y, y.x), c = load(x.x, y.y), d = load(x.y, y.y)
    const left = x.z.oneMinus(), bottom = y.z.oneMinus()
    // Native CPU RGBA interpolation has two rounded horizontal product pairs.
    // GPU uses a fixed-function four-tap dot. Independent references bound the
    // remaining device output rounding rather than borrowing image-node rules.
    return select(x.w.mul(y.w).equal(0), vec4(0),
      a.mul(left.mul(bottom)).add(b.mul(x.z.mul(bottom)))
        .add(c.mul(left.mul(y.z)).add(d.mul(x.z.mul(y.z)))))
  })()
}
