import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from '@gltf-transform/extensions'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { MaterialCompilationEvidence } from './sceneDiagnostics.js'
import {
  chooseTextureCodec,
  compressTexturesKtx2,
  ktxCreateDialect,
  textureCompressionCandidateLadder,
  textureEncodingDimensions,
} from './textureCompression.js'

describe('semantic texture compression policy', () => {
  it('keeps smooth opaque color compact by default', () => {
    expect(chooseTextureCodec(['baseColorTexture'], false, undefined, true)).toEqual({
      codec: 'etc1s',
      reason: 'opaque color texture uses Compact automatically',
    })
  })

  it('protects normal, packed data, and alpha with UASTC', () => {
    expect(chooseTextureCodec(['normalTexture'], false, undefined, true)?.codec).toBe('uastc')
    expect(chooseTextureCodec(['metallicRoughnessTexture'], false, undefined, true)?.codec).toBe('uastc')
    expect(chooseTextureCodec(['baseColorTexture'], true, undefined, true)?.codec).toBe('uastc')
  })

  it('gives artist overrides precedence over scene defaults', () => {
    expect(chooseTextureCodec(['normalTexture'], false, 'etc1s', true)?.codec).toBe('etc1s')
    expect(chooseTextureCodec(['baseColorTexture'], false, 'uastc', false)?.codec).toBe('uastc')
    expect(chooseTextureCodec(['baseColorTexture'], false, 'none', true)).toBeNull()
    expect(chooseTextureCodec(['baseColorTexture'], false, undefined, false)).toBeNull()
  })

  it('does not publish unused images just because scene compression is on', () => {
    expect(chooseTextureCodec([], false, undefined, true)).toBeNull()
  })

  it('uses a small deterministic ETC1S quality/codebook ladder', () => {
    expect(textureCompressionCandidateLadder('etc1s', ['baseColorTexture'], false)).toEqual([
      {
        id: 'etc1s-q96',
        codec: 'etc1s',
        settings: { semanticProfile: 'color', qlevel: 96, clevel: 2 },
      },
      {
        id: 'etc1s-q160',
        codec: 'etc1s',
        settings: { semanticProfile: 'color', qlevel: 160, clevel: 2 },
      },
      {
        id: 'etc1s-q224',
        codec: 'etc1s',
        settings: { semanticProfile: 'color', qlevel: 224, clevel: 2 },
      },
    ])
  })

  it('tunes the UASTC RDO ladder to normal, packed-data, alpha, and color semantics', () => {
    const lambdas = (slots: string[], alpha: boolean) =>
      textureCompressionCandidateLadder('uastc', slots, alpha)
        .map((candidate) => candidate.settings.uastcRdoLambda)
    expect(lambdas(['normalTexture'], false)).toEqual([0.75, 0.5, 0.25])
    expect(lambdas(['metallicRoughnessTexture'], false)).toEqual([1, 0.625, 0.25])
    expect(lambdas(['baseColorTexture'], true)).toEqual([1.25, 0.75, 0.35])
    expect(lambdas(['baseColorTexture'], false)).toEqual([2, 1, 0.5])
    expect(textureCompressionCandidateLadder('uastc', ['normalTexture'], true)
      .every((candidate) => candidate.settings.semanticProfile === 'normal')).toBe(true)
  })

  it('keeps conforming dimensions exact and refuses lossy resizing for non-block-aligned sources', () => {
    expect(textureEncodingDimensions(4, 8)).toEqual({ width: 4, height: 8 })
    expect(textureEncodingDimensions(68, 64)).toEqual({ width: 68, height: 64 })
    expect(() => textureEncodingDimensions(5, 7)).toThrow(/multiples of 4/)
    expect(() => textureEncodingDimensions(67, 61)).toThrow(/multiples of 4/)
    expect(() => textureEncodingDimensions(0, 7)).toThrow(/positive integers/)
  })

  it('leaves an odd-sized candidate byte-for-byte uncompressed and warns without invoking KTX', async () => {
    const document = new Document()
    document.createBuffer()
    const oddImage = await sharp({
      create: { width: 5, height: 7, channels: 3, background: '#cc8844' },
    }).png().toBuffer()
    const oddTexture = document.createTexture('Odd Color').setImage(oddImage).setMimeType('image/png')
    document.createMaterial('Odd Material').setBaseColorTexture(oddTexture)
    document.createScene('Scene')

    const directory = mkdtempSync(join(tmpdir(), 'blendlink-ktx-odd-'))
    const path = join(directory, 'scene.glb')
    try {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
      writeFileSync(path, await io.writeBinary(document))
      const originalGlb = readFileSync(path)

      const result = await compressTexturesKtx2(path, {
        sceneKtx2: true,
        executable: join(directory, 'ktx-must-not-run'),
      })

      expect(result.report).toBeNull()
      expect(result.warnings).toEqual([
        'Texture "Odd Color" kept the original 5x7 image because ' +
          'KHR_texture_basisu requires both dimensions to be multiples of 4.',
      ])
      expect(readFileSync(path)).toEqual(originalGlb)

      const published = await io.read(path)
      const [publishedTexture] = published.getRoot().listTextures()
      expect(publishedTexture.getMimeType()).toBe('image/png')
      expect(Buffer.from(publishedTexture.getImage() ?? [])).toEqual(oddImage)
      await expect(sharp(publishedTexture.getImage()).metadata()).resolves.toMatchObject({
        width: 5,
        height: 7,
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps an exactly attested selected-field image byte-for-byte PNG under scene KTX2', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const positions = document.createAccessor('positions')
      .setType('VEC3')
      .setArray(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]))
      .setBuffer(buffer)
    const uvValues: Array<[number, number]> = [[0, 0], [1, 0], [0.5, 1]]
    const uvs = document.createAccessor('selected field UV')
      .setType('VEC2')
      .setArray(new Float32Array(uvValues.flat()))
      .setBuffer(buffer)
    const image = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#5a84c2' },
    }).png().toBuffer()
    const texture = document.createTexture('selected-compiler-attested')
      .setImage(image)
      .setMimeType('image/png')
    const material = document.createMaterial('BLENDLINK_WEB.IMAGE.Attested')
      .setBaseColorTexture(texture)
    material.setExtension(
      'KHR_materials_unlit',
      document.createExtension(KHRMaterialsUnlit).createUnlit(),
    )
    material.getBaseColorTextureInfo()!
      .setTexCoord(0)
      .setMagFilter(9729)
      .setMinFilter(9987)
      .setWrapS(10497)
      .setWrapT(10497)
    const mesh = document.createMesh('Attested Mesh').addPrimitive(
      document.createPrimitive()
        .setAttribute('POSITION', positions)
        .setAttribute('TEXCOORD_0', uvs)
        .setMaterial(material),
    )
    document.createScene('Scene').addChild(
      document.createNode('Attested Object').setMesh(mesh),
    )
    const uvBytes = Buffer.alloc(uvValues.length * 8)
    ;[...uvValues]
      .sort((left, right) => left[0] - right[0] || left[1] - right[1])
      .forEach((value, index) => {
        uvBytes.writeFloatLE(value[0], index * 8)
        uvBytes.writeFloatLE(value[1], index * 8 + 4)
      })
    const materialCompilation: MaterialCompilationEvidence = {
      schemaVersion: 1,
      sourceFingerprint: 'selected-field-ktx2-differential',
      loweredMaterials: ['Attested Source'],
      generatedMaterials: ['BLENDLINK_WEB.IMAGE.Attested'],
      gltfEvidence: [{
        sourceMaterial: 'Attested Source',
        generatedMaterial: 'BLENDLINK_WEB.IMAGE.Attested',
        transport: 'image',
        unlit: true,
        primitiveCount: 1,
        color0: false,
        imageSha256: createHash('sha256').update(image).digest('hex'),
        imageMime: 'image/png',
        imageWidth: 4,
        imageHeight: 4,
        sampler: { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
        texCoord: 0,
        uvHash: createHash('sha256').update(uvBytes).digest('hex'),
        uvDistinctValues: 3,
        uvMin: [0, 0],
        uvMax: [1, 1],
        alphaMode: 'OPAQUE',
        baseColorFactor: [1, 1, 1, 1],
        doubleSided: false,
        bindings: ['Attested Object[0]'],
      }],
    }

    const directory = mkdtempSync(join(tmpdir(), 'blendlink-ktx-attested-'))
    const path = join(directory, 'scene.glb')
    try {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
      writeFileSync(path, await io.writeBinary(document))
      const originalGlb = readFileSync(path)

      const result = await compressTexturesKtx2(path, {
        sceneKtx2: true,
        materialCompilation,
        executable: join(directory, 'ktx-must-not-run'),
      })

      expect(result).toEqual({
        report: null,
        warnings: [
          'Texture "selected-compiler-attested" remains image/png because selected-field compiler ' +
            'attestation requires its exact original image bytes and MIME; scene-wide GPU compression ' +
            'intentionally excludes this compiler-owned carrier.',
        ],
      })
      expect(readFileSync(path)).toEqual(originalGlb)
      const published = await io.read(path)
      const [publishedTexture] = published.getRoot().listTextures()
      expect(publishedTexture.getMimeType()).toBe('image/png')
      expect(Buffer.from(publishedTexture.getImage() ?? [])).toEqual(image)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('supports both stable KTX create flag dialects without inventing orientation metadata', () => {
    expect(ktxCreateDialect('  --assign-oetf <oetf>\n')).toEqual({
      transferOption: '--assign-oetf',
      assignTexcoordOrigin: false,
      normalize: false,
    })
    expect(ktxCreateDialect(
      '  --assign-tf <tf>\n  --assign-texcoord-origin <origin>\n  --normalize\n',
    )).toEqual({
      transferOption: '--assign-tf',
      assignTexcoordOrigin: true,
      normalize: true,
    })
    expect(() => ktxCreateDialect('unrelated help')).toThrow(/neither/)
  })

  const realKtxTest = process.env.BLENDLINK_KTX_PATH ? it : it.skip
  realKtxTest('encodes, validates, decodes, measures, and protects baked atlases with Khronos KTX', async () => {
    const document = new Document()
    document.createBuffer()
    const color = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#cc8844' },
    }).png().toBuffer()
    const normal = await sharp({
      create: { width: 68, height: 64, channels: 3, background: { r: 128, g: 128, b: 255 } },
    }).png().toBuffer()
    const baked = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#776655' },
    }).png().toBuffer()
    const alphaPixels = Buffer.alloc(12 * 8 * 4)
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 12; x += 1) {
      const offset = (y * 12 + x) * 4
      alphaPixels[offset] = 80
      alphaPixels[offset + 1] = 180
      alphaPixels[offset + 2] = 100
      alphaPixels[offset + 3] = x < 6 ? 255 : 0
    }
    const alpha = await sharp(alphaPixels, {
      raw: { width: 12, height: 8, channels: 4 },
    }).png().toBuffer()
    const colorTexture = document.createTexture('Hero Color').setImage(color).setMimeType('image/png')
    const normalTexture = document.createTexture('Hero Normal').setImage(normal).setMimeType('image/png')
    const bakedTexture = document.createTexture('hero.glb.state.default.png').setImage(baked).setMimeType('image/png')
    const alphaTexture = document.createTexture('Leaf Alpha').setImage(alpha).setMimeType('image/png')
    document.createMaterial('Hero')
      .setBaseColorTexture(colorTexture)
      .setNormalTexture(normalTexture)
      .setEmissiveTexture(bakedTexture)
    document.createMaterial('Leaves').setBaseColorTexture(alphaTexture).setAlphaMode('MASK')
    document.createScene('Scene')
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-ktx-integration-'))
    const path = join(directory, 'scene.glb')
    try {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
      writeFileSync(path, await io.writeBinary(document))
      const result = await compressTexturesKtx2(path, {
        sceneKtx2: true,
        protectedTextureNames: ['hero.glb.state.default.png'],
        executable: process.env.BLENDLINK_KTX_PATH,
      })
      expect(result.report?.textures.map((entry) => [entry.name, entry.codec])).toEqual([
        ['Hero Color', 'etc1s'],
        ['Hero Normal', 'uastc'],
        ['Leaf Alpha', 'uastc'],
      ])
      expect(result.report?.textures.every((entry) => entry.psnr >= 35)).toBe(true)
      expect(result.report?.textures.map((entry) => [entry.encodedWidth, entry.encodedHeight])).toEqual([
        [64, 64], [68, 64], [12, 8],
      ])
      expect(result.report?.textures.every((entry) => entry.mipLevelsVerified > 1)).toBe(true)
      expect(result.report?.textures.every((entry) => {
        const attempts = entry.rateDistortion?.candidates ?? []
        const selected = attempts.find((attempt) => attempt.status === 'selected')
        const passingSizes = attempts
          .filter((attempt) => attempt.status !== 'rejected')
          .map((attempt) => attempt.outputBytes ?? Number.POSITIVE_INFINITY)
        return attempts.length === 3
          && attempts.filter((attempt) => attempt.status === 'selected').length === 1
          && attempts.some((attempt) => attempt.id === entry.rateDistortion?.selectedCandidate)
          && selected?.outputBytes === Math.min(...passingSizes)
          && attempts.filter((attempt) => attempt.status !== 'rejected')
            .every((attempt) => attempt.psnr !== undefined && attempt.worstMipPsnr !== undefined)
      })).toBe(true)
      expect(result.report?.skipped).toContainEqual({
        name: 'hero.glb.state.default.png',
        reason: 'baked lighting atlas keeps its constant-background PNG contract',
      })
      const published = await io.read(path)
      expect(published.getRoot().listTextures().map((texture) => texture.getMimeType())).toEqual([
        'image/ktx2', 'image/ktx2', 'image/png', 'image/ktx2',
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
