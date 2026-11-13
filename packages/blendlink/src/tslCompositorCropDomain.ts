import { DataTexture, FloatType, RGBAFormat, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'
import { ownBlurRtt } from './tslCompositorBlur.js'
import { staticImageAxisMappings, type StaticCompositorWindow } from './tslCompositorStaticImage.js'

const { Fn, bitcast, clamp, int, ivec2, rtt, select, textureLoad, uint, uniform, uv, vec4 } = TSL as unknown as Record<
  'Fn' | 'bitcast' | 'clamp' | 'int' | 'ivec2' | 'rtt' | 'select' | 'textureLoad' | 'uint' | 'uniform' | 'uv' | 'vec4',
  (...values: TslEffectNode[]) => TslEffectNode>

/** A post-Crop data canvas, resolved independently of the output viewport. */
export interface CroppedCompositorWindow {
  resolve(renderer: TslEffectNode): StaticCompositorWindow
}

/** Modern CPU RealizeOnDomain: preserve the finite canvas through pointwise
 * processing, then center/crop/pad it once in the actual physical viewport. */
export function realizeCroppedCompositorWindow(input: TslEffectNode, window: CroppedCompositorWindow,
  resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  const image = rtt(input, 1, 1, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(image))
  const tables = [0, 1].map(() => {
    const data = new Float32Array(8192 * 4), texture = new DataTexture(data, 256, 32, RGBAFormat, FloatType)
    texture.needsUpdate = true
    let disposed = false
    resources.push({ dispose() { if (!disposed) { disposed = true; texture.dispose() } } })
    return { data, texture }
  })
  const outputSize = uniform(new Vector2(1, 1)), inputSize = uniform(new Vector2(1, 1)), mask = uniform(0x7fc00000, 'uint')
  let previous = ''
  const update = image.updateBefore.bind(image), size = new Vector2(), viewport = new Vector4(), scissor = new Vector4()
  image.updateBefore = (frame: TslEffectNode): void => {
    const renderer = frame.renderer
    renderer.getViewport(viewport); renderer.getScissor(scissor)
    const state = RendererUtils.resetRendererState(renderer, undefined as never)
    try {
      renderer.getDrawingBufferSize(size)
      const native = window.resolve(renderer)
      if (native.model !== 'modern-cpu-v1') return fail('Resized Crop requires its modern CPU finite-window realization model')
      const next = [native.width, native.height, size.x, size.y].join(':')
      if (next !== previous) {
        let mappings: [Float32Array, Float32Array]
        try { mappings = staticImageAxisMappings(native, size.x, size.y) } catch (error) { return fail((error as Error).message) }
        mappings.forEach((values, axis) => { tables[axis]!.data.set(values); tables[axis]!.texture.needsUpdate = true })
        inputSize.value.set(native.width, native.height); outputSize.value.copy(size)
        image.setSize(native.width, native.height); previous = next
      }
      update(frame)
    } finally {
      RendererUtils.restoreRendererState(renderer, state)
      renderer.setViewport(viewport); renderer.setScissor(scissor)
    }
  }
  return Fn(() => {
    const coordinate = ivec2(uv().mul(outputSize))
    const mapping = (axis: number, index: TslEffectNode) => textureLoad(tables[axis]!.texture, ivec2(index.mod(int(256)), index.div(int(256))))
    const x = mapping(0, coordinate.x).toVar(), y = mapping(1, coordinate.y).toVar()
    const load = (px: TslEffectNode, py: TslEffectNode): TslEffectNode => {
      const index = ivec2(int(px), int(py)), dimensions = ivec2(inputSize)
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
    return vec4(channel('r'), channel('g'), channel('b'), channel('a'))
  })()
}
