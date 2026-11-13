import { createHash } from 'node:crypto'
import { Document, NodeIO } from '@gltf-transform/core'
import {
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Uint16BufferAttribute,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'
import { validatedBaseColorProgramMaterials } from './compiledMaterialPrograms.js'
import { installTslMaterials } from './tslMaterialRuntime.js'
import { buildTslColorNode } from './tslNodeRecipe.js'
import {
  validateGeometryContextBinding,
  validateGeometryContextCamera,
} from './tslGeometryContext.js'

const ir = (output = 'normal') => ({
  schemaVersion: 1,
  model: 'blendlink-tsl-ir-v1' as const,
  output: {
    op: 'geometry_context',
    output,
    sourceEngine: 'CYCLES',
    normalStorage: 'OCT16',
    normalTransform: 'object',
    model: 'primary-triangles-v1',
  },
})
function triangle() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  return new Mesh(geometry, new MeshStandardMaterial())
}
const normal = new Set(['normal'] as const)

describe('native primary geometry binding', () => {
  it('invalidates the verified topology cache when an attribute is replaced at the same version/count', () => {
    const mesh = triangle()
    validateGeometryContextBinding(normal, mesh, 'blender-z-up')
    mesh.geometry.setAttribute(
      'normal',
      new Float32BufferAttribute([0, 0, -1, 0, 0, -1, 0, 0, -1], 3),
    )
    expect(() => validateGeometryContextBinding(normal, mesh, 'blender-z-up')).toThrow(/cosine/)
  })
  it('keeps checking a live owner matrix after its geometry has been verified', () => {
    const mesh = triangle()
    validateGeometryContextBinding(normal, mesh, 'blender-z-up')
    mesh.scale.z = 0
    expect(() => validateGeometryContextBinding(normal, mesh, 'blender-z-up')).toThrow(/invertible/)
    mesh.scale.set(1, 0.001, 1)
    expect(() => validateGeometryContextBinding(normal, mesh, 'blender-z-up')).toThrow(
      /condition bound/,
    )
  })
  it('does not turn quantized normal streams, shape keys, or GPU instances into a primary-triangle proof', () => {
    const mesh = triangle()
    mesh.geometry.setAttribute(
      'normal',
      new Uint16BufferAttribute([0, 0, 65535, 0, 0, 65535, 0, 0, 65535], 3, true),
    )
    expect(() => validateGeometryContextBinding(normal, mesh, 'blender-z-up')).toThrow(/Float32/)
    const morph = triangle()
    morph.geometry.morphAttributes.position = [morph.geometry.getAttribute('position')]
    expect(() => validateGeometryContextBinding(normal, morph, 'blender-z-up')).toThrow(/morph/)
    const instance = new InstancedMesh(triangle().geometry, new MeshStandardMaterial(), 2)
    expect(() => validateGeometryContextBinding(normal, instance, 'blender-z-up')).toThrow(
      /instances/,
    )
  })
  it('requires source-bound native normal interpolation rather than guessing from browser sharing', () => {
    const document = ir()
    delete (document.output as Record<string, unknown>).normalTransform
    expect(() => buildTslColorNode(document, { objectSpace: { basis: 'blender-z-up' } })).toThrow(
      /source-scene/,
    )
    expect(() => buildTslColorNode(ir(), { objectSpace: { basis: 'blender-z-up' } })).not.toThrow()
  })
  it('admits positive camera scale but names reflected/sheared projection limits', () => {
    const camera = new PerspectiveCamera()
    camera.scale.set(1.3, 0.7, 2.1)
    expect(() => validateGeometryContextCamera(camera)).not.toThrow()
    camera.scale.x = -1
    expect(() => validateGeometryContextCamera(camera)).toThrow(/reflected\/sheared/)
    camera.scale.set(1, 1, 1)
    camera.matrixAutoUpdate = false
    camera.matrix = new Matrix4().set(1, 0.1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
    expect(() => validateGeometryContextCamera(camera)).toThrow(/reflected\/sheared/)
  })
})

it('requires actual Float32 normal accessors before Final exemption and rechecks the loaded GLB before installation', async () => {
  const document = new Document(),
    buffer = document.createBuffer()
  const position = document
    .createAccessor()
    .setBuffer(buffer)
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
  const normal = document
    .createAccessor()
    .setBuffer(buffer)
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
  const material = document
    .createMaterial('Native.BLENDLINK_TSL')
    .setExtras({ blendlink_source_material: 'Native' })
  const mesh = document
    .createMesh()
    .setExtras({
      blendlink_tsl_runtime: {
        schemaVersion: 1,
        objectSpace: 'blender-z-up',
        geometryContext: ['normal'],
      },
    })
    .addPrimitive(
      document
        .createPrimitive()
        .setMaterial(material)
        .setAttribute('POSITION', position)
        .setAttribute('NORMAL', normal),
    )
  document
    .getRoot()
    .setDefaultScene(document.createScene().addChild(document.createNode().setMesh(mesh)))
  const bytes = await new NodeIO().writeBinary(document),
    json = (await new NodeIO().binaryToJSON(bytes)).json
  const programs = {
    schemaVersion: 1,
    model: 'blendlink-material-programs-v1',
    materials: { Native: { channels: { 'Base Color': { tslIr: ir() } } } },
  }
  const sidecar = new TextEncoder().encode(JSON.stringify(programs))
  const descriptor = {
    materialPrograms: {
      url: '/geometry.materials.json',
      materials: 1,
      bytes: sidecar.length,
      hash: createHash('sha256').update(sidecar).digest('hex').slice(0, 16),
    },
  }
  expect([...(await validatedBaseColorProgramMaterials(json, descriptor, sidecar))]).toEqual([0])
  const corrupted = structuredClone(json)
  corrupted.accessors![1]!.componentType = 5123
  expect((await validatedBaseColorProgramMaterials(corrupted, descriptor, sidecar)).size).toBe(0)
  const loaded = await new GLTFLoader().parseAsync(bytes.slice().buffer, '')
  const installed = await installTslMaterials({
    root: loaded.scene,
    descriptor,
    loadPrograms: async () => programs as never,
  })
  expect(installed.applied).toBe(1)
  expect(installed.skipped).toEqual([])
  installed.dispose()
  loaded.scene.traverse((object) => {
    if ((object as Mesh).isMesh) (object as Mesh).geometry.deleteAttribute('normal')
  })
  const refused = await installTslMaterials({
    root: loaded.scene,
    descriptor,
    loadPrograms: async () => programs as never,
  })
  expect(refused.applied).toBe(0)
  expect(refused.skipped[0]?.reason).toMatch(/authored NORMAL/)
  refused.dispose()
})
