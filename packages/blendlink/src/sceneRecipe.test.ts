import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCENE_RECIPE,
  exportSettingsFromRecipe,
  parseSceneRecipe,
} from './sceneRecipe.js'

describe('scene recipe', () => {
  it('accepts the artist-first default with an undeletable Main atlas', () => {
    const result = parseSceneRecipe(DEFAULT_SCENE_RECIPE)
    expect(result.diagnostics).toEqual([])
    expect(result.recipe?.atlases[0]).toMatchObject({
      id: 'main', name: 'Main', bakeOutput: 'lighting',
    })
    expect(result.recipe?.components).toEqual([])
  })

  it('keeps unknown vendor components portable while blocking malformed core intent', () => {
    const vendor = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      components: [{
        id: 'ripple-1', type: 'studio.ripple', schemaVersion: 1, enabled: true,
        target: { kind: 'object', objectId: 'hero-uuid', objectName: 'Hero' },
        values: { speed: 1 },
      }],
    })
    expect(vendor.recipe?.components).toHaveLength(1)
    expect(vendor.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning', message: expect.stringContaining('requires a website adapter'),
    }))

    const malformed = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      components: [{
        id: 'bad-bloom', type: 'blendlink.bloom', schemaVersion: 1, enabled: true,
        target: { kind: 'object', objectId: 'hero-uuid' }, values: { radius: 2 },
      }],
    })
    expect(malformed.recipe).toBeNull()
    expect(malformed.diagnostics.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'components[0].target', 'components[0].values.radius',
    ]))
  })

  it('preserves legacy flattened atlases while validating explicit bake outputs', () => {
    const legacyAtlas = { ...DEFAULT_SCENE_RECIPE.atlases[0] } as Partial<(typeof DEFAULT_SCENE_RECIPE.atlases)[number]>
    delete legacyAtlas.bakeOutput
    const legacy = parseSceneRecipe({ ...DEFAULT_SCENE_RECIPE, atlases: [legacyAtlas] })
    expect(legacy.diagnostics).toEqual([])
    expect(legacy.recipe?.atlases[0].bakeOutput).toBe('appearance')
    expect(exportSettingsFromRecipe(legacy.recipe!).bake?.atlases?.main?.bakeOutput)
      .toBe('appearance')

    const invalid = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      atlases: [{ ...DEFAULT_SCENE_RECIPE.atlases[0], bakeOutput: 'combined' }],
    })
    expect(invalid.recipe).toBeNull()
    expect(invalid.diagnostics.map((entry) => entry.path)).toContain('atlases[0].bakeOutput')
  })

  it('rejects missing Main and duplicate atlas identifiers loudly', () => {
    const result = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      atlases: [
        { ...DEFAULT_SCENE_RECIPE.atlases[0], id: 'hero' },
        { ...DEFAULT_SCENE_RECIPE.atlases[0], id: 'hero' },
      ],
    })
    expect(result.recipe).toBeNull()
    expect(result.diagnostics.map((entry) => entry.message)).toEqual(expect.arrayContaining([
      'the first atlas must be the undeletable main atlas',
      'duplicate atlas id "hero"',
    ]))
  })

  it('resolves preview/final quality without taking filesystem ownership', () => {
    const recipe = {
      ...DEFAULT_SCENE_RECIPE,
      atlases: [
        DEFAULT_SCENE_RECIPE.atlases[0],
        { ...DEFAULT_SCENE_RECIPE.atlases[0], id: 'hero', name: 'Hero', size: 4096 },
        {
          ...DEFAULT_SCENE_RECIPE.atlases[0],
          id: 'background', name: 'Background', size: 512,
          targetDensity: 64, margin: 12,
        },
      ],
    }
    const preview = exportSettingsFromRecipe(recipe, {
      collection: 'Website',
      imageFormat: 'NONE',
      exporterOverrides: { export_unused_images: false },
      mode: 'standard',
    }, 'preview')
    expect(preview).toMatchObject({
      collection: 'Website',
      imageFormat: 'NONE',
      mode: 'baked',
      bake: {
        size: 512,
        samples: 16,
        margin: 12,
        previewScaleToFit: true,
        atlases: {
          main: { size: 512, margin: 12, fitPolicy: 'scale', bakeOutput: 'lighting' },
          hero: { size: 1024, margin: 12, fitPolicy: 'scale', bakeOutput: 'lighting' },
          background: {
            size: 256, targetDensity: 32, margin: 6,
            fitPolicy: 'scale', bakeOutput: 'lighting',
          },
        },
      },
    })

    const final = exportSettingsFromRecipe(recipe, {}, 'final')
    expect(final.bake?.margin).toBe(48)
    expect(final.bake?.previewScaleToFit).toBeUndefined()
    expect(final.bake?.atlases).toMatchObject({
      main: { margin: 48, fitPolicy: 'block' },
      hero: { margin: 48, fitPolicy: 'block' },
      background: { size: 512, targetDensity: 64, margin: 12, fitPolicy: 'block' },
    })
  })

  it('keeps realtime scenes out of the bake pipeline', () => {
    const settings = exportSettingsFromRecipe(
      { ...DEFAULT_SCENE_RECIPE, presentation: 'realtime' },
      { collection: 'Website' },
    )
    expect(settings).toEqual({ collection: 'Website', mode: 'standard' })
  })

  it('validates a rename-stable presentation camera and responsive compositions', () => {
    const result = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      camera: {
        objectId: 'camera-uuid',
        objectName: 'Hero Camera',
        behavior: 'orbit',
        targetId: 'target-uuid',
        targetName: 'Hero Focus',
        compositions: [
          { name: 'Desktop', width: 1440, height: 900, safeMargin: 0.08 },
          { name: 'Mobile', width: 390, height: 844, safeMargin: 0.1 },
        ],
      },
    })
    expect(result.diagnostics).toEqual([])
    expect(result.recipe?.camera).toMatchObject({
      objectId: 'camera-uuid',
      behavior: 'orbit',
      targetId: 'target-uuid',
      framing: 'authored',
      compositions: [{ name: 'Desktop' }, { name: 'Mobile' }],
    })
  })

  it('blocks an orbit camera with no target or usable composition', () => {
    const result = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      camera: {
        objectId: 'camera-uuid',
        objectName: 'Hero Camera',
        behavior: 'orbit',
        compositions: [],
      },
    })
    expect(result.recipe).toBeNull()
    expect(result.diagnostics.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'camera.targetId',
      'camera.compositions',
    ]))
  })

  it('validates artist-authored animation startup without guessing missing clips', () => {
    const valid = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      playback: { start: 'named', clip: 'Hero Idle', loop: 'pingpong', speed: 0.75 },
    })
    expect(valid.diagnostics).toEqual([])
    expect(valid.recipe?.playback).toEqual({
      start: 'named', clip: 'Hero Idle', loop: 'pingpong', speed: 0.75,
    })
    const invalid = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      playback: { start: 'named', loop: 'repeat', speed: 1 },
    })
    expect(invalid.recipe).toBeNull()
    expect(invalid.diagnostics.map((entry) => entry.path)).toContain('playback.clip')
  })

  it('keeps website-owned look untouched unless the artist opts in', () => {
    expect(parseSceneRecipe(DEFAULT_SCENE_RECIPE).recipe?.look).toEqual({
      toneMapping: 'application', exposure: 0, background: 'application',
    })
    const authored = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      look: {
        toneMapping: 'agx', exposure: -1, background: 'color',
        backgroundColor: [0.1, 0.2, 0.3],
      },
    })
    expect(authored.diagnostics).toEqual([])
    expect(authored.recipe?.look).toMatchObject({
      toneMapping: 'agx', exposure: -1, backgroundColor: [0.1, 0.2, 0.3],
    })
  })

  it('validates explicit safe framing and portable scene fog', () => {
    const authored = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      camera: {
        objectId: 'camera-uuid', objectName: 'Hero Camera', behavior: 'fixed',
        framing: 'fit-scene',
        compositions: [{ name: 'Desktop', width: 1440, height: 900, safeMargin: 0.1 }],
      },
      fog: { mode: 'linear', color: [0.1, 0.2, 0.3], near: 8, far: 60, density: 0.02 },
    })
    expect(authored.diagnostics).toEqual([])
    expect(authored.recipe?.camera?.framing).toBe('fit-scene')
    expect(authored.recipe?.fog).toMatchObject({ mode: 'linear', near: 8, far: 60 })

    const invalid = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      fog: { mode: 'linear', color: [0, 0, 0], near: 10, far: 5, density: 0.02 },
    })
    expect(invalid.recipe).toBeNull()
    expect(invalid.diagnostics.map((entry) => entry.path)).toContain('fog.far')
  })

  it('validates resolved shadow budgets and keeps website ownership explicit', () => {
    expect(parseSceneRecipe(DEFAULT_SCENE_RECIPE).recipe?.shadows.preset).toBe('application')
    const authored = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      shadows: {
        preset: 'soft', filter: 'vsm', mapSize: 2048, maxDistance: 50,
        bias: -0.0001, normalBias: 0.02, radius: 4, autoUpdate: true,
      },
    })
    expect(authored.diagnostics).toEqual([])
    expect(authored.recipe?.shadows).toMatchObject({ preset: 'soft', filter: 'vsm', mapSize: 2048 })
    const invalid = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      shadows: { ...DEFAULT_SCENE_RECIPE.shadows, mapSize: 64 },
    })
    expect(invalid.recipe).toBeNull()
    expect(invalid.diagnostics.map((entry) => entry.path)).toContain('shadows.mapSize')
  })

  it('separates HDR lighting from visible and grounded backgrounds', () => {
    const authored = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      environment: {
        source: 'image', imageName: 'Studio.exr', lighting: 'image', background: 'grounded',
        lightingIntensity: 1.5, lightingRotation: 20, backgroundIntensity: 0.8,
        backgroundRotation: -15, backgroundBlur: 0.2, groundHeight: 1.6, groundRadius: 80,
      },
    })
    expect(authored.diagnostics).toEqual([])
    expect(authored.recipe?.environment).toMatchObject({
      imageName: 'Studio.exr', lighting: 'image', background: 'grounded', groundHeight: 1.6,
    })
    const invalid = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      environment: { ...DEFAULT_SCENE_RECIPE.environment, lighting: 'image' },
    })
    expect(invalid.recipe).toBeNull()
    expect(invalid.diagnostics.map((entry) => entry.path)).toContain('environment.source')
  })

  it('validates named reflection probes with stable influence and capture anchors', () => {
    const authored = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      reflectionProbes: [{
        id: 'hero-metal', name: 'Hero Metal', objectId: 'probe-uuid', objectName: 'Hero Probe',
        shape: 'box', source: 'runtime', resolution: 256, samples: 128,
        influence: 8, intensity: 1.25,
        anchorId: 'anchor-uuid', anchorName: 'Hero Reflection Anchor',
      }],
    })
    expect(authored.diagnostics).toEqual([])
    expect(authored.recipe?.reflectionProbes[0]).toMatchObject({
      id: 'hero-metal', objectId: 'probe-uuid', shape: 'box', source: 'runtime',
      resolution: 256, samples: 128,
      influence: 8, intensity: 1.25, anchorId: 'anchor-uuid',
    })

    const baked = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      reflectionProbes: [{
        id: 'baked-metal', name: 'Baked Metal', objectId: 'baked-probe', objectName: 'Baked Probe',
        shape: 'sphere', source: 'baked', resolution: 512, samples: 64,
        influence: 5, intensity: 0.8,
        texture: {
          imageName: 'Baked Metal.exr', width: 2048, height: 1024,
          format: 'exr', colorSpace: 'linear',
          sourceHash: '0123456789abcdef01234567', contentHash: 'fedcba9876543210',
        },
      }],
    })
    expect(baked.diagnostics).toEqual([])
    expect(baked.recipe?.reflectionProbes[0]).toMatchObject({
      source: 'baked', samples: 64,
      texture: { width: 2048, height: 1024, format: 'exr', colorSpace: 'linear' },
    })

    const invalidTexture = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      reflectionProbes: [{
        id: 'bad-bake', name: 'Bad Bake', objectId: 'bad-probe', objectName: 'Bad Probe',
        shape: 'box', source: 'baked', resolution: 256, samples: 0,
        influence: 5, intensity: 1,
        texture: {
          imageName: 'Square.png', width: 512, height: 512,
          format: 'png', colorSpace: 'srgb', sourceHash: 'not-a-hash',
        },
      }],
    })
    expect(invalidTexture.recipe).toBeNull()
    expect(invalidTexture.diagnostics.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'reflectionProbes[0].samples',
      'reflectionProbes[0].texture',
      'reflectionProbes[0].texture.sourceHash',
      'reflectionProbes[0].texture.contentHash',
    ]))

    const invalid = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      reflectionProbes: [
        {
          id: 'hero-metal', name: 'One', objectId: 'same-probe', objectName: 'One',
          shape: 'box', source: 'runtime', resolution: 300, samples: 128,
          influence: 5, intensity: 1,
        },
        {
          id: 'hero-metal', name: 'Two', objectId: 'same-probe', objectName: 'Two',
          shape: 'sphere', source: 'runtime', resolution: 256, samples: 128,
          influence: 5, intensity: 1,
        },
      ],
    })
    expect(invalid.recipe).toBeNull()
    expect(invalid.diagnostics.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'reflectionProbes[0].resolution',
      'reflectionProbes[1].id',
      'reflectionProbes[1].objectId',
    ]))
  })
})
