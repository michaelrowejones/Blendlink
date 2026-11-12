import { describe, expect, it } from 'vitest'
import { Group, InstancedMesh, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import { buildTslColorNode, buildTslScalarNode } from './tslNodeRecipe.js'
import { createObjectInfoResolver, validateObjectInfoBinding } from './tslObjectInfo.js'
import { installTslMaterials } from './tslMaterialRuntime.js'
import type { MaterialProgramsDocument } from './materialProgramDocument.js'

function marker(name = 'Owner A') {
  return { schemaVersion: 1, objectName: name, objectInfo: { schemaVersion: 1,
    coordinateBasis: 'gltf-y-up', nativeLocation: [0, 0, 0], color: [.8, .35, .1, .4], objectIndex: 7 } }
}
const materialData = { schemaVersion: 1, materialIndex: 19 }
const ir = (output: string) => ({ schemaVersion: 1 as const, model: 'blendlink-tsl-ir-v1' as const,
  output: { op: 'object_info', output } })
type Uniform = { update(frame: unknown): void; value: number | { toArray(): number[] } }

describe('native Object Info owner/material bridge', () => {
  it('requires a real owner resolver instead of silently supplying zero', () => {
    expect(() => buildTslColorNode(ir('color'))).toThrow(/explicit object\/material owner resolver/)
  })
  it.each(['location', 'color', 'alpha', 'object_index', 'material_index'])('builds the production %s slot from explicit metadata', output => {
    const options = { objectInfo: createObjectInfoResolver(marker(), materialData) }
    expect(buildTslColorNode(ir(output), options)).toBeTruthy()
    expect(buildTslScalarNode(ir(output), options)).toBeTruthy()
  })
  it('tracks the authored owner world origin through animated parents and Blender/glTF basis conversion', () => {
    const parent = new Group()
    parent.position.set(4, 5, 6)
    parent.rotation.y = Math.PI / 2
    parent.scale.set(2, 3, 4)
    const owner = new Group(); owner.userData.blendlink_tsl_object = marker()
    owner.position.set(1, 2, 3)
    const child = new Mesh(new PlaneGeometry(), new MeshStandardMaterial())
    child.position.set(7, 8, 9) // primitive-local geometry is not the object origin
    parent.add(owner); owner.add(child)
    const node = createObjectInfoResolver(owner.userData.blendlink_tsl_object, materialData)('location') as unknown as Uniform
    node.update({ object: child })
    const actual = (node.value as { toArray(): number[] }).toArray()
    ;[16, -4, 11].forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 12))
    parent.position.x = 5
    node.update({ object: child })
    expect((node.value as { toArray(): number[] }).toArray()[0]).toBeCloseTo(17, 12)
  })
  it('supports explicit Z-up export coordinates without an implicit Y-up swizzle', () => {
    const data = marker(); data.objectInfo.coordinateBasis = 'blender-z-up'
    const owner = new Mesh(new PlaneGeometry(), new MeshStandardMaterial())
    owner.userData.blendlink_tsl_object = data
    owner.position.set(1, 2, 3)
    const node = createObjectInfoResolver(data, materialData)('location') as unknown as Uniform
    node.update({ object: owner })
    expect((node.value as { toArray(): number[] }).toArray()).toEqual([1, 2, 3])
  })
  it('keeps material pass indices separate from shared object geometry', () => {
    const owner = new Mesh(new PlaneGeometry(), new MeshStandardMaterial())
    owner.userData.blendlink_tsl_object = marker()
    const material = new MeshStandardMaterial()
    material.userData.blendlink_tsl_material = { schemaVersion: 1, materialIndex: 23 }
    const node = createObjectInfoResolver(owner.userData.blendlink_tsl_object, materialData)('material_index') as unknown as Uniform
    expect(node.value).toBe(19)
    node.update({ object: owner, material })
    expect(node.value).toBe(23)
  })
  it('refuses absent, malformed or unsupported owner/material data', () => {
    expect(() => validateObjectInfoBinding(new Set(['color']), {}, materialData)).toThrow(/versioned object-owner metadata/)
    const invalid = marker(); invalid.objectInfo.color[0] = NaN
    expect(() => validateObjectInfoBinding(new Set(['color']), invalid, materialData)).toThrow(/finite/)
    expect(() => validateObjectInfoBinding(new Set(['material_index']), marker(), {})).toThrow(/material metadata/)
    expect(() => validateObjectInfoBinding(new Set(['object_index']), marker(), materialData, true)).toThrow(/per-instance metadata/)
    expect(() => createObjectInfoResolver(marker(), materialData)('unknown')).toThrow(/unsupported/)
  })
  it('installs per-owner variants and refuses unsupported GPU-instance ownership by name', async () => {
    const material = new MeshStandardMaterial()
    material.userData = { blendlink_source_material: 'Artist', blendlink_tsl_material: materialData }
    const root = new Group()
    const a = new Group(), b = new Group()
    a.userData.blendlink_tsl_object = marker('A'); b.userData.blendlink_tsl_object = marker('B')
    b.userData.blendlink_tsl_object.objectInfo.color = [.1, .6, .9, .75]
    const geometry = new PlaneGeometry()
    const first = new Mesh(geometry, material), second = new Mesh(geometry, material)
    a.add(first); b.add(second); root.add(a,b)
    const gpu = new InstancedMesh(geometry, material, 2)
    gpu.userData.blendlink_tsl_object = marker('GPU instances'); root.add(gpu)
    const document: MaterialProgramsDocument = { schemaVersion: 1, model: 'blendlink-material-programs-v1',
      materials: { Artist: { channels: { 'Base Color': { tslIr: ir('color') }, Alpha: { tslIr: ir('alpha') } } } } }
    const installed = await installTslMaterials({ root, descriptor: { materialPrograms: { url: '/programs.json', bytes: 1, hash: 'test' } },
      loadPrograms: async () => document })
    expect(installed.applied).toBe(2)
    expect(first.material).not.toBe(second.material)
    expect(installed.skipped.some(skip => /per-instance metadata/.test(skip.reason))).toBe(true)
    installed.dispose()
    expect(first.material).toBe(material); expect(second.material).toBe(material)
  })
})
