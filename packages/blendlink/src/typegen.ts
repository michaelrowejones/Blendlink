import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { NodeIO, type Material, type Node, type Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { inspect } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'
import { parseVocabulary, type Vocabulary, type VocabularyNodeInput } from './vocabulary.js'
import type {
  BakeFingerprints,
  BakeArtifactHashes,
  BakePlan,
  BlendSidecar,
  IncrementalBakeReport,
  RectAreaLightContractEvidence,
} from './invoke.js'
import type { PresentationMode, SceneRecipe } from './sceneRecipe.js'
import type { PortableComponentRecord } from './components.js'
import type { OptimizationReport, TextureTransformReport } from './optimizer.js'
import type { TextureCompressionReport } from './textureCompression.js'
import type { EnvironmentCompressionAsset } from './environmentCompression.js'
import type { AtlasDeliveryReport, TextureDeliveryVariant } from './atlasDelivery.js'
import { compileSceneDiagnostics, type SceneDiagnostics } from './sceneDiagnostics.js'
import { compileRuntimeSceneDiagnostics } from './runtimeDiagnostics.js'
import { allocateLoadedNodeNames } from './loadedNames.js'
import { finalizeAtlasLayoutEvidence } from './atlasLayout.js'
import type { AuthoringPreview } from './runtime.js'
import type { SceneAssetGraph } from './sceneAssetGraph.js'
import type { SceneRuntimePublication } from './scenePublication.js'
import {
  assertGltfRuntimeCompatibility,
  BLENDLINK_THREE_R184_COMPILED_PROFILE,
  readGlbJson,
} from './gltfRuntimeCompatibility.js'
import {
  validateAnimationSequenceClips,
  type AnimationSequenceRecipe,
} from './animationSequence.js'
import {
  prepareGeneratedProvenance,
  type GeneratedExternalDependency,
  type LocalPathProvenance,
} from './generatedProvenance.js'

export interface CurveData {
  kind: 'bezier' | 'points'
  cyclic: boolean
  points: BlendSidecar['curves'][number]['points']
}

const RECT_AREA_DESCRIPTOR_KEY = 'blendlink_rect_area_light'

function own(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function assertRectAreaDescriptor(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  const payload = value as Record<string, unknown>
  if (payload.schemaVersion !== 1) {
    throw new Error(`${label} schemaVersion must be exactly 1; received ${String(payload.schemaVersion)}.`)
  }
  const tuple = (field: 'color' | 'size', length: number, positive: boolean): void => {
    const entries = payload[field]
    if (!Array.isArray(entries) || entries.length !== length || entries.some(
      (entry) => typeof entry !== 'number' || !Number.isFinite(entry)
        || (positive ? entry <= 0 : entry < 0),
    )) {
      throw new Error(
        `${label} ${field} must contain exactly ${length} finite ` +
          `${positive ? 'positive' : 'non-negative'} numbers.`,
      )
    }
  }
  tuple('color', 3, false)
  tuple('size', 2, true)
  const hasPower = own(payload, 'power')
  const hasIntensity = own(payload, 'intensity')
  if (hasPower === hasIntensity) {
    throw new Error(`${label} must contain exactly one of power or intensity.`)
  }
  const strength = payload[hasPower ? 'power' : 'intensity']
  if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0) {
    throw new Error(`${label} strength must be a finite non-negative number.`)
  }
}

function attestRectAreaLightContract(
  nodes: readonly Node[],
  evidence: readonly RectAreaLightContractEvidence[] | undefined,
): void {
  // Undefined is the generic-GLB seam. Blendlink sync always supplies the
  // Blender light contract (including an empty array), so an unexpected or
  // optimizer-dropped descriptor cannot bypass attestation there.
  if (evidence === undefined) return
  const byName = new Map<string, Node[]>()
  for (const node of nodes) {
    const entries = byName.get(node.getName()) ?? []
    entries.push(node)
    byName.set(node.getName(), entries)
  }
  const sourceNames = new Set<string>()
  const expectedNodes = new Set<Node>()
  for (const entry of evidence) {
    if (!entry.sourceObjectName || !entry.nodeName) {
      throw new Error('Rect Area finalized-node evidence needs non-empty sourceObjectName and nodeName.')
    }
    if (sourceNames.has(entry.sourceObjectName)) {
      throw new Error(
        `Rect Area finalized-node evidence duplicates source object "${entry.sourceObjectName}".`,
      )
    }
    sourceNames.add(entry.sourceObjectName)
    assertRectAreaDescriptor(
      entry.descriptor,
      `Rect Area evidence for "${entry.sourceObjectName}"`,
    )
    const matches = byName.get(entry.nodeName) ?? []
    if (matches.length !== 1) {
      throw new Error(
        `Rect Area source "${entry.sourceObjectName}" requires exactly one finalized node named ` +
          `"${entry.nodeName}", but the optimized GLB contains ${matches.length}.`,
      )
    }
    const node = matches[0]!
    if (expectedNodes.has(node)) {
      throw new Error(`Rect Area finalized node "${entry.nodeName}" is claimed by more than one source.`)
    }
    expectedNodes.add(node)
    const actual = node.getExtras()[RECT_AREA_DESCRIPTOR_KEY]
    assertRectAreaDescriptor(actual, `Rect Area finalized node "${entry.nodeName}" descriptor`)
    if (!isDeepStrictEqual(actual, entry.descriptor)) {
      throw new Error(
        `Rect Area descriptor for "${entry.sourceObjectName}" changed between Blender attachment and ` +
          'the optimized GLB. Rebuild without an extras-dropping transform.',
      )
    }
  }
  for (const node of nodes) {
    const extras = node.getExtras()
    if (!own(extras, RECT_AREA_DESCRIPTOR_KEY)) continue
    if (!expectedNodes.has(node)) {
      throw new Error(
        `Optimized GLB node "${node.getName()}" contains an unattested ${RECT_AREA_DESCRIPTOR_KEY} ` +
          'descriptor. Re-export so Blender can prove its authored source.',
      )
    }
  }
}

export const MANIFEST_SCHEMA_VERSION = 3 as const

const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a

/** Preserve the inspector's unknown-residency state. Zero textures is a
 * known zero; one uninspectable texture makes the aggregate unknown. */
export function sumKnownGpuTextureBytes(
  textures: readonly { gpuSize: number | null }[],
): number | undefined {
  return textures.every((texture) => texture.gpuSize !== null)
    ? textures.reduce((sum, texture) => sum + (texture.gpuSize as number), 0)
    : undefined
}

/** Sum the exact uncompressed output size declared by every Meshopt buffer
 * view. This is compiler-only scheduling evidence; it does not reshape the
 * public manifest schema. */
export function meshoptDecodedBytesFromGlb(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < 20) throw new Error('Cannot inspect Meshopt bytes: GLB header is truncated.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('Cannot inspect Meshopt bytes: input is not a binary glTF (GLB).')
  }
  if (view.getUint32(4, true) !== 2) {
    throw new Error(`Cannot inspect Meshopt bytes: unsupported GLB version ${view.getUint32(4, true)}.`)
  }
  const declaredLength = view.getUint32(8, true)
  if (declaredLength > bytes.byteLength || declaredLength < 20) {
    throw new Error('Cannot inspect Meshopt bytes: declared GLB length is invalid.')
  }

  let jsonText: string | undefined
  let offset = 12
  while (offset + 8 <= declaredLength) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > declaredLength) {
      throw new Error('Cannot inspect Meshopt bytes: a GLB chunk exceeds the file boundary.')
    }
    if (chunkType === GLB_JSON_CHUNK) {
      jsonText = new TextDecoder().decode(bytes.subarray(chunkStart, chunkEnd))
        .replace(/[\u0000\u0020]+$/u, '')
      break
    }
    offset = chunkEnd
  }
  if (jsonText === undefined) throw new Error('Cannot inspect Meshopt bytes: GLB has no JSON chunk.')

  const json = JSON.parse(jsonText) as { bufferViews?: unknown }
  if (!Array.isArray(json.bufferViews)) return undefined
  let found = false
  let total = 0
  for (const [index, candidate] of json.bufferViews.entries()) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const extensions = (candidate as { extensions?: unknown }).extensions
    if (typeof extensions !== 'object' || extensions === null) continue
    const meshopt = (extensions as Record<string, unknown>).EXT_meshopt_compression
    if (meshopt === undefined) continue
    if (typeof meshopt !== 'object' || meshopt === null) {
      throw new Error(`Meshopt bufferView ${index} has invalid extension metadata.`)
    }
    found = true
    const count = (meshopt as Record<string, unknown>).count
    const byteStride = (meshopt as Record<string, unknown>).byteStride
    if (!Number.isSafeInteger(count) || (count as number) < 0
        || !Number.isSafeInteger(byteStride) || (byteStride as number) <= 0) {
      throw new Error(
        `Meshopt bufferView ${index} must declare a non-negative integer count and positive integer byteStride.`,
      )
    }
    const decodedBytes = (count as number) * (byteStride as number)
    if (!Number.isSafeInteger(decodedBytes) || !Number.isSafeInteger(total + decodedBytes)) {
      throw new Error(`Meshopt bufferView ${index} decoded byte size exceeds JavaScript's safe integer range.`)
    }
    total += decodedBytes
  }
  return found ? total : undefined
}

export interface SceneManifest {
  generator: 'blendlink'
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  /** Content hash of the GLB — cache-busting key and drift signal. */
  hash: string
  /** Exact compiler-owned runtime request graph. This is evidence for future
   * directory addressing; it does not by itself make the current directory
   * immutable. */
  runtimeAssetGraph?: SceneAssetGraph
  /** Activation pointer for the sealed, never-mutated runtime graph. Generated
   * source remains the mutable application build-time pointer. */
  runtimeAssetPublication?: SceneRuntimePublication
  /** Exact generated module bytes. A failed post-export stage must never let
   * a stale/partial module pass the next compile's unchanged-scene gate. */
  generatedModuleHash?: string
  url: string
  sourceBlend?: string
  /** Exact source location is private when the .blend is outside the project. */
  sourceBlendLocalPathKey?: string
  sourceHash?: string
  /** Exact loaded Blendlink config bytes that produced this publication.
   * Additive integration evidence; absent for generic/external typegen. */
  configSourceHash?: string
  externalDependencies?: GeneratedExternalDependency[]
  /** Hash of the .blend bytes alone — lets Blender-free CI detect drift. */
  blendBytesHash?: string
  /** Command that regenerates these artifacts — surfaced by the Blender
   * addon when the saved .blend is ahead of the last sync. */
  syncHint?: string
  nodes: Array<{ name: string; kind: NodeKind; id?: string; extras?: Record<string, unknown> }>
  /** Stable Blender-authored object ID -> loaded three.js name. */
  identities?: Record<string, { name: string; kind: NodeKind }>
  materials: string[]
  /** Clip name → duration in seconds (from sampler inputs). */
  clips: Record<string, { duration: number }>
  /** Scene timeline markers as named seconds (scroll-scrub waypoints). */
  markers: Record<string, number>
  curves: Record<string, CurveData>
  vocabulary: Vocabulary
  /** Runtime node identity aligned by index with vocabulary.colliders. */
  colliderNodes?: Array<{ loadedName: string; id?: string }>
  /** Portable LOD, instancing, and procedural compiler evidence. */
  /** Originated as an additive schema-v2 field and remains part of v3. */
  sceneDiagnostics?: SceneDiagnostics
  /** Objects removed by -noimp (reported, never silent). */
  excluded: string[]
  stats: {
    bytes: number
    triangles: number
    meshes: number
    texturesBytes: number
    /** Metrics that originated additively in schema v2. */
    gpuTextureBytes?: number
    animationBytes?: number
    drawCallsEstimate?: number
    environmentBytes?: number
    optimizedEnvironmentBytes?: number
    reflectionProbeBytes?: number
    /** Published baked-atlas delivery derivatives. This counts their actual
     * transfer bytes, not GPU residency (lossless WebP still uploads RGBA). */
    deliveryBytes?: number
    deliverySavedBytes?: number
  }
  optimization?: OptimizationReport
  /** Slot-aware KTX2 results, including decoded-image fidelity measurements. */
  textureCompression?: TextureCompressionReport
  /** Exact baked-atlas delivery transforms. The canonical PNGs remain the
   * incremental-bake and conservative fallback authority. */
  atlasDelivery?: AtlasDeliveryReport
  /** Canonical source URL -> ordered, verified delivery alternatives. */
  textureVariants?: Record<string, TextureDeliveryVariant[]>
  /** True when the decoded GLB itself declares KHR_texture_basisu. This is
   * independent of Blendlink's optional compression report: external GLBs
   * can already contain required KTX2 textures. */
  requiresKtx2?: true
  /** True when the decoded GLB itself requires EXT_meshopt_compression.
   * External pipelines can publish Meshopt without a Blendlink optimization
   * report, but Three's GLTFLoader still needs the official decoder. */
  requiresMeshopt?: true
  textureTransforms?: TextureTransformReport[]
  /** Baked-mode state textures (lighting states swapped at runtime).
   * Single-atlas scenes carry `url`; multi-atlas scenes carry `atlases`
   * (atlas group → url). The entry marked default is installed by the owned
   * runtime recipe; Appearance also embeds that first state in the GLB.
   * Full runtime contract: docs/MANIFEST.md. */
  states?: Record<string, { url?: string; atlases?: Record<string, string>; default?: true }>
  /** Atlas output intent. Absent entries preserve the legacy appearance-map
   * behavior; lighting atlases are installed as Three light maps. */
  bakeOutputs?: Record<string, 'appearance' | 'lighting'>
  /** GLB-carried surface atlases: evidence, not a binding contract. */
  materialAtlases?: Record<string, {
    channels: Record<string, { sha256: string }>
    strength: number
    hasAlpha: boolean
    reused: boolean
  }>
  /** Required decode scale for every normalized Lighting state/atlas pair;
   * optional for Appearance, where omission preserves the legacy scale 1. */
  stateScales?: Record<string, Record<string, number>>
  /** Additive visibility companion for states that hide Blender collections. */
  stateVisibility?: Record<string, {
    hiddenObjectIds: string[]
    hiddenObjectNames: string[]
  }>
  /** Interactive light groups: additive contribution layers. Runtime:
   * color = state + Σ layer * maxValue * tint * strength, linear space.
   * Flat {url, maxValue} for single-atlas; `atlases` map otherwise. */
  lightGroups?: Record<string, {
    url?: string
    maxValue?: number
    atlases?: Record<string, { url: string; maxValue: number }>
  }>
  /** The byte-exact HDR/EXR is always the fallback. `optimized`, when
   * present, passed a decoded scene-linear radiance gate and is preferred
   * only by a runtime supplied with Three r180+ KTX2Loader. */
  environment?: {
    url: string
    sourceName: string
    format: 'hdr' | 'exr'
    bytes: number
    hash: string
    source: 'packed' | 'linked'
    optimized?: Omit<EnvironmentCompressionAsset, 'path'> & { url: string }
  }
  /** The per-channel TSL IR programs sidecar (Phase 4 material runtime
   * transport). Absent when no compiled material carries IR. */
  materialPrograms?: {
    url: string
    bytes: number
    hash: string
    materials: number
  }
  /** Exact equirectangular sources for baked/custom local reflection probes.
   * Runtime capture probes intentionally have no entry. */
  reflectionProbeAssets?: Record<string, {
    url: string
    sourceName: string
    mode: 'baked' | 'custom'
    format: 'hdr' | 'exr' | 'png' | 'jpeg' | 'webp'
    colorSpace: 'linear' | 'srgb'
    width: number
    height: number
    bytes: number
    hash: string
    source: 'packed' | 'linked'
    sourceHash?: string
  }>
  /** Wall-clock of the last sync — powers plan-time estimates. */
  lastSyncDurationMs?: number
  /** Combined hash of the declared extra input files (external scenes). */
  inputsHash?: string
  /** True when produced by `sync --draft` (quarter res) — never commit. */
  draft?: boolean
  /** Baked mode: the last sync's bake plan (density, shares, weights) —
   * the addon shows per-object numbers next to the Lightmap Scale slider. */
  bakePlan?: BakePlan
  /** Opaque, conservative atlas-job dependency hashes used by the next sync. */
  bakeFingerprints?: BakeFingerprints
  /** Exact bytes identity for every state/light-group × atlas PNG. */
  bakeArtifactHashes?: BakeArtifactHashes
  /** Artist-facing result of the most recent dependency-aware bake. */
  incrementalBake?: IncrementalBakeReport
  /** Artist-owned visual recipe copied from the .blend for inspection and adapters. */
  recipe?: SceneRecipe
  /** Compiled one-track NLA schedule; clips remain ordinary glTF animations. */
  animationSequence?: AnimationSequenceRecipe
  /** Additive Blender display evidence consumed only by opted-in authoring
   * previews. Website presentation ownership remains in `recipe`. */
  authoringPreview?: AuthoringPreview
  /** Portable component records are duplicated beside the recipe so generic
   * consumers need not understand Blender's complete recipe surface. */
  components?: PortableComponentRecord[]
  presentation?: PresentationMode
}

export type NodeKind = 'Mesh' | 'SkinnedMesh' | 'Group' | 'Bone' | 'Camera' | 'Light' | 'Object3D'

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
  /** Exact machine-local paths to persist outside commit-ready artifacts. */
  localProvenance: LocalPathProvenance[]
}

function validateBakedOutputContract(
  nodes: SceneManifest['nodes'],
  states: SceneManifest['states'] | undefined,
  bakeOutputs: SceneManifest['bakeOutputs'] | undefined,
  stateScales: SceneManifest['stateScales'] | undefined,
): void {
  const atlasesByState = new Map<string, Set<string>>()
  const knownAtlases = new Set<string>()
  for (const [stateName, state] of Object.entries(states ?? {})) {
    const atlases = new Set(state.url !== undefined ? ['main'] : Object.keys(state.atlases ?? {}))
    atlasesByState.set(stateName, atlases)
    for (const atlas of atlases) knownAtlases.add(atlas)
  }

  for (const [atlas, output] of Object.entries(bakeOutputs ?? {})) {
    if (output !== 'appearance' && output !== 'lighting') {
      throw new Error(
        `Baked atlas "${atlas}" has unsupported output ${JSON.stringify(output)}; ` +
          'expected "appearance" or "lighting".',
      )
    }
    if (!knownAtlases.has(atlas)) {
      throw new Error(
        `Baked output metadata references atlas "${atlas}", but no baked state publishes that atlas.`,
      )
    }
  }

  for (const [stateName, scales] of Object.entries(stateScales ?? {})) {
    const stateAtlases = atlasesByState.get(stateName)
    if (!stateAtlases) {
      throw new Error(`Baked state scale metadata references missing state "${stateName}".`)
    }
    for (const [atlas, scale] of Object.entries(scales)) {
      if (!stateAtlases.has(atlas)) {
        throw new Error(
          `Baked state "${stateName}" has a scale for missing atlas "${atlas}".`,
        )
      }
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
        throw new Error(
          `Baked state "${stateName}" atlas "${atlas}" has invalid scale ${String(scale)}; ` +
            'state scales must be finite and greater than zero.',
        )
      }
    }
  }

  for (const [stateName, atlases] of atlasesByState) {
    for (const atlas of atlases) {
      if (bakeOutputs?.[atlas] !== 'lighting') continue
      const scale = stateScales?.[stateName]?.[atlas]
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
        throw new Error(
          `Lighting atlas "${atlas}" in state "${stateName}" has no finite positive state scale. ` +
            'Re-sync the scene; Lighting atlases cannot use the legacy implicit scale.',
        )
      }
    }
  }

  for (const node of nodes) {
    const extras = node.extras
    if (!extras) continue
    const atlas = extras.blendlink_atlas
    const authoredOutput = extras.blendlink_bake_output
    const lightmapUv = extras.blendlink_lightmap_uv
    if (authoredOutput !== undefined &&
        authoredOutput !== 'appearance' && authoredOutput !== 'lighting') {
      throw new Error(
        `Baked node "${node.name}" has unsupported blendlink_bake_output ` +
          `${JSON.stringify(authoredOutput)}; expected "appearance" or "lighting".`,
      )
    }
    if (lightmapUv !== undefined &&
        (!Number.isInteger(lightmapUv) || (lightmapUv as number) < 1 || (lightmapUv as number) > 3)) {
      throw new Error(
        `Baked node "${node.name}" has invalid blendlink_lightmap_uv ${String(lightmapUv)}; ` +
          'expected glTF TEXCOORD channel 1, 2, or 3.',
      )
    }
    if (typeof atlas !== 'string' || atlas.length === 0) {
      if (authoredOutput === 'lighting' || lightmapUv !== undefined) {
        throw new Error(
          `Lighting node "${node.name}" has no non-empty blendlink_atlas assignment.`,
        )
      }
      continue
    }
    const declaredOutput = bakeOutputs?.[atlas]
    if (authoredOutput !== undefined && declaredOutput !== undefined && authoredOutput !== declaredOutput) {
      throw new Error(
        `Baked node "${node.name}" declares ${authoredOutput} output, but atlas "${atlas}" ` +
          `is declared ${declaredOutput}. Re-sync so object and manifest metadata agree.`,
      )
    }
    if ((authoredOutput ?? declaredOutput) === 'lighting' && lightmapUv === undefined) {
      throw new Error(
        `Lighting node "${node.name}" has no blendlink_lightmap_uv. ` +
          'Re-sync so Blendlink can bind its baked texture to the authored UV channel.',
      )
    }
    if (authoredOutput === 'lighting' && declaredOutput === undefined) {
      throw new Error(
        `Lighting node "${node.name}" belongs to atlas "${atlas}", but bakeOutputs has no ` +
          'Lighting entry for that atlas. Re-sync the scene.',
      )
    }
  }
}

function validateBakedPrimitiveContract(
  sourceNodes: readonly Node[],
  bakeOutputs: SceneManifest['bakeOutputs'] | undefined,
): void {
  const materialBindings = new Map<Material, { signature: string; description: string }>()
  for (const node of sourceNodes) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const extras = node.getExtras() as Record<string, unknown>
    const atlas = typeof extras.blendlink_atlas === 'string' && extras.blendlink_atlas.length > 0
      ? extras.blendlink_atlas
      : null
    const authoredOutput = extras.blendlink_bake_output
    const output = atlas
      ? (authoredOutput === 'appearance' || authoredOutput === 'lighting'
          ? authoredOutput
          : bakeOutputs?.[atlas] ?? 'appearance')
      : 'realtime'
    const lightmapUv = output === 'lighting'
      ? extras.blendlink_lightmap_uv as number
      : null
    const description = output === 'realtime'
      ? `Realtime node "${node.getName()}"`
      : `${output === 'lighting' ? 'Lighting' : 'Appearance'} node "${node.getName()}" ` +
        `in atlas "${atlas}"${output === 'lighting' ? ` on TEXCOORD_${lightmapUv}` : ''}`
    const signature = output === 'realtime'
      ? 'realtime'
      : `${output}:${atlas}:${lightmapUv ?? '-'}`

    for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
      const material = primitive.getMaterial()
      if (output === 'lighting') {
        const texcoord = primitive.getAttribute(`TEXCOORD_${lightmapUv}`)
        if (!texcoord) {
          throw new Error(
            `${description} primitive ${primitiveIndex} is missing TEXCOORD_${lightmapUv}. ` +
              'The exported lightmap UV channel drifted or was removed after Blender stamped it.',
          )
        }
        if (!material) {
          throw new Error(
            `${description} primitive ${primitiveIndex} has no authored PBR material. ` +
              'Lighting output must preserve a material for Three lightMap composition.',
          )
        }
        if (material.getExtension('KHR_materials_unlit')) {
          throw new Error(
            `${description} primitive ${primitiveIndex} uses KHR_materials_unlit. ` +
              'Lighting output requires a PBR material; choose Bake Appearance for flattened materials.',
          )
        }
      }
      if (output !== 'realtime') {
        const textureInfo = output === 'appearance'
          ? material?.getBaseColorTextureInfo() ?? material?.getEmissiveTextureInfo()
          : null
        const semantic = output === 'lighting'
          ? `TEXCOORD_${lightmapUv}`
          : textureInfo ? `TEXCOORD_${textureInfo.getTexCoord()}` : null
        if (semantic) {
          validateBakedTriangleUvs(
            primitive,
            semantic,
            description,
            primitiveIndex,
            node.getWorldMatrix(),
          )
        }
      }
      if (!material) continue
      const previous = materialBindings.get(material)
      if (previous && previous.signature !== signature) {
        throw new Error(
          `Final glTF material "${material.getName() || '(unnamed)'}" is shared across incompatible ` +
            `bake bindings: ${previous.description} and ${description}. ` +
            'Re-sync so Blendlink can fork the material before runtime state composition.',
        )
      }
      materialBindings.set(material, { signature, description })
    }
  }
}

function validateBakedTriangleUvs(
  primitive: Primitive,
  semantic: string,
  description: string,
  primitiveIndex: number,
  worldMatrix: readonly number[],
): void {
  const float32TriangleQualityFloor = 16 * (2 ** -23)
  const position = primitive.getAttribute('POSITION')
  const uv = primitive.getAttribute(semantic)
  if (!position || !uv) return
  const indices = primitive.getIndices()
  const count = indices?.getCount() ?? position.getCount()
  const vertexAt = (offset: number): number => indices?.getScalar(offset) ?? offset
  const triangles: Array<[number, number, number]> = []
  if (primitive.getMode() === 4) {
    for (let offset = 0; offset + 2 < count; offset += 3) {
      triangles.push([vertexAt(offset), vertexAt(offset + 1), vertexAt(offset + 2)])
    }
  } else if (primitive.getMode() === 5) {
    for (let offset = 0; offset + 2 < count; offset += 1) {
      triangles.push([vertexAt(offset), vertexAt(offset + 1), vertexAt(offset + 2)])
    }
  } else if (primitive.getMode() === 6 && count >= 3) {
    const first = vertexAt(0)
    for (let offset = 1; offset + 1 < count; offset += 1) {
      triangles.push([first, vertexAt(offset), vertexAt(offset + 1)])
    }
  } else {
    return
  }

  const points = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const uvs = [[0, 0], [0, 0], [0, 0]]
  triangles.forEach((triangle, triangleIndex) => {
    triangle.forEach((vertex, corner) => {
      position.getElement(vertex, points[corner]!)
      uv.getElement(vertex, uvs[corner]!)
    })
    const transformDirection = (vector: number[]): number[] => [
      worldMatrix[0]! * vector[0]! + worldMatrix[4]! * vector[1]! + worldMatrix[8]! * vector[2]!,
      worldMatrix[1]! * vector[0]! + worldMatrix[5]! * vector[1]! + worldMatrix[9]! * vector[2]!,
      worldMatrix[2]! * vector[0]! + worldMatrix[6]! * vector[1]! + worldMatrix[10]! * vector[2]!,
    ]
    // Translation cancels for edge vectors. Applying only the world linear
    // transform also avoids subtracting large translated positions, and
    // catches non-uniform node scales that make a local sliver visible.
    const ab = transformDirection(
      points[1]!.map((value, axis) => value - points[0]![axis]!),
    )
    const ac = transformDirection(
      points[2]!.map((value, axis) => value - points[0]![axis]!),
    )
    const bc = transformDirection(
      points[2]!.map((value, axis) => value - points[1]![axis]!),
    )
    const cross = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ]
    const geometryAreaSquared = cross.reduce((sum, value) => sum + value * value, 0)
    const edgeSquared = [
      ab.reduce((sum, value) => sum + value * value, 0),
      ac.reduce((sum, value) => sum + value * value, 0),
      bc.reduce((sum, value) => sum + value * value, 0),
    ].reduce((sum, value) => sum + value, 0)
    const geometryDoubleArea = Math.sqrt(geometryAreaSquared)
    const geometryQuality = edgeSquared > 0
      ? 2 * Math.sqrt(3) * geometryDoubleArea / edgeSquared
      : 0
    const uvDoubleArea = Math.abs(
      (uvs[1]![0]! - uvs[0]![0]!) * (uvs[2]![1]! - uvs[0]![1]!) -
      (uvs[1]![1]! - uvs[0]![1]!) * (uvs[2]![0]! - uvs[0]![0]!),
    )
    if (geometryQuality > float32TriangleQualityFloor && uvDoubleArea === 0) {
      throw new Error(
        `${description} primitive ${primitiveIndex} triangle ${triangleIndex} has non-zero geometry ` +
          `but a zero-area ${semantic} triangle. A modifier-generated baked face collapsed onto an ` +
          'atlas line; re-sync so Blendlink can repair unpinned UVs or report the pinned island.',
      )
    }
  })
}

const THREE_TYPE: Record<NodeKind, string> = {
  Mesh: 'THREE.Mesh',
  SkinnedMesh: 'THREE.SkinnedMesh',
  Group: 'THREE.Group',
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
  /** Root used to make source/dependency provenance commit-safe. */
  provenanceRoot?: string
  sourceHash?: string
  configSourceHash?: string
  sidecar?: BlendSidecar
  /** Exact Blender finalized-node evidence. Supplying an empty array attests
   * that this Blendlink export contains no authored Rect Area descriptors. */
  rectAreaLightContract?: readonly RectAreaLightContractEvidence[]
  excluded?: string[]
  states?: SceneManifest['states']
  bakeOutputs?: SceneManifest['bakeOutputs']
  materialAtlases?: SceneManifest['materialAtlases']
  stateScales?: SceneManifest['stateScales']
  stateVisibility?: SceneManifest['stateVisibility']
  lightGroups?: SceneManifest['lightGroups']
  bakeFingerprints?: SceneManifest['bakeFingerprints']
  bakeArtifactHashes?: SceneManifest['bakeArtifactHashes']
  incrementalBake?: SceneManifest['incrementalBake']
  environment?: SceneManifest['environment']
  materialPrograms?: SceneManifest['materialPrograms']
  reflectionProbeAssets?: SceneManifest['reflectionProbeAssets']
  recipe?: SceneRecipe
  optimization?: OptimizationReport
  textureCompression?: TextureCompressionReport
  atlasDelivery?: AtlasDeliveryReport
  textureVariants?: SceneManifest['textureVariants']
  textureTransforms?: TextureTransformReport[]
  bakePlan?: BakePlan
  runtimeAssetGraph?: SceneAssetGraph
}): Promise<TypegenOutput> {
  await MeshoptDecoder.ready
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const glbBytes = readFileSync(options.glbPath)
  const rawGltf = readGlbJson(glbBytes, `Scene "${options.exportName}"`)
  assertGltfRuntimeCompatibility(rawGltf, BLENDLINK_THREE_R184_COMPILED_PROFILE)
  const meshoptDecodedBytes = meshoptDecodedBytesFromGlb(glbBytes)
  const document = await io.readBinary(new Uint8Array(glbBytes))
  const root = document.getRoot()
  const recipeSequence = options.recipe?.animationSequence
  const sidecarSequence = options.sidecar?.animationSequence
  if (recipeSequence && sidecarSequence
      && JSON.stringify(recipeSequence) !== JSON.stringify(sidecarSequence)) {
    throw new Error(
      'Animation Sequence differs between the scene recipe and Blender sidecar. ' +
        'Save the .blend and rebuild so one authored NLA schedule reaches publication.',
    )
  }
  const animationSequence = recipeSequence ?? sidecarSequence
  const requiresKtx2 = root.listExtensionsRequired()
    .some((extension) => extension.extensionName === 'KHR_texture_basisu')
  const requiresMeshopt = root.listExtensionsRequired()
    .some((extension) => extension.extensionName === 'EXT_meshopt_compression')
  const bakePlan = options.bakePlan
    ? {
        ...options.bakePlan,
        ...(options.bakePlan.atlasLayout
          ? { atlasLayout: finalizeAtlasLayoutEvidence(document, options.bakePlan.atlasLayout) }
          : {}),
      }
    : undefined

  const sourceNodes = root.listNodes()
  attestRectAreaLightContract(sourceNodes, options.rectAreaLightContract)
  const parentOf = new Map<Node, Node>()
  for (const node of sourceNodes) {
    for (const child of node.listChildren()) parentOf.set(child, node)
  }

  const nodes: SceneManifest['nodes'] = []
  const sanitizeNotes: string[] = []
  const vocabularyInput: VocabularyNodeInput[] = []
  const identities: NonNullable<SceneManifest['identities']> = {}
  const loadedBindingByRaw = new Map<string, { loadedName: string; id?: string }>()
  const loadedNames = allocateLoadedNodeNames(document)
  for (const [nodeIndex, node] of sourceNodes.entries()) {
    const raw = node.getName()
    if (!raw) {
      const extras = node.getExtras()
      const authoredProperties = Object.keys(extras).filter(
        (property) => property.startsWith('blendlink_') || property.startsWith('web_'),
      )
      if (authoredProperties.length > 0) {
        throw new Error(
          `Blendlink cannot publish anonymous glTF node ${nodeIndex} with authored properties ` +
            `${authoredProperties.map((property) => JSON.stringify(property)).join(', ')}. ` +
            'Name the object in Blender or the source exporter so its website behavior has a deterministic binding.',
        )
      }
      const meshName = node.getMesh()?.getName()
      sanitizeNotes.push(
        `anonymous glTF node ${nodeIndex}${meshName ? ` (mesh "${meshName}")` : ''} is omitted ` +
          'from typed name bindings; it still loads and renders. Name it at the source if website code must address it.',
      )
      continue
    }
    // The typed map keys must be the names three.js REPORTS after load:
    // GLTFLoader sanitizes node names (dots stripped, spaces to _), so a
    // raw "Crate.001" key would type-check and then return undefined from
    // getObjectByName — the exact silent failure the tool exists to kill.
    const name = loadedNames.get(node)
    if (!name) {
      throw new Error(`Blendlink could not allocate a loaded name for authored node "${raw}".`)
    }
    if (name !== raw) {
      sanitizeNotes.push(
        `node "${raw}" loads as "${name}" in three.js (loader-sanitized) — the typed map uses the loaded name.`,
      )
    }
    const mesh = node.getMesh()
    const kind: NodeKind = mesh && mesh.listPrimitives().length > 1
      ? 'Group'
      : node.getSkin()
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
    const id = typeof extras?.blendlink_id === 'string' ? extras.blendlink_id : undefined
    loadedBindingByRaw.set(raw, { loadedName: name, ...(id ? { id } : {}) })
    if (id && identities[id]) {
      throw new Error(
        `Duplicate blendlink_id "${id}" on "${raw}" and "${identities[id]!.name}". ` +
        'Run Set Up Blendlink Scene in Blender to repair stable IDs before publishing.',
      )
    } else if (id) {
      identities[id] = { name, kind }
    }
    const entry = {
      name,
      kind,
      ...(id ? { id } : {}),
      ...(hasExtras ? { extras: extras as Record<string, unknown> } : {}),
    }
    nodes.push(entry)
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

  const probeIds = new Set(options.recipe?.reflectionProbes.map((probe) => probe.objectId) ?? [])
  for (const probe of options.recipe?.reflectionProbes ?? []) {
    if (!identities[probe.objectId]) {
      throw new Error(
        `reflection probe "${probe.name}" (${probe.objectName}) was not exported; ` +
          'ensure its helper empty is included in the exported collection',
      )
    }
    if (probe.anchorId && !identities[probe.anchorId]) {
      throw new Error(
        `reflection probe "${probe.name}" anchor "${probe.anchorName ?? probe.anchorId}" was not exported`,
      )
    }
    const asset = options.reflectionProbeAssets?.[probe.id]
    if (probe.source === 'runtime' && asset) {
      throw new Error(`runtime reflection probe "${probe.name}" unexpectedly published a texture asset`)
    }
    if (probe.source !== 'runtime' && !asset) {
      throw new Error(
        `${probe.source} reflection probe "${probe.name}" has no published texture asset`,
      )
    }
    if (asset && asset.mode !== probe.source) {
      throw new Error(
        `reflection probe "${probe.name}" source ${probe.source} disagrees with asset mode ${asset.mode}`,
      )
    }
    if (asset && probe.source !== 'runtime') {
      const texture = probe.texture
      if (!texture) {
        throw new Error(`reflection probe "${probe.name}" has no authored texture evidence`)
      }
      if (asset.sourceName !== texture.imageName || asset.width !== texture.width
          || asset.height !== texture.height || asset.format !== texture.format
          || asset.colorSpace !== texture.colorSpace) {
        throw new Error(
          `reflection probe "${probe.name}" published texture disagrees with its authored image evidence`,
        )
      }
      if (probe.source === 'baked'
          && (asset.hash !== texture.contentHash || asset.sourceHash !== texture.sourceHash)) {
        throw new Error(
          `reflection probe "${probe.name}" published bytes/source hash disagree with its Blender Bake evidence`,
        )
      }
    }
  }
  const authoredProbeIds = new Set(
    options.recipe?.reflectionProbes.map((probe) => probe.id) ?? [],
  )
  for (const assetId of Object.keys(options.reflectionProbeAssets ?? {})) {
    if (!authoredProbeIds.has(assetId)) {
      throw new Error(`published reflection texture ${assetId} has no authored reflection probe`)
    }
  }
  for (const [state, visibility] of Object.entries(options.stateVisibility ?? {})) {
    for (const id of visibility.hiddenObjectIds) {
      if (!identities[id]) {
        throw new Error(
          `Baked state "${state}" references object ID "${id}" outside the exported GLB. ` +
          'Keep state collections inside the configured export collection and rebuild.',
        )
      }
    }
    for (const rawName of visibility.hiddenObjectNames) {
      if (!loadedBindingByRaw.has(rawName)) {
        throw new Error(
          `Baked state "${state}" references object "${rawName}" outside the exported GLB. ` +
          'Keep state collections inside the configured export collection and rebuild.',
        )
      }
    }
  }
  for (const node of nodes) {
    const assignedProbe = node.extras?.blendlink_reflection_probe
    if (assignedProbe !== undefined && (typeof assignedProbe !== 'string' || !probeIds.has(assignedProbe))) {
      throw new Error(
        `node "${node.name}" references missing reflection probe ${String(assignedProbe)}; ` +
          'reassign it in Blender before publishing',
      )
    }
  }

  validateBakedOutputContract(nodes, options.states, options.bakeOutputs, options.stateScales)
  validateBakedPrimitiveContract(sourceNodes, options.bakeOutputs)

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
  if (animationSequence) {
    validateAnimationSequenceClips(animationSequence, clips)
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
  const colliderNodes = vocabularyInput.flatMap((input) =>
    parseVocabulary([input], options.sidecar).colliders.map(() => {
      const binding = loadedBindingByRaw.get(input.name)
      if (!binding) throw new Error(`Collider ${input.name} has no exported runtime node binding.`)
      return binding
    }),
  )
  if (colliderNodes.length !== vocabulary.colliders.length) {
    throw new Error('Collider runtime bindings drifted from the parsed vocabulary order.')
  }
  vocabulary.warnings.push(...sanitizeNotes)
  const sceneDiagnostics = compileSceneDiagnostics(
    document, vocabulary, options.sidecar?.diagnostics, options.recipe?.camera,
  )
  const authoredOrthographicAspectWarning =
    sceneDiagnostics.camera?.authoredOrthographicAspect.warning
  if (authoredOrthographicAspectWarning) {
    vocabulary.warnings.push(authoredOrthographicAspectWarning)
  }

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
  const inspection = inspect(document)
  // Zero textures is known-zero. A texture whose decoded dimensions/format
  // could not be inspected is unknown, not a zero-byte GPU allocation.
  const gpuTextureBytes = sumKnownGpuTextureBytes(inspection.textures.properties)
  const animationBytes = inspection.animations.properties.reduce(
    (sum, animation) => sum + animation.size,
    0,
  )
  const drawCallsEstimate = inspection.meshes.properties.reduce(
    (sum, mesh) => sum + mesh.meshPrimitives * Math.max(1, mesh.instances),
    0,
  )

  const provenance = prepareGeneratedProvenance({
    projectRoot: options.provenanceRoot ?? process.cwd(),
    sourceBlend: options.sourceBlend,
    externalDependencies: options.sidecar?.externalDependencies,
  })
  const manifest: SceneManifest = {
    generator: 'blendlink',
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    hash: createHash('sha256').update(glbBytes).digest('hex').slice(0, 16),
    url: options.url,
    ...(provenance.sourceBlend ? { sourceBlend: provenance.sourceBlend } : {}),
    ...(provenance.sourceBlendLocalPathKey
      ? { sourceBlendLocalPathKey: provenance.sourceBlendLocalPathKey }
      : {}),
    ...(options.sourceHash ? { sourceHash: options.sourceHash } : {}),
    ...(options.configSourceHash
      ? { configSourceHash: options.configSourceHash }
      : {}),
    ...(provenance.externalDependencies.length
      ? { externalDependencies: provenance.externalDependencies }
      : {}),
    nodes,
    identities,
    materials,
    clips,
    markers,
    curves,
    vocabulary,
    ...(colliderNodes.length > 0 ? { colliderNodes } : {}),
    sceneDiagnostics,
    excluded: options.excluded ?? [],
    stats: {
      bytes: glbBytes.length,
      triangles,
      meshes,
      texturesBytes,
      ...(gpuTextureBytes !== undefined ? { gpuTextureBytes } : {}),
      animationBytes,
      drawCallsEstimate,
      ...(options.environment ? { environmentBytes: options.environment.bytes } : {}),
      ...(options.environment?.optimized
        ? { optimizedEnvironmentBytes: options.environment.optimized.bytes }
        : {}),
      ...(options.reflectionProbeAssets
        ? {
            reflectionProbeBytes: Object.values(options.reflectionProbeAssets)
              .reduce((sum, asset) => sum + asset.bytes, 0),
          }
        : {}),
      ...(options.atlasDelivery
        ? {
            deliveryBytes: options.atlasDelivery.outputBytes,
            deliverySavedBytes: options.atlasDelivery.savedBytes,
          }
        : {}),
    },
    ...(options.optimization ? { optimization: options.optimization } : {}),
    ...(options.textureCompression ? { textureCompression: options.textureCompression } : {}),
    ...(options.atlasDelivery ? { atlasDelivery: options.atlasDelivery } : {}),
    ...(options.textureVariants && Object.keys(options.textureVariants).length > 0
      ? { textureVariants: options.textureVariants }
      : {}),
    ...(requiresKtx2 ? { requiresKtx2: true as const } : {}),
    ...(requiresMeshopt ? { requiresMeshopt: true as const } : {}),
    ...(options.textureTransforms?.length ? { textureTransforms: options.textureTransforms } : {}),
    ...(options.runtimeAssetGraph ? { runtimeAssetGraph: options.runtimeAssetGraph } : {}),
    ...(options.states ? { states: options.states } : {}),
    ...(options.bakeOutputs ? { bakeOutputs: options.bakeOutputs } : {}),
    ...(Object.keys(options.materialAtlases ?? {}).length > 0
      ? { materialAtlases: options.materialAtlases }
      : {}),
    ...(options.stateScales ? { stateScales: options.stateScales } : {}),
    ...(options.stateVisibility ? { stateVisibility: options.stateVisibility } : {}),
    ...(options.lightGroups ? { lightGroups: options.lightGroups } : {}),
    ...(options.bakeFingerprints ? { bakeFingerprints: options.bakeFingerprints } : {}),
    ...(options.bakeArtifactHashes ? { bakeArtifactHashes: options.bakeArtifactHashes } : {}),
    ...(options.incrementalBake ? { incrementalBake: options.incrementalBake } : {}),
    ...(bakePlan ? { bakePlan } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.materialPrograms
      ? { materialPrograms: options.materialPrograms }
      : {}),
    ...(options.reflectionProbeAssets
      ? { reflectionProbeAssets: options.reflectionProbeAssets }
      : {}),
    ...(options.sidecar?.authoringPreview
      ? { authoringPreview: options.sidecar.authoringPreview }
      : {}),
    ...(options.recipe
      ? {
          recipe: options.recipe,
          components: options.recipe.components,
          presentation: options.recipe.presentation,
        }
      : {}),
    ...(animationSequence
      ? { animationSequence }
      : {}),
  }

  const module = renderModule(options.exportName, manifest, unlitMaterials, meshoptDecodedBytes)
  manifest.generatedModuleHash = createHash('sha256').update(module).digest('hex').slice(0, 16)
  return { manifest, module, localProvenance: provenance.localPaths }
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

const quote = (value: string) => JSON.stringify(value)
const key = (value: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : quote(value))
// TypeScript rejects `null as const` (TS1355), while object/array/string
// literals accept a const assertion. Generic Realtime GLBs have many absent
// optional recipe fields, so render their nulls directly. The containing
// descriptor still ends in `as const`, preserving the same public type.
const constJson = (value: unknown): string => value === null
  ? 'null'
  : `${JSON.stringify(value)} as const`

function versionedAssetUrl(url: string, hash: string | undefined): string {
  if (!hash) return url
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(hash)}`
}

function renderModule(
  exportName: string,
  manifest: SceneManifest,
  unlitMaterials: Set<string> = new Set(),
  meshoptDecodedBytes?: number,
): string {
  const pascalName = pascal(exportName)
  const nodeEntries = manifest.nodes
    .map((node) => `  ${key(node.name)}: ${quote(node.name)},`)
    .join('\n')
  const nodeIdEntries = manifest.nodes
    .filter((node) => node.id)
    .map((node) => `  ${key(node.name)}: ${quote(node.id!)},`)
    .join('\n')
  const nodeTypes = manifest.nodes
    .map((node) => `    ${key(node.name)}: ${THREE_TYPE[node.kind]}`)
    .join('\n')
  const extrasEntries = manifest.nodes
    .filter((node) => node.extras)
    .map((node) => `  ${key(node.name)}: ${JSON.stringify(node.extras)},`)
    .join('\n')
  const identityEntries = Object.entries(manifest.identities ?? {})
    .map(([id, identity]) => `  ${quote(id)}: ${quote(identity.name)},`)
    .join('\n')
  const reflectionProbeAssignmentEntries = manifest.nodes
    .filter((node) => typeof node.extras?.blendlink_reflection_probe === 'string')
    .map((node) => `  ${key(node.name)}: ${quote(node.extras!.blendlink_reflection_probe as string)},`)
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
  // Single-atlas entries stay ergonomic strings; multi-atlas entries carry
  // their full shape (the composition recipe consumes either).
  const stateEntries = Object.entries(manifest.states ?? {})
    .map(([name, state]) => {
      const hashes = manifest.bakeArtifactHashes?.states[name]
      const value = state.url !== undefined
        ? versionedAssetUrl(state.url, hashes?.main)
        : Object.fromEntries(Object.entries(state.atlases ?? {}).map(
            ([atlas, url]) => [atlas, versionedAssetUrl(url, hashes?.[atlas])],
          ))
      return `  ${key(name)}: ${JSON.stringify(value)},`
    })
    .join('\n')
  const lightGroupEntries = Object.entries(manifest.lightGroups ?? {})
    .map(([name, group]) => {
      const hashes = manifest.bakeArtifactHashes?.lightGroups[name]
      const value = group.url !== undefined
        ? { url: versionedAssetUrl(group.url, hashes?.main), maxValue: group.maxValue ?? 1 }
        : Object.fromEntries(Object.entries(group.atlases ?? {}).map(
            ([atlas, layer]) => [atlas, {
              ...layer,
              url: versionedAssetUrl(layer.url, hashes?.[atlas]),
            }],
          ))
      return `  ${key(name)}: ${JSON.stringify(value)},`
    })
    .join('\n')
  const defaultState = Object.entries(manifest.states ?? {})
    .find(([, state]) => state.default)?.[0] ?? Object.keys(manifest.states ?? {})[0] ?? null

  return `/* Generated by blendlink — do not edit. Source: ${manifest.sourceBlend ?? manifest.url} */
import type * as THREE from 'three'

export const ${exportName} = {
  url: ${quote(versionedAssetUrl(manifest.url, manifest.hash))},
  hash: ${quote(manifest.hash)},
  nodes: {
${nodeEntries}
  },
  /** Generated node key -> stable glTF extra used by runtime binders. */
  nodeIds: {
${nodeIdEntries}
  },
  /** Stable IDs survive Blender renames and hierarchy changes. */
  objectsById: {
${identityEntries}
  },
  /** Scene-owned web camera and responsive composition contract. */
  camera: ${constJson(manifest.recipe?.camera ?? null)},
  /** Artist-authored animation startup, loop, and speed intent. */
  playback: ${constJson(manifest.recipe?.playback ?? null)},
  /** One opt-in Blender NLA track, composed from the exported Action clips. */
  animationSequence: ${constJson(manifest.animationSequence ?? null)},
  /** Portable renderer look; application values remain explicitly application-owned. */
  look: ${constJson(manifest.recipe?.look ?? null)},
  /** Portable scene fog; application mode leaves the website untouched. */
  fog: ${constJson(manifest.recipe?.fog ?? null)},
  /** Scene-wide realtime shadow policy resolved from the artist preset. */
  shadows: ${constJson(manifest.recipe?.shadows ?? null)},
  /** Blender viewport evidence; ignored unless an authoring preview opts in. */
  authoringPreview: ${constJson(manifest.authoringPreview ?? null)},
  /** Image-based lighting/background intent and its published source asset. */
  environment: ${constJson(manifest.recipe?.environment ?? null)},
  environmentAsset: ${constJson(manifest.environment
    ? {
        ...manifest.environment,
        url: versionedAssetUrl(manifest.environment.url, manifest.environment.hash),
        ...(manifest.environment.optimized
          ? {
              optimized: {
                ...manifest.environment.optimized,
                url: versionedAssetUrl(
                  manifest.environment.optimized.url,
                  manifest.environment.optimized.hash,
                ),
              },
            }
          : {}),
      }
    : null)},
  /** The per-channel TSL IR programs sidecar (Phase 4 material runtime
   * transport): fetch by url, pin by hash. IR bodies never inline here. */
  materialPrograms: ${constJson(manifest.materialPrograms
    ? {
        ...manifest.materialPrograms,
        url: versionedAssetUrl(
          manifest.materialPrograms.url, manifest.materialPrograms.hash,
        ),
      }
    : null)},
  /** Named local reflection captures. Influence is metadata for capture or a
   * custom parallax adapter; renderer assignment is always explicit. */
  reflectionProbes: ${JSON.stringify(manifest.recipe?.reflectionProbes ?? [])} as const,
  /** Cache-keyed equirectangular sources for Blender Bake and Custom Texture probes. */
  reflectionProbeAssets: ${constJson(manifest.reflectionProbeAssets
    ? Object.fromEntries(Object.entries(manifest.reflectionProbeAssets).map(
        ([id, asset]) => [id, { ...asset, url: versionedAssetUrl(asset.url, asset.hash) }],
      ))
    : null)},
  /** Portable artist-authored behaviour records. Install only the adapters
   * your website owns; unknown vendor records remain available here. */
  components: ${JSON.stringify(manifest.components ?? manifest.recipe?.components ?? [])} as const,
  /** Loaded node name -> rename-stable reflection-probe object ID. */
  reflectionProbeAssignments: {
${reflectionProbeAssignmentEntries}
  },
  /** Deterministic post-export transforms applied to this exact GLB. */
  optimization: ${constJson(manifest.optimization ?? null)},
  /** Versioned browser inputs for optional LOD and instancing adapters. Full
   * procedural/material/camera evidence stays in the generated manifest. */
  runtimeDiagnostics: ${constJson(manifest.sceneDiagnostics
    ? compileRuntimeSceneDiagnostics(manifest.sceneDiagnostics)
    : null)},
  /** Slot-aware GPU texture compression and decoded-image fidelity report. */
  textureCompression: ${constJson(manifest.textureCompression ?? null)},
  /** Exact baked-atlas delivery alternatives. Keys are canonical source URLs;
   * variants retain their own immutable content hashes. */
  textureVariants: ${constJson(manifest.textureVariants
    ? Object.fromEntries(Object.entries(manifest.textureVariants).map(
        ([source, variants]) => [source, variants.map((variant) => ({
          ...variant,
          url: versionedAssetUrl(variant.url, variant.hash),
        }))],
      ))
    : {})},
  /** Compiler evidence for the selected atlas delivery transforms. */
  atlasDelivery: ${constJson(manifest.atlasDelivery ?? null)},
  /** Required by the GLB itself, including externally authored KTX2 assets. */
  requiresKtx2: ${manifest.requiresKtx2 === true ? 'true' : 'false'},
  /** Required by the GLB itself, including externally authored Meshopt assets. */
  requiresMeshopt: ${manifest.requiresMeshopt === true ? 'true' : 'false'},
  /** Exact compiler-owned request graph; immutable caching still requires a
   * graph-addressed publication directory. */
  runtimeAssetGraph: ${constJson(manifest.runtimeAssetGraph ?? null)},
${meshoptDecodedBytes === undefined
    ? ''
    : `  /** Exact uncompressed Meshopt buffer-view bytes used for decode scheduling. */
  meshoptDecodedBytes: ${meshoptDecodedBytes},`}
  /** Per-image maximum-size transforms applied before compression. */
  textureTransforms: ${JSON.stringify(manifest.textureTransforms ?? [])} as const,
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
  /** Baked state texture URLs, routed as Appearance maps or Lighting light maps. */
  states: {
${stateEntries}
  },
  /** Per-atlas composition route. Missing metadata is legacy appearance. */
  bakeOutputs: ${JSON.stringify(manifest.bakeOutputs ?? {})} as const,
  /** Per-state decode scale for normalized baked atlases. */
  stateScales: ${JSON.stringify(manifest.stateScales ?? {})} as const,
  defaultState: ${constJson(defaultState)},
  /** Objects and lights hidden by each full Blender collection state. */
  stateVisibility: ${JSON.stringify(manifest.stateVisibility ?? {})} as const,
  /** Interactive light layers: add layer * maxValue * tint * strength in
   * linear space over the state color. Bake keeps each group's real bounce. */
  lightGroups: {
${lightGroupEntries}
  },
  colliders: ${JSON.stringify(manifest.vocabulary.colliders.map((collider, index) => ({
    ...collider,
    ...manifest.colliderNodes?.[index],
  })))} as const,
  lods: ${JSON.stringify(manifest.vocabulary.lods)} as const,
  physics: ${JSON.stringify(manifest.vocabulary.physics)} as const,
  /** Blender custom properties (glTF extras), typed as literals. */
  extras: {
${extrasEntries}
  },
} as const

export type ${pascalName}NodeName = keyof typeof ${exportName}.nodes
export type ${pascalName}ObjectId = keyof typeof ${exportName}.objectsById
export type ${pascalName}ReflectionProbeId = (typeof ${exportName}.reflectionProbes)[number]['id']
export type ${pascalName}ReflectionProbeAssignedNodeName = keyof typeof ${exportName}.reflectionProbeAssignments
export type ${pascalName}MaterialName = keyof typeof ${exportName}.materials
export type ${pascalName}ClipName = keyof typeof ${exportName}.clips
export type ${pascalName}MarkerName = keyof typeof ${exportName}.markers
export type ${pascalName}CurveName = keyof typeof ${exportName}.curves
export type ${pascalName}SocketName = keyof typeof ${exportName}.sockets
export type ${pascalName}HotspotName = keyof typeof ${exportName}.hotspots
export type ${pascalName}StateName = keyof typeof ${exportName}.states
export type ${pascalName}LightGroupName = keyof typeof ${exportName}.lightGroups

/** Stable authored-node result shape for useGLTF casts. Loader-created child
 * primitives of multi-material Group nodes are intentionally not invented. */
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
