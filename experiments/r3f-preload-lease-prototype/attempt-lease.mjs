function abortError(message) {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/**
 * Prototype registry for renderer-bound, single-commit scene attempts.
 *
 * The cache key is intentionally an object supplied by the adapter. Production
 * would include generated-scene identity, renderer, application Scene,
 * delivery policy, base URL/loader policy, and retry generation. The owner is
 * a stable logical mount identity. Different owners may never share a mutable
 * prepared candidate.
 */
export function createExclusiveAttemptRegistry() {
  const entries = new Map()
  let nextAttempt = 0

  function acquire(key, owner, start) {
    let entry = entries.get(key)
    if (entry && entry.owner !== owner) {
      throw new Error(
        'A renderer-bound Blendlink preparation is exclusive to one logical owner. ' +
          'Use a distinct attempt key or wait for the current owner to release it.',
      )
    }
    if (!entry) {
      const attempt = ++nextAttempt
      entry = {
        key,
        owner,
        attempt,
        refs: 0,
        retirement: 0,
        retired: false,
        phase: 'loading',
        progress: null,
        listeners: new Set(),
        candidate: null,
        candidateDisposed: false,
        activated: false,
        activationHost: null,
        activationValue: null,
        task: null,
        promise: null,
      }
      const publish = (snapshot) => {
        if (entry.retired) return
        entry.phase = snapshot.phase
        entry.progress = Object.freeze({ attempt, ...snapshot })
        for (const listener of [...entry.listeners]) listener(entry.progress)
      }
      const task = start({ attempt, publish })
      entry.task = task
      entry.promise = Promise.resolve(task.promise).then(
        (candidate) => {
          entry.candidate = candidate
          entry.phase = 'prepared'
          publish({ phase: 'prepared' })
          if (entry.retired) disposeCandidate(entry)
        },
        (error) => {
          entry.phase = entry.retired ? 'abandoned' : 'failed'
          if (!entry.retired) {
            entry.progress = Object.freeze({ attempt, phase: 'failed', error })
            for (const listener of [...entry.listeners]) listener(entry.progress)
          }
          throw error
        },
      )
      // A released non-cooperative task may reject after every observer has
      // gone. Observe the entry Promise without changing what active leases see.
      entry.promise.catch(() => {})
      entries.set(key, entry)
    }

    entry.refs += 1
    entry.retirement += 1
    let released = false
    const ownedListeners = new Set()

    // Cancellation after this lease is released is terminal state, not an
    // unhandled render error. A still-active lease continues to receive real
    // preparation failures. activate() remains the generation/ownership gate.
    const ready = entry.promise.then(
      () => {},
      (error) => {
        if (released || entry.retired) return
        throw error
      },
    )

    return Object.freeze({
      attempt: entry.attempt,
      ready,
      get snapshot() {
        return entry.progress ?? Object.freeze({
          attempt: entry.attempt,
          phase: entry.phase,
        })
      },
      subscribe(listener) {
        if (released) throw abortError('Cannot subscribe to a released Blendlink preparation lease.')
        entry.listeners.add(listener)
        ownedListeners.add(listener)
        if (entry.progress) listener(entry.progress)
        return () => {
          ownedListeners.delete(listener)
          entry.listeners.delete(listener)
        }
      },
      activate(host) {
        if (released || entry.retired) {
          throw abortError(`Blendlink preparation attempt ${entry.attempt} is no longer active.`)
        }
        if (!entry.candidate) {
          throw new Error(
            `Blendlink preparation attempt ${entry.attempt} is not Ready. Await lease.ready first.`,
          )
        }
        if (entry.activated) {
          if (entry.activationHost === host) return entry.activationValue
          throw new Error(
            `Blendlink preparation attempt ${entry.attempt} is already active on a different host.`,
          )
        }
        entry.activated = true
        entry.activationHost = host
        entry.phase = 'active'
        entry.activationValue = entry.candidate.activate(host)
        return entry.activationValue
      },
      release() {
        if (released) return
        released = true
        for (const listener of ownedListeners) entry.listeners.delete(listener)
        ownedListeners.clear()
        entry.refs -= 1
        if (entry.refs > 0) return

        const retirement = ++entry.retirement
        // React root Strict Mode performs setup -> cleanup -> setup in one
        // effect flush. One microtask gives the same logical owner a chance to
        // re-acquire without hiding a longer TTL or retaining an abandoned
        // render indefinitely.
        queueMicrotask(() => {
          if (entry.refs > 0 || entry.retirement !== retirement || entry.retired) return
          entry.retired = true
          entry.phase = 'abandoned'
          if (entries.get(key) === entry) entries.delete(key)
          try {
            entry.task.cancel()
          } finally {
            disposeCandidate(entry)
          }
        })
      },
    })
  }

  function disposeCandidate(entry) {
    if (!entry.candidate || entry.candidateDisposed) return
    entry.candidateDisposed = true
    entry.candidate.dispose()
  }

  return Object.freeze({
    acquire,
    get activeEntries() {
      return entries.size
    },
  })
}
