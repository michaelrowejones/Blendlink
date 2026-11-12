import { describe, expect, it, vi } from 'vitest'
import { DataTexture, RenderTarget } from 'three'
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
})
