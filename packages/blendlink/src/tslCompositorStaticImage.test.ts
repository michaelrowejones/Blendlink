import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { DataTexture } from 'three'
import { decodeStaticCompositorImage, staticImageAxisMappings } from './tslCompositorStaticImage.js'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorImage, SourceCompositorProgram } from './sourceDisplay.js'

function payload(values = [-.5, -0, .125, 2]): SourceCompositorImage {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setFloat32(index * 4, value, true))
  return { model: 'native-cpu-static-image-v1', encoding: 'zlib-le-rgba32f', width: 2, height: 2,
    decodedBytes: 64, data: deflateSync(bytes).toString('base64'),
    source: { name: 'Artist Image', kind: 'GENERATED', colorSpace: 'Linear Rec.709', alphaMode: 'PREMUL', storage: 'direct-float-buffer' } }
}
function valid(): SourceCompositorImage { return payload(Array.from({ length: 16 }, (_, index) => [-.5, -0, .125, 2][index % 4]!)) }
function program(): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], images: { pixels: valid() }, ops: [{
    id: 'image', kind: 'image-input', type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Image',
      nodeType: 'CompositorNodeImage', output: 'Image' }, properties: {
      evaluation_device: 'CPU', image_id: 'pixels', image_window_model: 'modern-cpu-v1',
    }, inputs: {},
  }], output: { kind: 'ref', type: 'RGBA', node: 'image' } }
}

describe('static native compositor image payloads and windows', () => {
  it('retains signed/HDR Float32 bits including negative zero without color or alpha reinterpretation', () => {
    expect(Array.from(decodeStaticCompositorImage(valid()))).toEqual(Array.from({ length: 16 }, (_, index) => [-.5, -0, .125, 2][index % 4]))
    expect(Object.is(decodeStaticCompositorImage(valid())[1], -0)).toBe(true)
  })

  it('refuses malformed, short, oversized, nonfinite or corrupt lossless payloads', () => {
    const corrupt = valid(), bytes = Buffer.from(corrupt.data, 'base64')
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1
    for (const record of [
      { ...valid(), width: 0 }, { ...valid(), width: 8193 }, { ...valid(), width: 4096, height: 4096 },
      { ...valid(), encoding: 'future' }, { ...valid(), decodedBytes: 1 }, { ...valid(), data: '???=' },
      payload(), payload(Array(17).fill(0)), payload(Array(16).fill(NaN)), payload(Array(16).fill(Infinity)),
      { ...corrupt, data: bytes.toString('base64') },
    ]) expect(() => decodeStaticCompositorImage(record as SourceCompositorImage)).toThrow(/Static Image/)
  })

  it('retains native odd-window Float32 neighbor behavior rather than replacing it with integer centering', () => {
    const [x, y] = staticImageAxisMappings({ width: 7, height: 5, model: 'modern-cpu-v1' }, 17, 9)
    expect(Array.from(y.slice(8, 12))).toEqual([-1, 1, 1, 1])
    expect(x.length).toBe(17 * 4)
    const equal = staticImageAxisMappings({ width: 7, height: 5, model: 'modern-cpu-v1' }, 7, 5)
    expect(Array.from(equal[1].slice(0, 4))).toEqual([0, 0, 0, 1])
    expect(() => staticImageAxisMappings({ width: 8, height: 4, model: 'legacy-cpu-even-v1' }, 17, 9)).toThrow(/even/)
    expect(() => staticImageAxisMappings({ width: 8, height: 4, model: 'modern-cpu-v1' }, 8193, 8)).toThrow(/extents/)
  })

  it('shares decoded Image/Alpha texture storage and owns texture/lookup resources exactly once', () => {
    const document = program()
    document.ops.push({ ...document.ops[0]!, id: 'alpha', type: 'VALUE', source: { ...document.ops[0]!.source, output: 'Alpha' } })
    const dispose = vi.spyOn(DataTexture.prototype, 'dispose')
    try {
      const built = buildSourceCompositor(document, () => null)
      expect(dispose).not.toHaveBeenCalled()
      built.dispose(); built.dispose()
      expect(dispose).toHaveBeenCalledTimes(3) // one input and two coordinate lookup tables
    } finally { dispose.mockRestore() }
  })

  it('names unsupported source models and cleans prior images when a later payload fails', () => {
    for (const patch of [{ evaluation_device: 'GPU' }, { image_window_model: 'future' }, { image_id: 'missing' }]) {
      const document = program(); Object.assign(document.ops[0]!.properties, patch)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Image.*native CPU/)
    }
    const wrongType = program(); wrongType.ops[0]!.type = 'VALUE'
    expect(() => buildSourceCompositor(wrongType, () => null)).toThrow(/Artist Image.*native CPU/)
    const document = program()
    document.images!.broken = { ...valid(), data: '???=' }
    document.ops.push({ ...document.ops[0]!, id: 'broken', properties: { ...document.ops[0]!.properties, image_id: 'broken' } })
    const dispose = vi.spyOn(DataTexture.prototype, 'dispose')
    try {
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Image.*payload/)
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally { dispose.mockRestore() }
  })
})
