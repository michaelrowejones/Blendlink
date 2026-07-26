import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  futimesSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'

export const PUBLICATION_LEASE_SCHEMA_VERSION = 1 as const

export type PublicationLeaseErrorCode =
  | 'ABORTED'
  | 'HEARTBEAT_FAILED'
  | 'INVALID_OPTIONS'
  | 'OWNERSHIP_LOST'
  | 'RECOVERY_FAILED'
  | 'REENTRY_DENIED'
  | 'UNSUPPORTED_PATH'

export class PublicationLeaseError extends Error {
  readonly code: PublicationLeaseErrorCode

  constructor(
    code: PublicationLeaseErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = code === 'ABORTED' ? 'AbortError' : 'PublicationLeaseError'
    this.code = code
  }
}

export interface PublicationLeaseRecord {
  readonly schemaVersion: typeof PUBLICATION_LEASE_SCHEMA_VERSION
  readonly token: string
  readonly hostname: string
  readonly pid: number
  readonly intent: string
  readonly label?: string
  readonly acquiredAt: string
}

export interface PublicationLease {
  readonly lockPath: string
  readonly token: string
  readonly record: PublicationLeaseRecord
  /**
   * True when this callback joined an explicitly delegated outer lease.
   * Reentrant participants heartbeat the lease but never remove it.
   */
  readonly reentrant: boolean
}

export interface PublicationLeaseWait {
  readonly lockPath: string
  readonly waitedMs: number
  readonly owner: PublicationLeaseRecord | null
  readonly metadataProblem?: string
}

export interface PublicationLeaseOptions {
  /**
   * One absolute lock pathname for one publication namespace.
   *
   * `wx` is a cooperative local-filesystem primitive. UNC paths are rejected
   * on Windows; Node cannot reliably identify mapped drives or POSIX network
   * mounts, so callers must keep this path on a local filesystem.
   */
  readonly lockPath: string
  /** Short, inspectable operation name such as `preview`, `final`, or `publish`. */
  readonly intent: string
  /** Optional artist-readable scene/quality detail written to the owner record. */
  readonly label?: string
  /**
   * Exact outer token for deliberate nested work, including a child process.
   * This grants heartbeat participation, never cleanup authority.
   */
  readonly reentrantToken?: string
  /** Cancels only acquisition/waiting. The callback owns cancellation after entry. */
  readonly signal?: AbortSignal
  readonly pollIntervalMs?: number
  readonly heartbeatIntervalMs?: number
  readonly staleAfterMs?: number
  readonly onWait?: (wait: PublicationLeaseWait) => void
}

interface NormalizedOptions {
  readonly lockPath: string
  readonly intent: string
  readonly label?: string
  readonly reentrantToken?: string
  readonly signal?: AbortSignal
  readonly pollIntervalMs: number
  readonly heartbeatIntervalMs: number
  readonly staleAfterMs: number
  readonly onWait?: (wait: PublicationLeaseWait) => void
}

interface LeaseSnapshot {
  readonly record: PublicationLeaseRecord | null
  readonly mtimeMs: number
  readonly metadataProblem?: string
}

interface OpenLease {
  readonly fd: number
  readonly record: PublicationLeaseRecord
}

interface Heartbeat {
  stop(): void
}

const DEFAULT_POLL_INTERVAL_MS = 50
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2_000
const DEFAULT_STALE_AFTER_MS = 15_000

function errnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function normalizedHostname(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function positiveMilliseconds(
  name: string,
  value: number | undefined,
  fallback: number,
): number {
  const resolvedValue = value ?? fallback
  if (!Number.isFinite(resolvedValue) || resolvedValue <= 0) {
    throw new PublicationLeaseError(
      'INVALID_OPTIONS',
      `Publication lease ${name} must be a positive number of milliseconds; received ${String(resolvedValue)}.`,
    )
  }
  return resolvedValue
}

function normalizeOptions(options: PublicationLeaseOptions): NormalizedOptions {
  if (!isAbsolute(options.lockPath)) {
    throw new PublicationLeaseError(
      'UNSUPPORTED_PATH',
      `Publication lease path must be absolute so every process addresses the same namespace: ${options.lockPath}`,
    )
  }
  if (
    process.platform === 'win32'
    && options.lockPath.replaceAll('/', '\\').startsWith('\\\\')
  ) {
    throw new PublicationLeaseError(
      'UNSUPPORTED_PATH',
      `Publication leases require a local filesystem; Windows UNC paths are not supported: ${options.lockPath}`,
    )
  }
  const intent = options.intent.trim()
  if (!intent) {
    throw new PublicationLeaseError(
      'INVALID_OPTIONS',
      'Publication lease intent must be a non-empty, inspectable operation name.',
    )
  }
  if (options.reentrantToken !== undefined && !options.reentrantToken.trim()) {
    throw new PublicationLeaseError(
      'INVALID_OPTIONS',
      'Publication lease reentrantToken must be omitted or contain the exact outer lease token.',
    )
  }
  return {
    lockPath: resolve(options.lockPath),
    intent,
    label: options.label,
    reentrantToken: options.reentrantToken,
    signal: options.signal,
    pollIntervalMs: positiveMilliseconds(
      'pollIntervalMs',
      options.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
    ),
    heartbeatIntervalMs: positiveMilliseconds(
      'heartbeatIntervalMs',
      options.heartbeatIntervalMs,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
    ),
    staleAfterMs: positiveMilliseconds(
      'staleAfterMs',
      options.staleAfterMs,
      DEFAULT_STALE_AFTER_MS,
    ),
    onWait: options.onWait,
  }
}

function abortError(lockPath: string, signal: AbortSignal): PublicationLeaseError {
  return new PublicationLeaseError(
    'ABORTED',
    `Waiting for publication lease was aborted: ${lockPath}`,
    { cause: signal.reason },
  )
}

function throwIfAborted(signal: AbortSignal | undefined, lockPath: string): void {
  if (signal?.aborted) throw abortError(lockPath, signal)
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal | undefined,
  lockPath: string,
): Promise<void> {
  throwIfAborted(signal, lockPath)
  await new Promise<void>((resolvePromise, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer)
      reject(abortError(lockPath, signal!))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolvePromise()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function parseRecordText(text: string): {
  record: PublicationLeaseRecord | null
  problem?: string
} {
  let candidate: unknown
  try {
    candidate = JSON.parse(text)
  } catch (error) {
    return {
      record: null,
      problem: `owner metadata is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { record: null, problem: 'owner metadata must be a JSON object' }
  }
  const value = candidate as Record<string, unknown>
  if (value.schemaVersion !== PUBLICATION_LEASE_SCHEMA_VERSION) {
    return {
      record: null,
      problem: `owner metadata schemaVersion must be ${PUBLICATION_LEASE_SCHEMA_VERSION}`,
    }
  }
  if (typeof value.token !== 'string' || !value.token) {
    return { record: null, problem: 'owner metadata token must be a non-empty string' }
  }
  if (typeof value.hostname !== 'string' || !value.hostname) {
    return { record: null, problem: 'owner metadata hostname must be a non-empty string' }
  }
  if (!Number.isSafeInteger(value.pid) || (value.pid as number) <= 0) {
    return { record: null, problem: 'owner metadata pid must be a positive integer' }
  }
  if (typeof value.intent !== 'string' || !value.intent) {
    return { record: null, problem: 'owner metadata intent must be a non-empty string' }
  }
  if (value.label !== undefined && typeof value.label !== 'string') {
    return { record: null, problem: 'owner metadata label must be a string when present' }
  }
  if (
    typeof value.acquiredAt !== 'string'
    || !Number.isFinite(Date.parse(value.acquiredAt))
  ) {
    return { record: null, problem: 'owner metadata acquiredAt must be an ISO timestamp' }
  }
  return {
    record: Object.freeze({
      schemaVersion: PUBLICATION_LEASE_SCHEMA_VERSION,
      token: value.token,
      hostname: value.hostname,
      pid: value.pid as number,
      intent: value.intent,
      ...(value.label === undefined ? {} : { label: value.label }),
      acquiredAt: value.acquiredAt,
    }),
  }
}

function readSnapshot(lockPath: string): LeaseSnapshot | null {
  let mtimeMs: number
  try {
    mtimeMs = statSync(lockPath).mtimeMs
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null
    throw error
  }
  let text: string
  try {
    text = readFileSync(lockPath, 'utf8')
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null
    throw error
  }
  const parsed = parseRecordText(text)
  return {
    record: parsed.record,
    mtimeMs,
    metadataProblem: parsed.problem,
  }
}

function createRecord(intent: string, label?: string): PublicationLeaseRecord {
  return Object.freeze({
    schemaVersion: PUBLICATION_LEASE_SCHEMA_VERSION,
    token: randomUUID(),
    hostname: hostname(),
    pid: process.pid,
    intent,
    ...(label === undefined ? {} : { label }),
    acquiredAt: new Date().toISOString(),
  })
}

function cleanupIncompleteCreate(lockPath: string, fd: number): void {
  const failures: unknown[] = []
  try {
    closeSync(fd)
  } catch (error) {
    failures.push(error)
  }
  try {
    unlinkSync(lockPath)
  } catch (error) {
    if (errnoCode(error) !== 'ENOENT') failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `Could not clean up an incomplete publication lease: ${lockPath}`,
    )
  }
}

function tryCreateOpenLease(
  lockPath: string,
  intent: string,
  label?: string,
): OpenLease | null {
  const record = createRecord(intent, label)
  let fd: number
  try {
    fd = openSync(lockPath, 'wx', 0o600)
  } catch (error) {
    if (errnoCode(error) === 'EEXIST') return null
    throw error
  }
  try {
    writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8')
    fsyncSync(fd)
  } catch (error) {
    try {
      cleanupIncompleteCreate(lockPath, fd)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Could not initialize or clean up publication lease: ${lockPath}`,
      )
    }
    throw error
  }
  return { fd, record }
}

function startHeartbeat(
  fd: number,
  lockPath: string,
  intervalMs: number,
): Heartbeat {
  let failure: unknown
  const timer = setInterval(() => {
    if (failure !== undefined) return
    const now = new Date()
    try {
      futimesSync(fd, now, now)
    } catch (error) {
      failure = error
    }
  }, intervalMs)
  timer.unref()
  return {
    stop() {
      clearInterval(timer)
      if (failure === undefined) return
      throw new PublicationLeaseError(
        'HEARTBEAT_FAILED',
        `Publication lease heartbeat failed: ${lockPath}`,
        { cause: failure },
      )
    },
  }
}

function currentHostOwns(record: PublicationLeaseRecord): boolean {
  return normalizedHostname(record.hostname) === normalizedHostname(hostname())
}

function ownerIsDefinitelyDead(record: PublicationLeaseRecord): boolean {
  if (!currentHostOwns(record)) return false
  try {
    process.kill(record.pid, 0)
    return false
  } catch (error) {
    return errnoCode(error) === 'ESRCH'
  }
}

function snapshotIsRecoverable(
  snapshot: LeaseSnapshot | null,
  staleAfterMs: number,
  now = Date.now(),
): snapshot is LeaseSnapshot & { record: PublicationLeaseRecord } {
  return snapshot?.record !== null
    && snapshot?.record !== undefined
    && now - snapshot.mtimeMs >= staleAfterMs
    && ownerIsDefinitelyDead(snapshot.record)
}

function removeIfTokenMatches(lockPath: string, token: string): boolean {
  const latest = readSnapshot(lockPath)
  if (latest?.record?.token !== token) return false
  unlinkSync(lockPath)
  return true
}

function recoverAbandonedRecoveryClaim(
  recoveryPath: string,
  staleAfterMs: number,
): void {
  const claim = readSnapshot(recoveryPath)
  if (!snapshotIsRecoverable(claim, staleAfterMs)) return
  removeIfTokenMatches(recoveryPath, claim.record.token)
}

function releaseRecoveryClaim(recoveryPath: string, claim: OpenLease): void {
  const failures: unknown[] = []
  try {
    if (!removeIfTokenMatches(recoveryPath, claim.record.token)) {
      failures.push(new PublicationLeaseError(
        'RECOVERY_FAILED',
        `Publication lease recovery claim changed owners before cleanup: ${recoveryPath}`,
      ))
    }
  } catch (error) {
    failures.push(error)
  }
  try {
    closeSync(claim.fd)
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `Publication lease recovery claim cleanup failed: ${recoveryPath}`,
    )
  }
}

function tryRecoverDeadOwner(
  lockPath: string,
  observed: LeaseSnapshot & { record: PublicationLeaseRecord },
  staleAfterMs: number,
): boolean {
  const recoveryPath = `${lockPath}.recovery`
  let claim = tryCreateOpenLease(
    recoveryPath,
    'recover-publication-lease',
    lockPath,
  )
  if (!claim) {
    recoverAbandonedRecoveryClaim(recoveryPath, staleAfterMs)
    claim = tryCreateOpenLease(
      recoveryPath,
      'recover-publication-lease',
      lockPath,
    )
  }
  if (!claim) return false

  let recovered = false
  let recoveryError: unknown
  try {
    const current = readSnapshot(lockPath)
    if (
      current?.record?.token === observed.record.token
      && snapshotIsRecoverable(current, staleAfterMs)
    ) {
      unlinkSync(lockPath)
      recovered = true
    }
  } catch (error) {
    recoveryError = new PublicationLeaseError(
      'RECOVERY_FAILED',
      `Could not recover dead publication lease owner at ${lockPath}.`,
      { cause: error },
    )
  }

  let cleanupError: unknown
  try {
    releaseRecoveryClaim(recoveryPath, claim)
  } catch (error) {
    cleanupError = error
  }
  if (recoveryError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [recoveryError, cleanupError],
      `Publication lease recovery and recovery-claim cleanup both failed: ${lockPath}`,
    )
  }
  if (recoveryError !== undefined) throw recoveryError
  if (cleanupError !== undefined) throw cleanupError
  return recovered
}

function releaseOwnedLease(
  lockPath: string,
  opened: OpenLease,
  heartbeat: Heartbeat,
): void {
  const failures: unknown[] = []
  try {
    heartbeat.stop()
  } catch (error) {
    failures.push(error)
  }
  try {
    if (!removeIfTokenMatches(lockPath, opened.record.token)) {
      failures.push(new PublicationLeaseError(
        'OWNERSHIP_LOST',
        `Publication lease cleanup refused to remove a missing or successor owner at ${lockPath}.`,
      ))
    }
  } catch (error) {
    failures.push(error)
  }
  try {
    closeSync(opened.fd)
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `Publication lease cleanup failed: ${lockPath}`,
    )
  }
}

function openReentrantLease(
  options: NormalizedOptions,
): {
  lease: PublicationLease
  cleanup: () => void
} {
  let fd: number
  try {
    fd = openSync(options.lockPath, 'r+')
  } catch (error) {
    throw new PublicationLeaseError(
      'REENTRY_DENIED',
      `Cannot re-enter publication lease because no readable outer lease exists at ${options.lockPath}.`,
      { cause: error },
    )
  }
  let record: PublicationLeaseRecord | null = null
  let metadataProblem: string | undefined
  try {
    const parsed = parseRecordText(readFileSync(fd, 'utf8'))
    record = parsed.record
    metadataProblem = parsed.problem
  } catch (error) {
    closeSync(fd)
    throw new PublicationLeaseError(
      'REENTRY_DENIED',
      `Cannot read outer publication lease for explicit reentry: ${options.lockPath}`,
      { cause: error },
    )
  }
  if (
    !record
    || record.token !== options.reentrantToken
    || !currentHostOwns(record)
  ) {
    closeSync(fd)
    const detail = metadataProblem ? ` (${metadataProblem})` : ''
    throw new PublicationLeaseError(
      'REENTRY_DENIED',
      `Explicit reentry token does not identify a same-host outer publication lease at ${options.lockPath}${detail}.`,
    )
  }
  const heartbeat = startHeartbeat(
    fd,
    options.lockPath,
    options.heartbeatIntervalMs,
  )
  return {
    lease: Object.freeze({
      lockPath: options.lockPath,
      token: record.token,
      record,
      reentrant: true,
    }),
    cleanup() {
      const failures: unknown[] = []
      try {
        heartbeat.stop()
      } catch (error) {
        failures.push(error)
      }
      try {
        closeSync(fd)
      } catch (error) {
        failures.push(error)
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          `Reentrant publication lease heartbeat cleanup failed: ${options.lockPath}`,
        )
      }
    },
  }
}

async function runWithCleanup<T>(
  operation: () => Promise<T> | T,
  cleanup: () => void,
  failureMessage: string,
): Promise<T> {
  let result!: T
  let operationError: unknown
  try {
    result = await operation()
  } catch (error) {
    operationError = error
  }
  let cleanupError: unknown
  try {
    cleanup()
  } catch (error) {
    cleanupError = error
  }
  if (operationError !== undefined && cleanupError !== undefined) {
    throw new AggregateError([operationError, cleanupError], failureMessage)
  }
  if (operationError !== undefined) throw operationError
  if (cleanupError !== undefined) throw cleanupError
  return result
}

/**
 * Runs one publication transaction under a cooperative, inspectable local
 * filesystem lease. A late or failed callback always attempts token-safe
 * cleanup. Explicit reentrant participants keep the outer lease alive but
 * cannot remove it.
 */
export async function withPublicationLease<T>(
  suppliedOptions: PublicationLeaseOptions,
  operation: (lease: PublicationLease) => Promise<T> | T,
): Promise<T> {
  const options = normalizeOptions(suppliedOptions)
  throwIfAborted(options.signal, options.lockPath)

  if (options.reentrantToken !== undefined) {
    const reentrant = openReentrantLease(options)
    return runWithCleanup(
      () => operation(reentrant.lease),
      reentrant.cleanup,
      `Reentrant publication work and heartbeat cleanup both failed: ${options.lockPath}`,
    )
  }

  mkdirSync(dirname(options.lockPath), { recursive: true })
  const waitStartedAt = Date.now()
  for (;;) {
    throwIfAborted(options.signal, options.lockPath)
    const opened = tryCreateOpenLease(
      options.lockPath,
      options.intent,
      options.label,
    )
    if (opened) {
      const heartbeat = startHeartbeat(
        opened.fd,
        options.lockPath,
        options.heartbeatIntervalMs,
      )
      const lease: PublicationLease = Object.freeze({
        lockPath: options.lockPath,
        token: opened.record.token,
        record: opened.record,
        reentrant: false,
      })
      return runWithCleanup(
        () => operation(lease),
        () => releaseOwnedLease(options.lockPath, opened, heartbeat),
        `Publication work failed and its lease could not be cleaned up: ${options.lockPath}`,
      )
    }

    const observed = readSnapshot(options.lockPath)
    if (
      observed
      && observed.record === null
      && Date.now() - observed.mtimeMs >= options.staleAfterMs
    ) {
      throw new PublicationLeaseError(
        'RECOVERY_FAILED',
        `Publication lease owner metadata ${observed.metadataProblem ?? 'is invalid'} at ` +
          `${options.lockPath}. Blendlink refused to steal a lease whose owner cannot be ` +
          'proven dead. Confirm that no Blendlink publish/preview process is using this ' +
          'project, then remove the malformed lock file and retry.',
      )
    }
    if (
      snapshotIsRecoverable(observed, options.staleAfterMs)
      && tryRecoverDeadOwner(
        options.lockPath,
        observed,
        options.staleAfterMs,
      )
    ) {
      continue
    }
    options.onWait?.(Object.freeze({
      lockPath: options.lockPath,
      waitedMs: Date.now() - waitStartedAt,
      owner: observed?.record ?? null,
      ...(observed?.metadataProblem === undefined
        ? {}
        : { metadataProblem: observed.metadataProblem }),
    }))
    await abortableDelay(
      options.pollIntervalMs,
      options.signal,
      options.lockPath,
    )
  }
}
