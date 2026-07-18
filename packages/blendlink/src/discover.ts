import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface BlenderInstall {
  executable: string
  version: string
  /** [major, minor, patch] parsed from `--version`. */
  semver: [number, number, number]
}

/** Reasons discovery can fail, surfaced verbatim to the user. */
export class BlenderNotFoundError extends Error {}

function windowsCandidates(): string[] {
  const candidates: string[] = []
  for (const programFiles of [
    process.env['ProgramFiles'] ?? 'C:/Program Files',
    process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
  ]) {
    const foundation = join(programFiles, 'Blender Foundation')
    if (!existsSync(foundation)) continue
    // One directory per minor version ("Blender 5.2"); prefer the newest.
    const versions = readdirSync(foundation)
      .filter((name) => name.startsWith('Blender'))
      .sort()
      .reverse()
    for (const dir of versions) {
      candidates.push(join(foundation, dir, 'blender.exe'))
    }
  }
  candidates.push(
    'C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe',
  )
  return candidates
}

function posixCandidates(): string[] {
  return [
    '/Applications/Blender.app/Contents/MacOS/Blender',
    '/opt/homebrew/bin/blender',
    '/usr/local/bin/blender',
    '/opt/local/bin/blender',
    '/usr/bin/blender',
    '/snap/bin/blender',
    '/var/lib/flatpak/exports/bin/org.blender.Blender',
  ]
}

async function probe(executable: string): Promise<BlenderInstall | null> {
  try {
    const { stdout } = await execFileAsync(executable, ['--version'], {
      timeout: 15_000,
      windowsHide: true,
    })
    const match = stdout.match(/Blender (\d+)\.(\d+)\.(\d+)/)
    if (!match) return null
    return {
      executable,
      version: stdout.split('\n')[0]?.trim() ?? match[0],
      semver: [Number(match[1]), Number(match[2]), Number(match[3])],
    }
  } catch {
    return null
  }
}

/**
 * Find Blender: explicit setting → BLENDLINK_BLENDER env → platform paths →
 * PATH. Every candidate is confirmed with `--version` (~130ms) because paths
 * lie (shims, symlinks, uninstalled leftovers).
 */
export async function discoverBlender(explicitPath?: string): Promise<BlenderInstall> {
  const candidates: string[] = []
  if (explicitPath) candidates.push(explicitPath)
  if (process.env['BLENDLINK_BLENDER']) candidates.push(process.env['BLENDLINK_BLENDER'])
  candidates.push(
    ...(process.platform === 'win32' ? windowsCandidates() : posixCandidates()),
  )
  candidates.push(process.platform === 'win32' ? 'blender.exe' : 'blender')

  for (const candidate of candidates) {
    if (candidate.includes('WindowsApps')) continue // Store sandbox: unusable for CLI
    const install = await probe(candidate)
    if (install) return install
  }
  throw new BlenderNotFoundError(
    'Blender was not found. Install it from blender.org (not the Microsoft ' +
      'Store), or point blendlink at it with the BLENDLINK_BLENDER ' +
      'environment variable or the blenderPath config option.',
  )
}
