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
import { MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu'
import { uniform } from 'three/tsl'
import {
  createTslBuildResources,
  TslIrError,
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

export type { MaterialProgramImage, MaterialProgramsDocument } from './materialProgramDocument.js'
import { fetchMaterialPrograms, materialProgramObjectOwnerNode } from './materialProgramDocument.js'
import { collectObjectInfoOutputs, createObjectInfoResolver, validateObjectInfoBinding } from './tslObjectInfo.js'
import type { MaterialProgramImage, MaterialProgramsDocument } from './materialProgramDocument.js'

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
  /** Node materials installed (per material x runtime-extras/object-owner variant). */
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
/**
 * Bookkeeping the clone must keep for itself. `type` decides which shader
 * three builds, `uuid`/`id` are identity, `version` drives recompilation, and
 * `_listeners` belongs to the source's own disposal wiring.
 */
const CLONE_IDENTITY_KEYS = new Set([
  'uuid', 'id', 'type', 'version', 'name', 'userData', '_listeners', 'isMaterial',
])

export function installProgramIntoMaterial(
  source: THREE.Material,
  nodes: Partial<Record<MaterialNodeSlot, unknown>>,
): MeshStandardNodeMaterial {
  const physical = (source as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial
    || Object.keys(nodes).some(key => ['clearcoatNode', 'clearcoatRoughnessNode',
      'clearcoatNormalNode', 'transmissionNode', 'iorNode', 'sheenNode', 'sheenRoughnessNode'].includes(key))
  const clone = physical ? new MeshPhysicalNodeMaterial() : new MeshStandardNodeMaterial()
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
  // ...and copy() is exactly the problem for everything that is NOT a node.
  // The three chain (MeshStandardNodeMaterial.copy -> NodeMaterial.copy ->
  // Material.copy) transfers node slots plus generic render state, and
  // nothing else: color, map, roughness, metalness, normalMap and the rest
  // keep the fresh clone's constructor defaults. A material whose Base Color
  // program was proven but whose Roughness was refused would therefore ship
  // white and fully rough instead of keeping its shipped carrier - the exact
  // opposite of what "refused channels keep their carrier" promises.
  //
  // The transferred set is DERIVED from the source instance rather than
  // listed, because a list here would fall behind three the first time
  // MeshStandardMaterial grows a property, and the symptom would again be a
  // silently wrong surface.
  const sourceRecord = source as unknown as Record<string, unknown>
  const cloneRecord = clone as unknown as Record<string, unknown>
  for (const key of Object.keys(sourceRecord)) {
    if (CLONE_IDENTITY_KEYS.has(key) || key.endsWith('Node')) continue
    if (!(key in cloneRecord)) continue
    cloneRecord[key] = sourceRecord[key]
  }
  // After copy: Material.copy overwrites both name and userData.
  clone.name = source.name
  clone.userData = { ...source.userData }
  for (const [slot, node] of Object.entries(nodes)) {
    ;(clone as unknown as Record<string, unknown>)[slot] = node
  }
  return clone
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
        `${entry.bytes}. Re-run blendlink compile and republish together.`,
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

export async function loadProgramTextures(
  document: MaterialProgramsDocument,
  programsUrl: string,
  options: Pick<InstallTslMaterialsOptions, 'loadProgramTexture'>,
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
      if (!['Linear', 'Closest'].includes(interpolation) || !['REPEAT', 'EXTEND'].includes(extension)) {
        throw new TslIrError(`Program image ${JSON.stringify(name)} needs unsupported texture sampling ${interpolation}/${extension}`)
      }
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
 * uniform reading the exported node extras through onObjectUpdate. Values
 * are validated before install and again at draw time; missing/malformed
 * data must never silently become a black material. */
export function objectAttributeValue(raw: unknown): [number, number, number] | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return [raw, raw, raw]
  if (Array.isArray(raw) && raw.length >= 3 && raw.slice(0, 3).every(
    item => typeof item === 'number' && Number.isFinite(item),
  )) return [raw[0], raw[1], raw[2]]
  return null
}

export function objectAttributeOwner(object: THREE.Object3D): THREE.Object3D {
  return materialProgramObjectOwnerNode(object)
}

function objectAttributeRaw(object: THREE.Object3D, name: string): unknown {
  const owner = objectAttributeOwner(object)
  return Object.hasOwn(owner.userData ?? {}, name) ? owner.userData[name] : object.userData?.[name]
}

export function objectAttributeResolver(): NonNullable<BuildTslOptions['objectAttribute']> {
  return (name) => {
    const value = uniform(new THREE.Vector3())
    ;(value as unknown as {
      onObjectUpdate(
        callback: (frame: { object: THREE.Object3D }) => unknown,
      ): unknown
    }).onObjectUpdate(({ object }) => {
      const raw = objectAttributeValue(objectAttributeRaw(object, name))
      if (!raw) throw new Error(`Per-object attribute ${JSON.stringify(name)} on ${JSON.stringify(object.name)} must be a finite scalar or RGB/vector value.`)
      return new THREE.Vector3(...raw)
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
    : await fetchMaterialPrograms(pointer)
  const programTextures = await loadProgramTextures(programs, pointer.url, options)
  const objectAttribute = objectAttributeResolver()
  // Per-material attribute needs, computed once: applied meshes must ship
  // the property in their exported extras or skip by name.
  const attributeNames = new Map<string, string[]>()
  const objectInfoOutputs = new Map<string, Set<string>>()
  for (const [source, program] of Object.entries(programs.materials)) {
    const names = new Set<string>()
    collectObjectAttributeNames(program.channels, names)
    if (names.size > 0) attributeNames.set(source, [...names].sort())
    const outputs = new Set<string>()
    collectObjectInfoOutputs(program.channels, outputs)
    if (outputs.size) objectInfoOutputs.set(source, outputs)
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
  // Geometry-only programs can share clones when their runtime extras agree.
  // Attribute programs also bind their explicit object owner, so separate
  // shared-geometry instances never share mutable object uniform state.
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
        if (!matchedSources.has(source)) {
          for (const item of program.skipped ?? []) skipped.push({ material: source, ...item })
          matchedSources.add(source)
        }
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
        const owner = objectAttributeOwner(mesh)
        const info = objectInfoOutputs.get(source)
        if (info) {
          try { validateObjectInfoBinding(info, owner.userData?.blendlink_tsl_object,
            material.userData?.blendlink_tsl_material, Boolean((mesh as THREE.InstancedMesh).isInstancedMesh)) }
          catch (error) {
            if (!(error instanceof TslIrError)) throw error
            skipped.push({ material: source, reason: `mesh "${mesh.name}" Object Info refused: ${error.message}; its carrier stays` })
            return
          }
        }
        if (needed) {
          const properties = owner === mesh ? mesh.userData : { ...mesh.userData, ...owner.userData }
          const missing = needed.filter(
            (name) => !Object.hasOwn(properties ?? {}, name),
          )
          if (missing.length > 0) {
            skipped.push({
              material: source,
              reason: `mesh "${mesh.name}" ships no per-object attribute `
                + `${missing.join(', ')}; its carrier stays`,
            })
            return
          }
          const invalid = needed.filter(name => !objectAttributeValue(objectAttributeRaw(mesh, name)))
          if (invalid.length > 0) {
            skipped.push({ material: source,
              reason: `mesh "${mesh.name}" has invalid per-object attribute ${invalid.join(', ')}; finite scalar or RGB/vector values are required; its carrier stays`,
            })
            return
          }
        }
        // Keyed by the LOADED MATERIAL INSTANCE, not the source name:
        // fork_lighting_materials deliberately splits one compiled
        // carrier into per-(atlas, lightmap-channel) copies that all
        // carry the same source extras, and consolidating them back onto
        // one clone would make createBakedScene refuse ("shared by atlas
        // groups"). Meshes sharing one loaded material still share one
        // clone per runtime-extras variant.
        const normalMapBasis = !mesh.geometry.hasAttribute('uv') ? 'missing'
          : mesh.geometry.hasAttribute('tangent') ? 'attribute' : 'derivative'
        const variantKey = `${material.uuid} ${normalMapBasis} ${JSON.stringify(extras ?? null)} ${needed?.length || info?.size ? owner.uuid : ''}`
        let variant = variants.get(variantKey)
        if (!variant) {
          const resources = createTslBuildResources()
          // Build first, install second (the 8b.3 seam): the builder
          // returns slot nodes and named skips; the installer constructs
          // the clone only when something built, so the no-channel path
          // never allocates a material at all.
          const program = buildMaterialProgram(
            Object.fromEntries(channels),
            { ...buildOptionsFor(
              extras, resources, source, programTextures?.resolver,
              objectAttribute,
            ), normalMapBasis, ...(info ? { objectInfo: createObjectInfoResolver(
              owner.userData?.blendlink_tsl_object, material.userData?.blendlink_tsl_material,
            ) } : {}) },
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
