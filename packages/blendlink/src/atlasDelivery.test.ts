import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compileAtlasSidecarDelivery,
  convertEmbeddedBakedAtlasesToWebp,
  encodeExactLosslessWebp,
} from './atlasDelivery.js'

const owned: string[] = []

afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function fixturePng(): Promise<Uint8Array> {
  const width = 96
  const height = 64
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      pixels[offset] = x < 16 ? 31 : (x * 3) % 256
      pixels[offset + 1] = x < 16 ? 47 : (y * 5) % 256
      pixels[offset + 2] = x < 16 ? 63 : ((x + y) * 7) % 256
    }
  }
  return new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer())
}

function fixtureTiff(): Uint8Array {
  // Independent 1x1, uncompressed, little-endian TIFF fixture. Keeping the
  // bytes local proves the decoder policy without asking Sharp to create the
  // format that the public compiler boundary must refuse.
  const bytes = Buffer.alloc(123)
  bytes.write('II', 0)
  bytes.writeUInt16LE(42, 2)
  bytes.writeUInt32LE(8, 4)
  bytes.writeUInt16LE(9, 8)
  const entries = [
    [256, 3, 1, 1],
    [257, 3, 1, 1],
    [258, 3, 1, 8],
    [259, 3, 1, 1],
    [262, 3, 1, 1],
    [273, 4, 1, 122],
    [277, 3, 1, 1],
    [278, 4, 1, 1],
    [279, 4, 1, 1],
  ] as const
  entries.forEach(([tag, type, count, value], index) => {
    const offset = 10 + index * 12
    bytes.writeUInt16LE(tag, offset)
    bytes.writeUInt16LE(type, offset + 2)
    bytes.writeUInt32LE(count, offset + 4)
    if (type === 3) bytes.writeUInt16LE(value, offset + 8)
    else bytes.writeUInt32LE(value, offset + 8)
  })
  bytes.writeUInt32LE(0, 118)
  bytes[122] = 128
  return new Uint8Array(bytes)
}

describe('atlas delivery', () => {
  it('proves lossless WebP at decoded-channel level', async () => {
    const source = await fixturePng()
    const encoded = await encodeExactLosslessWebp(source)
    const original = await sharp(source).raw().toBuffer()
    const decoded = await sharp(encoded.bytes).raw().toBuffer()
    expect(decoded.equals(original)).toBe(true)
    expect(encoded.width).toBe(96)
    expect(encoded.height).toBe(64)
  })

  it('refuses vulnerable TIFF and GIF decoders at the public compiler image boundary', async () => {
    await expect(encodeExactLosslessWebp(fixtureTiff())).rejects.toThrow(
      /unsupported image format/i,
    )
    const gif = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      'base64',
    )
    await expect(encodeExactLosslessWebp(gif)).rejects.toThrow(
      /unsupported image format/i,
    )
  })

  it('publishes smaller sidecars while retaining the canonical PNG', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-atlas-delivery-'))
    owned.push(directory)
    const sourcePath = join(directory, 'hero.state.default.png')
    writeFileSync(sourcePath, await fixturePng())
    const result = await compileAtlasSidecarDelivery([sourcePath, sourcePath])
    const variant = result.variants.get(sourcePath)
    expect(variant?.format).toBe('webp')
    expect(variant?.bytes).toBeLessThan(readFileSync(sourcePath).byteLength)
    expect(result.report?.entries).toHaveLength(1)
    expect(readFileSync(sourcePath).subarray(1, 4).toString()).toBe('PNG')
  })

  it('converts only protected embedded baked PNGs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-atlas-glb-'))
    owned.push(directory)
    const glbPath = join(directory, 'scene.glb')
    const document = new Document()
    document.createBuffer()
    document.createTexture('BLENDLINK_BAKED_MAIN')
      .setURI('scene.state.default.png')
      .setMimeType('image/png')
      .setImage(await fixturePng())
    document.createTexture('Authored Detail')
      .setURI('detail.png')
      .setMimeType('image/png')
      .setImage(await fixturePng())
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    writeFileSync(glbPath, await io.writeBinary(document))

    const report = await convertEmbeddedBakedAtlasesToWebp(
      glbPath,
      [join(directory, 'scene.state.default.png')],
    )
    const decoded = await io.readBinary(new Uint8Array(readFileSync(glbPath)))
    const textures = decoded.getRoot().listTextures()
    expect(textures.find((texture) => texture.getName() === 'BLENDLINK_BAKED_MAIN')?.getMimeType())
      .toBe('image/webp')
    expect(textures.find((texture) => texture.getName() === 'Authored Detail')?.getMimeType())
      .toBe('image/png')
    expect(report?.entries).toHaveLength(1)
    expect(report?.entries[0]?.embedded).toBe(true)
  })
})
