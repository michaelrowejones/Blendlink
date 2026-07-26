import { describe, expect, it, vi } from 'vitest'
import {
  createRuntimePerformanceMonitor,
  type RuntimeLongTaskEntry,
  type RuntimePerformanceEnvironment,
} from './runtimePerformance.js'

function environment(overrides: Partial<RuntimePerformanceEnvironment> = {}) {
  let now = 100
  return {
    value: {
      now: () => now,
      clockSource: 'custom' as const,
      ...overrides,
    },
    setNow(value: number) {
      now = value
    },
  }
}

describe('runtime performance evidence', () => {
  it('measures resources, frame percentiles, long tasks, and renderer.info without invented values', async () => {
    let onLongTasks: ((entries: readonly RuntimeLongTaskEntry[]) => void) | null = null
    const disconnect = vi.fn()
    const host = environment({
      getResourceEntries: () => [
        { name: 'before.glb', startTime: 90, transferSize: 999, encodedBodySize: 999, decodedBodySize: 999 },
        { name: 'scene.glb', startTime: 105, transferSize: 800, encodedBodySize: 700, decodedBodySize: 1_400 },
        { name: 'opaque.ktx2', startTime: 110 },
      ],
      observeLongTasks(callback) {
        onLongTasks = callback
        return { disconnect }
      },
    })
    const monitor = createRuntimePerformanceMonitor({
      environment: host.value,
      enableGpuTiming: false,
      frameSampleCapacity: 3,
    })
    monitor.start()
    onLongTasks?.([
      { startTime: 95, duration: 100 },
      { startTime: 108, duration: 62 },
      { startTime: 115, duration: 80 },
    ])

    const renderer = {
      info: {
        autoReset: true,
        render: { calls: 4, triangles: 1_000 },
        memory: { geometries: 3, textures: 5 },
        programs: [{}, {}],
      },
    }
    monitor.sample(renderer, null, 101)
    renderer.info.render.calls = 8
    renderer.info.render.triangles = 2_000
    monitor.sample(renderer, null, 111)
    monitor.sample(renderer, null, 131)
    monitor.sample(renderer, null, 161)
    monitor.sample(renderer, null, 201)
    host.setNow(220)
    const report = await monitor.finish(renderer)

    expect(report.evidence).toBe('browser-runtime')
    expect(report.durationMs).toBe(120)
    expect(report.resources).toEqual({
      available: true,
      entries: 2,
      entriesWithSizeEvidence: 1,
      entriesWithoutSizeEvidence: 1,
      transferBytes: 800,
      encodedBodyBytes: 700,
      decodedBodyBytes: 1_400,
    })
    expect(report.frames.distribution).toMatchObject({
      samples: 4,
      retainedSamples: 3,
      droppedSamples: 1,
      minMs: 20,
      maxMs: 40,
      p50Ms: 30,
      p95Ms: 40,
      p99Ms: 40,
    })
    expect(report.longTasks).toMatchObject({
      available: true,
      count: 2,
      totalDurationMs: 142,
      maxDurationMs: 80,
    })
    expect(report.renderer.latest).toEqual({
      calls: 8,
      triangles: 2_000,
      programs: 2,
      geometries: 3,
      textures: 5,
    })
    expect(report.renderer.peak?.calls).toBe(8)
    expect(disconnect).toHaveBeenCalledOnce()
    expect(report.gpu.available).toBe(false)
    expect(report.gpu.unavailableReason).toContain('disabled')
  })

  it('reports unsupported evidence explicitly and never substitutes zero measurements', async () => {
    const host = environment()
    const monitor = createRuntimePerformanceMonitor({ environment: host.value })
    monitor.start()
    monitor.sample(null, null, 105)
    host.setNow(110)
    const report = await monitor.finish()

    expect(report.capabilities.resourceTiming).toMatchObject({ available: false })
    expect(report.resources.transferBytes).toBeUndefined()
    expect(report.capabilities.longTasks).toMatchObject({ available: false })
    expect(report.frames.available).toBe(false)
    expect(report.renderer.latest).toBeUndefined()
    expect(report.gpu.distribution).toBeUndefined()
    expect(report.gpu.unavailableReason).toContain('No measured render callback')
  })

  it('collects WebGL2 timer-query samples and rejects disjoint evidence', async () => {
    let nextQuery = 0
    let disjointRead = 0
    const deleted: number[] = []
    const gl = {
      QUERY_RESULT_AVAILABLE: 1,
      QUERY_RESULT: 2,
      getExtension: (name: string) => name === 'EXT_disjoint_timer_query_webgl2'
        ? { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 }
        : null,
      createQuery: () => ++nextQuery,
      beginQuery: vi.fn(),
      endQuery: vi.fn(),
      getQueryParameter: (query: number, parameter: number) => parameter === 1
        ? true
        : query * 1_000_000,
      getParameter: () => {
        disjointRead += 1
        return disjointRead === 2
      },
      deleteQuery: (query: number) => deleted.push(query),
      flush: vi.fn(),
    }
    const renderer = {
      info: { render: { calls: 1, triangles: 2 }, memory: { geometries: 1, textures: 0 } },
      getContext: () => gl,
    }
    const render = vi.fn()
    const host = environment()
    const monitor = createRuntimePerformanceMonitor({
      environment: host.value,
      gpuSampleInterval: 1,
      gpuFinishTimeoutMs: 0,
    })
    monitor.start()
    monitor.sample(renderer, render, 101) // query 1 begins
    monitor.sample(renderer, render, 111) // query 1 accepted; query 2 begins
    monitor.sample(renderer, render, 121) // query 2 rejected; query 3 begins
    host.setNow(130)
    const report = await monitor.finish(renderer) // query 3 accepted

    expect(render).toHaveBeenCalledTimes(3)
    expect(gl.beginQuery).toHaveBeenCalledTimes(3)
    expect(gl.endQuery).toHaveBeenCalledTimes(3)
    expect(deleted).toEqual([1, 2, 3])
    expect(report.capabilities.gpuTimerQueryWebgl2.available).toBe(true)
    expect(report.gpu).toMatchObject({
      available: true,
      rejectedDisjointSamples: 1,
      timedRenderCallbacks: 3,
      pendingSamplesDiscarded: 0,
    })
    expect(report.gpu.distribution).toMatchObject({
      samples: 2,
      minMs: 1,
      maxMs: 3,
      p50Ms: 1,
      p95Ms: 3,
      p99Ms: 3,
    })
  })

  it('validates lifecycle, clocks, options, and renderer counters loudly', async () => {
    expect(() => createRuntimePerformanceMonitor({ frameSampleCapacity: 0 })).toThrow('frameSampleCapacity')
    const host = environment()
    const monitor = createRuntimePerformanceMonitor({ environment: host.value })
    expect(() => monitor.sample()).toThrow('requires state running')
    monitor.start()
    monitor.sample(null, null, 110)
    expect(() => monitor.sample(null, null, 109)).toThrow('monotonic')
    expect(() => monitor.sample({ info: { render: { calls: -1 } } }, null, 111)).toThrow(
      'renderer.info.render.calls',
    )
    host.setNow(120)
    await monitor.finish()
    expect(() => monitor.start()).toThrow('requires state idle')
    monitor.dispose()
    monitor.dispose()
  })
})
