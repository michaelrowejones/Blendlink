import type { RuntimeDisposable } from './componentRuntime.js'

export type ThreeAudioReadiness =
  | Readonly<{ state: 'unavailable' }>
  | Readonly<{ state: 'blocked' }>
  | Readonly<{ state: 'ready' }>
  | Readonly<{ state: 'failed'; error: Error }>

export interface ThreeAudioControl {
  readonly readiness: ThreeAudioReadiness
  /** Subscribe to readiness changes without imposing a React/store choice. */
  subscribe(listener: () => void): RuntimeDisposable
  /** Call directly from an application-owned trusted gesture. The underlying
   * AudioContext.resume() call is made synchronously before this method awaits. */
  resume(): Promise<boolean>
}

export interface ThreeAudioCoordinator extends ThreeAudioControl, RuntimeDisposable {
  attach(context: AudioContext): RuntimeDisposable
  /** Invoked synchronously by Canvas or DOM activation. */
  activate(action: () => void): void
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/** Observe and unlock one installed scene's Web Audio context without closing
 * an application/global Three context on disposal. */
export function createThreeAudioCoordinator(): ThreeAudioCoordinator {
  const listeners = new Set<() => void>()
  let context: AudioContext | null = null
  let owners = 0
  let disposed = false
  let failure: Error | null = null

  const current = (): ThreeAudioReadiness => {
    if (failure) return Object.freeze({ state: 'failed', error: failure })
    if (!context) return Object.freeze({ state: 'unavailable' })
    if (context.state === 'running') return Object.freeze({ state: 'ready' })
    if (context.state === 'closed') {
      return Object.freeze({
        state: 'failed',
        error: new Error('The Web Audio context is closed and cannot be resumed.'),
      })
    }
    return Object.freeze({ state: 'blocked' })
  }
  let snapshot = current()
  const publish = (): void => {
    const next = current()
    if (next.state === snapshot.state
        && (next.state !== 'failed' || snapshot.state !== 'failed' || next.error === snapshot.error)) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  const stateChange = (): void => publish()
  const setFailure = (reason: unknown): void => {
    failure = asError(reason)
    publish()
  }
  const assertLive = (): void => {
    if (disposed) throw new Error('This Blendlink audio coordinator has been disposed.')
  }
  const resumeNow = (): Promise<void> | null => {
    if (!context || context.state === 'running') return null
    if (context.state === 'closed') {
      setFailure(new Error('The Web Audio context is closed and cannot be resumed.'))
      return null
    }
    // Deliberately call before returning/awaiting so browser user activation is
    // still current when resume() performs its gated operation.
    try { return context.resume() } catch (error) { setFailure(error); return null }
  }

  return {
    get readiness() { return snapshot },
    subscribe(listener) {
      assertLive()
      listeners.add(listener)
      let active = true
      return { dispose() {
        if (!active) return
        active = false
        listeners.delete(listener)
      } }
    },
    attach(nextContext) {
      assertLive()
      if (context && context !== nextContext) {
        throw new Error('One Blendlink scene cannot own multiple Web Audio contexts.')
      }
      if (!context) {
        context = nextContext
        failure = null
        context.addEventListener('statechange', stateChange)
        snapshot = current()
        for (const listener of [...listeners]) listener()
      }
      owners += 1
      let active = true
      return { dispose() {
        if (!active) return
        active = false
        owners -= 1
        if (owners > 0) return
        context?.removeEventListener('statechange', stateChange)
        context = null
        failure = null
        publish()
      } }
    },
    async resume() {
      assertLive()
      if (!context) return false
      const pending = resumeNow()
      if (pending) {
        try { await pending } catch (error) { setFailure(error); return false }
      }
      failure = null
      publish()
      return context.state === 'running'
    },
    activate(action) {
      assertLive()
      if (!context || context.state === 'running') {
        try { action() } catch (error) { setFailure(error) }
        return
      }
      const pending = resumeNow()
      if (!pending) return
      void pending.then(() => {
        failure = null
        publish()
        if (context?.state !== 'running') return
        try { action() } catch (error) { setFailure(error) }
      }, setFailure)
    },
    dispose() {
      if (disposed) return
      disposed = true
      context?.removeEventListener('statechange', stateChange)
      context = null
      owners = 0
      listeners.clear()
    },
  }
}
