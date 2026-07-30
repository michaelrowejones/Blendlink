import { readFileSync } from 'node:fs'
import type { ApplicationMaterialAdapterConfig } from './config.js'
import { parseManifest } from './typegen.js'
import type { MaterialPortabilityDiagnostic } from './sceneDiagnostics.js'

export interface RealtimePlanMaterialIssue {
  code: 'material.used-needs-bake'
  material: string
  usedBy: string[]
  summary: string
  reasons: string[]
  acknowledgedBy?: string
}

export interface RealtimePlanMaterialInspection {
  errors: RealtimePlanMaterialIssue[]
  warnings: RealtimePlanMaterialIssue[]
}

export interface RealtimePlanMaterialOptions {
  bakePlan?: {
    objects: ReadonlyArray<{
      name: string
      atlas?: string
      bakeOutput?: 'lighting' | 'appearance' | 'material'
    }>
    dynamicObjects?: ReadonlyArray<{ name: string }>
  }
  applicationMaterialAdapter?: ApplicationMaterialAdapterConfig
}

function unambiguousAppearanceOwnedObjectNames(
  plan: RealtimePlanMaterialOptions['bakePlan'],
): Set<string> {
  if (!plan) return new Set()
  const ownership = new Map<string, {
    appearance: number
    live: number
    occurrences: number
  }>()
  const record = (name: string, disposition: 'appearance' | 'live') => {
    const current = ownership.get(name) ?? {
      appearance: 0,
      live: 0,
      occurrences: 0,
    }
    current[disposition] += 1
    current.occurrences += 1
    ownership.set(name, current)
  }
  for (const object of plan.objects) {
    record(
      object.name,
      // Appearance AND material atlases own their objects' complete
      // surface (the bake carries it), so neither needs a live material
      // route; only lighting-owned objects keep live materials. Without
      // the material arm, a material-atlas plan emits phantom
      // material.used-needs-bake errors for surfaces that are in fact
      // baked (found latent by the Phase 2 seam map: the type at
      // plan.objects already admitted 'material' before this bucket did).
      object.bakeOutput === 'appearance' || object.bakeOutput === 'material'
        ? 'appearance'
        : 'live',
    )
  }
  for (const object of plan.dynamicObjects ?? []) record(object.name, 'live')

  return new Set(
    [...ownership]
      .filter(([, value]) =>
        value.appearance === 1
        && value.live === 0
        && value.occurrences === 1)
      .map(([name]) => name),
  )
}

/**
 * A material use is exempt only when its bare object name maps to exactly one
 * plan occurrence and that occurrence is owned by an Appearance atlas.
 * Blender permits linked objects from different libraries to share a bare
 * name, while today's diagnostics do not yet carry a qualified occurrence
 * key. Duplicate or conflicting plan names therefore stay unresolved rather
 * than letting one Appearance receiver hide another live receiver. Lighting,
 * Dynamic, and unplanned objects retain realtime materials. Explicit Website
 * Material lowerings already own their selected field. A named application
 * material adapter keeps only the remaining live issues visible as nonblocking
 * acknowledgements, consistent with Final verification; it is not material-
 * fidelity evidence.
 */
export function inspectRealtimePlanMaterialDiagnostics(
  diagnostics: { materials?: readonly MaterialPortabilityDiagnostic[] } | undefined,
  options: RealtimePlanMaterialOptions,
): RealtimePlanMaterialInspection {
  const appearanceOwned = unambiguousAppearanceOwnedObjectNames(options.bakePlan)
  const unresolved = (diagnostics?.materials ?? [])
    .filter((material) =>
      material.status === 'needsBake'
      && material.usedBy.length > 0
      && material.materialCompilation?.outcome !== 'lowered')
    .map((material): RealtimePlanMaterialIssue => ({
      code: 'material.used-needs-bake',
      material: material.material,
      usedBy: material.usedBy
        .filter((object) => !appearanceOwned.has(object))
        .sort(),
      summary: material.summary,
      reasons: [...material.reasons],
    }))
    .filter((material) => material.usedBy.length > 0)
    .sort((a, b) => a.material.localeCompare(b.material))
  const adapter = options.applicationMaterialAdapter
  if (adapter?.acknowledgePayloadCollapse === true) {
    return {
      errors: [],
      warnings: unresolved.map((issue) => ({
        ...issue,
        acknowledgedBy: adapter.description,
      })),
    }
  }
  return { errors: unresolved, warnings: [] }
}

/** Read the optional prior-build timing shown by `blendlink plan` through the
 * canonical manifest parser. In particular, an obsolete schema is a blocking
 * compatibility error rather than a missing estimate. */
export function readPlanSyncDuration(path: string): number | undefined {
  const manifest = parseManifest(readFileSync(path, 'utf8'))
  return typeof manifest?.lastSyncDurationMs === 'number'
    ? manifest.lastSyncDurationMs
    : undefined
}
