import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const here = resolve(import.meta.dirname)
const input = resolve(here, 'output/blendlink/trapxUntouched.glb')
const output = resolve(here, 'output/compiled-glb-structure.json')
const bytes = await readFile(input)
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
  throw new Error('Expected a glTF 2.0 GLB.')
}

let offset = 12
let document
while (offset < bytes.byteLength) {
  const length = view.getUint32(offset, true)
  const type = view.getUint32(offset + 4, true)
  if (type === 0x4e4f534a) {
    document = JSON.parse(
      new TextDecoder().decode(bytes.subarray(offset + 8, offset + 8 + length)),
    )
    break
  }
  offset += 8 + length
}
if (!document) throw new Error('GLB contains no JSON chunk.')

const imageBytes = (image) =>
  image.bufferView === undefined
    ? null
    : document.bufferViews?.[image.bufferView]?.byteLength ?? null
const materials = (document.materials ?? []).map((material, index) => ({
  index,
  name: material.name ?? null,
  alphaMode: material.alphaMode ?? 'OPAQUE',
  alphaCutoff: material.alphaCutoff ?? null,
  doubleSided: material.doubleSided ?? false,
  pbrMetallicRoughness: material.pbrMetallicRoughness ?? null,
  normalTexture: material.normalTexture ?? null,
  occlusionTexture: material.occlusionTexture ?? null,
  emissiveFactor: material.emissiveFactor ?? null,
  emissiveTexture: material.emissiveTexture ?? null,
  extensions: material.extensions ?? {},
}))
const nodes = (document.nodes ?? []).map((node, index) => ({
  index,
  name: node.name ?? null,
  mesh: node.mesh ?? null,
  camera: node.camera ?? null,
  light: node.extensions?.KHR_lights_punctual?.light ?? null,
  children: node.children ?? [],
  translation: node.translation ?? null,
  rotation: node.rotation ?? null,
  scale: node.scale ?? null,
  matrix: node.matrix ?? null,
}))

const report = {
  schemaVersion: 1,
  classification:
    'local compiled structural floor from untouched TrapX source; not visual-parity evidence',
  glb: {
    path: input.replaceAll('\\', '/'),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    generator: document.asset?.generator ?? null,
    version: document.asset?.version ?? null,
  },
  counts: {
    scenes: document.scenes?.length ?? 0,
    nodes: nodes.length,
    meshes: document.meshes?.length ?? 0,
    primitives: (document.meshes ?? []).reduce(
      (sum, mesh) => sum + (mesh.primitives?.length ?? 0),
      0,
    ),
    materials: materials.length,
    images: document.images?.length ?? 0,
    textures: document.textures?.length ?? 0,
    samplers: document.samplers?.length ?? 0,
    cameras: document.cameras?.length ?? 0,
    lights: document.extensions?.KHR_lights_punctual?.lights?.length ?? 0,
    animations: document.animations?.length ?? 0,
  },
  extensionsUsed: document.extensionsUsed ?? [],
  extensionsRequired: document.extensionsRequired ?? [],
  sceneRoots: (document.scenes ?? []).map((scene) => ({
    name: scene.name ?? null,
    nodes: scene.nodes ?? [],
  })),
  nodes,
  meshes: (document.meshes ?? []).map((mesh, index) => ({
    index,
    name: mesh.name ?? null,
    primitives: (mesh.primitives ?? []).map((primitive) => ({
      mode: primitive.mode ?? 4,
      material: primitive.material ?? null,
      attributes: Object.keys(primitive.attributes ?? {}).sort(),
      targets: primitive.targets?.length ?? 0,
      indices: primitive.indices ?? null,
    })),
  })),
  materials,
  images: (document.images ?? []).map((image, index) => ({
    index,
    name: image.name ?? null,
    mimeType: image.mimeType ?? null,
    uri: image.uri ?? null,
    bytes: imageBytes(image),
  })),
  textures: document.textures ?? [],
  samplers: document.samplers ?? [],
  cameras: document.cameras ?? [],
  lights: document.extensions?.KHR_lights_punctual?.lights ?? [],
}

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(
  JSON.stringify(
    {
      glb: report.glb,
      counts: report.counts,
      extensionsUsed: report.extensionsUsed,
      materials: report.materials,
      images: report.images,
    },
    null,
    2,
  ),
)
