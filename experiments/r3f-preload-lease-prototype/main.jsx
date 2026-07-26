import React, {
  StrictMode,
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'
import { createExclusiveAttemptRegistry } from './attempt-lease.mjs'

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function makeMetrics() {
  return {
    starts: 0,
    cancels: 0,
    resolves: 0,
    disposes: 0,
    activations: 0,
    progress: [],
  }
}

function delayedCandidateFactory(metrics, milliseconds = 100) {
  return ({ attempt, publish }) => {
    metrics.starts += 1
    publish({ phase: 'loading', itemsLoaded: 0, itemsTotal: 1 })
    const promise = new Promise((resolve) => {
      setTimeout(() => {
        metrics.resolves += 1
        publish({ phase: 'preparing', itemsLoaded: 1, itemsTotal: 1 })
        resolve({
          activate() {
            metrics.activations += 1
            return { attempt }
          },
          dispose() {
            metrics.disposes += 1
          },
        })
      }, milliseconds)
    })
    return {
      promise,
      // Deliberately non-cooperative: this models decode/compile work that
      // cannot stop immediately. The registry still rejects stale activation
      // and disposes the late candidate.
      cancel() {
        metrics.cancels += 1
      },
    }
  }
}

async function runUnsafeRenderAcquisition(root) {
  const metrics = makeMetrics()
  const registry = createExclusiveAttemptRegistry()
  const key = {}
  const owner = Symbol('unsafe-render')
  let renderLease = null

  function UnsafeReader() {
    // This is the rejected design. The only owner is created during render.
    // The Effect below can never register while use() suspends.
    renderLease ??= registry.acquire(key, owner, delayedCandidateFactory(metrics, 100))
    use(renderLease.ready)
    useEffect(() => () => renderLease.release(), [])
    return <span>unsafe-ready</span>
  }

  root.render(
    <Suspense fallback={<span id="unsafe-fallback">unsafe-fallback</span>}>
      <UnsafeReader />
    </Suspense>,
  )
  await sleep(20)
  root.render(<span id="unsafe-abandoned">unsafe-abandoned</span>)
  await sleep(140)

  return {
    ...metrics,
    activeEntries: registry.activeEntries,
    releaseObserved: metrics.cancels > 0 || metrics.disposes > 0,
  }
}

async function runCommittedStrictLease(root) {
  const metrics = makeMetrics()
  const registry = createExclusiveAttemptRegistry()
  const key = {}
  const owner = Symbol('committed-strict-owner')
  const host = { kind: 'prototype-host' }
  const lifecycle = { effectSetups: 0, effectCleanups: 0, layoutActivations: 0 }

  function Reveal({ lease }) {
    use(lease.ready)
    useLayoutEffect(() => {
      lease.activate(host)
      lifecycle.layoutActivations += 1
    }, [lease])
    return <span id="strict-ready">strict-ready</span>
  }

  function CommittedOwner() {
    const [lease, setLease] = useState(null)
    useEffect(() => {
      lifecycle.effectSetups += 1
      const acquired = registry.acquire(
        key,
        owner,
        delayedCandidateFactory(metrics, 100),
      )
      const unsubscribe = acquired.subscribe((snapshot) => {
        metrics.progress.push(snapshot.phase)
      })
      setLease(acquired)
      return () => {
        lifecycle.effectCleanups += 1
        unsubscribe()
        acquired.release()
      }
    }, [])
    return (
      <Suspense fallback={<span id="strict-fallback">strict-fallback</span>}>
        {lease ? <Reveal lease={lease} /> : <span id="strict-starting">strict-starting</span>}
      </Suspense>
    )
  }

  root.render(
    <StrictMode>
      <CommittedOwner />
    </StrictMode>,
  )
  // React may batch Suspense reveals for up to 300 ms. Wait past that policy
  // window so this assertion tests ownership, not reveal throttling.
  await sleep(430)
  const displayedReady = document.querySelector('#strict-ready') !== null
  root.render(<span id="strict-unmounted">strict-unmounted</span>)
  await sleep(20)

  return {
    ...metrics,
    ...lifecycle,
    displayedReady,
    activeEntries: registry.activeEntries,
  }
}

async function runPendingRelease(root) {
  const metrics = makeMetrics()
  const registry = createExclusiveAttemptRegistry()
  const key = {}
  const owner = Symbol('pending-owner')
  let showedReady = false

  function Reveal({ lease }) {
    use(lease.ready)
    showedReady = true
    return <span id="pending-ready">pending-ready</span>
  }

  function CommittedOwner() {
    const [lease, setLease] = useState(null)
    useEffect(() => {
      const acquired = registry.acquire(
        key,
        owner,
        delayedCandidateFactory(metrics, 100),
      )
      setLease(acquired)
      return () => acquired.release()
    }, [])
    return (
      <Suspense fallback={<span>pending-fallback</span>}>
        {lease ? <Reveal lease={lease} /> : null}
      </Suspense>
    )
  }

  root.render(<CommittedOwner />)
  await sleep(20)
  root.render(<span id="pending-abandoned">pending-abandoned</span>)
  await sleep(140)

  return {
    ...metrics,
    showedReady,
    activeEntries: registry.activeEntries,
  }
}

function runExclusivityAndRetry() {
  const registry = createExclusiveAttemptRegistry()
  const key = {}
  const ownerA = Symbol('owner-a')
  const ownerB = Symbol('owner-b')
  const metrics = makeMetrics()
  const first = registry.acquire(key, ownerA, delayedCandidateFactory(metrics, 50))
  let exclusivityError = ''
  try {
    registry.acquire(key, ownerB, delayedCandidateFactory(metrics, 50))
  } catch (error) {
    exclusivityError = error.message
  }
  first.release()
  return sleep(0).then(() => {
    const retry = registry.acquire(key, ownerB, delayedCandidateFactory(metrics, 20))
    const retryAttempt = retry.attempt
    retry.release()
    return sleep(70).then(() => ({
      exclusivityError,
      firstAttempt: first.attempt,
      retryAttempt,
      ...metrics,
      activeEntries: registry.activeEntries,
    }))
  })
}

async function run() {
  const container = document.querySelector('#root')
  const root = createRoot(container)
  const unsafe = await runUnsafeRenderAcquisition(root)
  const committedStrict = await runCommittedStrictLease(root)
  const pendingRelease = await runPendingRelease(root)
  const exclusivityAndRetry = await runExclusivityAndRetry()
  root.unmount()

  const evidence = {
    ready: true,
    reactVersion: React.version,
    unsafeRenderAcquisition: unsafe,
    committedStrictLease: committedStrict,
    pendingRelease,
    exclusivityAndRetry,
  }
  window.__blendlinkLeaseEvidence = evidence
  const output = document.querySelector('#evidence')
  output.className = 'ready'
  output.textContent = JSON.stringify(evidence, null, 2)
}

run().catch((error) => {
  window.__blendlinkLeaseEvidence = {
    ready: false,
    error: error instanceof Error ? error.stack : String(error),
  }
  document.querySelector('#evidence').textContent = window.__blendlinkLeaseEvidence.error
})
