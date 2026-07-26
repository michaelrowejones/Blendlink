import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path'
import {
  withPublicationLease,
  type PublicationLease,
  type PublicationLeaseWait,
} from './publicationLease.js'

export const PUBLICATION_SCOPE_DELEGATION_SCHEMA_VERSION = 1 as const
export const PUBLICATION_SCOPE_DELEGATION_ENV =
  'BLENDLINK_PUBLICATION_LEASES_V1' as const
export const PUBLICATION_SCOPE_REGISTRY_ENV =
  'BLENDLINK_PUBLICATION_LEASE_REGISTRY' as const

export type PublicationScopesErrorCode =
  | 'GENERATED_ROOT_MISMATCH'
  | 'INVALID_DELEGATION'
  | 'INVALID_OPTIONS'
  | 'SCOPE_ORDER_VIOLATION'
  | 'UNSUPPORTED_ROOT'

export class PublicationScopesError extends Error {
  readonly code: PublicationScopesErrorCode

  constructor(
    code: PublicationScopesErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PublicationScopesError'
    this.code = code
  }
}

export interface PublicationScope {
  readonly root: string
  readonly rootHash: string
  readonly lockPath: string
}

export interface PublicationScopeResolutionOptions {
  /**
   * Test/embedding override. Production defaults to a per-user cache.
   * Windows UNC paths are rejected. Node cannot reliably distinguish mapped
   * network drives or POSIX network mounts, which remain unsupported.
   */
  readonly registryDirectory?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
}

export interface ScenePublicationRoots {
  readonly assetRoot: string
  readonly generatedRoot: string
}

export interface PublicationScopeDelegation {
  readonly schemaVersion: typeof PUBLICATION_SCOPE_DELEGATION_SCHEMA_VERSION
  readonly leases: Readonly<Record<string, string>>
}

export type PublicationScopeSource = 'owned' | 'in-process' | 'delegated'

export interface PublicationScopeLeaseEntry extends PublicationScope {
  readonly token: string
  readonly source: PublicationScopeSource
}

export interface PublicationScopesLease {
  /** Requested scopes in the global canonical acquisition order. */
  readonly scopes: readonly PublicationScopeLeaseEntry[]
  /**
   * Merge this one-key object into a child process environment. It contains
   * every ambient/delegated lease known to this callback, not only the roots
   * requested by the innermost operation.
   */
  readonly delegationEnvironment: Readonly<Record<string, string>>
}

export interface PublicationScopeWaitOwner {
  readonly hostname: string
  readonly pid: number
  readonly intent: string
  readonly label?: string
  readonly acquiredAt: string
}

export interface PublicationScopeWaitFact {
  readonly scope: PublicationScope
  readonly waitedMs: number
  readonly owner: PublicationScopeWaitOwner | null
  readonly metadataProblem?: string
  readonly message: string
}

export interface PublicationScopesOptions extends PublicationScopeResolutionOptions {
  readonly roots: readonly string[]
  readonly intent: string
  readonly label?: string
  readonly signal?: AbortSignal
  readonly pollIntervalMs?: number
  readonly heartbeatIntervalMs?: number
  readonly staleAfterMs?: number
  readonly waitReportIntervalMs?: number
  readonly onWait?: (fact: PublicationScopeWaitFact) => void
}

interface HeldPublicationScope {
  readonly scope: PublicationScope
  readonly token: string
}

const heldScopesStorage =
  new AsyncLocalStorage<ReadonlyMap<string, HeldPublicationScope>>()
const DEFAULT_WAIT_REPORT_INTERVAL_MS = 1_000

function errnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function foldWindowsPath(path: string): string {
  return process.platform === 'win32'
    ? path.toLocaleLowerCase('en-US')
    : path
}

function compareCanonicalPaths(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizeAbsolutePath(path: string, subject: string): string {
  if (!isAbsolute(path)) {
    throw new PublicationScopesError(
      'UNSUPPORTED_ROOT',
      `${subject} must be absolute so independent processes derive one publication scope: ${path}`,
    )
  }
  if (
    process.platform === 'win32'
    && path.replaceAll('/', '\\').startsWith('\\\\')
  ) {
    throw new PublicationScopesError(
      'UNSUPPORTED_ROOT',
      `${subject} must be on a local filesystem; Windows UNC paths cannot provide one cross-process publication lease: ${path}`,
    )
  }
  return foldWindowsPath(resolve(path))
}

/**
 * Resolves symlinks/junctions in the nearest existing parent, then appends any
 * missing suffix. This gives not-yet-created output roots the same identity
 * they will have after publication.
 */
export function canonicalizePublicationRoot(root: string): string {
  const absolute = normalizeAbsolutePath(root, 'Publication root')
  const missingSegments: string[] = []
  let candidate = absolute
  for (;;) {
    try {
      const real = realpathSync.native(candidate)
      if (missingSegments.length === 0 && !statSync(real).isDirectory()) {
        throw new PublicationScopesError(
          'UNSUPPORTED_ROOT',
          `Publication root exists but is not a directory: ${root}`,
        )
      }
      return foldWindowsPath(resolve(real, ...missingSegments))
    } catch (error) {
      if (error instanceof PublicationScopesError) throw error
      if (errnoCode(error) !== 'ENOENT') {
        throw new PublicationScopesError(
          'UNSUPPORTED_ROOT',
          `Could not canonicalize publication root ${root}.`,
          { cause: error },
        )
      }
      const parent = dirname(candidate)
      if (parent === candidate) {
        throw new PublicationScopesError(
          'UNSUPPORTED_ROOT',
          `Could not find an existing parent for publication root: ${root}`,
          { cause: error },
        )
      }
      missingSegments.unshift(basename(candidate))
      candidate = parent
    }
  }
}

function defaultCacheBase(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (process.platform === 'win32') {
    const localAppData = environment.LOCALAPPDATA
    return localAppData && isAbsolute(localAppData)
      ? localAppData
      : join(homedir(), 'AppData', 'Local')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches')
  }
  const xdgCacheHome = environment.XDG_CACHE_HOME
  return xdgCacheHome && isAbsolute(xdgCacheHome)
    ? xdgCacheHome
    : join(homedir(), '.cache')
}

export function publicationScopeRegistryDirectory(
  options: PublicationScopeResolutionOptions = {},
): string {
  const environment = options.environment ?? process.env
  const environmentOverride = environment[PUBLICATION_SCOPE_REGISTRY_ENV]
  if (environmentOverride !== undefined && !isAbsolute(environmentOverride)) {
    throw new PublicationScopesError(
      'UNSUPPORTED_ROOT',
      `${PUBLICATION_SCOPE_REGISTRY_ENV} must be an absolute local directory: ${environmentOverride}`,
    )
  }
  const configured = options.registryDirectory
    ?? environmentOverride
    ?? join(
      defaultCacheBase(environment),
      'Blendlink',
      'publication-leases-v1',
    )
  return canonicalizePublicationRoot(configured)
}

export function resolvePublicationScopes(
  roots: readonly string[],
  options: PublicationScopeResolutionOptions = {},
): readonly PublicationScope[] {
  const registryDirectory = publicationScopeRegistryDirectory(options)
  const canonicalRoots = [...new Set(
    roots.map((root) => canonicalizePublicationRoot(root)),
  )].sort(compareCanonicalPaths)
  const seenLockPaths = new Map<string, string>()
  const scopes = canonicalRoots.map((root) => {
    const rootHash = createHash('sha256').update(root, 'utf8').digest('hex')
    const lockPath = foldWindowsPath(join(registryDirectory, `${rootHash}.lease`))
    const collision = seenLockPaths.get(lockPath)
    if (collision !== undefined && collision !== root) {
      throw new PublicationScopesError(
        'INVALID_OPTIONS',
        `Two distinct publication roots produced one SHA-256 lease path: ${collision} and ${root}.`,
      )
    }
    seenLockPaths.set(lockPath, root)
    return Object.freeze({ root, rootHash, lockPath })
  })
  return Object.freeze(scopes)
}

export function publicationRootsForScene(scene: {
  readonly glbPath: string
  readonly manifestPath: string
  readonly modulePath: string
}): ScenePublicationRoots {
  const assetRoot = canonicalizePublicationRoot(dirname(scene.glbPath))
  const manifestRoot = canonicalizePublicationRoot(dirname(scene.manifestPath))
  const moduleRoot = canonicalizePublicationRoot(dirname(scene.modulePath))
  if (manifestRoot !== moduleRoot) {
    throw new PublicationScopesError(
      'GENERATED_ROOT_MISMATCH',
      `Scene manifest and generated module do not share one publication root: ${manifestRoot} versus ${moduleRoot}.`,
    )
  }
  return Object.freeze({
    assetRoot,
    generatedRoot: manifestRoot,
  })
}

function normalizedLockPath(lockPath: string): string {
  return normalizeAbsolutePath(lockPath, 'Delegated publication lease path')
}

function delegationFromEntries(
  entries: readonly { readonly lockPath: string; readonly token: string }[],
): PublicationScopeDelegation {
  const sorted = [...entries]
    .map((entry) => ({
      lockPath: normalizedLockPath(entry.lockPath),
      token: entry.token,
    }))
    .sort((left, right) => compareCanonicalPaths(left.lockPath, right.lockPath))
  const leases: Record<string, string> = {}
  for (const entry of sorted) {
    if (!entry.token) {
      throw new PublicationScopesError(
        'INVALID_DELEGATION',
        `Delegated publication lease token is empty for ${entry.lockPath}.`,
      )
    }
    const prior = leases[entry.lockPath]
    if (prior !== undefined && prior !== entry.token) {
      throw new PublicationScopesError(
        'INVALID_DELEGATION',
        `Delegated publication lease path has conflicting tokens: ${entry.lockPath}.`,
      )
    }
    leases[entry.lockPath] = entry.token
  }
  return Object.freeze({
    schemaVersion: PUBLICATION_SCOPE_DELEGATION_SCHEMA_VERSION,
    leases: Object.freeze(leases),
  })
}

export function publicationScopeDelegationEnvironment(
  entries: readonly { readonly lockPath: string; readonly token: string }[],
): Readonly<Record<string, string>> {
  const delegation = delegationFromEntries(entries)
  return Object.freeze({
    [PUBLICATION_SCOPE_DELEGATION_ENV]: JSON.stringify(delegation),
  })
}

export function readPublicationScopeDelegation(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PublicationScopeDelegation {
  const encoded = environment[PUBLICATION_SCOPE_DELEGATION_ENV]
  if (encoded === undefined || encoded === '') return delegationFromEntries([])
  let candidate: unknown
  try {
    candidate = JSON.parse(encoded)
  } catch (error) {
    throw new PublicationScopesError(
      'INVALID_DELEGATION',
      `Publication lease delegation environment is not valid JSON (${PUBLICATION_SCOPE_DELEGATION_ENV}).`,
      { cause: error },
    )
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new PublicationScopesError(
      'INVALID_DELEGATION',
      'Publication lease delegation environment must contain a JSON object.',
    )
  }
  const value = candidate as Record<string, unknown>
  if (value.schemaVersion !== PUBLICATION_SCOPE_DELEGATION_SCHEMA_VERSION) {
    throw new PublicationScopesError(
      'INVALID_DELEGATION',
      `Publication lease delegation schemaVersion ${String(value.schemaVersion)} is unsupported; expected ${PUBLICATION_SCOPE_DELEGATION_SCHEMA_VERSION}.`,
    )
  }
  if (!value.leases || typeof value.leases !== 'object' || Array.isArray(value.leases)) {
    throw new PublicationScopesError(
      'INVALID_DELEGATION',
      'Publication lease delegation leases must be a lockPath-to-token JSON object.',
    )
  }
  return delegationFromEntries(
    Object.entries(value.leases as Record<string, unknown>).map(
      ([lockPath, token]) => {
        if (typeof token !== 'string') {
          throw new PublicationScopesError(
            'INVALID_DELEGATION',
            `Delegated publication lease token must be a string for ${lockPath}.`,
          )
        }
        return { lockPath, token }
      },
    ),
  )
}

function waitReportInterval(value: number | undefined): number {
  const interval = value ?? DEFAULT_WAIT_REPORT_INTERVAL_MS
  if (!Number.isFinite(interval) || interval < 0) {
    throw new PublicationScopesError(
      'INVALID_OPTIONS',
      `Publication scope waitReportIntervalMs must be a non-negative number; received ${String(interval)}.`,
    )
  }
  return interval
}

function artistWaitFact(
  scope: PublicationScope,
  wait: PublicationLeaseWait,
): PublicationScopeWaitFact {
  const owner = wait.owner === null
    ? null
    : Object.freeze({
      hostname: wait.owner.hostname,
      pid: wait.owner.pid,
      intent: wait.owner.intent,
      ...(wait.owner.label === undefined ? {} : { label: wait.owner.label }),
      acquiredAt: wait.owner.acquiredAt,
    })
  let message: string
  if (owner !== null) {
    const operation = owner.label?.trim() || owner.intent
    message = `Waiting for ${operation} to finish publishing ${scope.root}.`
  } else if (wait.metadataProblem !== undefined) {
    message = `Waiting to publish ${scope.root}; the existing lease owner metadata cannot be read (${wait.metadataProblem}).`
  } else {
    message = `Waiting for another Blendlink operation to finish publishing ${scope.root}.`
  }
  return Object.freeze({
    scope,
    waitedMs: wait.waitedMs,
    owner,
    ...(wait.metadataProblem === undefined
      ? {}
      : { metadataProblem: wait.metadataProblem }),
    message,
  })
}

function throttledWaitReporter(
  scope: PublicationScope,
  intervalMs: number,
  onWait: ((fact: PublicationScopeWaitFact) => void) | undefined,
): ((wait: PublicationLeaseWait) => void) | undefined {
  if (onWait === undefined) return undefined
  let lastReportedAt = Number.NEGATIVE_INFINITY
  let lastOwnerIdentity: string | undefined
  return (wait) => {
    const ownerIdentity = wait.owner?.token ?? `metadata:${wait.metadataProblem ?? 'unknown'}`
    if (
      ownerIdentity === lastOwnerIdentity
      && wait.waitedMs - lastReportedAt < intervalMs
    ) {
      return
    }
    lastReportedAt = wait.waitedMs
    lastOwnerIdentity = ownerIdentity
    onWait(artistWaitFact(scope, wait))
  }
}

function mergeDelegation(
  inherited: PublicationScopeDelegation,
  held: ReadonlyMap<string, HeldPublicationScope>,
): Readonly<Record<string, string>> {
  const entries = Object.entries(inherited.leases).map(([lockPath, token]) => ({
    lockPath,
    token,
  }))
  for (const value of held.values()) {
    entries.push({
      lockPath: value.scope.lockPath,
      token: value.token,
    })
  }
  return publicationScopeDelegationEnvironment(entries)
}

function assertNoOrderInversion(
  scopes: readonly PublicationScope[],
  ambient: ReadonlyMap<string, HeldPublicationScope>,
  delegated: PublicationScopeDelegation,
): void {
  const heldRoots = [...ambient.keys()].sort(compareCanonicalPaths)
  const highestHeldRoot = heldRoots.at(-1)
  if (highestHeldRoot === undefined) return
  const inversion = scopes.find((scope) => (
    !ambient.has(scope.root)
    && delegated.leases[scope.lockPath] === undefined
    && compareCanonicalPaths(scope.root, highestHeldRoot) < 0
  ))
  if (inversion === undefined) return
  throw new PublicationScopesError(
    'SCOPE_ORDER_VIOLATION',
    `Nested publication work cannot acquire ${inversion.root} after already holding ${highestHeldRoot}; request the complete root set in the outer operation so leases stay globally ordered.`,
  )
}

/**
 * Coordinates all mutable output roots for one publication operation.
 *
 * Roots are canonicalized, de-duplicated, and acquired in one global order.
 * AsyncLocal nesting reuses already-held scopes. A child process can re-enter
 * by receiving `lease.delegationEnvironment` in its environment.
 */
export async function withPublicationScopes<T>(
  options: PublicationScopesOptions,
  operation: (lease: PublicationScopesLease) => Promise<T> | T,
): Promise<T> {
  const scopes = resolvePublicationScopes(options.roots, options)
  if (scopes.length === 0) {
    throw new PublicationScopesError(
      'INVALID_OPTIONS',
      'Publication scope coordination requires at least one output root.',
    )
  }
  const delegated = readPublicationScopeDelegation(
    options.environment ?? process.env,
  )
  const ambient = heldScopesStorage.getStore() ?? new Map()
  assertNoOrderInversion(scopes, ambient, delegated)
  const reportIntervalMs = waitReportInterval(options.waitReportIntervalMs)
  const sources = new Map<string, PublicationScopeSource>()

  const acquire = async (
    index: number,
    held: ReadonlyMap<string, HeldPublicationScope>,
  ): Promise<T> => {
    if (index >= scopes.length) {
      const entries = scopes.map((requestedScope) => {
        const value = held.get(requestedScope.root)
        if (value === undefined) {
          throw new PublicationScopesError(
            'INVALID_OPTIONS',
            `Publication scope was not held after acquisition: ${requestedScope.root}`,
          )
        }
        return Object.freeze({
          ...value.scope,
          token: value.token,
          source: sources.get(requestedScope.root) ?? 'in-process',
        })
      })
      const lease: PublicationScopesLease = Object.freeze({
        scopes: Object.freeze(entries),
        delegationEnvironment: mergeDelegation(delegated, held),
      })
      return operation(lease)
    }

    const scope = scopes[index]!
    const existing = held.get(scope.root)
    if (existing !== undefined) {
      sources.set(scope.root, 'in-process')
      return acquire(index + 1, held)
    }
    const reentrantToken = delegated.leases[scope.lockPath]
    return withPublicationLease({
      lockPath: scope.lockPath,
      intent: options.intent,
      label: options.label,
      ...(reentrantToken === undefined ? {} : { reentrantToken }),
      signal: options.signal,
      pollIntervalMs: options.pollIntervalMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      staleAfterMs: options.staleAfterMs,
      onWait: throttledWaitReporter(
        scope,
        reportIntervalMs,
        options.onWait,
      ),
    }, (lease: PublicationLease) => {
      const nextHeld = new Map(held)
      nextHeld.set(scope.root, {
        scope,
        token: lease.token,
      })
      sources.set(
        scope.root,
        lease.reentrant ? 'delegated' : 'owned',
      )
      return heldScopesStorage.run(
        nextHeld,
        () => acquire(index + 1, nextHeld),
      )
    })
  }

  return acquire(0, ambient)
}
