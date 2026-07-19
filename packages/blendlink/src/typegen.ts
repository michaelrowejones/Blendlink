import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { NodeIO, type Node } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { parseVocabulary, type Vocabulary, type VocabularyNodeInput } from './vocabulary.js'
import type { BakePlan, BlendSidecar } from './invoke.js'

export interface CurveData {
  kind: 'bezier' | 'points'
  cyclic: boolean
  points: BlendSidecar['curves'][number]['points']
}

export interface SceneManifest {
  generator: 'blendlink'
  schemaVersion: 2
  /** Content hash of the GLB — cache-busting key and drift signal. */
  hash: string
  url: string
  sourceBlend?: string
  sourceHash?: string
  /** Hash of the .blend bytes alone — lets Blender-free CI detect drift. */
  blendBytesHash?: string
  /** Command that regenerates these artifacts — surfaced by the Blender
   * addon when the saved .blend is ahead of the last sync. */
  syncHint?: string
  nodes: Array<{ name: string; kind: NodeKind; extras?: Record<string, unknown> }>
  materials: string[]
  /** Clip name → duration in seconds (from sampler inputs). */
  clips: Record<string, { duration: number }>
  /** Scene timeline markers as named seconds (scroll-scrub waypoints). */
  markers: Record<string, number>
  curves: Record<string, CurveData>
  vocabulary: Vocabulary
  /** Objects removed by -noimp (reported, never silent). */
  excluded: string[]
  stats: { bytes: number; triangles: number; meshes: number; texturesBytes: number }
  /** Baked-mode state textures (lighting states blended/swapped at runtime).
   * The entry marked default is the one baked into the GLB's materials.
   * Full runtime contract: docs/MANIFEST.md. */
  states?: Record<string, { url: string; default?: true }>
  /** Interactive light groups: additive contribution layers. Runtime:
   * color = state + Σ layer(url) * maxValue * tint * strength, linear space. */
  lightGroups?: Record<string, { url: string; maxValue: number }>
  /** Wall-clock of the last sync — powers plan-time estimates. */
  lastSyncDurationMs?: number
  /** Combined hash of the declared extra input files (external scenes). */
  inputsHash?: string
  /** True when produced by `sync --draft` (quarter res) — never commit. */
  draft?: boolean
  /** Baked mode: the last sync's bake plan (density, shares, weights) —
   * the addon shows per-object numbers next to the Lightmap Scale slider. */
  bakePlan?: BakePlan
}

export type NodeKind = 'Mesh' | 'SkinnedMesh' | 'Bone' | 'Camera' | 'Light' | 'Object3D'

export const MANIFEST_SCHEMA_VERSION = 2

/** The ONE manifest reader: enforces schemaVersion (which was write-only
 * once — every consumer blind-cast, so a future reshape would have been
 * silently misread). Policy: additive-only within a version; bump on
 * reshape; readers refuse other versions loudly. */
export function parseManifest(json: string): SceneManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  const manifest = parsed as SceneManifest
  if (manifest?.generator !== 'blendlink') return null
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Manifest schemaVersion ${String(manifest.schemaVersion)} is not the ` +
        `supported version ${MANIFEST_SCHEMA_VERSION} — re-run blendlink sync ` +
        `with a matching blendlink release.`,
    )
  }
  return manifest
}

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
 * Parse a GLB (+ optional Blender sidecar) and emit the typed scene module.
 *
 * GLB-generic by design: names, materials, clips, extras, and the naming
 * vocabulary all read from the export. The sidecar (curves, markers, empty
 * display types) is the Blender-first upgrade, absent for plain GLBs.
 */
export async function generateSceneModule(options: {
  glbPath: string
  url: string
  exportName: string
  sourceBlend?: string
  sourceHash?: string
  sidecar?: BlendSidecar
  excluded?: string[]
  states?: Record<string, { url: string }>
  lightGroups?: Record<string, { url: string; maxValue: number }>
}): Promise<TypegenOutput> {
  await MeshoptDecoder.ready
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const glbBytes = readFileSync(options.glbPath)
  const document = await io.readBinary(new Uint8Array(glbBytes))
  const root = document.getRoot()

  const parentOf = new Map<Node, Node>()
  for (const node of root.listNodes()) {
    for (const child of node.listChildren()) parentOf.set(child, node)
  }

  const nodes: SceneManifest['nodes'] = []
  const nodeIndexByName = new Map<string, number>()
  const sanitizeNotes: string[] = []
  const vocabularyInput: VocabularyNodeInput[] = []
  for (const node of root.listNodes()) {
    const raw = node.getName() || 'Node'
    // The typed map keys must be the names three.js REPORTS after load:
    // GLTFLoader sanitizes node names (dots stripped, spaces to _), so a
    // raw "Crate.001" key would type-check and then return undefined from
    // getObjectByName — the exact silent failure the tool exists to kill.
    const name = sanitizeNodeName(raw)
    if (name !== raw) {
      sanitizeNotes.push(
        `node "${raw}" loads as "${name}" in three.js (loader-sanitized) — the typed map uses the loaded name.`,
      )
    }
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
    const hasExtras = extras && Object.keys(extras).length > 0
    const entry = {
      name,
      kind,
      ...(hasExtras ? { extras: extras as Record<string, unknown> } : {}),
    }
    const existing = nodeIndexByName.get(name)
    if (existing !== undefined) {
      // Last-wins, matching drei's useGraph — an invented "_1" key would
      // type-check against an object drei never creates.
      sanitizeNotes.push(
        `duplicate node name "${name}" after sanitization — the typed map keeps the last (drei semantics).`,
      )
      nodes[existing] = entry
    } else {
      nodeIndexByName.set(name, nodes.length)
      nodes.push(entry)
    }
    const world = node.getWorldMatrix()
    // Vocabulary parsing sees the RAW name: the `.NNN` tolerance and suffix
    // rules are authored-name semantics, not loaded-name semantics.
    vocabularyInput.push({
      name: raw,
      kind,
      parent: parentOf.get(node)?.getName() ?? null,
      worldPosition: [round(world[12]!), round(world[13]!), round(world[14]!)],
      worldQuaternion: quaternionFromMatrix(world),
      ...(hasExtras ? { extras: extras as Record<string, unknown> } : {}),
    })
  }

  const materialSeen = new Map<string, number>()
  const unlitMaterials = new Set<string>()
  const materials = root.listMaterials().map((material) => {
    const name = uniqueName(material.getName() || 'Material', materialSeen)
    // KHR_materials_unlit loads as MeshBasicMaterial — typing it Standard
    // would let `roughness = 1` type-check and silently do nothing.
    if (material.getExtension('KHR_materials_unlit')) unlitMaterials.add(name)
    return name
  })

  const clipSeen = new Map<string, number>()
  const clips: SceneManifest['clips'] = {}
  for (const animation of root.listAnimations()) {
    const name = uniqueName(animation.getName() || 'Clip', clipSeen)
    let duration = 0
    for (const sampler of animation.listSamplers()) {
      const input = sampler.getInput()
      if (!input) continue
      const max = input.getMax([0])
      duration = Math.max(duration, max[0] ?? 0)
    }
    clips[name] = { duration: round(duration) }
  }

  const markers: SceneManifest['markers'] = {}
  for (const marker of options.sidecar?.markers ?? []) {
    markers[marker.name] = marker.time
  }
  const curves: SceneManifest['curves'] = {}
  for (const curve of options.sidecar?.curves ?? []) {
    curves[curve.name] = { kind: curve.kind, cyclic: curve.cyclic, points: curve.points }
  }

  const vocabulary = parseVocabulary(vocabularyInput, options.sidecar)
  vocabulary.warnings.push(...sanitizeNotes)

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
    schemaVersion: 2,
    hash: createHash('sha256').update(glbBytes).digest('hex').slice(0, 16),
    url: options.url,
    ...(options.sourceBlend ? { sourceBlend: options.sourceBlend } : {}),
    ...(options.sourceHash ? { sourceHash: options.sourceHash } : {}),
    nodes,
    materials,
    clips,
    markers,
    curves,
    vocabulary,
    excluded: options.excluded ?? [],
    stats: { bytes: glbBytes.length, triangles, meshes, texturesBytes },
    ...(options.states ? { states: options.states } : {}),
    ...(options.lightGroups ? { lightGroups: options.lightGroups } : {}),
  }

  return { manifest, module: renderModule(options.exportName, manifest, unlitMaterials) }
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/** Rotation quaternion from a column-major 4x4, scale-normalized. */
function quaternionFromMatrix(m: number[]): [number, number, number, number] {
  const sx = Math.hypot(m[0]!, m[1]!, m[2]!) || 1
  const sy = Math.hypot(m[4]!, m[5]!, m[6]!) || 1
  const sz = Math.hypot(m[8]!, m[9]!, m[10]!) || 1
  const r00 = m[0]! / sx, r01 = m[4]! / sy, r02 = m[8]! / sz
  const r10 = m[1]! / sx, r11 = m[5]! / sy, r12 = m[9]! / sz
  const r20 = m[2]! / sx, r21 = m[6]! / sy, r22 = m[10]! / sz
  const trace = r00 + r11 + r22
  let x: number, y: number, z: number, w: number
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    w = 0.25 / s
    x = (r21 - r12) * s
    y = (r02 - r20) * s
    z = (r10 - r01) * s
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22)
    w = (r21 - r12) / s
    x = 0.25 * s
    y = (r01 + r10) / s
    z = (r02 + r20) / s
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22)
    w = (r02 - r20) / s
    x = (r01 + r10) / s
    y = 0.25 * s
    z = (r12 + r21) / s
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11)
    w = (r10 - r01) / s
    x = (r02 + r20) / s
    y = (r12 + r21) / s
    z = 0.25 * s
  }
  return [round(x), round(y), round(z), round(w)]
}

function uniqueName(name: string, seen: Map<string, number>): string {
  const count = seen.get(name) ?? 0
  seen.set(name, count + 1)
  return count === 0 ? name : `${name}_${count}`
}

/** three.js PropertyBinding.sanitizeNodeName: whitespace becomes _, and
 * the reserved track characters []%$.:/ are stripped on load. The typed
 * map must key by what getObjectByName will actually find. */
function sanitizeNodeName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[\[\]%$.:/]/g, '')
}

const quote = (value: string) => JSON.stringify(value)
const key = (value: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : quote(value))

function renderModule(
  exportName: string,
  manifest: SceneManifest,
  unlitMaterials: Set<string> = new Set(),
): string {
  const pascalName = pascal(exportName)
  const nodeEntries = manifest.nodes
    .map((node) => `  ${key(node.name)}: ${quote(node.name)},`)
    .join('\n')
  const nodeTypes = manifest.nodes
    .map((node) => `    ${key(node.name)}: ${THREE_TYPE[node.kind]}`)
    .join('\n')
  const extrasEntries = manifest.nodes
    .filter((node) => node.extras)
    .map((node) => `  ${key(node.name)}: ${JSON.stringify(node.extras)},`)
    .join('\n')
  const materialEntries = manifest.materials
    .map((name) => `  ${key(name)}: ${quote(name)},`)
    .join('\n')
  const materialTypes = manifest.materials
    .map((name) =>
      `    ${key(name)}: THREE.${unlitMaterials.has(name) ? 'MeshBasicMaterial' : 'MeshStandardMaterial'}`,
    )
    .join('\n')
  const clipEntries = Object.entries(manifest.clips)
    .map(([name, clip]) => `  ${key(name)}: { duration: ${clip.duration} },`)
    .join('\n')
  const markerEntries = Object.entries(manifest.markers)
    .map(([name, time]) => `  ${key(name)}: ${time},`)
    .join('\n')
  const curveEntries = Object.entries(manifest.curves)
    .map(
      ([name, curve]) =>
        `  ${key(name)}: ${JSON.stringify({ kind: curve.kind, cyclic: curve.cyclic, points: curve.points })},`,
    )
    .join('\n')
  const socketEntries = manifest.vocabulary.sockets
    .map(
      (socket) =>
        `  ${key(socket.name)}: { position: ${JSON.stringify(socket.position)}, quaternion: ${JSON.stringify(socket.quaternion)}, parent: ${JSON.stringify(socket.parent)} },`,
    )
    .join('\n')
  const hotspotEntries = manifest.vocabulary.hotspots
    .map(
      (hotspot) =>
        `  ${key(hotspot.name)}: { position: ${JSON.stringify(hotspot.position)}, quaternion: ${JSON.stringify(hotspot.quaternion)}${hotspot.extras ? `, extras: ${JSON.stringify(hotspot.extras)}` : ''} },`,
    )
    .join('\n')
  const stateEntries = Object.entries(manifest.states ?? {})
    .map(([name, state]) => `  ${key(name)}: ${quote(state.url)},`)
    .join('\n')
  const lightGroupEntries = Object.entries(manifest.lightGroups ?? {})
    .map(
      ([name, group]) =>
        `  ${key(name)}: { url: ${quote(group.url)}, maxValue: ${group.maxValue} },`,
    )
    .join('\n')

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
  /** Clip durations in seconds — scroll-scrub without string guessing. */
  clips: {
${clipEntries}
  },
  /** Timeline markers as named seconds (scroll waypoints). */
  markers: {
${markerEntries}
  },
  /** Blender curves, Y-up converted. bezier: co/handleLeft/handleRight. */
  curves: {
${curveEntries}
  },
  /** SOCKET_ empties — typed attach points. */
  sockets: {
${socketEntries}
  },
  /** HOTSPOT_ empties — typed annotation anchors. */
  hotspots: {
${hotspotEntries}
  },
  /** Baked lighting-state texture URLs (swap material.map at runtime). */
  states: {
${stateEntries}
  },
  /** Interactive light layers: add layer * maxValue * tint * strength in
   * linear space over the state color. Bake keeps each group's real bounce. */
  lightGroups: {
${lightGroupEntries}
  },
  colliders: ${JSON.stringify(manifest.vocabulary.colliders)} as const,
  lods: ${JSON.stringify(manifest.vocabulary.lods)} as const,
  physics: ${JSON.stringify(manifest.vocabulary.physics)} as const,
  /** Blender custom properties (glTF extras), typed as literals. */
  extras: {
${extrasEntries}
  },
} as const

export type ${pascalName}NodeName = keyof typeof ${exportName}.nodes
export type ${pascalName}MaterialName = keyof typeof ${exportName}.materials
export type ${pascalName}ClipName = keyof typeof ${exportName}.clips
export type ${pascalName}MarkerName = keyof typeof ${exportName}.markers
export type ${pascalName}CurveName = keyof typeof ${exportName}.curves
export type ${pascalName}SocketName = keyof typeof ${exportName}.sockets
export type ${pascalName}HotspotName = keyof typeof ${exportName}.hotspots
export type ${pascalName}StateName = keyof typeof ${exportName}.states
export type ${pascalName}LightGroupName = keyof typeof ${exportName}.lightGroups

/** gltfjsx-compatible result shape for useGLTF casts. */
export interface ${pascalName}GLTF {
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
