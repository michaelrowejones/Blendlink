import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { afterEach, describe, expect, it } from 'vitest'
import { generateSceneModule } from './typegen.js'

const owned: string[] = []

afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})

function mutateGlbJson(
  bytes: Uint8Array,
  mutate: (json: Record<string, unknown>) => void,
): Uint8Array {
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = source.getUint32(12, true)
  const jsonEnd = 20 + jsonLength
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, jsonEnd)).trim(),
  ) as Record<string, unknown>
  mutate(json)
  const encoded = new TextEncoder().encode(JSON.stringify(json))
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4
  const suffix = bytes.subarray(jsonEnd)
  const result = new Uint8Array(20 + paddedLength + suffix.byteLength)
  const view = new DataView(result.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, result.byteLength, true)
  view.setUint32(12, paddedLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  result.set(encoded, 20)
  result.fill(0x20, 20 + encoded.byteLength, 20 + paddedLength)
  result.set(suffix, 20 + paddedLength)
  return result
}

describe('typegen runtime compatibility gate', () => {
  it('refuses required KHR_node_visibility before returning generated external-typegen output', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-runtime-typegen-'))
    owned.push(directory)
    const glbPath = join(directory, 'visibility.glb')
    const document = new Document()
    const buffer = document.createBuffer()
    const position = document.createAccessor('Position')
      .setType('VEC3')
      .setArray(new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ]))
      .setBuffer(buffer)
    const mesh = document.createMesh('Visible')
      .addPrimitive(document.createPrimitive().setAttribute('POSITION', position))
    document.createScene('Scene')
      .addChild(document.createNode('Visible Node').setMesh(mesh))
    const source = await new NodeIO().writeBinary(document)
    const bytes = mutateGlbJson(source, (json) => {
      json.extensionsUsed = ['KHR_node_visibility']
      json.extensionsRequired = ['KHR_node_visibility']
    })
    writeFileSync(glbPath, bytes)
    let generated: Awaited<ReturnType<typeof generateSceneModule>> | undefined

    await expect((async () => {
      generated = await generateSceneModule({
        glbPath,
        url: '/visibility.glb',
        exportName: 'visibility',
      })
    })()).rejects.toThrow(
      /runtime\.required-extension-unsupported.*KHR_node_visibility.*compatible runtime/s,
    )
    expect(generated).toBeUndefined()
  })

  it('refuses a material animation pointer before decoding the external GLB', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-runtime-typegen-'))
    owned.push(directory)
    const glbPath = join(directory, 'pointer.glb')
    const source = await new NodeIO().writeBinary(new Document())
    const bytes = mutateGlbJson(source, (json) => {
      json.extensionsUsed = ['KHR_animation_pointer']
      json.animations = [{
        samplers: [],
        channels: [{
          sampler: 0,
          target: {
            path: 'pointer',
            extensions: {
              KHR_animation_pointer: {
                pointer: '/materials/0/pbrMetallicRoughness/baseColorFactor',
              },
            },
          },
        }],
      }]
    })
    writeFileSync(glbPath, bytes)

    await expect(generateSceneModule({
      glbPath,
      url: '/pointer.glb',
      exportName: 'pointer',
    })).rejects.toThrow(
      /runtime\.animation-pointer-unsupported.*\/materials\/0\/pbrMetallicRoughness\/baseColorFactor/s,
    )
  })
})
