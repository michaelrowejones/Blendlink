import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertWebsiteExportDestination } from './exportWebsite.js'

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
})
