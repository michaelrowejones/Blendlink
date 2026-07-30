/**
 * The IR-to-node-graph half of the TSL material runtime (plan-doc gap
 * 8b.3): everything needed to turn a shipped program's channels plus
 * plain-data mesh extras into slot-keyed TSL nodes, with NO dependency on
 * three/webgpu or on any loaded scene object. The other half —
 * constructing a MeshStandardNodeMaterial clone and swapping mesh slots —
 * lives in tslMaterialRuntime.ts (`installProgramIntoMaterial`), which is
 * also the only module allowed to import three/webgpu. The split is the
 * reuse seam: a future program kind (a deformer writing vertex-stage
 * slots) reuses this builder shape without inheriting the material-slot
 * installer.
 *
 * NOT REENTRANT: the underlying tslNodeRecipe builders keep module-global
 * state (activeOptions, lutCache) for the duration of one build, so
 * program builds must not interleave — no awaits between channel builds,
 * no concurrent builds. This was already true inside installTslMaterials;
 * the seam makes the contract explicit instead of incidental.
 */
import {
  buildTslColorNode,
  buildTslScalarNode,
  TslIrError,
  type BuildTslOptions,
  type TslIrDocument,
} from './tslNodeRecipe.js'

export interface MaterialProgramChannel {
  tslIr: TslIrDocument
  tslIrHash?: string
  tslIrBytes?: number
}

/** The mesh extras stamped by the exporter (blendlink_tsl_runtime). */
export interface TslRuntimeMeshExtras {
  schemaVersion?: number
  uvChannels?: Record<string, number>
  colorLayers?: Record<string, string>
  texspace?: { location: number[]; size: number[] }
  objectSpace?: string
}

export type MaterialNodeSlot =
  | 'colorNode'
  | 'emissiveNode'
  | 'roughnessNode'
  | 'metalnessNode'
  | 'opacityNode'

export interface ChannelNodeMapping {
  node: MaterialNodeSlot
  kind: 'color' | 'scalar'
}

/** Principled channel name -> fragment slot. Injectable so a different
 * program kind can bring its own table instead of editing this one. */
export const MATERIAL_CHANNEL_NODES: Record<string, ChannelNodeMapping> = {
  'Base Color': { node: 'colorNode', kind: 'color' },
  'Emission Color': { node: 'emissiveNode', kind: 'color' },
  Roughness: { node: 'roughnessNode', kind: 'scalar' },
  Metallic: { node: 'metalnessNode', kind: 'scalar' },
  Alpha: { node: 'opacityNode', kind: 'scalar' },
}

/** A named non-application from the builder. The installer decorates
 * these with the material name (TslMaterialSkip keeps `material`
 * required — the report contract at threeRuntime is structural). */
export interface MaterialProgramSkip {
  channel?: string
  reason: string
}

export interface BuiltMaterialProgram {
  /** Slot-keyed TSL nodes; empty when nothing built. */
  nodes: Partial<Record<MaterialNodeSlot, unknown>>
  skipped: readonly MaterialProgramSkip[]
}

/** Walk raw IR for attribute_object ops: the per-object properties a
 * program needs its meshes to ship. Pure IR introspection. */
export function collectObjectAttributeNames(
  value: unknown,
  names: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectAttributeNames(item, names)
    return
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.op === 'attribute_object' && typeof record.name === 'string') {
      names.add(record.name)
    }
    for (const item of Object.values(record)) {
      collectObjectAttributeNames(item, names)
    }
  }
}

/** BuildTslOptions from plain-data mesh extras: named-UV and color-layer
 * resolvers that throw TslIrError on unmapped names (never a silent
 * uv(0)/COLOR_0 fallback), texspace, and the object-space basis. */
export function buildOptionsFor(
  extras: TslRuntimeMeshExtras | null,
  resources: BuildTslOptions['resources'],
  materialName: string,
  textures?: BuildTslOptions['textures'],
  objectAttribute?: BuildTslOptions['objectAttribute'],
): BuildTslOptions {
  const options: BuildTslOptions = { resources }
  if (textures) options.textures = textures
  if (objectAttribute) options.objectAttribute = objectAttribute
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
 * Build every channel of one program into its slot node. Channels with no
 * mapping in `channelNodes` and channels whose build raises TslIrError
 * become named skips; any other error propagates (a build crash is a
 * defect, not a fidelity downgrade). Returns only nodes — never a
 * material; the installer owns clone construction because the null-slot
 * restore list must be derived from a FRESHLY constructed clone.
 */
export function buildMaterialProgram(
  channels: Record<string, MaterialProgramChannel>,
  options: BuildTslOptions,
  channelNodes: Record<string, ChannelNodeMapping> = MATERIAL_CHANNEL_NODES,
): BuiltMaterialProgram {
  const nodes: Partial<Record<MaterialNodeSlot, unknown>> = {}
  const skipped: MaterialProgramSkip[] = []
  for (const [channel, entry] of Object.entries(channels)) {
    const mapping = channelNodes[channel]
    if (!mapping) {
      skipped.push({
        channel,
        reason: 'channel has no node mapping in this runtime version; its carrier stays',
      })
      continue
    }
    try {
      nodes[mapping.node] = mapping.kind === 'color'
        ? buildTslColorNode(entry.tslIr, options)
        : buildTslScalarNode(entry.tslIr, options)
    } catch (error) {
      if (!(error instanceof TslIrError)) throw error
      skipped.push({
        channel,
        reason: `program refused to build: ${error.message}`,
      })
    }
  }
  return { nodes, skipped }
}
