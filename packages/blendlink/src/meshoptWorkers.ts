import { MeshoptDecoder } from 'meshoptimizer'

/** Decode work below this total uncompressed size stays on the main thread.
 * Worker startup has a real Blob/WASM cost, so small scenes are faster and
 * simpler without it. */
export const DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES = 4 * 1024 * 1024

/** A scene decoder should not consume every logical core on artist laptops or
 * mobile devices. Applications needing a larger global pool can own Meshopt's
 * lifecycle themselves and disable Blendlink's leases. */
export const MAX_MESHOPT_WORKERS = 4

export interface MeshoptWorkerOptions {
  /** Application-owned decoder override. Blendlink installs it as-is and
   * never calls useWorkers() on it; the application retains complete pool
   * lifecycle ownership. */
  meshoptDecoder?: MeshoptDecoderLike
  /** Worker count used while a large Meshopt scene is loading. Omit for an
   * automatic 1-2 worker policy, or pass false/0 to keep all decoding on the
   * main thread. Values are deliberately capped at four. */
  meshoptWorkerCount?: number | false
  /** Total decoded geometry bytes at which workers become worthwhile.
   * Defaults to 4 MiB. Set 0 to force workers even when a hand-authored
   * descriptor has no decoded-size evidence. */
  meshoptWorkerThresholdBytes?: number
}

export interface MeshoptDecoderLike {
  readonly supported: boolean
  readonly ready: Promise<void>
  decodeGltfBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array,
    mode: string,
    filter?: string,
  ): void
  decodeGltfBufferAsync?(
    count: number,
    size: number,
    source: Uint8Array,
    mode: string,
    filter?: string,
  ): Promise<Uint8Array>
  useWorkers?(count: number): void
}

export interface MeshoptWorkerEnvironment {
  /** False in SSR, restricted runtimes, and browsers missing Blob workers. */
  readonly canCreateWorkers: boolean
  readonly hardwareConcurrency?: number
  warn(message: string): void
}

export interface MeshoptDecoderLease {
  readonly decoder: MeshoptDecoderLike
  readonly usesWorkers: boolean
  release(): void
}

interface ResolvedMeshoptWorkerPolicy {
  readonly workerCount: number
  readonly thresholdBytes: number
  readonly shouldUseWorkers: boolean
}

function currentWorkerEnvironment(): MeshoptWorkerEnvironment {
  const globalRecord = globalThis as typeof globalThis & {
    Worker?: unknown
    Blob?: unknown
    URL?: { createObjectURL?: unknown; revokeObjectURL?: unknown }
    navigator?: { hardwareConcurrency?: unknown }
  }
  const hardwareConcurrency = globalRecord.navigator?.hardwareConcurrency
  return {
    canCreateWorkers: typeof globalRecord.Worker === 'function'
      && typeof globalRecord.Blob === 'function'
      && typeof globalRecord.URL?.createObjectURL === 'function'
      && typeof globalRecord.URL?.revokeObjectURL === 'function',
    ...(typeof hardwareConcurrency === 'number' && Number.isFinite(hardwareConcurrency)
      ? { hardwareConcurrency }
      : {}),
    warn(message) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(message)
      }
    },
  }
}

function assertWorkerCount(value: number | false | undefined): void {
  if (value === undefined || value === false) return
  if (!Number.isInteger(value) || value < 0 || value > MAX_MESHOPT_WORKERS) {
    throw new Error(
      `meshoptWorkerCount must be false or an integer from 0 to ${MAX_MESHOPT_WORKERS}; received ${String(value)}.`,
    )
  }
}

function assertWorkerThreshold(value: number | undefined): void {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `meshoptWorkerThresholdBytes must be a non-negative safe integer; received ${String(value)}.`,
    )
  }
}

export function validateMeshoptWorkerOptions(options: MeshoptWorkerOptions): void {
  if (options.meshoptDecoder !== undefined
      && (options.meshoptWorkerCount !== undefined
        || options.meshoptWorkerThresholdBytes !== undefined)) {
    throw new Error(
      'meshoptDecoder is application-owned and cannot be combined with ' +
        'meshoptWorkerCount or meshoptWorkerThresholdBytes. Choose one worker lifecycle owner.',
    )
  }
  assertWorkerCount(options.meshoptWorkerCount)
  assertWorkerThreshold(options.meshoptWorkerThresholdBytes)
}

function automaticWorkerCount(hardwareConcurrency: number | undefined): number {
  if (!Number.isFinite(hardwareConcurrency) || hardwareConcurrency === undefined) return 1
  // Leave at least one logical core for rendering and application work. Keep
  // the automatic pool small; explicit options can raise it to the hard cap
  // for applications that have measured their representative devices.
  return Math.min(2, Math.max(1, Math.floor(hardwareConcurrency) - 1))
}

export function resolveMeshoptWorkerPolicy(
  decodedBytes: number | undefined,
  options: MeshoptWorkerOptions = {},
  environment: Pick<MeshoptWorkerEnvironment, 'canCreateWorkers' | 'hardwareConcurrency'>
    = currentWorkerEnvironment(),
): ResolvedMeshoptWorkerPolicy {
  validateMeshoptWorkerOptions(options)
  if (decodedBytes !== undefined && (!Number.isSafeInteger(decodedBytes) || decodedBytes < 0)) {
    throw new Error(
      `meshoptDecodedBytes must be a non-negative safe integer; received ${String(decodedBytes)}.`,
    )
  }

  const thresholdBytes = options.meshoptWorkerThresholdBytes
    ?? DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES
  const workerCount = options.meshoptWorkerCount === false
    ? 0
    : options.meshoptWorkerCount === undefined
      ? automaticWorkerCount(environment.hardwareConcurrency)
      : options.meshoptWorkerCount
  // Unknown size evidence remains conservative unless the application
  // explicitly chooses threshold 0.
  const isLargeEnough = decodedBytes === undefined
    ? thresholdBytes === 0
    : decodedBytes >= thresholdBytes
  return {
    workerCount,
    thresholdBytes,
    shouldUseWorkers: environment.canCreateWorkers && workerCount > 0 && isLargeEnough,
  }
}

/** GLTFLoader calls the async method when it exists. This adapter deliberately
 * performs that decode with the official synchronous WASM API, isolating small
 * and configure-only loads from any concurrent global Meshopt worker pool. */
export function createMainThreadMeshoptDecoder(
  decoder: MeshoptDecoderLike,
): MeshoptDecoderLike {
  return {
    get supported() { return decoder.supported },
    ready: decoder.ready,
    decodeGltfBuffer(target, count, size, source, mode, filter) {
      decoder.decodeGltfBuffer(target, count, size, source, mode, filter)
    },
    async decodeGltfBufferAsync(count, size, source, mode, filter) {
      await decoder.ready
      const decodedBytes = count * size
      if (!Number.isSafeInteger(decodedBytes) || decodedBytes < 0) {
        throw new Error(
          `Meshopt decode output is not a safe byte length: ${String(count)} x ${String(size)}.`,
        )
      }
      const target = new Uint8Array(decodedBytes)
      decoder.decodeGltfBuffer(target, count, size, source, mode, filter)
      return target
    },
  }
}

/** Owns only workers started by Blendlink high-level scene loads. Meshopt's JS
 * API exposes one module-global pool and no ownership introspection, so this
 * manager holds its size steady while leases overlap and tears it down only
 * after every Blendlink load using it has settled. */
export class MeshoptWorkerManager {
  readonly mainThreadDecoder: MeshoptDecoderLike
  private activeLoadLeases = 0
  private activeWorkerCount = 0
  private workerPoolUnavailable = false
  private warned = false

  constructor(
    private readonly decoder: MeshoptDecoderLike = MeshoptDecoder,
    private readonly environment: MeshoptWorkerEnvironment = currentWorkerEnvironment(),
  ) {
    this.mainThreadDecoder = createMainThreadMeshoptDecoder(decoder)
  }

  acquire(
    decodedBytes: number | undefined,
    options: MeshoptWorkerOptions = {},
  ): MeshoptDecoderLease {
    const policy = resolveMeshoptWorkerPolicy(decodedBytes, options, this.environment)
    let usesWorkers = policy.shouldUseWorkers
      && !this.workerPoolUnavailable
      && this.decoder.useWorkers !== undefined
    if (usesWorkers && this.activeWorkerCount === 0) {
      // useWorkers() can create one worker and then throw while creating a
      // later one. Record the requested pool before the call so the failure
      // path still asks the official decoder to close any partial pool.
      this.activeWorkerCount = policy.workerCount
      try {
        this.decoder.useWorkers!(policy.workerCount)
      } catch (error) {
        this.workerPoolUnavailable = true
        const cleanupError = this.tryStopWorkers()
        this.activeWorkerCount = 0
        usesWorkers = false
        this.warnOnce(
          'Blendlink could not start Meshopt decode workers; this scene will decode on the main thread. ' +
            errorMessage(error) + (cleanupError === undefined
              ? ''
              : ` Cleanup of the partially-created pool also failed: ${errorMessage(cleanupError)}`),
        )
      }
    }

    // Resizing downward could close a worker with an in-flight decode. Hold
    // the first lease's bounded count until every overlapping Meshopt load
    // settles. Main-thread loads count too: this keeps teardown safe even if
    // an application reuses one mutable GLTFLoader across concurrent calls.
    this.activeLoadLeases += 1
    let released = false
    return {
      decoder: usesWorkers ? this.decoder : this.mainThreadDecoder,
      usesWorkers,
      release: () => {
        if (released) return
        released = true
        this.activeLoadLeases -= 1
        if (this.activeLoadLeases !== 0) return
        const cleanupError = this.tryStopWorkers()
        this.activeWorkerCount = 0
        if (cleanupError !== undefined) {
          this.warnOnce(
            'Blendlink could not stop its Meshopt decode workers cleanly. ' +
              errorMessage(cleanupError),
          )
        }
      },
    }
  }

  private tryStopWorkers(): unknown | undefined {
    if (this.activeWorkerCount === 0 || !this.decoder.useWorkers) return undefined
    try {
      this.decoder.useWorkers(0)
      return undefined
    } catch (error) {
      this.workerPoolUnavailable = true
      return error
    }
  }

  private warnOnce(message: string): void {
    if (this.warned) return
    this.warned = true
    this.environment.warn(message)
  }
}

const defaultMeshoptWorkerManager = new MeshoptWorkerManager()

/** Configure a decoder only for the duration of a real GLTF load. Keeping the
 * lease around the awaited load ensures every decoder promise has settled
 * before the module-global worker pool is released. */
export async function withMeshoptDecoderForLoad<T>(
  loader: { setMeshoptDecoder(decoder: unknown): unknown },
  decodedBytes: number | undefined,
  options: MeshoptWorkerOptions,
  load: () => Promise<T>,
  manager: Pick<MeshoptWorkerManager, 'acquire'> = defaultMeshoptWorkerManager,
): Promise<T> {
  validateMeshoptWorkerOptions(options)
  if (options.meshoptDecoder) {
    loader.setMeshoptDecoder(options.meshoptDecoder)
    return await load()
  }
  const lease = manager.acquire(decodedBytes, options)
  try {
    loader.setMeshoptDecoder(lease.decoder)
    return await load()
  } finally {
    lease.release()
  }
}

/** Side-effect-free decoder for loader configuration APIs. It never calls
 * MeshoptDecoder.useWorkers(), including in SSR and configure-only code. */
export const mainThreadMeshoptDecoder = defaultMeshoptWorkerManager.mainThreadDecoder

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
