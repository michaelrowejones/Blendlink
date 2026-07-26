import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { verifyPackedBlendlinkLicenseContract } from './package-license-contract.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(repoRoot, 'packages', 'blendlink')
const tempRoot = mkdtempSync(join(tmpdir(), 'blendlink-package-'))
const bundledNpmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const npmExecPath = process.env.npm_execpath ?? (existsSync(bundledNpmCli) ? bundledNpmCli : undefined)
const npm = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'

function cleanTempRoot() {
  const resolved = resolve(tempRoot)
  if (
    dirname(resolved) !== resolve(tmpdir()) ||
    !basename(resolved).startsWith('blendlink-package-')
  ) {
    throw new Error(`Refusing to clean an unexpected temporary directory: ${resolved}`)
  }
  rmSync(resolved, { recursive: true, force: true })
}

try {
  const result = spawnSync(
    npm,
    [
      ...(npmExecPath ? [npmExecPath] : []),
      'pack',
      '--json',
      '--pack-destination',
      tempRoot,
      '--cache',
      join(tempRoot, 'npm-cache'),
    ],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32' && !npmExecPath,
    },
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `npm pack failed (${result.status ?? 'unknown'}):\n${result.stderr.trim()}`,
    )
  }

  let pack
  try {
    ;[pack] = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`npm pack did not return valid JSON:\n${result.stdout}`, { cause: error })
  }

  if (!pack || !Array.isArray(pack.files) || typeof pack.filename !== 'string') {
    throw new Error('npm pack did not report a file manifest')
  }

  const files = new Set(pack.files.map((file) => file.path.replaceAll('\\', '/')))
  const required = [
    'LICENSE',
    'LICENSES.md',
    'README.md',
    'assets/basis-apache-2.0.txt',
    'blender/bakelib.py',
    'dist/addon/LICENSE',
    'dist/addon/probe_authoring.py',
    'dist/addon/bakelib.py',
    'dist/addon/blender_manifest.toml',
    'dist/blender/bakelib.py',
    'dist/blender/probe_authoring.py',
    'dist/cli.js',
    'dist/index.d.ts',
    'dist/index.js',
    'dist/publish.d.ts',
    'dist/publish.js',
    'dist/react.d.ts',
    'dist/react.js',
    'dist/reactThreeFiber.d.ts',
    'dist/reactThreeFiber.js',
    'dist/threeRuntime.d.ts',
    'dist/threeRuntime.js',
    'dist/threeTextureEvidence.d.ts',
    'dist/threeTextureEvidence.js',
    'package.json',
  ]
  const missing = required.filter((path) => !files.has(path))
  if (missing.length > 0) {
    throw new Error(`Published package is missing required files:\n- ${missing.join('\n- ')}`)
  }

  const forbidden = [...files].filter((path) =>
    /(^|\/)(__pycache__|[^/]+\.test\.[^/]+)$/.test(path) ||
    /\.(pyc|pyo)$/.test(path) ||
    /(^|\/)\.DS_Store$/.test(path) ||
    /\.blendlink-(?:next|backup|stage)-/.test(path),
  )
  if (forbidden.length > 0) {
    throw new Error(`Published package contains development artifacts:\n- ${forbidden.join('\n- ')}`)
  }

  const archive = resolve(tempRoot, pack.filename)
  if (dirname(archive) !== resolve(tempRoot) || !existsSync(archive)) {
    throw new Error(`npm pack did not create its declared archive inside the test directory: ${archive}`)
  }
  const installed = join(tempRoot, 'installed-package')
  mkdirSync(installed)
  const extract = spawnSync(
    process.platform === 'win32' ? 'tar.exe' : 'tar',
    ['-xzf', archive, '-C', installed, '--strip-components=1'],
    { encoding: 'utf8', shell: false },
  )
  if (extract.error) throw extract.error
  if (extract.status !== 0) {
    throw new Error(`Could not extract the packed Blendlink archive:\n${extract.stderr.trim()}`)
  }

  verifyPackedBlendlinkLicenseContract(installed)
  const publishedManifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  const publishedAddonVersion = readFileSync(
    join(installed, 'dist', 'addon', 'blender_manifest.toml'),
    'utf8',
  ).match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  if (publishedAddonVersion !== publishedManifest.version) {
    throw new Error(
      `Packed npm ${publishedManifest.version} contains Blender addon ${String(publishedAddonVersion)}.`,
    )
  }
  const expectedOptionalPeers = {
    three: '0.184.0',
    '@types/three': '>=0.184.0 <0.185.0',
    react: '>=19.0.0 <20.0.0',
    '@react-three/fiber': '>=9.0.0 <10.0.0',
  }
  for (const [dependency, expectedRange] of Object.entries(expectedOptionalPeers)) {
    if (publishedManifest.dependencies?.[dependency]) {
      throw new Error(
        `Packed Blendlink must not own ${dependency}; the website must own its runtime universe.`,
      )
    }
    if (!publishedManifest.peerDependencies?.[dependency] ||
        publishedManifest.peerDependenciesMeta?.[dependency]?.optional !== true) {
      throw new Error(`Packed Blendlink must declare optional peer ownership for ${dependency}.`)
    }
    if (publishedManifest.peerDependencies?.[dependency] !== expectedRange) {
      throw new Error(
        `Packed Blendlink ${dependency} peer must be ${expectedRange}; got ` +
          `${String(publishedManifest.peerDependencies?.[dependency])}.`,
      )
    }
  }
  const expectedPostStack = {
    postprocessing: '6.39.3',
    n8ao: '1.10.2',
  }
  for (const [dependency, expectedVersion] of Object.entries(expectedPostStack)) {
    if (publishedManifest.dependencies?.[dependency] !== expectedVersion) {
      throw new Error(
        `Packed Blendlink must pin ${dependency} ${expectedVersion}; got ` +
          `${String(publishedManifest.dependencies?.[dependency])}.`,
      )
    }
  }

  const consumer = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'test-consumer-builds.mjs')],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        BLENDLINK_CONSUMER_PACKAGE_ROOT: installed,
        BLENDLINK_CONSUMER_PACKAGE_ARCHIVE: archive,
      },
      maxBuffer: 32 * 1024 * 1024,
    },
  )
  if (consumer.error) throw consumer.error
  if (consumer.status !== 0) {
    throw new Error(
      `Packed-package consumer verification failed (${consumer.status ?? 'unknown'}):\n` +
        `${consumer.stdout}\n${consumer.stderr}`.trim().split(/\r?\n/).slice(-40).join('\n'),
    )
  }
  if (!consumer.stdout.includes('BLENDLINK_CONSUMER_BUILDS_PASSED')) {
    throw new Error(`Packed-package consumer verification did not emit its success sentinel:\n${consumer.stdout}`)
  }

  console.log(
    `package artifact passed: ${files.size} files, ${pack.size} packed bytes, ` +
      `${pack.unpackedSize} unpacked bytes; Vanilla and R3F consumers compiled from the tarball`,
  )
} finally {
  cleanTempRoot()
}
