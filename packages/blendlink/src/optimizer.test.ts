import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Accessor, Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { optimizeMeshopt, resizeTextures, verifySceneBounds } from './optimizer.js'
import { generateSceneModule, meshoptDecodedBytesFromGlb } from './typegen.js'

describe('Meshopt optimization stage', () => {
  it('writes a decodable extension and verifies primitive bounds', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const position = document.createAccessor('POSITION')
      .setType('VEC3')
      .setArray(new Float32Array([
        -1.25, 0, 0,
        1.25, 0, 0,
        0, 2.5, 0,
      ]))
      .setBuffer(buffer)
    const indices = document.createAccessor('indices')
      .setType('SCALAR')
      .setArray(new Uint16Array([0, 1, 2]))
      .setBuffer(buffer)
    const texcoords = new Float32Array([
      0.12345679, 0.2345679,
      0.50012213, 0.7654321,
      0.9876543, 0.3456789,
    ])
    const uv = document.createAccessor('TEXCOORD_0')
      .setType('VEC2').setArray(texcoords).setBuffer(buffer)
    const primitive = document.createPrimitive()
      .setAttribute('POSITION', position).setAttribute('TEXCOORD_0', uv).setIndices(indices)
    const mesh = document.createMesh('Triangle').addPrimitive(primitive)
    const node = document.createNode('Triangle').setMesh(mesh).setExtras({
      blendlink_cast_shadow: false,
    })
    document.createScene('Scene').addChild(node)

    const directory = mkdtempSync(join(tmpdir(), 'blendlink-meshopt-'))
    const path = join(directory, 'triangle.glb')
    try {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
      writeFileSync(path, await io.writeBinary(document))
      const report = await optimizeMeshopt(path)
      expect(report).toMatchObject({ geometry: 'meshopt' })
      expect(report.passes).toMatchObject({
        animationKeyframesRemoved: 0,
        weldedVertices: 0,
      })
      expect(report.passes.skipped).toContainEqual(expect.stringMatching(/Accessor de-duplication/))
      expect(report.maxBoundsError).toBeLessThan(0.001)
      expect(report.maxBoundsError).toBeLessThanOrEqual(report.boundsTolerance)

      await MeshoptDecoder.ready
      const decoded = await new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
        .read(path)
      const decodedPrimitive = decoded.getRoot().listMeshes()[0]?.listPrimitives()[0]
      expect(decoded.getRoot().listNodes()[0]?.getExtras()).toMatchObject({
        blendlink_cast_shadow: false,
      })
      expect(decodedPrimitive?.getAttribute('POSITION')?.getCount())
        .toBe(3)
      const decodedUv = decodedPrimitive?.getAttribute('TEXCOORD_0')
      expect(decodedUv?.getComponentType()).toBe(Accessor.ComponentType.FLOAT)
      const pairs = (values: ArrayLike<number>) => Array.from(
        { length: values.length / 2 },
        (_, index) => `${values[index * 2]},${values[index * 2 + 1]}`,
      ).sort()
      expect(pairs(decodedUv!.getArray()!)).toEqual(pairs(texcoords))

      // Generic typegen has no Blendlink optimization report to infer from.
      // Decoder intent must therefore come from the required GLB extension.
      const generated = await generateSceneModule({
        glbPath: path,
        url: '/external/triangle.glb',
        exportName: 'externalTriangle',
      })
      expect(generated.manifest.optimization).toBeUndefined()
      expect(generated.manifest.requiresMeshopt).toBe(true)
      expect(generated.manifest.nodes[0]?.extras).toMatchObject({
        blendlink_cast_shadow: false,
      })
      expect(generated.module).toContain('requiresMeshopt: true')
      const meshoptDecodedBytes = meshoptDecodedBytesFromGlb(readFileSync(path))
      expect(meshoptDecodedBytes).toBeGreaterThan(0)
      expect(generated.module).toContain(`meshoptDecodedBytes: ${meshoptDecodedBytes}`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('losslessly resamples animation, welds vertices, de-duplicates resources, and preserves authored contracts', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const positions = new Float32Array([
      -1, -1, 0,
      1, -1, 0,
      1, 1, 0,
      -1, -1, 0,
      1, 1, 0,
      -1, 1, 0,
    ])
    const texcoords = new Float32Array([
      0.12345679, 0.2345679,
      0.9876543, 0.2345679,
      0.9876543, 0.8765432,
      0.12345679, 0.2345679,
      0.9876543, 0.8765432,
      0.12345679, 0.8765432,
    ])
    const image = new Uint8Array(await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#6ca0dc' },
    }).png().toBuffer())
    const textureA = document.createTexture('SharedTexture').setImage(image).setMimeType('image/png')
    const textureB = document.createTexture('SharedTexture').setImage(image.slice()).setMimeType('image/png')
    document.createTexture('UnusedTexture').setImage(image.slice()).setMimeType('image/png')
    document.createTexture().setImage(image.slice()).setMimeType('image/png')
    const materialA = document.createMaterial('SharedMaterial').setBaseColorTexture(textureA)
    const materialB = document.createMaterial('SharedMaterial').setBaseColorTexture(textureB)
    document.createMaterial('UnusedMaterial')
    document.createMaterial()

    const mesh = document.createMesh('HeroMesh').setExtras({ blendlink_mesh_role: 'hero' })
    for (const [index, material] of [materialA, materialB].entries()) {
      const position = document.createAccessor(`position-${index}`)
        .setType('VEC3').setArray(positions.slice()).setBuffer(buffer)
      const uv = document.createAccessor(`atlas-uv-${index}`)
        .setType('VEC2').setArray(texcoords.slice()).setBuffer(buffer)
      mesh.addPrimitive(document.createPrimitive(`quad-${index}`)
        .setAttribute('POSITION', position)
        .setAttribute('TEXCOORD_0', uv)
        .setMaterial(material))
    }
    const node = document.createNode('HeroNode').setMesh(mesh).setExtras({
      blendlink_components: [{ type: 'bloom', intensity: 0.4 }],
      blendlink_probe: 'hero-probe',
    })
    document.createScene('HeroScene').setExtras({ blendlink_state: 'default' }).addChild(node)

    const times = document.createAccessor('authored-times')
      .setType('SCALAR')
      .setArray(new Float32Array([0, 1, 2]))
      .setBuffer(buffer)
      .setExtras({ blendlink_curve_role: 'time' })
    const values = document.createAccessor('authored-values')
      .setType('VEC3')
      .setArray(new Float32Array([
        0, 0, 0,
        1, 0, 0,
        2, 0, 0,
      ]))
      .setBuffer(buffer)
      .setExtras({ blendlink_curve_role: 'translation' })
    const sampler = document.createAnimationSampler('HeroMoveSampler')
      .setInput(times).setOutput(values).setInterpolation('LINEAR')
    const channel = document.createAnimationChannel('HeroMoveChannel')
      .setSampler(sampler).setTargetNode(node).setTargetPath('translation')
      .setExtras({ blendlink_channel: 'hero-move' })
    document.createAnimation('HeroMove').addSampler(sampler).addChannel(channel)
      .setExtras({ blendlink_clip: 'hero-move' })

    const directory = mkdtempSync(join(tmpdir(), 'blendlink-lossless-passes-'))
    const path = join(directory, 'passes.glb')
    try {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
      writeFileSync(path, await io.writeBinary(document))
      const report = await optimizeMeshopt(path)
      expect(report.passes).toMatchObject({
        animationKeyframesRemoved: 1,
        weldedVertices: 4,
        deduplicated: { materials: 1, textures: 1 },
        pruned: { materials: 1, textures: 1 },
      })

      await MeshoptDecoder.ready
      const decoded = await new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
        .read(path)
      expect(decoded.getRoot().listNodes().map((entry) => entry.getName())).toEqual(['HeroNode'])
      expect(decoded.getRoot().listNodes()[0]?.getExtras()).toEqual({
        blendlink_components: [{ type: 'bloom', intensity: 0.4 }],
        blendlink_probe: 'hero-probe',
      })
      expect(decoded.getRoot().listScenes()[0]?.getExtras()).toEqual({ blendlink_state: 'default' })
      expect(decoded.getRoot().listMaterials().map((entry) => entry.getName()).sort())
        .toEqual(['SharedMaterial', 'UnusedMaterial'])
      expect(decoded.getRoot().listTextures().map((entry) => entry.getName()).sort())
        .toEqual(['SharedTexture', 'UnusedTexture'])

      const decodedSampler = decoded.getRoot().listAnimations()[0]?.listSamplers()[0]
      expect(decodedSampler?.getInput()?.getName()).toBe('authored-times')
      expect(decodedSampler?.getOutput()?.getName()).toBe('authored-values')
      expect(decodedSampler?.getInput()?.getExtras()).toEqual({ blendlink_curve_role: 'time' })
      expect(decodedSampler?.getOutput()?.getExtras()).toEqual({ blendlink_curve_role: 'translation' })
      expect(Array.from(decodedSampler!.getInput()!.getArray()!)).toEqual([0, 2])
      expect(Array.from(decodedSampler!.getOutput()!.getArray()!)).toEqual([0, 0, 0, 2, 0, 0])

      for (const primitive of decoded.getRoot().listMeshes()[0]!.listPrimitives()) {
        expect(primitive.getAttribute('POSITION')?.getCount()).toBe(4)
        const uv = primitive.getAttribute('TEXCOORD_0')!
        expect(uv.getComponentType()).toBe(Accessor.ComponentType.FLOAT)
        const published = new Set(Array.from(uv.getArray()!).map(number => number.toString()))
        for (const value of texcoords) expect(published.has(value.toString())).toBe(true)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses a scale-significant world-bounds shift instead of merely reporting it', () => {
    expect(() => verifySceneBounds(
      [-1, -1, -1], [1, 1, 1],
      [-0.9, -1, -1], [1, 1, 1],
      'distorted fixture',
    )).toThrow(/above the scale-relative tolerance/)
  })

  it('does not let position quantization replace an authored mesh hierarchy with a correction node', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const position = document.createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([
        -2, 0, 0,
        2, 0, 0,
        0, 3, 0,
      ]))
      .setBuffer(buffer)
    const mesh = document.createMesh('ParentMesh').addPrimitive(
      document.createPrimitive().setAttribute('POSITION', position),
    )
    const anchor = document.createNode('AuthoredAnchor').setTranslation([0, 4, 0])
    const parent = document.createNode('MeshParent').setMesh(mesh).addChild(anchor)
    document.createScene('Scene').addChild(parent)

    const directory = mkdtempSync(join(tmpdir(), 'blendlink-hierarchy-'))
    const path = join(directory, 'hierarchy.glb')
    try {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
      writeFileSync(path, await io.writeBinary(document))
      const report = await optimizeMeshopt(path)
      expect(report.passes.skipped).toContainEqual(expect.stringMatching(/POSITION quantization/))

      await MeshoptDecoder.ready
      const decoded = await new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
        .read(path)
      expect(decoded.getRoot().listNodes().map((node) => node.getName()).sort())
        .toEqual(['AuthoredAnchor', 'MeshParent'])
      const decodedParent = decoded.getRoot().listNodes().find((node) => node.getName() === 'MeshParent')!
      expect(decodedParent.getMesh()?.getName()).toBe('ParentMesh')
      expect(decodedParent.listChildren().map((node) => node.getName())).toEqual(['AuthoredAnchor'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('enforces a named texture maximum without changing its semantic format', async () => {
    const document = new Document()
    document.createBuffer()
    const pixels = await sharp({
      create: { width: 64, height: 32, channels: 4, background: '#cc8844' },
    }).png().toBuffer()
    const texture = document.createTexture('Hero Poster')
      .setImage(new Uint8Array(pixels))
      .setMimeType('image/png')
    document.createMaterial('Poster').setBaseColorTexture(texture)
    document.createScene('Scene')
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-texture-'))
    const path = join(directory, 'texture.glb')
    try {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
      writeFileSync(path, await io.writeBinary(document))
      const result = await resizeTextures(path, [{ name: 'Hero Poster', maxSize: 16 }])
      expect(result.warnings).toEqual([])
      expect(result.transforms[0]).toMatchObject({
        originalWidth: 64,
        originalHeight: 32,
        publishedWidth: 16,
        publishedHeight: 8,
        maxSize: 16,
      })
      const resized = await io.read(path)
      const image = resized.getRoot().listTextures()[0]?.getImage()
      expect(image).not.toBeNull()
      expect((await sharp(image!).metadata())).toMatchObject({ width: 16, height: 8, format: 'png' })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('merges byte-identical generated channel textures and leaves authored names alone', async () => {
    const document = new Document()
    document.createBuffer()
    const black = new Uint8Array(await sharp({
      create: { width: 32, height: 32, channels: 4, background: '#000000' },
    }).png().toBuffer())
    // Three generated emissives sharing one payload, plus an authored texture
    // with the SAME bytes. The authored one must survive with its name: that is
    // the boundary the naming policy protects.
    const first = document.createTexture('channel-87afa5b3b6f6-emissive')
      .setImage(black).setMimeType('image/png')
    const second = document.createTexture('channel-64c5753ebd93-emissive')
      .setImage(new Uint8Array(black)).setMimeType('image/png')
    const third = document.createTexture('channel-ab42803a50ad-emissive')
      .setImage(new Uint8Array(black)).setMimeType('image/png')
    const authored = document.createTexture('Hero Poster')
      .setImage(new Uint8Array(black)).setMimeType('image/png')
    // A generated texture whose bytes differ must not be swept up either.
    const distinct = document.createTexture('channel-b98feac9d562-emissive')
      .setImage(new Uint8Array(await sharp({
        create: { width: 32, height: 32, channels: 4, background: '#010203' },
      }).png().toBuffer()))
      .setMimeType('image/png')

    const materials = [first, second, third, authored, distinct].map((texture, index) =>
      document.createMaterial(`M${index}`).setEmissiveTexture(texture))
    // Distinct samplers on two of the merged slots: sampler state lives on
    // TextureInfo, so merging must not disturb it.
    materials[0]!.getEmissiveTextureInfo()!.setWrapS(33071)
    materials[1]!.getEmissiveTextureInfo()!.setWrapS(10497)

    // Real geometry so the bounds verification has something finite to check,
    // and so each material is actually reachable from the scene.
    const buffer = document.getRoot().listBuffers()[0]!
    const scene = document.createScene('Scene')
    materials.forEach((material, index) => {
      const position = document.createAccessor(`P${index}`)
        .setType('VEC3')
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .setBuffer(buffer)
      const primitive = document.createPrimitive()
        .setAttribute('POSITION', position)
        .setMaterial(material)
      const mesh = document.createMesh(`Mesh${index}`).addPrimitive(primitive)
      scene.addChild(document.createNode(`Node${index}`).setMesh(mesh))
    })

    const directory = mkdtempSync(join(tmpdir(), 'blendlink-merge-'))
    const path = join(directory, 'merge.glb')
    try {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
      writeFileSync(path, await io.writeBinary(document))
      const report = await optimizeMeshopt(path)

      expect(report.passes.mergedGeneratedTextures).toMatchObject({
        textures: 2,
        merges: [{
          kept: 'channel-64c5753ebd93-emissive',
          dropped: ['channel-87afa5b3b6f6-emissive', 'channel-ab42803a50ad-emissive'],
        }],
      })
      // 32*32*4*4/3 per dropped texture.
      expect(report.passes.mergedGeneratedTextures.gpuBytesReclaimed)
        .toBe(2 * Math.round(32 * 32 * 4 * (4 / 3)))

      await MeshoptDecoder.ready
      const merged = await new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
        .read(path)
      const names = merged.getRoot().listTextures().map((texture) => texture.getName()).sort()
      expect(names).toEqual([
        'Hero Poster',
        'channel-64c5753ebd93-emissive',
        'channel-b98feac9d562-emissive',
      ])
      // Every material still resolves an emissive texture, and the three that
      // shared a payload now point at one image.
      const emissives = merged.getRoot().listMaterials()
        .map((material) => material.getEmissiveTexture())
      expect(emissives.every(Boolean)).toBe(true)
      expect(new Set(emissives.slice(0, 3)).size).toBe(1)
      // Per-slot sampler state survived the swap.
      expect(merged.getRoot().listMaterials()
        .map((material) => material.getEmissiveTextureInfo()?.getWrapS())
        .slice(0, 2)).toEqual([33071, 10497])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
