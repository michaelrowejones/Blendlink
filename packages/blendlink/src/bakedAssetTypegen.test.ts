import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { KHRMaterialsUnlit, KHRTextureBasisu } from '@gltf-transform/extensions'
import { describe, expect, it } from 'vitest'
import { generateSceneModule } from './typegen.js'

function meshDocument(options: {
  texcoord?: boolean
  degenerateUv?: boolean
  numericalSliver?: boolean
  expandNumericalSliverInWorld?: boolean
  unlit?: boolean
  shareWithRealtime?: boolean
} = {}): Document {
  const document = new Document()
  const buffer = document.createBuffer()
  const position = document.createAccessor('Position')
    .setType('VEC3')
    .setArray(new Float32Array(options.numericalSliver
      ? [0, 0, 0, 1, 0, 0, 0.5, 0.0000001, 0]
      : [0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer)
  const primitive = document.createPrimitive().setAttribute('POSITION', position)
  if (options.texcoord !== false) {
    primitive.setAttribute(
      'TEXCOORD_1',
      document.createAccessor('Lightmap UV')
        .setType('VEC2')
        .setArray(new Float32Array(options.degenerateUv
          ? [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
          : [0, 0, 1, 0, 0, 1]))
        .setBuffer(buffer),
    )
  }
  const material = document.createMaterial('Shared Material')
  if (options.unlit) {
    const extension = document.createExtension(KHRMaterialsUnlit).setRequired(true)
    material.setExtension('KHR_materials_unlit', extension.createUnlit())
  }
  primitive.setMaterial(material)
  const mesh = document.createMesh('Triangle').addPrimitive(primitive)
  const scene = document.createScene('Scene')
  const lightingNode = document.createNode('Lighting Mesh').setMesh(mesh).setExtras({
    blendlink_id: 'lighting-id',
    blendlink_atlas: 'main',
    blendlink_bake_output: 'lighting',
    blendlink_lightmap_uv: 1,
  })
  if (options.expandNumericalSliverInWorld) {
    scene.addChild(
      document.createNode('Non-uniform Scale Parent')
        .setScale([1, 10_000_000, 1])
        .addChild(lightingNode),
    )
  } else {
    scene.addChild(lightingNode)
  }
  if (options.shareWithRealtime) {
    scene.addChild(document.createNode('Realtime Mesh').setMesh(mesh).setExtras({
      blendlink_id: 'realtime-id',
    }))
  }
  return document
}

function appearanceMeshDocument(): Document {
  const document = new Document()
  const buffer = document.createBuffer()
  const position = document.createAccessor('Position')
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer)
  const uv = document.createAccessor('Collapsed Appearance UV')
    .setType('VEC2')
    .setArray(new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]))
    .setBuffer(buffer)
  const texture = document.createTexture('Baked Appearance')
    .setImage(new Uint8Array([137, 80, 78, 71]))
    .setMimeType('image/png')
  const material = document.createMaterial('Baked Appearance')
    .setBaseColorTexture(texture)
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('TEXCOORD_0', uv)
    .setMaterial(material)
  const mesh = document.createMesh('Appearance Triangle').addPrimitive(primitive)
  document.createScene('Scene').addChild(
    document.createNode('Appearance Mesh').setMesh(mesh).setExtras({
      blendlink_id: 'appearance-id',
      blendlink_atlas: 'main',
      blendlink_bake_output: 'appearance',
    }),
  )
  return document
}

describe('baked asset generated contract', () => {
  it('cache-busts every flat and grouped atlas from its exact byte hash', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-baked-typegen-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      const document = new Document()
      document.createExtension(KHRTextureBasisu).setRequired(true)
      document.createScene('Scene')
        .addChild(document.createNode('Day Prop').setExtras({
          blendlink_id: 'day-prop-id',
          blendlink_atlas: 'main',
          blendlink_bake_output: 'lighting',
          blendlink_lightmap_uv: 2,
        }))
        .addChild(document.createNode('Legacy Lamp'))
      writeFileSync(glbPath, await new NodeIO().registerExtensions([KHRTextureBasisu]).writeBinary(document))
      const generated = await generateSceneModule({
        glbPath,
        url: '/scene.glb',
        exportName: 'scene',
        states: {
          day: { url: '/day.png', default: true },
          night: { atlases: { main: '/night-main.png', detail: '/night-detail.png' } },
        },
        bakeOutputs: { main: 'lighting', detail: 'appearance' },
        stateScales: {
          day: { main: 2.25 },
          night: { main: 0.5, detail: 1.75 },
        },
        stateVisibility: {
          day: { hiddenObjectIds: [], hiddenObjectNames: [] },
          night: { hiddenObjectIds: ['day-prop-id'], hiddenObjectNames: ['Legacy Lamp'] },
        },
        lightGroups: {
          lamp: { url: '/lamp.png', maxValue: 2 },
          signs: { atlases: {
            main: { url: '/sign-main.png', maxValue: 1 },
            detail: { url: '/sign-detail.png', maxValue: 3 },
          } },
        },
        textureVariants: {
          '/day.png': [
            {
              url: '/day.256.webp', format: 'webp', width: 256, height: 256,
              bytes: 1200, hash: 'day256webphash', lossless: true,
            },
            {
              url: '/day.256.png', format: 'png', width: 256, height: 256,
              bytes: 1800, hash: 'day256pnghash', lossless: true,
            },
            {
              url: '/day.webp', format: 'webp', width: 2048, height: 2048,
              bytes: 18_000, hash: 'dayfullwebphash', lossless: true,
            },
          ],
        },
        bakeArtifactHashes: {
          version: 1,
          states: {
            day: { main: 'dayhash' },
            night: { main: 'nightmain', detail: 'nightdetail' },
          },
          lightGroups: {
            lamp: { main: 'lamphash' },
            signs: { main: 'signmain', detail: 'signdetail' },
          },
        },
      })
      for (const expected of [
        '/day.png?v=dayhash', '/night-main.png?v=nightmain',
        '/night-detail.png?v=nightdetail', '/lamp.png?v=lamphash',
        '/sign-main.png?v=signmain', '/sign-detail.png?v=signdetail',
        '/day.256.webp?v=day256webphash', '/day.256.png?v=day256pnghash',
        '/day.webp?v=dayfullwebphash',
      ]) expect(generated.module).toContain(expected)
      expect(generated.module).toContain('defaultState: "day"')
      expect(generated.module).toContain('requiresKtx2: true')
      expect(generated.module).toContain('bakeOutputs: {"main":"lighting","detail":"appearance"} as const')
      expect(generated.module).toContain(
        'stateScales: {"day":{"main":2.25},"night":{"main":0.5,"detail":1.75}} as const',
      )
      expect(generated.module).toContain('"hiddenObjectIds":["day-prop-id"]')
      expect(generated.manifest.states?.day.url).toBe('/day.png')
      expect(generated.manifest.textureVariants?.['/day.png']).toEqual([
        expect.objectContaining({ format: 'webp', width: 256, hash: 'day256webphash' }),
        expect.objectContaining({ format: 'png', width: 256, hash: 'day256pnghash' }),
        expect.objectContaining({ format: 'webp', width: 2048, hash: 'dayfullwebphash' }),
      ])
      expect(generated.manifest.requiresKtx2).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects invalid lighting scales and UV metadata before emitting a descriptor', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-baked-contract-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      const document = new Document()
      document.createScene('Scene').addChild(document.createNode('Lit').setExtras({
        blendlink_id: 'lit-id',
        blendlink_atlas: 'main',
        blendlink_bake_output: 'lighting',
        blendlink_lightmap_uv: 0,
      }))
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))
      await expect(generateSceneModule({
        glbPath,
        url: '/scene.glb',
        exportName: 'scene',
        states: { day: { url: '/day.png', default: true } },
        bakeOutputs: { main: 'lighting' },
        stateScales: {},
      })).rejects.toThrow(/no finite positive state scale/)

      await expect(generateSceneModule({
        glbPath,
        url: '/scene.glb',
        exportName: 'scene',
        states: { day: { url: '/day.png', default: true } },
        bakeOutputs: { main: 'lighting' },
        stateScales: { day: { main: Number.POSITIVE_INFINITY } },
      })).rejects.toThrow(/scale Infinity.*finite and greater than zero/s)

      await expect(generateSceneModule({
        glbPath,
        url: '/scene.glb',
        exportName: 'scene',
        states: { day: { url: '/day.png', default: true } },
        bakeOutputs: { main: 'lighting' },
        stateScales: { day: { main: 1 } },
      })).rejects.toThrow(/invalid blendlink_lightmap_uv 0/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('validates real Lighting primitives after GLB decode', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-lighting-primitives-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      const generate = () => generateSceneModule({
        glbPath,
        url: '/scene.glb',
        exportName: 'scene',
        states: { day: { url: '/day.png', default: true } },
        bakeOutputs: { main: 'lighting' as const },
        stateScales: { day: { main: 1 } },
      })

      writeFileSync(glbPath, await new NodeIO().writeBinary(meshDocument()))
      await expect(generateSceneModule({
        glbPath,
        url: '/scene.glb',
        exportName: 'scene',
      })).rejects.toThrow(/bakeOutputs has no Lighting entry/)
      await expect(generate()).resolves.toMatchObject({
        manifest: { bakeOutputs: { main: 'lighting' } },
      })

      writeFileSync(
        glbPath,
        await new NodeIO().writeBinary(meshDocument({ degenerateUv: true })),
      )
      await expect(generate()).rejects.toThrow(
        /Lighting node "Lighting Mesh".*primitive 0 triangle 0.*non-zero geometry.*zero-area TEXCOORD_1/s,
      )

      writeFileSync(
        glbPath,
        await new NodeIO().writeBinary(meshDocument({
          degenerateUv: true,
          numericalSliver: true,
        })),
      )
      await expect(generate()).resolves.toMatchObject({
        manifest: { bakeOutputs: { main: 'lighting' } },
      })

      writeFileSync(
        glbPath,
        await new NodeIO().writeBinary(meshDocument({
          degenerateUv: true,
          numericalSliver: true,
          expandNumericalSliverInWorld: true,
        })),
      )
      await expect(generate()).rejects.toThrow(
        /Lighting node "Lighting Mesh".*primitive 0 triangle 0.*non-zero geometry.*zero-area TEXCOORD_1/s,
      )

      writeFileSync(glbPath, await new NodeIO().writeBinary(meshDocument({ texcoord: false })))
      await expect(generate()).rejects.toThrow(/primitive 0 is missing TEXCOORD_1/)

      writeFileSync(
        glbPath,
        await new NodeIO().registerExtensions([KHRMaterialsUnlit])
          .writeBinary(meshDocument({ unlit: true })),
      )
      await expect(generate()).rejects.toThrow(/uses KHR_materials_unlit.*requires a PBR material/s)

      writeFileSync(
        glbPath,
        await new NodeIO().writeBinary(meshDocument({ shareWithRealtime: true })),
      )
      await expect(generate()).rejects.toThrow(
        /material "Shared Material" is shared across incompatible bake bindings.*Lighting Mesh.*Realtime Mesh/s,
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a final Appearance triangle collapsed onto its baked texture coordinates', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-appearance-uv-triangles-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      writeFileSync(glbPath, await new NodeIO().writeBinary(appearanceMeshDocument()))
      await expect(generateSceneModule({
        glbPath,
        url: '/scene.glb',
        exportName: 'scene',
        states: { day: { url: '/day.png', default: true } },
        bakeOutputs: { main: 'appearance' },
        stateScales: { day: { main: 1 } },
      })).rejects.toThrow(
        /Appearance node "Appearance Mesh".*non-zero geometry.*zero-area TEXCOORD_0/s,
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
