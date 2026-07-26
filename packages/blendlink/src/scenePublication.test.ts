import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  KTX2_RUNTIME_GRAPH_PATHS,
  createSceneAssetGraph,
  type SceneAssetGraphInput,
} from './sceneAssetGraph.js'
import {
  createSceneRuntimePublication,
  sceneRuntimePublicationDirectory,
  sceneRuntimePublicationUrl,
  sealScenePublication,
} from './scenePublication.js'

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

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

function writeAssets(root: string, assets: readonly SceneAssetGraphInput[]): void {
  for (const asset of assets) {
    const path = join(root, ...asset.path.split('/'))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, asset.bytes)
  }
}

describe('scene publication sealing', () => {
  const temporaryDirectories: string[] = []
  const temporaryDirectory = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-scene-publication-'))
    temporaryDirectories.push(directory)
    return directory
  }

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('seals one exact nested scene and Basis graph behind its full fingerprint', () => {
    const root = temporaryDirectory()
    const sourceDirectory = join(root, 'compiler-stage')
    const destinationParent = join(root, 'public', 'hero')
    const assets: SceneAssetGraphInput[] = [
      {
        path: 'hero.glb',
        role: 'scene',
        bytes: glbWithJson({
          asset: { version: '2.0' },
          images: [{ uri: 'textures/albedo.ktx2' }],
        }),
      },
      { path: 'textures/albedo.ktx2', role: 'companion', bytes: bytes('texture') },
      ...KTX2_RUNTIME_GRAPH_PATHS.map((path) => ({
        path,
        role: 'basis-runtime' as const,
        bytes: bytes(path),
      })),
    ]
    writeAssets(sourceDirectory, assets)
    const graph = createSceneAssetGraph(assets, { requiresKtx2: true })

    const sealed = sealScenePublication({
      sourceDirectory,
      destinationParent,
      graph,
      requiresKtx2: true,
    })

    expect(sealed).toMatchObject({
      algorithm: 'sha256',
      fingerprint: graph.fingerprint,
      directory: join(destinationParent, graph.fingerprint),
      bundlePath: graph.fingerprint,
      scenePath: 'hero.glb',
      reused: false,
    })
    expect(sealed.files).toEqual(graph.entries)
    expect(Object.isFrozen(sealed)).toBe(true)
    expect(Object.isFrozen(sealed.files)).toBe(true)
    for (const asset of assets) {
      const publishedPath = join(sealed.directory, ...asset.path.split('/'))
      expect(existsSync(publishedPath)).toBe(true)
      expect(readFileSync(publishedPath)).toEqual(Buffer.from(asset.bytes))
    }

    const publication = createSceneRuntimePublication('hero', sealed)
    expect(publication).toEqual({
      algorithm: 'sha256',
      bundlePath: `hero/${graph.fingerprint}`,
      scenePath: 'hero.glb',
      immutable: true,
    })
    expect(sceneRuntimePublicationDirectory(
      join(root, 'public'),
      publication,
    )).toBe(join(root, 'public', 'hero', graph.fingerprint))
    expect(sceneRuntimePublicationUrl(
      '/portfolio/models/hero.glb?legacy=1',
      publication,
      publication.scenePath,
    )).toBe(`/portfolio/models/hero/${graph.fingerprint}/hero.glb`)
    expect(sceneRuntimePublicationUrl(
      'https://cdn.example/cdn-root/models/hero.glb',
      publication,
      'textures/albedo.ktx2',
    )).toBe(
      `https://cdn.example/cdn-root/models/hero/${graph.fingerprint}/textures/albedo.ktx2`,
    )
  })

  it('reuses an identical sealed graph without touching its published files', () => {
    const root = temporaryDirectory()
    const destinationParent = join(root, 'public', 'hero')
    const assets: SceneAssetGraphInput[] = [{
      path: 'hero.glb',
      role: 'scene',
      bytes: glbWithJson({ asset: { version: '2.0' }, extras: { fixture: 'same' } }),
    }]
    const graph = createSceneAssetGraph(assets)
    const firstSource = join(root, 'stage-first')
    writeAssets(firstSource, assets)
    const first = sealScenePublication({ sourceDirectory: firstSource, destinationParent, graph })
    const publishedScene = join(first.directory, 'hero.glb')
    const retainedTime = new Date('2001-02-03T04:05:06.000Z')
    utimesSync(publishedScene, retainedTime, retainedTime)

    const secondSource = join(root, 'stage-second')
    writeAssets(secondSource, assets)
    const second = sealScenePublication({ sourceDirectory: secondSource, destinationParent, graph })

    expect(second.reused).toBe(true)
    expect(second.directory).toBe(first.directory)
    expect(statSync(publishedScene).mtimeMs).toBe(retainedTime.getTime())
  })

  it('publishes changed bytes to a new directory and retains the prior graph', () => {
    const root = temporaryDirectory()
    const destinationParent = join(root, 'public', 'hero')
    const firstAssets: SceneAssetGraphInput[] = [{
      path: 'hero.glb',
      role: 'scene',
      bytes: glbWithJson({ asset: { version: '2.0' }, extras: { fixture: 'first' } }),
    }]
    const secondAssets: SceneAssetGraphInput[] = [{
      path: 'hero.glb',
      role: 'scene',
      bytes: glbWithJson({ asset: { version: '2.0' }, extras: { fixture: 'second' } }),
    }]
    const firstGraph = createSceneAssetGraph(firstAssets)
    const secondGraph = createSceneAssetGraph(secondAssets)
    const firstSource = join(root, 'stage-first')
    const secondSource = join(root, 'stage-second')
    writeAssets(firstSource, firstAssets)
    writeAssets(secondSource, secondAssets)

    const first = sealScenePublication({
      sourceDirectory: firstSource,
      destinationParent,
      graph: firstGraph,
    })
    const second = sealScenePublication({
      sourceDirectory: secondSource,
      destinationParent,
      graph: secondGraph,
    })

    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(second.directory).not.toBe(first.directory)
    expect(existsSync(first.directory)).toBe(true)
    expect(readFileSync(join(first.directory, 'hero.glb'))).toEqual(Buffer.from(firstAssets[0]!.bytes))
    expect(readFileSync(join(second.directory, 'hero.glb'))).toEqual(Buffer.from(secondAssets[0]!.bytes))
  })

  it('rejects undeclared compiler residue before creating a publication directory', () => {
    const root = temporaryDirectory()
    const sourceDirectory = join(root, 'compiler-stage')
    const destinationParent = join(root, 'public', 'hero')
    const assets: SceneAssetGraphInput[] = [{
      path: 'hero.glb',
      role: 'scene',
      bytes: glbWithJson({ asset: { version: '2.0' } }),
    }]
    writeAssets(sourceDirectory, assets)
    writeFileSync(join(sourceDirectory, 'encoder-residue.tmp'), 'not declared')
    const graph = createSceneAssetGraph(assets)

    expect(() => sealScenePublication({ sourceDirectory, destinationParent, graph }))
      .toThrow(/publication closure.*undeclared compiler-owned staged file.*encoder-residue\.tmp/is)
    expect(existsSync(destinationParent)).toBe(false)
  })

  it('rejects a missing declared source before creating a publication directory', () => {
    const root = temporaryDirectory()
    const sourceDirectory = join(root, 'compiler-stage')
    const destinationParent = join(root, 'public', 'hero')
    const assets: SceneAssetGraphInput[] = [
      {
        path: 'hero.glb',
        role: 'scene',
        bytes: glbWithJson({
          asset: { version: '2.0' },
          buffers: [{ uri: 'geometry/hero.bin', byteLength: 8 }],
        }),
      },
      { path: 'geometry/hero.bin', role: 'companion', bytes: bytes('geometry') },
    ]
    writeAssets(sourceDirectory, assets)
    const graph = createSceneAssetGraph(assets)
    rmSync(join(sourceDirectory, 'geometry', 'hero.bin'))

    expect(() => sealScenePublication({ sourceDirectory, destinationParent, graph }))
      .toThrow(/graph integrity.*geometry\/hero\.bin.*missing/is)
    expect(existsSync(destinationParent)).toBe(false)
  })

  it('rejects case-fold collisions in a supplied graph before publication', () => {
    const root = temporaryDirectory()
    const sourceDirectory = join(root, 'compiler-stage')
    const destinationParent = join(root, 'public', 'hero')
    const assets: SceneAssetGraphInput[] = [{
      path: 'hero.glb',
      role: 'scene',
      bytes: glbWithJson({ asset: { version: '2.0' } }),
    }]
    writeAssets(sourceDirectory, assets)
    const graph = createSceneAssetGraph(assets)
    const collidingGraph = {
      ...graph,
      entries: [
        graph.entries[0]!,
        { ...graph.entries[0]!, path: 'HERO.GLB', role: 'companion' as const },
      ],
    }

    expect(() => sealScenePublication({
      sourceDirectory,
      destinationParent,
      graph: collidingGraph,
    })).toThrow(/graph integrity.*collide on case-insensitive hosts/is)
    expect(existsSync(destinationParent)).toBe(false)
  })

  it('refuses a conflicting fingerprint directory without overwriting it', () => {
    const root = temporaryDirectory()
    const sourceDirectory = join(root, 'compiler-stage')
    const destinationParent = join(root, 'public', 'hero')
    const assets: SceneAssetGraphInput[] = [{
      path: 'hero.glb',
      role: 'scene',
      bytes: glbWithJson({ asset: { version: '2.0' }, extras: { fixture: 'expected' } }),
    }]
    writeAssets(sourceDirectory, assets)
    const graph = createSceneAssetGraph(assets)
    const conflictingDirectory = join(destinationParent, graph.fingerprint)
    const conflictingBytes = bytes('not the expected graph')
    mkdirSync(conflictingDirectory, { recursive: true })
    writeFileSync(join(conflictingDirectory, 'hero.glb'), conflictingBytes)

    expect(() => sealScenePublication({ sourceDirectory, destinationParent, graph }))
      .toThrow(
        /existing content-addressed scene directory is corrupt.*will not overwrite.*remove exactly.*hero\.glb.*bytes/is,
      )
    expect(readFileSync(join(conflictingDirectory, 'hero.glb'))).toEqual(Buffer.from(conflictingBytes))
    expect(readdirSync(destinationParent)).toEqual([graph.fingerprint])
  })

  it('leaves no published or private directory when preparation fails', () => {
    const root = temporaryDirectory()
    const sourceDirectory = join(root, 'compiler-stage')
    const destinationParent = join(root, 'public', 'hero')
    const assets: SceneAssetGraphInput[] = [{
      path: 'hero.glb',
      role: 'scene',
      bytes: glbWithJson({ asset: { version: '2.0' }, extras: { fixture: 'original' } }),
    }]
    writeAssets(sourceDirectory, assets)
    const graph = createSceneAssetGraph(assets)
    writeFileSync(
      join(sourceDirectory, 'hero.glb'),
      glbWithJson({ asset: { version: '2.0' }, extras: { fixture: 'tampered' } }),
    )
    mkdirSync(destinationParent, { recursive: true })

    expect(() => sealScenePublication({ sourceDirectory, destinationParent, graph }))
      .toThrow(/graph integrity.*hero\.glb.*(bytes|SHA-256)/is)
    expect(existsSync(join(destinationParent, graph.fingerprint))).toBe(false)
    expect(readdirSync(destinationParent)).toEqual([])
  })
})
