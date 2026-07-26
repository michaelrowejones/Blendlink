import { randomUUID } from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  inspectCompilerStagingDirectory,
  sceneAssetGraphIntegrityProblem,
  sceneAssetGraphPath,
  type CompilerStagedAsset,
  type SceneAssetGraph,
  type SceneAssetGraphEntry,
} from './sceneAssetGraph.js'

export interface SealScenePublicationOptions {
  /** Exact compiler-owned directory represented by `graph`. No residue is
   * allowed: undeclared files and directories fail before publication. */
  sourceDirectory: string
  /** Parent chosen by the caller for permanent graph directories. The sealed
   * directory name is always the graph's full SHA-256 fingerprint. */
  destinationParent: string
  graph: SceneAssetGraph
  /** Reassert complete concrete Basis runtime closure for a KTX2 scene. */
  requiresKtx2?: boolean
}

export interface SealedScenePublication {
  readonly algorithm: 'sha256'
  readonly fingerprint: string
  /** Resolved local path of the never-mutated graph directory. */
  readonly directory: string
  /** Portable path segment relative to `destinationParent`. */
  readonly bundlePath: string
  /** Graph-relative GLB path. A later URL module can combine this with its
   * application-owned public root without teaching this module about hosts. */
  readonly scenePath: string
  readonly files: readonly SceneAssetGraphEntry[]
  readonly reused: boolean
}

export interface SceneRuntimePublication {
  readonly algorithm: 'sha256'
  /** POSIX-relative path from the configured static asset directory to the
   * never-mutated graph directory. */
  readonly bundlePath: string
  /** Graph-relative GLB path beneath bundlePath. */
  readonly scenePath: string
  readonly immutable: true
}

function normalizedPortablePath(value: string, subject: string): string {
  const parts = value.split('/')
  if (!value || value.includes('\\') || value.startsWith('/') ||
      /^[A-Za-z]:/u.test(value) ||
      parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${subject} must be a plain relative POSIX path: ${value}`)
  }
  return parts.join('/')
}

/** Build the additive schema-v3 activation record after an exact graph has
 * been sealed. The scene identifier is one safe generated path segment. */
export function createSceneRuntimePublication(
  sceneName: string,
  sealed: SealedScenePublication,
): SceneRuntimePublication {
  return createSceneRuntimePublicationRecord(
    sceneName,
    sealed.fingerprint,
    sealed.scenePath,
  )
}

export function sceneRuntimePublicationForGraph(
  sceneName: string,
  graph: SceneAssetGraph,
): SceneRuntimePublication {
  const sceneEntries = graph.entries.filter((entry) => entry.role === 'scene')
  if (sceneEntries.length !== 1) {
    throw new Error(
      `Scene runtime graph must contain exactly one scene; found ${sceneEntries.length}.`,
    )
  }
  return createSceneRuntimePublicationRecord(
    sceneName,
    graph.fingerprint,
    sceneEntries[0]!.path,
  )
}

function createSceneRuntimePublicationRecord(
  sceneName: string,
  fingerprint: string,
  scenePath: string,
): SceneRuntimePublication {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(sceneName)) {
    throw new Error(
      `Scene publication name must be one generated identifier segment: ${sceneName}`,
    )
  }
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) {
    throw new Error(
      `Scene publication fingerprint must be a full SHA-256 digest: ${fingerprint}`,
    )
  }
  return Object.freeze({
    algorithm: 'sha256' as const,
    bundlePath: `${sceneName}/${fingerprint}`,
    scenePath: normalizedPortablePath(
      scenePath,
      'Scene publication scenePath',
    ),
    immutable: true as const,
  })
}

/** Resolve an activation record to disk without accepting normalization or
 * traversal aliases. */
export function sceneRuntimePublicationDirectory(
  publicationDirectory: string,
  publication: SceneRuntimePublication,
): string {
  const root = resolve(publicationDirectory)
  const bundlePath = normalizedPortablePath(
    publication.bundlePath,
    'Scene publication bundlePath',
  )
  const directory = resolve(root, ...bundlePath.split('/'))
  const canonical = sceneAssetGraphPath(root, directory)
  if (canonical !== bundlePath) {
    throw new Error(
      `Scene publication bundlePath is not canonical: ${publication.bundlePath}`,
    )
  }
  return directory
}

/** Place one graph path beside the configured legacy scene URL. This keeps
 * root, Next/Vite subpath, and absolute CDN forms intact without teaching the
 * compiler about a framework. */
export function sceneRuntimePublicationUrl(
  configuredSceneUrl: string,
  publication: SceneRuntimePublication,
  graphPath: string,
): string {
  const relativePath = [
    normalizedPortablePath(
      publication.bundlePath,
      'Scene publication bundlePath',
    ),
    normalizedPortablePath(graphPath, 'Scene publication graph path'),
  ].join('/')
  let configured: URL
  try {
    configured = new URL(configuredSceneUrl, 'https://blendlink.invalid/')
  } catch {
    throw new Error(`Configured scene URL is invalid: ${configuredSceneUrl}`)
  }
  if (configured.protocol !== 'http:' && configured.protocol !== 'https:') {
    throw new Error(
      `Configured scene URL must use HTTP(S) or a public path: ${configuredSceneUrl}`,
    )
  }
  const directory = configured.pathname.slice(
    0,
    configured.pathname.lastIndexOf('/') + 1,
  )
  configured.pathname = `${directory}${relativePath}`
  configured.search = ''
  configured.hash = ''
  if (/^https?:/iu.test(configuredSceneUrl)) return configured.href
  if (configuredSceneUrl.startsWith('/')) return configured.pathname
  return configured.pathname.replace(/^\/+/u, '')
}

export function sceneRuntimePublicationProblem(
  publication: SceneRuntimePublication | undefined,
  graph: SceneAssetGraph | undefined,
): string | null {
  try {
    if (!publication) return 'runtime asset publication metadata is missing'
    if (publication.algorithm !== 'sha256') {
      return 'runtime asset publication algorithm must be "sha256"'
    }
    if (publication.immutable !== true) {
      return 'runtime asset publication must declare immutable: true'
    }
    if (!graph || graph.algorithm !== 'sha256') {
      return 'runtime asset publication requires a SHA-256 runtime graph'
    }
    const bundlePath = normalizedPortablePath(
      publication.bundlePath,
      'Scene publication bundlePath',
    )
    if (bundlePath.split('/').at(-1) !== graph.fingerprint) {
      return `runtime asset publication bundlePath must end with graph fingerprint ${graph.fingerprint}`
    }
    const sceneEntries = graph.entries.filter((entry) => entry.role === 'scene')
    if (sceneEntries.length !== 1) {
      return `runtime asset publication requires exactly one graph scene; found ${sceneEntries.length}`
    }
    const scenePath = normalizedPortablePath(
      publication.scenePath,
      'Scene publication scenePath',
    )
    if (scenePath !== sceneEntries[0]!.path) {
      return `runtime asset publication scenePath is ${scenePath}; graph scene is ${sceneEntries[0]!.path}`
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function graphPath(root: string, path: string): string {
  const localPath = resolve(root, ...path.split('/'))
  sceneAssetGraphPath(root, localPath)
  return localPath
}

function exactGraphDirectory(
  directory: string,
  graph: SceneAssetGraph,
  requiresKtx2: boolean,
): readonly CompilerStagedAsset[] {
  const scenePath = graph.entries.find((entry) => entry.role === 'scene')?.path
  const problem = sceneAssetGraphIntegrityProblem(directory, graph, {
    requiresKtx2,
    ...(scenePath ? { expectedScenePath: scenePath } : {}),
  })
  if (problem) {
    throw new Error(`Scene publication graph integrity failed in ${resolve(directory)}: ${problem}`)
  }
  try {
    return inspectCompilerStagingDirectory(
      directory,
      graph.entries.map((entry) => graphPath(directory, entry.path)),
    )
  } catch (error) {
    throw new Error(
      `Scene publication closure failed in ${resolve(directory)}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function immutableResult(
  graph: SceneAssetGraph,
  directory: string,
  reused: boolean,
): SealedScenePublication {
  const scenePath = graph.entries.find((entry) => entry.role === 'scene')!.path
  const files = Object.freeze(graph.entries.map((entry) => Object.freeze({ ...entry })))
  return Object.freeze({
    algorithm: 'sha256' as const,
    fingerprint: graph.fingerprint,
    directory,
    bundlePath: graph.fingerprint,
    scenePath,
    files,
    reused,
  })
}

/**
 * Copy one already-closed runtime graph into a private same-parent directory,
 * verify the copied bytes, then rename that directory into its permanent
 * fingerprint path. Nothing writes beneath the permanent directory afterward.
 *
 * This module deliberately has no mutable pointer, cleanup policy, framework
 * URL, or manifest knowledge. Those concerns belong to later seams.
 */
export function sealScenePublication(
  options: SealScenePublicationOptions,
): SealedScenePublication {
  const sourceDirectory = resolve(options.sourceDirectory)
  const destinationParent = resolve(options.destinationParent)
  const requiresKtx2 = options.requiresKtx2 === true
  const sourceAssets = exactGraphDirectory(sourceDirectory, options.graph, requiresKtx2)

  mkdirSync(destinationParent, { recursive: true })
  const parentStatus = lstatSync(destinationParent)
  if (parentStatus.isSymbolicLink()) {
    throw new Error(
      `Scene publication destination is a symbolic link, junction, or reparse point: ${destinationParent}`,
    )
  }
  if (!parentStatus.isDirectory()) {
    throw new Error(`Scene publication destination is not a directory: ${destinationParent}`)
  }

  const directory = join(destinationParent, options.graph.fingerprint)
  if (existsSync(directory)) {
    try {
      exactGraphDirectory(directory, options.graph, requiresKtx2)
    } catch (error) {
      throw new Error(
        `Existing content-addressed scene directory is corrupt: ${directory}. ` +
          'Blendlink will not overwrite an immutable graph in place. ' +
          `Remove exactly that directory, then rerun the compile. ${
            error instanceof Error ? error.message : String(error)
          }`,
        { cause: error },
      )
    }
    return immutableResult(options.graph, directory, true)
  }

  const sealDirectory = join(
    destinationParent,
    `.blendlink-seal-${options.graph.fingerprint}-${process.pid}-${randomUUID()}`,
  )
  let sealPresent = false
  try {
    mkdirSync(sealDirectory, { recursive: false })
    sealPresent = true
    for (const asset of sourceAssets) {
      const destination = graphPath(sealDirectory, asset.path)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(asset.sourcePath, destination, constants.COPYFILE_EXCL)
    }
    exactGraphDirectory(sealDirectory, options.graph, requiresKtx2)

    let reused = false
    try {
      renameSync(sealDirectory, directory)
      sealPresent = false
    } catch (error) {
      if (!existsSync(directory)) throw error
      try {
        exactGraphDirectory(directory, options.graph, requiresKtx2)
      } catch (integrityError) {
        throw new Error(
          `A concurrent publisher created a corrupt content-addressed scene directory: ${directory}. ` +
            'Blendlink will not overwrite an immutable graph in place. ' +
            `Remove exactly that directory after other publishers stop, then rerun the compile. ${
              integrityError instanceof Error
                ? integrityError.message
                : String(integrityError)
            }`,
          { cause: integrityError },
        )
      }
      reused = true
      rmSync(sealDirectory, { recursive: true, force: true })
      sealPresent = false
    }

    exactGraphDirectory(directory, options.graph, requiresKtx2)
    return immutableResult(options.graph, directory, reused)
  } finally {
    if (sealPresent) rmSync(sealDirectory, { recursive: true, force: true })
  }
}
