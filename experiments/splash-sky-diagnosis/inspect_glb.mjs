import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const glbPath = resolve(process.argv[2])
const outputPath = resolve(
  process.argv[3] ?? 'experiments/splash-sky-diagnosis/output/sky.png',
)
const bytes = await readFile(glbPath)
if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('Input is not GLB')

let offset = 12
let gltf
let binary
while (offset < bytes.length) {
  const length = bytes.readUInt32LE(offset)
  const type = bytes.readUInt32LE(offset + 4)
  const chunk = bytes.subarray(offset + 8, offset + 8 + length)
  if (type === 0x4e4f534a) gltf = JSON.parse(chunk.toString('utf8').trim())
  if (type === 0x004e4942) binary = chunk
  offset += 8 + length
}
if (!gltf || !binary) throw new Error('GLB lacks JSON or BIN chunk')

const materialIndex = gltf.materials.findIndex((material) =>
  material.name?.includes('DP-SkyPaint.MAT'),
)
if (materialIndex < 0) throw new Error('DP-SkyPaint material is missing')
const material = gltf.materials[materialIndex]
const textureInfo = material.pbrMetallicRoughness?.baseColorTexture
if (!textureInfo) throw new Error('DP-SkyPaint base-color texture is missing')
const texture = gltf.textures[textureInfo.index]
const image = gltf.images[texture.source]
const view = gltf.bufferViews[image.bufferView]
const imageBytes = binary.subarray(
  (view.byteOffset ?? 0),
  (view.byteOffset ?? 0) + view.byteLength,
)

const primitives = []
for (let meshIndex = 0; meshIndex < gltf.meshes.length; meshIndex += 1) {
  const mesh = gltf.meshes[meshIndex]
  for (let primitiveIndex = 0; primitiveIndex < mesh.primitives.length; primitiveIndex += 1) {
    const primitive = mesh.primitives[primitiveIndex]
    if (primitive.material === materialIndex) {
      primitives.push({
        meshIndex,
        meshName: mesh.name,
        primitiveIndex,
        mode: primitive.mode ?? 4,
        attributes: primitive.attributes,
        indices: primitive.indices,
      })
    }
  }
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, imageBytes)
const result = {
  glb: {
    path: glbPath,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    generator: gltf.asset?.generator,
    extensionsUsed: gltf.extensionsUsed ?? [],
  },
  material: {
    index: materialIndex,
    value: material,
  },
  texture: {
    textureInfo,
    value: texture,
    sampler: gltf.samplers?.[texture.sampler] ?? null,
  },
  image: {
    index: texture.source,
    name: image.name,
    mimeType: image.mimeType,
    bytes: imageBytes.length,
    sha256: createHash('sha256').update(imageBytes).digest('hex'),
    outputPath,
  },
  primitives,
}
console.log(JSON.stringify(result, null, 2))
