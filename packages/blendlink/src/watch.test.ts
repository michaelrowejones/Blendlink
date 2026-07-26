import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, resolveConfig } from './config.js'
import type { SyncOutcome } from './sync.js'
import { watchScenes } from './watch.js'

type SyncSceneImplementation = typeof import('./sync.js')['syncScene']

const syncControl = vi.hoisted(() => ({
  implementation: undefined as SyncSceneImplementation | undefined,
}))

vi.mock('./sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sync.js')>()
  return {
    ...actual,
    syncScene: (...args: Parameters<SyncSceneImplementation>) => syncControl.implementation
      ? syncControl.implementation(...args)
      : actual.syncScene(...args),
  }
})

const fakeChokidar = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  class FakeWatcher {
    readonly paths: string[]
    closed = false
    private readonly listeners = new Map<string, Set<Listener>>()
    private readonly onceListeners = new Map<string, Set<Listener>>()

    constructor(paths: string | readonly string[]) {
      this.paths = typeof paths === 'string' ? [paths] : [...paths]
    }

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return this
    }

    once(event: string, listener: Listener): this {
      const listeners = this.onceListeners.get(event) ?? new Set()
      listeners.add(listener)
      this.onceListeners.set(event, listeners)
      return this
    }

    emit(event: string, ...args: unknown[]): void {
      if (this.closed) return
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
      const once = this.onceListeners.get(event)
      if (!once) return
      this.onceListeners.delete(event)
      for (const listener of once) listener(...args)
    }

    async close(): Promise<void> {
      this.closed = true
    }
  }

  const instances: FakeWatcher[] = []
  return {
    instances,
    watch(paths: string | readonly string[]) {
      const watcher = new FakeWatcher(paths)
      instances.push(watcher)
      queueMicrotask(() => watcher.emit('ready'))
      return watcher
    },
  }
})

vi.mock('chokidar', () => ({
  default: { watch: fakeChokidar.watch },
}))

type WatchOutcome = SyncOutcome | { scene: string; error: string }

function outcomeLog(): {
  callback: (outcome: WatchOutcome) => void
  values: WatchOutcome[]
  next: (predicate: (outcome: WatchOutcome) => boolean, after?: number) => Promise<WatchOutcome>
} {
  const values: WatchOutcome[] = []
  const listeners = new Set<() => void>()
  return {
    values,
    callback(outcome) {
      values.push(outcome)
      for (const listener of listeners) listener()
    },
    next(predicate, after = 0) {
      const present = values.slice(after).find(predicate)
      if (present) return Promise.resolve(present)
      return new Promise((resolvePromise) => {
        const listener = () => {
          const found = values.slice(after).find(predicate)
          if (!found) return
          listeners.delete(listener)
          resolvePromise(found)
        }
        listeners.add(listener)
      })
    },
  }
}

async function within<T>(promise: Promise<T>, timeoutMs = 4_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('watch outcome timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

describe('scene watch dependencies', () => {
  beforeEach(() => {
    fakeChokidar.instances.length = 0
    syncControl.implementation = undefined
  })

  it('subscribes before its initial build and drains a save dirtied during that build', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-watch-initial-'))
    const blendPath = resolve(root, 'hero.blend')
    writeFileSync(blendPath, 'blend-v1')
    const config = resolveConfig({
      scenes: [{ file: 'hero.blend', name: 'hero', external: true }],
    }, root)
    const first = deferred<SyncOutcome>()
    const second = deferred<SyncOutcome>()
    const starts: string[] = []
    const outcomes = outcomeLog()
    const syncScene = vi.fn<SyncSceneImplementation>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    syncControl.implementation = syncScene

    const opening = watchScenes(config, outcomes.callback, {
      initialBuild: 'force',
      onStart(scene) {
        starts.push(scene)
        if (starts.length === 1) {
          fakeChokidar.instances[0]!.emit('all', 'change', blendPath)
        }
      },
    })
    let opened = false
    void opening.then(() => { opened = true })

    try {
      await within(new Promise<void>((resolveStarted) => {
        const check = () => starts.length > 0 ? resolveStarted() : setImmediate(check)
        check()
      }))
      expect(fakeChokidar.instances).toHaveLength(1)
      expect(opened).toBe(false)

      first.resolve({ scene: 'hero', action: 'skipped', durationMs: 1, warnings: [] })
      await within(new Promise<void>((resolveStarted) => {
        const check = () => starts.length === 2 ? resolveStarted() : setImmediate(check)
        check()
      }))
      expect(opened).toBe(false)

      second.resolve({ scene: 'hero', action: 'skipped', durationMs: 1, warnings: [] })
      const handle = await within(opening)
      expect(starts).toEqual(['hero', 'hero'])
      expect(syncScene.mock.calls.map((call) => call[2]?.force)).toEqual([true, undefined])
      expect(outcomes.values).toHaveLength(2)
      await handle.close()
    } finally {
      syncControl.implementation = undefined
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects and closes the subscription when the initial build fails', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-watch-initial-failure-'))
    const blendPath = resolve(root, 'hero.blend')
    writeFileSync(blendPath, 'blend-v1')
    const config = resolveConfig({
      scenes: [{ file: 'hero.blend', name: 'hero', external: true }],
    }, root)
    const failure = Object.assign(new Error('Blender exited abnormally (code 1).'), {
      detail: { stderrTail: 'Traceback: material export failed' },
    })
    const outcomes = outcomeLog()
    let receivedOptions: Record<string, unknown> | undefined
    syncControl.implementation = vi.fn((
      _scene: unknown,
      _blender: unknown,
      options: Record<string, unknown>,
    ) => {
      receivedOptions = options
      return Promise.reject(failure)
    })

    try {
      await expect(watchScenes(config, outcomes.callback, {
        draft: true,
        allowNewerFile: true,
        initialBuild: 'force',
      })).rejects.toBe(failure)
      expect(receivedOptions).toMatchObject({
        force: true,
        draft: true,
        allowNewerFile: true,
      })
      expect(outcomes.values).toEqual([{
        scene: 'hero',
        error: 'Blender exited abnormally (code 1).\n' +
          '--- Blender output tail ---\n' +
          'Traceback: material export failed',
      }])
      expect(fakeChokidar.instances[0]!.closed).toBe(true)
    } finally {
      syncControl.implementation = undefined
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('can report an invalid first revision and recover on a later save', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-watch-initial-recovery-'))
    const blendPath = resolve(root, 'hero.blend')
    writeFileSync(blendPath, 'blend-v1')
    const config = resolveConfig({
      scenes: [{ file: 'hero.blend', name: 'hero', external: true }],
    }, root)
    const outcomes = outcomeLog()
    syncControl.implementation = vi.fn()
      .mockRejectedValueOnce(new Error('unsupported animated material property'))
      .mockResolvedValueOnce({
        scene: 'hero', action: 'skipped', durationMs: 1, warnings: [],
      } satisfies SyncOutcome)

    const handle = await watchScenes(config, outcomes.callback, {
      initialBuild: 'force',
      initialBuildFailure: 'report',
    })

    try {
      expect(outcomes.values).toEqual([{
        scene: 'hero',
        error: 'unsupported animated material property',
      }])
      expect(fakeChokidar.instances[0]!.closed).toBe(false)

      fakeChokidar.instances[0]!.emit('all', 'change', blendPath)
      await expect(within(outcomes.next(
        (entry) => !('error' in entry),
        1,
      ))).resolves.toMatchObject({ scene: 'hero', action: 'skipped' })
      expect(syncControl.implementation).toHaveBeenCalledTimes(2)
    } finally {
      await handle.close()
      syncControl.implementation = undefined
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports a later build failure and recovers on the next saved change', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-watch-build-recovery-'))
    const blendPath = resolve(root, 'hero.blend')
    writeFileSync(blendPath, 'blend-v1')
    const config = resolveConfig({
      scenes: [{ file: 'hero.blend', name: 'hero', external: true }],
    }, root)
    const outcomes = outcomeLog()
    const starts: string[] = []
    const failure = new Error('temporary material export failure')
    syncControl.implementation = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({
        scene: 'hero', action: 'skipped', durationMs: 1, warnings: [],
      } satisfies SyncOutcome)
    const handle = await watchScenes(config, outcomes.callback, {
      onStart: (scene) => starts.push(scene),
    })

    try {
      fakeChokidar.instances[0]!.emit('all', 'change', blendPath)
      await expect(within(outcomes.next((entry) => 'error' in entry))).resolves.toEqual({
        scene: 'hero',
        error: 'temporary material export failure',
      })
      expect(fakeChokidar.instances[0]!.closed).toBe(false)

      const afterFailure = outcomes.values.length
      fakeChokidar.instances[0]!.emit('all', 'change', blendPath)
      await expect(within(outcomes.next(
        (entry) => !('error' in entry),
        afterFailure,
      ))).resolves.toMatchObject({ scene: 'hero', action: 'skipped' })
      expect(starts).toEqual(['hero', 'hero'])
    } finally {
      await handle.close()
      syncControl.implementation = undefined
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('closes subscriptions immediately but waits for the active build to settle', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-watch-close-'))
    const blendPath = resolve(root, 'hero.blend')
    writeFileSync(blendPath, 'blend-v1')
    const config = resolveConfig({
      scenes: [{ file: 'hero.blend', name: 'hero', external: true }],
    }, root)
    const build = deferred<SyncOutcome>()
    const started = deferred<void>()
    const outcomes = outcomeLog()
    syncControl.implementation = vi.fn(() => build.promise)
    const handle = await watchScenes(config, outcomes.callback, {
      onStart: () => started.resolve(undefined),
    })

    try {
      fakeChokidar.instances[0]!.emit('all', 'change', blendPath)
      await within(started.promise)
      // This save is coalesced while the first build is active, then discarded
      // by close because the caller explicitly ended the watch session.
      fakeChokidar.instances[0]!.emit('all', 'change', blendPath)

      let closeFinished = false
      const closing = handle.close().then(() => { closeFinished = true })
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn))
      expect(fakeChokidar.instances[0]!.closed).toBe(true)
      expect(closeFinished).toBe(false)

      build.resolve({ scene: 'hero', action: 'skipped', durationMs: 1, warnings: [] })
      await within(closing)
      expect(closeFinished).toBe(true)
      expect(syncControl.implementation).toHaveBeenCalledTimes(1)
      expect(outcomes.values).toHaveLength(1)
    } finally {
      syncControl.implementation = undefined
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('schedules a scene when one of its declared inputs changes', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-watch-input-'))
    const blendPath = resolve(root, 'hero.blend')
    const inputPath = resolve(root, 'pipeline.json')
    writeFileSync(blendPath, 'blend-v1')
    writeFileSync(inputPath, '{"quality":"draft"}\n')
    const config = resolveConfig({
      scenes: [{
        file: 'hero.blend',
        name: 'hero',
        external: true,
        inputs: ['pipeline.json'],
      }],
    }, root)
    const outcomes = outcomeLog()
    const handle = await watchScenes(config, outcomes.callback)
    try {
      appendFileSync(inputPath, ' ')
      fakeChokidar.instances[0]!.emit('all', 'change', inputPath)
      await expect(within(outcomes.next((entry) => entry.scene === 'hero'))).resolves.toMatchObject({
        scene: 'hero',
        action: 'skipped',
      })
    } finally {
      await handle.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a named watch scoped to that scene and its inputs', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-watch-only-'))
    const heroBlend = resolve(root, 'hero.blend')
    const heroInput = resolve(root, 'hero.pipeline.json')
    const galleryBlend = resolve(root, 'gallery.blend')
    const galleryInput = resolve(root, 'gallery.pipeline.json')
    for (const path of [heroBlend, heroInput, galleryBlend, galleryInput]) {
      writeFileSync(path, 'fixture')
    }
    const config = resolveConfig({ scenes: [
      { file: 'hero.blend', name: 'hero', external: true, inputs: ['hero.pipeline.json'] },
      { file: 'gallery.blend', name: 'gallery', external: true, inputs: ['gallery.pipeline.json'] },
    ] }, root)

    const handle = await watchScenes(config, () => {}, { only: 'hero' })
    try {
      expect(fakeChokidar.instances[0]!.paths).toEqual(expect.arrayContaining([
        heroBlend,
        heroInput,
      ]))
      expect(fakeChokidar.instances[0]!.paths).not.toEqual(expect.arrayContaining([
        galleryBlend,
        galleryInput,
      ]))
    } finally {
      await handle.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reloads config, rebuilds its configured scenes, and watches their new inputs', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-watch-config-'))
    const configPath = resolve(root, 'blendlink.config.mjs')
    const firstInput = resolve(root, 'first.pipeline.json')
    const secondInput = resolve(root, 'second.pipeline.json')
    writeFileSync(resolve(root, 'hero.blend'), 'hero-v1')
    writeFileSync(resolve(root, 'gallery.blend'), 'gallery-v1')
    writeFileSync(firstInput, '{"quality":1}\n')
    writeFileSync(secondInput, '{"quality":2}\n')
    writeFileSync(configPath, `export default {
  scenes: [{ file: 'hero.blend', name: 'hero', external: true, inputs: ['first.pipeline.json'] }],
}\n`)

    const outcomes = outcomeLog()
    const handle = await watchScenes(await loadConfig(root), outcomes.callback)
    try {
      const beforeReload = outcomes.values.length
      writeFileSync(configPath, `export default {
  scenes: [{ file: 'gallery.blend', name: 'gallery', external: true, inputs: ['second.pipeline.json'] }],
}\n`)
      fakeChokidar.instances[0]!.emit('all', 'change', configPath)
      const reloaded = await within(outcomes.next(
        (entry) => entry.scene === 'gallery' && !('error' in entry),
        beforeReload,
      ))
      expect(reloaded).toMatchObject({ scene: 'gallery', action: 'skipped' })
      expect(fakeChokidar.instances).toHaveLength(2)
      expect(fakeChokidar.instances[1]!.paths).toContain(secondInput)
      expect(fakeChokidar.instances[1]!.paths).not.toContain(firstInput)

      const beforeInput = outcomes.values.length
      appendFileSync(secondInput, ' ')
      fakeChokidar.instances[1]!.emit('all', 'change', secondInput)
      await expect(within(outcomes.next(
        (entry) => entry.scene === 'gallery' && !('error' in entry),
        beforeInput,
      ))).resolves.toMatchObject({ scene: 'gallery', action: 'skipped' })
    } finally {
      await handle.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports invalid config and keeps the last working watch graph until recovery', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'blendlink-watch-recovery-'))
    const configPath = resolve(root, 'blendlink.config.mjs')
    writeFileSync(resolve(root, 'hero.blend'), 'hero-v1')
    writeFileSync(resolve(root, 'gallery.blend'), 'gallery-v1')
    writeFileSync(configPath, `export default {
  scenes: [{ file: 'hero.blend', name: 'hero', external: true }],
}\n`)

    const outcomes = outcomeLog()
    const handle = await watchScenes(await loadConfig(root), outcomes.callback)
    try {
      writeFileSync(configPath, `export default {
  unexpected: true,
  scenes: [{ file: 'hero.blend', name: 'hero', external: true }],
}\n`)
      fakeChokidar.instances[0]!.emit('all', 'change', configPath)
      await expect(within(outcomes.next(
        (entry) => 'error' in entry && entry.scene === 'blendlink.config',
      ))).resolves.toMatchObject({
        scene: 'blendlink.config',
        error: expect.stringMatching(/unknown config key "unexpected"/),
      })
      expect(fakeChokidar.instances[0]!.closed).toBe(false)

      const afterError = outcomes.values.length
      writeFileSync(configPath, `export default {
  scenes: [{ file: 'gallery.blend', name: 'gallery', external: true }],
}\n`)
      fakeChokidar.instances[0]!.emit('all', 'change', configPath)
      await expect(within(outcomes.next(
        (entry) => !('error' in entry) && entry.scene === 'gallery',
        afterError,
      ))).resolves.toMatchObject({ scene: 'gallery', action: 'skipped' })
      expect(fakeChokidar.instances[0]!.closed).toBe(true)
    } finally {
      await handle.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
