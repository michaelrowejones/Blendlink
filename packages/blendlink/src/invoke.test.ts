import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BlendExportError,
  blenderDiagnosticTail,
  blenderProcessEnvironment,
  missingDeclaredSidecars,
} from './invoke.js'

describe('Blender process environment', () => {
  it('provisions one stable writable OptiX cache under the local temporary root', () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-optix-env-'))
    try {
      const environment = blenderProcessEnvironment({ PATH: 'test-path' }, root)
      const expected = join(root, 'blendlink-optix-cache')
      expect(environment).toMatchObject({
        PATH: 'test-path',
        OPTIX_CACHE_PATH: expected,
        BLENDLINK_PROGRESS: '1',
      })
      expect(existsSync(expected)).toBe(true)
      expect(readdirSync(expected)).toEqual([])

      const second = blenderProcessEnvironment({}, root)
      expect(second.OPTIX_CACHE_PATH).toBe(expected)
      expect(readdirSync(expected)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('honors explicit standard and Blendlink-specific cache ownership', () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-optix-explicit-'))
    try {
      const standard = join(root, 'standard')
      expect(blenderProcessEnvironment({ OPTIX_CACHE_PATH: standard }, root).OPTIX_CACHE_PATH)
        .toBe(standard)

      const preferred = join(root, 'preferred')
      expect(blenderProcessEnvironment({
        OPTIX_CACHE_PATH: standard,
        BLENDLINK_OPTIX_CACHE_PATH: preferred,
      }, root).OPTIX_CACHE_PATH).toBe(preferred)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails before Blender with an actionable error when the cache is not writable', () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-optix-blocked-'))
    try {
      const file = join(root, 'not-a-directory')
      writeFileSync(file, 'occupied')
      expect(() => blenderProcessEnvironment({
        BLENDLINK_OPTIX_CACHE_PATH: join(file, 'cache'),
      }, root)).toThrowError(BlendExportError)
      expect(() => blenderProcessEnvironment({
        BLENDLINK_OPTIX_CACHE_PATH: join(file, 'cache'),
      }, root)).toThrow(/writable local OptiX cache/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Blender result artifact contract', () => {
  it('preserves the Python traceback separately from a long exporter stdout tail', () => {
    const stderr = [
      'Traceback (most recent call last):',
      '  File "export_scene.py", line 1, in <module>',
      'MaterialCompileError: selected color did not attest',
    ].join('\n')
    const stdout = Array.from({ length: 50 }, (_, index) => `export progress ${index}`).join('\n')
    const tail = blenderDiagnosticTail(stderr, stdout)
    expect(tail).toContain('Blender stderr (tail):')
    expect(tail).toContain('MaterialCompileError: selected color did not attest')
    expect(tail).toContain('Blender stdout (tail):')
    expect(tail).toContain('export progress 49')
    expect(tail).not.toContain('export progress 0\n')
  })

  it('names every missing declared atlas, environment, and reflection source before publication', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-sidecars-'))
    try {
      const present = join(directory, 'present.png')
      writeFileSync(present, 'ok')
      const missing = missingDeclaredSidecars({
        baked: {
          states: { day: { main: present, detail: join(directory, 'day-detail.png') } },
          lightGroups: { lamp: { main: { path: join(directory, 'lamp.png') } } },
          variants: {
            states: {
              day: {
                main: [{
                  path: join(directory, 'day.256.png'), width: 256, height: 256,
                  bytes: 10, hash: 'missing-tier',
                }],
              },
            },
          },
        },
        environment: { path: join(directory, 'studio.exr') },
        reflectionProbeAssets: {
          'hero-metal': { path: join(directory, 'hero-metal.exr') },
        },
      })
      expect(missing).toHaveLength(5)
      expect(missing.join('\n')).toMatch(/state "day" atlas "detail"/)
      expect(missing.join('\n')).toMatch(/light group "lamp" atlas "main"/)
      expect(missing.join('\n')).toMatch(/state "day" atlas "main" 256px variant/)
      expect(missing.join('\n')).toMatch(/environment/)
      expect(missing.join('\n')).toMatch(/reflection probe "hero-metal"/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
