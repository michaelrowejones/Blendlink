import type {
  JsonObject,
  PortableComponentRecord,
} from './components.js'

/** Runtime quality is implementation policy, never authored art direction. */
export type RuntimeQuality = 'low' | 'balanced' | 'high'

export interface RuntimeDisposable {
  dispose(): void
}

export interface RuntimeComponentInstallation extends RuntimeDisposable {
  /** Complete live integration after detached preparation. Activation must be
   * synchronous; the runtime calls it at most once. */
  activate?(): void
  update?(deltaSeconds: number): void
  fixedUpdate?(fixedDeltaSeconds: number): void
  resize?(width: number, height: number, pixelRatio: number): void
  beforeRender?(): void
  afterRender?(): void
  setQuality?(quality: RuntimeQuality): void
  /** Optional truthful activity signal for demand-mode render loops. Without
   * it, an update hook remains conservatively continuous. */
  isActive?(): boolean
}

/** A renderer-neutral effect request. The renderer adapter owns passes,
 * buffers, ordering, and disposal; records contain only artist intent. */
export interface PostEffectDescriptor {
  id: string
  type: string
  phase: 'post-depth' | 'post-hdr' | 'post-ldr'
  values: JsonObject
  /** Renderer-owned objects needed to realize portable intent (for example a
   * resolved focus target). These never enter the manifest or generated
   * contract and keep component records plain JSON. */
  resources?: Readonly<Record<string, unknown>>
}

export interface PostPipelineService {
  addEffect(
    effect: Readonly<PostEffectDescriptor>,
  ): RuntimeComponentInstallation | Promise<RuntimeComponentInstallation>
}

export interface RuntimeInteractionTarget<TTarget = unknown> {
  id: string
  target: TTarget
  activate?(): void
  hover?(hovering: boolean): void
}

export interface InteractionService<TTarget = unknown> {
  addTarget(target: Readonly<RuntimeInteractionTarget<TTarget>>): RuntimeDisposable
}

export interface RuntimeAccessibleControl<TTarget = unknown> {
  id: string
  target: TTarget
  role: 'button' | 'link'
  label: string
  href?: string
  linkTarget?: '_self' | '_blank'
  activate(): void
}

export interface AccessibilityService<TTarget = unknown> {
  addControl(control: Readonly<RuntimeAccessibleControl<TTarget>>): RuntimeDisposable
}

export interface QualityService {
  readonly quality: RuntimeQuality
  subscribe(listener: (quality: RuntimeQuality) => void): RuntimeDisposable
}

export interface RuntimeDiagnostic {
  severity: 'info' | 'warning' | 'error'
  componentId: string
  message: string
}

export interface RuntimeDiagnosticsService {
  report(diagnostic: Readonly<RuntimeDiagnostic>): void
}

/** Optional capabilities are explicit. An adapter that requires a missing
 * service must fail with component identity instead of silently degrading. */
export interface RuntimeComponentServices<TTarget = unknown> {
  postPipeline?: PostPipelineService
  interaction?: InteractionService<TTarget>
  accessibility?: AccessibilityService<TTarget>
  quality?: QualityService
  diagnostics?: RuntimeDiagnosticsService
}

export interface RuntimeComponentAdapterContext<
  TTarget = unknown,
  TServices extends RuntimeComponentServices<TTarget> = RuntimeComponentServices<TTarget>,
> {
  component: Readonly<PortableComponentRecord>
  target: TTarget
  services: TServices
}

export type RuntimeComponentAdapter<TContext> = (
  context: TContext,
) => RuntimeComponentInstallation | Promise<RuntimeComponentInstallation>

/** A lazy operation lets an engine resolve targets immediately before the
 * component installs, while preserving one shared transaction. */
export interface RuntimeComponentInstallOperation {
  component: Readonly<PortableComponentRecord>
  install(): RuntimeComponentInstallation | Promise<RuntimeComponentInstallation>
}

export interface InstalledRuntimeComponents extends RuntimeComponentInstallation {
  readonly count: number
  readonly disposed: boolean
  /** Conservative scheduling fact: at least one adapter declared per-frame
   * update work whose idle state is not otherwise observable. */
  readonly requiresContinuousFrames: boolean
  /** Idempotently activate every installation in component order. */
  activate(): void
}

export interface InstallRuntimeComponentsOptions {
  /** Leave optional live integration inactive until activate() is called.
   * Defaults to false for backward-compatible immediate behavior. */
  deferActivation?: boolean
}

export class RuntimeComponentInstallError extends Error {
  readonly component: Readonly<PortableComponentRecord>
  readonly cause: unknown
  readonly rollbackErrors: readonly unknown[]

  constructor(
    component: Readonly<PortableComponentRecord>,
    cause: unknown,
    rollbackErrors: readonly unknown[],
  ) {
    const target = component.target.kind === 'scene'
      ? 'Scene'
      : `object ${component.target.objectName ?? component.target.objectId}`
    const rollback = rollbackErrors.length > 0
      ? ` Rollback also failed: ${rollbackErrors.map(errorMessage).join('; ')}.`
      : ''
    const detail = errorMessage(cause)
    const separator = /[.!?]$/.test(detail) ? '' : '.'
    super(
      `Could not install component ${component.type} (${component.id}) on ${target}: ` +
        `${detail}${separator}${rollback}`,
      { cause },
    )
    this.name = 'RuntimeComponentInstallError'
    this.component = component
    this.cause = cause
    this.rollbackErrors = rollbackErrors
  }
}

export class RuntimeComponentActivationError extends Error {
  readonly component: Readonly<PortableComponentRecord>
  readonly cause: unknown
  readonly rollbackErrors: readonly unknown[]

  constructor(
    component: Readonly<PortableComponentRecord>,
    cause: unknown,
    rollbackErrors: readonly unknown[],
  ) {
    const rollback = rollbackErrors.length > 0
      ? ` Rollback also failed: ${rollbackErrors.map(errorMessage).join('; ')}.`
      : ''
    const detail = errorMessage(cause)
    const separator = /[.!?]$/.test(detail) ? '' : '.'
    super(
      `Could not activate component ${component.type} (${component.id}): ` +
        `${detail}${separator}${rollback}`,
      { cause },
    )
    this.name = 'RuntimeComponentActivationError'
    this.component = component
    this.cause = cause
    this.rollbackErrors = rollbackErrors
  }
}

export class RuntimeComponentDisposalError extends Error {
  readonly errors: readonly unknown[]

  constructor(errors: readonly unknown[]) {
    const detail = errors.map(errorMessage).join('; ')
    super(`Could not fully dispose runtime components: ${detail}${/[.!?]$/.test(detail) ? '' : '.'}`)
    this.name = 'RuntimeComponentDisposalError'
    this.errors = errors
  }
}

/** Install a component set atomically. Every successful installation is
 * rolled back in reverse order if a later adapter fails. */
export async function installRuntimeComponents(
  operations: readonly RuntimeComponentInstallOperation[],
  options: InstallRuntimeComponentsOptions = {},
): Promise<InstalledRuntimeComponents> {
  const installations: Array<{
    component: Readonly<PortableComponentRecord>
    installation: RuntimeComponentInstallation
  }> = []
  for (const operation of operations) {
    try {
      const installation = await operation.install()
      if (!installation || typeof installation.dispose !== 'function') {
        throw new Error('adapter returned no disposable installation')
      }
      installations.push({ component: operation.component, installation })
    } catch (cause) {
      const rollbackErrors = disposeReverse(
        installations.map((entry) => entry.installation),
      )
      throw new RuntimeComponentInstallError(operation.component, cause, rollbackErrors)
    }
  }

  let disposed = false
  let activated = false
  const active = (): void => {
    if (disposed) throw new Error('These runtime components have been disposed.')
  }
  const installed: InstalledRuntimeComponents = {
    count: installations.length,
    get requiresContinuousFrames() {
      return installations.some(({ installation }) =>
        installation.isActive?.() ?? Boolean(installation.update || installation.fixedUpdate))
    },
    get disposed() { return disposed },
    activate() {
      active()
      if (activated) return
      for (const entry of installations) {
        try {
          if (entry.installation.activate) {
            invokeSynchronously(
              `Runtime component ${entry.component.type} (${entry.component.id}) activate()`,
              entry.installation.activate,
            )
          }
        } catch (cause) {
          disposed = true
          const rollbackErrors = disposeReverse(
            installations.map((candidate) => candidate.installation),
          )
          throw new RuntimeComponentActivationError(
            entry.component,
            cause,
            rollbackErrors,
          )
        }
      }
      activated = true
    },
    update(deltaSeconds) {
      active()
      for (const { installation } of installations) installation.update?.(deltaSeconds)
    },
    fixedUpdate(fixedDeltaSeconds) {
      active()
      for (const { installation } of installations) installation.fixedUpdate?.(fixedDeltaSeconds)
    },
    resize(width, height, pixelRatio) {
      active()
      for (const { installation } of installations) installation.resize?.(width, height, pixelRatio)
    },
    beforeRender() {
      active()
      for (const { installation } of installations) installation.beforeRender?.()
    },
    afterRender() {
      active()
      for (const { installation } of installations.slice().reverse()) installation.afterRender?.()
    },
    setQuality(quality) {
      active()
      for (const { installation } of installations) installation.setQuality?.(quality)
    },
    dispose() {
      if (disposed) return
      disposed = true
      const errors = disposeReverse(
        installations.map((entry) => entry.installation),
      )
      if (errors.length > 0) throw new RuntimeComponentDisposalError(errors)
    },
  }
  if (!options.deferActivation) installed.activate()
  return installed
}

function disposeReverse(installations: readonly RuntimeComponentInstallation[]): unknown[] {
  const errors: unknown[] = []
  for (const installation of installations.slice().reverse()) {
    try {
      invokeSynchronously('Runtime component dispose()', installation.dispose)
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

function invokeSynchronously(label: string, operation: () => void): void {
  const result = (operation as () => unknown)()
  if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') return
  // Observe a later rejection even though returning a thenable is itself the
  // synchronous lifecycle contract violation.
  void Promise.resolve(result).catch(() => {})
  throw new Error(`${label} returned a Promise; atomic activation and cleanup must be synchronous.`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
