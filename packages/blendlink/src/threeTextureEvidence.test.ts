import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { collectThreeTextureEvidence } from './threeTextureEvidence.js'

function textureMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map: texture })
}

describe('Three runtime texture evidence', () => {
  it('deduplicates shared textures and discovers standard slots plus nested shader uniforms', () => {
    const shared = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4)
    shared.name = 'Shared detail'
    shared.generateMipmaps = false
    const standard = new THREE.MeshStandardMaterial({ map: shared, normalMap: shared })
    const shader = new THREE.ShaderMaterial({
      uniforms: {
        sharedMap: new THREE.Uniform(shared),
        nested: { value: { layers: [shared] } },
      },
    })
    const scene = new THREE.Scene()
    scene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(), standard),
      new THREE.Mesh(new THREE.PlaneGeometry(), shader),
      new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(shared)),
    )

    const report = collectThreeTextureEvidence(scene)

    expect(report.textures).toHaveLength(1)
    expect(report.textures[0]).toMatchObject({
      name: 'Shared detail',
      roles: [
        'material.map',
        'material.normalMap',
        'material.uniforms.nested.value.layers[0]',
        'material.uniforms.sharedMap.value',
      ],
      dimensions: { width: 4, height: 4, depth: 1, faces: 1 },
      colorSpace: THREE.NoColorSpace,
      type: THREE.UnsignedByteType,
      formatName: 'RGBAFormat',
      format: THREE.RGBAFormat,
      typeName: 'UnsignedByteType',
      internalFormat: null,
      targetFamily: 'RGBA',
      compressed: false,
      resident: { knownBytes: 64, totalBytes: 64, complete: true },
    })
    expect(report.summary).toMatchObject({
      textureCount: 1,
      webglAllocationCount: 1,
      knownResidentTextureCount: 1,
      unknownResidentTextureCount: 0,
      knownResidentAllocationCount: 1,
      unknownResidentAllocationCount: 0,
      knownResidentBytes: 64,
      unknownResidentBytes: 0,
      totalEstimatedResidentBytes: 64,
      formatCounts: { RGBAFormat: 1 },
    })
  })

  it('sizes explicit and renderer-generated uncompressed mip chains', () => {
    const explicit = new THREE.DataTexture(new Uint8Array(4 * 2 * 4), 4, 2)
    explicit.name = 'Explicit mips'
    explicit.generateMipmaps = false
    explicit.mipmaps = [
      { data: new Uint8Array(4 * 2 * 4), width: 4, height: 2 },
      { data: new Uint8Array(2 * 1 * 4), width: 2, height: 1 },
      { data: new Uint8Array(1 * 1 * 4), width: 1, height: 1 },
    ]
    const generated = new THREE.DataTexture(new Uint8Array(4 * 2 * 4), 4, 2)
    generated.name = 'Generated mips'
    generated.generateMipmaps = true
    const scene = new THREE.Scene()
    scene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(explicit)),
      new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(generated)),
    )

    const report = collectThreeTextureEvidence(scene)
    const byName = Object.fromEntries(report.textures.map((texture) => [texture.name, texture]))

    expect(byName['Explicit mips']).toMatchObject({
      mipSource: 'explicit',
      mipCount: 3,
      resident: { knownBytes: 44, totalBytes: 44, complete: true },
    })
    expect(byName['Explicit mips']!.mips.map((mip) =>
      [mip.width, mip.height, mip.estimatedResidentBytes])).toEqual([
      [4, 2, 32],
      [2, 1, 8],
      [1, 1, 4],
    ])
    expect(byName['Generated mips']).toMatchObject({
      mipSource: 'generated',
      mipCount: 3,
      resident: { knownBytes: 44, totalBytes: 44, complete: true },
    })
    expect(report.summary.knownResidentBytes).toBe(88)
  })

  it('identifies and sizes representative ASTC, BC7, and ETC2 targets', () => {
    const astc = new THREE.CompressedTexture([
      { data: new Uint8Array(64), width: 8, height: 8 },
      { data: new Uint8Array(16), width: 4, height: 4 },
      { data: new Uint8Array(16), width: 2, height: 2 },
      { data: new Uint8Array(16), width: 1, height: 1 },
    ], 8, 8, THREE.RGBA_ASTC_4x4_Format)
    astc.name = 'ASTC'
    const bc7 = new THREE.CompressedTexture([
      { data: new Uint8Array(64), width: 8, height: 8 },
    ], 8, 8, THREE.RGBA_BPTC_Format)
    bc7.name = 'BC7'
    const etc2 = new THREE.CompressedTexture([
      { data: new Uint8Array(32), width: 8, height: 8 },
    ], 8, 8, THREE.RGB_ETC2_Format)
    etc2.name = 'ETC2'
    const scene = new THREE.Scene()
    for (const texture of [astc, bc7, etc2]) {
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(texture)))
    }

    const report = collectThreeTextureEvidence(scene)
    const byName = Object.fromEntries(report.textures.map((texture) => [texture.name, texture]))

    expect(byName.ASTC).toMatchObject({
      targetFamily: 'ASTC', targetLabel: 'RGBA_ASTC_4x4_Format', compressed: true,
      resident: { knownBytes: 112, totalBytes: 112, complete: true },
    })
    expect(byName.BC7).toMatchObject({
      targetFamily: 'BC7', targetLabel: 'RGBA_BPTC_Format', compressed: true,
      resident: { knownBytes: 64, totalBytes: 64, complete: true },
    })
    expect(byName.ETC2).toMatchObject({
      targetFamily: 'ETC2', targetLabel: 'RGB_ETC2_Format', compressed: true,
      resident: { knownBytes: 32, totalBytes: 32, complete: true },
    })
    expect(report.summary.formats).toEqual([
      {
        targetFamily: 'ASTC', textureCount: 1, webglAllocationCount: 1,
        knownResidentBytes: 112, unknownResidentTextureCount: 0,
        unknownResidentAllocationCount: 0,
      },
      {
        targetFamily: 'BC7', textureCount: 1, webglAllocationCount: 1,
        knownResidentBytes: 64, unknownResidentTextureCount: 0,
        unknownResidentAllocationCount: 0,
      },
      {
        targetFamily: 'ETC2', textureCount: 1, webglAllocationCount: 1,
        knownResidentBytes: 32, unknownResidentTextureCount: 0,
        unknownResidentAllocationCount: 0,
      },
    ])
  })

  it('keeps missing dimensions and resident bytes explicitly unknown', () => {
    const missing = new THREE.Texture()
    missing.name = 'Not loaded'
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(missing)))

    const report = collectThreeTextureEvidence(scene)

    expect(report.textures[0]).toMatchObject({
      dimensions: { width: null, height: null, depth: 1, faces: 1 },
      mipSource: 'unknown',
      resident: {
        knownBytes: 0,
        totalBytes: null,
        complete: false,
        unknownMipCount: 1,
      },
    })
    expect(report.textures[0]!.unknowns).toContain('texture dimensions are unavailable')
    expect(report.summary).toMatchObject({
      knownResidentBytes: 0,
      unknownResidentTextureCount: 1,
      unknownResidentBytes: null,
      totalEstimatedResidentBytes: null,
    })
  })

  it('does not fall back to an external format when an internal format override is unknown', () => {
    const texture = new THREE.DataTexture(new Uint8Array(2 * 2 * 4), 2, 2)
    texture.generateMipmaps = false
    texture.internalFormat = 'VENDOR_PRIVATE_RGBA'
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(texture)))

    const report = collectThreeTextureEvidence(scene)

    expect(report.textures[0]).toMatchObject({
      formatName: 'RGBAFormat',
      internalFormat: 'VENDOR_PRIVATE_RGBA',
      targetFamily: 'unknown',
      targetLabel: null,
      compressed: null,
      resident: { knownBytes: 0, totalBytes: null, complete: false },
    })
    expect(report.textures[0]!.unknowns).toContain(
      'unrecognized internalFormat VENDOR_PRIVATE_RGBA',
    )
  })

  it('includes and deduplicates scene background and environment textures', () => {
    const shared = new THREE.DataTexture(new Uint8Array(2 * 2 * 4), 2, 2)
    shared.name = 'World texture'
    shared.generateMipmaps = false
    const scene = new THREE.Scene()
    scene.background = shared
    scene.environment = shared

    const report = collectThreeTextureEvidence(scene)

    expect(report.textures).toHaveLength(1)
    expect(report.textures[0]).toMatchObject({
      roles: ['scene.background', 'scene.environment'],
      resident: { knownBytes: 16, totalBytes: 16, complete: true },
    })
  })

  it('counts Texture clones sharing a Three Source/cache key as one WebGL allocation', () => {
    const original = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4)
    original.name = 'Original'
    original.generateMipmaps = false
    const clone = original.clone()
    clone.name = 'Clone'
    const scene = new THREE.Scene()
    scene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(original)),
      new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(clone)),
    )

    const report = collectThreeTextureEvidence(scene)

    expect(report.textures).toHaveLength(2)
    expect(report.webglAllocations).toHaveLength(1)
    expect(new Set(report.textures.map((texture) => texture.webglAllocationId)).size).toBe(1)
    expect(report.webglAllocations[0]).toMatchObject({
      textureCount: 2,
      textureNames: ['Original', 'Clone'],
      resident: { knownBytes: 64, totalBytes: 64, complete: true },
    })
    expect(report.summary).toMatchObject({
      textureCount: 2,
      webglAllocationCount: 1,
      knownResidentBytes: 64,
      totalEstimatedResidentBytes: 64,
    })
  })

  it('includes the base level and nested faces for manual uncompressed cube mips', () => {
    const face = (size: number) => new THREE.DataTexture(
      new Uint8Array(size * size * 4), size, size,
    )
    const cube = new THREE.CubeTexture(Array.from({ length: 6 }, () => face(4)))
    cube.name = 'Manual cube'
    cube.generateMipmaps = false
    cube.mipmaps = [{ image: Array.from({ length: 6 }, () => face(2)) }] as THREE.Texture['mipmaps']
    const scene = new THREE.Scene()
    scene.background = cube

    const evidence = collectThreeTextureEvidence(scene).textures[0]!

    expect(evidence).toMatchObject({
      dimensions: { width: 4, height: 4, depth: 1, faces: 6 },
      mipSource: 'explicit',
      mipCount: 2,
      resident: { knownBytes: 480, totalBytes: 480, complete: true },
    })
    expect(evidence.mips.map((mip) => [mip.width, mip.height, mip.estimatedResidentBytes]))
      .toEqual([[4, 4, 384], [2, 2, 96]])
  })

  it('sizes immutable DataArray and Data3D explicit mip allocations from their base image', () => {
    const array = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 3 * 4), 4, 4, 3)
    array.name = 'Array'
    array.format = THREE.RGBAFormat
    array.mipmaps = [{}, {}, {}] as THREE.Texture['mipmaps']
    const volume = new THREE.Data3DTexture(new Uint8Array(4 * 4 * 4 * 4), 4, 4, 4)
    volume.name = 'Volume'
    volume.format = THREE.RGBAFormat
    volume.mipmaps = [{}, {}, {}] as THREE.Texture['mipmaps']
    const scene = new THREE.Scene()
    scene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(array)),
      new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(volume)),
    )

    const report = collectThreeTextureEvidence(scene)
    const byName = Object.fromEntries(report.textures.map((texture) => [texture.name, texture]))

    expect(byName.Array).toMatchObject({
      mipSource: 'explicit', mipCount: 3,
      resident: { knownBytes: 252, totalBytes: 252, complete: true },
    })
    expect(byName.Array!.mips.map((mip) => [mip.width, mip.height, mip.depth]))
      .toEqual([[4, 4, 3], [2, 2, 3], [1, 1, 3]])
    expect(byName.Volume).toMatchObject({
      mipSource: 'explicit', mipCount: 3,
      resident: { knownBytes: 292, totalBytes: 292, complete: true },
    })
    expect(byName.Volume!.mips.map((mip) => [mip.width, mip.height, mip.depth]))
      .toEqual([[4, 4, 4], [2, 2, 2], [1, 1, 1]])
  })

  it('accounts for FramebufferTexture mip allocation and Three depth-stencil coercion', () => {
    const framebuffer = new THREE.FramebufferTexture(8, 4)
    framebuffer.name = 'Framebuffer'
    framebuffer.generateMipmaps = false
    framebuffer.minFilter = THREE.LinearMipmapLinearFilter
    const depthStencil = new THREE.DepthTexture(2, 2, THREE.UnsignedShortType)
    depthStencil.format = THREE.DepthStencilFormat
    depthStencil.name = 'Depth stencil'
    depthStencil.generateMipmaps = false
    const scene = new THREE.Scene()
    scene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(framebuffer)),
      new THREE.Mesh(new THREE.PlaneGeometry(), textureMaterial(depthStencil)),
    )

    const report = collectThreeTextureEvidence(scene)
    const byName = Object.fromEntries(report.textures.map((texture) => [texture.name, texture]))

    expect(byName.Framebuffer).toMatchObject({
      mipSource: 'generated', mipCount: 4,
      resident: { knownBytes: 172, totalBytes: 172, complete: true },
    })
    expect(byName['Depth stencil']).toMatchObject({
      targetFamily: 'depth',
      resident: { knownBytes: 16, totalBytes: 16, complete: true },
    })
  })

  it('discovers deeply nested uniforms without silently truncating normal object graphs', () => {
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1)
    texture.generateMipmaps = false
    let nested: unknown = texture
    for (let index = 0; index < 16; index += 1) nested = { next: nested }
    const shader = new THREE.ShaderMaterial({ uniforms: { deep: { value: nested } } })
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), shader))

    const report = collectThreeTextureEvidence(scene)

    expect(report.textures).toHaveLength(1)
    expect(report.discovery).toEqual({ complete: true, warnings: [] })
  })
})
