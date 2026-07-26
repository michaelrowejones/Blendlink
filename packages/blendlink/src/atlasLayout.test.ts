import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { Accessor, Document } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { finalizeAtlasLayoutEvidence } from './atlasLayout.js'
import type { BakePlan } from './invoke.js'

function record(values: Array<[number, number]>): NonNullable<BakePlan['atlasLayout']>['objects'][number] {
  const raw = Buffer.alloc(values.length * 8)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  values.forEach(([u, v], index) => {
    view.setFloat32(index * 8, u, true)
    view.setFloat32(index * 8 + 4, v, true)
  })
  return {
    name: 'Gallery', id: 'gallery-id', atlas: 'main', topologyHash: 'topology',
    loopCount: values.length,
    uvHash: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    data: deflateSync(raw).toString('base64'),
  }
}

describe('final packed UV evidence', () => {
  it('attests 100k source loops by their distinct values across multiple primitives in linear time', () => {
    const corners: Array<[number, number]> = [
      [0.125, 0.25], [0.625, 0.25], [0.625, 0.875], [0.125, 0.875],
    ]
    const source = Array.from({ length: 100_000 }, (_, index) => corners[index % corners.length]!)
    const document = new Document()
    const buffer = document.createBuffer()
    const uvA = document.createAccessor('Final atlas UV A')
      .setType(Accessor.Type.VEC2)
      .setArray(new Float32Array([0.125, 0.75, 0.625, 0.75]))
      .setBuffer(buffer)
    const uvB = document.createAccessor('Final atlas UV B')
      .setType(Accessor.Type.VEC2)
      .setArray(new Float32Array([0.625, 0.125, 0.125, 0.125, 0.125, 0.125]))
      .setBuffer(buffer)
    const texture = document.createTexture('Baked state')
    const material = document.createMaterial('Baked').setBaseColorTexture(texture)
    const mesh = document.createMesh('Gallery')
      .addPrimitive(document.createPrimitive().setAttribute('TEXCOORD_0', uvA).setMaterial(material))
      .addPrimitive(document.createPrimitive().setAttribute('TEXCOORD_0', uvB).setMaterial(material))
    document.createNode('Gallery').setExtras({ blendlink_id: 'gallery-id' }).setMesh(mesh)

    const sourceRecord = record(source)
    const result = finalizeAtlasLayoutEvidence(document, {
      version: 1,
      encoding: 'f32le-zlib-base64',
      space: 'blender-pack',
      objects: [sourceRecord],
    })
    expect(result.space).toBe('final-glb-decoded')
    expect(result.unavailable).toBeUndefined()
    expect(result.objects[0]).toEqual(sourceRecord)
  })

  it('reports rather than inventing evidence when the final UV set cannot match', () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const uv = document.createAccessor().setType(Accessor.Type.VEC2)
      .setArray(new Float32Array([0.25, 0.25, 0.75, 0.75])).setBuffer(buffer)
    const material = document.createMaterial().setBaseColorTexture(document.createTexture())
    const mesh = document.createMesh().addPrimitive(
      document.createPrimitive().setAttribute('TEXCOORD_0', uv).setMaterial(material),
    )
    document.createNode('Gallery').setExtras({ blendlink_id: 'gallery-id' }).setMesh(mesh)
    const result = finalizeAtlasLayoutEvidence(document, {
      version: 1, encoding: 'f32le-zlib-base64', space: 'blender-pack',
      objects: [record([[0, 0], [1, 1]])],
    })
    expect(result.objects).toHaveLength(0)
    expect(result.unavailable?.[0]?.reason).toContain('set differs')
  })
})
