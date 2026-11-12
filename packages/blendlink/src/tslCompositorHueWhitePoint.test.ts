import { describe, expect, it, vi } from 'vitest'
import { DataTexture } from 'three'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

const constant = (type: string, value: unknown) => ({ name: '', socketType: type,
  value: { kind: 'constant' as const, type, value } })
const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
function graph(white = false): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [],
    ops: [{ id: 'grade', kind: white ? 'color-balance' : 'hue-correct', type: 'RGBA',
      source: { path: ['Compositor'], node: 'Authored correction',
        nodeType: white ? 'CompositorNodeColorBalance' : 'CompositorNodeHueCorrect', output: 'Image' },
      properties: white ? { color_balance_model: 'linear', white_point_model: 'native-bradford-robertson-v1',
        white_point_domains: [[1800, 100000], [-150, 150], [1800, 100000], [-150, 150]],
        white_point_source_lms_bounds: [[0.5, 1], [0.5, 1], [0.5, 1]],
        white_point_gpu_constant: false, white_point_scene_to_xyz: identity, white_point_xyz_to_scene: identity,
      } : { hue_correct_model: 'native-curves-v1', curve_clip: true, curve_clip_y: [0, 1],
        curve_values: Array.from({ length: 3 }, () => Array(257).fill(0.5)),
        curve_ranges: [[0, 1], [0, 1], [0, 1]], curve_slopes: [[0, 0], [0, 0], [0, 0]],
        color_conversion_device: 'CPU' },
      inputs: { Image: constant('RGBA', [-0.5, 0.75, 2, -0.25]), Fac: constant('VALUE', -0.5),
        ...(white ? { Type: constant('MENU', 'White Point'),
          'Input Temperature': constant('VALUE', 6500), 'Input Tint': constant('VALUE', 10),
          'Output Temperature': constant('VALUE', 2700), 'Output Tint': constant('VALUE', -20) } : {}) } }],
    output: { kind: 'ref', node: 'grade', type: 'RGBA' } }
}

describe('native compositor Hue Correct and White Point contracts', () => {
  it.each([false, true])('builds a complete correction and releases its native lookup texture (White Point=%s)', white => {
    const dispose = vi.spyOn(DataTexture.prototype, 'dispose')
    try {
      const built = buildSourceCompositor(graph(white), () => null)
      expect(built.node.isNode).toBe(true)
      built.dispose()
      expect(dispose).toHaveBeenCalledOnce()
    } finally { dispose.mockRestore() }
  })

  it('releases allocated curve resources on an unsupported Hue Correct model', () => {
    const program = graph(), dispose = vi.spyOn(DataTexture.prototype, 'dispose')
    delete program.ops[0]!.properties.hue_correct_model
    try {
      expect(() => buildSourceCompositor(program, () => null)).toThrow(/Authored correction.*native curve and clipping model/)
      expect(dispose).toHaveBeenCalledOnce()
    } finally { dispose.mockRestore() }
  })

  it.each([[NaN, 1], [1, 0], [0]])('refuses invalid native clipping metadata %s', clip => {
    const program = graph()
    program.ops[0]!.properties.curve_clip_y = clip
    expect(() => buildSourceCompositor(program, () => null)).toThrow(/Authored correction.*finite curve clipping limits/)
  })

  it.each([undefined, [[1, 0, 0], [0, NaN, 0], [0, 0, 1]], [[1, 0], [0, 1]]])(
    'refuses absent, nonfinite or malformed working-space matrices', matrix => {
      const program = graph(true)
      program.ops[0]!.properties.white_point_scene_to_xyz = matrix
      expect(() => buildSourceCompositor(program, () => null)).toThrow(/Authored correction.*scene-linear to XYZ matrix/)
    })

  it.each([[[0, 6500], [10, 10], [6500, 6500], [10, 10]],
    [[6500, 6500], [-151, 10], [6500, 6500], [10, 10]],
    [[6500, 6500], [10, 10], [100001, 100001], [10, 10]]])('refuses unproved native White Point domains', domains => {
    const program = graph(true)
    program.ops[0]!.properties.white_point_domains = domains
    expect(() => buildSourceCompositor(program, () => null)).toThrow(/Authored correction.*proven temperature/)
  })

  it('requires the native constant matrix when the GPU optimization is specified', () => {
    const program = graph(true)
    program.ops[0]!.properties.white_point_gpu_constant = true
    expect(() => buildSourceCompositor(program, () => null)).toThrow(/missing its native constant adaptation matrix/)
  })

  it('refuses a native Bradford response that can cross zero', () => {
    const program = graph(true)
    program.ops[0]!.properties.white_point_source_lms_bounds = [[0.5, 1], [-0.1, 0.1], [0.5, 1]]
    expect(() => buildSourceCompositor(program, () => null)).toThrow(/Authored correction.*provably nonzero Bradford/)
  })
})
