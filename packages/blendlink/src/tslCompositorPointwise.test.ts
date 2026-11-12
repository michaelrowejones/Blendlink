import { DataTexture } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

const constant = (type: string, value: unknown) => ({ name: '', socketType: type,
  value: { kind: 'constant' as const, type, value } })
function program(kind: string): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [],
    ops: [{ id: 'artist', kind, type: 'VALUE', source: {
      path: ['Compositor'], node: 'Artist Numeric Node', nodeType: 'ShaderNodeMapRange', output: 'Result',
    }, properties: { data_type: 'FLOAT', interpolation_type: 'LINEAR', clamp: false, clamp_type: 'MINMAX', map_range_model: 'CPU' },
    inputs: { Image: constant('RGBA', [0.1, 0.3, 1.2, 0.5]), Value: constant('VALUE', 0.4),
      Min: constant('VALUE', 1), Max: constant('VALUE', -1),
      'From Min': constant('VALUE', 0), 'From Max': constant('VALUE', 1),
      'To Min': constant('VALUE', 1), 'To Max': constant('VALUE', -1), Steps: constant('VALUE', 4) } }],
    output: { kind: 'convert', fromType: 'VALUE', type: 'RGBA',
      input: { kind: 'ref', node: 'artist', type: 'VALUE' } } }
}

describe('native compositor pointwise utilities', () => {
  it.each(['MINMAX', 'RANGE'])('builds Clamp %s with reversed endpoints', mode => {
    const graph = program('clamp')
    graph.ops[0]!.properties.clamp_type = mode
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it.each(['LINEAR', 'STEPPED', 'SMOOTHSTEP', 'SMOOTHERSTEP'])('builds Map Range %s in scalar/vector forms', mode => {
    for (const vector of [false, true]) {
      const graph = program('map-range')
      graph.ops[0]!.properties.interpolation_type = mode
      if (vector) {
        graph.ops[0]!.properties.data_type = 'FLOAT_VECTOR'
        for (const key of ['Value', 'From Min', 'From Max', 'To Min', 'To Max', 'Steps'])
          graph.ops[0]!.inputs[key] = constant('VECTOR', [0.2, 0.5, 0.9])
        graph.output = { kind: 'convert', fromType: 'VECTOR', type: 'RGBA',
          input: { kind: 'ref', node: 'artist', type: 'VECTOR' } }
      }
      const built = buildSourceCompositor(graph, () => null)
      expect(built.node.isNode).toBe(true)
      built.dispose()
    }
  })

  it('uses the authored luminance contract for RGB to BW', () => {
    const graph = program('rgb-to-bw')
    graph.luminance = [0.2126, 0.7152, 0.0722]
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it('refuses unknown modes with the artist node path', () => {
    const graph = program('clamp')
    graph.ops[0]!.properties.clamp_type = 'UNKNOWN'
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Numeric Node.*Clamp requires/)
    graph.ops[0]!.kind = 'map-range'
    graph.ops[0]!.properties.interpolation_type = 'UNKNOWN'
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Numeric Node.*Map Range requires/)
  })

  it('refuses malformed Color Ramp stops before allocating GPU resources', () => {
    const graph = program('color-ramp')
    graph.ops[0]!.inputs.Fac = constant('VALUE', 0.4)
    Object.assign(graph.ops[0]!.properties, { color_mode: 'RGB', interpolation: 'LINEAR',
      hue_interpolation: 'NEAR', color_conversion_device: 'CPU',
      stops: [{ position: 0.7, color: [1, 0, 0, 1] }, { position: 0.2, color: [0, 0, 1, 1] }] })
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/finite ordered stops/)
  })

  it('disposes both native RGB curve tables exactly once', () => {
    const graph = program('curves')
    const operation = graph.ops[0]!
    operation.source.nodeType = 'CompositorNodeCurveRGB'
    operation.inputs.Fac = constant('VALUE', 0.5)
    operation.inputs['Black Level'] = constant('RGBA', [0, 0, 0, 1])
    operation.inputs['White Level'] = constant('RGBA', [1, 1, 1, 1])
    const identity = () => Array.from({ length: 257 }, (_, index) => index / 256)
    Object.assign(operation.properties, { color_conversion_device: 'CPU', curve_tone: 'STANDARD',
      curve_ranges: Array.from({ length: 4 }, () => [0, 1]),
      curve_slopes: Array.from({ length: 4 }, () => [1, 1]),
      curve_values: Array.from({ length: 4 }, identity), curve_premultiplied: Array.from({ length: 3 }, identity) })
    const disposed = vi.spyOn(DataTexture.prototype, 'dispose')
    try {
      const built = buildSourceCompositor(graph, () => null)
      expect(disposed).not.toHaveBeenCalled()
      built.dispose(); built.dispose()
      expect(disposed).toHaveBeenCalledTimes(2)
      disposed.mockClear()
      operation.properties.curve_tone = 'UNKNOWN'
      expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Standard or Film Like/)
      expect(disposed).toHaveBeenCalledTimes(1)
    } finally { disposed.mockRestore() }
  })
})
