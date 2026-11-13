import { createHash } from 'node:crypto'
import { Document, NodeIO } from '@gltf-transform/core'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { expect, it } from 'vitest'
import { validateTangentBinding } from './tslTangentNodes.js'
import { auditCompiledSceneArtifact } from './compiledSceneAudit.js'
import { installTslMaterials } from './tslMaterialRuntime.js'
import { assertLegacyMaterialCarriers } from './materialProgramDocument.js'
import type { TslIrExpression } from './tslNodeRecipe.js'
import type { SceneManifest } from './typegen.js'

const extras = {
  schemaVersion: 1,
  objectSpace: 'blender-z-up',
  geometryContext: ['normal'],
  uvChannels: { RenderUV: 0 },
  tangentFrame: { schemaVersion: 1, model: 'blender-mikk-uv-v1', uvMap: 'RenderUV' },
}
function expression(): TslIrExpression {
  return {
    op: 'tangent_native',
    model: 'primary-mikk-tangent-v1',
    sourceEngine: 'EEVEE',
    frameSource: 'blender-mikk-uv-v1',
    uvMap: 'RenderUV',
    tangentStorage: 'SNORM10',
    normal: {
      op: 'geometry_context',
      output: 'normal',
      sourceEngine: 'EEVEE',
      model: 'primary-triangles-v1',
      normalStorage: 'SNORM10',
      normalShading: 'smooth',
    },
  }
}
function mesh() {
  return new Mesh(
    new BufferGeometry()
      .setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
      .setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
      .setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4))
      .setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2)),
    new MeshStandardMaterial(),
  )
}

it('requires actual named-UV Mikk bytes and invalidates replaced tangent attributes', () => {
  const owner = mesh(),
    ir = expression()
  expect(() => validateTangentBinding([ir], owner, 'blender-z-up', extras)).not.toThrow()
  owner.geometry.setAttribute(
    'tangent',
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  )
  expect(() => validateTangentBinding([ir], owner, 'blender-z-up', extras)).toThrow(/handedness/)
  expect(() =>
    validateTangentBinding([ir], mesh(), 'blender-z-up', { ...extras, tangentFrame: undefined }),
  ).toThrow(/frame declaration/)
})

it('rechecks projected-frame conditioning against the live owner transform', () => {
  const owner = mesh()
  validateTangentBinding([expression()], owner, 'blender-z-up', extras)
  owner.scale.x = 0.001
  expect(() => validateTangentBinding([expression()], owner, 'blender-z-up', extras)).toThrow(
    /condition bound/,
  )
  const degenerate = mesh()
  degenerate.geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2))
  expect(() => validateTangentBinding([expression()], degenerate, 'blender-z-up', extras)).toThrow(
    /nondegenerate UV/,
  )
})

async function artifact(valid = true) {
  const document = new Document(),
    buffer = document.createBuffer(),
    geometry = mesh().geometry
  const accessor = (name: string, size: 'VEC2' | 'VEC3' | 'VEC4') =>
    document
      .createAccessor()
      .setBuffer(buffer)
      .setType(size)
      .setArray(geometry.getAttribute(name).array)
  const material = document
    .createMaterial('Live tangent normal')
    .setBaseColorFactor([0.42, 0.35, 0.13, 1])
    .setExtras({ blendlink_source_material: 'Live tangent normal' })
  const primitive = document
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', accessor('position', 'VEC3'))
    .setAttribute('NORMAL', accessor('normal', 'VEC3'))
    .setAttribute('TEXCOORD_0', accessor('uv', 'VEC2'))
  if (valid) primitive.setAttribute('TANGENT', accessor('tangent', 'VEC4'))
  const source = document
    .createMesh()
    .setExtras({ blendlink_tsl_runtime: extras, claimedTangentProof: [1, 0, 0, 1] })
    .addPrimitive(primitive)
  document
    .getRoot()
    .setDefaultScene(
      document.createScene().addChild(document.createNode('Actual tangent owner').setMesh(source)),
    )
  const glb = await new NodeIO().writeBinary(document)
  const programs = {
    schemaVersion: 1,
    model: 'blendlink-material-programs-v1',
    materials: {
      'Live tangent normal': {
        channels: {
          Normal: {
            tslIr: {
              schemaVersion: 1,
              model: 'blendlink-tsl-ir-v1',
              output: { op: 'normal_view_native', input: expression() },
            },
          },
        },
      },
    },
  }
  const bytes = new TextEncoder().encode(JSON.stringify(programs)),
    hash = createHash('sha256').update(glb).digest('hex')
  const manifest = {
    schemaVersion: 3,
    generator: 'scenetoweb',
    hash: hash.slice(0, 16),
    url: '/actual.glb',
    stats: { bytes: glb.length },
    materialPrograms: {
      url: '/actual.programs.json',
      hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      bytes: bytes.length,
      materials: 1,
    },
  } as unknown as SceneManifest
  return { glb, bytes, programs, manifest }
}

it('validates real GLB tangent/UV bindings for a normal-only program with portable base color', async () => {
  const good = await artifact(),
    bad = await artifact(false)
  await expect(
    auditCompiledSceneArtifact({
      glbBytes: good.glb,
      manifest: good.manifest,
      materialProgramsBytes: good.bytes,
    }),
  ).resolves.toBeDefined()
  await expect(
    auditCompiledSceneArtifact({
      glbBytes: bad.glb,
      manifest: bad.manifest,
      materialProgramsBytes: bad.bytes,
    }),
  ).rejects.toThrow(/actual Float32 Mikk/)
  const gltf = await new GLTFLoader().parseAsync(good.glb.slice().buffer, '')
  await expect(
    assertLegacyMaterialCarriers({
      root: gltf.scene,
      descriptor: good.manifest,
      loadPrograms: async () => good.programs as never,
    }),
  ).rejects.toThrow(/Legacy WebGLRenderer/)
  const installed = await installTslMaterials({
    root: gltf.scene,
    descriptor: good.manifest,
    loadPrograms: async () => good.programs as never,
  })
  expect(installed.applied).toBe(1)
  expect(installed.skipped).toEqual([])
  installed.dispose()
  gltf.scene.traverse((object) => {
    if ((object as Mesh).isMesh) (object as Mesh).geometry.deleteAttribute('tangent')
  })
  const refused = await installTslMaterials({
    root: gltf.scene,
    descriptor: good.manifest,
    loadPrograms: async () => good.programs as never,
  })
  expect(refused.applied).toBe(0)
  expect(refused.skipped[0]?.reason).toMatch(/actual Float32 Mikk/)
  refused.dispose()
})
