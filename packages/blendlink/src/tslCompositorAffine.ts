import { DataTexture, FloatType, RGBAFormat, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'
import { ownBlurRtt } from './tslCompositorBlur.js'
import { buildCompositorCoordinateFma } from './tslCompositorCoordinateFma.js'
import { compositorAffineSamplingMatrix, type CompositorAffineMatrix } from './tslCompositorAffineMath.js'
import type { CompositorSampling } from './tslCompositorResampling.js'

const { Fn, bitcast, clamp, float, floor, int, ivec2, rtt, select, textureLoad, textureSize, uint, uniform, uv, vec4 } = TSL as unknown as Record<
  'Fn' | 'bitcast' | 'clamp' | 'float' | 'floor' | 'int' | 'ivec2' | 'rtt' | 'select' | 'textureLoad' | 'textureSize' | 'uint' | 'uniform' | 'uv' | 'vec4',
  (...args: TslEffectNode[]) => TslEffectNode>

/** Full-frame terminal affine realization. Intermediate resized data/display
 * windows deliberately remain a separate, qualified contract. */
export function resampleCompositorAffine(input: TslEffectNode, matrix: CompositorAffineMatrix, to: readonly [number, number],
  sampling: CompositorSampling, resources: { dispose(): void }[],
  validateExtent: (renderer: TslEffectNode, width: number, height: number) => void,
  fail: (message: string) => never): TslEffectNode {
  if (!['modern-cpu-v1', 'modern-metal-v1'].includes(sampling.model))
    return fail('Affine realization requires its verified modern CPU/Metal sampling model')
  const image = rtt(input, 1, 1, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(image))
  const cpu = sampling.model === 'modern-cpu-v1', nearest = sampling.interpolation === 'Nearest'
  const coefficients = [0, 0, 0, 0, 0, 0].map(value => uniform(value))
  // CPU scalar products are independently rounded before either addition.
  // Two axis product pairs share one small table; it changes only on resize.
  const data = cpu ? new Float32Array(8192 * 4) : undefined
  const table = data ? new DataTexture(data, 256, 32, RGBAFormat, FloatType) : undefined
  if (table) table.needsUpdate = true
  let disposed = false
  if (table) resources.push({ dispose() { if (!disposed) { disposed = true; table.dispose() } } })
  let lastWidth = 0, lastHeight = 0
  const updateBefore = image.updateBefore.bind(image), size = new Vector2(), viewport = new Vector4(), scissor = new Vector4()
  image.updateBefore = (frame: TslEffectNode): void => {
    const renderer = frame.renderer
    renderer.getViewport(viewport); renderer.getScissor(scissor)
    const state = RendererUtils.resetRendererState(renderer, undefined as never)
    try {
      renderer.getDrawingBufferSize(size)
      validateExtent(renderer, size.x, size.y)
      if (!Number.isInteger(size.x) || !Number.isInteger(size.y) || Math.min(size.x, size.y) < 1 || Math.max(size.x, size.y) > 8192)
        fail('Affine realization requires image extents between 1 and 8192 pixels per axis')
      if (size.x !== lastWidth || size.y !== lastHeight) {
        const dimensions = [size.x, size.y] as const
        const base = { dataSize: dimensions, displaySize: dimensions, dataOffset: [0, 0] as const }
        const m = compositorAffineSamplingMatrix({ ...base, matrix },
          { ...base, matrix: [1, 0, to[0], 0, 1, to[1], 0, 0, 1] }, nearest)
        if (m.some(value => !Number.isFinite(value) || Math.abs(value) > 2 ** 24 || value !== 0 && Math.abs(value) < 2 ** -50))
          fail('Affine coordinate coefficients exceed the verified finite Float32 domain')
        coefficients.forEach((node, index) => { node.value = m[index]! })
        if (cpu) {
          for (let index = 0; index < Math.max(size.x, size.y); index++)
            data!.set([Math.fround(m[0] * index), Math.fround(m[3] * index),
              Math.fround(m[1] * index), Math.fround(m[4] * index)], index * 4)
          table!.needsUpdate = true
        }
        image.setSize(size.x, size.y)
        lastWidth = size.x; lastHeight = size.y
      }
      updateBefore(frame)
    } finally {
      RendererUtils.restoreRendererState(renderer, state)
      renderer.setViewport(viewport); renderer.setScissor(scissor)
    }
  }
  // Bit-level observation enforces an actual Float32 boundary in both shader
  // languages; it prevents a backend from contracting CPU operation pairs.
  const rounded = (value: TslEffectNode): TslEffectNode => {
    const bits = bitcast(value, 'uint').toVar()
    return bitcast(select(bits.equal(uint(0x7fc00000)), uint(0), bits), 'float').toVar()
  }
  return Fn(() => {
    const dimensions = ivec2(textureSize(image)), pixel = ivec2(uv().mul(dimensions))
    let x: TslEffectNode, y: TslEffectNode
    if (cpu) {
      const lookup = (index: TslEffectNode): TslEffectNode => textureLoad(table, ivec2(index.mod(int(256)), index.div(int(256)))).toVar()
      const px = lookup(pixel.x), py = lookup(pixel.y)
      x = rounded(rounded(px.x.add(py.z)).add(coefficients[2]))
      y = rounded(rounded(px.y.add(py.w)).add(coefficients[5]))
    } else {
      const px = float(pixel.x), py = float(pixel.y)
      x = buildCompositorCoordinateFma(coefficients[0], px, buildCompositorCoordinateFma(coefficients[1], py, coefficients[2]))
      y = buildCompositorCoordinateFma(coefficients[3], px, buildCompositorCoordinateFma(coefficients[4], py, coefficients[5]))
    }
    x = rounded(x.mul(float(dimensions.x))); y = rounded(y.mul(float(dimensions.y)))
    // Reject outside the sampling footprint before bounded integer conversion.
    const footprint = x.greaterThanEqual(nearest ? 0 : -.5).and(y.greaterThanEqual(nearest ? 0 : -.5))
      .and(x.lessThan(float(dimensions.x).add(nearest ? 0 : .5)))
      .and(y.lessThan(float(dimensions.y).add(nearest ? 0 : .5)))
    x = clamp(x, -.5, float(dimensions.x).add(.5)); y = clamp(y, -.5, float(dimensions.y).add(.5))
    const load = (px: TslEffectNode, py: TslEffectNode): TslEffectNode => {
      const index = ivec2(int(px), int(py))
      const inside = index.x.greaterThanEqual(0).and(index.y.greaterThanEqual(0))
        .and(index.x.lessThan(dimensions.x)).and(index.y.lessThan(dimensions.y))
      return select(inside, image.load(clamp(index, ivec2(0), dimensions.sub(1))), vec4(0))
    }
    if (nearest) return select(footprint, load(floor(x), floor(y)), vec4(0))
    if (!cpu) {
      // Half-up at 8 fractional bits, without rounding z+.5 across a boundary.
      const quantized = (v: TslEffectNode): TslEffectNode => {
        const scaled = v.mul(256).toVar(), whole = floor(scaled).toVar()
        return whole.add(select(scaled.sub(whole).greaterThanEqual(.5), 1, 0)).div(256).sub(.5)
      }
      x = quantized(x).toVar(); y = quantized(y).toVar()
    } else { x = rounded(x.sub(.5)); y = rounded(y.sub(.5)) }
    const ix = floor(x).toVar(), iy = floor(y).toVar()
    const jx = cpu ? floor(rounded(x.add(1))) : ix.add(1), jy = cpu ? floor(rounded(y.add(1))) : iy.add(1)
    const u = rounded(x.sub(ix)), v = rounded(y.sub(iy)), left = rounded(u.oneMinus()), bottom = rounded(v.oneMinus())
    const a = load(ix, iy), b = load(jx, iy), c = load(ix, jy), d = load(jx, jy)
    const weights = [rounded(left.mul(bottom)), rounded(u.mul(bottom)), rounded(left.mul(v)), rounded(u.mul(v))]
    if (!cpu) return select(footprint, a.mul(weights[0]).add(b.mul(weights[1])).add(c.mul(weights[2]).add(d.mul(weights[3]))), vec4(0))
    const channel = (name: string): TslEffectNode => rounded(rounded(rounded(a[name].mul(weights[0])).add(rounded(b[name].mul(weights[1]))))
      .add(rounded(rounded(c[name].mul(weights[2])).add(rounded(d[name].mul(weights[3]))))))
    return select(footprint, vec4(channel('r'), channel('g'), channel('b'), channel('a')), vec4(0))
  })()
}
