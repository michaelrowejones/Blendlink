import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  commitPublishedFiles, draftSettings, externalDependenciesCurrent, externalDependencyWarnings,
  pythonPipelineSignature,
} from './sync.js'
import type { ResolvedScene } from './config.js'
import type { SceneManifest } from './typegen.js'
import {
  prepareGeneratedProvenance,
  writeLocalPathProvenance,
} from './generatedProvenance.js'

describe('unchanged-scene external dependency gate', () => {
  it('invalidates when an ordinary linked texture changes without touching the blend', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-linked-dependency-'))
    try {
      const blendPath = join(directory, 'hero.blend')
      const imagePath = join(directory, 'wood.png')
      writeFileSync(blendPath, 'blend')
      writeFileSync(imagePath, 'first image bytes')
      const bytes = Buffer.from('first image bytes')
      const manifest = {
        externalDependencies: [{
          path: 'wood.png', relativeToBlend: true, exists: true,
          bytes: bytes.byteLength,
          hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
          volatile: false,
        }],
      } as SceneManifest
      expect(externalDependenciesCurrent(manifest, { blendPath })).toBe(true)
      writeFileSync(imagePath, 'second image bytes')
      expect(externalDependenciesCurrent(manifest, { blendPath })).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('retains proven unbound-material residue without putting it in the build cache key', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-unbound-material-'))
    try {
      const blendPath = join(directory, 'hero.blend')
      const residuePath = join(directory, 'old-addon-image.png')
      writeFileSync(blendPath, 'blend')
      const manifest = {
        externalDependencies: [{
          path: 'old-addon-image.png', relativeToBlend: true, exists: false,
          bytes: 0, hash: null, volatile: false,
          reachable: false, reachabilityReason: 'unbound-material',
        }],
      } as SceneManifest
      expect(externalDependenciesCurrent(manifest, { blendPath })).toBe(true)
      writeFileSync(residuePath, 'irrelevant image bytes')
      expect(externalDependenciesCurrent(manifest, { blendPath })).toBe(true)
      expect(externalDependenciesCurrent({
        externalDependencies: [{
          ...manifest.externalDependencies![0],
          reachabilityReason: undefined,
        }],
      } as SceneManifest, { blendPath })).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('checks an opaque outside-project dependency through private local provenance', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-private-dependency-'))
    const projectRoot = join(directory, 'project')
    const privateRoot = join(directory, 'private-cache')
    try {
      mkdirSync(projectRoot, { recursive: true })
      const blendPath = join(projectRoot, 'hero.blend')
      const dependencyPath = join(directory, 'private', 'linked.blend')
      mkdirSync(join(directory, 'private'), { recursive: true })
      writeFileSync(blendPath, 'blend')
      writeFileSync(dependencyPath, 'first dependency bytes')
      const bytes = readFileSync(dependencyPath)
      const prepared = prepareGeneratedProvenance({
        projectRoot,
        sourceBlend: blendPath,
        externalDependencies: [{
          path: dependencyPath,
          relativeToBlend: false,
          exists: true,
          bytes: bytes.byteLength,
          hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
          volatile: false,
        }],
      })
      const manifest = { externalDependencies: prepared.externalDependencies } as SceneManifest

      expect(externalDependenciesCurrent(
        manifest,
        { blendPath, root: projectRoot },
        { localProvenanceRoot: privateRoot },
      )).toBe(false)
      writeLocalPathProvenance(prepared.localPaths, { cacheRoot: privateRoot })
      expect(externalDependenciesCurrent(
        manifest,
        { blendPath, root: projectRoot },
        { localProvenanceRoot: privateRoot },
      )).toBe(true)
      writeFileSync(dependencyPath, 'changed dependency bytes')
      expect(externalDependenciesCurrent(
        manifest,
        { blendPath, root: projectRoot },
        { localProvenanceRoot: privateRoot },
      )).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('separates non-impacting material residue from reachable missing files', () => {
    const warnings = externalDependencyWarnings([{
      path: 'hero.png', relativeToBlend: true, exists: false,
      bytes: 0, hash: null, volatile: false,
    }, {
      path: 'camfx.png', relativeToBlend: false, exists: false,
      bytes: 0, hash: null, volatile: false,
      reachable: false, reachabilityReason: 'unbound-material',
    }, {
      path: 'unproved.png', relativeToBlend: false, exists: false,
      bytes: 0, hash: null, volatile: false,
      reachable: false,
    }])
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toMatch(/hero\.png.*may render differently/i)
    expect(warnings[0]).toContain('unproved.png')
    expect(warnings[0]).not.toContain('camfx.png')
    expect(warnings[1]).toMatch(/camfx\.png.*cannot affect this build/i)
    expect(warnings[1]).not.toContain('hero.png')
  })
})

describe('Python compiler signature', () => {
  it('invalidates source checkouts when canonical web-light policy changes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-python-signature-'))
    const moduleDirectory = join(directory, 'packages', 'blendlink', 'src')
    const blenderDirectory = join(moduleDirectory, 'blender')
    const addonDirectory = join(directory, 'packages', 'blender-addon')
    try {
      mkdirSync(blenderDirectory, { recursive: true })
      mkdirSync(addonDirectory, { recursive: true })
      writeFileSync(join(blenderDirectory, 'export_scene.py'), 'export = 1\n')
      writeFileSync(join(blenderDirectory, 'bakelib.py'), 'bake = 1\n')
      writeFileSync(join(addonDirectory, 'procedural.py'), 'procedural = 1\n')
      const lights = join(addonDirectory, 'weblights.py')
      writeFileSync(lights, 'lighting_mode = "COMPAT"\n')
      const before = pythonPipelineSignature(moduleDirectory)

      writeFileSync(lights, 'lighting_mode = "SPEC"\n')
      expect(pythonPipelineSignature(moduleDirectory)).not.toBe(before)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('invalidates source checkouts when the material compiler changes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-material-signature-'))
    const moduleDirectory = join(directory, 'packages', 'blendlink', 'src')
    const blenderDirectory = join(moduleDirectory, 'blender')
    const addonDirectory = join(directory, 'packages', 'blender-addon')
    try {
      mkdirSync(blenderDirectory, { recursive: true })
      mkdirSync(addonDirectory, { recursive: true })
      writeFileSync(join(blenderDirectory, 'export_scene.py'), 'export = 1\n')
      writeFileSync(join(blenderDirectory, 'bakelib.py'), 'bake = 1\n')
      const compiler = join(addonDirectory, 'material_compiler.py')
      writeFileSync(compiler, 'rule = "factor"\n')
      const before = pythonPipelineSignature(moduleDirectory)

      writeFileSync(compiler, 'rule = "vertexColor"\n')
      expect(pythonPipelineSignature(moduleDirectory)).not.toBe(before)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('invalidates source checkouts when the shared GLB helper changes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-glblib-signature-'))
    const moduleDirectory = join(directory, 'packages', 'blendlink', 'src')
    const blenderDirectory = join(moduleDirectory, 'blender')
    const addonDirectory = join(directory, 'packages', 'blender-addon')
    try {
      mkdirSync(blenderDirectory, { recursive: true })
      mkdirSync(addonDirectory, { recursive: true })
      writeFileSync(join(blenderDirectory, 'export_scene.py'), 'export = 1\n')
      writeFileSync(join(blenderDirectory, 'bakelib.py'), 'bake = 1\n')
      const glblib = join(addonDirectory, 'glblib.py')
      writeFileSync(glblib, 'attestation = "v1"\n')
      const before = pythonPipelineSignature(moduleDirectory)

      writeFileSync(glblib, 'attestation = "v2"\n')
      expect(pythonPipelineSignature(moduleDirectory)).not.toBe(before)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('hashes the copied policy actually executed by a built CLI', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-built-python-signature-'))
    const moduleDirectory = join(directory, 'packages', 'blendlink', 'dist')
    const blenderDirectory = join(moduleDirectory, 'blender')
    const addonDirectory = join(directory, 'packages', 'blender-addon')
    try {
      mkdirSync(blenderDirectory, { recursive: true })
      mkdirSync(addonDirectory, { recursive: true })
      writeFileSync(join(blenderDirectory, 'export_scene.py'), 'export = 1\n')
      writeFileSync(join(blenderDirectory, 'bakelib.py'), 'bake = 1\n')
      writeFileSync(join(blenderDirectory, 'procedural.py'), 'procedural = "copy"\n')
      const copiedLights = join(blenderDirectory, 'weblights.py')
      const sourceLights = join(addonDirectory, 'weblights.py')
      writeFileSync(copiedLights, 'lighting_mode = "COMPAT"\n')
      writeFileSync(sourceLights, 'lighting_mode = "SOURCE"\n')
      const before = pythonPipelineSignature(moduleDirectory)

      writeFileSync(sourceLights, 'lighting_mode = "EDITED_SOURCE"\n')
      expect(pythonPipelineSignature(moduleDirectory)).toBe(before)
      writeFileSync(copiedLights, 'lighting_mode = "SPEC"\n')
      expect(pythonPipelineSignature(moduleDirectory)).not.toBe(before)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('publication transaction recovery', () => {
  it('preserves named recovery files when restoring an original fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-publication-'))
    const first = join(directory, 'first.glb')
    const second = join(directory, 'second.ts')
    const token = 'failure-test'
    const secondNext = `${second}.blendlink-next-${token}-1`
    const secondBackup = `${second}.blendlink-backup-${token}-1`
    try {
      writeFileSync(first, 'old first')
      writeFileSync(second, 'old second')
      const failingRename = (from: string, to: string) => {
        if (
          (from === secondNext && to === second) ||
          (from === secondBackup && to === second)
        ) {
          throw new Error(from === secondNext ? 'install failed' : 'restore failed')
        }
        renameSync(from, to)
      }

      expect(() => commitPublishedFiles([
        { finalPath: first, content: 'new first' },
        { finalPath: second, content: 'new second' },
      ], token, failingRename)).toThrowError(
        new RegExp(`rollback was incomplete.*${secondBackup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      )

      expect(readFileSync(first, 'utf8')).toBe('old first')
      expect(existsSync(second)).toBe(false)
      expect(readFileSync(secondBackup, 'utf8')).toBe('old second')
      expect(readFileSync(secondNext, 'utf8')).toBe('new second')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('legacy config Preview quality', () => {
  it('scales each atlas density and pixel padding with its readable Preview size', () => {
    const settings = draftSettings({
      settings: {
        mode: 'baked',
        bake: {
          size: 4096,
          samples: 128,
          margin: 48,
          supersample: 2,
          atlases: {
            main: {
              size: 4096, targetDensity: 256, margin: 48, fitPolicy: 'block',
            },
            background: {
              size: 512, targetDensity: 64, margin: 12, fitPolicy: 'block',
            },
            icon: {
              size: 128, targetDensity: 32, margin: 0, fitPolicy: 'block',
            },
          },
        },
      },
    } as ResolvedScene)

    expect(settings).toMatchObject({
      draft: true,
      bake: {
        size: 1024,
        samples: 16,
        margin: 12,
        supersample: 1,
        previewScaleToFit: true,
        atlases: {
          main: {
            size: 1024, targetDensity: 64, margin: 12, fitPolicy: 'scale',
          },
          background: {
            size: 256, targetDensity: 32, margin: 6, fitPolicy: 'scale',
          },
          icon: {
            size: 128, targetDensity: 32, margin: 0, fitPolicy: 'scale',
          },
        },
      },
    })
  })
})
