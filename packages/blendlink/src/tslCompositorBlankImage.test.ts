import { describe, expect, it, vi } from 'vitest'
import { DataTexture } from 'three'
import type { SourceCompositorProgram } from './sourceDisplay.js'
import { BLANK_IMAGE_MODEL, BLANK_IMAGE_PROFILE, createBlankImageFrameGuard, validateBlankImageProgram } from './tslCompositorBlankImage.js'
import { buildSourceCompositor } from './tslSourceCompositor.js'

const fail = (message: string): never => { throw Error(message) }
const words = (values: number[]) => Array.from(new Uint32Array(new Float32Array(values).buffer))
function program(size = [1920, 1080], color = [0, 0, 0, 1]): SourceCompositorProgram {
  return { version: 1, status: 'extracted', diagnostics: [], passes: [], ops: [{
    id: 'blank', kind: 'blank-image', type: 'RGBA', source: { path: ['Compositor'], node: 'Blank Image', nodeType: 'CompositorNodeBlankImage', output: 'Image' },
    inputs: {
      Color: { name: 'Color', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: color } },
      Size: { name: 'Size', socketType: 'INT_VECTOR', value: { kind: 'constant', type: 'INT_VECTOR2', value: size } },
    }, properties: { evaluation_device: 'CPU', single_value_device: 'CPU', blank_image_model: BLANK_IMAGE_MODEL,
      blank_image_profile: BLANK_IMAGE_PROFILE, blank_image_version: [5, 3, 0], blank_image_build: '02f0899d78e3',
      blank_image_color_words: words(color), blank_image_size: size, blank_image_effective_size: size.map(n => Math.max(1, n)),
      blank_image_max_pixels: 4194304, blank_image_sampling_model: 'modern-cpu-v1', blank_image_source_precision: 'FULL' },
  }], output: { kind: 'ref', node: 'blank', type: 'RGBA' } }
}
function renderer() {
  const state = { width: 13, height: 9, ratio: 1 }
  const target = { width: 13, height: 9, viewport: { x: 0, y: 0, z: 13, w: 9 }, scissorTest: false }
  return { state, target, value: { isWebGPURenderer: true, backend: { isWebGPUBackend: true, device: {} }, _textures: { data: new WeakMap() },
    getDrawingBufferSize: (v: any) => v.set(state.width, state.height), getRenderTarget: () => target } }
}
describe('native finite Blank Image producer', () => {
  it('keeps native Size clamping and a finite image without serialized pixels or a source-sized RTT', () => {
    expect(validateBlankImageProgram(program([-3, 0]), fail)).toMatchObject({ width: 1, height: 1 })
    const source = program(), before = JSON.stringify(source), disposal = vi.spyOn(DataTexture.prototype, 'dispose')
    try {
      const built = buildSourceCompositor(source, () => { throw Error('No borrowed image may be resolved') })
      expect(JSON.stringify(source)).toBe(before)
      built.dispose(); built.dispose()
      expect(disposal).toHaveBeenCalledTimes(2) // two bounded mapping tables; no 1920 × 1080 source texture
    } finally { disposal.mockRestore() }
  })
  it('checks raw Color words and native integer limits before graph resources exist', () => {
    for (const color of [[-0, 0, 0, 1], [2 ** -149, 0, 0, 1], [.1, 0, 0, 1], [17, 0, 0, 1], [1, 0, 0, 2]])
      expect(() => validateBlankImageProgram(program([13, 9], color), fail)).toThrow(/Float32/)
    for (const size of [[8193, 1], [4096, 4096], [1.5, 2], [2147483648, 2], [-0, 2]])
      expect(() => validateBlankImageProgram(program(size), fail)).toThrow(/Size/)
    const source = program(); source.ops[0]!.properties.blank_image_color_words = [1, 0, 0, 1065353216]
    expect(() => validateBlankImageProgram(source, fail)).toThrow(/Float32/)
  })
  it('refuses forged models, conversions and consumers instead of losing the image domain', () => {
    const mutations: Array<(p: SourceCompositorProgram) => void> = [
      p => { p.ops[0]!.source.nodeType = 'CompositorNodeRGB' },
      p => { p.ops[0]!.properties.evaluation_device = 'GPU' },
      p => { p.ops[0]!.properties.blank_image_pixels = [0] },
      p => { p.ops[0]!.inputs.Color!.value = { kind: 'ref', node: 'other', type: 'RGBA' } },
      p => { p.ops.push({ ...p.ops[0]!, id: 'consumer', kind: 'image-info' }) },
      p => { p.output = { kind: 'constant', type: 'RGBA', value: [0, 0, 0, 1] } },
    ]
    for (const mutate of mutations) { const source = program(); mutate(source); expect(() => validateBlankImageProgram(source, fail)).toThrow(/Blank Image/) }
  })
  it('rejects invalid physical frames before state changes and recovers at a valid extent', () => {
    const guard = createBlankImageFrameGuard(), host = renderer()
    guard(host.value)
    host.state.width = host.target.width = host.target.viewport.z = 4096
    host.state.height = host.target.height = host.target.viewport.w = 4096
    expect(() => guard(host.value)).toThrow(/4194304/)
    host.state.width = host.target.width = host.target.viewport.z = 26
    host.state.height = host.target.height = host.target.viewport.w = 18
    expect(() => guard(host.value)).not.toThrow()
    host.target.scissorTest = true; expect(() => guard(host.value)).toThrow(/full-frame/)
    host.target.scissorTest = false; host.value._textures.data = new WeakMap()
    expect(() => guard(host.value)).toThrow(/epoch changed/)
  })
})
