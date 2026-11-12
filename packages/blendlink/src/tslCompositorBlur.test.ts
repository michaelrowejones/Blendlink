import { describe, expect, it, vi } from 'vitest'
import { Color, DataTexture, RenderTarget, Vector4 } from 'three'
import { NodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'
import { buildNativeCompositorBlur } from './tslCompositorBlur.js'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorOperation, SourceCompositorProgram } from './sourceDisplay.js'

const constant = (type: string, value: unknown) => ({ name: '', socketType: type,
  value: { kind: 'constant' as const, type, value } })
const op = (): SourceCompositorOperation => ({ id: 'blur', kind: 'blur', type: 'RGBA',
  source: { path: ['Compositor'], node: 'Artist Blur', nodeType: 'CompositorNodeBlur', output: 'Image' },
  properties: { blur_model: 'symmetric-separable-f32-v1', blur_weights: [[.5, .25], [.5, .25]] },
  inputs: { Image: constant('RGBA', [.25, -.5, 1.5, .35]), Size: constant('VECTOR', [1, 1]),
    Type: constant('MENU', 'Gaussian'), 'Extend Bounds': constant('BOOLEAN', false), Separable: constant('BOOLEAN', true) } })
const fail = (message: string): never => { throw new Error(message) }

describe('native compositor Blur lifecycle and contracts', () => {
  it('releases every owned render target and material exactly once', () => {
    const targets = vi.spyOn(RenderTarget.prototype, 'dispose'), materials = vi.spyOn(NodeMaterial.prototype, 'dispose'),
      textures = vi.spyOn(DataTexture.prototype, 'dispose')
    try {
      const resources: { dispose(): void }[] = []
      const input = TSL.Fn(() => TSL.vec4(.25, -.5, 1.5, .35))()
      expect(buildNativeCompositorBlur(op(), input, false, resources, fail).isNode).toBe(true)
      expect(resources.length).toBeGreaterThan(1)
      for (const resource of resources) resource.dispose()
      const count = targets.mock.calls.length, tables = textures.mock.calls.length
      expect(count).toBeGreaterThan(1)
      expect(tables).toBeGreaterThan(0)
      expect(materials).toHaveBeenCalledTimes(count)
      for (const resource of resources) resource.dispose()
      expect(targets).toHaveBeenCalledTimes(count)
      expect(materials).toHaveBeenCalledTimes(count)
      expect(textures).toHaveBeenCalledTimes(tables)
    } finally { targets.mockRestore(); materials.mockRestore(); textures.mockRestore() }
  })

  it('also releases intermediate targets/materials for existing schema1 Gaussian programs', () => {
    const operation = op()
    delete operation.properties.blur_model
    delete operation.properties.blur_weights
    const program: SourceCompositorProgram = { version: 1, status: 'extracted', passes: [], diagnostics: [],
      ops: [operation], output: { kind: 'ref', type: 'RGBA', node: 'blur' } }
    const targets = vi.spyOn(RenderTarget.prototype, 'dispose'), materials = vi.spyOn(NodeMaterial.prototype, 'dispose')
    try {
      const built = buildSourceCompositor(program, () => null)
      built.dispose()
      expect(targets.mock.calls.length).toBeGreaterThan(1)
      expect(materials).toHaveBeenCalledTimes(targets.mock.calls.length)
      built.dispose()
      expect(materials).toHaveBeenCalledTimes(targets.mock.calls.length)
    } finally { targets.mockRestore(); materials.mockRestore() }
  })

  it('keeps constant-image and zero-radius identity cases free of temporary targets', () => {
    const resources: { dispose(): void }[] = [], input = TSL.vec4(.25, -.5, 1.5, .35)
    expect(buildNativeCompositorBlur(op(), input, true, resources, fail)).toBe(input)
    const operation = op()
    operation.inputs.Size = constant('VECTOR', [0, 0])
    operation.properties.blur_weights = [[1], [1]]
    expect(buildNativeCompositorBlur(operation, input, false, resources, fail)).toBe(input)
    expect(resources).toHaveLength(0)
  })

  it('borrows a render pass texture without taking ownership of the pass', () => {
    const texture = new DataTexture(), external = TSL.texture(texture)
    const dispose = vi.spyOn(texture, 'dispose')
    try {
      const resources: { dispose(): void }[] = []
      const pass = { isPassNode: true, getTextureNode: () => external }
      expect(buildNativeCompositorBlur(op(), pass, false, resources, fail).isNode).toBe(true)
      for (const resource of resources) resource.dispose()
      expect(dispose).not.toHaveBeenCalled()
    } finally { dispose.mockRestore(); texture.dispose() }
  })

  it.each([[[.5], [.5, .25]], [[NaN, .25], [.5, .25]], [[1, 1], [1, 1]]])(
    'refuses malformed/nonfinite/unnormalized native weight tables before allocating targets', tables => {
      const operation = op(), resources: { dispose(): void }[] = []
      operation.properties.blur_weights = tables
      expect(() => buildNativeCompositorBlur(operation, TSL.vec4(1), false, resources, fail))
        .toThrow(/finite normalized native filter tables/)
      expect(resources).toHaveLength(0)
    })

  it('preserves negative-lobe coefficients without clamping them into a different filter', () => {
    const operation = op(), resources: { dispose(): void }[] = []
    operation.properties.blur_weights = [[1.2, -.1], [1.2, -.1]]
    expect(buildNativeCompositorBlur(operation, TSL.vec4(1), false, resources, fail).isNode).toBe(true)
    for (const resource of resources) resource.dispose()
  })

  it.each(['future-gamma', 'legacy-cpu-square-v1'])(
    'refuses unknown or mismatched gamma models before allocating resources: %s', gamma => {
      const operation = op(), resources: { dispose(): void }[] = []
      operation.properties.blur_gamma_model = gamma
      expect(() => buildNativeCompositorBlur(operation, TSL.vec4(1), false, resources, fail))
        .toThrow(/matching native gamma correction model/)
      expect(resources).toHaveLength(0)
    })

  it('retains the distinct CPU and GPU gamma identity paths without intermediate targets', () => {
    const operation = op(), resources: { dispose(): void }[] = [], input = TSL.vec4(-.5, 1, .25, .5)
    operation.properties.blur_gamma_model = 'legacy-gpu-square-v1'
    expect(buildNativeCompositorBlur(operation, input, true, resources, fail)).toBe(input)
    operation.properties.blur_model = 'legacy-cpu-f32-v1'
    operation.properties.blur_gamma_model = 'legacy-cpu-square-v1'
    expect(buildNativeCompositorBlur(operation, input, true, resources, fail)).not.toBe(input)
    expect(resources).toHaveLength(0)
  })

  it('exposes exact pixel loads for the native sampling model while retaining tagless RTT sampling', () => {
    for (const model of [undefined, 'native-texel-v1']) {
      const operation = op(), resources: { dispose(): void }[] = []
      operation.properties.blur_output_sampling_model = model
      const built = buildNativeCompositorBlur(operation, TSL.vec4(1), false, resources, fail)
      expect(built.isTextureNode).toBe(true)
      expect(built.getSampler()).toBe(model === undefined)
      for (const resource of resources) resource.dispose()
    }
  })

  it('refuses unknown output sampling models without allocating resources', () => {
    const operation = op(), resources: { dispose(): void }[] = []
    operation.properties.blur_output_sampling_model = 'future-sampling'
    expect(() => buildNativeCompositorBlur(operation, TSL.vec4(1), false, resources, fail))
      .toThrow(/verified native output sampling model/)
    expect(resources).toHaveLength(0)
  })

  it.each([
    { blur_relative_model: 'future-relative' },
    { blur_relative_percent: [NaN, 25] },
    { blur_relative_aspect: 'AUTO' },
    { blur_relative_multiplier: -1 },
  ])('refuses malformed relative contracts before allocating resources: %s', override => {
    const operation = op(), resources: { dispose(): void }[] = []
    Object.assign(operation.properties, { blur_relative_model: 'legacy-percent-f32-v1',
      blur_relative_percent: [12.5, 25], blur_relative_aspect: 'NONE', blur_relative_multiplier: 1 }, override)
    operation.inputs.Type = constant('MENU', 'Tent')
    expect(() => buildNativeCompositorBlur(operation, TSL.vec4(1), false, resources, fail))
      .toThrow(/Relative Blur requires verified/)
    expect(resources).toHaveLength(0)
  })

  it.each([{ percent: [0, 0], multiplier: 1 }, { percent: [12.5, 25], multiplier: 0 }])(
    'keeps guaranteed relative identities free of intermediate GPU resources: %s', ({ percent, multiplier }) => {
      const operation = op(), resources: { dispose(): void }[] = [], input = TSL.vec4(-.5, 1, .25, .5)
      Object.assign(operation.properties, { blur_relative_model: 'legacy-percent-f32-v1',
        blur_relative_percent: percent, blur_relative_aspect: 'NONE', blur_relative_multiplier: multiplier })
      operation.inputs.Type = constant('MENU', 'Tent')
      expect(buildNativeCompositorBlur(operation, input, false, resources, fail)).toBe(input)
      operation.properties.blur_gamma_model = 'legacy-gpu-square-v1'
      expect(buildNativeCompositorBlur(operation, input, false, resources, fail)).toBe(input)
      operation.properties.blur_model = 'legacy-cpu-f32-v1'; operation.properties.blur_gamma_model = 'legacy-cpu-square-v1'
      expect(buildNativeCompositorBlur(operation, input, false, resources, fail)).not.toBe(input)
      expect(resources).toHaveLength(0)
    })

  it('restores caller state when a live input extent exceeds the relative radius contract', () => {
    const operation = op(), resources: { dispose(): void }[] = []
    Object.assign(operation.properties, { blur_relative_model: 'legacy-percent-f32-v1',
      blur_relative_percent: [50, 0], blur_relative_aspect: 'NONE', blur_relative_multiplier: 1,
      blur_model: 'legacy-cpu-f32-v1', blur_weights: [[1], [1]] })
    operation.inputs.Type = constant('MENU', 'Tent'); operation.inputs.Size = constant('VECTOR', [0, 0])
    const texture = new DataTexture(new Float32Array(258 * 4 * 4), 258, 4)
    const built = buildNativeCompositorBlur(operation, TSL.texture(texture), false, resources, fail)
    const target = {}, mrt = {}, renderObject = () => {}, viewport = new Vector4(3, 4, 6, 7), scissor = new Vector4(1, 2, 8, 9)
    const renderer: any = { target, mrt, autoClear: false, clearAlpha: .37,
      toneMapping: 0, toneMappingExposure: 1, outputColorSpace: '', renderObject, pixelRatio: 2, scissorTest: true,
      getRenderTarget: () => renderer.target, setRenderTarget: (value: unknown) => { renderer.target = value },
      getMRT: () => renderer.mrt, setMRT: (value: unknown) => { renderer.mrt = value },
      getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
      getRenderObjectFunction: () => renderer.renderObject, setRenderObjectFunction: (value: unknown) => { renderer.renderObject = value },
      getPixelRatio: () => renderer.pixelRatio, setPixelRatio: (value: number) => { renderer.pixelRatio = value },
      getClearColor: (out: Color) => out.setRGB(.1, .2, .3),
      getClearAlpha: () => renderer.clearAlpha, setClearColor: (_color: Color, alpha: number) => { renderer.clearAlpha = alpha },
      getScissorTest: () => renderer.scissorTest, setScissorTest: (value: boolean) => { renderer.scissorTest = value },
      getViewport: (out: Vector4) => out.copy(viewport), setViewport: (value: Vector4) => viewport.copy(value),
      getScissor: (out: Vector4) => out.copy(scissor), setScissor: (value: Vector4) => scissor.copy(value) }
    try {
      expect(() => built.updateBefore({ renderer })).toThrow(/Artist Blur.*between 0 and 128.*258×4/)
      expect(renderer.target).toBe(target); expect(renderer.mrt).toBe(mrt)
      expect(renderer.autoClear).toBe(false); expect(renderer.clearAlpha).toBe(.37)
      expect(renderer.renderObject).toBe(renderObject); expect(renderer.pixelRatio).toBe(2); expect(renderer.scissorTest).toBe(true)
      expect(viewport.toArray()).toEqual([3, 4, 6, 7]); expect(scissor.toArray()).toEqual([1, 2, 8, 9])
    } finally { for (const resource of resources) resource.dispose(); texture.dispose() }
  })
})
