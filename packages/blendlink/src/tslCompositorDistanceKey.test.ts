import { describe, expect, it, vi } from 'vitest'
import { DataTexture } from 'three'
import * as TSL from 'three/tsl'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import { buildCompositorDistanceKey } from './tslCompositorDistanceKey.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'key', kind: 'distance-key', type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Distance Key',
      nodeType: 'CompositorNodeDistanceMatte', output: 'Image' }, properties: {
      distance_key_model: 'native-rgb-distance-cpu-v1', distance_key_schema: 'modern',
      distance_key_settings: [.1, .1], evaluation_device: 'CPU', single_value_device: 'CPU',
    }, inputs: {
      Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [.2, 0, 0, 2] } },
      'Key Color': { name: 'Key Color', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [0, 0, 0, -4] } },
    },
  }], output: { kind: 'ref', type: 'RGBA', node: 'key' } }
}
describe('native CPU RGB Distance Key profile', () => {
  it('builds legacy/modern outputs and modern GPU single-value CPU folding without editing caller IR', () => {
    for (const schema of ['legacy', 'modern']) for (const output of ['Image', 'Matte']) {
      const graph = program(), op = graph.ops[0]!
      op.properties.distance_key_schema = schema; op.source.output = output
      if (output === 'Matte') { op.type = 'VALUE'; graph.output!.type = 'VALUE' }
      const before = JSON.stringify(graph), built = buildSourceCompositor(graph, () => null)
      expect(built.node.isNode).toBe(true); built.dispose(); built.dispose(); expect(JSON.stringify(graph)).toBe(before)
    }
    const graph = program(); graph.ops[0]!.properties.evaluation_device = 'GPU'
    graph.ops[0]!.properties.native_gpu_backend = 'OPENGL'
    const built = buildSourceCompositor(graph, () => null); built.dispose()
    const legacyZero = program(); legacyZero.ops[0]!.properties.distance_key_schema = 'legacy'
    legacyZero.ops[0]!.properties.distance_key_settings = [0, 0]
    const legacy = buildSourceCompositor(legacyZero, () => null); legacy.dispose()
  })
  it('rejects future models, malformed controls, tiny ramps and unproved source/device combinations', () => {
    for (const patch of [{ distance_key_model: 'future' }, { distance_key_schema: ['modern'] },
      { distance_key_settings: [0, 1 / 128] }, { distance_key_settings: [2 ** -60, .1] },
      { distance_key_settings: [0, Infinity] }, { distance_key_settings: [0] },
      { distance_key_settings: [0, 0] },
      { distance_key_settings: [0, .125] },
      { distance_key_schema: 'legacy', distance_key_settings: [0, .125] },
      { evaluation_device: 'future' }, { evaluation_device: ['CPU'] }, { distance_key_settings: new Array(2) },
      { evaluation_device: 'GPU', single_value_device: 'GPU' },
      { distance_key_schema: 'legacy', evaluation_device: 'GPU' }]) {
      const graph = program(); Object.assign(graph.ops[0]!.properties, patch)
      expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Distance Key/)
    }
  })
  it('independently refuses GPU fields even when metadata claims constant CPU folding', () => {
    const graph = program(), op = graph.ops[0]!, texture = new DataTexture(), disposed = vi.fn()
    texture.addEventListener('dispose', disposed)
    const pass = { scene: 'Scene', viewLayer: 'ViewLayer', pass: 'Image', name: 'Image', type: 'RGBA' }
    graph.ops.unshift({ id: 'field', kind: 'render-pass', type: 'RGBA', pass, inputs: {}, properties: {}, source: {
      path: ['Compositor'], node: 'Render Layers', nodeType: 'CompositorNodeRLayers', output: 'Image',
    } }); graph.passes = [pass]; op.inputs.Image!.value = { kind: 'ref', type: 'RGBA', node: 'field' }
    op.properties.evaluation_device = 'GPU'
    try {
      expect(() => buildSourceCompositor(graph, () => TSL.texture(texture))).toThrow(/GPU field thresholds/)
      expect(disposed).not.toHaveBeenCalled()
    } finally { texture.removeEventListener('dispose', disposed); texture.dispose() }
  })
  it('captures validated input nodes and output kind before deferred shader construction', () => {
    const op = program().ops[0]!, input = vi.fn(() => TSL.vec4(.2, 0, 0, 2))
    op.type = 'VALUE'; op.source.output = 'Matte'
    const node = buildCompositorDistanceKey(op, input, 'CPU', message => { throw new Error(message) })
    expect(input.mock.calls).toEqual([['Image'], ['Key Color']])
    input.mockImplementation(() => { throw new Error('Deferred caller input was accessed') })
    op.source.output = 'Image'; op.properties.distance_key_settings = [0, .125]
    const previous = TSL.getCurrentStack(); TSL.setCurrentStack(TSL.stack())
    try { expect(node.node.shaderNode.jsFunc().isVarNode).toBe(true) }
    finally { TSL.setCurrentStack(previous) }
  })
})
