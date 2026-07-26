import { loadConfig } from './config.js'
import { syncAll, type SyncOutcome } from './sync.js'

/** Compile artist-authored Blender projects into deployable Three.js assets.
 * Bake mechanics, optimization, manifests, and type generation deliberately
 * remain behind this one public operation. */
export async function compileProject(options: {
  root?: string
  scene?: string
  quality?: 'preview' | 'final'
  force?: boolean
  allowNewerFile?: boolean
} = {}): Promise<SyncOutcome[]> {
  const config = await loadConfig(options.root ?? process.cwd())
  return syncAll(config, {
    ...(options.scene ? { only: options.scene } : {}),
    ...(options.quality === 'preview' ? { draft: true } : {}),
    ...(options.force ? { force: true } : {}),
    ...(options.allowNewerFile ? { allowNewerFile: true } : {}),
  })
}
