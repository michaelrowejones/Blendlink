import { describe, expect, it, vi } from 'vitest'
import { DataTexture, RenderTarget } from 'three'
import { NodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'
import { buildCompositorSplit } from './tslCompositorSplit.js'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorOperation, SourceCompositorProgram } from './sourceDisplay.js'

const fail = (message: string): never => { throw new Error(message) }
function operation(): SourceCompositorOperation {
  return { id: 'split', kind: 'image-split', type: 'RGBA',
    source: { path: ['Compositor'], node: 'Artist Split', nodeType: 'CompositorNodeSplit', output: 'Image' },
    properties: { evaluation_device: 'CPU', split_model: 'native-line-f32-v1', split_position: [.5, .5],
      split_normal: [0, 1], split_rotation: 0 },
    inputs: Object.fromEntries(['Image', 'Image_001'].map(name => [name, { name, socketType: 'RGBA',
      value: { kind: 'constant', type: 'RGBA', value: [-.25, .5, 2, -.5] } }])) }
}
function program(): SourceCompositorProgram {
  const split = operation(), pass = { scene: 'Scene', viewLayer: 'ViewLayer', pass: 'Image', name: 'Image', type: 'RGBA' }
  split.inputs.Image!.value = { kind: 'ref', type: 'RGBA', node: 'source' }
  return { version: 1, status: 'extracted', diagnostics: [], passes: [pass], ops: [{
    id: 'source', kind: 'render-pass', type: 'RGBA', source: { ...split.source, node: 'Render Layers', nodeType: 'CompositorNodeRLayers' },
    inputs: {}, properties: {}, pass,
  }, split], output: { kind: 'ref', type: 'RGBA', node: 'split' } }
}
const domain = { x: 0, y: 0, roots: [] }
const color = () => TSL.vec4(-.25, .5, 2, -.5)

describe('native Split domain and ownership contract', () => {
  it('accepts independently qualified legacy CPU/GPU boundaries and modern CPU/Metal lines without rewriting source', () => {
    for (const patch of [{}, { evaluation_device: 'GPU', native_gpu_backend: 'METAL' },
      { split_model: 'legacy-cpu-axis-v1', split_axis: 'X', split_factor: 53 },
      { split_model: 'legacy-gpu-axis-v1', evaluation_device: 'GPU', split_axis: 'Y', split_factor: 50 }]) {
      const op = operation(); Object.assign(op.properties, patch); const before = JSON.stringify(op)
      expect(buildCompositorSplit(op, color, () => false, domain, fail).isNode).toBe(true)
      expect(JSON.stringify(op)).toBe(before)
    }
  })
  it('refuses malformed/future profiles, unverified GPU projection and constant-only or transformed canvases', () => {
    for (const patch of [{ evaluation_device: ['CPU'] }, { split_model: ['native-line-f32-v1'] },
      { split_model: 'future' }, { evaluation_device: 'GPU', native_gpu_backend: 'OPENGL' },
      { split_position: [.5] }, { split_position: [.5, NaN] }, { split_position: [.5, 2 ** -60] },
      { split_normal: [0, 0] }, { split_normal: [1, 1] }, { split_normal: [2 ** -60, 1] },
      { split_rotation: Infinity }, { split_rotation: 7 },
      { split_model: 'legacy-cpu-axis-v1', split_axis: ['X'], split_factor: 50 },
      { split_model: 'legacy-cpu-axis-v1', split_axis: 'Y', split_factor: 50.5 },
      { split_model: 'legacy-gpu-axis-v1', split_axis: 'Y', split_factor: 50 }]) {
      const op = operation(); Object.assign(op.properties, patch)
      expect(() => buildCompositorSplit(op, color, () => false, domain, fail)).toThrow(/Split/)
    }
    expect(() => buildCompositorSplit(operation(), color, () => true, domain, fail)).toThrow(/finite image/)
    expect(() => buildCompositorSplit(operation(), color, () => false, null, fail)).toThrow(/finite image/)
    expect(() => buildCompositorSplit(operation(), color, () => false, { ...domain, x: 1 }, fail)).toThrow(/unshifted/)
    const malformed = operation(); malformed.inputs.Image!.value.type = 'VALUE'
    expect(() => buildCompositorSplit(malformed, color, () => false, domain, fail)).toThrow(/Color inputs/)
  })
  it('owns its final canvas once and leaves borrowed textures/document intact after success and later refusal', () => {
    const target = vi.spyOn(RenderTarget.prototype, 'dispose'), material = vi.spyOn(NodeMaterial.prototype, 'dispose')
    const texture = new DataTexture(), borrowed = vi.spyOn(texture, 'dispose'), graph = program(), before = JSON.stringify(graph)
    try {
      const built = buildSourceCompositor(graph, () => TSL.texture(texture)); built.dispose(); built.dispose()
      expect(target).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1)
      expect(borrowed).not.toHaveBeenCalled(); expect(JSON.stringify(graph)).toBe(before)
      const broken = structuredClone(graph), invalid = operation(); invalid.id = 'later'; invalid.properties.split_model = 'future'
      invalid.inputs.Image!.value = { kind: 'ref', type: 'RGBA', node: 'split' }
      broken.ops.push(invalid); broken.output = { kind: 'ref', type: 'RGBA', node: 'later' }
      expect(() => buildSourceCompositor(broken, () => TSL.texture(texture))).toThrow(/Artist Split/)
      expect(borrowed).not.toHaveBeenCalled(); expect(target).toHaveBeenCalledTimes(1)
    } finally { target.mockRestore(); material.mockRestore(); borrowed.mockRestore(); texture.dispose() }
  })
})
