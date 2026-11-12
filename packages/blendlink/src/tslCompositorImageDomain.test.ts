import { describe, expect, it, vi } from 'vitest'
import { DataTexture, RenderTarget } from 'three'
import { NodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'
import { mergeImageOrigins, translatedImageOrigin } from './tslCompositorImageDomain.js'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorOperation, SourceCompositorProgram } from './sourceDisplay.js'

const fail = (message: string): never => { throw new Error(message) }
const operation = (): SourceCompositorOperation => ({ id: 'translation', kind: 'translate', type: 'RGBA',
  source: { path: ['Compositor'], node: 'Artist Translation', nodeType: 'CompositorNodeTranslate', output: 'Image' },
  properties: { image_domain_model: 'deferred-integer-origin-v1', image_translation: [2, -1] },
  inputs: { Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'ref', type: 'RGBA', node: 'source' } } } })

describe('deferred compositor image origins', () => {
  it('composes inverse translations without cropping the field between them', () => {
    const root = { node: TSL.vec4(1) }, input = { x: 0, y: 0, roots: [root] }, op = operation()
    op.properties.image_translation = [8192, -8192]
    const moved = translatedImageOrigin(op, input, fail)!
    op.properties.image_translation = [-8192, 8192]
    expect(translatedImageOrigin(op, moved, fail)).toEqual(input)
    expect(input).toEqual({ x: 0, y: 0, roots: [root] })
  })

  it('constants have no finite window and equal-origin branches retain every root extent', () => {
    const left = { node: TSL.vec4(1) }, right = { node: TSL.vec4(2) }
    expect(translatedImageOrigin(operation(), null, fail)).toBeNull()
    expect(mergeImageOrigins([null, { x: 2, y: -1, roots: [left] }, { x: 2, y: -1, roots: [right, left] }], fail))
      .toEqual({ x: 2, y: -1, roots: [left, right] })
    expect(() => mergeImageOrigins([{ x: 2, y: -1, roots: [left] }, { x: 0, y: 0, roots: [right] }], fail))
      .toThrow(/different image origins/)
  })

  it.each([{ image_domain_model: 'future' }, { image_translation: [.5, 0] }, { image_translation: [8193, 0] },
    { image_translation: [NaN, 0] }, { image_translation: [0] }])('refuses unverified origin contracts: %s', patch => {
    const op = operation(); Object.assign(op.properties, patch)
    expect(() => translatedImageOrigin(op, null, fail)).toThrow(/bounded/)
  })

  it('versions fractional accumulation and legacy CPU integer canvas origins separately', () => {
    const op = operation(), root = { node: TSL.vec4(1) }, input = { x: Math.fround(.1), y: 0, roots: [root] }
    Object.assign(op.properties, { image_domain_model: 'native-translation-v2', image_translation: [.2, -.25],
      image_sampling_model: 'modern-cpu-v1', image_interpolation: 'Bilinear' })
    expect(translatedImageOrigin(op, input, fail)).toEqual({ x: Math.fround(Math.fround(.1) + .2), y: -.25,
      roots: [root], sampling: { model: 'modern-cpu-v1', interpolation: 'Bilinear' } })
    Object.assign(op.properties, { image_translation: [1.2, -2.3], image_sampling_model: 'legacy-cpu-v1' })
    expect(translatedImageOrigin(op, { x: 0, y: 0, roots: [root] }, fail)).toEqual({ x: 1, y: -2, roots: [root],
      sampling: { model: 'legacy-cpu-v1', interpolation: 'Nearest' } })
  })

  it('refuses legacy CPU Bilinear partial canvases before creating render resources', () => {
    const op = operation(), root = { node: TSL.vec4(1) }
    Object.assign(op.properties, { image_domain_model: 'native-translation-v2', image_translation: [.1, .2],
      image_sampling_model: 'legacy-cpu-v1', image_interpolation: 'Bilinear' })
    expect(() => translatedImageOrigin(op, { x: 1, y: -1, roots: [root] }, fail)).toThrow(/area-of-interest/)
    op.source.nodeType = 'CompositorNodeTransform'
    expect(() => translatedImageOrigin(op, { x: 0, y: 0, roots: [root] }, fail)).toThrow(/area-of-interest/)
  })

  it('disposes Bilinear mapping textures and targets once while borrowing scene input', () => {
    const target = vi.spyOn(RenderTarget.prototype, 'dispose'), material = vi.spyOn(NodeMaterial.prototype, 'dispose')
    const lookup = vi.spyOn(DataTexture.prototype, 'dispose')
    const texture = new DataTexture(), borrowed = vi.fn()
    texture.addEventListener('dispose', borrowed)
    const request = { scene: 'Scene', viewLayer: 'ViewLayer', pass: 'Image', name: 'Image', type: 'RGBA' }
    const op = operation()
    Object.assign(op.properties, { image_domain_model: 'native-translation-v2', image_translation: [.5, .25],
      image_sampling_model: 'modern-cpu-v1', image_interpolation: 'Bilinear' })
    const graph: SourceCompositorProgram = { version: 1, status: 'extracted', passes: [request], diagnostics: [],
      ops: [{ id: 'source', kind: 'render-pass', type: 'RGBA', source: { path: ['Compositor'], node: 'Render Layers', nodeType: 'CompositorNodeRLayers', output: 'Image' },
        properties: {}, inputs: {}, pass: request }, op], output: { kind: 'ref', type: 'RGBA', node: 'translation' } }
    try {
      const built = buildSourceCompositor(graph, () => TSL.texture(texture))
      built.dispose(); built.dispose()
      expect(target).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1)
      expect(lookup).toHaveBeenCalledTimes(2); expect(borrowed).not.toHaveBeenCalled()
    } finally { target.mockRestore(); material.mockRestore(); texture.removeEventListener('dispose', borrowed); lookup.mockRestore(); texture.dispose() }
  })

  it('owns final realization targets/materials exactly once and borrows the source texture', () => {
    const target = vi.spyOn(RenderTarget.prototype, 'dispose'), material = vi.spyOn(NodeMaterial.prototype, 'dispose')
    const texture = new DataTexture(), borrowed = vi.spyOn(texture, 'dispose')
    const request = { scene: 'Scene', viewLayer: 'ViewLayer', pass: 'Image', name: 'Image', type: 'RGBA' }
    const graph: SourceCompositorProgram = { version: 1, status: 'extracted', passes: [request], diagnostics: [],
      ops: [{ id: 'source', kind: 'render-pass', type: 'RGBA', source: { path: ['Compositor'], node: 'Render Layers', nodeType: 'CompositorNodeRLayers', output: 'Image' },
        properties: {}, inputs: {}, pass: request }, operation()], output: { kind: 'ref', type: 'RGBA', node: 'translation' } }
    try {
      const built = buildSourceCompositor(graph, () => TSL.texture(texture))
      built.dispose(); built.dispose()
      expect(target).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1)
      expect(borrowed).not.toHaveBeenCalled()
    } finally { target.mockRestore(); material.mockRestore(); borrowed.mockRestore(); texture.dispose() }
  })
})
