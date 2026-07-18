import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { discoverBlender } from './discover.js'
import { loadConfig, type ResolvedConfig } from './config.js'
import type { SceneManifest } from './typegen.js'

export interface DoctorLine {
  level: 'ok' | 'warn' | 'fail'
  message: string
}

const hash16 = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)

function readManifest(path: string): SceneManifest | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SceneManifest
  } catch {
    return null
  }
}

/** Environment + project health in one pass. Never throws; reports instead. */
export async function doctor(root: string): Promise<DoctorLine[]> {
  const lines: DoctorLine[] = []
  const ok = (message: string) => lines.push({ level: 'ok', message })
  const warn = (message: string) => lines.push({ level: 'warn', message })
  const fail = (message: string) => lines.push({ level: 'fail', message })

  ok(`node ${process.version}`)

  // Git Bash converts leading-slash args (--url /models/x) into
  // C:/Program Files/Git/... paths — a classic silent corruption on Windows.
  if (process.platform === 'win32' && process.env.MSYSTEM) {
    warn(
      'running under Git Bash (MSYS) — leading-slash arguments like `--url /models/x` get rewritten to C:/Program Files/Git/... Use PowerShell/cmd, or set MSYS_NO_PATHCONV=1.',
    )
  }

  let blenderVersion: string | null = null
  try {
    const install = await discoverBlender()
    blenderVersion = install.version
    ok(`${install.version} — ${install.executable}`)
  } catch (error) {
    warn(
      `Blender not found (${error instanceof Error ? error.message : error}) — sync needs it; verify and typegen work without it`,
    )
  }

  let config: ResolvedConfig | null = null
  try {
    config = await loadConfig(root)
    ok(`blendlink.config: ${config.scenes.length} scene(s)`)
  } catch (error) {
    fail(`config: ${error instanceof Error ? error.message : error}`)
    return lines
  }

  for (const scene of config.scenes) {
    const label = scene.external ? `${scene.name} (external)` : scene.name
    if (!existsSync(scene.blendPath)) {
      fail(`${label}: .blend missing at ${scene.blendPath}`)
      continue
    }
    const manifest = readManifest(scene.manifestPath)
    if (!manifest) {
      warn(`${label}: never synced — run \`blendlink sync\``)
      continue
    }
    if (!existsSync(scene.glbPath)) {
      fail(`${label}: GLB missing (${scene.glbPath}) — check .gitignore for *.glb`)
      continue
    }
    if (manifest.blendBytesHash && manifest.blendBytesHash !== hash16(scene.blendPath)) {
      const fix = scene.external
        ? (scene.build ?? 'your export pipeline + typegen --blend')
        : 'blendlink sync'
      warn(`${label}: .blend changed since last sync — run \`${fix}\``)
      continue
    }
    if (hash16(scene.glbPath) !== manifest.hash) {
      warn(`${label}: GLB on disk does not match the manifest — re-run the export`)
      continue
    }
    ok(`${label}: in sync`)
    if (scene.external && !scene.build) {
      warn(`${label}: no \`build\` command in the config — sync cannot rebuild it for you`)
    }
  }

  // Companion addon (best effort — path layout is stable across 4.2+).
  if (process.platform === 'win32' && blenderVersion) {
    const short = blenderVersion.match(/(\d+\.\d+)/)?.[1]
    if (short) {
      const addonDir = join(
        process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
        'Blender Foundation', 'Blender', short, 'extensions', 'user_default', 'blendlink',
      )
      if (existsSync(addonDir)) {
        ok(`Blender addon installed (${addonDir})`)
      } else {
        warn(
          'Blender companion addon not installed — build it from packages/blender-addon for in-viewport tagging, lint, and sync status',
        )
      }
    }
  }

  return lines
}
