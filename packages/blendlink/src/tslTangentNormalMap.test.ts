import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  Mesh,
  MeshStandardMaterial,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import { createHash } from 'node:crypto'
import { Document, NodeIO } from '@gltf-transform/core'
import sharp from 'sharp'
import { auditCompiledSceneArtifact } from './compiledSceneAudit.js'
import type { SceneManifest } from './typegen.js'
import { expect, it } from 'vitest'
import { normalInputBounds, normalMapCoefficientBounds } from './tslNormalInputBounds.js'
import { validateTangentNormalMapBinding } from './tslTangentNormalMap.js'
import type { TslIrExpression } from './tslNodeRecipe.js'

const scalar = (value: number): TslIrExpression => ({ op: 'const_float', value })
const vector = (...value: number[]): TslIrExpression => ({ op: 'const_vec3', value })
const extras = {
  schemaVersion: 1,
  objectSpace: 'blender-z-up',
  geometryContext: ['normal'],
  uvChannels: { RenderUV: 0 },
  tangentFrame: { schemaVersion: 1, model: 'blender-mikk-uv-v1', uvMap: 'RenderUV' },
}
function expression(): TslIrExpression {
  return {
    op: 'normal_map_tangent_native',
    model: 'eevee-mikk-normal-v1',
    sourceEngine: 'EEVEE',
    convention: 'OPENGL',
    base: 'ORIGINAL',
    color: vector(0.8, 0.6, 0.9),
    strength: scalar(1),
    frame: {
      op: 'tangent_native',
      model: 'primary-mikk-tangent-v1',
      sourceEngine: 'EEVEE',
      frameSource: 'blender-mikk-uv-v1',
      tangentStorage: 'SNORM10',
      uvMap: 'RenderUV',
      normal: {
        op: 'geometry_context',
        output: 'normal',
        sourceEngine: 'EEVEE',
        model: 'primary-triangles-v1',
        normalStorage: 'SNORM10',
      },
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
function ref(): TslIrExpression {
  return {
    op: 'texture_ref',
    sourceEngine: 'EEVEE',
    image: { name: 'NormalData', width: 2, height: 1, colorSpace: 'Non-Color' },
    ref: { image: 'NormalData', interpolation: 'Linear', extension: 'REPEAT' },
  }
}

it('proves native raw negative strength and saturates only its Z interpolation domain', () => {
  for (const value of [-2, -1, 0, 0.25, 0.5, 1, 2, 4])
    expect(
      normalMapCoefficientBounds(vector(0.8, 0.6, 0.9), scalar(value), 'OPENGL', {}).minimum,
    ).toBeGreaterThan(0)
  expect(() => normalMapCoefficientBounds(vector(0.5, 0.5, 0.5), scalar(1), 'OPENGL', {})).toThrow(
    /nonzero/,
  )
  expect(
    normalMapCoefficientBounds(vector(0.5, 0.5, 0.5), scalar(0.5), 'OPENGL', {}).minimum,
  ).toBeGreaterThan(0.49)
})

it('derives external image bounds from actual decoded pixels and invalidates mutable data revisions', () => {
  const bytes = new Uint8Array([128, 128, 255, 255, 127, 129, 204, 255]),
    texture = new DataTexture(bytes, 2, 1, RGBAFormat, UnsignedByteType),
    ir = ref(),
    options = { textures: () => texture }
  expect(normalInputBounds(ir, options)[2][0]).toBeCloseTo(0.8)
  bytes[3] = 0
  texture.needsUpdate = true
  expect(() => normalInputBounds(ir, options)).toThrow(/opaque/)
  ir.output = 'alpha'
  expect(normalInputBounds(ir, options)[0]).toEqual([0, 1])
  ;(ir.image as Record<string, unknown>).width = 3
  expect(() => normalInputBounds(ir, options)).toThrow(/pinned decoded dimensions/)
  texture.dispose()
})

it('rejects asserted blue bounds when the actual decoded image can produce a zero normal', () => {
  const texture = new DataTexture(
    new Float32Array([0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1]),
    2,
    1,
    RGBAFormat,
    FloatType,
  )
  texture.userData.verifiedBlueMinimum = 1
  const ir = ref()
  ir.claimedBounds = [0, 1]
  expect(() =>
    normalMapCoefficientBounds(ir, scalar(1), 'OPENGL', { textures: () => texture }),
  ).toThrow(/nonzero/)
  texture.dispose()
})

it('checks the actual packed frame and live owner conditioning before normalization', () => {
  const owner = mesh(),
    ir = expression()
  validateTangentNormalMapBinding([ir], owner, 'blender-z-up', extras, {})
  owner.scale.x = 0.1
  expect(() => validateTangentNormalMapBinding([ir], owner, 'blender-z-up', extras, {})).toThrow(
    /poorly conditioned/,
  )
  const mixed = mesh()
  mixed.geometry.setAttribute(
    'tangent',
    new Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1], 4),
  )
  expect(() => validateTangentNormalMapBinding([ir], mixed, 'blender-z-up', extras, {})).toThrow(
    /one handedness sign/,
  )
})

it('bounds Mix output clamp independently of its endpoint colors', () => {
  const color: TslIrExpression = {
    op: 'mix_color',
    blendType: 'MIX',
    clampFactor: true,
    clampResult: true,
    factor: scalar(0.5),
    a: vector(2, 2, 2),
    b: vector(3, 3, 3),
  }
  expect(normalInputBounds(color, {})).toEqual([
    [1, 1],
    [1, 1],
    [1, 1],
  ])
  color.a = vector(-3, -3, -3)
  color.b = vector(-2, -2, -2)
  expect(normalInputBounds(color, {})).toEqual([
    [0, 0],
    [0, 0],
    [0, 0],
  ])
})

it('audits actual pinned PNG ranges on an actual GLB normal-only program with portable base color', async () => {
  const geometry = mesh().geometry,
    document = new Document(),
    buffer = document.createBuffer()
  const accessor = (name: string, type: 'VEC2' | 'VEC3' | 'VEC4') =>
    document
      .createAccessor()
      .setBuffer(buffer)
      .setType(type)
      .setArray(geometry.getAttribute(name).array)
  const material = document
    .createMaterial('Image normal')
    .setBaseColorFactor([0.42, 0.35, 0.13, 1])
    .setExtras({ blendlink_source_material: 'Image normal' })
  const primitive = document
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', accessor('position', 'VEC3'))
    .setAttribute('NORMAL', accessor('normal', 'VEC3'))
    .setAttribute('TANGENT', accessor('tangent', 'VEC4'))
    .setAttribute('TEXCOORD_0', accessor('uv', 'VEC2'))
  const source = document
    .createMesh()
    .setExtras({ blendlink_tsl_runtime: extras })
    .addPrimitive(primitive)
  document
    .getRoot()
    .setDefaultScene(
      document
        .createScene()
        .addChild(document.createNode('Actual image normal owner').setMesh(source)),
    )
  const glb = await new NodeIO().writeBinary(document),
    ir = expression()
  ir.color = { ...ref(), vector: vector(0.1, 0.2, 0), claimedMinimumBlue: 1 }
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const audit = async (pixels: Uint8Array) => {
    const png = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } })
        .png()
        .toBuffer(),
      programs = {
        schemaVersion: 1,
        model: 'blendlink-material-programs-v1',
        images: {
          NormalData: {
            file: 'normal.png',
            mime: 'image/png',
            width: 2,
            height: 1,
            bytes: png.length,
            hash: hash(png),
            colorSpace: 'Non-Color',
          },
        },
        materials: {
          'Image normal': {
            channels: {
              Normal: {
                tslIr: {
                  schemaVersion: 1,
                  model: 'blendlink-tsl-ir-v1',
                  output: { op: 'normal_view_native', input: ir },
                },
              },
            },
          },
        },
      },
      bytes = new TextEncoder().encode(JSON.stringify(programs)),
      manifest = {
        schemaVersion: 3,
        generator: 'blendlink',
        hash: hash(glb),
        url: '/actual.glb',
        stats: { bytes: glb.length },
        materialPrograms: {
          url: '/actual.materials.json',
          bytes: bytes.length,
          hash: hash(bytes),
          materials: 1,
        },
      } as unknown as SceneManifest
    return auditCompiledSceneArtifact({
      manifest,
      glbBytes: glb,
      materialProgramsBytes: bytes,
      materialProgramImageBytes: new Map([['normal.png', png]]),
    })
  }
  await expect(
    audit(new Uint8Array([128, 128, 255, 255, 128, 128, 255, 255])),
  ).resolves.toBeDefined()
  await expect(audit(new Uint8Array([127, 127, 127, 255, 128, 128, 128, 255]))).rejects.toThrow(
    /nonzero native normal/,
  )
})
