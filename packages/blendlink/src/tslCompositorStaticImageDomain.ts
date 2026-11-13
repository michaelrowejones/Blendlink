import { DataTexture, FloatType, RGBAFormat, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'
import { ownBlurRtt } from './tslCompositorBlur.js'
import { staticImageAxisMappings, type StaticCompositorWindow } from './tslCompositorStaticImage.js'

const { Fn, If, bitcast, clamp, int, ivec2, rtt, select, textureLoad, uint, uniform, uv, vec4 } = TSL as unknown as Record<
  'Fn' | 'If' | 'bitcast' | 'clamp' | 'int' | 'ivec2' | 'rtt' | 'select' | 'textureLoad' | 'uint' | 'uniform' | 'uv' | 'vec4',
  (...args: TslEffectNode[]) => TslEffectNode>

/** Public RTT flags cache the native input per renderer. Context restoration
 * invalidates that renderer only; every listener belongs to this graph. */
export function cacheStaticCompositorRtt(image: TslEffectNode, resources: { dispose(): void }[]): void {
  image.autoUpdate = false
  const states = new WeakMap<object, { dirty: boolean }>(), listeners: Array<() => void> = []
  let disposed = false
  resources.push({ dispose() { if (!disposed) { disposed = true; for (const remove of listeners.splice(0)) remove() } } })
  const update = image.updateBefore.bind(image)
  image.updateBefore = (frame: TslEffectNode): void => {
    if (disposed) throw new Error('Static Image RTT has been disposed')
    const renderer = frame.renderer
    let state = states.get(renderer)
    if (!state) {
      state = { dirty: true }; states.set(renderer, state)
      const canvas = renderer.domElement, current = state
      if (typeof canvas?.addEventListener === 'function') {
        const invalidate = (): void => { current.dirty = true }
        canvas.addEventListener('webglcontextrestored', invalidate)
        listeners.push(() => canvas.removeEventListener('webglcontextrestored', invalidate))
      }
    }
    if (state.dirty) image.textureNeedsUpdate = true
    update(frame)
    state.dirty = false
  }
}

/** Pointwise evaluation stays on the finite native image canvas. Realization
 * into the live output viewport happens once, after that processing. */
export function realizeStaticCompositorWindow(input: TslEffectNode, window: StaticCompositorWindow,
  resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  const image = rtt(input, window.width, window.height, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(image))
  if (window.cache) cacheStaticCompositorRtt(image, resources)
  const tables = [0, 1].map(() => {
    const data = new Float32Array(8192 * 4), texture = new DataTexture(data, 256, 32, RGBAFormat, FloatType)
    texture.needsUpdate = true
    let disposed = false
    resources.push({ dispose() { if (!disposed) { disposed = true; texture.dispose() } } })
    return { data, texture }
  })
  const outputSize = uniform(new Vector2(1, 1)), identity = uniform(false, 'bool'), mask = uniform(0x7fc00000, 'uint')
  let previousWidth = 0, previousHeight = 0
  const updateBefore = image.updateBefore.bind(image), size = new Vector2(), viewport = new Vector4(), scissor = new Vector4()
  image.updateBefore = (frame: TslEffectNode): void => {
    const renderer = frame.renderer
    renderer.getViewport(viewport); renderer.getScissor(scissor)
    const state = RendererUtils.resetRendererState(renderer, undefined as never)
    try {
      renderer.getDrawingBufferSize(size)
      if (size.x !== previousWidth || size.y !== previousHeight) {
        let next: [Float32Array, Float32Array]
        try { next = staticImageAxisMappings(window, size.x, size.y) }
        catch (error) { return fail((error as Error).message) }
        next.forEach((data, axis) => { tables[axis]!.data.set(data); tables[axis]!.texture.needsUpdate = true })
        outputSize.value.set(size.x, size.y)
        identity.value = size.x === window.width && size.y === window.height
        previousWidth = size.x; previousHeight = size.y
      }
      updateBefore(frame)
    } finally {
      RendererUtils.restoreRendererState(renderer, state)
      renderer.setViewport(viewport); renderer.setScissor(scissor)
    }
  }
  return Fn(() => {
    const coordinate = ivec2(uv().mul(outputSize))
    const result = vec4(0).toVar()
    // Native realization returns the input unchanged on equal domains. This
    // uniform branch avoids four taps/Float32 stages on every identity pixel;
    // eager select would still evaluate those expensive unequal-window terms.
    If(identity, () => { result.assign(image.load(coordinate)) }).Else(() => {
      const mapping = (axis: number, index: TslEffectNode) =>
        textureLoad(tables[axis]!.texture, ivec2(index.mod(int(256)), index.div(int(256))))
      const x = mapping(0, coordinate.x).toVar(), y = mapping(1, coordinate.y).toVar()
      const load = (px: TslEffectNode, py: TslEffectNode): TslEffectNode => {
        const index = ivec2(int(px), int(py)), dimensions = ivec2(window.width, window.height)
        const inside = index.x.greaterThanEqual(0).and(index.y.greaterThanEqual(0))
          .and(index.x.lessThan(dimensions.x)).and(index.y.lessThan(dimensions.y))
        return select(inside, image.load(clamp(index, ivec2(0), dimensions.sub(1))), vec4(0))
      }
      const rounded = (value: TslEffectNode): TslEffectNode => {
        const bits = bitcast(value, 'uint').toVar()
        return bitcast(select(bits.equal(mask), uint(0), bits), 'float').toVar()
      }
      const left = rounded(x.z.oneMinus()), bottom = rounded(y.z.oneMinus())
      const weights = [rounded(left.mul(bottom)), rounded(x.z.mul(bottom)), rounded(left.mul(y.z)), rounded(x.z.mul(y.z))]
      const a = load(x.x, y.x), b = load(x.y, y.x), c = load(x.x, y.y), d = load(x.y, y.y)
      const channel = (name: string) => rounded(rounded(rounded(a[name].mul(weights[0])).add(rounded(b[name].mul(weights[1]))))
        .add(rounded(rounded(c[name].mul(weights[2])).add(rounded(d[name].mul(weights[3]))))))
      result.assign(vec4(channel('r'), channel('g'), channel('b'), channel('a')))
    })
    return result
  })()
}
