import { describe, expect, it } from 'vitest'
import {
  SCENE_COMPONENT_TARGET,
  componentDefaults,
  componentDefinition,
  isJsonValue,
  parsePortableComponents,
} from './components.js'

describe('portable components', () => {
  it('preserves an unknown vendor component while warning that an adapter is needed', () => {
    const result = parsePortableComponents([{
      id: 'water-ripple-1', type: 'studio.water-ripple', schemaVersion: 1, enabled: true,
      target: { kind: 'object', objectId: 'hero-uuid', objectName: 'Hero' },
      values: { speed: 1.25, nested: { amplitude: 0.2 } },
    }])
    expect(result.components).toEqual([expect.objectContaining({
      type: 'studio.water-ripple', target: { kind: 'object', objectId: 'hero-uuid', objectName: 'Hero' },
    })])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning', message: expect.stringContaining('requires a website adapter'),
    }))
  })

  it('validates known targets, JSON-only values, and useful field ranges', () => {
    const result = parsePortableComponents([{
      id: 'hero-bloom', type: 'blendlink.bloom', schemaVersion: 1, enabled: true,
      target: { kind: 'object', objectId: 'hero' }, values: { intensity: -1, radius: 2 },
    }, {
      id: 'broken-values', type: 'studio.custom', schemaVersion: 1, enabled: true,
      target: SCENE_COMPONENT_TARGET, values: { impossible: Number.NaN },
    }])
    expect(result.components).toHaveLength(1)
    expect(result.diagnostics.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'components[0].target',
      'components[0].values.intensity',
      'components[0].values.radius',
      'components[1].values',
    ]))
  })

  it('provides Needle-aligned artist defaults without conflating them with runtime code', () => {
    expect(componentDefaults('blendlink.bloom')).toEqual({
      mode: 'bright-pixels', intensity: 0.5, threshold: 0.8, radius: 0.4,
    })
    expect(componentDefaults('blendlink.ambient-occlusion')).toEqual({
      radiusMode: 'world', worldRadius: 1, screenRadius: 32, intensity: 2, color: [0, 0, 0],
    })
    expect(componentDefaults('blendlink.shadow-catcher')).toEqual({
      mode: 'mask', color: [0, 0, 0], opacity: 0.5, lightStrength: 6.6,
      includeDescendants: true,
    })
    expect(componentDefaults('blendlink.contact-shadows')).toEqual({
      autoFit: true, darkness: 0.5, opacity: 0.5, blur: 4,
      occludeBelowGround: false, backfaceShadows: true, updatePolicy: 'static',
    })
    expect(componentDefaults('blendlink.outline')).toEqual({
      visibleColor: [0, 0, 0], hiddenColor: [0.08, 0.08, 0.08],
      strength: 3, thickness: 1, xRay: false,
    })
    expect(componentDefaults('blendlink.color-grading')).toEqual({
      lutUrl: '', intensity: 1, tetrahedralInterpolation: true,
    })
    expect(componentDefaults('blendlink.depth-of-field')).toEqual({
      focusMode: 'distance', focusDistance: 3, focusRange: 2, blurStrength: 1,
      focusTargetId: '', focusTargetName: '',
    })
    expect(componentDefaults('blendlink.kuwahara')).toEqual({
      strength: 0.75, brushScale: 4, directionality: 0.75, detail: 0.5,
    })
    expect(componentDefaults('blendlink.chromatic-aberration')).toEqual({
      amount: 0.0015, mode: 'radial', angle: 0, centerX: 0.5, centerY: 0.5,
    })
    expect(componentDefaults('blendlink.pixelation')).toEqual({
      pixelSize: 6, depthEdgeStrength: 0, normalEdgeStrength: 0,
    })
    expect(componentDefaults('blendlink.sharpen')).toEqual({ amount: 0.35 })
    expect(componentDefaults('blendlink.tilt-shift')).toEqual({
      focusPosition: 0.5, angle: 0, feather: 0.25, strength: 0.7, quality: 'balanced',
    })
    expect(componentDefaults('blendlink.see-through')).toEqual({
      fadeDistance: 0.5, minOpacity: 0.15, duration: 0.12,
    })
    expect(componentDefaults('blendlink.website-surface')).toEqual({
      name: 'surface', colorTreatment: 'display',
    })
    expect(componentDefaults('blendlink.audio-source')).toMatchObject({
      autoplay: false, loop: false, volume: 1, spatial: false, minDistance: 2, maxDistance: 50,
    })
  })

  it('validates Website Surface semantic names across object targets', () => {
    const websiteSurface = (id: string, objectId: string, name: string) => ({
      id, type: 'blendlink.website-surface', schemaVersion: 1, enabled: true,
      target: { kind: 'object', objectId },
      values: { name, colorTreatment: 'display' },
    })
    const result = parsePortableComponents([
      websiteSurface('monitor-a', 'screen-a', 'monitor-screen'),
      websiteSurface('monitor-b', 'screen-b', 'monitor-screen'),
      websiteSurface('monitor-c', 'screen-c', 'Monitor Screen'),
    ])
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error', path: 'components[1].values.name',
        message: expect.stringContaining('already used'),
      }),
      expect.objectContaining({
        severity: 'error', path: 'components[2].values.name',
        message: expect.stringContaining('lowercase'),
      }),
    ]))
  })

  it('keeps renderer support and runtime consequences in definitions, not records', () => {
    expect(componentDefinition('blendlink.bloom')).toMatchObject({
      phase: 'post-hdr',
      cardinality: 'one-per-scene',
      requires: ['post-pipeline', 'hdr-color'],
      cost: 'medium',
      // Bloom runs on the TSL post pipeline; the registry used to claim
      // otherwise and the artist-facing badge said so out loud.
      adapters: { webgl: 'preview', tsl: 'preview' },
      consequence: expect.stringContaining('render'),
    })
    expect(componentDefinition('blendlink.open-url')).toMatchObject({
      requires: ['pointer', 'raycast', 'dom-accessibility'],
      searchSynonyms: expect.arrayContaining(['link', 'click', 'tap']),
    })
    expect(componentDefinition('blendlink.ambient-occlusion')).toMatchObject({
      phase: 'post-depth', requires: ['post-pipeline', 'depth', 'normals', 'camera'],
      cost: 'high', adapters: { webgl: 'preview', tsl: 'preview' },
    })
    expect(componentDefinition('blendlink.shadow-catcher')).toMatchObject({
      targets: ['object'], phase: 'initial', cardinality: 'one-per-target',
      cost: 'low', adapters: { webgl: 'preview', tsl: 'fallback' },
      consequence: expect.stringContaining('restores authored materials transactionally'),
    })
    expect(componentDefinition('blendlink.contact-shadows')).toMatchObject({
      targets: ['scene', 'object'], phase: 'update', cardinality: 'one-per-scene',
      cost: 'high', adapters: { webgl: 'preview', tsl: 'unavailable' },
      consequence: expect.stringContaining('five passes'),
    })
    expect(componentDefinition('blendlink.kuwahara')).toMatchObject({
      phase: 'post-ldr', cost: 'very-high',
      adapters: { webgl: 'preview', tsl: 'preview' },
      fallbacks: { webgl: expect.stringContaining('Experimental Preview') },
      consequence: expect.stringContaining('sample count and filter radius'),
    })
    expect(componentDefinition('blendlink.chromatic-aberration')).toMatchObject({
      phase: 'post-ldr', requires: ['post-pipeline'], cost: 'low',
    })
    expect(componentDefinition('blendlink.pixelation')).toMatchObject({
      phase: 'post-ldr', requires: ['post-pipeline', 'depth', 'normals'], cost: 'medium',
    })
    expect(componentDefinition('blendlink.sharpen')).toMatchObject({
      phase: 'post-ldr', requires: ['post-pipeline'], cost: 'low',
    })
    expect(componentDefinition('blendlink.tilt-shift')).toMatchObject({
      phase: 'post-hdr', requires: ['post-pipeline'], cost: 'high',
      consequence: expect.stringContaining('Quality'),
    })
    expect(componentDefaults('blendlink.bloom')).not.toHaveProperty('phase')
  })

  it('validates rendering modes, LUT URLs, and conditional depth-of-field focus', () => {
    const result = parsePortableComponents([{
      id: 'invalid-bloom-mode', type: 'blendlink.bloom', schemaVersion: 1, enabled: true,
      target: SCENE_COMPONENT_TARGET,
      values: { mode: 'collection', intensity: 0.5, threshold: 1, radius: 0.4 },
    }, {
      id: 'unsafe-lut', type: 'blendlink.color-grading', schemaVersion: 1, enabled: true,
      target: SCENE_COMPONENT_TARGET,
      values: { lutUrl: 'file:///grade.cube', intensity: 1, tetrahedralInterpolation: true },
    }, {
      id: 'missing-focus', type: 'blendlink.depth-of-field', schemaVersion: 1, enabled: true,
      target: SCENE_COMPONENT_TARGET,
      values: { focusMode: 'object', focusDistance: 3, focusRange: 2, blurStrength: 1 },
    }])
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', path: 'components[0].values.mode' }),
      expect.objectContaining({ severity: 'error', path: 'components[1].values.lutUrl' }),
      expect.objectContaining({ severity: 'error', path: 'components[2].values.focusTargetId' }),
    ]))
  })

  it('accepts emissive-object Bloom and a stable depth-of-field focus object without collection references', () => {
    const result = parsePortableComponents([{
      id: 'selective-bloom', type: 'blendlink.bloom', schemaVersion: 1, enabled: true,
      target: SCENE_COMPONENT_TARGET,
      values: { mode: 'emissive-objects', intensity: 0.7, threshold: 1, radius: 0.5 },
    }, {
      id: 'object-focus', type: 'blendlink.depth-of-field', schemaVersion: 1, enabled: true,
      target: SCENE_COMPONENT_TARGET,
      values: {
        focusMode: 'object', focusDistance: 3, focusRange: 2, blurStrength: 1,
        focusTargetId: 'focus-target', focusTargetName: 'Focus Target',
      },
    }])
    expect(result.diagnostics).toEqual([])
  })

  it('validates the new artist effects loudly while retaining extension values', () => {
    const result = parsePortableComponents([{
      id: 'strong-fringing', type: 'blendlink.chromatic-aberration', schemaVersion: 1, enabled: true,
      target: SCENE_COMPONENT_TARGET,
      values: {
        amount: 0.02, mode: 'radial', angle: 0, centerX: 0.5, centerY: 0.5,
        futureLensModel: 'anamorphic',
      },
    }, {
      id: 'fractional-pixels', type: 'blendlink.pixelation', schemaVersion: 1, enabled: true,
      target: SCENE_COMPONENT_TARGET,
      values: { pixelSize: 5.5, depthEdgeStrength: 0, normalEdgeStrength: 0 },
    }, {
      id: 'bad-tilt-quality', type: 'blendlink.tilt-shift', schemaVersion: 1, enabled: true,
      target: SCENE_COMPONENT_TARGET,
      values: { focusPosition: 0.5, angle: 0, feather: 0.25, strength: 0.7, quality: 'ultra' },
    }])
    expect(result.components[0]?.values.futureLensModel).toBe('anamorphic')
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning', path: 'components[0].values.amount',
        message: expect.stringContaining('readability'),
      }),
      expect.objectContaining({
        severity: 'warning', path: 'components[0].values.futureLensModel',
        message: expect.stringContaining('preserved'),
      }),
      expect.objectContaining({ severity: 'error', path: 'components[1].values.pixelSize' }),
      expect.objectContaining({ severity: 'error', path: 'components[2].values.quality' }),
    ]))
  })

  it('rejects duplicate placements and unsafe authored URLs', () => {
    const base = {
      type: 'blendlink.open-url', schemaVersion: 1, enabled: true,
      target: { kind: 'object', objectId: 'hero' },
      values: { url: 'javascript:alert(1)', newTab: true },
    }
    const result = parsePortableComponents([
      { ...base, id: 'first' },
      { ...base, id: 'second', values: { url: '/safe', newTab: false } },
    ])
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', path: 'components[0].values.url' }),
      expect.objectContaining({
        severity: 'error', path: 'components[1]',
        message: expect.stringMatching(/already assigned/),
      }),
    ]))
  })

  it('enforces one Contact Shadows placement across Scene and Empty targets', () => {
    const values = {
      autoFit: true, darkness: 0.5, opacity: 0.5, blur: 4,
      occludeBelowGround: false, backfaceShadows: true, updatePolicy: 'static',
    }
    const result = parsePortableComponents([{
      id: 'scene-contact', type: 'blendlink.contact-shadows',
      schemaVersion: 1, enabled: true, target: SCENE_COMPONENT_TARGET, values,
    }, {
      id: 'empty-contact', type: 'blendlink.contact-shadows',
      schemaVersion: 1, enabled: true,
      target: { kind: 'object', objectId: 'contact-empty' }, values,
    }])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', path: 'components[1]',
      message: expect.stringContaining('already assigned in this scene'),
    }))
  })

  it('rejects invalid Contact Shadows policy and authored ranges', () => {
    const result = parsePortableComponents([{
      id: 'bad-contact', type: 'blendlink.contact-shadows',
      schemaVersion: 1, enabled: true, target: SCENE_COMPONENT_TARGET,
      values: {
        autoFit: true, darkness: -1, opacity: 2, blur: 101,
        occludeBelowGround: false, backfaceShadows: true, updatePolicy: 'sometimes',
      },
    }])
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', path: 'components[0].values.darkness' }),
      expect.objectContaining({ severity: 'error', path: 'components[0].values.opacity' }),
      expect.objectContaining({ severity: 'error', path: 'components[0].values.blur' }),
      expect.objectContaining({ severity: 'error', path: 'components[0].values.updatePolicy' }),
    ]))
  })

  it('rejects cycles, functions, and class instances before JSON serialization', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(isJsonValue(cyclic)).toBe(false)
    expect(isJsonValue({ callback: () => undefined })).toBe(false)
    expect(isJsonValue(new Date())).toBe(false)
  })

  it('parks an unfinished disabled draft without relaxing structural safety', () => {
    const result = parsePortableComponents([{
      id: 'draft-link', type: 'blendlink.open-url', schemaVersion: 1, enabled: false,
      target: { kind: 'object', objectId: 'hero' },
      values: { url: '', newTab: true },
    }, {
      id: 'unsafe-draft', type: 'blendlink.open-url', schemaVersion: 1, enabled: false,
      target: { kind: 'object', objectId: 'other' },
      values: { url: 'javascript:alert(1)', newTab: true },
    }])
    expect(result.components).toHaveLength(2)
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      path: 'components[0].values.url', severity: 'error',
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      path: 'components[1].values.url', severity: 'error',
    }))
  })

  it('enforces the same lowercase namespaced component type as Blender', () => {
    const result = parsePortableComponents([{
      id: 'mixed-case', type: 'Blendlink.Bloom', schemaVersion: 1, enabled: true,
      target: SCENE_COMPONENT_TARGET, values: {},
    }])
    expect(result.components).toEqual([])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', path: 'components[0].type',
      message: expect.stringContaining('vendor-namespaced'),
    }))
  })
})
