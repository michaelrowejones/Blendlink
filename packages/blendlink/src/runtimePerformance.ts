/**
 * Runtime performance evidence gathered from browser and renderer APIs.
 *
 * This module deliberately has no renderer dependency and reads browser
 * globals only when a monitor is created. A Three.js WebGLRenderer is
 * structurally compatible with `RuntimePerformanceRenderer`.
 */

export interface RuntimeCapability {
  available: boolean
  unavailableReason?: string
}

export interface RuntimeDistribution {
  /** Samples observed during the whole measurement window. */
  samples: number
  /** Samples retained for percentile calculation. */
  retainedSamples: number
  /** Oldest samples overwritten after the configured capacity was reached. */
  droppedSamples: number
  minMs: number
  maxMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export interface RuntimeResourceTimingEntry {
  name?: string
  startTime: number
  transferSize?: number
  encodedBodySize?: number
  decodedBodySize?: number
}

export interface RuntimeLongTaskEntry {
  startTime: number
  duration: number
}

export interface RuntimeLongTaskSubscription {
  disconnect(): void
}

/** Injectable platform seam used by tests, workers, and non-browser hosts. */
export interface RuntimePerformanceEnvironment {
  now(): number
  /** The source is descriptive evidence, never an inferred precision claim. */
  clockSource?: 'performance' | 'date' | 'custom'
  getResourceEntries?(): readonly RuntimeResourceTimingEntry[]
  observeLongTasks?(
    onEntries: (entries: readonly RuntimeLongTaskEntry[]) => void,
  ): RuntimeLongTaskSubscription
  delay?(milliseconds: number): Promise<void>
}

/** Deliberately broad so a Three WebGLRenderer can be passed without a Three
 * dependency or a type cast. Renderer details are validated at the seam. */
export interface RuntimePerformanceRenderer {
  info?: unknown
  getContext?(): unknown
}

export interface RuntimePerformanceMonitorOptions {
  frameSampleCapacity?: number
  gpuSampleCapacity?: number
  /** Measure one eligible render callback every N calls to `sample`. */
  gpuSampleInterval?: number
  gpuFinishTimeoutMs?: number
  gpuPollIntervalMs?: number
  enableLongTasks?: boolean
  enableGpuTiming?: boolean
  environment?: RuntimePerformanceEnvironment
}

export interface RuntimeResourceMetrics {
  available: boolean
  unavailableReason?: string
  entries: number
  entriesWithSizeEvidence: number
  entriesWithoutSizeEvidence: number
  transferBytes?: number
  encodedBodyBytes?: number
  decodedBodyBytes?: number
}

export interface RuntimeFrameMetrics {
  available: boolean
  unavailableReason?: string
  distribution?: RuntimeDistribution
}

export interface RuntimeLongTaskMetrics {
  available: boolean
  unavailableReason?: string
  count: number
  totalDurationMs?: number
  maxDurationMs?: number
}

export interface RuntimeRendererMetrics {
  available: boolean
  unavailableReason?: string
  samples: number
  autoReset: boolean | null
  latest?: {
    calls: number | null
    triangles: number | null
    programs: number | null
    geometries: number | null
    textures: number | null
  }
  peak?: {
    calls: number | null
    triangles: number | null
    programs: number | null
    geometries: number | null
    textures: number | null
  }
}

export interface RuntimeGpuTimingMetrics {
  available: boolean
  unavailableReason?: string
  distribution?: RuntimeDistribution
  rejectedDisjointSamples: number
  timedRenderCallbacks: number
  pendingSamplesDiscarded: number
}

export interface RuntimePerformanceReport {
  evidence: 'browser-runtime'
  startedAtMs: number
  finishedAtMs: number
  durationMs: number
  clockSource: 'performance' | 'date' | 'custom'
  capabilities: {
    resourceTiming: RuntimeCapability
    longTasks: RuntimeCapability
    rendererInfo: RuntimeCapability
    gpuTimerQueryWebgl2: RuntimeCapability
  }
  resources: RuntimeResourceMetrics
  frames: RuntimeFrameMetrics
  longTasks: RuntimeLongTaskMetrics
  renderer: RuntimeRendererMetrics
  gpu: RuntimeGpuTimingMetrics
}

export interface RuntimePerformanceMonitor {
  start(): void
  /**
   * Call once per rendered frame. When `render` is supplied, Blendlink runs it
   * exactly once and can surround eligible calls with a non-blocking GPU timer
   * query. Supplying an explicit timestamp avoids a second clock read when an
   * animation loop already has a requestAnimationFrame timestamp.
   */
  sample(
    renderer?: RuntimePerformanceRenderer | null,
    render?: (() => void) | null,
    timestampMs?: number,
  ): void
  finish(renderer?: RuntimePerformanceRenderer | null): Promise<RuntimePerformanceReport>
  dispose(): void
}

interface TimerQueryExtension {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

interface TimerQueryContext {
  QUERY_RESULT_AVAILABLE: number
  QUERY_RESULT: number
  getExtension(name: string): unknown
  createQuery(): unknown
  beginQuery(target: number, query: unknown): void
  endQuery(target: number): void
  getQueryParameter(query: unknown, parameter: number): unknown
  getParameter(parameter: number): unknown
  deleteQuery(query: unknown): void
  flush?(): void
}

type MonitorState = 'idle' | 'running' | 'finishing' | 'finished' | 'disposed'

const DEFAULT_FRAME_CAPACITY = 4_096
const DEFAULT_GPU_CAPACITY = 1_024
const DEFAULT_GPU_SAMPLE_INTERVAL = 4
const DEFAULT_GPU_FINISH_TIMEOUT_MS = 120
const DEFAULT_GPU_POLL_INTERVAL_MS = 4

class FixedSampleBuffer {
  readonly #values: Float64Array
  #next = 0
  #retained = 0
  #samples = 0

  constructor(capacity: number) {
    this.#values = new Float64Array(capacity)
  }

  push(value: number): void {
    this.#values[this.#next] = value
    this.#next = (this.#next + 1) % this.#values.length
    if (this.#retained < this.#values.length) this.#retained += 1
    this.#samples += 1
  }

  distribution(): RuntimeDistribution | null {
    if (this.#retained === 0) return null
    const ordered = new Float64Array(this.#retained)
    for (let index = 0; index < this.#retained; index += 1) {
      ordered[index] = this.#values[index]!
    }
    ordered.sort()
    return {
      samples: this.#samples,
      retainedSamples: this.#retained,
      droppedSamples: this.#samples - this.#retained,
      minMs: ordered[0]!,
      maxMs: ordered[ordered.length - 1]!,
      p50Ms: percentile(ordered, 0.5),
      p95Ms: percentile(ordered, 0.95),
      p99Ms: percentile(ordered, 0.99),
    }
  }
}

class BrowserRuntimePerformanceMonitor implements RuntimePerformanceMonitor {
  readonly #environment: RuntimePerformanceEnvironment
  readonly #frameSamples: FixedSampleBuffer
  readonly #gpuSamples: FixedSampleBuffer
  readonly #gpuSampleInterval: number
  readonly #gpuFinishTimeoutMs: number
  readonly #gpuPollIntervalMs: number
  readonly #enableLongTasks: boolean
  readonly #enableGpuTiming: boolean

  #state: MonitorState = 'idle'
  #startedAtMs = 0
  #finishedAtMs = 0
  #lastFrameTimestampMs: number | null = null
  #resourceCapability: RuntimeCapability = unavailable('The monitor has not started.')
  #longTaskCapability: RuntimeCapability = unavailable('The monitor has not started.')
  #rendererCapability: RuntimeCapability = unavailable('No renderer.info evidence was sampled.')
  #gpuCapability: RuntimeCapability = unavailable('No measured render callback was sampled.')
  #longTaskSubscription: RuntimeLongTaskSubscription | null = null
  #longTaskCount = 0
  #longTaskTotalMs = 0
  #longTaskMaxMs = 0
  #asyncValidationError: Error | null = null

  #rendererSamples = 0
  #rendererAutoReset: boolean | null = null
  #latestCalls: number | null = null
  #latestTriangles: number | null = null
  #latestPrograms: number | null = null
  #latestGeometries: number | null = null
  #latestTextures: number | null = null
  #peakCalls: number | null = null
  #peakTriangles: number | null = null
  #peakPrograms: number | null = null
  #peakGeometries: number | null = null
  #peakTextures: number | null = null

  #gpuInitialized = false
  #gpuContext: TimerQueryContext | null = null
  #gpuExtension: TimerQueryExtension | null = null
  #pendingGpuQuery: unknown | null = null
  #renderCallbacks = 0
  #timedRenderCallbacks = 0
  #rejectedDisjointSamples = 0
  #pendingSamplesDiscarded = 0

  constructor(options: RuntimePerformanceMonitorOptions) {
    const frameCapacity = integerOption(
      options.frameSampleCapacity,
      DEFAULT_FRAME_CAPACITY,
      'frameSampleCapacity',
    )
    const gpuCapacity = integerOption(
      options.gpuSampleCapacity,
      DEFAULT_GPU_CAPACITY,
      'gpuSampleCapacity',
    )
    this.#gpuSampleInterval = integerOption(
      options.gpuSampleInterval,
      DEFAULT_GPU_SAMPLE_INTERVAL,
      'gpuSampleInterval',
    )
    this.#gpuFinishTimeoutMs = nonNegativeOption(
      options.gpuFinishTimeoutMs,
      DEFAULT_GPU_FINISH_TIMEOUT_MS,
      'gpuFinishTimeoutMs',
    )
    this.#gpuPollIntervalMs = positiveOption(
      options.gpuPollIntervalMs,
      DEFAULT_GPU_POLL_INTERVAL_MS,
      'gpuPollIntervalMs',
    )
    this.#frameSamples = new FixedSampleBuffer(frameCapacity)
    this.#gpuSamples = new FixedSampleBuffer(gpuCapacity)
    this.#enableLongTasks = options.enableLongTasks ?? true
    this.#enableGpuTiming = options.enableGpuTiming ?? true
    this.#environment = options.environment ?? createDefaultEnvironment()
    if (typeof this.#environment.now !== 'function') {
      throw new Error('Runtime performance environment must provide now().')
    }
  }

  start(): void {
    this.#expectState('idle', 'start')
    const startedAt = this.#environment.now()
    assertTimestamp(startedAt, 'Runtime performance start timestamp')
    this.#startedAtMs = startedAt
    this.#state = 'running'
    if (!this.#enableGpuTiming) {
      this.#gpuInitialized = true
      this.#gpuCapability = unavailable('GPU timing was disabled by options.')
    }

    this.#resourceCapability = typeof this.#environment.getResourceEntries === 'function'
      ? available()
      : unavailable('PerformanceResourceTiming is unavailable in this environment.')

    if (!this.#enableLongTasks) {
      this.#longTaskCapability = unavailable('Long-task observation was disabled by options.')
      return
    }
    if (typeof this.#environment.observeLongTasks !== 'function') {
      this.#longTaskCapability = unavailable('PerformanceObserver long-task entries are unavailable.')
      return
    }
    try {
      this.#longTaskSubscription = this.#environment.observeLongTasks((entries) => {
        this.#recordLongTasks(entries)
      })
      this.#longTaskCapability = available()
    } catch (error) {
      this.#longTaskCapability = unavailable(
        `Long-task observation could not start: ${errorMessage(error)}`,
      )
    }
  }

  sample(
    renderer: RuntimePerformanceRenderer | null = null,
    render: (() => void) | null = null,
    timestampMs?: number,
  ): void {
    this.#expectState('running', 'sample')
    this.#throwAsyncValidationError()
    if (render !== null && typeof render !== 'function') {
      throw new Error('Runtime performance sample render argument must be a function or null.')
    }

    const timestamp = timestampMs ?? this.#environment.now()
    assertTimestamp(timestamp, 'Runtime performance frame timestamp')
    if (timestamp < this.#startedAtMs) {
      throw new Error(
        `Runtime performance frame timestamp ${timestamp} precedes start timestamp ${this.#startedAtMs}; use the same clock for start and sample.`,
      )
    }
    if (this.#lastFrameTimestampMs !== null) {
      if (timestamp < this.#lastFrameTimestampMs) {
        throw new Error(
          `Runtime performance frame timestamps must be monotonic; received ${timestamp} after ${this.#lastFrameTimestampMs}.`,
        )
      }
      this.#frameSamples.push(timestamp - this.#lastFrameTimestampMs)
    }
    this.#lastFrameTimestampMs = timestamp

    this.#pollGpuQuery()
    if (render !== null) {
      this.#renderCallbacks += 1
      this.#initializeGpu(renderer)
      const canTime = this.#enableGpuTiming
        && this.#gpuCapability.available
        && this.#gpuContext !== null
        && this.#gpuExtension !== null
        && this.#pendingGpuQuery === null
        && (this.#renderCallbacks - 1) % this.#gpuSampleInterval === 0
      if (canTime) this.#runTimedRender(render)
      else render()
    }
    if (renderer !== null) this.#captureRendererInfo(renderer)
  }

  async finish(
    renderer: RuntimePerformanceRenderer | null = null,
  ): Promise<RuntimePerformanceReport> {
    this.#expectState('running', 'finish')
    this.#state = 'finishing'
    this.#throwAsyncValidationError()
    if (renderer !== null) this.#captureRendererInfo(renderer)
    const finishedAt = this.#environment.now()
    assertTimestamp(finishedAt, 'Runtime performance finish timestamp')
    if (finishedAt < this.#startedAtMs) {
      throw new Error('Runtime performance finish timestamp precedes its start timestamp.')
    }
    this.#finishedAtMs = finishedAt
    this.#disconnectLongTasks()
    await this.#finishGpuQuery()
    this.#throwAsyncValidationError()

    const resources = this.#collectResources()
    const frameDistribution = this.#frameSamples.distribution()
    const gpuDistribution = this.#gpuSamples.distribution()
    const report: RuntimePerformanceReport = {
      evidence: 'browser-runtime',
      startedAtMs: this.#startedAtMs,
      finishedAtMs: this.#finishedAtMs,
      durationMs: this.#finishedAtMs - this.#startedAtMs,
      clockSource: this.#environment.clockSource ?? 'custom',
      capabilities: {
        resourceTiming: this.#resourceCapability,
        longTasks: this.#longTaskCapability,
        rendererInfo: this.#rendererCapability,
        gpuTimerQueryWebgl2: this.#gpuCapability,
      },
      resources,
      frames: frameDistribution === null
        ? {
            available: false,
            unavailableReason: 'At least two frame samples are required to calculate a frame interval.',
          }
        : { available: true, distribution: frameDistribution },
      longTasks: this.#longTaskCapability.available
        ? {
            available: true,
            count: this.#longTaskCount,
            totalDurationMs: this.#longTaskTotalMs,
            maxDurationMs: this.#longTaskMaxMs,
          }
        : {
            available: false,
            unavailableReason: this.#longTaskCapability.unavailableReason,
            count: 0,
          },
      renderer: this.#rendererReport(),
      gpu: gpuDistribution === null
        ? {
            available: false,
            unavailableReason: this.#gpuUnavailableReason(),
            rejectedDisjointSamples: this.#rejectedDisjointSamples,
            timedRenderCallbacks: this.#timedRenderCallbacks,
            pendingSamplesDiscarded: this.#pendingSamplesDiscarded,
          }
        : {
            available: true,
            distribution: gpuDistribution,
            rejectedDisjointSamples: this.#rejectedDisjointSamples,
            timedRenderCallbacks: this.#timedRenderCallbacks,
            pendingSamplesDiscarded: this.#pendingSamplesDiscarded,
          },
    }
    this.#state = 'finished'
    return report
  }

  dispose(): void {
    if (this.#state === 'disposed') return
    this.#disconnectLongTasks()
    this.#discardPendingGpuQuery()
    this.#state = 'disposed'
  }

  #recordLongTasks(entries: readonly RuntimeLongTaskEntry[]): void {
    if (this.#state !== 'running') return
    try {
      for (const entry of entries) {
        assertTimestamp(entry.startTime, 'Long-task startTime')
        assertNonNegativeFinite(entry.duration, 'Long-task duration')
        if (entry.startTime < this.#startedAtMs) continue
        this.#longTaskCount += 1
        this.#longTaskTotalMs += entry.duration
        if (entry.duration > this.#longTaskMaxMs) this.#longTaskMaxMs = entry.duration
      }
    } catch (error) {
      this.#asyncValidationError = error instanceof Error ? error : new Error(String(error))
    }
  }

  #collectResources(): RuntimeResourceMetrics {
    if (!this.#resourceCapability.available || !this.#environment.getResourceEntries) {
      return {
        available: false,
        unavailableReason: this.#resourceCapability.unavailableReason,
        entries: 0,
        entriesWithSizeEvidence: 0,
        entriesWithoutSizeEvidence: 0,
      }
    }
    let entries: readonly RuntimeResourceTimingEntry[]
    try {
      entries = this.#environment.getResourceEntries()
    } catch (error) {
      const reason = `Resource timing entries could not be read: ${errorMessage(error)}`
      this.#resourceCapability = unavailable(reason)
      return {
        available: false,
        unavailableReason: reason,
        entries: 0,
        entriesWithSizeEvidence: 0,
        entriesWithoutSizeEvidence: 0,
      }
    }
    let count = 0
    let withSizes = 0
    let withoutSizes = 0
    let transferBytes = 0
    let encodedBodyBytes = 0
    let decodedBodyBytes = 0
    let transferEvidence = 0
    let encodedEvidence = 0
    let decodedEvidence = 0
    for (const entry of entries) {
      assertTimestamp(entry.startTime, `Resource timing startTime for ${entry.name ?? '<unnamed>'}`)
      if (entry.startTime < this.#startedAtMs || entry.startTime > this.#finishedAtMs) continue
      count += 1
      const hasTransfer = entry.transferSize !== undefined
      const hasEncoded = entry.encodedBodySize !== undefined
      const hasDecoded = entry.decodedBodySize !== undefined
      if (!hasTransfer && !hasEncoded && !hasDecoded) {
        withoutSizes += 1
        continue
      }
      withSizes += 1
      if (hasTransfer) {
        assertNonNegativeFinite(entry.transferSize, `Resource transferSize for ${entry.name ?? '<unnamed>'}`)
        transferBytes += entry.transferSize
        transferEvidence += 1
      }
      if (hasEncoded) {
        assertNonNegativeFinite(entry.encodedBodySize, `Resource encodedBodySize for ${entry.name ?? '<unnamed>'}`)
        encodedBodyBytes += entry.encodedBodySize
        encodedEvidence += 1
      }
      if (hasDecoded) {
        assertNonNegativeFinite(entry.decodedBodySize, `Resource decodedBodySize for ${entry.name ?? '<unnamed>'}`)
        decodedBodyBytes += entry.decodedBodySize
        decodedEvidence += 1
      }
    }
    return {
      available: true,
      entries: count,
      entriesWithSizeEvidence: withSizes,
      entriesWithoutSizeEvidence: withoutSizes,
      ...(count === 0 || transferEvidence > 0 ? { transferBytes } : {}),
      ...(count === 0 || encodedEvidence > 0 ? { encodedBodyBytes } : {}),
      ...(count === 0 || decodedEvidence > 0 ? { decodedBodyBytes } : {}),
    }
  }

  #captureRendererInfo(renderer: RuntimePerformanceRenderer): void {
    const info = asRecord(renderer.info)
    if (info === null) {
      if (!this.#rendererCapability.available) {
        this.#rendererCapability = unavailable('The sampled renderer does not expose renderer.info.')
      }
      return
    }
    const render = asRecord(info.render)
    const memory = asRecord(info.memory)
    const calls = optionalCounter(render?.calls, 'renderer.info.render.calls')
    const triangles = optionalCounter(render?.triangles, 'renderer.info.render.triangles')
    const geometries = optionalCounter(memory?.geometries, 'renderer.info.memory.geometries')
    const textures = optionalCounter(memory?.textures, 'renderer.info.memory.textures')
    const programs = programCount(info.programs)
    if (calls === null && triangles === null && geometries === null && textures === null && programs === null) {
      if (!this.#rendererCapability.available) {
        this.#rendererCapability = unavailable('renderer.info contained none of the supported counters.')
      }
      return
    }
    if (info.autoReset !== undefined && typeof info.autoReset !== 'boolean') {
      throw new Error('renderer.info.autoReset must be boolean when provided.')
    }
    this.#rendererCapability = available()
    this.#rendererSamples += 1
    this.#rendererAutoReset = typeof info.autoReset === 'boolean' ? info.autoReset : null
    this.#latestCalls = calls
    this.#latestTriangles = triangles
    this.#latestPrograms = programs
    this.#latestGeometries = geometries
    this.#latestTextures = textures
    this.#peakCalls = maxNullable(this.#peakCalls, calls)
    this.#peakTriangles = maxNullable(this.#peakTriangles, triangles)
    this.#peakPrograms = maxNullable(this.#peakPrograms, programs)
    this.#peakGeometries = maxNullable(this.#peakGeometries, geometries)
    this.#peakTextures = maxNullable(this.#peakTextures, textures)
  }

  #rendererReport(): RuntimeRendererMetrics {
    if (!this.#rendererCapability.available) {
      return {
        available: false,
        unavailableReason: this.#rendererCapability.unavailableReason,
        samples: 0,
        autoReset: null,
      }
    }
    return {
      available: true,
      samples: this.#rendererSamples,
      autoReset: this.#rendererAutoReset,
      latest: {
        calls: this.#latestCalls,
        triangles: this.#latestTriangles,
        programs: this.#latestPrograms,
        geometries: this.#latestGeometries,
        textures: this.#latestTextures,
      },
      peak: {
        calls: this.#peakCalls,
        triangles: this.#peakTriangles,
        programs: this.#peakPrograms,
        geometries: this.#peakGeometries,
        textures: this.#peakTextures,
      },
    }
  }

  #initializeGpu(renderer: RuntimePerformanceRenderer | null): void {
    if (this.#gpuInitialized) return
    if (!this.#enableGpuTiming) {
      this.#gpuInitialized = true
      this.#gpuCapability = unavailable('GPU timing was disabled by options.')
      return
    }
    if (renderer === null || typeof renderer.getContext !== 'function') {
      this.#gpuCapability = unavailable('A renderer with getContext() is required for GPU timing.')
      return
    }
    this.#gpuInitialized = true
    let rawContext: unknown
    try {
      rawContext = renderer.getContext()
    } catch (error) {
      this.#gpuCapability = unavailable(`Renderer context could not be read: ${errorMessage(error)}`)
      return
    }
    const context = timerQueryContext(rawContext)
    if (context === null) {
      this.#gpuCapability = unavailable('The renderer context is not WebGL2 timer-query capable.')
      return
    }
    let rawExtension: unknown
    try {
      rawExtension = context.getExtension('EXT_disjoint_timer_query_webgl2')
    } catch (error) {
      this.#gpuCapability = unavailable(`GPU timer-query extension lookup failed: ${errorMessage(error)}`)
      return
    }
    const extension = timerQueryExtension(rawExtension)
    if (extension === null) {
      this.#gpuCapability = unavailable('EXT_disjoint_timer_query_webgl2 is unavailable.')
      return
    }
    this.#gpuContext = context
    this.#gpuExtension = extension
    this.#gpuCapability = available()
  }

  #runTimedRender(render: () => void): void {
    const context = this.#gpuContext!
    const extension = this.#gpuExtension!
    let query: unknown = null
    try {
      query = context.createQuery()
      if (query === null || query === undefined) {
        this.#gpuCapability = unavailable('WebGL2 createQuery() returned no query object.')
        this.#gpuContext = null
        this.#gpuExtension = null
        render()
        return
      }
      context.beginQuery(extension.TIME_ELAPSED_EXT, query)
    } catch (error) {
      if (query !== null && query !== undefined) {
        try {
          context.deleteQuery(query)
        } catch {
          // The failed begin may already have invalidated the native handle.
        }
      }
      this.#gpuCapability = unavailable(`GPU timer query could not begin: ${errorMessage(error)}`)
      this.#gpuContext = null
      this.#gpuExtension = null
      render()
      return
    }
    this.#pendingGpuQuery = query
    this.#timedRenderCallbacks += 1
    try {
      render()
    } finally {
      try {
        context.endQuery(extension.TIME_ELAPSED_EXT)
      } catch (error) {
        this.#safeDeleteQuery(query)
        this.#pendingGpuQuery = null
        this.#gpuCapability = unavailable(`GPU timer query could not end: ${errorMessage(error)}`)
        this.#gpuContext = null
        this.#gpuExtension = null
      }
    }
  }

  #pollGpuQuery(): boolean {
    if (this.#pendingGpuQuery === null || this.#gpuContext === null || this.#gpuExtension === null) {
      return true
    }
    const context = this.#gpuContext
    const extension = this.#gpuExtension
    const query = this.#pendingGpuQuery
    let ready: boolean
    try {
      ready = Boolean(context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE))
    } catch (error) {
      this.#safeDeleteQuery(query)
      this.#pendingGpuQuery = null
      this.#gpuCapability = unavailable(`GPU timer query polling failed: ${errorMessage(error)}`)
      this.#gpuContext = null
      this.#gpuExtension = null
      return true
    }
    if (!ready) return false
    try {
      const disjoint = Boolean(context.getParameter(extension.GPU_DISJOINT_EXT))
      if (disjoint) {
        this.#rejectedDisjointSamples += 1
      } else {
        const nanoseconds = context.getQueryParameter(query, context.QUERY_RESULT)
        if (typeof nanoseconds !== 'number' || !Number.isFinite(nanoseconds) || nanoseconds < 0) {
          throw new Error(`GPU timer query returned invalid nanoseconds: ${String(nanoseconds)}.`)
        }
        this.#gpuSamples.push(nanoseconds / 1_000_000)
      }
    } finally {
      this.#safeDeleteQuery(query)
      this.#pendingGpuQuery = null
    }
    return true
  }

  async #finishGpuQuery(): Promise<void> {
    if (this.#pendingGpuQuery === null) return
    try {
      this.#gpuContext?.flush?.()
    } catch {
      // A flush is merely a completion hint; polling still provides evidence.
    }
    const deadline = this.#environment.now() + this.#gpuFinishTimeoutMs
    const maxPolls = Math.ceil(this.#gpuFinishTimeoutMs / this.#gpuPollIntervalMs) + 1
    let polls = 0
    while (!this.#pollGpuQuery()
      && this.#environment.now() < deadline
      && polls < maxPolls) {
      polls += 1
      if (this.#environment.delay) {
        await this.#environment.delay(this.#gpuPollIntervalMs)
      } else {
        await defaultDelay(this.#gpuPollIntervalMs)
      }
    }
    if (this.#pendingGpuQuery !== null) {
      this.#pendingSamplesDiscarded += 1
      this.#discardPendingGpuQuery()
    }
  }

  #gpuUnavailableReason(): string {
    if (!this.#gpuCapability.available) {
      return this.#gpuCapability.unavailableReason ?? 'GPU timing is unavailable.'
    }
    if (this.#rejectedDisjointSamples > 0 && this.#timedRenderCallbacks === this.#rejectedDisjointSamples) {
      return 'All completed GPU timer queries were rejected because the GPU clock was disjoint.'
    }
    if (this.#pendingSamplesDiscarded > 0) {
      return 'GPU timer queries did not complete within the configured finish timeout.'
    }
    return 'No completed GPU timer-query samples are available.'
  }

  #safeDeleteQuery(query: unknown): void {
    try {
      this.#gpuContext?.deleteQuery(query)
    } catch {
      // Disposal cannot recover a rejected or already-invalid native handle.
    }
  }

  #discardPendingGpuQuery(): void {
    if (this.#pendingGpuQuery === null) return
    this.#safeDeleteQuery(this.#pendingGpuQuery)
    this.#pendingGpuQuery = null
  }

  #disconnectLongTasks(): void {
    if (this.#longTaskSubscription === null) return
    try {
      this.#longTaskSubscription.disconnect()
    } finally {
      this.#longTaskSubscription = null
    }
  }

  #throwAsyncValidationError(): void {
    if (this.#asyncValidationError !== null) throw this.#asyncValidationError
  }

  #expectState(expected: MonitorState, method: string): void {
    if (this.#state !== expected) {
      throw new Error(
        `Runtime performance monitor ${method}() requires state ${expected}; current state is ${this.#state}.`,
      )
    }
  }
}

export function createRuntimePerformanceMonitor(
  options: RuntimePerformanceMonitorOptions = {},
): RuntimePerformanceMonitor {
  return new BrowserRuntimePerformanceMonitor(options)
}

function createDefaultEnvironment(): RuntimePerformanceEnvironment {
  const root = globalThis as unknown as Record<string, unknown>
  const performanceValue = asRecord(root.performance)
  const performanceNow = performanceValue?.now
  const getEntriesByType = performanceValue?.getEntriesByType
  const environment: RuntimePerformanceEnvironment = {
    now: typeof performanceNow === 'function'
      ? () => Number(performanceNow.call(root.performance))
      : () => Date.now(),
    clockSource: typeof performanceNow === 'function' ? 'performance' : 'date',
    delay: defaultDelay,
  }
  if (typeof getEntriesByType === 'function') {
    environment.getResourceEntries = () => {
      const entries = getEntriesByType.call(root.performance, 'resource')
      return Array.isArray(entries) ? entries as RuntimeResourceTimingEntry[] : []
    }
  }
  const Observer = root.PerformanceObserver
  if (typeof Observer === 'function') {
    environment.observeLongTasks = (onEntries) => {
      const observer = new (Observer as new (
        callback: (list: { getEntries(): readonly RuntimeLongTaskEntry[] }) => void,
      ) => {
        observe(options: { type: string; buffered: boolean }): void
        disconnect(): void
      })((list) => onEntries(list.getEntries()))
      observer.observe({ type: 'longtask', buffered: true })
      return observer
    }
  }
  return environment
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}

function timerQueryContext(value: unknown): TimerQueryContext | null {
  const record = asRecord(value)
  if (record === null
    || typeof record.getExtension !== 'function'
    || typeof record.createQuery !== 'function'
    || typeof record.beginQuery !== 'function'
    || typeof record.endQuery !== 'function'
    || typeof record.getQueryParameter !== 'function'
    || typeof record.getParameter !== 'function'
    || typeof record.deleteQuery !== 'function'
    || typeof record.QUERY_RESULT_AVAILABLE !== 'number'
    || typeof record.QUERY_RESULT !== 'number') {
    return null
  }
  return value as TimerQueryContext
}

function timerQueryExtension(value: unknown): TimerQueryExtension | null {
  const record = asRecord(value)
  if (record === null
    || typeof record.TIME_ELAPSED_EXT !== 'number'
    || typeof record.GPU_DISJOINT_EXT !== 'number') {
    return null
  }
  return value as TimerQueryExtension
}

function programCount(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const record = asRecord(value)
  const length = record?.length
  return optionalCounter(length, 'renderer.info.programs.length')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as Record<string, unknown>
    : null
}

function optionalCounter(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer when provided.`)
  }
  return value
}

function maxNullable(previous: number | null, value: number | null): number | null {
  if (value === null) return previous
  return previous === null ? value : Math.max(previous, value)
}

function percentile(sorted: Float64Array, quantile: number): number {
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1)
  return sorted[index]!
}

function integerOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive safe integer.`)
  }
  return resolved
}

function positiveOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a finite positive number.`)
  }
  return resolved
}

function nonNegativeOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error(`${name} must be a finite non-negative number.`)
  }
  return resolved
}

function assertTimestamp(value: number, label: string): void {
  assertNonNegativeFinite(value, label)
}

function assertNonNegativeFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`)
  }
}

function available(): RuntimeCapability {
  return { available: true }
}

function unavailable(unavailableReason: string): RuntimeCapability {
  return { available: false, unavailableReason }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
