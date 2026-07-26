import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

function npmInvocation() {
  const bundled = join(
    dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js',
  )
  const npmExecPath = process.env.npm_execpath ??
    (existsSync(bundled) ? bundled : undefined)
  return npmExecPath
    ? { command: process.execPath, prefix: [npmExecPath] }
    : {
        command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
        prefix: [],
      }
}

function run(command, args, { cwd, label, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label ?? basename(command)} failed` +
      `${result.status === null ? '' : ` (${String(result.status)})`}:\n` +
      `${result.error?.message ??
        `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()}`,
    )
  }
  return result.stdout ?? ''
}

export function hashFile(path, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(readFileSync(path)).digest(encoding)
}

export function sriForFile(path) {
  return `sha512-${hashFile(path, 'sha512', 'base64')}`
}

function safePackageFilename(name) {
  return name.replace(/^@/, '').replaceAll('/', '-')
}

export function contentAddressedArchiveName(name, version, sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Local package archive identity must be a full lowercase SHA-256.')
  }
  return `${safePackageFilename(name)}-${version}-${sha256}.tgz`
}

function walkFiles(root, current = root, output = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      (entry.isDirectory() && entry.name === '__pycache__')
    ) continue
    const path = join(current, entry.name)
    if (entry.isDirectory()) {
      walkFiles(root, path, output)
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`Package identity does not accept non-file entry ${path}.`)
    }
    if (/\.(?:pyc|pyo)$/.test(entry.name)) continue
    output.push(path)
  }
  return output
}

export function fingerprintPackageTree(root) {
  const resolvedRoot = resolve(root)
  const hash = createHash('sha256')
  const files = walkFiles(resolvedRoot).sort((left, right) =>
    left.localeCompare(right, 'en'))
  for (const path of files) {
    const relative = path.slice(resolvedRoot.length + 1).replaceAll('\\', '/')
    hash.update(relative)
    hash.update('\0')
    hash.update(hashFile(path))
    hash.update('\n')
  }
  return hash.digest('hex')
}

function cleanOwnedTemp(root, prefix) {
  const resolved = resolve(root)
  if (
    dirname(resolved) !== resolve(tmpdir()) ||
    !basename(resolved).startsWith(prefix)
  ) {
    throw new Error(`Refusing to remove unexpected temporary directory ${resolved}.`)
  }
  rmSync(resolved, { recursive: true, force: true })
}

export function inspectPackageArchive(archive) {
  const resolvedArchive = resolve(archive)
  if (!existsSync(resolvedArchive) || !statSync(resolvedArchive).isFile()) {
    throw new Error(`Local package archive does not exist: ${resolvedArchive}`)
  }
  const tempRoot = mkdtempSync(join(tmpdir(), 'blendlink-archive-inspect-'))
  try {
    const extracted = join(tempRoot, 'package')
    mkdirSync(extracted)
    run(
      process.platform === 'win32' ? 'tar.exe' : 'tar',
      ['-xzf', resolvedArchive, '-C', extracted, '--strip-components=1'],
      { label: 'local package extraction' },
    )
    const manifest = JSON.parse(
      readFileSync(join(extracted, 'package.json'), 'utf8'),
    )
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error('Local package archive has no valid name/version identity.')
    }
    return {
      archive: resolvedArchive,
      name: manifest.name,
      version: manifest.version,
      sha256: hashFile(resolvedArchive),
      integrity: sriForFile(resolvedArchive),
      treeFingerprint: fingerprintPackageTree(extracted),
    }
  } finally {
    cleanOwnedTemp(tempRoot, 'blendlink-archive-inspect-')
  }
}

export function packContentAddressedLocalPackage(packageRoot, outputRoot) {
  const resolvedPackageRoot = resolve(packageRoot)
  const resolvedOutputRoot = resolve(outputRoot)
  mkdirSync(resolvedOutputRoot, { recursive: true })
  const tempRoot = mkdtempSync(join(tmpdir(), 'blendlink-local-pack-'))
  try {
    const npm = npmInvocation()
    const output = run(
      npm.command,
      [
        ...npm.prefix,
        'pack',
        '--json',
        '--pack-destination',
        tempRoot,
        '--cache',
        join(tempRoot, 'npm-cache'),
      ],
      { cwd: resolvedPackageRoot, label: 'npm pack local Blendlink archive' },
    )
    let packed
    try {
      ;[packed] = JSON.parse(output)
    } catch (error) {
      throw new Error(`npm pack emitted invalid JSON:\n${output}`, { cause: error })
    }
    if (!packed || typeof packed.filename !== 'string') {
      throw new Error('npm pack did not report one archive.')
    }
    const temporaryArchive = resolve(tempRoot, packed.filename)
    if (
      dirname(temporaryArchive) !== resolve(tempRoot) ||
      !existsSync(temporaryArchive)
    ) {
      throw new Error('npm pack archive escaped or is missing from its temp root.')
    }
    const identity = inspectPackageArchive(temporaryArchive)
    if (packed.integrity && packed.integrity !== identity.integrity) {
      throw new Error(
        `npm pack integrity ${packed.integrity} differs from bytes ${identity.integrity}.`,
      )
    }
    const filename = contentAddressedArchiveName(
      identity.name,
      identity.version,
      identity.sha256,
    )
    const archive = resolve(resolvedOutputRoot, filename)
    if (dirname(archive) !== resolvedOutputRoot) {
      throw new Error(`Refusing unexpected local archive target ${archive}.`)
    }
    if (existsSync(archive)) {
      if (hashFile(archive) !== identity.sha256) {
        throw new Error(
          `Existing content-addressed local archive is corrupt: ${archive}`,
        )
      }
    } else {
      copyFileSync(temporaryArchive, archive)
    }
    return { ...identity, archive, filename }
  } finally {
    cleanOwnedTemp(tempRoot, 'blendlink-local-pack-')
  }
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${path}`, { cause: error })
  }
}

function lockEntry(lock, name, label) {
  const entry = lock.packages?.[`node_modules/${name}`]
  if (!entry) throw new Error(`${label} has no installed ${name} entry.`)
  return entry
}

function assertArchiveLocator(value, archiveName, label) {
  const normalized = String(value ?? '').replaceAll('\\', '/')
  if (
    !normalized.startsWith('file:') ||
    basename(normalized.slice('file:'.length)) !== archiveName
  ) {
    throw new Error(
      `${label} must identify content-addressed archive ${archiveName}; got ` +
      `${JSON.stringify(value)}.`,
    )
  }
}

function declaredPackageLocator(manifest, name) {
  const declarations = [
    ['dependencies', manifest.dependencies?.[name]],
    ['devDependencies', manifest.devDependencies?.[name]],
    ['optionalDependencies', manifest.optionalDependencies?.[name]],
  ].filter(([, value]) => value !== undefined)
  if (declarations.length !== 1) {
    throw new Error(
      `Consumer package.json must declare ${name} exactly once in dependencies, ` +
      `devDependencies, or optionalDependencies; found ${declarations.length}.`,
    )
  }
  return { section: declarations[0][0], locator: declarations[0][1] }
}

export function verifyInstalledLocalPackage(projectRoot, archive) {
  const resolvedProject = resolve(projectRoot)
  const identity = inspectPackageArchive(archive)
  const projectManifest = readJson(
    join(resolvedProject, 'package.json'),
    'consumer package.json',
  )
  const rootLock = readJson(
    join(resolvedProject, 'package-lock.json'),
    'consumer root package lock',
  )
  const hiddenLock = readJson(
    join(resolvedProject, 'node_modules', '.package-lock.json'),
    'consumer hidden package lock',
  )
  const rootEntry = lockEntry(rootLock, identity.name, 'consumer root package lock')
  const hiddenEntry = lockEntry(
    hiddenLock,
    identity.name,
    'consumer hidden package lock',
  )
  const archiveName = basename(identity.archive)
  const declaration = declaredPackageLocator(projectManifest, identity.name)
  assertArchiveLocator(
    declaration.locator,
    archiveName,
    `consumer ${declaration.section}`,
  )
  assertArchiveLocator(rootEntry.resolved, archiveName, 'root lock resolved locator')
  assertArchiveLocator(
    hiddenEntry.resolved,
    archiveName,
    'hidden lock resolved locator',
  )
  for (const [label, entry] of [
    ['root lock', rootEntry],
    ['hidden lock', hiddenEntry],
  ]) {
    if (entry.integrity !== identity.integrity) {
      throw new Error(
        `${label} integrity ${String(entry.integrity)} differs from archive ` +
        `${identity.integrity}.`,
      )
    }
    if (entry.version !== identity.version) {
      throw new Error(
        `${label} version ${String(entry.version)} differs from archive ` +
        `${identity.version}.`,
      )
    }
  }
  const installedRoot = join(
    resolvedProject,
    'node_modules',
    ...identity.name.split('/'),
  )
  if (!existsSync(installedRoot)) {
    throw new Error(`Installed local package is missing: ${installedRoot}`)
  }
  const installedFingerprint = fingerprintPackageTree(installedRoot)
  if (installedFingerprint !== identity.treeFingerprint) {
    throw new Error(
      `Installed ${identity.name} tree ${installedFingerprint} differs from ` +
      `archive tree ${identity.treeFingerprint}.`,
    )
  }
  return { ...identity, installedFingerprint }
}

export function installContentAddressedLocalPackage(projectRoot, archive) {
  const resolvedProject = resolve(projectRoot)
  const identity = inspectPackageArchive(archive)
  const npm = npmInvocation()
  const tempRoot = mkdtempSync(join(tmpdir(), 'blendlink-local-install-'))
  try {
    run(
      npm.command,
      [
        ...npm.prefix,
        'install',
        identity.archive,
        '--save-exact',
        '--package-lock=true',
        '--cache',
        join(tempRoot, 'npm-cache'),
      ],
      { cwd: resolvedProject, label: `install ${identity.name} local archive` },
    )
    return verifyInstalledLocalPackage(resolvedProject, identity.archive)
  } finally {
    cleanOwnedTemp(tempRoot, 'blendlink-local-install-')
  }
}
