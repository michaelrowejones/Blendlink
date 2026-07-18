import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

export interface SceneManifest {
  generator: 'blendlink'
  schemaVersion: 1
  /** Content hash of the GLB — cache-busting key and drift signal. */
  hash: string
  url: string
  sourceBlend?: string
  sourceHash?: string
  /** Hash of the .blend bytes alone — lets Blender-free CI detect drift. */
  blendBytesHash?: string
  nodes: Array<{ name: string; kind: NodeKind; extras?: Record<string, unknown> }>
  materials: string[]
  clips: string[]
  stats: { bytes: number; triangles: number; meshes: number; texturesBytes: number }
}

export type NodeKind = 'Mesh' | 'SkinnedMesh' | 'Bone' | 'Camera' | 'Light' | 'Object3D'

export interface TypegenOutput {
  manifest: SceneManifest
  /** Contents for the generated `.gen.ts` module. */
  module: string
}

const THREE_TYPE: Record<NodeKind, string> = {
  Mesh: 'THREE.Mesh',
  SkinnedMesh: 'THREE.SkinnedMesh',
  Bone: 'THREE.Bone',
  Camera: 'THREE.Camera',
  Light: 'THREE.Light',
  Object3D: 'THREE.Object3D',
}

/**
 * Parse a GLB and emit the typed scene module + manifest.
 *
 * Deliberately GLB-generic (reads the export, not the .blend): the same
 * typegen serves downloaded assets and other DCCs, with Blender-specific
 * value arriving via extras (custom properties) that survive export.
 * Emitted type shapes are gltfjsx-compatible (`nodes` / `materials` maps
 * keyed by name) so existing gltfjsx users migrate by deleting code.
 */
export async function generateSceneModule(options: {
  glbPath: string
  url: string
  exportName: string
  sourceBlend?: string
  sourceHash?: string
}): Promise<TypegenOutput> {
  await MeshoptDecoder.ready
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const glbBytes = readFileSync(options.glbPath)
  const document = await io.readBinary(new Uint8Array(glbBytes))
  const root = document.getRoot()

  const seen = new Map<string, number>()
  const nodes: SceneManifest['nodes'] = []
  for (const node of root.listNodes()) {
    const name = uniqueName(node.getName() || 'Node', seen)
    const mesh = node.getMesh()
    const kind: NodeKind = node.getSkin()
      ? 'SkinnedMesh'
      : mesh
        ? 'Mesh'
        : node.getCamera()
          ? 'Camera'
          : node.getExtension('KHR_lights_punctual')
            ? 'Light'
            : 'Object3D'
    const extras = node.getExtras()
    nodes.push({
      name,
      kind,
      ...(extras && Object.keys(extras).length > 0
        ? { extras: extras as Record<string, unknown> }
        : {}),
    })
  }

  const materialSeen = new Map<string, number>()
  const materials = root
    .listMaterials()
    .map((material) => uniqueName(material.getName() || 'Material', materialSeen))
  const clipSeen = new Map<string, number>()
  const clips = root
    .listAnimations()
    .map((animation) => uniqueName(animation.getName() || 'Clip', clipSeen))

  let triangles = 0
  let meshes = 0
  for (const mesh of root.listMeshes()) {
    meshes += 1
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices()
      const position = primitive.getAttribute('POSITION')
      triangles += Math.floor((indices?.getCount() ?? position?.getCount() ?? 0) / 3)
    }
  }
  let texturesBytes = 0
  for (const texture of root.listTextures()) {
    texturesBytes += texture.getImage()?.byteLength ?? 0
  }

  const manifest: SceneManifest = {
    generator: 'blendlink',
    schemaVersion: 1,
    hash: createHash('sha256').update(glbBytes).digest('hex').slice(0, 16),
    url: options.url,
    ...(options.sourceBlend ? { sourceBlend: options.sourceBlend } : {}),
    ...(options.sourceHash ? { sourceHash: options.sourceHash } : {}),
    nodes,
    materials,
    clips,
    stats: { bytes: glbBytes.length, triangles, meshes, texturesBytes },
  }

  return { manifest, module: renderModule(options.exportName, manifest) }
}

function uniqueName(name: string, seen: Map<string, number>): string {
  const count = seen.get(name) ?? 0
  seen.set(name, count + 1)
  return count === 0 ? name : `${name}_${count}`
}

const quote = (value: string) => JSON.stringify(value)
const key = (value: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : quote(value))

function renderModule(exportName: string, manifest: SceneManifest): string {
  const nodeEntries = manifest.nodes
    .map((node) => `  ${key(node.name)}: ${quote(node.name)},`)
    .join('\n')
  const extrasEntries = manifest.nodes
    .filter((node) => node.extras)
    .map((node) => `  ${key(node.name)}: ${JSON.stringify(node.extras)},`)
    .join('\n')
  const nodeTypes = manifest.nodes
    .map((node) => `    ${key(node.name)}: ${THREE_TYPE[node.kind]}`)
    .join('\n')
  const materialEntries = manifest.materials
    .map((name) => `  ${key(name)}: ${quote(name)},`)
    .join('\n')
  const materialTypes = manifest.materials
    .map((name) => `    ${key(name)}: THREE.MeshStandardMaterial`)
    .join('\n')
  const clipUnion = manifest.clips.length
    ? manifest.clips.map(quote).join(' | ')
    : 'never'

  return `/* Generated by blendlink — do not edit. Source: ${manifest.sourceBlend ?? manifest.url} */
import type * as THREE from 'three'

export const ${exportName} = {
  url: ${quote(`${manifest.url}?v=${manifest.hash}`)},
  hash: ${quote(manifest.hash)},
  nodes: {
${nodeEntries}
  },
  materials: {
${materialEntries}
  },
  clips: [${manifest.clips.map(quote).join(', ')}] as const,
  /** Blender custom properties (glTF extras), typed as literals. */
  extras: {
${extrasEntries}
  },
} as const

export type ${pascal(exportName)}NodeName = keyof typeof ${exportName}.nodes
export type ${pascal(exportName)}MaterialName = keyof typeof ${exportName}.materials
export type ${pascal(exportName)}ClipName = ${clipUnion}

/** gltfjsx-compatible result shape for useGLTF casts. */
export interface ${pascal(exportName)}GLTF {
  nodes: {
${nodeTypes}
  }
  materials: {
${materialTypes}
  }
  animations: THREE.AnimationClip[]
  scene: THREE.Group
}
`
}

function pascal(name: string): string {
  return name.replace(/(^|[-_ ])(\w)/g, (_, __, letter: string) => letter.toUpperCase())
}
