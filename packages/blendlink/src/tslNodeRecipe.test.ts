import { describe, expect, it, vi } from 'vitest'

import {
  buildTslColorNode,
  buildTslScalarNode,
  createTslBuildResources,
  TslIrError,
  type TslIrDocument,
} from './tslNodeRecipe.js'

// Node-construction only: TSL builds an expression graph without a GPU,
// which is exactly what the manifest consumer will do before Phase 4's
// renderer swap. Numeric fidelity is the differential harness's job
// (experiments/tsl-node-differential); this pins the package seam.

const documentOf = (output: Record<string, unknown>): TslIrDocument => ({
  schemaVersion: 1,
  model: 'blendlink-tsl-ir-v1',
  output: output as TslIrDocument['output'],
})

describe('buildTslColorNode', () => {
  it('constructs signed FBM and refuses unverified controls without changing old normalized documents', () => {
    const expression = { op: 'noise_fractal', normalize: false, dimensions: 3, detail: 2.5, roughness: .7, lacunarity: 1.7,
      input: { op: 'uv' }, scale: { op: 'const_float', value: 1 } }
    expect(buildTslColorNode(documentOf(expression))).toBeTruthy()
    expect(buildTslColorNode(documentOf({ ...expression, op: 'noise', normalize: undefined }))).toBeTruthy()
    expect(buildTslColorNode(documentOf({ ...expression, op: 'noise', normalize: false, roughness: 2 }))).toBeTruthy()
    expect(() => buildTslColorNode(documentOf({ ...expression, normalize: 'false' }))).toThrow(/must be false/)
    expect(() => buildTslColorNode(documentOf({ ...expression, noiseType: 'MULTIFRACTAL' })))
      .toThrow(/no verified recurrence/)
    for (const controls of [{ detail: 7 }, { roughness: 2 }, { lacunarity: 3 }, { distortion: 2 }])
      expect(() => buildTslColorNode(documentOf({ ...expression, ...controls }))).toThrow(/verified finite fractal controls/)
    expect(() => buildTslColorNode(documentOf({ op: 'mix_color', blendType: 'MIX',
      factor: { ...expression, output: 'color' } }))).toThrow(/vector-typed \(noise_fractal\)/)
  })
  it('accepts live Wave distortion while refusing unknown modes and unproven octave counts', () => {
    const expression = { op: 'tex_wave', waveType: 'BANDS', bandsDirection: 'X', ringsDirection: 'SPHERICAL',
      profile: 'SAW', vector: { op: 'uv' }, scale: { op: 'const_float', value: .25 },
      phase: { op: 'const_float', value: .375 }, detailScale: { op: 'const_float', value: 1 },
      distortion: 0, distortionNode: { op: 'const_float', value: -.7 }, detail: 2, detailRoughness: .5 }
    expect(buildTslColorNode(documentOf(expression))).toBeTruthy()
    for (const detail of [-.5, 3])
      expect(() => buildTslColorNode(documentOf({ ...expression, detail }))).toThrow(/verified finite detail range/)
    expect(() => buildTslColorNode(documentOf({ ...expression, waveType: 'UNKNOWN' }))).toThrow(/wave type UNKNOWN/)
    expect(() => buildTslColorNode(documentOf({ ...expression, bandsDirection: 'UNKNOWN' }))).toThrow(/bands direction UNKNOWN/)
    expect(() => buildTslColorNode(documentOf({ ...expression, profile: 'UNKNOWN' }))).toThrow(/wave profile UNKNOWN/)
    expect(() => buildTslColorNode(documentOf({ ...expression, distortionNode: undefined, distortion: Infinity })))
      .toThrow(/distortion must be finite/)
    expect(buildTslColorNode(documentOf({ ...expression, detailRoughnessNode: {
      op: 'clamp_minmax', value: { op: 'separate', channel: 'x', input: { op: 'uv' } },
      min: { op: 'const_float', value: 0 }, max: { op: 'const_float', value: 1 } } }))).toBeTruthy()
    expect(() => buildTslColorNode(documentOf({ ...expression, detailRoughnessNode: {
      op: 'attribute_object', name: 'roughness', output: 'fac', inputDomain: 'unit-bounded-live' } })))
      .toThrow(/needs a proven \[0,1\]/)
    expect(() => buildTslColorNode(documentOf({ ...expression, profile: 'SIN', precisionModel: 'UNKNOWN' })))
      .toThrow(/no verified sine precision model/)
  })
  it('preserves legacy hidden-slot order only for the explicit native analytic model', () => {
    const expression = { op: 'color_ramp', sourceModel: 'eevee-analytic-hidden',
      interpolation: 'LINEAR', input: { op: 'uv' }, mulBias: [-10, 9.5],
      stops: [{ position: .95, color: [.2, .4, .7, .3] }, { position: .85, color: [.8, .3, .1, .9] }] }
    expect(buildTslColorNode(documentOf(expression))).toBeTruthy()
    expect(() => buildTslColorNode(documentOf({ ...expression, sourceModel: 'eevee-analytic' })))
      .toThrow(/ordered RGBA/)
    expect(() => buildTslColorNode(documentOf({ ...expression, interpolation: 'CARDINAL' })))
      .toThrow(/verified interpolation/)
  })
  it('builds the remaining vector operations and complete transform modes', () => {
    const vector = { op: 'const_vec3', value: [0.2, -0.3, 0.7] }
    for (const operation of ['PROJECT', 'REFLECT', 'REFRACT', 'FACEFORWARD', 'ROUND', 'POWER', 'SIGN']) {
      expect(buildTslColorNode(documentOf({ op: 'vector_math', operation, a: vector, b: vector,
        c: vector, ior: { op: 'const_float', value: 0.7 } }))).toBeTruthy()
    }
    for (const rotationType of ['AXIS_ANGLE', 'X_AXIS', 'Y_AXIS', 'Z_AXIS', 'EULER_XYZ']) {
      expect(buildTslColorNode(documentOf({ op: 'vector_rotate', rotationType, invert: true,
        input: vector, centerNode: { op: 'uv' }, axis: vector, normalizeAxis: true,
        angle: { op: 'const_float', value: 0.9 }, rotation: vector }))).toBeTruthy()
    }
    for (const vectorType of ['POINT', 'TEXTURE', 'VECTOR', 'NORMAL']) {
      expect(buildTslColorNode(documentOf({ op: 'mapping', vectorType, input: vector,
        locationNode: vector, rotationNode: { op: 'uv' }, scaleNode: vector }))).toBeTruthy()
    }
    expect(() => buildTslColorNode(documentOf({ op: 'vector_rotate', rotationType: 'UNKNOWN', input: vector })))
      .toThrow(/vector rotate type UNKNOWN/)
  })

  it('builds vector Map Range and refuses unbounded step documents', () => {
    const fields = {
      op: 'map_range', dataType: 'FLOAT_VECTOR', clamp: true,
      value: { op: 'uv' }, fromMin: { op: 'const_vec3', value: [0, 1, 0.5] },
      fromMax: { op: 'const_vec3', value: [1, -1, 0.5] }, toMin: { op: 'const_vec3', value: [0.2, 0.8, 0.3] },
      toMax: { op: 'const_vec3', value: [0.9, 0.1, 0.7] }, steps: { op: 'const_vec3', value: [4, 0, 2.5] },
    }
    for (const interpolation of ['LINEAR', 'STEPPED', 'SMOOTHSTEP', 'SMOOTHERSTEP']) {
      expect(buildTslColorNode(documentOf({ ...fields, interpolation }))).toBeTruthy()
    }
    expect(() => buildTslColorNode(documentOf({ ...fields, interpolation: 'STEPPED', steps: { op: 'uv' } })))
      .toThrow(/static Steps/)
    expect(() => buildTslColorNode(documentOf({ ...fields, interpolation: 'STEPPED', steps: { op: 'const_vec3', value: [-1, 0, 2] } })))
      .toThrow(/nonnegative/)
    expect(() => buildTslColorNode(documentOf({ ...fields, interpolation: 'UNKNOWN' })))
      .toThrow(/interpolation UNKNOWN/)
  })

  it('builds all proven static Mapping modes with combined rotations and safe zero scale', () => {
    for (const vectorType of ['POINT', 'TEXTURE', 'VECTOR', 'NORMAL']) {
      expect(buildTslColorNode(documentOf({
        op: 'mapping', vectorType, input: { op: 'uv' },
        location: [0.17, -0.23, 0.31], rotation: [0.47, -0.81, 1.13], scale: [0, -0.65, 2.1],
      }))).toBeTruthy()
    }
    expect(() => buildTslColorNode(documentOf({
      op: 'mapping', vectorType: 'UNKNOWN', input: { op: 'uv' },
      location: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    }))).toThrow(/mapping type UNKNOWN/)
    expect(() => buildTslColorNode(documentOf({
      op: 'mapping', vectorType: 'POINT', input: { op: 'uv' },
      location: [0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    }))).toThrow(/three location/)
  })

  it('builds proven-op documents into TSL nodes', () => {
    const node = buildTslColorNode(documentOf({
      op: 'mix_color',
      blendType: 'MIX',
      clampFactor: true,
      factor: {
        op: 'math',
        operation: 'MULTIPLY_ADD',
        a: { op: 'separate', channel: 'x', input: { op: 'uv' } },
        b: { op: 'const_float', value: 1.5 },
        c: { op: 'const_float', value: -0.25 },
      },
      a: { op: 'const_vec3', value: [0.8, 0.2, 0.1] },
      b: { op: 'const_vec3', value: [0.1, 0.2, 0.9] },
    }))
    expect(node).toBeTruthy()
    expect(typeof (node as { mul: unknown }).mul).toBe('function')
  })

  it('builds safe-math and surface-lerp compositions', () => {
    const lerp = {
      op: 'math',
      operation: 'MULTIPLY_ADD',
      a: {
        op: 'math',
        operation: 'SUBTRACT',
        a: { op: 'const_float', value: 0.85 },
        b: { op: 'const_float', value: 0.15 },
      },
      b: {
        op: 'clamp01',
        input: { op: 'separate', channel: 'y', input: { op: 'uv' } },
      },
      c: { op: 'const_float', value: 0.15 },
    }
    expect(buildTslColorNode(documentOf(lerp))).toBeTruthy()
    expect(buildTslColorNode(documentOf({
      op: 'math',
      operation: 'DIVIDE',
      a: { op: 'const_float', value: 1 },
      b: { op: 'separate', channel: 'x', input: { op: 'uv' } },
    }))).toBeTruthy()
  })

  it('builds object coordinates in either geometry basis', () => {
    const objectDocument = documentOf({ op: 'object_coords' })
    expect(buildTslColorNode(objectDocument)).toBeTruthy()
    expect(buildTslColorNode(objectDocument, {
      objectSpace: { basis: 'gltf-y-up' },
    })).toBeTruthy()
    expect(buildTslColorNode(documentOf({ op: 'generated' }), {
      objectSpace: { basis: 'gltf-y-up' },
      generatedTexspace: { location: [0, 0, 0], size: [1, 1, 1] },
    })).toBeTruthy()
  })

  it('resolves named UV maps and color layers through the runtime resolvers', () => {
    const uvChannel = vi.fn(() => 1)
    expect(buildTslColorNode(
      documentOf({ op: 'uv', uvMap: 'Detail' }), { uvChannel },
    )).toBeTruthy()
    expect(uvChannel).toHaveBeenCalledWith('Detail')
    expect(() => buildTslColorNode(
      documentOf({ op: 'uv', uvMap: 'Detail' }), { uvChannel: () => -1 },
    )).toThrow(/invalid index/)

    const colorAttribute = vi.fn(() => 'color_1')
    expect(buildTslColorNode(
      documentOf({ op: 'vertex_color', layer: 'Paint' }), { colorAttribute },
    )).toBeTruthy()
    expect(colorAttribute).toHaveBeenCalledWith('Paint')
  })

  it('refuses texture_ref without a resolver and resolves through one', () => {
    const reference = documentOf({
      op: 'texture_ref',
      ref: { slot: 3 },
      vector: { op: 'uv' },
    })
    expect(() => buildTslColorNode(reference))
      .toThrow(/BuildTslOptions\.textures/)
    expect(() => buildTslColorNode(reference, { textures: () => null }))
      .toThrow(/resolved no texture/)
  })

  it('refuses malformed image storage before allocating a GPU resource', () => {
    const image = { op: 'tex_image', width: 1, height: 1, pixels: [1, 0, 0, 1],
      interpolation: 'Linear', extension: 'CLIP', vector: { op: 'uv' } }
    const resources = createTslBuildResources()
    expect(() => buildTslColorNode(documentOf({ ...image, width: -1, height: -1 }), { resources }))
      .toThrow(/positive integer dimensions/)
    expect(() => buildTslColorNode(documentOf({ ...image, pixels: [1e40, 0, 0, 1] }), { resources }))
      .toThrow(/finite float32/)
    expect(() => buildTslColorNode(documentOf({ ...image, sourceEngine: 'EEVEE', nativeGpuBackend: 'UNKNOWN' }), { resources }))
      .toThrow(/GPU backend/)
    expect(resources.textures).toHaveLength(0)
  })

  it('requires pinned image dimensions for native Cycles external-nearest selection', () => {
    const image = { op: 'texture_ref', sourceEngine: 'CYCLES', interpolation: 'Closest',
      ref: { slot: 3 }, vector: { op: 'uv' } }
    expect(() => buildTslColorNode(documentOf(image), { textures: () => ({}) }))
      .toThrow(/pinned positive dimensions/)
  })

  it('builds native hue floor tables and refuses unknown lookup modes', () => {
    const ramp = {
      op: 'ramp_lut', lookup: 'FLOOR', samples: 2,
      values: [0.9, 0.1, 0.3, 0.2, 0.1, 0.8, 0.4, 0.9],
      input: { op: 'const_float', value: 0.5 },
    }
    const resources = createTslBuildResources()
    expect(buildTslColorNode(documentOf(ramp), { resources })).toBeTruthy()
    expect(resources.textures).toHaveLength(1)
    resources.dispose()
    expect(() => buildTslColorNode(documentOf({ ...ramp, lookup: 'UNKNOWN' })))
      .toThrow(/lookup UNKNOWN/)
  })

  it('collects build-allocated textures into a disposable resource handle', () => {
    const resources = createTslBuildResources()
    buildTslColorNode(documentOf({
      op: 'ramp_lut',
      samples: 4,
      values: [0, 0, 0, 1, 0.3, 0.3, 0.3, 1, 0.6, 0.6, 0.6, 1, 1, 1, 1, 1],
      input: { op: 'separate', channel: 'x', input: { op: 'uv' } },
    }), { resources })
    expect(resources.textures.length).toBe(1)
    const disposed = vi.fn()
    ;(resources.textures[0] as { dispose: () => void }).dispose = disposed
    resources.dispose()
    expect(disposed).toHaveBeenCalledOnce()
    expect(resources.textures.length).toBe(0)
  })

  it('resolves per-object attributes through the resolver and refuses without it', () => {
    const objectDocument = documentOf({
      op: 'attribute_object', name: 'tint', output: 'color',
    })
    expect(() => buildTslColorNode(objectDocument))
      .toThrow(/BuildTslOptions\.objectAttribute/)
    const objectAttribute = vi.fn(() => buildTslColorNode(documentOf({
      op: 'const_vec3', value: [0.8, 0.35, 0.1],
    })))
    expect(buildTslColorNode(objectDocument, { objectAttribute })).toBeTruthy()
    expect(objectAttribute).toHaveBeenCalledWith('tint')
    expect(buildTslScalarNode(documentOf({
      op: 'attribute_object', name: 'tint', output: 'fac',
    }), { objectAttribute })).toBeTruthy()
  })

  it('builds scalar documents without the RGB broadcast', () => {
    expect(buildTslScalarNode(documentOf({
      op: 'clamp01',
      input: { op: 'separate', channel: 'x', input: { op: 'uv' } },
    }))).toBeTruthy()
  })

  it('rejects unknown documents and unproven ops by name', () => {
    expect(() => buildTslColorNode({
      schemaVersion: 2,
      model: 'blendlink-tsl-ir-v1',
      output: { op: 'uv' },
    } as unknown as TslIrDocument)).toThrow(TslIrError)
    expect(() => buildTslColorNode({
      schemaVersion: 1,
      model: 'something-else',
      output: { op: 'uv' },
    } as unknown as TslIrDocument)).toThrow(TslIrError)
    expect(() => buildTslColorNode(documentOf({ op: 'not_a_real_op' })))
      .toThrow(/no proven TSL mapping/)
  })
})
