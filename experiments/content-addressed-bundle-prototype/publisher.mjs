// PROTOTYPE ONLY. This module answers whether Blendlink's existing exact
// runtime graph can be sealed behind one permanent directory before a small
// mutable descriptor switches. It is deliberately not a production export.

import { randomUUID } from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resolveCompiledAssetUrl } from '../../packages/blendlink/src/assetUrls.ts'
import {
  createSceneAssetGraph,
  inspectCompilerStagingDirectory,
  sceneAssetGraphIntegrityProblem,
  sceneAssetGraphPath,
} from '../../packages/blendlink/src/sceneAssetGraph.ts'

export const CONTENT_ADDRESSED_POINTER_SCHEMA =
  'blendlink-content-addressed-bundle-pointer-prototype-v1'

function normalizedRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') ||
      value.includes('?') || value.includes('#') || value.startsWith('/') ||
      /^[A-Za-z]:/.test(value)) {
    throw new Error(`${label} must be a plain relative POSIX path: ${String(value)}`)
  }
  if (/%(?:2f|5c)/i.test(value)) {
    throw new Error(`${label} contains an encoded path separator: ${value}`)
  }
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} contains an empty or traversal segment: ${value}`)
  }
  return parts.join('/')
}

function localPath(root, graphPath) {
  const path = resolve(root, ...graphPath.split('/'))
  sceneAssetGraphPath(root, path)
  return path
}

function assertInside(root, candidate, label) {
  const child = relative(resolve(root), resolve(candidate))
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`${label} must be inside ${resolve(root)}: ${resolve(candidate)}`)
  }
}

function graphFromExactDirectory(directory, declaredAssets, requiresKtx2) {
  if (!Array.isArray(declaredAssets) || declaredAssets.length === 0) {
    throw new Error('Content-addressed publication needs at least one declared asset')
  }
  const roleByPath = new Map()
  const declaredSourcePaths = declaredAssets.map((asset, index) => {
    if (typeof asset !== 'object' || asset === null) {
      throw new Error(`Declared asset ${index} is not an object`)
    }
    const path = normalizedRelativePath(asset.path, `Declared asset ${index} path`)
    roleByPath.set(path, asset.role)
    return localPath(directory, path)
  })
  const staged = inspectCompilerStagingDirectory(directory, declaredSourcePaths)
  return createSceneAssetGraph(staged.map((asset) => ({
    path: asset.path,
    role: roleByPath.get(asset.path),
    bytes: asset.bytes,
  })), { requiresKtx2 })
}

function verifyExactDirectory(directory, graph, requiresKtx2) {
  const roleByPath = new Map(graph.entries.map((entry) => [entry.path, entry.role]))
  const inventoried = inspectCompilerStagingDirectory(
    directory,
    graph.entries.map((entry) => localPath(directory, entry.path)),
  )
  const rebuilt = createSceneAssetGraph(inventoried.map((asset) => ({
    path: asset.path,
    role: roleByPath.get(asset.path),
    bytes: asset.bytes,
  })), { requiresKtx2 })
  if (rebuilt.fingerprint !== graph.fingerprint) {
    throw new Error(
      `Sealed bundle fingerprint is ${rebuilt.fingerprint}; staged graph expected ${graph.fingerprint}`,
    )
  }
  const scenePath = graph.entries.find((entry) => entry.role === 'scene')?.path
  const integrityProblem = sceneAssetGraphIntegrityProblem(directory, graph, {
    requiresKtx2,
    expectedScenePath: scenePath,
  })
  if (integrityProblem) {
    throw new Error(`Sealed bundle integrity failed: ${integrityProblem}`)
  }
}

function pointerFor(graph, publicBundlePath) {
  const scenePath = graph.entries.find((entry) => entry.role === 'scene')?.path
  return Object.freeze({
    schema: CONTENT_ADDRESSED_POINTER_SCHEMA,
    algorithm: graph.algorithm,
    fingerprint: graph.fingerprint,
    bundlePath: `${publicBundlePath}/${graph.fingerprint}/`,
    scenePath,
  })
}

function validatePointer(pointer) {
  if (typeof pointer !== 'object' || pointer === null ||
      pointer.schema !== CONTENT_ADDRESSED_POINTER_SCHEMA) {
    throw new Error(
      `Content-addressed bundle pointer must use schema ${CONTENT_ADDRESSED_POINTER_SCHEMA}`,
    )
  }
  if (pointer.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(pointer.fingerprint)) {
    throw new Error('Content-addressed bundle pointer has an invalid SHA-256 identity')
  }
  if (typeof pointer.bundlePath !== 'string' || !pointer.bundlePath.endsWith('/')) {
    throw new Error('Content-addressed bundle pointer has an invalid bundle path')
  }
  const bundlePath = normalizedRelativePath(
    pointer.bundlePath.slice(0, -1),
    'Content-addressed bundle path',
  )
  if (!bundlePath.endsWith(`/${pointer.fingerprint}`)) {
    throw new Error('Content-addressed bundle path does not end in its graph fingerprint')
  }
  normalizedRelativePath(pointer.scenePath, 'Content-addressed scene path')
  return bundlePath
}

function publishPointer(pointerPath, pointer, bundleDirectory, hooks) {
  mkdirSync(dirname(pointerPath), { recursive: true })
  const nextPath = `${pointerPath}.blendlink-pointer-next-${process.pid}-${randomUUID()}`
  try {
    writeFileSync(nextPath, JSON.stringify(pointer, null, 2) + '\n', { flag: 'wx' })
    hooks.onPhase?.({
      phase: 'before-pointer-commit',
      fingerprint: pointer.fingerprint,
      bundleDirectory,
      pointerPath,
    })
    ;(hooks.replacePointer ?? renameSync)(nextPath, pointerPath)
    hooks.onPhase?.({
      phase: 'pointer-committed',
      fingerprint: pointer.fingerprint,
      bundleDirectory,
      pointerPath,
    })
  } finally {
    rmSync(nextPath, { force: true })
  }
}

/**
 * PROTOTYPE interface. `onPhase`, `replacePointer`, and `renameBundle` are
 * experiment-only internal seams used to observe namespace transitions and
 * inject faults. Production should not expose them as ordinary caller options.
 */
export function publishContentAddressedBundle(input, hooks = {}) {
  const stageDirectory = resolve(input.stageDirectory)
  const publicationRoot = resolve(input.publicationRoot)
  const pointerPath = resolve(input.pointerPath)
  const publicBundlePath = normalizedRelativePath(
    input.publicBundlePath,
    'Content-addressed public bundle path',
  )
  const graph = graphFromExactDirectory(
    stageDirectory,
    input.declaredAssets,
    input.requiresKtx2 === true,
  )
  const bundleParent = localPath(publicationRoot, publicBundlePath)
  const bundleDirectory = join(bundleParent, graph.fingerprint)
  assertInside(publicationRoot, bundleDirectory, 'Content-addressed bundle directory')
  const pointerRelativeToBundle = relative(bundleDirectory, pointerPath)
  if (!pointerRelativeToBundle || (
    pointerRelativeToBundle !== '..' &&
    !pointerRelativeToBundle.startsWith(`..${sep}`) &&
    !isAbsolute(pointerRelativeToBundle)
  )) {
    throw new Error('Mutable bundle pointer cannot live inside the immutable bundle directory')
  }

  mkdirSync(bundleParent, { recursive: true })
  const sealDirectory = join(
    bundleParent,
    `.blendlink-seal-${graph.fingerprint}-${process.pid}-${randomUUID()}`,
  )
  let sealPresent = false
  let reused = false
  try {
    mkdirSync(sealDirectory, { recursive: false })
    sealPresent = true
    const staged = inspectCompilerStagingDirectory(
      stageDirectory,
      graph.entries.map((entry) => localPath(stageDirectory, entry.path)),
    )
    for (const asset of staged) {
      const destination = localPath(sealDirectory, asset.path)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(asset.sourcePath, destination, constants.COPYFILE_EXCL)
      hooks.onPhase?.({
        phase: 'entry-copied',
        fingerprint: graph.fingerprint,
        path: asset.path,
        sealDirectory,
        bundleDirectory,
        pointerPath,
      })
    }
    verifyExactDirectory(sealDirectory, graph, input.requiresKtx2 === true)

    if (existsSync(bundleDirectory)) {
      verifyExactDirectory(bundleDirectory, graph, input.requiresKtx2 === true)
      reused = true
      rmSync(sealDirectory, { recursive: true, force: true })
      sealPresent = false
    } else {
      try {
        ;(hooks.renameBundle ?? renameSync)(sealDirectory, bundleDirectory)
        sealPresent = false
      } catch (error) {
        if (!existsSync(bundleDirectory)) throw error
        verifyExactDirectory(bundleDirectory, graph, input.requiresKtx2 === true)
        reused = true
        rmSync(sealDirectory, { recursive: true, force: true })
        sealPresent = false
      }
    }

    // Nothing writes beneath bundleDirectory after this verification.
    verifyExactDirectory(bundleDirectory, graph, input.requiresKtx2 === true)
    hooks.onPhase?.({
      phase: reused ? 'bundle-reused' : 'bundle-committed',
      fingerprint: graph.fingerprint,
      bundleDirectory,
      pointerPath,
    })

    const pointer = pointerFor(graph, publicBundlePath)
    publishPointer(pointerPath, pointer, bundleDirectory, hooks)
    return Object.freeze({
      fingerprint: graph.fingerprint,
      bundleDirectory,
      pointerPath,
      pointer,
      graph,
      reused,
    })
  } finally {
    if (sealPresent) rmSync(sealDirectory, { recursive: true, force: true })
  }
}

export function resolveContentAddressedAssetUrl(pointer, graphPath, baseUrl = '/') {
  const bundlePath = validatePointer(pointer)
  const assetPath = normalizedRelativePath(graphPath, 'Content-addressed asset path')
  return resolveCompiledAssetUrl(`/${bundlePath}/${assetPath}`, baseUrl)
}
