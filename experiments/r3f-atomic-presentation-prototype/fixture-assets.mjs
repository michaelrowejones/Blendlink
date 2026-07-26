import { deflateSync } from 'node:zlib'

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
    }
  }
  return (value ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([typeBytes, data])
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(payload), 8 + data.length)
  return chunk
}

export function createAtomicGreenPng() {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(2, 0)
  header.writeUInt32BE(2, 4)
  header[8] = 8
  header[9] = 6
  const pixel = [16, 255, 44, 255]
  const scanlines = Buffer.from([
    0, ...pixel, ...pixel,
    0, ...pixel, ...pixel,
  ])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function padToFour(bytes, fill) {
  const padding = (4 - (bytes.length % 4)) % 4
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)])
}

export function createExternalTextureGlb(imageUri = 'atomic-green.png') {
  const binary = Buffer.alloc(92)
  const positions = [
    -2.5, -2.5, 0,
    2.5, -2.5, 0,
    2.5, 2.5, 0,
    -2.5, 2.5, 0,
  ]
  const texcoords = [
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]
  const indices = [0, 1, 2, 0, 2, 3]
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4))
  texcoords.forEach((value, index) => binary.writeFloatLE(value, 48 + index * 4))
  indices.forEach((value, index) => binary.writeUInt16LE(value, 80 + index * 2))

  const gltf = {
    asset: { version: '2.0', generator: 'Blendlink atomic external-asset prototype' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'ExternalTexturePlane' }],
    meshes: [{
      name: 'ExternalTextureMesh',
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1 },
        indices: 2,
        material: 0,
      }],
    }],
    materials: [{
      name: 'DecodedExternalTexture',
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      extensions: { KHR_materials_unlit: {} },
    }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{
      magFilter: 9728,
      minFilter: 9728,
      wrapS: 33071,
      wrapT: 33071,
    }],
    images: [{ uri: imageUri, mimeType: 'image/png', name: 'AtomicGreenExternalPng' }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48, target: 34962 },
      { buffer: 0, byteOffset: 48, byteLength: 32, target: 34962 },
      { buffer: 0, byteOffset: 80, byteLength: 12, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [-2.5, -2.5, 0],
        max: [2.5, 2.5, 0],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: 4,
        type: 'VEC2',
        min: [0, 0],
        max: [1, 1],
      },
      {
        bufferView: 2,
        componentType: 5123,
        count: indices.length,
        type: 'SCALAR',
        min: [0],
        max: [3],
      },
    ],
  }

  const json = padToFour(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20)
  const body = padToFour(binary, 0)
  const output = Buffer.alloc(12 + 8 + json.length + 8 + body.length)
  output.writeUInt32LE(0x46546c67, 0)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(output.length, 8)
  output.writeUInt32LE(json.length, 12)
  output.writeUInt32LE(0x4e4f534a, 16)
  json.copy(output, 20)
  const binaryHeader = 20 + json.length
  output.writeUInt32LE(body.length, binaryHeader)
  output.writeUInt32LE(0x004e4942, binaryHeader + 4)
  body.copy(output, binaryHeader + 8)
  return output
}
