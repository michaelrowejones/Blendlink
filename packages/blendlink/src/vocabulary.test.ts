import { describe, expect, it } from 'vitest'
import { parseVocabulary, type VocabularyNodeInput } from './vocabulary.js'

const node = (
  name: string,
  overrides: Partial<VocabularyNodeInput> = {},
): VocabularyNodeInput => ({
  name,
  kind: 'Mesh',
  parent: null,
  worldPosition: [0, 0, 0],
  worldQuaternion: [0, 0, 0, 1],
  ...overrides,
})

describe('parseVocabulary', () => {
  it('parses the collider suffix family case-insensitively', () => {
    const result = parseVocabulary([
      node('Crate-colonly'),
      node('Dome_ConvCol'),
      node('Fence-col'),
    ])
    expect(result.colliders).toEqual([
      expect.objectContaining({ name: 'Crate', shape: 'trimesh', proxyOnly: true }),
      expect.objectContaining({ name: 'Dome', shape: 'convex', proxyOnly: false }),
      expect.objectContaining({ name: 'Fence', shape: 'trimesh', proxyOnly: false }),
    ])
  })

  it('maps collider empties to primitives via display type', () => {
    const result = parseVocabulary(
      [node('Zone-colonly', { kind: 'Object3D' })],
      { empties: [{ name: 'Zone-colonly', displayType: 'SPHERE', size: 1.5 }] },
    )
    expect(result.colliders[0]).toMatchObject({ shape: 'sphere', size: 1.5 })
  })

  it('groups LOD chains and warns on gaps', () => {
    const result = parseVocabulary([
      node('Rock_LOD0'),
      node('Rock_LOD1', { extras: { lod_distance: 12 } }),
      node('Rock_LOD3'),
    ])
    expect(result.lods[0]?.levels.map((level) => level.index)).toEqual([0, 1, 3])
    expect(result.lods[0]?.levels[1]?.distance).toBe(12)
    expect(result.warnings.some((warning) => warning.includes('gaps'))).toBe(true)
  })

  it('collects anchors by prefix with stripped names', () => {
    const result = parseVocabulary([
      node('SOCKET_Muzzle', { kind: 'Object3D', parent: 'Gun' }),
      node('HOTSPOT_Info', { kind: 'Object3D', extras: { title: 'Hi' } }),
      node('AUDIO_Hum', { kind: 'Object3D' }),
    ])
    expect(result.sockets[0]).toMatchObject({ name: 'Muzzle', parent: 'Gun' })
    expect(result.hotspots[0]?.extras).toEqual({ title: 'Hi' })
    expect(result.audio[0]?.name).toBe('Hum')
  })

  it('warns when an anchor has geometry', () => {
    const result = parseVocabulary([node('SOCKET_Oops', { kind: 'Mesh' })])
    expect(result.warnings.some((warning) => warning.includes('usually Empties'))).toBe(true)
  })

  it('reads physics params from extras', () => {
    const result = parseVocabulary([
      node('Barrel-rigid', { extras: { mass: 12.5, friction: 0.4, physics_layer: 'props' } }),
    ])
    expect(result.physics[0]).toMatchObject({ mass: 12.5, friction: 0.4, layer: 'props' })
  })

  it('lints near-miss vocabulary tokens', () => {
    const result = parseVocabulary([node('Wall-collonly')])
    expect(result.colliders).toHaveLength(0)
    expect(result.warnings.some((warning) => warning.includes('did not match'))).toBe(true)
  })
})
