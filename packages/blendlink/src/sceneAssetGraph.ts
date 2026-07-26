import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

export type SceneAssetRole = 'scene' | 'companion' | 'basis-runtime'

export interface SceneAssetGraphInput {
  path: string
  role: SceneAssetRole
  bytes: Uint8Array
}

export interface SceneAssetGraphEntry {
  path: string
  role: SceneAssetRole
  bytes: number
  sha256: string
}

export interface SceneAssetGraph {
  algorithm: 'sha256'
  fingerprint: string
  entries: readonly SceneAssetGraphEntry[]
}

export interface SceneAssetGraphDiff {
  added: readonly string[]
  removed: readonly string[]
  changed: readonly string[]
}

export interface CompilerStagedAsset {
  path: string
  sourcePath: string
  bytes: Uint8Array
}

export interface SceneAssetGraphIntegrityOptions {
  requiresKtx2?: boolean
  /** Relative graph path of the GLB selected by the caller. Supplying this
   * prevents a valid but unrelated graph in the same directory from being
   * accepted as the configured scene. */
  expectedScenePath?: string
}

export const KTX2_RUNTIME_GRAPH_PATHS = Object.freeze([
  'blendlink-basis/basis_transcoder.js',
  'blendlink-basis/basis_transcoder.wasm',
  'blendlink-basis/README.md',
  'blendlink-basis/LICENSE',
] as const)

function normalizedGraphPath(value: string): string {
  if (!value || value.includes('\\') || value.includes('?') || value.includes('#') ||
      value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Blendlink runtime asset path must be a plain relative POSIX path: ${value}`)
  }
  if (/%(?:2f|5c)/i.test(value)) {
    throw new Error(`Blendlink runtime asset path contains an encoded path separator: ${value}`)
  }
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Blendlink runtime asset path contains an empty or traversal segment: ${value}`)
  }
  return parts.join('/')
}

function gltfJsonFromBytes(scenePath: string, bytes: Uint8Array): Record<string, unknown> {
  let jsonBytes: Uint8Array
  if (scenePath.toLowerCase().endsWith('.gltf')) {
    jsonBytes = bytes
  } else if (scenePath.toLowerCase().endsWith('.glb')) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
      throw new Error(`Blendlink scene ${scenePath} is not a valid GLB container`)
    }
    if (view.getUint32(4, true) !== 2) {
      throw new Error(`Blendlink scene ${scenePath} is not a glTF 2 GLB container`)
    }
    const declaredLength = view.getUint32(8, true)
    const jsonLength = view.getUint32(12, true)
    if (declaredLength !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a ||
        jsonLength > bytes.byteLength - 20) {
      throw new Error(`Blendlink scene ${scenePath} has a malformed GLB JSON chunk`)
    }
    jsonBytes = bytes.subarray(20, 20 + jsonLength)
  } else {
    throw new Error(`Blendlink scene payload must end in .glb or .gltf: ${scenePath}`)
  }

  let parsed: unknown
  try {
    const json = new TextDecoder('utf-8', { fatal: true })
      .decode(jsonBytes)
      .replace(/\u0000+$/u, '')
      .trimEnd()
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(
      `Blendlink scene ${scenePath} has unreadable glTF JSON: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Blendlink scene ${scenePath} glTF JSON root must be an object`)
  }
  return parsed as Record<string, unknown>
}

function externalResourceGraphPath(scenePath: string, uri: string): string | null {
  if (/^data:/i.test(uri)) return null
  if (!uri || uri.includes('\\') || uri.includes('?') || uri.includes('#') ||
      uri.startsWith('/') || uri.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) {
    throw new Error(`external URI is not a plain relative glTF resource path: ${uri}`)
  }
  if (/%(?:2f|5c)/i.test(uri)) {
    throw new Error(`external URI contains an encoded path separator: ${uri}`)
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(uri)
  } catch {
    throw new Error(`external URI has malformed percent-encoding: ${uri}`)
  }
  if (decoded.includes('\\') || decoded.includes('?') || decoded.includes('#') ||
      decoded.split('/').some((part) => part === '')) {
    throw new Error(`external URI is not a canonical relative glTF resource path: ${uri}`)
  }
  const target = posix.normalize(posix.join(posix.dirname(scenePath), decoded))
  return normalizedGraphPath(target)
}

/** Prove that every browser request named directly by a glTF/GLB buffer or
 * image URI is inside the exact compiler-owned graph. Data URIs remain
 * embedded. Extension-specific remote resources are outside this v1 proof and
 * must be handled by a future explicit declaration rather than inferred. */
export function scenePayloadClosureProblem(
  scenePath: string,
  sceneBytes: Uint8Array,
  graphEntries: readonly Pick<SceneAssetGraphEntry, 'path' | 'role'>[],
): string | null {
  try {
    const json = gltfJsonFromBytes(scenePath, sceneBytes)
    const declared = new Map(graphEntries.map((entry) => [entry.path, entry.role]))
    for (const [kind, candidates] of [
      ['buffer', json.buffers],
      ['image', json.images],
    ] as const) {
      if (candidates === undefined) continue
      if (!Array.isArray(candidates)) return `scene ${scenePath} has a malformed ${kind}s array`
      for (const [index, candidate] of candidates.entries()) {
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
          return `scene ${scenePath} ${kind} ${index} is not an object`
        }
        const uri = (candidate as { uri?: unknown }).uri
        if (uri === undefined) continue
        if (typeof uri !== 'string') return `scene ${scenePath} ${kind} ${index} URI is not a string`
        let target: string | null
        try {
          target = externalResourceGraphPath(scenePath, uri)
        } catch (error) {
          return `scene ${scenePath} external ${kind} URI ${JSON.stringify(uri)} is unsafe: ` +
            `${error instanceof Error ? error.message : String(error)}`
        }
        if (target === null) continue
        if (declared.get(target) !== 'companion') {
          return `scene ${scenePath} external ${kind} URI ${JSON.stringify(uri)} resolves to ` +
            `${target}, which is not declared as a compiler-owned companion`
        }
      }
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Convert an owned local publication path to the graph's portable key while
 * refusing files outside the declared publication directory. */
export function sceneAssetGraphPath(publicationDirectory: string, assetPath: string): string {
  const root = resolve(publicationDirectory)
  const asset = resolve(assetPath)
  const name = relative(root, asset)
  if (!name || name === '..' || name.startsWith(`..${sep}`) || isAbsolute(name)) {
    throw new Error(`Blendlink runtime asset is outside its publication directory: ${assetPath}`)
  }
  return normalizedGraphPath(name.split(sep).join('/'))
}

/** Recursively prove the exact file closure of one package-owned compiler
 * staging directory. The caller supplies the paths explicitly declared by
 * compiler results; directory contents are evidence to compare, never an
 * implicit declaration. Returned paths retain their staging-relative shape. */
export function inspectCompilerStagingDirectory(
  stageDirectory: string,
  declaredSourcePaths: readonly string[],
): readonly CompilerStagedAsset[] {
  const root = resolve(stageDirectory)
  const rootStatus = lstatSync(root)
  if (rootStatus.isSymbolicLink()) {
    throw new Error(`Compiler staging root is a symbolic link, junction, or reparse point: ${root}`)
  }
  if (!rootStatus.isDirectory()) {
    throw new Error(`Compiler staging root is not a directory: ${root}`)
  }

  const declared = new Map<string, string>()
  const folded = new Map<string, string>()
  const allowedDirectories = new Set<string>()
  for (const sourcePath of declaredSourcePaths) {
    const path = sceneAssetGraphPath(root, sourcePath)
    const caseFolded = path.toLocaleLowerCase('en-US')
    const collision = folded.get(caseFolded)
    if (collision) {
      throw new Error(
        `Compiler-declared staged paths collide on case-insensitive hosts: ${collision} and ${path}`,
      )
    }
    folded.set(caseFolded, path)
    declared.set(path, resolve(sourcePath))
    const parts = path.split('/')
    for (let end = 1; end < parts.length; end += 1) {
      allowedDirectories.add(parts.slice(0, end).join('/'))
    }
  }

  const found = new Set<string>()
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const sourcePath = join(directory, entry.name)
      const path = sceneAssetGraphPath(root, sourcePath)
      const status = lstatSync(sourcePath)
      if (status.isSymbolicLink()) {
        throw new Error(
          `Compiler-owned staged path is a symbolic link, junction, or reparse point: ${sourcePath}`,
        )
      }
      if (status.isDirectory()) {
        if (!allowedDirectories.has(path)) {
          throw new Error(`Unexpected undeclared compiler-owned staged directory: ${path}`)
        }
        visit(sourcePath)
        continue
      }
      if (!status.isFile()) {
        throw new Error(`Compiler-owned staged path is not a regular file: ${sourcePath}`)
      }
      if (!declared.has(path)) {
        throw new Error(`Unexpected undeclared compiler-owned staged file: ${path}`)
      }
      found.add(path)
    }
  }
  visit(root)

  const missing = [...declared.keys()].filter((path) => !found.has(path)).sort()
  if (missing.length > 0) {
    throw new Error(`Compiler-declared staged file is missing: ${missing[0]}`)
  }
  return Object.freeze([...declared.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, sourcePath]) => Object.freeze({
      path,
      sourcePath,
      bytes: readFileSync(sourcePath),
    })))
}

function linkedPathSegment(
  root: string,
  localPath: string,
): string | null {
  const segments = relative(root, localPath).split(sep)
  let current = root
  if (lstatSync(current).isSymbolicLink()) return current
  for (const segment of segments) {
    current = join(current, segment)
    if (lstatSync(current).isSymbolicLink()) return current
  }
  return null
}

/** Deterministic content identity for the complete compiler-owned request
 * graph. The digest covers a domain marker, normalized path, role, byte length,
 * and exact bytes. It does not include generated source or external Component
 * URLs, which remain application-owned. */
export function createSceneAssetGraph(
  inputs: readonly SceneAssetGraphInput[],
  options: { requiresKtx2?: boolean } = {},
): SceneAssetGraph {
  if (inputs.length === 0) throw new Error('Blendlink runtime asset graph cannot be empty')
  const seen = new Map<string, string>()
  const prepared = inputs.map((input) => {
    const path = normalizedGraphPath(input.path)
    const folded = path.toLocaleLowerCase('en-US')
    const collision = seen.get(folded)
    if (collision) {
      throw new Error(
        `Blendlink runtime asset paths collide on case-insensitive hosts: ${collision} and ${path}`,
      )
    }
    seen.set(folded, path)
    return { ...input, path }
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)

  const scenes = prepared.filter((entry) => entry.role === 'scene')
  if (scenes.length !== 1 || !scenes[0]!.path.toLowerCase().endsWith('.glb')) {
    throw new Error(`Blendlink runtime asset graph needs exactly one scene GLB; found ${scenes.length}`)
  }
  const closureProblem = scenePayloadClosureProblem(
    scenes[0]!.path,
    scenes[0]!.bytes,
    prepared,
  )
  if (closureProblem) throw new Error(`Blendlink runtime asset graph is not closed: ${closureProblem}`)
  if (options.requiresKtx2) {
    const paths = new Set(prepared.map((entry) => entry.path))
    const missing = KTX2_RUNTIME_GRAPH_PATHS.filter((path) => !paths.has(path))
    if (missing.length) {
      throw new Error(`KTX2 runtime graph is missing decoder assets:\n- ${missing.join('\n- ')}`)
    }
  }

  const digest = createHash('sha256')
  digest.update('blendlink-runtime-asset-graph-v1\n', 'utf8')
  const entries = prepared.map((entry) => {
    const sha256 = createHash('sha256').update(entry.bytes).digest('hex')
    digest.update(entry.path, 'utf8').update('\0')
    digest.update(entry.role, 'ascii').update('\0')
    digest.update(String(entry.bytes.byteLength), 'ascii').update('\0')
    digest.update(entry.bytes).update('\n')
    return Object.freeze({
      path: entry.path, role: entry.role, bytes: entry.bytes.byteLength, sha256,
    })
  })
  return Object.freeze({
    algorithm: 'sha256',
    fingerprint: digest.digest('hex'),
    entries: Object.freeze(entries),
  })
}

/** Verify the exact files named by a persisted graph. This is deliberately a
 * graph-level check rather than another manifest-field walk: future compiler
 * companions become part of unchanged-scene and publish verification as soon
 * as they enter the graph. The publication directory remains mutable today;
 * this function proves integrity, not immutable addressing. */
export function sceneAssetGraphIntegrityProblem(
  publicationDirectory: string,
  graph: SceneAssetGraph,
  options: SceneAssetGraphIntegrityOptions = {},
): string | null {
  try {
    if (!graph || graph.algorithm !== 'sha256') {
      return 'runtime asset graph must declare algorithm "sha256"'
    }
    if (!/^[a-f0-9]{64}$/.test(graph.fingerprint)) {
      return 'runtime asset graph has a malformed SHA-256 fingerprint'
    }
    if (!Array.isArray(graph.entries) || graph.entries.length === 0) {
      return 'runtime asset graph has no entries'
    }

    const root = resolve(publicationDirectory)
    const inputs: SceneAssetGraphInput[] = []
    const seen = new Map<string, string>()
    for (const [index, candidate] of graph.entries.entries()) {
      if (typeof candidate !== 'object' || candidate === null) {
        return `runtime asset graph entry ${index} is not an object`
      }
      const entry = candidate as SceneAssetGraphEntry
      if (entry.role !== 'scene' && entry.role !== 'companion' && entry.role !== 'basis-runtime') {
        return `runtime asset graph entry ${index} has unsupported role ${JSON.stringify(entry.role)}`
      }
      const path = normalizedGraphPath(entry.path)
      const folded = path.toLocaleLowerCase('en-US')
      const collision = seen.get(folded)
      if (collision) {
        return `runtime asset graph paths collide on case-insensitive hosts: ${collision} and ${path}`
      }
      seen.set(folded, path)
      if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
        return `runtime asset graph entry ${path} has an invalid byte count`
      }
      if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
        return `runtime asset graph entry ${path} has a malformed SHA-256 digest`
      }

      const localPath = resolve(root, ...path.split('/'))
      const localRelative = relative(root, localPath)
      if (!localRelative || localRelative === '..' ||
          localRelative.startsWith(`..${sep}`) || isAbsolute(localRelative)) {
        return `runtime asset graph entry ${path} escapes its publication directory`
      }
      if (!existsSync(localPath)) return `runtime asset graph entry ${path} is missing from ${localPath}`
      const linkedSegment = linkedPathSegment(root, localPath)
      if (linkedSegment) {
        return `runtime asset graph entry ${path} reaches ${linkedSegment}, which is a ` +
          'symbolic link, junction, or reparse point'
      }
      const status = lstatSync(localPath)
      if (status.isSymbolicLink()) {
        return `runtime asset graph entry ${path} is a symbolic link; published graph entries must be regular files`
      }
      if (!status.isFile()) return `runtime asset graph entry ${path} is not a regular file`
      const bytes = readFileSync(localPath)
      if (bytes.byteLength !== entry.bytes) {
        return `runtime asset graph entry ${path} has ${bytes.byteLength} bytes; expected ${entry.bytes}`
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (sha256 !== entry.sha256) {
        return `runtime asset graph entry ${path} bytes do not match its SHA-256 digest`
      }
      inputs.push({ path, role: entry.role, bytes })
    }

    const rebuilt = createSceneAssetGraph(inputs, { requiresKtx2: options.requiresKtx2 })
    if (options.expectedScenePath !== undefined) {
      const expected = normalizedGraphPath(options.expectedScenePath)
      const actual = rebuilt.entries.find((entry) => entry.role === 'scene')!.path
      if (actual !== expected) {
        return `runtime asset graph scene is ${actual}; configured scene is ${expected}`
      }
    }
    if (graph.entries.some((entry, index) => {
      const canonical = rebuilt.entries[index]
      return !canonical || entry.path !== canonical.path || entry.role !== canonical.role ||
        entry.bytes !== canonical.bytes || entry.sha256 !== canonical.sha256
    })) {
      return 'runtime asset graph entries are not in canonical path order'
    }
    if (rebuilt.fingerprint !== graph.fingerprint) {
      return `runtime asset graph fingerprint is ${graph.fingerprint}; exact files produce ${rebuilt.fingerprint}`
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Explain an exact runtime-graph identity change without weakening it into a
 * semantic-equivalence claim. This is used by forced rebuild diagnostics:
 * byte changes remain real even when a downstream investigation determines
 * that they came from microscopic exporter jitter. */
export function diffSceneAssetGraphs(
  previous: SceneAssetGraph,
  next: SceneAssetGraph,
): SceneAssetGraphDiff {
  const previousByPath = new Map(previous.entries.map((entry) => [entry.path, entry]))
  const nextByPath = new Map(next.entries.map((entry) => [entry.path, entry]))
  const added = [...nextByPath.keys()].filter((path) => !previousByPath.has(path)).sort()
  const removed = [...previousByPath.keys()].filter((path) => !nextByPath.has(path)).sort()
  const changed = [...nextByPath.entries()]
    .filter(([path, entry]) => {
      const before = previousByPath.get(path)
      return before !== undefined && (
        before.role !== entry.role || before.bytes !== entry.bytes || before.sha256 !== entry.sha256
      )
    })
    .map(([path]) => path)
    .sort()
  return Object.freeze({
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    changed: Object.freeze(changed),
  })
}
