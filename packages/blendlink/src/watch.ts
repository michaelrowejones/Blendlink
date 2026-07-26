import { existsSync } from 'node:fs'
import { join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { loadConfig, type ResolvedConfig, type ResolvedScene } from './config.js'
import { discoverBlender, type BlenderInstall } from './discover.js'
import { syncScene, type SyncOutcome } from './sync.js'

export interface WatchHandle {
  /** Stop accepting changes, discard queued reruns, and await active builds. */
  close(): Promise<void>
}

export interface WatchOptions {
  draft?: boolean
  /** Surface source-look/World warnings for Blendlink's private viewer. */
  authoringPreview?: boolean
  allowNewerFile?: boolean
  /** Keep `compile sceneName --watch` scoped to the scene the artist chose. */
  only?: string
  /**
   * Subscribe first, then bring every selected scene current before returning.
   * A failure during this startup phase rejects watchScenes and closes the
   * subscription; later failures are reported through onOutcome and recover.
   */
  initialBuild?: 'if-needed' | 'force'
  /** Private Preview Studio keeps its shell and watcher alive when the first
   * saved revision is invalid. The artist can then fix the scene and save
   * again without restarting Preview. Ordinary compile/watch callers retain
   * the fail-fast default. */
  initialBuildFailure?: 'reject' | 'report'
  /** Report every actual sync attempt, including initial and queued reruns. */
  onStart?: (scene: string) => void
}

type WatchOutcome = SyncOutcome | { scene: string; error: string }

const WATCH_OPTIONS = {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
} as const

/**
 * Watch every selected .blend and declared extra input, then re-sync its
 * owning scene. Config changes are validated and installed atomically: an
 * invalid edit is reported while the last working dependency graph remains
 * live; a valid edit swaps paths before affected scenes rebuild.
 *
 * Blender and text editors commonly save through temp-file replacement,
 * which emits event bursts. Per-scene single flight coalesces those bursts:
 * a change that lands mid-sync marks the scene dirty and re-runs once, never
 * concurrently. A forced config rebuild is never weakened by a later event.
 */
export async function watchScenes(
  initialConfig: ResolvedConfig,
  onOutcome: (outcome: WatchOutcome) => void,
  options: WatchOptions = {},
): Promise<WatchHandle> {
  const configRoot = initialConfig.root
  const configPaths = [
    join(configRoot, 'blendlink.config.mjs'),
    join(configRoot, 'blendlink.config.js'),
  ]
  const normalizedConfigPaths = new Set(configPaths.map(normalize))
  let currentConfig = initialConfig
  let currentScenes = selectedScenes(initialConfig, options.only)
  let currentBlender = await blenderFor(initialConfig, currentScenes)
  let watcher: FSWatcher | null = null
  let closed = false

  const inFlight = new Map<string, Promise<void>>()
  const dirty = new Map<string, boolean>()

  const reportError = (scene: string, error: unknown): void => {
    onOutcome({ scene, error: errorText(error) })
  }

  const run = (name: string, force = false, rejectOnError = false): Promise<void> => {
    if (!currentScenes.has(name) || closed) return Promise.resolve()
    const active = inFlight.get(name)
    if (active) {
      dirty.set(name, (dirty.get(name) ?? false) || force)
      return active
    }

    const task = Promise.resolve().then(async () => {
      let nextForce = force
      while (!closed) {
        dirty.delete(name)
        const scene = currentScenes.get(name)
        if (!scene) return
        options.onStart?.(name)
        try {
          onOutcome(await syncScene(scene, currentBlender, {
            ...(nextForce ? { force: true } : {}),
            ...(options.draft ? { draft: true } : {}),
            ...(options.authoringPreview ? { authoringPreview: true } : {}),
            ...(options.allowNewerFile ? { allowNewerFile: true } : {}),
          }))
        } catch (error) {
          reportError(name, error)
          if (rejectOnError) throw error
        }
        const rerunForced = dirty.get(name)
        if (rerunForced === undefined) return
        nextForce = rerunForced
      }
    }).finally(() => {
      inFlight.delete(name)
    })
    inFlight.set(name, task)
    return task
  }

  let configReloading = false
  let configDirty = false
  const configDependencyTriggers = new Set<string>()

  const reloadConfig = async (dependencyScenes: readonly string[] = []): Promise<void> => {
    for (const name of dependencyScenes) configDependencyTriggers.add(name)
    if (configReloading) {
      configDirty = true
      return
    }
    configReloading = true
    try {
      do {
        configDirty = false
        try {
          const nextConfig = await loadConfig(configRoot)
          const nextScenes = selectedScenes(nextConfig, options.only)
          const nextBlender = await blenderFor(nextConfig, nextScenes)
          const nextWatcher = await createWatcher(nextScenes)
          if (closed) {
            await nextWatcher.close()
            return
          }

          const previousConfig = currentConfig
          const previousScenes = currentScenes
          const previousWatcher = watcher
          currentConfig = nextConfig
          currentScenes = nextScenes
          currentBlender = nextBlender
          watcher = nextWatcher
          if (previousWatcher) await previousWatcher.close()

          const explicitlyTriggered = new Set(configDependencyTriggers)
          configDependencyTriggers.clear()
          for (const [name, scene] of nextScenes) {
            const previous = previousScenes.get(name)
            const blenderChanged = !scene.external &&
              previousConfig.blenderPath !== nextConfig.blenderPath
            if (
              explicitlyTriggered.has(name) ||
              blenderChanged ||
              !previous ||
              sceneSignature(previous) !== sceneSignature(scene)
            ) {
              void run(name, true)
            }
          }
        } catch (error) {
          reportError('blendlink.config', error)
        }
      } while (configDirty && !closed)
    } finally {
      configReloading = false
    }
  }

  async function createWatcher(scenes: Map<string, ResolvedScene>): Promise<FSWatcher> {
    const byPath = dependenciesByPath(scenes.values())
    const presentConfigPaths = configPaths.filter((path) => existsSync(path))
    const absentConfigPaths = configPaths.filter((path) => !existsSync(path))
    const paths = [...new Set([
      // Lead with a real config path. Chokidar can otherwise complete an
      // all-missing initial subscription without attaching its siblings.
      ...presentConfigPaths,
      ...[...scenes.values()].flatMap(
        (scene) => [scene.blendPath, ...(scene.inputs ?? [])],
      ),
      ...absentConfigPaths,
    ])]
    const nextWatcher = chokidar.watch(paths, WATCH_OPTIONS)
    nextWatcher.on('all', (event, path) => {
      if (event !== 'add' && event !== 'change' && event !== 'unlink') return
      const key = normalize(path)
      const dependentScenes = byPath.get(key) ?? []
      if (normalizedConfigPaths.has(key)) {
        void reloadConfig(dependentScenes)
        return
      }
      for (const name of dependentScenes) void run(name)
    })
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        let ready = false
        nextWatcher.once('ready', () => {
          ready = true
          resolveReady()
        })
        nextWatcher.on('error', (error) => {
          if (!ready) rejectReady(error)
          else reportError('watch', error)
        })
      })
      // Chokidar's `ready` means the initial scan is complete. Yield once so
      // the platform watcher registrations behind that scan are also live
      // before callers can immediately save after the CLI prints "watching".
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn))
      return nextWatcher
    } catch (error) {
      await nextWatcher.close()
      throw error
    }
  }

  watcher = await createWatcher(currentScenes)
  if (options.initialBuild) {
    try {
      await Promise.all([...currentScenes.keys()].map((name) =>
        run(
          name,
          options.initialBuild === 'force',
          options.initialBuildFailure !== 'report',
        )))
    } catch (error) {
      closed = true
      dirty.clear()
      const active = watcher
      watcher = null
      if (active) await active.close()
      await Promise.allSettled([...inFlight.values()])
      throw error
    }
  }

  return {
    async close() {
      closed = true
      dirty.clear()
      const active = watcher
      watcher = null
      if (active) await active.close()
      await Promise.allSettled([...inFlight.values()])
    },
  }
}

function selectedScenes(config: ResolvedConfig, only?: string): Map<string, ResolvedScene> {
  const scenes = only
    ? config.scenes.filter((scene) => scene.name === only)
    : config.scenes
  if (only && scenes.length === 0) {
    throw new Error(`No scene named "${only}" in blendlink.config.`)
  }
  return new Map(scenes.map((scene) => [scene.name, scene]))
}

async function blenderFor(
  config: ResolvedConfig,
  scenes: Map<string, ResolvedScene>,
): Promise<BlenderInstall> {
  return [...scenes.values()].some((scene) => !scene.external)
    ? discoverBlender(config.blenderPath)
    : { version: 'none', executable: '', semver: [0, 0, 0] }
}

function dependenciesByPath(scenes: Iterable<ResolvedScene>): Map<string, string[]> {
  const byPath = new Map<string, string[]>()
  for (const scene of scenes) {
    for (const path of [scene.blendPath, ...(scene.inputs ?? [])]) {
      const key = normalize(path)
      const names = byPath.get(key) ?? []
      if (!names.includes(scene.name)) names.push(scene.name)
      byPath.set(key, names)
    }
  }
  return byPath
}

function sceneSignature(scene: ResolvedScene): string {
  return JSON.stringify(scene)
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const stderrTail = (error as { detail?: { stderrTail?: string } }).detail?.stderrTail
  return error.message + (stderrTail
    ? '\n--- Blender output tail ---\n' + stderrTail
    : '')
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}
