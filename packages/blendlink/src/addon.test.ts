import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertBlenderAddonInstallation,
  bundledBlenderAddonFingerprint,
  bundledBlenderAddonVersion,
  fingerprintBlenderAddonTree,
  parseBlenderAddonStatus,
} from './addon.js'

describe('Blender addon release identity', () => {
  it('ships the same addon version the compiler reports', () => {
    const packageVersion = JSON.parse(readFileSync(
      resolve(import.meta.dirname, '..', 'package.json'), 'utf8',
    )).version
    expect(bundledBlenderAddonVersion()).toBe(packageVersion)
    expect(bundledBlenderAddonFingerprint()).toMatch(/^[a-f0-9]{64}$/)
    expect(readFileSync(
      resolve(import.meta.dirname, '..', 'dist', 'addon', 'LICENSE'), 'utf8',
    )).toMatch(/GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/)
  })

  it('fingerprints runtime content deterministically and excludes build debris', () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-addon-fingerprint-'))
    try {
      writeFileSync(join(root, '__init__.py'), 'runtime = 1\n')
      mkdirSync(join(root, 'nested'))
      writeFileSync(join(root, 'nested', 'runtime.json'), '{"value":1}\n')
      const before = fingerprintBlenderAddonTree(root)
      mkdirSync(join(root, '__pycache__'))
      writeFileSync(join(root, '__pycache__', 'runtime.pyc'), 'cache')
      mkdirSync(join(root, 'tests'))
      writeFileSync(join(root, 'tests', 'test_runtime.py'), 'ignored')
      writeFileSync(join(root, 'old.zip'), 'ignored')
      expect(fingerprintBlenderAddonTree(root)).toBe(before)
      writeFileSync(join(root, 'nested', 'runtime.json'), '{"value":2}\n')
      expect(fingerprintBlenderAddonTree(root)).not.toBe(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('parses only the explicit machine-readable Blender status sentinel', () => {
    expect(parseBlenderAddonStatus([
      'Blender 5.2.0',
      '##blendlink-addon-status {"catalogPath":"/extensions/blendlink/component_schema.py","catalogSchemaVersion":1,"enabled":true,"error":null,"fingerprint":"abc123","installed":true,"objectBehaviorCount":10,"path":"/extensions/blendlink","sceneEffectCount":12,"version":"0.8.0"}',
      'Blender quit',
    ].join('\n'))).toEqual({
      enabled: true,
      error: null,
      fingerprint: 'abc123',
      installed: true,
      catalogPath: '/extensions/blendlink/component_schema.py',
      catalogSchemaVersion: 1,
      objectBehaviorCount: 10,
      path: '/extensions/blendlink',
      sceneEffectCount: 12,
      version: '0.8.0',
    })
    expect(() => parseBlenderAddonStatus('Blender quit')).toThrow(/status sentinel/)
    expect(() => parseBlenderAddonStatus(
      '##blendlink-addon-status {"enabled":true,"installed":true,"path":"/extensions/blendlink","version":"0.8.0"}',
    )).toThrow(/incomplete/)
  })

  it('refuses a completed install when same-version runtime files drift', () => {
    const expectedFingerprint = 'e'.repeat(64)
    const status = {
      installed: true,
      enabled: true,
      version: '0.8.0',
      path: '/extensions/blendlink',
      fingerprint: 'a'.repeat(64),
      catalogPath: '/extensions/blendlink/component_schema.py',
      catalogSchemaVersion: 1,
      sceneEffectCount: 2,
      objectBehaviorCount: 8,
      error: null,
    }
    expect(() => assertBlenderAddonInstallation(
      status, '0.8.0', expectedFingerprint,
    )).toThrow(/files=a{16}.*expected files=e{16}/)
    expect(() => assertBlenderAddonInstallation(
      { ...status, fingerprint: expectedFingerprint }, '0.8.0', expectedFingerprint,
    )).not.toThrow()
  })
})
