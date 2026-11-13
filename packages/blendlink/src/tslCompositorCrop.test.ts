import { describe, expect, it, vi } from 'vitest'
import { DataTexture, RenderTarget } from 'three'
import { NodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'
import { compositorCropBounds } from './tslCompositorCrop.js'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{ id: 'crop', kind: 'alpha-crop', type: 'RGBA',
    source: { path: ['Compositor'], node: 'Artist Crop', nodeType: 'CompositorNodeCrop', output: 'Image' },
    properties: { crop_model: 'modern-int-mask-v1', crop_rectangle: [2, 1, 4, 3], evaluation_device: 'CPU' },
    inputs: { Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [-.25, .5, 2, 0] } } },
  }], output: { kind: 'ref', type: 'RGBA', node: 'crop' } }
}

describe('native transparent Crop contract', () => {
  it('uses modern clamped lower positions and at least one pixel per axis', () => {
    expect(compositorCropBounds('modern-int-mask-v1', [-2, 10, 0, -4], 8, 8)).toEqual([0, 7, 1, 8])
    expect(compositorCropBounds('modern-int-mask-v1', [6, 2, 6, 4], 8, 8)).toEqual([6, 2, 8, 6])
  })
  it('preserves legacy empty/reversed boundaries and truncates relative float32 products', () => {
    expect(compositorCropBounds('legacy-int-mask-v1', [6, 7, 2, 3], 8, 8)).toEqual([2, 3, 2, 3])
    expect(compositorCropBounds('legacy-relative-mask-v1', [.25, .125, .75, .5], 13, 7)).toEqual([3, 0, 9, 3])
    expect(compositorCropBounds('legacy-int-mask-v1', [20, 1, 30, 4], 8, 8)).toEqual([8, 1, 8, 4])
  })
  it('keeps native modern and legacy GPU single-value identity', () => {
    for (const [model, device] of [['modern-int-mask-v1', 'CPU'], ['modern-int-mask-v1', 'GPU'], ['legacy-int-mask-v1', 'GPU']]) {
      const graph = program(); Object.assign(graph.ops[0]!.properties, { crop_model: model, evaluation_device: device })
      const built = buildSourceCompositor(graph, () => null)
      expect(built.node.isNode).toBe(true); built.dispose(); built.dispose()
    }
  })
  it('refuses unknown profiles, malformed rectangles, unqualified constant canvases and devices', () => {
    for (const patch of [{ crop_model: 'future' }, { crop_rectangle: [0, 0, 1] }, { crop_rectangle: [0, 0, Infinity, 1] },
      { crop_rectangle: [0, 0, .5, 1] }, { crop_model: 'legacy-relative-mask-v1', crop_rectangle: [0, 0, 2, 1] },
      { crop_model: 'legacy-int-mask-v1', evaluation_device: 'CPU' }, { evaluation_device: 'future' }]) {
      const graph = program(); Object.assign(graph.ops[0]!.properties, patch)
      expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Crop/)
    }
    for (const size of [[0, 1], [1, 8193], [NaN, 1]])
      expect(() => compositorCropBounds('modern-int-mask-v1', [0, 0, 1, 1], size[0]!, size[1]!)).toThrow(/canvas/)
  })
  it('owns materialization resources once, preserves the caller document and borrows the source on success or late failure', () => {
    const target = vi.spyOn(RenderTarget.prototype, 'dispose'), material = vi.spyOn(NodeMaterial.prototype, 'dispose')
    const texture = new DataTexture(), borrowed = vi.spyOn(texture, 'dispose')
    const graph = program(), request = { scene: 'Scene', viewLayer: 'ViewLayer', pass: 'Image', name: 'Image', type: 'RGBA' }
    graph.ops.unshift({ id: 'source', kind: 'render-pass', type: 'RGBA', inputs: {}, properties: {}, pass: request,
      source: { path: ['Compositor'], node: 'Render Layers', nodeType: 'CompositorNodeRLayers', output: 'Image' } })
    graph.passes = [request]; graph.ops[1]!.inputs.Image!.value = { kind: 'ref', type: 'RGBA', node: 'source' }
    const before = JSON.stringify(graph)
    try {
      const built = buildSourceCompositor(graph, () => TSL.texture(texture)); built.dispose(); built.dispose()
      expect(target).toHaveBeenCalledTimes(2); expect(material).toHaveBeenCalledTimes(2)
      expect(borrowed).not.toHaveBeenCalled(); expect(JSON.stringify(graph)).toBe(before)
      const broken = structuredClone(graph)
      broken.ops.push({ ...broken.ops[1]!, id: 'invalid', properties: { ...broken.ops[1]!.properties, crop_model: 'future' },
        inputs: { Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'ref', type: 'RGBA', node: 'crop' } } } })
      broken.output = { kind: 'ref', type: 'RGBA', node: 'invalid' }
      expect(() => buildSourceCompositor(broken, () => TSL.texture(texture))).toThrow(/Artist Crop/)
      expect(target).toHaveBeenCalledTimes(3); expect(material).toHaveBeenCalledTimes(3); expect(borrowed).not.toHaveBeenCalled()
    } finally { target.mockRestore(); material.mockRestore(); borrowed.mockRestore(); texture.dispose() }
  })
})
