import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSceneAssetGraph,
  diffSceneAssetGraphs,
  inspectCompilerStagingDirectory,
  sceneAssetGraphPath,
  sceneAssetGraphIntegrityProblem,
  scenePayloadClosureProblem,
} from './sceneAssetGraph.js'

const bytes = (value: string) => new TextEncoder().encode(value)

function glbWithJson(json: Record<string, unknown>): Uint8Array {
  const encoded = Buffer.from(JSON.stringify(json), 'utf8')
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4
  const output = Buffer.alloc(12 + 8 + paddedLength, 0x20)
  output.writeUInt32LE(0x46546c67, 0)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(output.byteLength, 8)
  output.writeUInt32LE(paddedLength, 12)
  output.writeUInt32LE(0x4e4f534a, 16)
  encoded.copy(output, 20)
  return output
}

const sceneBytes = (label = 'scene'): Uint8Array => glbWithJson({
  asset: { version: '2.0' },
  extras: { label },
})

describe('runtime scene asset graph', () => {
  const temporaryDirectories: string[] = []
  const publicationDirectory = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-asset-graph-'))
    temporaryDirectories.push(directory)
    return directory
  }

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('is order independent and changes for path, role, or one byte', () => {
    const entries = [
      { path: 'hero.glb', role: 'scene' as const, bytes: sceneBytes() },
      { path: 'atlas.webp', role: 'companion' as const, bytes: bytes('atlas') },
    ]
    const first = createSceneAssetGraph(entries)
    expect(createSceneAssetGraph([...entries].reverse()).fingerprint).toBe(first.fingerprint)
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(createSceneAssetGraph([
      entries[0]!, { ...entries[1]!, bytes: bytes('atlat') },
    ]).fingerprint).not.toBe(first.fingerprint)
    expect(first.entries.map((entry) => entry.path)).toEqual(['atlas.webp', 'hero.glb'])
  })

  it.each(['', '/hero.glb', 'C:/hero.glb', '../hero.glb', './hero.glb', 'a//b.glb', 'a\\b.glb', 'a.glb?v=1', 'a%2fb.glb', 'a%5Cb.glb']) (
    'rejects unsafe graph path %j',
    (path) => expect(() => createSceneAssetGraph([
      { path, role: 'scene', bytes: sceneBytes() },
    ])).toThrow(/relative POSIX path|traversal segment|encoded path separator/),
  )

  it('rejects case-fold collisions and multiple scene roots', () => {
    expect(() => createSceneAssetGraph([
      { path: 'hero.glb', role: 'scene', bytes: sceneBytes('a') },
      { path: 'HERO.GLB', role: 'companion', bytes: bytes('b') },
    ])).toThrow(/case-insensitive hosts/)
    expect(() => createSceneAssetGraph([
      { path: 'a.glb', role: 'scene', bytes: sceneBytes('a') },
      { path: 'b.glb', role: 'scene', bytes: sceneBytes('b') },
    ])).toThrow(/exactly one scene GLB/)
  })

  it('requires the complete concrete Basis runtime for KTX2', () => {
    expect(() => createSceneAssetGraph([
      { path: 'hero.glb', role: 'scene', bytes: sceneBytes() },
    ], { requiresKtx2: true })).toThrow(/basis_transcoder\.js/)
    expect(() => createSceneAssetGraph([
      { path: 'hero.glb', role: 'scene', bytes: sceneBytes() },
      ...['basis_transcoder.js', 'basis_transcoder.wasm', 'README.md', 'LICENSE'].map(
        (name) => ({
          path: `blendlink-basis/${name}`,
          role: 'basis-runtime' as const,
          bytes: bytes(name),
        }),
      ),
    ], { requiresKtx2: true })).not.toThrow()
  })

  it('requires every external GLB buffer and image URI to resolve to a declared graph entry', () => {
    const scene = glbWithJson({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4, uri: 'geometry/mesh.bin' }],
      images: [{ uri: 'textures/albedo%20one.png' }],
    })
    expect(() => createSceneAssetGraph([
      { path: 'nested/hero.glb', role: 'scene', bytes: scene },
      { path: 'nested/geometry/mesh.bin', role: 'companion', bytes: bytes('mesh') },
    ])).toThrow(/external image URI.*textures\/albedo%20one\.png.*not declared/i)

    expect(() => createSceneAssetGraph([
      { path: 'nested/hero.glb', role: 'scene', bytes: scene },
      { path: 'nested/geometry/mesh.bin', role: 'companion', bytes: bytes('mesh') },
      { path: 'nested/textures/albedo one.png', role: 'companion', bytes: bytes('image') },
    ])).not.toThrow()
  })

  it('applies the same closure rule to JSON glTF and rejects remote resource URIs', () => {
    const gltf = bytes(JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4, uri: 'geometry.bin' }],
      images: [{ uri: 'data:image/png;base64,aW1hZ2U=' }],
    }))
    expect(scenePayloadClosureProblem('scenes/hero.gltf', gltf, [
      { path: 'scenes/hero.gltf', role: 'scene' },
    ])).toMatch(/external buffer URI.*geometry\.bin.*not declared/i)
    expect(scenePayloadClosureProblem('scenes/hero.gltf', gltf, [
      { path: 'scenes/hero.gltf', role: 'scene' },
      { path: 'scenes/geometry.bin', role: 'companion' },
    ])).toBeNull()

    const remote = bytes(JSON.stringify({
      asset: { version: '2.0' },
      images: [{ uri: 'https://cdn.example/texture.png' }],
    }))
    expect(scenePayloadClosureProblem('scenes/hero.gltf', remote, []))
      .toMatch(/external image URI.*unsafe.*plain relative/i)

    const encodedSeparator = bytes(JSON.stringify({
      asset: { version: '2.0' },
      images: [{ uri: 'textures%2falbedo.png' }],
    }))
    expect(scenePayloadClosureProblem('scenes/hero.gltf', encodedSeparator, [
      { path: 'scenes/textures/albedo.png', role: 'companion' },
    ])).toMatch(/external image URI.*unsafe.*encoded path separator/i)
  })

  it('maps only files beneath the publication directory', () => {
    expect(sceneAssetGraphPath('C:/site/public/models', 'C:/site/public/models/nested/hero.glb'))
      .toBe('nested/hero.glb')
    expect(sceneAssetGraphPath('C:/site/public/models', 'C:/site/public/models/..hero.glb'))
      .toBe('..hero.glb')
    expect(() => sceneAssetGraphPath('C:/site/public/models', 'C:/site/public/hero.glb'))
      .toThrow(/outside/)
  })

  it('recursively inventories exactly the compiler-declared staged files', () => {
    const directory = publicationDirectory()
    const glbPath = join(directory, 'hero.glb')
    const companionPath = join(directory, 'textures', 'atlases', 'hero.webp')
    mkdirSync(join(companionPath, '..'), { recursive: true })
    writeFileSync(glbPath, sceneBytes())
    writeFileSync(companionPath, bytes('atlas'))

    expect(inspectCompilerStagingDirectory(directory, [companionPath, glbPath]).map(
      ({ path, bytes }) => [path, new TextDecoder().decode(bytes)],
    )).toEqual([
      ['hero.glb', new TextDecoder().decode(sceneBytes())],
      ['textures/atlases/hero.webp', 'atlas'],
    ])

    writeFileSync(join(directory, 'undeclared.tmp'), 'temporary output')
    expect(() => inspectCompilerStagingDirectory(directory, [glbPath, companionPath]))
      .toThrow(/undeclared compiler-owned staged file.*undeclared\.tmp/i)
  })

  it('reports exact added, removed, and byte-changed graph entries', () => {
    const previous = createSceneAssetGraph([
      { path: 'hero.glb', role: 'scene', bytes: sceneBytes('scene-a') },
      { path: 'removed.webp', role: 'companion', bytes: bytes('removed') },
    ])
    const next = createSceneAssetGraph([
      { path: 'hero.glb', role: 'scene', bytes: sceneBytes('scene-b') },
      { path: 'added.webp', role: 'companion', bytes: bytes('added') },
    ])

    expect(diffSceneAssetGraphs(previous, next)).toEqual({
      added: ['added.webp'],
      removed: ['removed.webp'],
      changed: ['hero.glb'],
    })
    expect(diffSceneAssetGraphs(next, next)).toEqual({ added: [], removed: [], changed: [] })
  })

  it('verifies every graph byte, the selected scene, and complete KTX2 runtime', () => {
    const directory = publicationDirectory()
    const assets = [
      { path: 'hero.glb', role: 'scene' as const, bytes: sceneBytes() },
      { path: 'atlas.webp', role: 'companion' as const, bytes: bytes('atlas') },
      ...['basis_transcoder.js', 'basis_transcoder.wasm', 'README.md', 'LICENSE'].map(
        (name) => ({
          path: `blendlink-basis/${name}`,
          role: 'basis-runtime' as const,
          bytes: bytes(name),
        }),
      ),
    ]
    for (const asset of assets) {
      const path = join(directory, ...asset.path.split('/'))
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, asset.bytes)
    }
    const graph = createSceneAssetGraph(assets, { requiresKtx2: true })

    expect(sceneAssetGraphIntegrityProblem(directory, graph, {
      requiresKtx2: true,
      expectedScenePath: 'hero.glb',
    })).toBeNull()
    expect(sceneAssetGraphIntegrityProblem(directory, graph, {
      expectedScenePath: 'another.glb',
    })).toMatch(/configured scene is another\.glb/)

    writeFileSync(join(directory, 'atlas.webp'), bytes('alter'))
    expect(sceneAssetGraphIntegrityProblem(directory, graph)).toMatch(
      /atlas\.webp.*bytes do not match its SHA-256 digest/,
    )
    rmSync(join(directory, 'atlas.webp'))
    expect(sceneAssetGraphIntegrityProblem(directory, graph)).toMatch(/atlas\.webp.*missing/)
  })

  it('rejects malformed, noncanonical, traversing, colliding, and incomplete graphs', () => {
    const directory = publicationDirectory()
    writeFileSync(join(directory, 'hero.glb'), sceneBytes())
    const graph = createSceneAssetGraph([
      { path: 'hero.glb', role: 'scene', bytes: sceneBytes() },
    ])

    expect(sceneAssetGraphIntegrityProblem(directory, {
      ...graph, fingerprint: 'not-a-digest',
    })).toMatch(/malformed SHA-256 fingerprint/)
    expect(sceneAssetGraphIntegrityProblem(directory, {
      ...graph, fingerprint: '0'.repeat(64),
    })).toMatch(/exact files produce/)
    expect(sceneAssetGraphIntegrityProblem(directory, {
      ...graph,
      entries: [{ ...graph.entries[0]!, path: '../hero.glb' }],
    })).toMatch(/traversal segment/)
    expect(sceneAssetGraphIntegrityProblem(directory, {
      ...graph,
      entries: [graph.entries[0]!, { ...graph.entries[0]!, path: 'HERO.GLB', role: 'companion' }],
    })).toMatch(/collide on case-insensitive hosts/)
    expect(sceneAssetGraphIntegrityProblem(directory, graph, { requiresKtx2: true }))
      .toMatch(/missing decoder assets/)

    writeFileSync(join(directory, 'atlas.webp'), bytes('atlas'))
    const unordered = createSceneAssetGraph([
      { path: 'hero.glb', role: 'scene', bytes: sceneBytes() },
      { path: 'atlas.webp', role: 'companion', bytes: bytes('atlas') },
    ])
    expect(sceneAssetGraphIntegrityProblem(directory, {
      ...unordered, entries: [...unordered.entries].reverse(),
    })).toMatch(/canonical path order/)
  })

  it('refuses links instead of validating bytes outside the publication graph', () => {
    const directory = publicationDirectory()
    const target = join(directory, 'target')
    mkdirSync(target)
    const graph = createSceneAssetGraph([
      { path: 'hero.glb', role: 'scene', bytes: sceneBytes() },
    ])
    symlinkSync(target, join(directory, 'hero.glb'), 'junction')

    expect(sceneAssetGraphIntegrityProblem(directory, graph)).toMatch(/symbolic link/)
  })

  it('refuses a regular graph file reached through a junction ancestor', () => {
    const directory = publicationDirectory()
    const redirected = publicationDirectory()
    const scene = sceneBytes()
    writeFileSync(join(redirected, 'hero.glb'), scene)
    symlinkSync(redirected, join(directory, 'nested'), 'junction')
    const graph = createSceneAssetGraph([
      { path: 'nested/hero.glb', role: 'scene', bytes: scene },
    ])

    expect(sceneAssetGraphIntegrityProblem(directory, graph))
      .toMatch(/nested.*symbolic link, junction, or reparse point/i)
  })
})
