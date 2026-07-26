import { describe, expect, it, vi } from 'vitest'
import { createThreeAudioCoordinator } from './threeAudio.js'

function audioContext(initial: AudioContextState = 'suspended') {
  const listeners = new Set<EventListener>()
  const context = {
    state: initial,
    resume: vi.fn(() => {
      context.state = 'running'
      for (const listener of listeners) listener(new Event('statechange'))
      return Promise.resolve()
    }),
    addEventListener: vi.fn((_type: string, listener: EventListener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: EventListener) => listeners.delete(listener)),
  }
  return context as unknown as AudioContext & { state: AudioContextState }
}

describe('Three audio readiness coordinator', () => {
  it('calls resume synchronously during activation, then performs the action', async () => {
    const coordinator = createThreeAudioCoordinator()
    const context = audioContext()
    coordinator.attach(context)
    const action = vi.fn()
    coordinator.activate(action)
    expect(context.resume).toHaveBeenCalledOnce()
    expect(action).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(action).toHaveBeenCalledOnce()
    expect(coordinator.readiness).toEqual({ state: 'ready' })
  })

  it('publishes blocked, ready, unavailable, and idempotent ownership changes', async () => {
    const coordinator = createThreeAudioCoordinator()
    const context = audioContext()
    const changed = vi.fn()
    coordinator.subscribe(changed)
    const first = coordinator.attach(context)
    const second = coordinator.attach(context)
    expect(coordinator.readiness).toEqual({ state: 'blocked' })
    expect(await coordinator.resume()).toBe(true)
    expect(coordinator.readiness).toEqual({ state: 'ready' })
    first.dispose()
    expect(coordinator.readiness).toEqual({ state: 'ready' })
    second.dispose()
    second.dispose()
    expect(coordinator.readiness).toEqual({ state: 'unavailable' })
    expect(changed).toHaveBeenCalled()
    coordinator.dispose()
  })
})
