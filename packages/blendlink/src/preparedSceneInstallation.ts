export type PreparedSceneInstallationState =
  | 'prepared'
  | 'committing'
  | 'committed'
  | 'stale'
  | 'failed'
  | 'disposed'

export interface ReversibleSceneMutation {
  /** Artist-readable identity included in failure diagnostics. */
  readonly label: string
  /** Synchronous live-state mutation. */
  apply(): void
  /** Synchronous, idempotent inverse that is safe even when apply() throws. */
  rollback(): void
}

export interface PreparedSceneResource {
  /** Artist-readable identity included in failure diagnostics. */
  readonly label: string
  /** Synchronous, idempotent release of preparation-owned resources. */
  dispose(): void
}

export interface ScenePreparationContext {
  readonly signal: AbortSignal
  own(resource: PreparedSceneResource): void
  stage(mutation: ReversibleSceneMutation): void
  throwIfCancelled(): void
}

export interface PreparedSceneInstallation<T> {
  readonly generation: number
  readonly state: PreparedSceneInstallationState
  readonly value: T
  /** Apply every staged mutation synchronously. A successful commit may run
   * exactly once; dispose() later applies the inverse journal. */
  commit(): T
  /** Release committed mutations and preparation-owned resources. Repeated
   * disposal is a no-op, including after a prior disposal error. */
  dispose(): void
}

export interface PrepareSceneInstallationOptions {
  signal?: AbortSignal
}

export interface SceneInstallationCoordinator {
  /** Start the newest candidate and invalidate any older uncommitted one.
   * AbortSignal cancellation is cooperative for factory-owned async work;
   * regardless of cooperation, a late result can never become committable. */
  prepare<T>(
    factory: (context: ScenePreparationContext) => T | Promise<T>,
    options?: PrepareSceneInstallationOptions,
  ): Promise<PreparedSceneInstallation<T>>
  /** Cancel the current preparing or prepared generation. A committed
   * PreparedSceneInstallation has transferred ownership to its caller and
   * must still be disposed explicitly by that caller. */
  dispose(): void
}

export type SceneInstallationTransactionErrorCode =
  | 'preparation-cancelled'
  | 'preparation-failed'
  | 'illegal-transition'
  | 'commit-failed'
  | 'cleanup-failed'

/** One structured failure shape keeps cancellation, transition, commit, and
 * cleanup diagnostics machine-readable without exposing journal internals. */
export class SceneInstallationTransactionError extends Error {
  readonly code: SceneInstallationTransactionErrorCode
  readonly generation: number
  readonly state: PreparedSceneInstallationState | 'coordinator-disposed'
  readonly cause: unknown
  readonly cleanupErrors: readonly unknown[]

  constructor(options: {
    code: SceneInstallationTransactionErrorCode
    generation: number
    state: PreparedSceneInstallationState | 'coordinator-disposed'
    message: string
    cause?: unknown
    cleanupErrors?: readonly unknown[]
  }) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'SceneInstallationTransactionError'
    this.code = options.code
    this.generation = options.generation
    this.state = options.state
    this.cause = options.cause
    this.cleanupErrors = options.cleanupErrors ?? []
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function invokeSynchronously(label: string, operation: () => void): void {
  const result = (operation as () => unknown)()
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    // The transaction fails synchronously and owns no asynchronous completion
    // channel. Observe a later rejection so an invalid callback cannot create
    // an unrelated unhandled-rejection report after the loud commit failure.
    void Promise.resolve(result).catch(() => {})
    throw new Error(
      `${label} returned a Promise. Scene installation commit and cleanup callbacks must be synchronous.`,
    )
  }
}

function cleanupReverse<T>(
  entries: readonly T[],
  cleanup: (entry: T) => void,
): unknown[] {
  const errors: unknown[] = []
  for (const entry of entries.slice().reverse()) {
    try {
      cleanup(entry)
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

interface OwnedSceneResource {
  resource: PreparedSceneResource
  disposed: boolean
}

interface ScenePreparationGeneration {
  generation: number
  state: PreparedSceneInstallationState | 'preparing'
  controller: AbortController
  resources: OwnedSceneResource[]
  mutations: ReversibleSceneMutation[]
  contextOpen: boolean
  cancellationCause?: unknown
  cleanupErrors: unknown[]
  cleanupErrorsReported: number
  detachExternalSignal(): void
}

function cleanupOwnedResource(
  control: ScenePreparationGeneration,
  entry: OwnedSceneResource,
): unknown[] {
  if (entry.disposed) return []
  entry.disposed = true
  try {
    invokeSynchronously(
      `${entry.resource.label} disposal`,
      () => entry.resource.dispose(),
    )
    return []
  } catch (error) {
    control.cleanupErrors.push(error)
    return [error]
  }
}

function cleanupOwnedResources(control: ScenePreparationGeneration): unknown[] {
  const errors: unknown[] = []
  for (const entry of control.resources.slice().reverse()) {
    errors.push(...cleanupOwnedResource(control, entry))
  }
  return errors
}

function invalidateGeneration(
  control: ScenePreparationGeneration,
  cause: unknown,
): unknown[] {
  if (control.state !== 'preparing' && control.state !== 'prepared') return []
  control.state = 'stale'
  control.contextOpen = false
  control.cancellationCause = cause
  control.detachExternalSignal()
  if (!control.controller.signal.aborted) control.controller.abort(cause)
  return cleanupOwnedResources(control)
}

function generationIsCancelled(control: ScenePreparationGeneration): boolean {
  return control.state === 'stale' || control.controller.signal.aborted
}

function publicGenerationState(
  control: ScenePreparationGeneration,
): PreparedSceneInstallationState {
  return control.state === 'preparing' ? 'prepared' : control.state
}

function takeUnreportedCleanupErrors(
  control: ScenePreparationGeneration,
): readonly unknown[] {
  if (control.cleanupErrorsReported >= control.cleanupErrors.length) return []
  const errors = control.cleanupErrors.slice(control.cleanupErrorsReported)
  control.cleanupErrorsReported = control.cleanupErrors.length
  return errors
}

function storedCleanupFailure(
  control: ScenePreparationGeneration,
  action: string,
): SceneInstallationTransactionError | null {
  const cleanupErrors = takeUnreportedCleanupErrors(control)
  if (cleanupErrors.length === 0) return null
  return new SceneInstallationTransactionError({
    code: 'cleanup-failed',
    generation: control.generation,
    state: publicGenerationState(control),
    message:
      `Could not fully ${action} scene installation generation ${control.generation}: ` +
      `${cleanupErrors.map(errorMessage).join('; ')}.`,
    cleanupErrors,
  })
}

function transitionError(
  control: ScenePreparationGeneration,
  operation:
    | 'commit'
    | 'dispose'
    | 'register preparation work'
    | 'prepare a replacement for',
): SceneInstallationTransactionError {
  return new SceneInstallationTransactionError({
    code: 'illegal-transition',
    generation: control.generation,
    state: publicGenerationState(control),
    message:
      `Cannot ${operation} generation ${control.generation} from ${control.state}.`,
  })
}

/** Renderer-neutral foundation for preparing one scene generation away from
 * live presentation, then applying its reversible mutations synchronously. */
export function createSceneInstallationCoordinator(): SceneInstallationCoordinator {
  let nextGeneration = 0
  let disposed = false
  let current: ScenePreparationGeneration | null = null

  const disposeCoordinator = (): void => {
    if (disposed) return
    disposed = true
    const active = current
    current = null
    if (!active) return
    invalidateGeneration(
      active,
      new Error('the scene installation coordinator was disposed'),
    )
    const cleanupFailure = storedCleanupFailure(active, 'cancel')
    if (cleanupFailure) throw cleanupFailure
  }

  return {
    async prepare<T>(
      factory: (context: ScenePreparationContext) => T | Promise<T>,
      options: PrepareSceneInstallationOptions = {},
    ): Promise<PreparedSceneInstallation<T>> {
      if (disposed) {
        throw new SceneInstallationTransactionError({
          code: 'illegal-transition',
          generation: nextGeneration,
          state: 'coordinator-disposed',
          message: 'Cannot prepare a scene installation after its coordinator was disposed.',
        })
      }
      if (current?.state === 'committing') {
        throw transitionError(current, 'prepare a replacement for')
      }
      if (current) {
        const stale = current
        current = null
        invalidateGeneration(
          stale,
          new Error(`superseded by scene installation generation ${nextGeneration + 1}`),
        )
        const cleanupFailure = storedCleanupFailure(stale, 'cancel')
        if (cleanupFailure) throw cleanupFailure
      }

      const generation = ++nextGeneration
      const controller = new AbortController()
      const externalSignal = options.signal
      let externalAbort: (() => void) | undefined
      const control: ScenePreparationGeneration = {
        generation,
        state: 'preparing',
        controller,
        resources: [],
        mutations: [],
        contextOpen: true,
        cleanupErrors: [],
        cleanupErrorsReported: 0,
        detachExternalSignal() {
          if (externalSignal && externalAbort) {
            externalSignal.removeEventListener('abort', externalAbort)
            externalAbort = undefined
          }
        },
      }
      current = control
      externalAbort = externalSignal
        ? () => {
            invalidateGeneration(
              control,
              externalSignal.reason ?? new Error('the caller aborted scene preparation'),
            )
          }
        : undefined
      if (externalSignal?.aborted) externalAbort?.()
      else if (externalSignal && externalAbort) {
        externalSignal.addEventListener('abort', externalAbort, { once: true })
      }

      const cancelledError = (
        cause: unknown,
        cleanupErrors: readonly unknown[] = [],
      ): SceneInstallationTransactionError =>
        new SceneInstallationTransactionError({
          code: 'preparation-cancelled',
          generation,
          state: 'stale',
          message:
            `Scene installation generation ${generation} was cancelled before commit: ` +
            `${errorMessage(control.cancellationCause ?? cause)}.`,
          cause: control.cancellationCause ?? cause,
          cleanupErrors,
        })

      const rejectClosedRegistration = (entry?: OwnedSceneResource): never => {
        const priorState = control.state
        const illegal = transitionError(control, 'register preparation work')
        if (priorState === 'prepared') {
          // A factory that continues registering work after its promise
          // resolves did not produce a stable candidate. Invalidate the
          // entire candidate instead of leaving disposed resources committable.
          invalidateGeneration(control, illegal)
        } else if (entry) {
          // A committed installation already transferred its earlier
          // resources to the caller. Release only this late resource.
          cleanupOwnedResource(control, entry)
        }
        const cleanupFailure = storedCleanupFailure(
          control,
          priorState === 'prepared' || priorState === 'stale'
            ? 'cancel'
            : 'release late work for',
        )
        if (cleanupFailure) throw cleanupFailure
        if (priorState === 'stale') {
          throw cancelledError(control.cancellationCause)
        }
        throw illegal
      }

      const context: ScenePreparationContext = {
        signal: controller.signal,
        own(resource) {
          const entry = { resource, disposed: false }
          control.resources.push(entry)
          if (control.state !== 'preparing' || !control.contextOpen) {
            rejectClosedRegistration(entry)
          }
        },
        stage(mutation) {
          if (control.state !== 'preparing' || !control.contextOpen) {
            rejectClosedRegistration()
          }
          control.mutations.push(mutation)
        },
        throwIfCancelled() {
          if (generationIsCancelled(control)) {
            throw cancelledError(controller.signal.reason)
          }
          if (control.state !== 'preparing' || !control.contextOpen) {
            throw transitionError(control, 'register preparation work')
          }
        },
      }
      let value: T
      try {
        if (generationIsCancelled(control)) throw cancelledError(control.cancellationCause)
        value = await factory(context)
        control.contextOpen = false
        if (generationIsCancelled(control) || current !== control) {
          throw cancelledError(controller.signal.reason)
        }
        control.state = 'prepared'
      } catch (cause) {
        control.contextOpen = false
        if (generationIsCancelled(control)) {
          if (current === control) current = null
          cleanupOwnedResources(control)
          throw cancelledError(cause, takeUnreportedCleanupErrors(control))
        }
        control.detachExternalSignal()
        control.state = 'failed'
        if (current === control) current = null
        cleanupOwnedResources(control)
        const cleanupErrors = takeUnreportedCleanupErrors(control)
        throw new SceneInstallationTransactionError({
          code: 'preparation-failed',
          generation,
          state: control.state,
          message:
            `Could not prepare scene installation generation ${generation}: ${errorMessage(cause)}.` +
            (cleanupErrors.length > 0
              ? ` Cleanup also failed: ${cleanupErrors.map(errorMessage).join('; ')}.`
              : ''),
          cause,
          cleanupErrors,
        })
      }

      const prepared: PreparedSceneInstallation<T> = {
        generation,
        get state() {
          return control.state === 'preparing' ? 'prepared' : control.state
        },
        value,
        commit() {
          if (control.state !== 'prepared' || current !== control || disposed) {
            const cleanupFailure = storedCleanupFailure(control, 'cancel')
            if (cleanupFailure) {
              if (current === control) current = null
              throw cleanupFailure
            }
            throw transitionError(control, 'commit')
          }
          control.detachExternalSignal()
          control.state = 'committing'
          const applied: ReversibleSceneMutation[] = []
          let failedMutation: ReversibleSceneMutation | undefined
          try {
            for (const mutation of control.mutations) {
              failedMutation = mutation
              // Journal the inverse before touching live state so even a
              // partially throwing apply() receives its rollback.
              applied.push(mutation)
              invokeSynchronously(mutation.label, () => mutation.apply())
            }
          } catch (cause) {
            control.state = 'failed'
            if (current === control) current = null
            const cleanupErrors = [
              ...cleanupReverse(applied, (mutation) => {
                invokeSynchronously(
                  `${mutation.label} rollback`,
                  () => mutation.rollback(),
                )
              }),
              ...cleanupOwnedResources(control),
            ]
            control.cleanupErrorsReported = control.cleanupErrors.length
            throw new SceneInstallationTransactionError({
              code: 'commit-failed',
              generation,
              state: control.state,
              message:
                `Could not commit scene installation generation ${generation}` +
                `${failedMutation ? ` at ${failedMutation.label}` : ''}: ${errorMessage(cause)}.` +
                (cleanupErrors.length > 0
                  ? ` Rollback also failed: ${cleanupErrors.map(errorMessage).join('; ')}.`
                  : ''),
              cause,
              cleanupErrors,
            })
          }
          control.state = 'committed'
          if (current === control) current = null
          return value
        },
        dispose() {
          if (control.state === 'stale') {
            if (current === control) current = null
            const cleanupFailure = storedCleanupFailure(control, 'cancel')
            if (cleanupFailure) throw cleanupFailure
            return
          }
          if (control.state === 'disposed' || control.state === 'failed') return
          if (control.state === 'committing') {
            throw transitionError(control, 'dispose')
          }
          control.detachExternalSignal()
          const priorState = control.state
          control.state = 'disposed'
          if (current === control) current = null
          const cleanupErrors = [
            ...(priorState === 'committed'
              ? cleanupReverse(control.mutations, (mutation) => {
                  invokeSynchronously(
                    `${mutation.label} rollback`,
                    () => mutation.rollback(),
                  )
                })
              : []),
            ...cleanupOwnedResources(control),
          ]
          control.cleanupErrorsReported = control.cleanupErrors.length
          if (cleanupErrors.length > 0) {
            throw new SceneInstallationTransactionError({
              code: 'cleanup-failed',
              generation,
              state: control.state,
              message:
                `Could not fully dispose scene installation generation ${generation}: ` +
                `${cleanupErrors.map(errorMessage).join('; ')}.`,
              cleanupErrors,
            })
          }
        },
      }
      return prepared
    },
    dispose: disposeCoordinator,
  }
}
