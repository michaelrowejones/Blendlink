/**
 * Phase 4 Track C: apply shipped TSL IR programs to loaded materials.
 *
 * Shaped like the threeMaterialCarriers modules: traverse → identify by
 * extras (never names) → verify loudly → reversible mutate → dispose.
 * Channels with IR become node inputs on a MeshStandardNodeMaterial clone;
 * channels the compiler refused keep their shipped carrier (factor value or
 * baked texture) — ROUTES NEVER CHANGE here, this layer only upgrades
 * fidelity where the compiler proved a program.
 *
 * This module imports three/webgpu (MeshStandardNodeMaterial) and is
 * exported ONLY through the `blendlink/three/tsl-materials` subpath so
 * WebGL-only applications never bundle the node system.
 */
import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { uniform } from 'three/tsl'
import {
  createTslBuildResources,
  type BuildTslOptions,
} from './tslNodeRecipe.js'
import {
  buildMaterialProgram,
  buildOptionsFor,
  collectObjectAttributeNames,
  type MaterialNodeSlot,
  type MaterialProgramChannel,
  type TslRuntimeMeshExtras,
} from './tslMaterialProgram.js'

// The builder half (plan-doc gap 8b.3) is a separate module with no
// three/webgpu dependency; the subpath re-exports it so consumers reach
// both halves through `blendlink/three/tsl-materials`.
export {
  buildMaterialProgram,
  buildOptionsFor,
  collectObjectAttributeNames,
  MATERIAL_CHANNEL_NODES,
  type BuiltMaterialProgram,
  type ChannelNodeMapping,
  type MaterialNodeSlot,
  type MaterialProgramChannel,
  type MaterialProgramSkip,
  type TslRuntimeMeshExtras,
} from './tslMaterialProgram.js'

export interface MaterialProgramImage {
  /** Basename beside the sidecar; resolved against the sidecar URL. */
  file: string
  bytes: number
  hash: string
  mime: string
  width: number
  height: number
  colorSpace: string
}

export interface MaterialProgramsDocument {
  schemaVersion: 1
  model: 'blendlink-material-programs-v1'
  materials: Record<string, { channels: Record<string, MaterialProgramChannel> }>
  /** texture_ref source images published beside the sidecar. */
  images?: Record<string, MaterialProgramImage>
}

export interface InstallTslMaterialsOptions {
  root: THREE.Object3D
  descriptor: {
    materialPrograms?: {
      url: string
      bytes: number
      hash: string
      materials: number
    } | null
  }
  /** Override the fetch+hash-verify transport (tests, custom hosting).
   * The default fetches descriptor.materialPrograms.url and refuses on
   * byte-count or sha256-prefix mismatch. */
  loadPrograms?: () => Promise<MaterialProgramsDocument>
  /** Baked-composition seam: keep clones connected to state machinery. */
  trackMaterialClone?: (
    source: THREE.Material,
    clone: THREE.Material,
  ) => (transferred: boolean) => void
  /** Override texture_ref image decoding (tests, custom decoders). The
   * default fetches the published bytes (count + hash verified) and
   * decodes through createImageBitmap with glTF orientation. */
  loadProgramTexture?: (
    name: string,
    entry: MaterialProgramImage,
    url: string,
  ) => Promise<THREE.Texture>
}

export interface TslMaterialSkip {
  material: string
  channel?: string
  reason: string
}

export interface InstalledTslMaterials {
  /** Source materials that matched a shipped program. */
  materials: number
  /** Node materials installed (per material x runtime-extras variant). */
  applied: number
  /** Named non-applications; never silent. */
  skipped: readonly TslMaterialSkip[]
  dispose(): void
}

/**
 * The slot-installation half of gap 8b.3: construct the node-material
 * clone for one source material and assign the built slot nodes. Owns
 * clone CONSTRUCTION deliberately — the null-slot restore list must be
 * read off a freshly constructed clone (Object.keys on an already-copied
 * material finds no nulls), so the builder can only ever hand back nodes.
 */
export function installProgramIntoMaterial(
  source: THREE.Material,
  nodes: Partial<Record<MaterialNodeSlot, unknown>>,
): MeshStandardNodeMaterial {
  const clone = new MeshStandardNodeMaterial()
  // NodeMaterial.copy reads node slots off the source; copying from
  // a plain shipped MeshStandardMaterial turns every null default
  // (fragmentNode, vertexNode, mrtNode, ...) into UNDEFINED — and
  // NodeMaterial.setup() distinguishes the two: `fragmentNode ===
  // null` falls through and `undefined.isOutputStructNode` throws
  // on the first shader build (measured on every ellie program
  // clone, both WGSL and GLSL builders). Capture the constructor's
  // null slots and restore them after the copy.
  const nullNodeSlots = Object.keys(clone).filter(
    (key) => key.endsWith('Node')
      && (clone as unknown as Record<string, unknown>)[key] === null,
  )
  // Material.copy is brand-generic at runtime; @types narrows the
  // NodeMaterial overload to node materials only.
  clone.copy(source as unknown as MeshStandardNodeMaterial)
  for (const key of nullNodeSlots) {
    const record = clone as unknown as Record<string, unknown>
    if (record[key] === undefined) record[key] = null
  }
  // After copy: Material.copy overwrites both name and userData.
  clone.name = source.name
  clone.userData = { ...source.userData }
  for (const [slot, node] of Object.entries(nodes)) {
    ;(clone as unknown as Record<string, unknown>)[slot] = node
  }
  return clone
}

async function fetchPrograms(pointer: {
  url: string
  bytes: number
  hash: string
}): Promise<MaterialProgramsDocument> {
  const response = await fetch(pointer.url)
  if (!response.ok) {
    throw new Error(
      `Blendlink material programs fetch failed (${response.status}) for ${pointer.url}`,
    )
  }
  const payload = new Uint8Array(await response.arrayBuffer())
  if (payload.byteLength !== pointer.bytes) {
    throw new Error(
      `Blendlink material programs at ${pointer.url} are ${payload.byteLength} bytes; ` +
        `the descriptor pins ${pointer.bytes}. Re-run blendlink sync and republish together.`,
    )
  }
  const digest = await crypto.subtle.digest(
    'SHA-256', payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  )
  const hash = [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, '0')).join('').slice(0, 16)
  if (hash !== pointer.hash) {
    throw new Error(
      `Blendlink material programs at ${pointer.url} hash ${hash}; the descriptor pins ` +
        `${pointer.hash}. Re-run blendlink sync and republish together.`,
    )
  }
  const document = JSON.parse(new TextDecoder().decode(payload)) as MaterialProgramsDocument
  if (document?.schemaVersion !== 1
    || document.model !== 'blendlink-material-programs-v1') {
    throw new Error(
      `Blendlink material programs at ${pointer.url} use unsupported model ` +
        `${JSON.stringify({ schemaVersion: document?.schemaVersion, model: document?.model })}.`,
    )
  }
  return document
}

async function defaultProgramTexture(
  entry: MaterialProgramImage,
  url: string,
): Promise<THREE.Texture> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Blendlink program image fetch failed (${response.status}) for ${url}`)
  }
  const payload = new Uint8Array(await response.arrayBuffer())
  if (payload.byteLength !== entry.bytes) {
    throw new Error(
      `Blendlink program image at ${url} is ${payload.byteLength} bytes; the sidecar pins ` +
        `${entry.bytes}. Re-run blendlink sync and republish together.`,
    )
  }
  const digest = await crypto.subtle.digest(
    'SHA-256', payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  )
  const hash = [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, '0')).join('').slice(0, 16)
  if (hash !== entry.hash) {
    throw new Error(
      `Blendlink program image at ${url} hash ${hash}; the sidecar pins ${entry.hash}.`,
    )
  }
  const bitmap = await createImageBitmap(
    new Blob([payload], { type: entry.mime }),
    { premultiplyAlpha: 'none', colorSpaceConversion: 'none' },
  )
  const texture = new THREE.Texture(bitmap as unknown as HTMLImageElement)
  // glTF orientation: exported TEXCOORDs are already V-flipped from
  // Blender space, matching standard top-down image rows.
  texture.flipY = false
  texture.colorSpace = entry.colorSpace === 'sRGB'
    ? THREE.SRGBColorSpace
    : THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

interface ProgramTextureSet {
  resolver: NonNullable<BuildTslOptions['textures']>
  dispose(): void
}

async function loadProgramTextures(
  document: MaterialProgramsDocument,
  programsUrl: string,
  options: InstallTslMaterialsOptions,
): Promise<ProgramTextureSet | null> {
  const entries = Object.entries(document.images ?? {})
  if (entries.length === 0) return null
  const base = new URL(
    programsUrl,
    typeof globalThis.location?.href === 'string'
      ? globalThis.location.href
      : 'http://blendlink.local/',
  )
  const decoded = new Map<string, THREE.Texture>()
  for (const [name, entry] of entries) {
    const url = new URL(entry.file, base).toString()
    decoded.set(
      name,
      options.loadProgramTexture
        ? await options.loadProgramTexture(name, entry, url)
        : await defaultProgramTexture(entry, url),
    )
  }
  const configured = new Map<string, THREE.Texture>()
  return {
    resolver(ref) {
      const name = String((ref as { image?: unknown }).image ?? '')
      const source = decoded.get(name)
      if (!source) return null
      const interpolation = String((ref as { interpolation?: unknown }).interpolation ?? 'Linear')
      const extension = String((ref as { extension?: unknown }).extension ?? 'REPEAT')
      const key = `${name}|${interpolation}|${extension}`
      let texture = configured.get(key)
      if (!texture) {
        texture = source.clone()
        const filter = interpolation === 'Closest'
          ? THREE.NearestFilter
          : THREE.LinearFilter
        texture.magFilter = filter
        texture.minFilter = filter
        texture.generateMipmaps = false
        texture.wrapS = extension === 'EXTEND'
          ? THREE.ClampToEdgeWrapping
          : THREE.RepeatWrapping
        texture.wrapT = texture.wrapS
        texture.needsUpdate = true
        configured.set(key, texture)
      }
      return texture
    },
    dispose() {
      for (const texture of configured.values()) texture.dispose()
      for (const texture of decoded.values()) texture.dispose()
      configured.clear()
      decoded.clear()
    },
  }
}

/** One shared resolver: every attribute_object op becomes a per-object
 * uniform reading the exported node extras through onObjectUpdate (the
 * harness-proven per-object delivery contract). Missing values read
 * black; the per-mesh presence check skips by name before that. */
function objectAttributeResolver(): NonNullable<BuildTslOptions['objectAttribute']> {
  return (name) => {
    const value = uniform(new THREE.Vector3())
    ;(value as unknown as {
      onObjectUpdate(
        callback: (frame: { object: THREE.Object3D }) => unknown,
      ): unknown
    }).onObjectUpdate(({ object }) => {
      const raw = object.userData?.[name]
      if (Array.isArray(raw)) {
        return new THREE.Vector3(
          Number(raw[0]) || 0, Number(raw[1]) || 0, Number(raw[2]) || 0,
        )
      }
      if (typeof raw === 'number') return new THREE.Vector3(raw, raw, raw)
      return new THREE.Vector3()
    })
    return value as unknown as ReturnType<
      NonNullable<BuildTslOptions['objectAttribute']>
    >
  }
}

function meshRuntimeExtras(object: THREE.Object3D): TslRuntimeMeshExtras | null {
  const extras = object.userData?.blendlink_tsl_runtime
  return extras && typeof extras === 'object'
    ? extras as TslRuntimeMeshExtras
    : null
}

/**
 * Fetch the scene's shipped material programs and apply them to every loaded
 * material they cover. Reversible: dispose() restores the loaded materials
 * and releases every node material and build-allocated texture.
 */
export async function installTslMaterials(
  options: InstallTslMaterialsOptions,
): Promise<InstalledTslMaterials> {
  const pointer = options.descriptor.materialPrograms
  if (!pointer) {
    return { materials: 0, applied: 0, skipped: [], dispose() {} }
  }
  const programs = options.loadPrograms
    ? await options.loadPrograms()
    : await fetchPrograms(pointer)
  const programTextures = await loadProgramTextures(programs, pointer.url, options)
  const objectAttribute = objectAttributeResolver()
  // Per-material attribute needs, computed once: applied meshes must ship
  // the property in their exported extras or skip by name.
  const attributeNames = new Map<string, string[]>()
  for (const [source, program] of Object.entries(programs.materials)) {
    const names = new Set<string>()
    collectObjectAttributeNames(program.channels, names)
    if (names.size > 0) attributeNames.set(source, [...names].sort())
  }

  const skipped: TslMaterialSkip[] = []
  interface InstalledSwap {
    mesh: THREE.Mesh
    slot: number | null
    original: THREE.Material
    clone: MeshStandardNodeMaterial
    release?: (transferred: boolean) => void
  }
  const installed: InstalledSwap[] = []
  // One clone per (source material x runtime-extras variant): meshes whose
  // extras agree share the node material, mirroring the compiler's variant
  // consolidation.
  const variants = new Map<string, {
    clone: MeshStandardNodeMaterial
    resources: ReturnType<typeof createTslBuildResources>
  }>()
  const matchedSources = new Set<string>()
  let disposed = false

  const rollback = (): void => {
    for (const item of installed.slice().reverse()) {
      if (item.slot === null) {
        if (item.mesh.material === item.clone) item.mesh.material = item.original
      } else if (Array.isArray(item.mesh.material)
        && item.mesh.material[item.slot] === item.clone) {
        item.mesh.material[item.slot] = item.original
      }
      item.release?.(false)
    }
    for (const variant of variants.values()) {
      variant.clone.dispose()
      variant.resources.dispose()
    }
    variants.clear()
    programTextures?.dispose()
  }

  try {
    options.root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const extras = meshRuntimeExtras(mesh)
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      list.forEach((material, index) => {
        if (!material) return
        const source = material.userData?.blendlink_source_material
        if (typeof source !== 'string') return
        const program = programs.materials[source]
        if (!program) return
        matchedSources.add(source)
        const channels = Object.entries(program.channels ?? {})
        if (channels.length === 0) return
        if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial !== true) {
          skipped.push({
            material: source,
            reason: 'loaded material is not MeshStandardMaterial; the shipped carrier stays',
          })
          return
        }
        const needed = attributeNames.get(source)
        if (needed) {
          const missing = needed.filter(
            (name) => !(name in (mesh.userData ?? {})),
          )
          if (missing.length > 0) {
            skipped.push({
              material: source,
              reason: `mesh "${mesh.name}" ships no per-object attribute `
                + `${missing.join(', ')}; its carrier stays`,
            })
            return
          }
        }
        const variantKey = `${source} ${JSON.stringify(extras ?? null)}`
        let variant = variants.get(variantKey)
        if (!variant) {
          const resources = createTslBuildResources()
          // Build first, install second (the 8b.3 seam): the builder
          // returns slot nodes and named skips; the installer constructs
          // the clone only when something built, so the no-channel path
          // never allocates a material at all.
          const program = buildMaterialProgram(
            Object.fromEntries(channels),
            buildOptionsFor(
              extras, resources, source, programTextures?.resolver,
              objectAttribute,
            ),
          )
          for (const item of program.skipped) {
            skipped.push({ material: source, ...item })
          }
          if (Object.keys(program.nodes).length === 0) {
            resources.dispose()
            skipped.push({
              material: source,
              reason: 'no channel produced a node; the shipped carrier stays',
            })
            return
          }
          variant = {
            clone: installProgramIntoMaterial(material, program.nodes),
            resources,
          }
          variants.set(variantKey, variant)
        }
        const release = options.trackMaterialClone?.(material, variant.clone)
        installed.push({
          mesh,
          slot: Array.isArray(mesh.material) ? index : null,
          original: material,
          clone: variant.clone,
          ...(release ? { release } : {}),
        })
        if (Array.isArray(mesh.material)) {
          mesh.material[index] = variant.clone
        } else {
          mesh.material = variant.clone
        }
      })
    })
  } catch (error) {
    rollback()
    throw error
  }

  return {
    materials: matchedSources.size,
    applied: installed.length,
    skipped,
    dispose() {
      if (disposed) return
      disposed = true
      rollback()
    },
  }
}
