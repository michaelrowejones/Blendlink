import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { BlenderUnsupportedVersionError, discoverBlender } from './discover.js'
import {
  bundledBlenderAddonFingerprint,
  bundledBlenderAddonVersion,
  inspectBlenderAddon,
} from './addon.js'
import { loadConfig, type ResolvedConfig } from './config.js'
import { parseManifest, type SceneManifest } from './typegen.js'
import { findKtxTool, KTX_SOFTWARE_URL } from './textureCompression.js'
import { loadBlenderKnownIssueRegistry, matchingBlenderKnownIssues } from './knownIssues.js'

export interface DoctorLine {
  level: 'ok' | 'warn' | 'fail'
  message: string
}

const hash16 = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)

export function supportedNodeVersion(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return (major === 22 && minor >= 15) || major === 24
}

function readManifest(path: string): SceneManifest | null {
  try {
    return parseManifest(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error instanceof Error && error.message.includes('schemaVersion')) {
      console.warn(`! ${path}: ${error.message}`)
    }
    return null
  }
}

/** Environment + project health in one pass. Never throws; reports instead. */
export async function doctor(root: string): Promise<DoctorLine[]> {
  const lines: DoctorLine[] = []
  const ok = (message: string) => lines.push({ level: 'ok', message })
  const warn = (message: string) => lines.push({ level: 'warn', message })
  const fail = (message: string) => lines.push({ level: 'fail', message })

  if (supportedNodeVersion(process.versions.node)) ok(`node ${process.version}`)
  else fail(
    `node ${process.version} is outside Blendlink's tested Node 22.15+ / 24 release lines; ` +
      'switch to a supported LTS runtime before publishing',
  )
  const ktx = findKtxTool()
  if (ktx) ok(`KTX-Software ${ktx.version} — semantic GPU texture compression ready`)
  else warn(`KTX-Software not found — only required for KTX2 GPU textures; install from ${KTX_SOFTWARE_URL}`)

  // Git Bash converts leading-slash args (--url /models/x) into
  // C:/Program Files/Git/... paths — a classic silent corruption on Windows.
  if (process.platform === 'win32' && process.env.MSYSTEM) {
    warn(
      'running under Git Bash (MSYS) — leading-slash arguments like `--url /models/x` get rewritten to C:/Program Files/Git/... Use PowerShell/cmd, or set MSYS_NO_PATHCONV=1.',
    )
  }

  let blenderExecutable: string | null = null
  try {
    const install = await discoverBlender()
    blenderExecutable = install.executable
    try {
      const knownIssues = matchingBlenderKnownIssues(
        install.semver,
        loadBlenderKnownIssueRegistry(),
      )
      for (const issue of knownIssues) {
        const message =
          `Blender ${install.semver.join('.')} known issue ${issue.id}: ${issue.summary} ` +
          `Action: ${issue.action} Evidence: ${issue.evidence[0]}`
        if (issue.severity === 'block') fail(message)
        else warn(message)
      }
    } catch (error) {
      fail(
        'Blender known-issue registry is invalid or missing; reinstall Blendlink: ' +
          (error instanceof Error ? error.message : String(error)),
      )
    }
    ok(`${install.version} — ${install.executable}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof BlenderUnsupportedVersionError) {
      fail(`${message} Sync and publishing are blocked until Blender is upgraded.`)
    } else {
      warn(
        `Blender not found (${message}) — sync needs it; verify and typegen work without it`,
      )
    }
  }


  if (blenderExecutable) {
    try {
      const expected = bundledBlenderAddonVersion()
      const expectedFingerprint = bundledBlenderAddonFingerprint()
      const status = inspectBlenderAddon(blenderExecutable)
      const catalog =
        `${status.sceneEffectCount ?? 'unknown'} scene effects / ` +
        `${status.objectBehaviorCount ?? 'unknown'} object behaviors` +
        `${status.catalogPath ? ` at ${status.catalogPath}` : ''}`
      if (status.error) {
        fail(`Blendlink artist workspace inspection failed: ${status.error}; run \`blendlink addon install\``)
      } else if (!status.installed) {
        warn('Blendlink artist workspace not installed — run `blendlink addon install`')
      } else if (status.version !== expected) {
        fail(
          `Blendlink addon ${status.version ?? 'unknown'} does not match compiler ${expected}; ` +
            'run `blendlink addon install`',
        )
      } else if (status.fingerprint !== expectedFingerprint) {
        fail(
          `Blendlink addon ${expected} files do not match this compiler bundle ` +
            `(installed ${status.fingerprint?.slice(0, 16) ?? 'unknown'}, ` +
            `expected ${expectedFingerprint.slice(0, 16)}; catalog ${catalog}); ` +
            'run `blendlink addon install`',
        )
      } else if (!status.enabled) {
        warn(`Blendlink addon ${expected} is installed but disabled — run \`blendlink addon install\``)
      } else {
        ok(
          `Blendlink addon ${expected} installed and enabled ` +
            `(${status.path ?? 'user_default'}; catalog ${catalog}; ` +
            `files ${expectedFingerprint.slice(0, 16)})`,
        )
      }
    } catch (error) {
      fail(
        'Could not verify the Blendlink artist workspace: ' +
          (error instanceof Error ? error.message : String(error)),
      )
    }
  }

  let config: ResolvedConfig | null = null
  try {
    config = await loadConfig(root)
    ok(`blendlink.config: ${config.scenes.length} scene(s)`)
  } catch (error) {
    fail(`config: ${error instanceof Error ? error.message : error}`)
  }

  for (const scene of config?.scenes ?? []) {
    const label = scene.external ? `${scene.name} (external)` : scene.name
    if (!existsSync(scene.blendPath)) {
      fail(`${label}: .blend missing at ${scene.blendPath}`)
      continue
    }
    const manifest = readManifest(scene.manifestPath)
    if (!manifest) {
      warn(`${label}: never synced — run \`blendlink compile\``)
      continue
    }
    if (!existsSync(scene.glbPath)) {
      fail(`${label}: GLB missing (${scene.glbPath}) — check .gitignore for *.glb`)
      continue
    }
    if (manifest.blendBytesHash && manifest.blendBytesHash !== hash16(scene.blendPath)) {
      const fix = scene.external
        ? (scene.build ?? 'your export pipeline + typegen --blend')
        : 'blendlink compile'
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

  return lines
}
