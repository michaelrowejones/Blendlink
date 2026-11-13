import { describe, expect, it, vi } from 'vitest'
import { DataTexture, RenderTarget } from 'three'
import { NodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'
import { affineImageOrigin, realizeCompositorOrigin, translatedImageOrigin } from './tslCompositorImageDomain.js'
import { compositorAffinePoint, compositorAffineSamplingMatrix, IDENTITY_COMPOSITOR_AFFINE,
  invertCompositorAffine, multiplyCompositorAffine, realizeCompositorAffineDomain } from './tslCompositorAffineMath.js'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorOperation, SourceCompositorProgram } from './sourceDisplay.js'

const fail = (message: string): never => { throw new Error(message) }
const rotation = [0.9210609793663025, -0.3894183337688446, 0, 0.3894183337688446, 0.9210609793663025, 0, 0, 0, 1] as const
const operation = (): SourceCompositorOperation => ({ id: 'affine', kind: 'image-affine', type: 'RGBA',
  source: { path: ['Compositor'], node: 'Artist Rotation', nodeType: 'CompositorNodeRotate', output: 'Image' },
  properties: { image_domain_model: 'deferred-affine-f32-v1', image_affine_matrix: [...rotation],
    image_sampling_model: 'modern-cpu-v1', image_interpolation: 'Bilinear' },
  inputs: { Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'ref', type: 'RGBA', node: 'source' } } } })
const request = { scene: 'Scene', viewLayer: 'ViewLayer', pass: 'Image', name: 'Image', type: 'RGBA' }
const graph = (): SourceCompositorProgram => ({ version: 1, status: 'extracted', passes: [request], diagnostics: [],
  ops: [{ id: 'source', kind: 'render-pass', type: 'RGBA', source: { path: ['Compositor'], node: 'Render Layers', nodeType: 'CompositorNodeRLayers', output: 'Image' },
    properties: {}, inputs: {}, pass: request }, operation()], output: { kind: 'ref', type: 'RGBA', node: 'affine' } })

describe('bounded native terminal affine domains', () => {
  it('composes translation and rotation in authored order without intermediate cropping', () => {
    const input = { x: 2, y: -1, roots: [{ node: TSL.vec4(1) }] }
    const moved = affineImageOrigin(operation(), input, fail)!
    expect(moved.x).toBe(Math.fround(Math.fround(2 * rotation[0]) + Math.fround(-rotation[1])))
    expect(moved.y).toBe(Math.fround(Math.fround(2 * rotation[3]) + Math.fround(-rotation[4])))
    const translate = operation(); translate.kind = 'translate'
    Object.assign(translate.properties, { image_domain_model: 'native-translation-v2', image_translation: [.1, -.2] })
    const result = translatedImageOrigin(translate, moved, fail)!
    expect(result.x).toBe(Math.fround(moved.x + .1)); expect(result.affineMatrix?.[0]).toBe(rotation[0])
    expect(input.x).toBe(2)
  })

  it('preserves a near-identity residual through chains but skips native equal-domain realization', () => {
    const residual = [1, -1.7484555314695172e-7, 0, 1.7484555314695172e-7, 1, 0, 0, 0, 1]
    const op = operation(); op.properties.image_affine_matrix = residual
    const input = TSL.vec4(1), resources: { dispose(): void }[] = []
    const origin = affineImageOrigin(op, { x: 0, y: 0, roots: [{ node: input }] }, fail)!
    expect(origin.affineMatrix?.[1]).toBe(residual[1])
    expect(realizeCompositorOrigin(input, origin, [0, 0], resources, fail)).toBeDefined()
    // The native sampling shortcut still validates/owns the finite root window.
    expect(resources).toHaveLength(1)
    resources.forEach(resource => resource.dispose())
  })

  it.each([{ image_sampling_model: 'legacy-cpu-v1' }, { image_domain_model: 'future' },
    { image_affine_matrix: [1, 0, 0, 0, 1, 0, .1, 0, 1] },
    { image_affine_matrix: [1, 0, 0, 0, 0, 0, 0, 0, 1] },
    { image_affine_matrix: [1, 0, 8193, 0, 1, 0, 0, 0, 1] }])('rejects an unqualified matrix/sampler: %s', patch => {
    const op = operation(); Object.assign(op.properties, patch)
    expect(() => affineImageOrigin(op, { x: 0, y: 0, roots: [] }, fail)).toThrow()
  })

  it('refuses intermediate affine consumers and old-v1 mixed chains before allocating targets', () => {
    const texture = new DataTexture(), target = vi.spyOn(RenderTarget.prototype, 'dispose')
    try {
      const program = graph()
      program.ops.push({ id: 'consumer', kind: 'exposure', type: 'RGBA', source: { ...operation().source, node: 'Exposure' },
        properties: {}, inputs: { Image: { name: 'Image', socketType: 'RGBA', value: program.output } } })
      program.output = { kind: 'ref', type: 'RGBA', node: 'consumer' }
      expect(() => buildSourceCompositor(program, () => TSL.texture(texture))).toThrow(/resized data\/display-window/)
      expect(target).not.toHaveBeenCalled()
      program.ops[2] = { ...operation(), id: 'old', kind: 'translate', properties: { image_domain_model: 'deferred-integer-origin-v1', image_translation: [1, 0] } }
      expect(() => buildSourceCompositor(program, () => TSL.texture(texture))).toThrow(/freshly exported/)
    } finally { target.mockRestore(); texture.dispose() }
  })

  it('owns its lookup/target/material once and borrows the scene image', () => {
    const texture = new DataTexture(), borrowed = vi.fn(); texture.addEventListener('dispose', borrowed)
    const target = vi.spyOn(RenderTarget.prototype, 'dispose'), material = vi.spyOn(NodeMaterial.prototype, 'dispose'), lookup = vi.spyOn(DataTexture.prototype, 'dispose')
    try {
      const result = buildSourceCompositor(graph(), () => TSL.texture(texture)); result.dispose(); result.dispose()
      expect(target).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1)
      expect(lookup).toHaveBeenCalledTimes(1); expect(borrowed).not.toHaveBeenCalled()
    } finally { target.mockRestore(); material.mockRestore(); lookup.mockRestore(); texture.dispose() }
  })

  it('keeps independently rounded native matrix coefficients and expanded display windows', () => {
    const domain = { matrix: rotation, dataSize: [13, 7] as const, displaySize: [13, 7] as const, dataOffset: [0, 0] as const }
    const realized = realizeCompositorAffineDomain(domain, false)
    expect(realized.dataSize).toEqual([16, 12]); expect(realized.displaySize).toEqual([16, 12])
    const matrix = compositorAffineSamplingMatrix(domain, { ...domain, matrix: IDENTITY_COMPOSITOR_AFFINE }, false)
    expect(compositorAffinePoint(matrix, 0, 0)).toEqual([-0.014970846474170685, 0.4390466809272766])
    expect(multiplyCompositorAffine(rotation, invertCompositorAffine(rotation))).toEqual(IDENTITY_COMPOSITOR_AFFINE)
  })
})
