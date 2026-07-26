import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  formatBlenderVersion,
  isSupportedBlenderVersion,
  minimumSupportedBlenderVersion,
  type BlenderVersion,
} from './blenderCompatibility.js'

const execFileAsync = promisify(execFile)

export interface BlenderInstall {
  executable: string
  version: string
  /** [major, minor, patch] parsed from `--version`. */
  semver: [number, number, number]
}

/** Reasons discovery can fail, surfaced verbatim to the user. */
export class BlenderNotFoundError extends Error {}

/** Blender was found, but every usable installation predates our contract. */
export class BlenderUnsupportedVersionError extends Error {
  constructor(
    readonly installs: readonly BlenderInstall[],
    readonly minimum: BlenderVersion,
  ) {
    const found = installs
      .map((install) => `${formatBlenderVersion(install.semver)} at ${install.executable}`)
      .join('; ')
    const minimumLabel = formatBlenderVersion(minimum)
    super(
      `Blendlink requires Blender ${minimumLabel} or newer. ` +
        `Found only unsupported Blender installation${installs.length === 1 ? '' : 's'}: ${found}. ` +
        `Install Blender ${minimum[0]}.${minimum[1]}+ from blender.org (not the Microsoft Store), ` +
        'or point Blendlink at a supported installation with BLENDLINK_BLENDER or blenderPath.',
    )
    this.name = 'BlenderUnsupportedVersionError'
  }
}

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

type BlenderProbe = (executable: string) => Promise<BlenderInstall | null>

export interface BlenderDiscoveryCandidate {
  executable: string
  source: 'blenderPath' | 'BLENDLINK_BLENDER' | 'automatic'
}

/** Deterministic discovery core; the platform candidate list is only an adapter. */
export async function discoverBlenderFromCandidates(
  candidates: readonly BlenderDiscoveryCandidate[],
  probeCandidate: BlenderProbe = probe,
): Promise<BlenderInstall> {
  const minimum = minimumSupportedBlenderVersion()
  const unsupported: BlenderInstall[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    if (
      seen.has(candidate.executable) ||
      candidate.executable.includes('WindowsApps')
    ) continue
    seen.add(candidate.executable)
    const install = await probeCandidate(candidate.executable)
    if (!install) continue
    if (isSupportedBlenderVersion(install.semver, minimum)) return install
    if (candidate.source !== 'automatic') {
      throw new BlenderUnsupportedVersionError([install], minimum)
    }
    unsupported.push(install)
  }

  if (unsupported.length > 0) {
    throw new BlenderUnsupportedVersionError(unsupported, minimum)
  }
  throw new BlenderNotFoundError(
    'Blender was not found. Install it from blender.org (not the Microsoft ' +
      'Store), or point blendlink at it with the BLENDLINK_BLENDER ' +
      'environment variable or the blenderPath config option.',
  )
}

/**
 * Find Blender: explicit setting → BLENDLINK_BLENDER env → platform paths →
 * PATH. Every candidate is confirmed with `--version` (~130ms) because paths
 * lie (shims, symlinks, uninstalled leftovers).
 */
export async function discoverBlender(explicitPath?: string): Promise<BlenderInstall> {
  const candidates: BlenderDiscoveryCandidate[] = []
  if (explicitPath) candidates.push({ executable: explicitPath, source: 'blenderPath' })
  if (process.env['BLENDLINK_BLENDER']) {
    candidates.push({
      executable: process.env['BLENDLINK_BLENDER'],
      source: 'BLENDLINK_BLENDER',
    })
  }
  candidates.push(...(
    process.platform === 'win32' ? windowsCandidates() : posixCandidates()
  ).map((executable) => ({ executable, source: 'automatic' as const })))
  candidates.push({
    executable: process.platform === 'win32' ? 'blender.exe' : 'blender',
    source: 'automatic',
  })

  return discoverBlenderFromCandidates(candidates)
}
