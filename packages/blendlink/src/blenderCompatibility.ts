import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type BlenderVersion = readonly [number, number, number]

const moduleDirectory = dirname(fileURLToPath(import.meta.url))

function bundledAddonManifestPath(): string {
  const candidates = [
    join(moduleDirectory, 'addon', 'blender_manifest.toml'),
    join(moduleDirectory, '..', '..', 'blender-addon', 'blender_manifest.toml'),
  ]
  const path = candidates.find(existsSync)
  if (!path) {
    throw new Error(
      `The bundled Blendlink addon manifest is missing (checked ${candidates.join(', ')})`,
    )
  }
  return path
}

export function parseBlenderVersion(
  value: unknown,
  field = 'Blender version',
): BlenderVersion {
  if (typeof value !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(
      `${field} must be a numeric Blender version such as 4.2 or 5.1.1`,
    )
  }
  const parts = value.split('.').map(Number)
  return [parts[0]!, parts[1]!, parts[2] ?? 0]
}

export function compareBlenderVersions(
  left: BlenderVersion,
  right: BlenderVersion,
): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return 0
}

export function formatBlenderVersion(version: BlenderVersion): string {
  return version.join('.')
}

/**
 * The Blender extension manifest is the release contract for both Blender's
 * installer and the Node compiler. Reading it here prevents those two entry
 * points from quietly acquiring different compatibility floors.
 */
export function minimumSupportedBlenderVersion(): BlenderVersion {
  const path = bundledAddonManifestPath()
  const manifest = readFileSync(path, 'utf8')
  const value = manifest.match(/^blender_version_min\s*=\s*"([^"]+)"/m)?.[1]
  if (!value) {
    throw new Error(
      `The bundled Blendlink addon manifest has no blender_version_min: ${path}`,
    )
  }
  return parseBlenderVersion(value, 'blender_version_min')
}

export function isSupportedBlenderVersion(
  version: BlenderVersion,
  minimum = minimumSupportedBlenderVersion(),
): boolean {
  return compareBlenderVersions(version, minimum) >= 0
}
