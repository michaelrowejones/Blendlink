import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { allocateLoadedNodeNames } from './loadedNames.js'
import { generateSceneModule } from './typegen.js'

describe('GLTFLoader node identity', () => {
  it('blocks sanitized-name collisions instead of guessing loader suffixes', () => {
    const document = new Document()
    const scene = document.createScene('Scene')
    const spaced = document.createNode('A B').setExtras({ blendlink_id: 'spaced-id' })
    const underscored = document.createNode('A_B').setExtras({ blendlink_id: 'underscored-id' })
    scene.addChild(spaced).addChild(underscored)
    expect(() => allocateLoadedNodeNames(document)).toThrow(/both reserve.*A_B.*Rename one/s)
  })

  it('blocks scene names that would steal a node binding', () => {
    const document = new Document()
    document.createScene('Hero').addChild(document.createNode('Hero'))
    expect(() => allocateLoadedNodeNames(document)).toThrow(/scene "Hero".*node "Hero"/)
  })

  it('keeps anonymous render nodes out of the authored name API with actionable warnings', async () => {
    const document = new Document()
    const parent = document.createNode('Wall')
    parent.addChild(document.createNode().setTranslation([1, 0, 0]))
    parent.addChild(document.createNode().setTranslation([2, 0, 0]))
    document.createScene('Scene').addChild(parent)
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-anonymous-nodes-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))
      const generated = await generateSceneModule({
        glbPath, url: '/scene.glb', exportName: 'scene',
      })
      expect(generated.manifest.nodes).toEqual([
        expect.objectContaining({ name: 'Wall' }),
      ])
      expect(generated.manifest.vocabulary.warnings.filter(
        (warning) => warning.includes('anonymous glTF node'),
      )).toHaveLength(2)
      expect(generated.module).not.toContain('"": ""')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('blocks anonymous nodes with authored website behavior', async () => {
    const document = new Document()
    document.createScene().addChild(
      document.createNode().setExtras({ blendlink_id: 'anonymous-id' }),
    )
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-anonymous-authored-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))
      await expect(generateSceneModule({
        glbPath, url: '/scene.glb', exportName: 'scene',
      })).rejects.toThrow(/anonymous glTF node.*blendlink_id.*Name the object/s)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('emits stable IDs for runtime binding and collider proxies', async () => {
    const document = new Document()
    const scene = document.createScene('Scene')
    const spaced = document.createNode('A B').setExtras({ blendlink_id: 'spaced-id' })
    const proxy = document.createNode('Crate-colonly').setExtras({ blendlink_id: 'proxy-id' })
    scene.addChild(spaced).addChild(proxy)
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-loaded-names-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))
      const generated = await generateSceneModule({
        glbPath, url: '/scene.glb', exportName: 'scene',
      })
      expect(generated.manifest.identities).toMatchObject({
        'spaced-id': { name: 'A_B' },
      })
      expect(generated.module).toContain('A_B: "A_B"')
      expect(generated.module).toContain(
        '"name":"Crate","shape":"trimesh","proxyOnly":true',
      )
      expect(generated.module).toContain('"loadedName":"Crate-colonly","id":"proxy-id"')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('types multi-primitive authored nodes as loader Groups', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const position = document.createAccessor('position').setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer)
    const mesh = document.createMesh('Layered Mesh')
      .addPrimitive(document.createPrimitive().setAttribute('POSITION', position))
      .addPrimitive(document.createPrimitive().setAttribute('POSITION', position))
    document.createScene().addChild(
      document.createNode('Layered').setMesh(mesh).setExtras({ blendlink_id: 'layered-id' }),
    )
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-multi-primitive-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))
      const generated = await generateSceneModule({ glbPath, url: '/scene.glb', exportName: 'scene' })
      expect(generated.manifest.nodes).toContainEqual(expect.objectContaining({
        name: 'Layered', kind: 'Group', id: 'layered-id',
      }))
      expect(generated.module).toContain('Layered: THREE.Group')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses duplicate stable IDs before generating a broken runtime contract', async () => {
    const document = new Document()
    document.createScene().addChild(
      document.createNode('First').setExtras({ blendlink_id: 'duplicate-id' }),
    ).addChild(
      document.createNode('Second').setExtras({ blendlink_id: 'duplicate-id' }),
    )
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-duplicate-id-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))
      await expect(generateSceneModule({
        glbPath, url: '/scene.glb', exportName: 'scene',
      })).rejects.toThrow(/Duplicate blendlink_id/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
