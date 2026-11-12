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
    expect(() => translatedImageOrigin(op, null, fail)).toThrow(/bounded deferred integer-origin/)
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
