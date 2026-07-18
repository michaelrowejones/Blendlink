import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { discoverBlender, type BlenderInstall } from './discover.js'
import { exportBlend } from './invoke.js'
import { generateSceneModule, type SceneManifest } from './typegen.js'
import type { ResolvedConfig, ResolvedScene } from './config.js'

export interface SyncOutcome {
  scene: string
  action: 'exported' | 'skipped'
  durationMs: number
  stats?: SceneManifest['stats']
  warnings: string[]
}

/** Input-hash cache key: blend bytes + settings + Blender version. */
function sourceHash(scene: ResolvedScene, blenderVersion: string): string {
  return createHash('sha256')
    .update(readFileSync(scene.blendPath))
    .update(JSON.stringify(scene.settings))
    .update(blenderVersion)
    .digest('hex')
    .slice(0, 16)
}

function readManifest(path: string): SceneManifest | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SceneManifest
  } catch {
    return null
  }
}

export async function syncScene(
  scene: ResolvedScene,
  blender: BlenderInstall,
  options: { force?: boolean } = {},
): Promise<SyncOutcome> {
  const started = Date.now()
  const hash = sourceHash(scene, blender.version)
  const existing = readManifest(scene.manifestPath)
  if (
    !options.force &&
    existing?.sourceHash === hash &&
    existsSync(scene.glbPath) &&
    existsSync(scene.modulePath)
  ) {
    return { scene: scene.name, action: 'skipped', durationMs: Date.now() - started, warnings: [] }
  }

  const exported = await exportBlend({
    blendPath: scene.blendPath,
    outPath: scene.glbPath,
    settings: scene.settings,
    blender,
  })

  const { manifest, module } = await generateSceneModule({
    glbPath: scene.glbPath,
    url: scene.url,
    exportName: scene.name,
    sourceBlend: scene.blendPath,
    sourceHash: hash,
  })
  manifest.blendBytesHash = createHash('sha256')
    .update(readFileSync(scene.blendPath))
    .digest('hex')
    .slice(0, 16)
  mkdirSync(dirname(scene.manifestPath), { recursive: true })
  writeFileSync(scene.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(scene.modulePath, module)

  return {
    scene: scene.name,
    action: 'exported',
    durationMs: Date.now() - started,
    stats: manifest.stats,
    warnings: exported.warnings,
  }
}

export async function syncAll(
  config: ResolvedConfig,
  options: { force?: boolean; only?: string } = {},
): Promise<SyncOutcome[]> {
  const blender = await discoverBlender(config.blenderPath)
  const scenes = options.only
    ? config.scenes.filter((scene) => scene.name === options.only)
    : config.scenes
  if (options.only && scenes.length === 0) {
    throw new Error(`No scene named "${options.only}" in blendlink.config.`)
  }
  const outcomes: SyncOutcome[] = []
  for (const scene of scenes) {
    outcomes.push(await syncScene(scene, blender, options))
  }
  return outcomes
}

export interface VerifyIssue {
  scene: string
  problem: string
  fix: string
}

/** Blender-free drift check for CI: sources vs committed artifacts. */
export async function verifyAll(config: ResolvedConfig): Promise<VerifyIssue[]> {
  const issues: VerifyIssue[] = []
  for (const scene of config.scenes) {
    const manifest = readManifest(scene.manifestPath)
    if (!manifest) {
      issues.push({
        scene: scene.name,
        problem: `missing generated manifest (${scene.manifestPath})`,
        fix: 'Run `blendlink sync` and commit the generated files.',
      })
      continue
    }
    if (!existsSync(scene.glbPath)) {
      issues.push({
        scene: scene.name,
        problem: `GLB missing from ${scene.glbPath} but listed in the manifest`,
        fix: 'This file should be committed — check .gitignore for *.glb, or run `blendlink sync`.',
      })
      continue
    }
    const glbHash = createHash('sha256')
      .update(readFileSync(scene.glbPath))
      .digest('hex')
      .slice(0, 16)
    if (glbHash !== manifest.hash) {
      issues.push({
        scene: scene.name,
        problem: 'GLB on disk does not match the manifest hash',
        fix: 'Run `blendlink sync` and commit source + artifacts together.',
      })
    }
    // Source drift needs the same Blender-version salt; without Blender we
    // can only compare blend bytes when the recorded hash used this salt —
    // so recompute against every hash component we can and flag byte drift.
    if (manifest.sourceHash && existsSync(scene.blendPath)) {
      const blendBytesHash = createHash('sha256')
        .update(readFileSync(scene.blendPath))
        .digest('hex')
        .slice(0, 16)
      const manifestBlendHash = (manifest as SceneManifest & { blendBytesHash?: string })
        .blendBytesHash
      if (manifestBlendHash && manifestBlendHash !== blendBytesHash) {
        issues.push({
          scene: scene.name,
          problem: `${scene.blendPath} changed after the last sync`,
          fix: 'Run `blendlink sync` (requires Blender) and commit the regenerated artifacts.',
        })
      }
    }
  }
  return issues
}
