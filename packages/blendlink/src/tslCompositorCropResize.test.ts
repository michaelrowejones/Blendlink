import { describe, expect, it, vi } from 'vitest'
import { DataTexture, RenderTarget } from 'three'
import { NodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import { buildResizedCompositorCrop } from './tslCompositorCropResize.js'
import type { SourceCompositorOperation, SourceCompositorProgram } from './sourceDisplay.js'

const fail = (message: string): never => { throw new Error(message) }
function operation(): SourceCompositorOperation {
  return { id: 'crop', kind: 'image-crop', type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Crop',
    nodeType: 'CompositorNodeCrop', output: 'Image' }, properties: {
    crop_model: 'modern-cpu-size-v1', crop_rectangle: [2, 1, 4, 3], evaluation_device: 'CPU',
  }, inputs: { Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [-.25, .5, 2, 0] } } } }
}
function program(): SourceCompositorProgram {
  const pass = { scene: 'Scene', viewLayer: 'ViewLayer', pass: 'Image', name: 'Image', type: 'RGBA' }
  const crop = operation(); crop.inputs.Image!.value = { kind: 'ref', type: 'RGBA', node: 'source' }
  return { version: 1, status: 'extracted', diagnostics: [], passes: [pass], ops: [{
    id: 'source', kind: 'render-pass', type: 'RGBA', source: { ...crop.source, node: 'Render Layers', nodeType: 'CompositorNodeRLayers' },
    inputs: {}, properties: {}, pass,
  }, crop], output: { kind: 'ref', type: 'RGBA', node: 'crop' } }
}

describe('modern CPU resized Crop finite canvas', () => {
  it('preserves constant-image identity and rejects unproved profiles before allocation', () => {
    const input = TSL.vec4(-.25, .5, 2, 0), resources: { dispose(): void }[] = []
    expect(buildResizedCompositorCrop(operation(), input, true, null, resources, fail)).toEqual({ node: input, domain: null })
    for (const patch of [{ crop_model: 'future' }, { evaluation_device: 'GPU' }, { crop_rectangle: [0, 0, .5, 2] }, { crop_rectangle: [0, 0, 1] }]) {
      const op = operation(); Object.assign(op.properties, patch)
      expect(() => buildResizedCompositorCrop(op, input, true, null, resources, fail)).toThrow(/Crop/)
    }
    expect(() => buildResizedCompositorCrop(operation(), input, false, { x: 0, y: 0, roots: [],
      staticWindow: { width: 2, height: 2, model: 'legacy-cpu-even-v1' } }, resources, fail)).toThrow(/modern CPU static/)
    expect(resources).toEqual([])
  })
  it('resolves the actual post-Crop size, including source-clamped one-pixel windows', () => {
    const texture = new DataTexture(new Float32Array(8 * 8 * 4), 8, 8), input = TSL.texture(texture)
    const renderer = { getDrawingBufferSize: (size: { set(x: number, y: number): void }) => size.set(8, 8) }
    for (const [rectangle, expected] of [[[2, 1, 4, 3], [4, 3]], [[100, 100, 40, 50], [1, 1]], [[0, 0, -5, -6], [1, 1]]]) {
      const resources: { dispose(): void }[] = [], op = operation(); op.properties.crop_rectangle = rectangle
      try {
        const built = buildResizedCompositorCrop(op, input, false, { x: 0, y: 0, roots: [{ node: input }] }, resources, fail)
        const window = built.domain!.croppedWindow!.resolve(renderer)
        expect([window.width, window.height]).toEqual(expected); expect(window.model).toBe('modern-cpu-v1')
        ;(op.properties.crop_rectangle as number[])[2] = 100
        expect(built.domain!.croppedWindow!.resolve(renderer)).toEqual(window)
      } finally { resources.forEach(resource => resource.dispose()) }
    }
    texture.dispose()
  })
  it('owns its targets/materials/tables exactly once and cleans them after a later consumer fails', () => {
    const targets = vi.spyOn(RenderTarget.prototype, 'dispose'), materials = vi.spyOn(NodeMaterial.prototype, 'dispose'), tables = vi.spyOn(DataTexture.prototype, 'dispose')
    const texture = new DataTexture(), borrowed = vi.fn(), graph = program(), before = JSON.stringify(graph)
    texture.addEventListener('dispose', borrowed)
    try {
      const built = buildSourceCompositor(graph, () => TSL.texture(texture)); built.dispose(); built.dispose()
      expect(targets).toHaveBeenCalledTimes(2); expect(materials).toHaveBeenCalledTimes(2); expect(tables).toHaveBeenCalledTimes(2)
      expect(borrowed).not.toHaveBeenCalled(); expect(JSON.stringify(graph)).toBe(before)
      for (const kind of ['flip', 'translate', 'alpha-crop']) {
        const invalid = program(), next = { ...operation(), id: 'consumer', kind }
        next.inputs.Image!.value = { kind: 'ref', type: 'RGBA', node: 'crop' }; invalid.ops.push(next)
        invalid.output = { kind: 'ref', type: 'RGBA', node: 'consumer' }
        expect(() => buildSourceCompositor(invalid, () => TSL.texture(texture))).toThrow(/finite-window consumers/)
      }
      expect(targets).toHaveBeenCalledTimes(5); expect(materials).toHaveBeenCalledTimes(5); expect(tables).toHaveBeenCalledTimes(2)
      expect(borrowed).not.toHaveBeenCalled()
    } finally { targets.mockRestore(); materials.mockRestore(); tables.mockRestore(); texture.removeEventListener('dispose', borrowed); texture.dispose() }
  })
  it('refuses mixed crop/full-frame branches even with a forged domain-priority property', () => {
    const graph = program(), crop = graph.ops[1]!
    graph.ops.push({ ...crop, id: 'over', kind: 'alpha-over', properties: { image_domain_input: 'Foreground' }, inputs: {
      Background: { name: 'Background', socketType: 'RGBA', value: { kind: 'ref', type: 'RGBA', node: 'source' } },
      Foreground: { name: 'Foreground', socketType: 'RGBA', value: { kind: 'ref', type: 'RGBA', node: 'crop' } },
    } }); graph.output = { kind: 'ref', type: 'RGBA', node: 'over' }
    expect(() => buildSourceCompositor(graph, () => TSL.vec4(1))).toThrow(/different resized Crop windows/)
  })
})
