import { describe, expect, it, vi } from 'vitest'
import {
  SceneInstallationTransactionError,
  createSceneInstallationCoordinator,
  type ScenePreparationContext,
} from './preparedSceneInstallation.js'

describe('prepared scene installation', () => {
  it('commits staged mutations synchronously once and rolls them back in reverse on disposal', async () => {
    const events: string[] = []
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare(({ own, stage }) => {
      own({
        label: 'decoded scene',
        dispose: () => { events.push('resource:dispose') },
      })
      stage({
        label: 'scene root',
        apply: () => { events.push('root:apply') },
        rollback: () => { events.push('root:rollback') },
      })
      stage({
        label: 'renderer look',
        apply: () => { events.push('look:apply') },
        rollback: () => { events.push('look:rollback') },
      })
      return { root: 'prepared-root' }
    })

    expect(prepared.state).toBe('prepared')
    expect(prepared.commit()).toEqual({ root: 'prepared-root' })
    expect(prepared.state).toBe('committed')
    expect(events).toEqual(['root:apply', 'look:apply'])

    expect(() => prepared.commit()).toThrowError(
      expect.objectContaining({
        code: 'illegal-transition',
        generation: 1,
        state: 'committed',
      }),
    )

    prepared.dispose()
    prepared.dispose()
    expect(prepared.state).toBe('disposed')
    expect(events).toEqual([
      'root:apply',
      'look:apply',
      'look:rollback',
      'root:rollback',
      'resource:dispose',
    ])
  })

  it('rolls back the current and prior mutations when a synchronous commit step fails', async () => {
    const events: string[] = []
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare(({ own, stage }) => {
      own({
        label: 'loaded scene',
        dispose: () => { events.push('resource:dispose') },
      })
      stage({
        label: 'scene root',
        apply: () => { events.push('root:apply') },
        rollback: () => { events.push('root:rollback') },
      })
      stage({
        label: 'renderer look',
        apply: () => {
          events.push('look:apply')
          throw new Error('renderer rejected tone mapping')
        },
        rollback: () => { events.push('look:rollback') },
      })
      return 'ready'
    })

    let failure: unknown
    try {
      prepared.commit()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(SceneInstallationTransactionError)
    expect(failure).toMatchObject({
      code: 'commit-failed',
      generation: 1,
      cleanupErrors: [],
    })
    expect(failure).toHaveProperty('cause.message', 'renderer rejected tone mapping')
    expect(prepared.state).toBe('failed')
    expect(events).toEqual([
      'root:apply',
      'look:apply',
      'look:rollback',
      'root:rollback',
      'resource:dispose',
    ])

    prepared.dispose()
    expect(events).toHaveLength(5)
  })

  it('attempts the complete disposal journal and reports every cleanup failure once', async () => {
    const successfulRollback = vi.fn()
    const successfulDispose = vi.fn()
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare(({ own, stage }) => {
      own({
        label: 'decoder',
        dispose: successfulDispose,
      })
      own({
        label: 'environment texture',
        dispose: () => { throw new Error('texture cleanup failed') },
      })
      stage({
        label: 'scene root',
        apply() {},
        rollback: successfulRollback,
      })
      stage({
        label: 'renderer look',
        apply() {},
        rollback: () => { throw new Error('look rollback failed') },
      })
      return null
    })
    prepared.commit()

    let failure: unknown
    try {
      prepared.dispose()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(SceneInstallationTransactionError)
    expect(failure).toMatchObject({
      code: 'cleanup-failed',
      generation: 1,
      state: 'disposed',
    })
    expect((failure as SceneInstallationTransactionError).cleanupErrors).toHaveLength(2)
    expect(successfulRollback).toHaveBeenCalledOnce()
    expect(successfulDispose).toHaveBeenCalledOnce()
    expect(prepared.state).toBe('disposed')
    expect(() => prepared.dispose()).not.toThrow()
    expect(successfulRollback).toHaveBeenCalledOnce()
    expect(successfulDispose).toHaveBeenCalledOnce()
  })

  it('aborts and cleans an older async generation before a newer candidate can commit', async () => {
    let releaseFirst!: () => void
    const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve })
    let reportFirstStarted!: () => void
    const firstStarted = new Promise<void>((resolve) => { reportFirstStarted = resolve })
    const firstResourceDispose = vi.fn()
    let firstSignal: AbortSignal | undefined
    const coordinator = createSceneInstallationCoordinator()

    const first = coordinator.prepare(async (context) => {
      firstSignal = context.signal
      context.own({ label: 'first GLB', dispose: firstResourceDispose })
      reportFirstStarted()
      await firstCanFinish
      context.throwIfCancelled()
      return 'first'
    })
    await firstStarted

    const second = await coordinator.prepare(() => 'second')
    expect(firstSignal?.aborted).toBe(true)
    expect(firstResourceDispose).toHaveBeenCalledOnce()

    releaseFirst()
    await expect(first).rejects.toMatchObject({
      code: 'preparation-cancelled',
      generation: 1,
      state: 'stale',
    })
    expect(second.generation).toBe(2)
    expect(second.commit()).toBe('second')
    expect(firstResourceDispose).toHaveBeenCalledOnce()
  })

  it('rejects an asynchronous live mutation instead of reporting a synchronous commit', async () => {
    const rollback = vi.fn()
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare(({ stage }) => {
      stage({
        label: 'async renderer mutation',
        apply: (() => Promise.resolve()) as unknown as () => void,
        rollback,
      })
      return null
    })

    expect(() => prepared.commit()).toThrow(/async renderer mutation.*promise.*synchronous/i)
    expect(prepared.state).toBe('failed')
    expect(rollback).toHaveBeenCalledOnce()
  })

  it('keeps a caller AbortSignal authoritative until the prepared candidate commits', async () => {
    const release = vi.fn()
    const abortController = new AbortController()
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare(({ own }) => {
      own({ label: 'prepared GLB', dispose: release })
      return 'candidate'
    }, { signal: abortController.signal })

    abortController.abort(new Error('route unmounted'))

    expect(prepared.state).toBe('stale')
    expect(release).toHaveBeenCalledOnce()
    expect(() => prepared.commit()).toThrowError(
      expect.objectContaining({
        code: 'illegal-transition',
        generation: 1,
        state: 'stale',
      }),
    )
    prepared.dispose()
    expect(release).toHaveBeenCalledOnce()
  })

  it('cleans every owned resource when asynchronous preparation itself fails', async () => {
    const events: string[] = []
    const coordinator = createSceneInstallationCoordinator()
    const preparing = coordinator.prepare(async ({ own }) => {
      own({
        label: 'GLB',
        dispose: () => { events.push('glb:dispose') },
      })
      own({
        label: 'HDR',
        dispose: () => {
          events.push('hdr:dispose')
          throw new Error('HDR cleanup failed')
        },
      })
      throw new Error('decoder initialization failed')
    })

    await expect(preparing).rejects.toMatchObject({
      code: 'preparation-failed',
      generation: 1,
      state: 'failed',
      cleanupErrors: [expect.objectContaining({ message: 'HDR cleanup failed' })],
    })
    expect(events).toEqual(['hdr:dispose', 'glb:dispose'])
  })

  it('makes coordinator disposal idempotent and permanently rejects new generations', async () => {
    const release = vi.fn()
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare(({ own }) => {
      own({ label: 'candidate', dispose: release })
      return null
    })

    coordinator.dispose()
    coordinator.dispose()

    expect(prepared.state).toBe('stale')
    expect(release).toHaveBeenCalledOnce()
    await expect(coordinator.prepare(() => null)).rejects.toMatchObject({
      code: 'illegal-transition',
      state: 'coordinator-disposed',
    })
  })

  it('preserves method receivers for resource and mutation adapters', async () => {
    const resource = {
      label: 'receiver resource',
      disposed: false,
      dispose() { this.disposed = true },
    }
    const mutation = {
      label: 'receiver mutation',
      applied: false,
      rolledBack: false,
      apply() { this.applied = true },
      rollback() { this.rolledBack = true },
    }
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare(({ own, stage }) => {
      own(resource)
      stage(mutation)
      return null
    })

    prepared.commit()
    prepared.dispose()

    expect(mutation.applied).toBe(true)
    expect(mutation.rolledBack).toBe(true)
    expect(resource.disposed).toBe(true)
  })

  it('surfaces an abort-time cleanup failure exactly once through the stale candidate', async () => {
    const abortController = new AbortController()
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare(({ own }) => {
      own({
        label: 'failing GLB release',
        dispose: () => { throw new Error('GLB release failed') },
      })
      return null
    }, { signal: abortController.signal })

    abortController.abort(new Error('route unmounted'))

    expect(() => prepared.dispose()).toThrowError(
      expect.objectContaining({
        code: 'cleanup-failed',
        generation: 1,
        state: 'stale',
        cleanupErrors: [expect.objectContaining({ message: 'GLB release failed' })],
      }),
    )
    expect(() => prepared.dispose()).not.toThrow()
    const replacement = await coordinator.prepare(() => 'replacement')
    expect(replacement.commit()).toBe('replacement')
  })

  it('surfaces an unobserved abort-time cleanup failure before stale commit diagnostics', async () => {
    const abortController = new AbortController()
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare(({ own }) => {
      own({
        label: 'failing decoder release',
        dispose: () => { throw new Error('decoder release failed') },
      })
      return null
    }, { signal: abortController.signal })
    abortController.abort(new Error('retry requested'))

    expect(() => prepared.commit()).toThrowError(
      expect.objectContaining({
        code: 'cleanup-failed',
        cleanupErrors: [expect.objectContaining({ message: 'decoder release failed' })],
      }),
    )
    expect(() => prepared.commit()).toThrowError(
      expect.objectContaining({ code: 'illegal-transition', state: 'stale' }),
    )
  })

  it('surfaces an unobserved abort-time cleanup failure before preparing a replacement', async () => {
    const abortController = new AbortController()
    const coordinator = createSceneInstallationCoordinator()
    await coordinator.prepare(({ own }) => {
      own({
        label: 'failing texture release',
        dispose: () => { throw new Error('texture release failed') },
      })
      return null
    }, { signal: abortController.signal })
    abortController.abort(new Error('new generation requested'))

    await expect(coordinator.prepare(() => 'blocked')).rejects.toMatchObject({
      code: 'cleanup-failed',
      cleanupErrors: [expect.objectContaining({ message: 'texture release failed' })],
    })
    const replacement = await coordinator.prepare(() => 'replacement')
    expect(replacement.commit()).toBe('replacement')
  })

  it('invalidates a prepared candidate when an adapter registers ownership after preparation closes', async () => {
    const preparedRelease = vi.fn()
    const lateRelease = vi.fn()
    let context!: ScenePreparationContext
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare((candidateContext) => {
      context = candidateContext
      context.own({ label: 'prepared GLB', dispose: preparedRelease })
      return null
    })

    expect(() => context.own({
      label: 'late texture',
      dispose: lateRelease,
    })).toThrow(/register preparation work.*generation 1.*prepared/i)

    expect(prepared.state).toBe('stale')
    expect(preparedRelease).toHaveBeenCalledOnce()
    expect(lateRelease).toHaveBeenCalledOnce()
    expect(() => prepared.commit()).toThrowError(
      expect.objectContaining({
        code: 'illegal-transition',
        state: 'stale',
      }),
    )
  })

  it('leaves committed ownership with the caller when the coordinator is disposed', async () => {
    const release = vi.fn()
    const coordinator = createSceneInstallationCoordinator()
    const prepared = await coordinator.prepare(({ own }) => {
      own({ label: 'committed scene', dispose: release })
      return null
    })
    prepared.commit()

    coordinator.dispose()

    expect(prepared.state).toBe('committed')
    expect(release).not.toHaveBeenCalled()
    prepared.dispose()
    expect(release).toHaveBeenCalledOnce()
  })

  it('rejects a reentrant replacement while the current generation is committing', async () => {
    const coordinator = createSceneInstallationCoordinator()
    let replacement!: ReturnType<typeof coordinator.prepare>
    const prepared = await coordinator.prepare(({ stage }) => {
      stage({
        label: 'reentrant adapter',
        apply() {
          replacement = coordinator.prepare(() => null)
        },
        rollback() {},
      })
      return null
    })

    prepared.commit()

    await expect(replacement).rejects.toMatchObject({
      code: 'illegal-transition',
      generation: 1,
      state: 'committing',
    })
    expect(prepared.state).toBe('committed')
  })
})
