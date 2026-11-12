import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertWebsiteExportDestination, resolveWebsiteExportDestination } from './exportWebsite.js'

describe('standalone website destination ownership', () => {
  it('preserves unrelated files and another scene’s exported website', () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-website-destination-'))
    try {
      expect(() => assertWebsiteExportDestination(root, 'this-scene')).not.toThrow()
      writeFileSync(join(root, 'index.html'), 'artist website')
      expect(() => assertWebsiteExportDestination(root, 'this-scene')).toThrow(/empty folder/)
      writeFileSync(join(root, '.blendlink-website.json'), JSON.stringify({ schemaVersion: 1, sourceKey: 'another-scene' }))
      expect(() => assertWebsiteExportDestination(root, 'this-scene')).toThrow(/left untouched/)
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toBe('artist website')
      writeFileSync(join(root, '.blendlink-website.json'), JSON.stringify({ schemaVersion: 1, sourceKey: 'this-scene' }))
      expect(() => assertWebsiteExportDestination(root, 'this-scene')).not.toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('explains an existing file destination without changing it', () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-website-destination-'))
    try {
      const file = join(root, 'artist.txt')
      writeFileSync(file, 'keep me')
      expect(() => assertWebsiteExportDestination(file, 'scene')).toThrow(/Choose a folder/)
      expect(readFileSync(file, 'utf8')).toBe('keep me')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('resolves folder aliases before checking source containment or choosing a missing export folder', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'blendlink-website-destination-')))
    try {
      const actual = join(root, 'actual')
      const alias = join(root, 'alias')
      mkdirSync(actual)
      symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const scene = join(actual, 'Scene.blend')
      writeFileSync(scene, 'saved scene')
      expect(() => resolveWebsiteExportDestination(alias, scene)).toThrow(/cannot contain its source/)
      const elsewhere = join(root, 'Other.blend')
      writeFileSync(elsewhere, 'other saved scene')
      expect(resolveWebsiteExportDestination(join(alias, 'website'), elsewhere)).toBe(join(actual, 'website'))
      expect(readFileSync(scene, 'utf8')).toBe('saved scene')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
