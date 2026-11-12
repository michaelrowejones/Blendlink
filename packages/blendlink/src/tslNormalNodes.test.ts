import { createHash } from 'node:crypto'
import { Document, NodeIO } from '@gltf-transform/core'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'
import { validateNormalMapBinding } from './tslNormalNodes.js'
import { validatedBaseColorProgramMaterials } from './compiledMaterialPrograms.js'
import { auditCompiledSceneArtifact } from './compiledSceneAudit.js'
import { installTslMaterials } from './tslMaterialRuntime.js'
import { assertLegacyMaterialCarriers } from './materialProgramDocument.js'
import type { TslIrExpression } from './tslNodeRecipe.js'
import type { SceneManifest } from './typegen.js'

function expression(): TslIrExpression {
  return {
    op: 'normal_map_native',
    model: 'primary-normal-map-v1',
    space: 'WORLD',
    sourceEngine: 'EEVEE',
    base: 'DISPLACED',
    convention: 'OPENGL',
    color: { op: 'const_vec3', value: [0.8, 0.5, 0.9] },
    strength: { op: 'const_float', value: 0.5 },
    normal: {
      op: 'geometry_context',
      model: 'primary-triangles-v1',
      output: 'normal',
      sourceEngine: 'EEVEE',
      normalStorage: 'SNORM10',
    },
  }
}
function mesh() {
  return new Mesh(
    new BufferGeometry()
      .setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
      .setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)),
    new MeshStandardMaterial(),
  )
}

describe('native Normal Map normalization certificate', () => {
  it('needs actual normal bytes for a potentially cancelling blend and does not assume a flat normal', () => {
    expect(() => validateNormalMapBinding([expression()], new Object3D(), 'blender-z-up')).toThrow(
      /actual bound normal data/,
    )
    expect(() => validateNormalMapBinding([expression()], mesh(), 'blender-z-up')).not.toThrow()
  })
  it('invalidates its bounds after a normal attribute replacement at the same version/count', () => {
    const object = mesh()
    validateNormalMapBinding([expression()], object, 'blender-z-up')
    object.geometry.setAttribute(
      'normal',
      new Float32BufferAttribute([0.6, 0, 0.8, 0.6, 0, 0.8, 0.6, 0, 0.8], 3),
    )
    expect(() => validateNormalMapBinding([expression()], object, 'blender-z-up')).toThrow(
      /normal cone/,
    )
  })
  it('rechecks the live owner transform rather than retaining a source-pose certificate', () => {
    const object = mesh()
    validateNormalMapBinding([expression()], object, 'blender-z-up')
    object.rotation.y = Math.asin(0.6)
    expect(() => validateNormalMapBinding([expression()], object, 'blender-z-up')).toThrow(
      /normal cone/,
    )
  })
  it('refuses a definite EEVEE zero normal while preserving its defined Cycles World fallback', () => {
    const zero = expression()
    zero.color = { op: 'const_vec3', value: [0.5, 0.5, 0.5] }
    zero.strength = { op: 'const_float', value: 1 }
    expect(() => validateNormalMapBinding([zero], mesh(), 'blender-z-up')).toThrow(/zero-length/)
    zero.sourceEngine = 'CYCLES'
    ;(zero.normal as TslIrExpression).sourceEngine = 'CYCLES'
    expect(() => validateNormalMapBinding([zero], mesh(), 'blender-z-up')).not.toThrow()
  })
})

async function publication(aligned = false, declared = true) {
  const doc = new Document(),
    buffer = doc.createBuffer()
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
  const n = aligned ? [0.6, 0, 0.8] : [0, 0, 1]
  const normal = doc
    .createAccessor()
    .setType('VEC3')
    .setBuffer(buffer)
    .setArray(new Float32Array([...n, ...n, ...n]))
  const material = doc
    .createMaterial('Native Normal')
    .setBaseColorFactor([0.42, 0.35, 0.13, 1])
    .setExtras({ blendlink_source_material: 'Native Normal' })
  const mesh = doc
    .createMesh()
    .setExtras({
      blendlink_tsl_runtime: {
        schemaVersion: 1,
        objectSpace: 'blender-z-up',
        geometryContext: declared ? ['normal'] : [],
      },
      normalMapBounds: { min: [0, 0, 1], max: [0, 0, 1] },
    })
    .addPrimitive(
      doc
        .createPrimitive()
        .setMaterial(material)
        .setAttribute('POSITION', position)
        .setAttribute('NORMAL', normal),
    )
  doc
    .getRoot()
    .setDefaultScene(
      doc.createScene().addChild(doc.createNode('Actual normal owner').setMesh(mesh)),
    )
  const glbBytes = await new NodeIO().writeBinary(doc)
  const programs = {
    schemaVersion: 1,
    model: 'blendlink-material-programs-v1',
    materials: {
      'Native Normal': {
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
  const bytes = new TextEncoder().encode(JSON.stringify(programs))
  const manifest = {
    schemaVersion: 3,
    generator: 'blendlink',
    url: '/normal.glb',
    hash: createHash('sha256').update(glbBytes).digest('hex').slice(0, 16),
    stats: { bytes: glbBytes.length, triangles: 1, meshes: 1, texturesBytes: 0 },
    materialPrograms: {
      url: '/normal.materials.json',
      bytes: bytes.length,
      hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      materials: 1,
    },
  } as unknown as SceneManifest
  return { glbBytes, programs, bytes, manifest }
}

it('audits the actual GLB normal bytes even when Base Color is already portable and no Base Color program exists', async () => {
  const good = await publication()
  expect(
    (
      await auditCompiledSceneArtifact({
        manifest: good.manifest,
        glbBytes: good.glbBytes,
        materialProgramsBytes: good.bytes,
      })
    ).conformance.issues,
  ).toEqual([])
  const json = (await new NodeIO().binaryToJSON(good.glbBytes)).json
  await expect(validatedBaseColorProgramMaterials(json, good.manifest, good.bytes)).rejects.toThrow(
    /actual bound normal data/,
  )
  const invalid = await publication(true)
  await expect(
    auditCompiledSceneArtifact({
      manifest: invalid.manifest,
      glbBytes: invalid.glbBytes,
      materialProgramsBytes: invalid.bytes,
    }),
  ).rejects.toThrow(/normal cone/)
  const undeclared = await publication(false, false)
  await expect(
    auditCompiledSceneArtifact({
      manifest: undeclared.manifest,
      glbBytes: undeclared.glbBytes,
      materialProgramsBytes: undeclared.bytes,
    }),
  ).rejects.toThrow(/context declaration/)
  const scene = await new GLTFLoader().parseAsync(good.glbBytes.slice().buffer, '')
  await expect(
    assertLegacyMaterialCarriers({
      root: scene.scene,
      descriptor: good.manifest,
      loadPrograms: async () => good.programs as never,
    }),
  ).rejects.toThrow(/Legacy WebGLRenderer.*Normal Map.*WebGPURenderer/)
  const applied = await installTslMaterials({
    root: scene.scene,
    descriptor: good.manifest,
    loadPrograms: async () => good.programs as never,
  })
  expect(applied.applied).toBe(1)
  expect(applied.skipped).toEqual([])
  applied.dispose()
  scene.scene.traverse((object) => {
    if ((object as Mesh).isMesh)
      (object as Mesh).geometry.setAttribute(
        'normal',
        new Float32BufferAttribute([0.6, 0, 0.8, 0.6, 0, 0.8, 0.6, 0, 0.8], 3),
      )
  })
  const refused = await installTslMaterials({
    root: scene.scene,
    descriptor: good.manifest,
    loadPrograms: async () => good.programs as never,
  })
  expect(refused.applied).toBe(0)
  expect(refused.skipped[0]?.reason).toMatch(/normal cone/)
  refused.dispose()
})
