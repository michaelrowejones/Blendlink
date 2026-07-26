import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  configSourceRevisionProblem,
  loadConfig,
  resolveConfig,
  sceneIdentifier,
} from './config.js'

describe('scene output identity', () => {
  it('canonicalizes natural explicit and inferred labels to one safe binding/path segment', () => {
    expect(sceneIdentifier('Hero (Final).blend')).toBe('HeroFinalBlend')
    expect(sceneIdentifier('../Night: Interior/CON')).toBe('NightInteriorCON')
    expect(sceneIdentifier('123 launch')).toBe('scene123Launch')
    expect(sceneIdentifier('default')).toBe('sceneDefault')

    const root = resolve('C:/blendlink-config-fixture')
    const config = resolveConfig({ scenes: [
      { file: 'Hero (Final).blend', external: true },
      { file: 'unused.blend', name: 'night-scene', external: true },
    ] }, root)
    expect(config.scenes.map((scene) => scene.name)).toEqual(['HeroFinal', 'nightScene'])
    expect(config.scenes[0]!.modulePath).toBe(resolve(root, 'src/generated/HeroFinal.gen.ts'))
    expect(config.scenes[1]!.glbPath).toBe(resolve(root, 'public/models/nightScene.glb'))
  })

  it('detects collisions after canonicalization before any output can be overwritten', () => {
    expect(() => resolveConfig({ scenes: [
      { file: 'one.blend', name: 'hero-scene', external: true },
      { file: 'two.blend', name: 'hero scene', external: true },
    ] }, resolve('C:/blendlink-config-fixture'))).toThrow(/both resolve to the name "heroScene"/)
  })

  it('rejects output names that differ only by filesystem case', () => {
    expect(() => resolveConfig({ scenes: [
      { file: 'one.blend', name: 'hero', external: true },
      { file: 'two.blend', name: 'Hero', external: true },
    ] }, resolve('C:/blendlink-config-fixture'))).toThrow(
      /names "hero" and "Hero".*same output paths on case-insensitive filesystems/i,
    )
  })

  it('honors legacy config art settings while warning once with a migration path', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const root = resolve('C:/blendlink-legacy-config-fixture')
      const legacy = {
        scenes: [{
          file: 'hero.blend',
          external: true,
          mode: 'baked' as const,
          bake: { size: 1024 },
        }],
      }

      const first = resolveConfig(legacy, root)
      resolveConfig(legacy, root)

      expect(first.scenes[0]!.settings).toMatchObject({
        mode: 'baked',
        bake: { size: 1024 },
      })
      expect(warning).toHaveBeenCalledTimes(1)
      expect(warning.mock.calls[0]?.[0]).toMatch(
        /legacy `mode`\/`bake`.*still honored.*Scene Publishing/i,
      )
    } finally {
      warning.mockRestore()
    }
  })

  it('validates and preserves application-named browser-smoke port handoff', () => {
    const resolved = resolveConfig({
      website: {
        browserSmoke: { command: 'npx playwright test', portEnv: 'PLAYWRIGHT_PORT' },
      },
      scenes: [{ file: 'hero.blend', external: true }],
    }, resolve('C:/blendlink-browser-smoke-config'))
    expect(resolved.website.browserSmoke).toEqual({
      command: 'npx playwright test', portEnv: 'PLAYWRIGHT_PORT',
    })
    expect(() => resolveConfig({
      website: { browserSmoke: { command: 'test', portEnv: 'not-valid!' } },
      scenes: [{ file: 'hero.blend', external: true }],
    }, resolve('C:/blendlink-browser-smoke-config-invalid'))).toThrow(
      /portEnv must be a valid environment variable name/,
    )
  })

  it('requires an explicit named acknowledgement for an application material adapter', () => {
    const root = resolve('C:/blendlink-material-adapter-config')
    const resolved = resolveConfig({ scenes: [{
      file: 'hero.blend', external: true,
      applicationMaterialAdapter: {
        acknowledgePayloadCollapse: true,
        description: 'src/materials/installHeroMaterials.ts',
      },
    }] }, root)
    expect(resolved.scenes[0]?.applicationMaterialAdapter).toEqual({
      acknowledgePayloadCollapse: true,
      description: 'src/materials/installHeroMaterials.ts',
    })

    expect(() => resolveConfig({ scenes: [{
      file: 'hero.blend', external: true,
      applicationMaterialAdapter: {
        acknowledgePayloadCollapse: true,
        description: '   ',
      },
    }] }, root)).toThrow(/description must name the website-owned adapter/)
  })
})

describe('config loading', () => {
  it('reloads changed config source in the same process', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-config-reload-'))
    const path = resolve(root, 'blendlink.config.mjs')
    try {
      writeFileSync(path, "export default { scenes: [{ file: 'hero.blend', external: true, name: 'first' }] }\n")
      expect((await loadConfig(root)).scenes[0]?.name).toBe('first')

      writeFileSync(path, "export default { scenes: [{ file: 'hero.blend', external: true, name: 'second' }] }\n")
      expect((await loadConfig(root)).scenes[0]?.name).toBe('second')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('carries the exact loaded config revision into every resolved scene', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-config-revision-'))
    const path = resolve(root, 'blendlink.config.mjs')
    try {
      writeFileSync(path, "export default { scenes: [{ file: 'hero.blend', external: true }] }\n")
      const loaded = await loadConfig(root)

      expect(loaded.configSource).toMatchObject({
        path,
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(loaded.scenes[0]?.configSource).toEqual(loaded.configSource)
      expect(configSourceRevisionProblem(loaded.configSource)).toBeUndefined()

      writeFileSync(path, `${readFileSync(path, 'utf8')}// changed while waiting\n`)
      expect(configSourceRevisionProblem(loaded.configSource)).toMatch(
        /changed since this project configuration was loaded/i,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
