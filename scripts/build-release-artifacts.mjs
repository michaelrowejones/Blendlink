import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { verifyPackedBlendlinkLicenseContract } from './package-license-contract.mjs'

const root = resolve(import.meta.dirname, '..')
const packageRoot = join(root, 'packages', 'blendlink')
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const addonSource = join(packageRoot, 'dist', 'addon')
const addonManifest = readFileSync(join(addonSource, 'blender_manifest.toml'), 'utf8')
const addonVersion = addonManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const addonLicense = addonManifest.match(/^license\s*=\s*\["SPDX:([^"]+)"\]/m)?.[1]
const version = packageJson.version
const allowDirty = process.argv.includes('--allow-dirty')

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || addonVersion !== version) {
  throw new Error(`Release identity mismatch: npm ${String(version)}, Blender ${String(addonVersion)}`)
}
if (packageJson.license !== 'SEE LICENSE IN LICENSES.md' ||
    addonLicense !== 'GPL-3.0-or-later') {
  throw new Error(
    `Release license mismatch: npm ${String(packageJson.license)}, Blender ${String(addonLicense)}`,
  )
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `${options.label ?? basename(command)} failed${result.status === null ? '' : ` (${result.status})`}:\n` +
        `${result.error?.message ?? `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()}`,
    )
  }
  return result.stdout ?? ''
}

const dirty = run('git', ['status', '--porcelain=v1'], { label: 'git status' }).trim().length > 0
if (dirty && !allowDirty) {
  throw new Error(
    'Release artifacts require a clean worktree. Commit the reviewed source first, or use ' +
      '--allow-dirty only for a local, unpublished rehearsal whose manifest records dirty=true.',
  )
}

const outputParent = join(root, 'artifacts', 'release')
const outputRoot = resolve(outputParent, version)
if (dirname(outputRoot) !== resolve(outputParent) || basename(outputRoot) !== version) {
  throw new Error(`Refusing to use unexpected release directory: ${outputRoot}`)
}
mkdirSync(outputRoot, { recursive: true })

const npmArchive = join(outputRoot, `blendlink-${version}.tgz`)
const addonArchive = join(outputRoot, `blendlink-addon-${version}.zip`)
const releaseManifestPath = join(outputRoot, 'release-manifest.json')
const checksumPath = join(outputRoot, 'SHA256SUMS')
for (const path of [npmArchive, addonArchive, releaseManifestPath, checksumPath]) {
  rmSync(path, { force: true })
}

const tempRoot = mkdtempSync(join(tmpdir(), 'blendlink-release-'))
try {
  const bundledNpmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const npmExecPath = process.env.npm_execpath ?? (existsSync(bundledNpmCli) ? bundledNpmCli : undefined)
  const npmCommand = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const packOutput = run(npmCommand, [
    ...(npmExecPath ? [npmExecPath] : []),
    'pack', '--json', '--pack-destination', outputRoot, '--cache', join(tempRoot, 'npm-cache'),
  ], { cwd: packageRoot, label: 'npm pack' })
  const [packed] = JSON.parse(packOutput)
  if (!packed || packed.filename !== basename(npmArchive) || !existsSync(npmArchive)) {
    throw new Error(`npm pack did not create the expected retained archive ${npmArchive}`)
  }
  const forbidden = packed.files.map((entry) => entry.path.replaceAll('\\', '/')).filter((path) =>
    /(^|\/)(__pycache__|[^/]+\.test\.[^/]+)$/.test(path) ||
    /\.(pyc|pyo)$/.test(path) ||
    /(^|\/)\.DS_Store$/.test(path),
  )
  if (forbidden.length) {
    throw new Error(`Retained npm archive contains development artifacts:\n- ${forbidden.join('\n- ')}`)
  }
  const extractedPackage = join(tempRoot, 'npm-package')
  mkdirSync(extractedPackage)
  run(process.platform === 'win32' ? 'tar.exe' : 'tar', [
    '-xzf', npmArchive, '-C', extractedPackage, '--strip-components=1',
  ], { label: 'retained npm extraction' })
  const packedLicenseContract = verifyPackedBlendlinkLicenseContract(extractedPackage)
  const { fingerprintBlenderAddonTree } = await import(pathToFileURL(
    join(extractedPackage, 'dist', 'addon.js'),
  ).href)
  const sourceAddonFingerprint = fingerprintBlenderAddonTree(addonSource)
  const npmAddonFingerprint = fingerprintBlenderAddonTree(
    join(extractedPackage, 'dist', 'addon'),
  )
  if (sourceAddonFingerprint !== npmAddonFingerprint) {
    throw new Error(
      `Packed npm add-on tree ${npmAddonFingerprint} differs from source ${sourceAddonFingerprint}`,
    )
  }
  const consumerOutput = run(process.execPath, [join(root, 'scripts', 'test-consumer-builds.mjs')], {
    label: 'retained npm consumer builds',
    env: {
      ...process.env,
      BLENDLINK_CONSUMER_PACKAGE_ROOT: extractedPackage,
      BLENDLINK_CONSUMER_PACKAGE_ARCHIVE: npmArchive,
    },
  })
  if (!consumerOutput.includes('BLENDLINK_CONSUMER_BUILDS_PASSED')) {
    throw new Error('Retained npm consumer builds emitted no success sentinel')
  }

  const discovery = run(process.execPath, [join(packageRoot, 'dist', 'cli.js'), 'discover'], {
    label: 'Blendlink Blender discovery',
  })
  const blender = discovery.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!blender || !existsSync(blender)) throw new Error('Blendlink discovery returned no Blender executable')

  const resources = join(tempRoot, 'blender-resources')
  mkdirSync(resources, { recursive: true })
  const blenderEnvironment = { ...process.env, BLENDER_USER_RESOURCES: resources }
  run(blender, [
    '--command', 'extension', 'build', '--source-dir', addonSource,
    '--output-filepath', addonArchive,
  ], { env: blenderEnvironment, label: 'Blender extension build' })
  if (!existsSync(addonArchive)) throw new Error(`Blender did not create ${addonArchive}`)
  run(blender, [
    '--command', 'extension', 'validate', '--valid-tags=', addonArchive,
  ], { env: blenderEnvironment, label: 'Blender extension validation' })
  run(blender, [
    '--command', 'extension', 'install-file', '-r', 'user_default', '-e', addonArchive,
  ], { env: blenderEnvironment, label: 'retained Blender extension install' })

  const probe = `
import bpy, hashlib, importlib, json, tomllib
from pathlib import Path
name = "bl_ext.user_default.blendlink"
repo = next(item for item in bpy.context.preferences.extensions.repos if item.module == "user_default")
manifest = Path(repo.directory) / "blendlink" / "blender_manifest.toml"
module = importlib.import_module(name)
tree = hashlib.sha256()
runtime_files = []
for path in (Path(repo.directory) / "blendlink").rglob("*"):
    if not path.is_file():
        continue
    relative = path.relative_to(Path(repo.directory) / "blendlink")
    if any(part in {"__pycache__", ".git", "tests"} for part in relative.parts):
        continue
    if relative.name.endswith((".pyc", ".zip", "_test.py")):
        continue
    runtime_files.append((relative.as_posix(), path))
for relative, path in sorted(runtime_files):
    tree.update(relative.encode("utf8"))
    tree.update(b"\\0")
    tree.update(hashlib.sha256(path.read_bytes()).hexdigest().encode("ascii"))
    tree.update(b"\\n")
print("##blendlink-retained-addon " + json.dumps({
    "enabled": name in bpy.context.preferences.addons,
    "operator": hasattr(bpy.ops.blendlink, "setup_website_export"),
    "package": bool(module.__file__),
    "version": tomllib.loads(manifest.read_text(encoding="utf8"))["version"],
    "fingerprint": tree.hexdigest(),
}, sort_keys=True))
`
  const probeResult = spawnSync(blender, [
    '--background', '--python-exit-code', '1', '--python-expr', probe,
  ], {
    cwd: root,
    env: blenderEnvironment,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  })
  const probeOutput = `${probeResult.stdout ?? ''}\n${probeResult.stderr ?? ''}`
  const sentinel = probeOutput.split(/\r?\n/).find(
    (line) => line.startsWith('##blendlink-retained-addon '),
  )
  if (!sentinel) {
    throw new Error(
      `Retained Blender extension did not emit its install sentinel.\n` +
        probeOutput.trim().split(/\r?\n/).slice(-30).join('\n'),
    )
  }
  const installed = JSON.parse(sentinel.slice('##blendlink-retained-addon '.length))
  if (installed.version !== version || !installed.enabled || !installed.operator || !installed.package) {
    throw new Error(`Retained Blender extension failed postconditions: ${JSON.stringify(installed)}`)
  }
  if (installed.fingerprint !== sourceAddonFingerprint) {
    throw new Error(
      `Installed retained add-on ${String(installed.fingerprint)} differs from source ` +
        sourceAddonFingerprint,
    )
  }

  const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  const commit = run('git', ['rev-parse', 'HEAD'], { label: 'git revision' }).trim()
  const nodeVersion = process.version
  const blenderVersion = run(blender, ['--version'], {
    env: blenderEnvironment, label: 'Blender version',
  }).split(/\r?\n/)[0].trim()
  const manifest = {
    schemaVersion: 1,
    version,
    source: { commit, dirty },
    builders: { node: nodeVersion, blender: blenderVersion },
    artifacts: [
      {
        kind: 'npm', filename: basename(npmArchive),
        ...packedLicenseContract,
        bytes: statSync(npmArchive).size, sha256: sha256(npmArchive),
        integrity: packed.integrity,
        addonFingerprint: npmAddonFingerprint,
      },
      {
        kind: 'blender-extension', filename: basename(addonArchive),
        license: 'GPL-3.0-or-later', bytes: statSync(addonArchive).size,
        sha256: sha256(addonArchive),
        addonFingerprint: installed.fingerprint,
      },
    ],
  }
  writeFileSync(releaseManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(checksumPath, manifest.artifacts.map(
    (artifact) => `${artifact.sha256}  ${artifact.filename}`,
  ).join('\n') + '\n')
  console.log(`BLENDLINK_RELEASE_ARTIFACTS_READY ${releaseManifestPath}`)
} finally {
  const owned = resolve(tempRoot)
  if (dirname(owned) !== resolve(tmpdir()) || !basename(owned).startsWith('blendlink-release-')) {
    throw new Error(`Refusing to remove unexpected release temp directory: ${owned}`)
  }
  rmSync(owned, { recursive: true, force: true })
}
