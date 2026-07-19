import chokidar from 'chokidar'
import { discoverBlender } from './discover.js'
import { syncScene, type SyncOutcome } from './sync.js'
import type { ResolvedConfig, ResolvedScene } from './config.js'

export interface WatchHandle {
  close(): Promise<void>
}

/**
 * Watch every configured .blend and re-sync on save.
 *
 * Blender saves atomically (write temp, rename, drop a .blend1 backup),
 * which emits event bursts that confuse naive watchers — hence
 * awaitWriteFinish plus a per-scene single-flight queue: a save that lands
 * mid-sync marks the scene dirty and re-runs once, never concurrently.
 */
export async function watchScenes(
  config: ResolvedConfig,
  onOutcome: (outcome: SyncOutcome | { scene: string; error: string }) => void,
  options: { draft?: boolean } = {},
): Promise<WatchHandle> {
  const blender = config.scenes.some((scene) => !scene.external)
    ? await discoverBlender(config.blenderPath)
    : ({ version: 'none', executable: '' } as Awaited<ReturnType<typeof discoverBlender>>)
  const byPath = new Map<string, ResolvedScene>(
    config.scenes.map((scene) => [normalize(scene.blendPath), scene]),
  )
  const inFlight = new Set<string>()
  const dirty = new Set<string>()

  const run = async (scene: ResolvedScene): Promise<void> => {
    if (inFlight.has(scene.name)) {
      dirty.add(scene.name)
      return
    }
    inFlight.add(scene.name)
    try {
      onOutcome(await syncScene(scene, blender, options))
    } catch (error) {
      onOutcome({
        scene: scene.name,
        error: error instanceof Error
          ? error.message
            + ((error as { detail?: { stderrTail?: string } }).detail?.stderrTail
              ? '\n--- Blender output tail ---\n'
                + (error as { detail?: { stderrTail?: string } }).detail!.stderrTail
              : '')
          : String(error),
      })
    } finally {
      inFlight.delete(scene.name)
      if (dirty.delete(scene.name)) void run(scene)
    }
  }

  const watcher = chokidar.watch(
    config.scenes.map((scene) => scene.blendPath),
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    },
  )
  watcher.on('change', (path) => {
    const scene = byPath.get(normalize(path))
    if (scene) void run(scene)
  })

  return {
    close: () => watcher.close(),
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}
