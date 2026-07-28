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
import {
  buildTslColorNode,
  buildTslScalarNode,
  createTslBuildResources,
  TslIrError,
  type BuildTslOptions,
  type TslIrDocument,
} from './tslNodeRecipe.js'

export interface MaterialProgramChannel {
  tslIr: TslIrDocument
  tslIrHash?: string
  tslIrBytes?: number
}

export interface MaterialProgramsDocument {
  schemaVersion: 1
  model: 'blendlink-material-programs-v1'
  materials: Record<string, { channels: Record<string, MaterialProgramChannel> }>
}

/** The mesh extras stamped by the exporter (blendlink_tsl_runtime). */
interface TslRuntimeMeshExtras {
  schemaVersion?: number
  uvChannels?: Record<string, number>
  colorLayers?: Record<string, string>
  texspace?: { location: number[]; size: number[] }
  objectSpace?: string
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

const CHANNEL_NODES: Record<string, {
  node: 'colorNode' | 'emissiveNode' | 'roughnessNode' | 'metalnessNode' | 'opacityNode'
  kind: 'color' | 'scalar'
}> = {
  'Base Color': { node: 'colorNode', kind: 'color' },
  'Emission Color': { node: 'emissiveNode', kind: 'color' },
  Roughness: { node: 'roughnessNode', kind: 'scalar' },
  Metallic: { node: 'metalnessNode', kind: 'scalar' },
  Alpha: { node: 'opacityNode', kind: 'scalar' },
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

function meshRuntimeExtras(object: THREE.Object3D): TslRuntimeMeshExtras | null {
  const extras = object.userData?.blendlink_tsl_runtime
  return extras && typeof extras === 'object'
    ? extras as TslRuntimeMeshExtras
    : null
}

function buildOptionsFor(
  extras: TslRuntimeMeshExtras | null,
  resources: BuildTslOptions['resources'],
  materialName: string,
): BuildTslOptions {
  const options: BuildTslOptions = { resources }
  if (extras?.uvChannels) {
    const uvChannels = extras.uvChannels
    options.uvChannel = (uvMap) => {
      const index = uvChannels[uvMap]
      if (typeof index !== 'number') {
        throw new TslIrError(
          `Material "${materialName}" IR references UV map ${JSON.stringify(uvMap)} ` +
            'that the exported mesh extras do not map.',
        )
      }
      return index
    }
  }
  if (extras?.colorLayers) {
    const colorLayers = extras.colorLayers
    options.colorAttribute = (layer) => {
      const name = colorLayers[layer]
      if (typeof name !== 'string') {
        throw new TslIrError(
          `Material "${materialName}" IR references color layer ${JSON.stringify(layer)} ` +
            'that the exported mesh extras do not map.',
        )
      }
      return name
    }
  }
  if (extras?.texspace
    && extras.texspace.location?.length === 3
    && extras.texspace.size?.length === 3) {
    options.generatedTexspace = {
      location: [...extras.texspace.location] as [number, number, number],
      size: [...extras.texspace.size] as [number, number, number],
    }
  }
  if (extras?.objectSpace === 'gltf-y-up') {
    options.objectSpace = { basis: 'gltf-y-up' }
  }
  return options
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

  const skipped: TslMaterialSkip[] = []
  interface InstalledSwap {
    mesh: THREE.Mesh
    slot: number | null
    original: THREE.Material
    clone: MeshStandardNodeMaterial
    release?: (transferred: boolean) => void
    resources: ReturnType<typeof createTslBuildResources>
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
        const variantKey = `${source} ${JSON.stringify(extras ?? null)}`
        let variant = variants.get(variantKey)
        if (!variant) {
          const resources = createTslBuildResources()
          const clone = new MeshStandardNodeMaterial()
          // Material.copy is brand-generic at runtime; @types narrows the
          // NodeMaterial overload to node materials only.
          clone.copy(material as unknown as MeshStandardNodeMaterial)
          clone.name = material.name
          clone.userData = { ...material.userData }
          const buildOptions = buildOptionsFor(extras, resources, source)
          let builtAny = false
          for (const [channel, entry] of channels) {
            const mapping = CHANNEL_NODES[channel]
            if (!mapping) {
              skipped.push({
                material: source,
                channel,
                reason: 'channel has no node mapping in this runtime version; its carrier stays',
              })
              continue
            }
            try {
              const node = mapping.kind === 'color'
                ? buildTslColorNode(entry.tslIr, buildOptions)
                : buildTslScalarNode(entry.tslIr, buildOptions)
              ;(clone as unknown as Record<string, unknown>)[mapping.node] = node
              builtAny = true
            } catch (error) {
              if (!(error instanceof TslIrError)) throw error
              skipped.push({
                material: source,
                channel,
                reason: `program refused to build: ${error.message}`,
              })
            }
          }
          if (!builtAny) {
            clone.dispose()
            resources.dispose()
            skipped.push({
              material: source,
              reason: 'no channel produced a node; the shipped carrier stays',
            })
            return
          }
          variant = { clone, resources }
          variants.set(variantKey, variant)
        }
        const release = options.trackMaterialClone?.(material, variant.clone)
        installed.push({
          mesh,
          slot: Array.isArray(mesh.material) ? index : null,
          original: material,
          clone: variant.clone,
          ...(release ? { release } : {}),
          resources: variant.resources,
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
