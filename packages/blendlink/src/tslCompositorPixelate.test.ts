import { describe, expect, it, vi } from 'vitest'
import { DataTexture, RenderTarget } from 'three'
import { NodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import { buildCompositorPixelate } from './tslCompositorPixelate.js'
import type { SourceCompositorOperation, SourceCompositorProgram } from './sourceDisplay.js'

const fail = (message: string): never => { throw new Error(message) }
function operation(): SourceCompositorOperation {
  return { id: 'pixelate', kind: 'pixelate', type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Pixelate',
    nodeType: 'CompositorNodePixelate', output: 'Color' }, properties: {
    pixelate_model: 'native-block-mean-v1', pixelate_size: 3, evaluation_device: 'CPU',
  }, inputs: { Color: { name: 'Color', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [-.25, .5, 2, -0] } } } }
}
function program(): SourceCompositorProgram {
  const pixelate = operation(), pass = { scene: 'Scene', viewLayer: 'ViewLayer', pass: 'Image', name: 'Image', type: 'RGBA' }
  pixelate.inputs.Color!.value = { kind: 'ref', type: 'RGBA', node: 'source' }
  return { version: 1, status: 'extracted', diagnostics: [], passes: [pass], ops: [{
    id: 'source', kind: 'render-pass', type: 'RGBA', source: { ...pixelate.source, node: 'Render Layers', nodeType: 'CompositorNodeRLayers' },
    inputs: {}, properties: {}, pass,
  }, pixelate], output: { kind: 'ref', type: 'RGBA', node: 'pixelate' } }
}

describe('native block Pixelate ownership and independent qualification', () => {
  it('shares actual single values without allocating or rewriting source', () => {
    const input = TSL.vec4(-.25, .5, 2, -0), resources: { dispose(): void }[] = []
    for (const evaluation_device of ['CPU', 'GPU']) for (const pixelate_size of [1, 3, 16]) {
      const op = operation(); Object.assign(op.properties, { evaluation_device, pixelate_size }); const before = JSON.stringify(op)
      expect(buildCompositorPixelate(op, input, true, null, resources, fail)).toBe(input)
      expect(JSON.stringify(op)).toBe(before)
    }
    expect(resources).toEqual([])
  })
  it('refuses future models, fractional controls and non-color or unsupported canvases before allocation', () => {
    const input = TSL.vec4(1), resources: { dispose(): void }[] = []
    for (const patch of [{ pixelate_model: 'future' }, { pixelate_size: 0 }, { pixelate_size: 17 }, { pixelate_size: 1.5 }, { evaluation_device: 'UNKNOWN' }]) {
      const op = operation(); Object.assign(op.properties, patch)
      expect(() => buildCompositorPixelate(op, input, true, null, resources, fail)).toThrow(/Pixelate/)
    }
    for (const domain of [null, { x: 1, y: 0, roots: [] }, { x: 0, y: 0, roots: [], staticWindow: { width: 8, height: 8, model: 'modern-cpu-v1' as const } }])
      expect(() => buildCompositorPixelate(operation(), input, false, domain, resources, fail)).toThrow(/canvas/)
    const scalar = operation(); scalar.inputs.Color!.value = { kind: 'constant', type: 'VALUE', value: 1 }
    expect(() => buildCompositorPixelate(scalar, input, true, null, resources, fail)).toThrow(/Color image/)
    expect(resources).toEqual([])
  })
  it('releases owned targets exactly once and preserves borrowed textures after a later graph refusal', () => {
    const targets = vi.spyOn(RenderTarget.prototype, 'dispose'), materials = vi.spyOn(NodeMaterial.prototype, 'dispose')
    const borrowed = new DataTexture(), released = vi.fn(), graph = program(), before = JSON.stringify(graph)
    borrowed.addEventListener('dispose', released)
    try {
      const identity = program(); identity.ops[1]!.properties.pixelate_size = 1
      const unchanged = buildSourceCompositor(identity, () => TSL.texture(borrowed)); unchanged.dispose()
      expect(targets).not.toHaveBeenCalled(); expect(materials).not.toHaveBeenCalled()
      const built = buildSourceCompositor(graph, () => TSL.texture(borrowed)); built.dispose(); built.dispose()
      expect(targets).toHaveBeenCalledTimes(3); expect(materials).toHaveBeenCalledTimes(3)
      expect(JSON.stringify(graph)).toBe(before); expect(released).not.toHaveBeenCalled()
      const invalid = program(); invalid.ops.push({ ...operation(), id: 'later', kind: 'future-operation' });
      invalid.output = { kind: 'ref', type: 'RGBA', node: 'later' }
      expect(() => buildSourceCompositor(invalid, () => TSL.texture(borrowed))).toThrow()
      expect(targets).toHaveBeenCalledTimes(5); expect(materials).toHaveBeenCalledTimes(5); expect(released).not.toHaveBeenCalled()
    } finally { targets.mockRestore(); materials.mockRestore(); borrowed.removeEventListener('dispose', released); borrowed.dispose() }
  })
})
