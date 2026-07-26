import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [inputArgument, outputArgument] = process.argv.slice(2)
if (!inputArgument || !outputArgument) {
  throw new Error('Usage: node inspect_glb.mjs input.glb output.json')
}
const input = resolve(inputArgument)
const output = resolve(outputArgument)
const bytes = await readFile(input)
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
  throw new Error('Expected a glTF 2.0 GLB')
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
if (!document) throw new Error('GLB contains no JSON chunk')

const meshNodes = (document.nodes ?? []).filter((node) => node.mesh !== undefined)
const meshReferences = new Map()
for (const node of meshNodes) {
  meshReferences.set(node.mesh, (meshReferences.get(node.mesh) ?? 0) + 1)
}
const repeatedMeshes = [...meshReferences]
  .filter(([, count]) => count > 1)
  .map(([mesh, count]) => ({
    mesh,
    name: document.meshes?.[mesh]?.name ?? null,
    count,
  }))
  .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)))

const channels = (document.animations ?? []).flatMap((animation, animationIndex) =>
  animation.channels.map((channel) => ({
    animationIndex,
    animation: animation.name ?? null,
    node: channel.target.node,
    nodeName: document.nodes?.[channel.target.node]?.name ?? null,
    path: channel.target.path,
  })),
)
const countBy = (values) =>
  Object.fromEntries(
    [...new Set(values)].sort().map((value) => [
      value,
      values.filter((candidate) => candidate === value).length,
    ]),
  )
const imageBytes = (image) => {
  if (image.bufferView === undefined) return null
  return document.bufferViews?.[image.bufferView]?.byteLength ?? null
}

const report = {
  schemaVersion: 1,
  classification:
    'research-only Needle-equivalent stock glTF floor; not a coherent Needle integration or Blendlink artifact',
  glb: {
    path: input.replaceAll('\\', '/'),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    generator: document.asset?.generator ?? null,
    version: document.asset?.version ?? null,
  },
  counts: {
    scenes: document.scenes?.length ?? 0,
    nodes: document.nodes?.length ?? 0,
    meshNodes: meshNodes.length,
    meshes: document.meshes?.length ?? 0,
    primitives: (document.meshes ?? []).reduce(
      (sum, mesh) => sum + mesh.primitives.length,
      0,
    ),
    materials: document.materials?.length ?? 0,
    images: document.images?.length ?? 0,
    textures: document.textures?.length ?? 0,
    cameras: document.cameras?.length ?? 0,
    lights: document.extensions?.KHR_lights_punctual?.lights?.length ?? 0,
    skins: document.skins?.length ?? 0,
    animations: document.animations?.length ?? 0,
    animationChannels: channels.length,
  },
  extensionsUsed: document.extensionsUsed ?? [],
  extensionsRequired: document.extensionsRequired ?? [],
  materialEvidence: {
    alphaModes: countBy(
      (document.materials ?? []).map((material) => material.alphaMode ?? 'OPAQUE'),
    ),
    extensions: countBy(
      (document.materials ?? []).flatMap((material) =>
        Object.keys(material.extensions ?? {}),
      ),
    ),
    baseColorTextures: (document.materials ?? []).filter(
      (material) => material.pbrMetallicRoughness?.baseColorTexture,
    ).length,
    metallicRoughnessTextures: (document.materials ?? []).filter(
      (material) => material.pbrMetallicRoughness?.metallicRoughnessTexture,
    ).length,
    normalTextures: (document.materials ?? []).filter(
      (material) => material.normalTexture,
    ).length,
    emissiveTextures: (document.materials ?? []).filter(
      (material) => material.emissiveTexture,
    ).length,
    names: (document.materials ?? []).map((material) => material.name ?? null),
  },
  images: (document.images ?? []).map((image, index) => ({
    index,
    name: image.name ?? null,
    mimeType: image.mimeType ?? null,
    uri: image.uri ?? null,
    bytes: imageBytes(image),
  })),
  cameras: (document.nodes ?? [])
    .filter((node) => node.camera !== undefined)
    .map((node) => ({
      node: node.name ?? null,
      camera: document.cameras?.[node.camera]?.name ?? null,
      definition: document.cameras?.[node.camera] ?? null,
    })),
  lights: (document.nodes ?? [])
    .filter((node) => node.extensions?.KHR_lights_punctual)
    .map((node) => {
      const index = node.extensions.KHR_lights_punctual.light
      return {
        node: node.name ?? null,
        light: document.extensions.KHR_lights_punctual.lights[index] ?? null,
      }
    }),
  animations: {
    names: (document.animations ?? []).map((animation) => animation.name ?? null),
    targetPaths: countBy(channels.map((channel) => channel.path)),
    targetNodes: countBy(channels.map((channel) => channel.nodeName)),
  },
  repeatedMeshes,
  namedNodePresence: {
    sourceCamera: (document.nodes ?? []).filter(
      (node) => node.name === 'CAM-Camera',
    ).length,
    sourceCurves: [
      'GEO-paths-faint',
      'GEO-paths-snowman',
      'GEO-ground-hub',
      'GEO-snow_patch_004',
      'GEO-snow_patch_006',
      'GEO-snow_patch_022',
      'GEO-snow_patch_028.001',
    ].map((name) => ({
      name,
      count: (document.nodes ?? []).filter((node) => node.name === name).length,
      meshCount: (document.nodes ?? []).filter(
        (node) => node.name === name && node.mesh !== undefined,
      ).length,
    })),
    armatures: [
      'RIG-leash_handle',
      'RIG-Snowman.001',
      'RIG-Pinda',
      'RIG-Chocomel',
      'RIG-Camera',
    ].map((name) => ({
      name,
      count: (document.nodes ?? []).filter((node) => node.name === name).length,
    })),
    collectionInstanceRoots: (document.nodes ?? [])
      .filter((node) => /^LI-/.test(node.name ?? ''))
      .length,
  },
}

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(
  JSON.stringify(
    {
      glb: report.glb,
      counts: report.counts,
      extensionsUsed: report.extensionsUsed,
      materialEvidence: {
        alphaModes: report.materialEvidence.alphaModes,
        baseColorTextures: report.materialEvidence.baseColorTextures,
        normalTextures: report.materialEvidence.normalTextures,
      },
      namedNodePresence: report.namedNodePresence,
    },
    null,
    2,
  ),
)
