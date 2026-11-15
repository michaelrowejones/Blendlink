import { describe, expect, it, vi } from 'vitest'
import { vec4 } from 'three/tsl'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import { createLensHorizontalFrameGuard, horizontalLensAxisMapping, validateLensHorizontalProgram,
  LENS_HORIZONTAL_MODEL, LENS_HORIZONTAL_PROFILE, LENS_HORIZONTAL_DISPERSION } from './tslCompositorLensHorizontal.js'

const fail = (message: string): never => { throw Error(message) }
const program = (): any => ({ version: 1, status: 'extracted', diagnostics: [], passes: [], output: { kind: 'ref', type: 'RGBA', node: 'lens' }, ops: [
  { id: 'image', kind: 'render-pass', type: 'RGBA', source: { path: ['Compositor'], node: 'Render Layers', nodeType: 'CompositorNodeRLayers', output: 'Image' }, inputs: {}, properties: {},
    pass: { scene: 'Scene', viewLayer: 'ViewLayer', pass: 'Image', name: 'Image', type: 'RGBA' } },
  { id: 'lens', kind: 'lens-horizontal', type: 'RGBA', source: { path: ['Compositor'], node: 'Lens Distortion', nodeType: 'CompositorNodeLensdist', output: 'Image' },
    inputs: { Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'ref', type: 'RGBA', node: 'image' } } },
    properties: { evaluation_device: 'CPU', single_value_device: 'CPU', native_gpu_backend: 'METAL',
      lens_horizontal_model: LENS_HORIZONTAL_MODEL, lens_horizontal_profile: LENS_HORIZONTAL_PROFILE,
      lens_horizontal_version: [5, 3, 0], lens_horizontal_build: '02f0899d78e3', lens_horizontal_type: 'Horizontal',
      lens_horizontal_controls: ['Horizontal', 0, 0x3e4ccccd, false, false], lens_horizontal_dispersion: LENS_HORIZONTAL_DISPERSION,
      lens_horizontal_export_extent: [13, 9], lens_horizontal_requested_precision: 'FULL', lens_horizontal_max_pixels: 4194304 } },
] })
const renderer = (): any => ({ isWebGPURenderer: true, backend: { isWebGPUBackend: true, device: {} }, _textures: { data: new WeakMap() },
  getDrawingBufferSize: (v: any) => v.set(13, 9), getRenderTarget: () => null,
  getViewport: (v: any) => v.set(0, 0, 13, 9), getPixelRatio: () => 1, getScissorTest: () => false })

describe('candidate Classroom horizontal lens contract', () => {
  it('accepts the exact original .2 input only and leaves unrelated programs alone', () => {
    const p = program()
    expect(validateLensHorizontalProgram(p, fail)).toBe(p.ops[1])
    expect(validateLensHorizontalProgram({ ...p, ops: [p.ops[0]] }, fail)).toBeUndefined()
  })
  it('refuses schema, native identity, raw-control, graph and budget forgery before resolving a producer', () => {
    const mutations = [
      (p: any) => p.ops[1].kind = 'translate',
      (p: any) => p.ops[1].source.nodeType = 'CompositorNodeTranslate',
      (p: any) => p.ops[1].source.output = 'Alpha',
      (p: any) => p.ops[1].source.extra = true,
      (p: any) => p.ops[1].properties.lens_horizontal_controls[0] = 'Radial',
      (p: any) => p.ops[1].properties.lens_horizontal_controls[1] = 0x80000000,
      (p: any) => p.ops[1].properties.lens_horizontal_controls[2]++,
      (p: any) => p.ops[1].properties.lens_horizontal_dispersion = .2,
      (p: any) => p.ops[1].properties.lens_horizontal_controls[3] = true,
      (p: any) => p.ops[1].properties.lens_horizontal_controls[4] = true,
      (p: any) => p.ops[1].properties.lens_horizontal_profile = 'generic',
      (p: any) => p.ops[1].properties.lens_horizontal_fake = true,
      (p: any) => p.ops[1].properties.evaluation_device = 'GPU',
      (p: any) => p.ops[1].properties.single_value_device = 'GPU',
      (p: any) => p.ops[1].properties.lens_horizontal_requested_precision = 'HALF',
      (p: any) => p.ops[1].properties.lens_horizontal_export_extent = [2049, 2048],
      (p: any) => p.ops[1].properties.lens_horizontal_export_extent = [3, 9],
      (p: any) => p.ops[1].inputs.Type = { value: { kind: 'constant', type: 'MENU', value: 'Horizontal' } },
      (p: any) => p.ops[1].inputs.Image.value = { kind: 'convert', fromType: 'RGBA', type: 'RGBA', input: p.ops[1].inputs.Image.value },
      (p: any) => p.ops[0].source.output = 'Normal',
      (p: any) => p.ops[0].kind = 'image-input',
      (p: any) => p.ops[0].id = 'lens',
      (p: any) => p.output.node = 'image',
      (p: any) => p.ops.push({ ...p.ops[0], id: 'unused' }),
    ]
    for (const mutate of mutations) {
      const p = program(), resolve = vi.fn()
      mutate(p)
      expect(() => buildSourceCompositor(p, resolve)).toThrow(/Horizontal Lens Distortion/)
      expect(resolve).not.toHaveBeenCalled()
    }
  })
  it('maps the power-of-two authored one-pixel red/blue offsets and keeps border neighbors explicit', () => {
    const red = horizontalLensAxisMapping(8, 1), blue = horizontalLensAxisMapping(8, -1), y = horizontalLensAxisMapping(8, 0)
    expect(Array.from(red.slice(0, 4))).toEqual([1, 2, 0, 1])
    expect(Array.from(blue.slice(0, 4))).toEqual([-1, 0, 0, 1])
    expect(Array.from(red.slice(-4))).toEqual([8, 9, 0, 1])
    expect(Array.from(y.slice(0, 4))).toEqual([0, 1, 0, 1])
    for (const size of [3, 8193, 8.5]) expect(() => horizontalLensAxisMapping(size, 1)).toThrow(/extents/)
    expect(() => horizontalLensAxisMapping(8, .5)).toThrow(/one-pixel/)
  })
  it('guards caller target, physical viewport and allocation epoch; invalid extents recover before any growth', () => {
    const guard = createLensHorizontalFrameGuard(), host = renderer()
    expect(guard(host)).toEqual([13, 9])
    host.getDrawingBufferSize = (v: any) => v.set(2049, 2048)
    expect(() => guard(host)).toThrow(/pixel budget/)
    host.getDrawingBufferSize = (v: any) => v.set(13, 9)
    expect(guard(host)).toEqual([13, 9])
    host.getViewport = (v: any) => v.set(1, 0, 13, 9)
    expect(() => guard(host)).toThrow(/physical viewport/)
    host.getViewport = (v: any) => v.set(0, 0, 13, 9)
    expect(guard(host)).toEqual([13, 9])
    host._textures.data = new WeakMap()
    expect(() => guard(host)).toThrow(/allocation epoch changed/)
  })
  it('builds a terminal finite field and disposes repeatedly without touching source program or borrowed input', () => {
    const p = program(), before = JSON.stringify(p), input = vec4(1), dispose = vi.fn()
    const built = buildSourceCompositor(p, () => input)
    input.addEventListener('dispose', dispose)
    expect(JSON.stringify(p)).toBe(before)
    expect(() => built.node.update({ renderer: renderer() })).not.toThrow()
    built.dispose(); built.dispose()
    expect(dispose).not.toHaveBeenCalled()
  })
})
