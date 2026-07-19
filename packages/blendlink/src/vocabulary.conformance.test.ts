import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseVocabulary, type VocabularyNodeInput } from './vocabulary.js'

/**
 * The shared conformance fixture: one set of name/extras → classification
 * cases executed against BOTH this parser and the addon's vocab.py (its
 * headless tests load the same JSON). The hand-mirrored parsers drifted
 * three ways once; this file is the contract that stops it.
 */
interface Case {
  name: string
  extras?: Record<string, unknown>
  expect: {
    kind: string
    shape?: string
    proxyOnly?: boolean
    base?: string
    lodIndex?: number
    anchorName?: string
  }
}

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'conformance', 'vocabulary.json'),
    'utf8',
  ),
) as { cases: Case[] }

function nodeFor(entry: Case): VocabularyNodeInput {
  return {
    name: entry.name,
    kind: 'Object3D',
    parent: null,
    worldPosition: [0, 0, 0],
    worldQuaternion: [0, 0, 0, 1],
    ...(entry.extras ? { extras: entry.extras } : {}),
  }
}

describe('vocabulary conformance fixture', () => {
  for (const [index, entry] of fixture.cases.entries()) {
    it(`case ${index}: ${entry.name} → ${entry.expect.kind}`, () => {
      const result = parseVocabulary([nodeFor(entry)])
      const expected = entry.expect
      const counts = {
        collider: result.colliders.length,
        rigid: result.physics.length,
        lod: result.lods.length,
        socket: result.sockets.length,
        hotspot: result.hotspots.length,
        audio: result.audio.length,
      }
      if (expected.kind === 'none') {
        expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0)
        return
      }
      if (expected.kind === 'noimp') {
        // Name-based noimp reaching typegen (GLB-generic flows) must WARN —
        // the exporter removes these; silence shipped a reference grid once.
        expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0)
        expect(result.warnings.some((warning) => warning.includes('noimp'))).toBe(true)
        return
      }
      expect(counts[expected.kind as keyof typeof counts]).toBe(1)
      if (expected.kind === 'collider') {
        const collider = result.colliders[0]!
        if (expected.shape === 'convex') expect(collider.shape).toBe('convex')
        if (expected.shape === 'trimesh') expect(collider.shape).toBe('trimesh')
        if (expected.proxyOnly !== undefined) expect(collider.proxyOnly).toBe(expected.proxyOnly)
        if (expected.base) expect(collider.name).toBe(expected.base)
      }
      if (expected.kind === 'lod') {
        const level = result.lods[0]!.levels[0]!
        if (expected.lodIndex !== undefined) expect(level.index).toBe(expected.lodIndex)
        if (expected.base) expect(result.lods[0]!.base).toBe(expected.base)
      }
      if (['socket', 'hotspot', 'audio'].includes(expected.kind) && expected.anchorName) {
        const list = expected.kind === 'socket'
          ? result.sockets
          : expected.kind === 'hotspot'
            ? result.hotspots
            : result.audio
        expect(list[0]!.name).toBe(expected.anchorName)
      }
    })
  }
})
