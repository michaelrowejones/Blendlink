import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES,
  MeshoptWorkerManager,
  createMainThreadMeshoptDecoder,
  resolveMeshoptWorkerPolicy,
  withMeshoptDecoderForLoad,
  type MeshoptDecoderLike,
  type MeshoptWorkerEnvironment,
} from './meshoptWorkers.js'

function fakeEnvironment(overrides: Partial<MeshoptWorkerEnvironment> = {}): MeshoptWorkerEnvironment {
  return {
    canCreateWorkers: true,
    hardwareConcurrency: 8,
    warn: vi.fn(),
    ...overrides,
  }
}

function fakeDecoder(useWorkers: (count: number) => void = () => {}): MeshoptDecoderLike {
  return {
    supported: true,
    ready: Promise.resolve(),
    decodeGltfBuffer(target, count, size, source) {
      target.set(source.subarray(0, count * size))
    },
    async decodeGltfBufferAsync(count, size) {
      return new Uint8Array(count * size)
    },
    useWorkers,
  }
}

describe('Meshopt worker policy', () => {
  it('keeps small and unknown scenes on the main thread by default', () => {
    const environment = fakeEnvironment()
    expect(resolveMeshoptWorkerPolicy(
      DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES - 1,
      {},
      environment,
    )).toMatchObject({ workerCount: 2, shouldUseWorkers: false })
    expect(resolveMeshoptWorkerPolicy(undefined, {}, environment).shouldUseWorkers).toBe(false)
    expect(resolveMeshoptWorkerPolicy(
      DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES,
      {},
      environment,
    )).toMatchObject({ workerCount: 2, shouldUseWorkers: true })
  })

  it('supports explicit disable, bounded counts, thresholds, and unknown-size opt-in', () => {
    const environment = fakeEnvironment()
    expect(resolveMeshoptWorkerPolicy(100_000_000, {
      meshoptWorkerCount: false,
    }, environment).shouldUseWorkers).toBe(false)
    expect(resolveMeshoptWorkerPolicy(100_000_000, {
      meshoptWorkerCount: 0,
    }, environment).shouldUseWorkers).toBe(false)
    expect(resolveMeshoptWorkerPolicy(12, {
      meshoptWorkerCount: 4,
      meshoptWorkerThresholdBytes: 12,
    }, environment)).toMatchObject({ workerCount: 4, shouldUseWorkers: true })
    expect(resolveMeshoptWorkerPolicy(undefined, {
      meshoptWorkerThresholdBytes: 0,
    }, environment).shouldUseWorkers).toBe(true)
  })

  it('never selects workers in SSR and rejects unsafe policy values', () => {
    expect(resolveMeshoptWorkerPolicy(100_000_000, {}, {
      canCreateWorkers: false,
      hardwareConcurrency: 64,
    }).shouldUseWorkers).toBe(false)
    expect(() => resolveMeshoptWorkerPolicy(1, { meshoptWorkerCount: 5 }, {
      canCreateWorkers: true,
    })).toThrow(/integer from 0 to 4/)
    expect(() => resolveMeshoptWorkerPolicy(1, { meshoptWorkerCount: 1.5 }, {
      canCreateWorkers: true,
    })).toThrow(/integer from 0 to 4/)
    expect(() => resolveMeshoptWorkerPolicy(1, { meshoptWorkerThresholdBytes: -1 }, {
      canCreateWorkers: true,
    })).toThrow(/non-negative safe integer/)
    expect(() => resolveMeshoptWorkerPolicy(Number.MAX_SAFE_INTEGER + 1, {}, {
      canCreateWorkers: true,
    })).toThrow(/meshoptDecodedBytes/)
  })
})

describe('Meshopt worker lifecycle', () => {
  it('leases one global pool across concurrent loads and stops it after the last release', () => {
    const calls: number[] = []
    const decoder = fakeDecoder((count) => calls.push(count))
    const manager = new MeshoptWorkerManager(decoder, fakeEnvironment())
    const first = manager.acquire(DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES)
    const second = manager.acquire(DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES, {
      meshoptWorkerCount: 4,
    })

    expect(first).toMatchObject({ decoder, usesWorkers: true })
    expect(second).toMatchObject({ decoder, usesWorkers: true })
    expect(calls).toEqual([2])
    first.release()
    first.release()
    expect(calls).toEqual([2])
    second.release()
    expect(calls).toEqual([2, 0])
  })

  it('isolates a concurrent small load from the active global worker pool', () => {
    const calls: number[] = []
    const decoder = fakeDecoder((count) => calls.push(count))
    const manager = new MeshoptWorkerManager(decoder, fakeEnvironment())
    const large = manager.acquire(DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES)
    const small = manager.acquire(64)

    expect(large.usesWorkers).toBe(true)
    expect(small.usesWorkers).toBe(false)
    expect(small.decoder).not.toBe(decoder)
    large.release()
    expect(calls).toEqual([2])
    small.release()
    expect(calls).toEqual([2, 0])
  })

  it('falls back safely and tries to close a partially-created pool after startup failure', () => {
    const calls: number[] = []
    const environment = fakeEnvironment()
    const decoder = fakeDecoder((count) => {
      calls.push(count)
      if (count > 0) throw new Error('worker blocked by CSP')
    })
    const manager = new MeshoptWorkerManager(decoder, environment)

    const lease = manager.acquire(DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES)
    expect(lease.usesWorkers).toBe(false)
    expect(lease.decoder).not.toBe(decoder)
    expect(calls).toEqual([2, 0])
    expect(environment.warn).toHaveBeenCalledWith(expect.stringMatching(/main thread.*CSP/))
    lease.release()
    manager.acquire(DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES).release()
    expect(calls).toEqual([2, 0])
  })

  it('reports startup fallback and partial-pool cleanup failures together', () => {
    const environment = fakeEnvironment()
    const manager = new MeshoptWorkerManager(fakeDecoder((count) => {
      throw new Error(count === 0 ? 'cleanup denied' : 'startup denied')
    }), environment)

    expect(manager.acquire(DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES).usesWorkers).toBe(false)
    expect(environment.warn).toHaveBeenCalledWith(expect.stringMatching(
      /decode on the main thread.*startup denied.*[Cc]leanup.*cleanup denied/,
    ))
  })

  it('does not invoke useWorkers when the environment cannot construct workers', () => {
    const useWorkers = vi.fn()
    const manager = new MeshoptWorkerManager(fakeDecoder(useWorkers), fakeEnvironment({
      canCreateWorkers: false,
    }))
    const lease = manager.acquire(DEFAULT_MESHOPT_WORKER_THRESHOLD_BYTES, {
      meshoptWorkerCount: 4,
      meshoptWorkerThresholdBytes: 0,
    })
    expect(lease.usesWorkers).toBe(false)
    expect(useWorkers).not.toHaveBeenCalled()
  })

  it('releases the loader lease after success, rejection, and configuration failure', async () => {
    const decoder = fakeDecoder()
    const release = vi.fn()
    const manager = { acquire: vi.fn(() => ({ decoder, usesWorkers: true, release })) }
    let configured: unknown
    await expect(withMeshoptDecoderForLoad(
      { setMeshoptDecoder(value) { configured = value } },
      10,
      {},
      async () => 'loaded',
      manager,
    )).resolves.toBe('loaded')
    expect(configured).toBe(decoder)
    expect(release).toHaveBeenCalledTimes(1)

    await expect(withMeshoptDecoderForLoad(
      { setMeshoptDecoder() {} },
      10,
      {},
      async () => { throw new Error('load failed') },
      manager,
    )).rejects.toThrow(/load failed/)
    expect(release).toHaveBeenCalledTimes(2)

    await expect(withMeshoptDecoderForLoad(
      { setMeshoptDecoder() { throw new Error('bad loader') } },
      10,
      {},
      async () => 'unreachable',
      manager,
    )).rejects.toThrow(/bad loader/)
    expect(release).toHaveBeenCalledTimes(3)
  })

  it('installs an application-owned decoder without acquiring or disposing its pool', async () => {
    const decoder = fakeDecoder()
    const manager = { acquire: vi.fn() }
    const setMeshoptDecoder = vi.fn()
    await expect(withMeshoptDecoderForLoad(
      { setMeshoptDecoder },
      100_000_000,
      { meshoptDecoder: decoder },
      async () => 'loaded',
      manager,
    )).resolves.toBe('loaded')
    expect(setMeshoptDecoder).toHaveBeenCalledWith(decoder)
    expect(manager.acquire).not.toHaveBeenCalled()

    await expect(withMeshoptDecoderForLoad(
      { setMeshoptDecoder },
      100_000_000,
      { meshoptDecoder: decoder, meshoptWorkerThresholdBytes: 0 },
      async () => 'unreachable',
      manager,
    )).rejects.toThrow(/one worker lifecycle owner/)
  })
})

describe('main-thread Meshopt adapter', () => {
  it('implements GLTFLoader async decoding without exposing the global worker control', async () => {
    const decode = vi.fn((target: Uint8Array) => target.fill(7))
    const decoder = fakeDecoder()
    decoder.decodeGltfBuffer = decode
    const adapter = createMainThreadMeshoptDecoder(decoder)

    expect(adapter.useWorkers).toBeUndefined()
    await expect(adapter.decodeGltfBufferAsync!(3, 4, new Uint8Array([1]), 'ATTRIBUTES'))
      .resolves.toEqual(new Uint8Array(12).fill(7))
    expect(decode).toHaveBeenCalledOnce()
  })
})
