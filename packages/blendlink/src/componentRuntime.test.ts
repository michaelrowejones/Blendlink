import { describe, expect, it, vi } from 'vitest'
import type { PortableComponentRecord } from './components.js'
import {
  RuntimeComponentActivationError,
  RuntimeComponentDisposalError,
  RuntimeComponentInstallError,
  installRuntimeComponents,
} from './componentRuntime.js'

function record(id: string): PortableComponentRecord {
  return {
    id,
    type: `studio.${id}`,
    schemaVersion: 1,
    enabled: true,
    target: { kind: 'object', objectId: `${id}-object`, objectName: id },
    values: {},
  }
}

describe('runtime component transaction', () => {
  it('defers optional activation and runs it once in component order', async () => {
    const events: string[] = []
    const installed = await installRuntimeComponents(
      ['first', 'second'].map((id) => ({
        component: record(id),
        install: () => ({
          activate: () => events.push(`${id}:activate`),
          dispose: () => events.push(`${id}:dispose`),
        }),
      })),
      { deferActivation: true },
    )

    expect(events).toEqual([])
    installed.activate()
    installed.activate()
    expect(events).toEqual(['first:activate', 'second:activate'])

    installed.dispose()
    expect(events).toEqual([
      'first:activate',
      'second:activate',
      'second:dispose',
      'first:dispose',
    ])
  })

  it('rolls back the complete set and preserves activation and cleanup failures', async () => {
    const firstDispose = vi.fn()
    const failedDispose = vi.fn(() => { throw new Error('failed activation cleanup failed') })
    const failed = record('failed')
    const installed = await installRuntimeComponents([
      {
        component: record('first'),
        install: () => ({ activate() {}, dispose: firstDispose }),
      },
      {
        component: failed,
        install: () => ({
          activate() { throw new Error('trusted surface rejected listeners') },
          dispose: failedDispose,
        }),
      },
    ], { deferActivation: true })

    let failure: unknown
    try {
      installed.activate()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(RuntimeComponentActivationError)
    expect(failure).toMatchObject({
      component: failed,
      cause: expect.objectContaining({ message: 'trusted surface rejected listeners' }),
      rollbackErrors: [
        expect.objectContaining({ message: 'failed activation cleanup failed' }),
      ],
    })
    expect(failure).toHaveProperty(
      'message',
      expect.stringMatching(/activate.*studio\.failed.*rollback also failed.*cleanup failed/i),
    )
    expect(failedDispose).toHaveBeenCalledOnce()
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(installed.disposed).toBe(true)
    expect(() => installed.activate()).toThrow(/disposed/i)
    expect(() => installed.dispose()).not.toThrow()
  })

  it('rejects asynchronous activation and disposal at the atomic lifecycle boundary', async () => {
    const asynchronousDispose = vi.fn((() => Promise.resolve()) as unknown as () => void)
    const failed = record('async')
    const installed = await installRuntimeComponents([{
      component: failed,
      install: () => ({
        activate: (() => Promise.resolve()) as unknown as () => void,
        dispose: asynchronousDispose,
      }),
    }], { deferActivation: true })

    let failure: unknown
    try { installed.activate() } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(RuntimeComponentActivationError)
    expect(failure).toHaveProperty(
      'message',
      expect.stringMatching(/activate.*Promise.*synchronous/i),
    )
    expect(asynchronousDispose).toHaveBeenCalledOnce()
    expect(() => installed.dispose()).not.toThrow()
  })

  it('surfaces a thenable disposer instead of completing cleanup asynchronously', async () => {
    const installed = await installRuntimeComponents([{
      component: record('async-dispose'),
      install: () => ({
        dispose: (() => Promise.resolve()) as unknown as () => void,
      }),
    }])

    expect(() => installed.dispose()).toThrow(RuntimeComponentDisposalError)
    expect(() => installed.dispose()).not.toThrow()
  })

  it('runs lifecycle phases in stable order and disposes ownership in reverse', async () => {
    const events: string[] = []
    const installed = await installRuntimeComponents(['first', 'second'].map((id) => ({
      component: record(id),
      install: () => ({
        update: () => events.push(`${id}:update`),
        fixedUpdate: () => events.push(`${id}:fixed`),
        beforeRender: () => events.push(`${id}:before`),
        afterRender: () => events.push(`${id}:after`),
        setQuality: (quality) => events.push(`${id}:${quality}`),
        resize: (width, height, pixelRatio) => events.push(`${id}:${width}x${height}@${pixelRatio}`),
        dispose: () => events.push(`${id}:dispose`),
      }),
    })))

    expect(installed.requiresContinuousFrames).toBe(true)

    installed.update(1 / 60)
    installed.fixedUpdate?.(1 / 50)
    installed.resize?.(800, 600, 1.5)
    installed.beforeRender?.()
    installed.afterRender?.()
    installed.setQuality?.('balanced')
    installed.dispose()

    expect(events).toEqual([
      'first:update', 'second:update',
      'first:fixed', 'second:fixed',
      'first:800x600@1.5', 'second:800x600@1.5',
      'first:before', 'second:before',
      'second:after', 'first:after',
      'first:balanced', 'second:balanced',
      'second:dispose', 'first:dispose',
    ])
    expect(installed.disposed).toBe(true)
    expect(() => installed.update(0)).toThrow(/disposed/i)
    expect(() => installed.dispose()).not.toThrow()
  })

  it('lets a lifecycle with no update work settle', async () => {
    const installed = await installRuntimeComponents([
      { component: record('static'), install: () => ({ dispose() {} }) },
    ])
    expect(installed.requiresContinuousFrames).toBe(false)
    installed.dispose()
  })

  it('rolls back earlier ownership and reports the exact failed component', async () => {
    const disposeFirst = vi.fn()
    const first = record('first')
    const failed = record('failed')

    const promise = installRuntimeComponents([
      { component: first, install: () => ({ dispose: disposeFirst }) },
      { component: failed, install: () => { throw new Error('shader compilation failed') } },
    ])

    await expect(promise).rejects.toMatchObject({
      component: failed,
      rollbackErrors: [],
    })
    await expect(promise).rejects.toThrow(/studio\.failed \(failed\).*object failed.*shader compilation failed/i)
    expect(disposeFirst).toHaveBeenCalledOnce()
  })

  it('continues rollback after a disposer fails and preserves both causes', async () => {
    const lastDispose = vi.fn(() => { throw new Error('last cleanup failed') })
    const firstDispose = vi.fn()
    const promise = installRuntimeComponents([
      { component: record('first'), install: () => ({ dispose: firstDispose }) },
      { component: record('last'), install: () => ({ dispose: lastDispose }) },
      { component: record('failed'), install: () => { throw new Error('install failed') } },
    ])

    await expect(promise).rejects.toBeInstanceOf(RuntimeComponentInstallError)
    await expect(promise).rejects.toThrow(/install failed.*rollback also failed.*last cleanup failed/i)
    expect(lastDispose).toHaveBeenCalledOnce()
    expect(firstDispose).toHaveBeenCalledOnce()
  })

  it('attempts every disposer and exposes aggregate disposal errors', async () => {
    const finalDispose = vi.fn()
    const installed = await installRuntimeComponents([
      { component: record('first'), install: () => ({ dispose: () => { throw new Error('first cleanup failed') } }) },
      { component: record('final'), install: () => ({ dispose: finalDispose }) },
    ])

    expect(() => installed.dispose()).toThrow(RuntimeComponentDisposalError)
    expect(finalDispose).toHaveBeenCalledOnce()
    expect(installed.disposed).toBe(true)
  })
})
