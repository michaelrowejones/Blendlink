import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'

const LOCAL_PROVENANCE_SCHEMA_VERSION = 1 as const
const LOCAL_PATH_KEY = /^[a-f0-9]{64}$/

export interface GeneratedExternalDependency {
  path: string
  relativeToBlend: boolean
  exists: boolean
  bytes: number
  hash: string | null
  volatile: boolean
  reachable?: false
  reachabilityReason?: 'unbound-material'
  /** Additive public locator: resolve `path` from the configured project root. */
  projectRelative?: true
  /** Additive private locator: `path` is opaque and the exact filesystem path
   * lives only in the current user's cache. Missing cache state fails stale. */
  localPathKey?: string
}

export interface LocalPathProvenance {
  key: string
  absolutePath: string
}

export interface PreparedGeneratedProvenance {
  sourceBlend?: string
  sourceBlendLocalPathKey?: string
  externalDependencies: GeneratedExternalDependency[]
  localPaths: LocalPathProvenance[]
}

function portablePath(path: string): string {
  return path.split(sep).join('/')
}

function canonicalLocalPath(path: string): string {
  const absolute = resolve(path)
  const portable = absolute.replace(/\\/g, '/')
  return process.platform === 'win32' ? portable.toLowerCase() : portable
}

export function localPathProvenanceKey(path: string): string {
  return createHash('sha256')
    .update('blendlink-local-path-v1\0')
    .update(canonicalLocalPath(path))
    .digest('hex')
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function addPrivatePath(
  output: Map<string, LocalPathProvenance>,
  absolutePath: string,
): { path: string; localPathKey: string } {
  const exact = resolve(absolutePath)
  const key = localPathProvenanceKey(exact)
  output.set(key, { key, absolutePath: exact })
  return { path: `external/${key}`, localPathKey: key }
}

/** Build the commit-safe half of generated provenance while returning exact
 * local paths separately. This is the single seam for every generated module
 * and manifest: callers never need to know path redaction rules. */
export function prepareGeneratedProvenance(options: {
  projectRoot: string
  sourceBlend?: string
  externalDependencies?: readonly GeneratedExternalDependency[]
}): PreparedGeneratedProvenance {
  const projectRoot = resolve(options.projectRoot)
  const localPaths = new Map<string, LocalPathProvenance>()
  let sourceBlend: string | undefined
  let sourceBlendLocalPathKey: string | undefined
  const absoluteSource = options.sourceBlend
    ? isAbsolute(options.sourceBlend)
      ? resolve(options.sourceBlend)
      : resolve(projectRoot, options.sourceBlend)
    : undefined

  if (absoluteSource) {
    if (isInside(projectRoot, absoluteSource)) {
      sourceBlend = portablePath(relative(projectRoot, absoluteSource))
    } else {
      const privateSource = addPrivatePath(localPaths, absoluteSource)
      sourceBlend = privateSource.path
      sourceBlendLocalPathKey = privateSource.localPathKey
    }
  }

  const externalDependencies = (options.externalDependencies ?? []).map((dependency) => {
    // Sidecars are compiler inputs, not a trust boundary. Remove any stale
    // generated locators before deriving exactly one locator from source
    // paths again.
    const cleanDependency = { ...dependency }
    delete cleanDependency.projectRelative
    delete cleanDependency.localPathKey

    const dependencyIsAbsolute = isAbsolute(dependency.path)
    if (dependency.relativeToBlend && !dependencyIsAbsolute) {
      if (!absoluteSource) {
        throw new Error(
          `Blendlink cannot resolve relative Blender dependency ${JSON.stringify(dependency.path)} ` +
            'without sourceBlend; regenerate it from the Blender export.',
        )
      }
      const blendDirectory = dirname(absoluteSource)
      const absolute = resolve(blendDirectory, dependency.path)
      if (isInside(projectRoot, absolute) && isInside(blendDirectory, absolute)) {
        return {
          ...cleanDependency,
          path: portablePath(relative(blendDirectory, absolute)),
        }
      }
      if (isInside(projectRoot, absolute)) {
        return {
          ...cleanDependency,
          path: portablePath(relative(projectRoot, absolute)),
          relativeToBlend: false,
          projectRelative: true as const,
        }
      }
      return {
        ...cleanDependency,
        ...addPrivatePath(localPaths, absolute),
        relativeToBlend: false,
      }
    }
    const absolute = dependencyIsAbsolute
      ? resolve(dependency.path)
      : resolve(projectRoot, dependency.path)
    if (isInside(projectRoot, absolute)) {
      return {
        ...cleanDependency,
        path: portablePath(relative(projectRoot, absolute)),
        relativeToBlend: false,
        projectRelative: true as const,
      }
    }
    return {
      ...cleanDependency,
      ...addPrivatePath(localPaths, absolute),
      relativeToBlend: false,
    }
  })

  return {
    ...(sourceBlend ? { sourceBlend } : {}),
    ...(sourceBlendLocalPathKey ? { sourceBlendLocalPathKey } : {}),
    externalDependencies,
    localPaths: [...localPaths.values()].sort((a, b) => a.key.localeCompare(b.key)),
  }
}

export function defaultLocalProvenanceCacheRoot(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    return localAppData
      ? join(localAppData, 'Blendlink', 'Cache', 'local-provenance-v1')
      : join(homedir(), 'AppData', 'Local', 'Blendlink', 'Cache', 'local-provenance-v1')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'blendlink', 'local-provenance-v1')
  }
  return join(
    process.env.XDG_CACHE_HOME || join(homedir(), '.cache'),
    'blendlink',
    'local-provenance-v1',
  )
}

function cacheFile(key: string, cacheRoot: string): string | null {
  return LOCAL_PATH_KEY.test(key) ? join(cacheRoot, `${key}.json`) : null
}

export function readLocalPathProvenance(
  key: string,
  options: { cacheRoot?: string } = {},
): string | null {
  const root = resolve(options.cacheRoot ?? defaultLocalProvenanceCacheRoot())
  const path = cacheFile(key, root)
  if (!path || !existsSync(path)) return null
  try {
    const record = JSON.parse(readFileSync(path, 'utf8')) as {
      schemaVersion?: unknown
      key?: unknown
      path?: unknown
    }
    if (
      record.schemaVersion !== LOCAL_PROVENANCE_SCHEMA_VERSION ||
      record.key !== key ||
      typeof record.path !== 'string' ||
      !isAbsolute(record.path) ||
      localPathProvenanceKey(record.path) !== key
    ) return null
    return resolve(record.path)
  } catch {
    return null
  }
}

export function writeLocalPathProvenance(
  entries: readonly LocalPathProvenance[],
  options: { cacheRoot?: string } = {},
): void {
  if (entries.length === 0) return
  const root = resolve(options.cacheRoot ?? defaultLocalProvenanceCacheRoot())
  mkdirSync(root, { recursive: true })
  for (const entry of entries) {
    const absolutePath = resolve(entry.absolutePath)
    if (!LOCAL_PATH_KEY.test(entry.key) || localPathProvenanceKey(absolutePath) !== entry.key) {
      throw new Error(`Blendlink refused invalid local provenance key ${entry.key}.`)
    }
    const finalPath = cacheFile(entry.key, root)!
    const existing = readLocalPathProvenance(entry.key, { cacheRoot: root })
    if (existing && canonicalLocalPath(existing) === canonicalLocalPath(absolutePath)) continue
    if (existsSync(finalPath)) {
      throw new Error(
        `Blendlink local provenance at ${finalPath} is corrupt or belongs to another path; ` +
          'remove that one cache record and retry.',
      )
    }
    const nextPath = join(root, `.${entry.key}.${process.pid}.${Date.now()}.tmp`)
    try {
      writeFileSync(nextPath, `${JSON.stringify({
        schemaVersion: LOCAL_PROVENANCE_SCHEMA_VERSION,
        key: entry.key,
        path: absolutePath,
      })}\n`, { mode: 0o600, flag: 'wx' })
      renameSync(nextPath, finalPath)
    } finally {
      rmSync(nextPath, { force: true })
    }
  }
}
