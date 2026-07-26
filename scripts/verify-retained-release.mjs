import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyPackedBlendlinkLicenseContract } from './package-license-contract.mjs'

const PACKAGE_LICENSE = 'SEE LICENSE IN LICENSES.md'
const ADDON_LICENSE = 'GPL-3.0-or-later'
const FILE_LICENSES = Object.freeze(['MIT', 'GPL-3.0-or-later', 'Apache-2.0'])
const FULL_SHA256 = /^[0-9a-f]{64}$/
const FULL_COMMIT = /^[0-9a-f]{40}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function fail(message) {
  throw new Error(`Retained release verification failed: ${message}`)
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`)
  return value
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function sha1(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

function sha512Integrity(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`
}

function run(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    fail(
      `${label} failed${result.status === null ? '' : ` (${result.status})`}: ` +
      `${result.error?.message ?? `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()}`,
    )
  }
  return result.stdout ?? ''
}

function assertSafeArchiveEntries(entries, prefix, label) {
  if (entries.length === 0) fail(`${label} is empty`)
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/')
    const parts = normalized.split('/').filter(Boolean)
    if (entry.includes('\\') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) ||
        parts.includes('..') || (prefix && !normalized.startsWith(prefix))) {
      fail(`${label} contains unsafe or unexpected path ${JSON.stringify(entry)}`)
    }
  }
}

function extractNpmArchive(archive, destination) {
  const entries = run('tar', ['-tzf', archive], 'npm archive listing')
    .split(/\r?\n/).filter(Boolean)
  assertSafeArchiveEntries(entries, 'package/', 'npm archive')
  run('tar', ['-xzf', archive, '-C', destination, '--strip-components=1'], 'npm archive extraction')
}

function extractAddonArchive(archive, destination) {
  let listing = spawnSync('unzip', ['-Z1', archive], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  })
  let extractor = ['unzip', ['-qq', archive, '-d', destination]]
  if (listing.error?.code === 'ENOENT') {
    listing = spawnSync('tar', ['-tf', archive], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    })
    extractor = ['tar', ['-xf', archive, '-C', destination]]
  }
  if (listing.error || listing.status !== 0) {
    fail(`Blender archive listing failed: ${listing.error?.message ?? listing.stderr ?? listing.stdout}`)
  }
  assertSafeArchiveEntries(
    (listing.stdout ?? '').split(/\r?\n/).filter(Boolean),
    '',
    'Blender archive',
  )
  run(extractor[0], extractor[1], 'Blender archive extraction')
}

function assertFullGplText(text, label) {
  for (const fragment of [
    'GNU GENERAL PUBLIC LICENSE',
    'Version 3, 29 June 2007',
    'END OF TERMS AND CONDITIONS',
  ]) {
    if (!text.includes(fragment)) fail(`${label} is missing ${fragment}`)
  }
}

function includedAddonRuntimePath(path) {
  const normalized = path.split(sep).join('/')
  const parts = normalized.split('/')
  const name = parts.at(-1) ?? ''
  return !parts.some((part) => part === '__pycache__' || part === '.git' || part === 'tests') &&
    !name.endsWith('.pyc') && !name.endsWith('.zip') && !name.endsWith('_test.py')
}

function fingerprintAddonTree(root) {
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const name = relative(root, path)
      if (!includedAddonRuntimePath(name)) continue
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(name)
    }
  }
  visit(root)
  files.sort((left, right) => {
    const a = left.split(sep).join('/')
    const b = right.split(sep).join('/')
    return a < b ? -1 : a > b ? 1 : 0
  })
  const hash = createHash('sha256')
  for (const name of files) {
    const normalized = name.split(sep).join('/')
    const fileHash = createHash('sha256').update(readFileSync(join(root, name))).digest('hex')
    hash.update(normalized, 'utf8').update('\0').update(fileHash, 'ascii').update('\n')
  }
  return hash.digest('hex')
}

function expectedRepositoryUrl(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    fail(`repository must be an owner/name pair, got ${JSON.stringify(repository)}`)
  }
  return `git+https://github.com/${repository}.git`
}

function assertRepositoryUrl(value, repository, label) {
  const url = typeof value === 'string' ? value : object(value, label).url
  const expected = expectedRepositoryUrl(repository)
  if (url !== expected) {
    fail(`${label} must exactly identify ${expected}; got ${String(url)}`)
  }
}

export function verifyReleaseManifestContract(manifestValue, expected) {
  const manifest = object(manifestValue, 'release manifest')
  if (manifest.schemaVersion !== 1) fail(`release manifest schemaVersion must be 1`)
  if (manifest.version !== expected.version) fail(`manifest version does not match ${expected.version}`)
  const source = object(manifest.source, 'release manifest source')
  if (!FULL_COMMIT.test(expected.commit) || source.commit !== expected.commit) {
    fail(`manifest source commit does not match ${expected.commit}`)
  }
  if (source.dirty !== false) fail(`manifest must identify a clean source tree`)
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 2) {
    fail(`manifest must identify exactly one npm and one Blender artifact`)
  }
  const byKind = new Map(manifest.artifacts.map((artifact) => [artifact?.kind, artifact]))
  if (byKind.size !== 2 || !byKind.has('npm') || !byKind.has('blender-extension')) {
    fail(`manifest artifact kinds must be exactly npm and blender-extension`)
  }
  const npm = object(byKind.get('npm'), 'npm artifact')
  const addon = object(byKind.get('blender-extension'), 'Blender artifact')
  if (npm.filename !== `blendlink-${expected.version}.tgz`) fail(`npm artifact filename is not version-derived`)
  if (addon.filename !== `blendlink-addon-${expected.version}.zip`) fail(`Blender artifact filename is not version-derived`)
  if (npm.license !== PACKAGE_LICENSE || npm.licenseMap !== 'LICENSES.md' ||
      JSON.stringify(npm.fileLicenses) !== JSON.stringify(FILE_LICENSES)) {
    fail(`npm artifact license manifest is not the reviewed mixed-license contract`)
  }
  if (addon.license !== ADDON_LICENSE) fail(`Blender artifact license must be ${ADDON_LICENSE}`)
  for (const [label, artifact] of [['npm', npm], ['Blender', addon]]) {
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) fail(`${label} artifact byte count is invalid`)
    if (!FULL_SHA256.test(artifact.sha256)) fail(`${label} artifact SHA-256 is invalid`)
    if (!FULL_SHA256.test(artifact.addonFingerprint)) fail(`${label} add-on fingerprint is invalid`)
  }
  if (npm.addonFingerprint !== addon.addonFingerprint) fail(`npm and Blender add-on fingerprints differ`)
  if (typeof npm.integrity !== 'string' || !npm.integrity.startsWith('sha512-')) {
    fail(`npm artifact integrity must be SHA-512 SRI`)
  }
  return { manifest, npm, addon }
}

export function verifyChecksumContract(text, artifacts) {
  const expected = artifacts.map((artifact) => `${artifact.sha256}  ${artifact.filename}`).join('\n') + '\n'
  if (text !== expected) fail(`SHA256SUMS does not exactly match the two manifest artifacts`)
}

function assertDirectoryFiles(directory, expectedNames) {
  const actual = readdirSync(directory, { withFileTypes: true })
  if (actual.some((entry) => !entry.isFile())) fail(`release directory must contain files only`)
  const names = actual.map((entry) => entry.name).sort()
  const expected = [...expectedNames].sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    fail(`release directory files differ; expected ${expected.join(', ')}, got ${names.join(', ')}`)
  }
}

export function verifyRetainedReleaseDirectory({ directory, version, commit, repository }) {
  if (!VERSION.test(version)) fail(`version is not release SemVer: ${version}`)
  if (!FULL_COMMIT.test(commit)) fail(`commit must be a full lowercase Git SHA-1`)
  expectedRepositoryUrl(repository)
  const root = resolve(directory)
  const manifestPath = join(root, 'release-manifest.json')
  const checksumPath = join(root, 'SHA256SUMS')
  const contract = verifyReleaseManifestContract(
    readJson(manifestPath, 'release manifest'),
    { version, commit },
  )
  const artifacts = [contract.npm, contract.addon]
  assertDirectoryFiles(root, [
    contract.npm.filename,
    contract.addon.filename,
    'release-manifest.json',
    'SHA256SUMS',
  ])
  verifyChecksumContract(readFileSync(checksumPath, 'utf8'), artifacts)
  for (const artifact of artifacts) {
    const path = join(root, artifact.filename)
    if (!existsSync(path) || !statSync(path).isFile()) fail(`missing artifact ${artifact.filename}`)
    if (statSync(path).size !== artifact.bytes) fail(`${artifact.filename} byte count differs from manifest`)
    if (sha256(path) !== artifact.sha256) fail(`${artifact.filename} SHA-256 differs from manifest`)
  }
  if (sha512Integrity(join(root, contract.npm.filename)) !== contract.npm.integrity) {
    fail(`${contract.npm.filename} SHA-512 SRI differs from manifest`)
  }

  const work = mkdtempSync(join(tmpdir(), 'blendlink-release-verify-'))
  try {
    const npmRoot = join(work, 'npm')
    const addonRoot = join(work, 'addon')
    mkdirSync(npmRoot)
    mkdirSync(addonRoot)
    extractNpmArchive(join(root, contract.npm.filename), npmRoot)
    extractAddonArchive(join(root, contract.addon.filename), addonRoot)

    const packageJson = readJson(join(npmRoot, 'package.json'), 'packed package manifest')
    if (packageJson.name !== 'blendlink' || packageJson.version !== version) {
      fail(`packed package identity must be blendlink@${version}`)
    }
    assertRepositoryUrl(packageJson.repository, repository, 'packed package repository')
    const packedLicense = verifyPackedBlendlinkLicenseContract(npmRoot)
    if (JSON.stringify(packedLicense) !== JSON.stringify({
      license: PACKAGE_LICENSE,
      licenseMap: 'LICENSES.md',
      fileLicenses: [...FILE_LICENSES],
    })) fail(`packed package license verification returned an unexpected contract`)

    const npmAddonRoot = join(npmRoot, 'dist', 'addon')
    const npmAddonManifest = readFileSync(join(npmAddonRoot, 'blender_manifest.toml'), 'utf8')
    const addonManifest = readFileSync(join(addonRoot, 'blender_manifest.toml'), 'utf8')
    for (const [label, text] of [['npm add-on', npmAddonManifest], ['Blender archive', addonManifest]]) {
      if (!/^id\s*=\s*"blendlink"/m.test(text) ||
          !new RegExp(`^version\\s*=\\s*"${version.replaceAll('.', '\\.')}"`, 'm').test(text) ||
          !/^license\s*=\s*\["SPDX:GPL-3\.0-or-later"\]/m.test(text)) {
        fail(`${label} manifest identity, version, or license differs`)
      }
    }
    assertFullGplText(readFileSync(join(npmAddonRoot, 'LICENSE'), 'utf8'), 'npm add-on license')
    assertFullGplText(readFileSync(join(addonRoot, 'LICENSE'), 'utf8'), 'Blender archive license')
    const npmFingerprint = fingerprintAddonTree(npmAddonRoot)
    const addonFingerprint = fingerprintAddonTree(addonRoot)
    if (npmFingerprint !== contract.npm.addonFingerprint ||
        addonFingerprint !== contract.addon.addonFingerprint) {
      fail(`retained add-on trees differ from their manifest fingerprint`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return contract
}

export function verifyRegistryContract({ metadata, downloadedArchive, retainedArchive, contract, repository }) {
  const registry = object(metadata, 'npm registry metadata')
  if (registry.name !== 'blendlink' || registry.version !== contract.manifest.version) {
    fail(`npm registry identity differs from blendlink@${contract.manifest.version}`)
  }
  assertRepositoryUrl(registry.repository, repository, 'npm registry repository')
  const dist = object(registry.dist, 'npm registry dist metadata')
  const expectedTarballUrl =
    `https://registry.npmjs.org/blendlink/-/blendlink-${contract.manifest.version}.tgz`
  if (dist.tarball !== expectedTarballUrl) fail(`npm registry tarball URL differs from ${expectedTarballUrl}`)
  if (dist.integrity !== contract.npm.integrity) fail(`npm registry SRI differs from retained manifest`)
  if (dist.shasum !== sha1(retainedArchive)) fail(`npm registry SHA-1 differs from retained tarball`)
  if (sha256(downloadedArchive) !== contract.npm.sha256 ||
      !readFileSync(downloadedArchive).equals(readFileSync(retainedArchive))) {
    fail(`npm registry tarball bytes differ from the retained tarball`)
  }
  const attestations = object(dist.attestations, 'npm registry attestations')
  const expectedAttestationUrl =
    `https://registry.npmjs.org/-/npm/v1/attestations/blendlink@${contract.manifest.version}`
  if (attestations.url !== expectedAttestationUrl ||
      attestations.provenance?.predicateType !== 'https://slsa.dev/provenance/v1') {
    fail(`npm registry metadata has no SLSA v1 provenance attestation`)
  }
  const publisher = registry._npmUser
  if (publisher?.name !== 'GitHub Actions' || publisher.trustedPublisher?.id !== 'github' ||
      typeof publisher.trustedPublisher?.oidcConfigId !== 'string' ||
      !publisher.trustedPublisher.oidcConfigId.startsWith('oidc:')) {
    fail(`npm registry metadata does not identify GitHub Actions trusted publishing`)
  }
}

export function verifyGithubReleaseContract({
  release,
  directory,
  downloadedDirectory,
  version,
  commit,
  state,
}) {
  const value = object(release, 'GitHub release metadata')
  if (value.tag_name !== `v${version}` || value.target_commitish !== commit) {
    fail(`GitHub release tag or target commit differs from the candidate`)
  }
  if (value.prerelease !== true) fail(`GitHub public-beta release must remain a prerelease`)
  if (state === 'draft' && value.draft !== true) fail(`GitHub release must be a draft before npm publication`)
  if (state === 'published' && value.draft !== false) fail(`GitHub release was not published`)
  if (value.draft === false && value.immutable !== true) {
    fail(`published GitHub release is not protected by immutable releases`)
  }
  if (state !== 'any' && state !== 'draft' && state !== 'published') fail(`invalid GitHub release state ${state}`)
  const root = resolve(directory)
  const expectedNames = [
    `blendlink-${version}.tgz`,
    `blendlink-addon-${version}.zip`,
    'release-manifest.json',
    'SHA256SUMS',
  ]
  if (!Array.isArray(value.assets) || value.assets.length !== expectedNames.length) {
    fail(`GitHub release must contain exactly the four retained release files`)
  }
  const assets = new Map(value.assets.map((asset) => [asset?.name, asset]))
  if (assets.size !== expectedNames.length || expectedNames.some((name) => !assets.has(name))) {
    fail(`GitHub release asset names differ from the retained release files`)
  }
  for (const name of expectedNames) {
    const path = join(root, name)
    const asset = object(assets.get(name), `GitHub release asset ${name}`)
    if (asset.state !== 'uploaded' || asset.size !== statSync(path).size ||
        asset.digest !== `sha256:${sha256(path)}`) {
      fail(`GitHub release asset ${name} size, state, or SHA-256 differs`)
    }
  }
  if (downloadedDirectory !== undefined) {
    const downloadedRoot = resolve(downloadedDirectory)
    assertDirectoryFiles(downloadedRoot, expectedNames)
    for (const name of expectedNames) {
      if (!readFileSync(join(downloadedRoot, name)).equals(readFileSync(join(root, name)))) {
        fail(`downloaded GitHub release asset ${name} differs from the retained file`)
      }
    }
  }
  return value.draft ? 'draft' : 'published'
}

function parseArguments(argv) {
  const [mode, ...rest] = argv
  if (!['retained', 'registry', 'github'].includes(mode)) fail(`mode must be retained, registry, or github`)
  const values = { mode }
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (!flag?.startsWith('--') || value === undefined || values[flag.slice(2)] !== undefined) {
      fail(`arguments must be unique --name value pairs`)
    }
    values[flag.slice(2)] = value
  }
  return values
}

function required(args, name) {
  return string(args[name], `--${name}`)
}

function main(argv) {
  const args = parseArguments(argv)
  const common = {
    directory: required(args, 'directory'),
    version: required(args, 'version'),
    commit: required(args, 'commit'),
    repository: required(args, 'repository'),
  }
  const contract = verifyRetainedReleaseDirectory(common)
  if (args.mode === 'registry') {
    verifyRegistryContract({
      metadata: readJson(required(args, 'metadata'), 'npm registry metadata'),
      downloadedArchive: required(args, 'archive'),
      retainedArchive: join(resolve(common.directory), contract.npm.filename),
      contract,
      repository: common.repository,
    })
  } else if (args.mode === 'github') {
    const releaseState = verifyGithubReleaseContract({
      release: readJson(required(args, 'metadata'), 'GitHub release metadata'),
      directory: common.directory,
      downloadedDirectory: args.downloads,
      version: common.version,
      commit: common.commit,
      state: required(args, 'state'),
    })
    console.log(`BLENDLINK_GITHUB_RELEASE_VERIFIED ${releaseState}`)
    return
  }
  console.log(`BLENDLINK_RETAINED_RELEASE_VERIFIED ${common.version} ${args.mode}`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2))
}
