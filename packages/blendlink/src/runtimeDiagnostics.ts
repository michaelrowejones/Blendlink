import type {
  InstanceSourceDiagnostic,
  LodChainDiagnostic,
  SceneDiagnostics,
} from './sceneDiagnostics.js'

/**
 * Browser-owned evidence needed to install optional runtime adapters. Full
 * compiler evidence remains in the generated manifest: procedural frame
 * samples, material portability records, and camera audit details have no
 * renderer-lifecycle role and must not inflate every application bundle.
 */
export const RUNTIME_SCENE_DIAGNOSTICS_SCHEMA_VERSION = 1 as const

type ReadonlyDiagnostic<T> = T extends readonly unknown[]
  ? { readonly [TIndex in keyof T]: ReadonlyDiagnostic<T[TIndex]> }
  : T extends object
    ? { readonly [TKey in keyof T]: ReadonlyDiagnostic<T[TKey]> }
    : T

export interface RuntimeSceneDiagnostics {
  readonly schemaVersion: typeof RUNTIME_SCENE_DIAGNOSTICS_SCHEMA_VERSION
  readonly lodChains: readonly ReadonlyDiagnostic<LodChainDiagnostic>[]
  readonly instanceGroups: readonly ReadonlyDiagnostic<InstanceSourceDiagnostic>[]
}

export interface RuntimeSceneDiagnosticsDescriptor {
  /** Current generated binding. Unknown versions are refused rather than
   * falling back to possibly stale legacy evidence. */
  readonly runtimeDiagnostics?: RuntimeSceneDiagnostics | null
  /** Pre-runtimeDiagnostics generated bindings. Kept as a read-only migration
   * path so current Blendlink can still install their LOD/instance adapters. */
  readonly sceneDiagnostics?: {
    readonly lod?: { readonly chains?: readonly ReadonlyDiagnostic<LodChainDiagnostic>[] }
    readonly instances?: { readonly groups?: readonly ReadonlyDiagnostic<InstanceSourceDiagnostic>[] }
  } | null
}

/** Compiler-side projection into the intentionally tiny browser contract. */
export function compileRuntimeSceneDiagnostics(
  diagnostics: SceneDiagnostics,
): RuntimeSceneDiagnostics {
  return {
    schemaVersion: RUNTIME_SCENE_DIAGNOSTICS_SCHEMA_VERSION,
    lodChains: diagnostics.lod.chains,
    instanceGroups: diagnostics.instances.groups,
  }
}

/** Resolve the compact current contract, or project an older full generated
 * diagnostic object. This is the one compatibility seam used by every
 * runtime adapter; malformed current data is always loud. */
export function resolveRuntimeSceneDiagnostics(
  descriptor: RuntimeSceneDiagnosticsDescriptor,
): RuntimeSceneDiagnostics | null {
  if (descriptor.runtimeDiagnostics !== undefined) {
    const current = descriptor.runtimeDiagnostics
    if (current === null) return null
    if (current.schemaVersion !== RUNTIME_SCENE_DIAGNOSTICS_SCHEMA_VERSION) {
      throw new Error(
        `Blendlink runtime diagnostics schema ${String(current.schemaVersion)} is unsupported; ` +
        `expected ${RUNTIME_SCENE_DIAGNOSTICS_SCHEMA_VERSION}. Regenerate the scene binding and ` +
        'update the Blendlink runtime together.',
      )
    }
    if (!Array.isArray(current.lodChains) || !Array.isArray(current.instanceGroups)) {
      throw new Error(
        'Blendlink runtime diagnostics v1 is malformed; expected lodChains and ' +
        'instanceGroups arrays. Regenerate the scene binding.',
      )
    }
    return current
  }

  const legacy = descriptor.sceneDiagnostics
  if (legacy === undefined || legacy === null) return null
  const chains = legacy.lod?.chains
  const groups = legacy.instances?.groups
  if (chains !== undefined && !Array.isArray(chains)) {
    throw new Error('Blendlink legacy scene diagnostics has malformed lod.chains evidence.')
  }
  if (groups !== undefined && !Array.isArray(groups)) {
    throw new Error('Blendlink legacy scene diagnostics has malformed instances.groups evidence.')
  }
  return {
    schemaVersion: RUNTIME_SCENE_DIAGNOSTICS_SCHEMA_VERSION,
    lodChains: chains ?? [],
    instanceGroups: groups ?? [],
  }
}
