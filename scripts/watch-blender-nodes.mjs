#!/usr/bin/env node
// Read-only upstream observation. No port verifier, support promotion or posting.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, lstat, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { validateDiscovery } from './lib/blender-build-discovery.mjs'
import { WATCHED_SOURCE_ROOTS, OPTIONAL_SOURCE_ROOTS } from './lib/blender-node-changes.mjs'

const defaultRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
const OFFICIAL_REPOSITORY = 'https://github.com/blender/blender.git'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const ownedPath = (root, path) => { const name = relative(root, path); return name && name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name) }
async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, path)
}
function relativePath(value) { return typeof value === 'string' && value.length > 0 && !isAbsolute(value) && !value.startsWith('-') && !value.includes('\\') && !value.split('/').some(part => part === '..' || part === '.' || !part) }
export function validateWatchConfig(value) {
  assert.ok(record(value) && value.schemaVersion === 1, 'Expected watch config schema1')
  assert.deepEqual(Object.keys(value).sort(), ['baseline', 'portsDirectory', 'repository', 'schemaVersion'])
  assert.equal(value.repository, OFFICIAL_REPOSITORY, 'Source checkout must use the fixed official Blender repository')
  assert.ok(record(value.baseline)); assert.deepEqual(Object.keys(value.baseline).sort(), ['catalog', 'commit', 'tree', 'version'])
  for (const name of ['commit', 'tree']) assert.match(value.baseline[name], /^[a-f0-9]{40}$/, 'Use full exact baseline commit/tree')
  assert.ok(Array.isArray(value.baseline.version) && value.baseline.version.length === 3 && value.baseline.version.every(number => Number.isSafeInteger(number) && number >= 0))
  assert.ok(relativePath(value.baseline.catalog) && relativePath(value.portsDirectory), 'Catalog/port inputs must be repository-relative paths')
  return value
}
async function repositoryPath(root, name, directory = false) {
  const path = resolve(root, name), info = await lstat(path), actual = await realpath(path)
  assert.ok(ownedPath(root, actual) && !info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile()), 'Watch input must be a plain owned repository ' + (directory ? 'directory' : 'file'))
  return path
}
function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' }
}

export async function executeWatchCommand(file, args, { cwd, env, timeoutMs = 15 * 60_000, stdoutPath, stderrPath } = {}) {
  assert.ok(typeof file === 'string' && Array.isArray(args) && args.every(arg => typeof arg === 'string'), 'Commands must use an executable and argv array')
  return new Promise((resolvePromise, reject) => {
    const stdout = createWriteStream(stdoutPath, { flags: 'wx' }), stderr = createWriteStream(stderrPath, { flags: 'wx' })
    const grouped = process.platform !== 'win32'
    const child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: grouped })
    let output = '', errors = '', bytes = 0, failure, escalation
    const kill = signal => { try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal) } catch (error) { if (error.code !== 'ESRCH') failure ??= error } }
    const stop = message => {
      failure ??= new Error(message); kill('SIGTERM')
      escalation ??= setTimeout(() => kill('SIGKILL'), 1000)
    }
    const timer = setTimeout(() => stop('Command exceeded its timeout'), timeoutMs)
    const watch = (stream, destination, isError) => {
      stream.on('data', chunk => { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) stop('Command exceeded its log byte budget'); if (isError) errors = (errors + chunk.toString('utf8')).slice(-16 * 1024); else if (output.length < 128 * 1024) output += chunk.toString('utf8').slice(0, 128 * 1024 - output.length) })
      stream.pipe(destination)
    }
    watch(child.stdout, stdout, false); watch(child.stderr, stderr, true)
    stdout.on('error', error => { failure ??= error; stop('Cannot retain stdout log') }); stderr.on('error', error => { failure ??= error; stop('Cannot retain stderr log') })
    child.on('error', error => { failure ??= error })
    child.on('close', async (code, signal) => {
      clearTimeout(timer); clearTimeout(escalation)
      try {
        await Promise.all([new Promise(done => stdout.closed ? done() : stdout.once('close', done)), new Promise(done => stderr.closed ? done() : stderr.once('close', done))])
        if (failure || code !== 0) { const error = failure ?? new Error(`Command exited ${code ?? signal}: ${errors.trim().slice(-2000)}`); error.exitCode = code; error.signal = signal; throw error }
        resolvePromise({ stdout: output, stderr: errors, exitCode: code })
      } catch (error) { reject(error) }
    })
  })
}

export function planUnqualifiedPorts(manifests, queue, discovery) {
  return { schemaVersion: 1, kind: 'blendlink-node-watch-verification-plan-v1', targetCommit: discovery.source.commit, targetVersion: discovery.build.version,
    supportPromotion: false, productionCases: 0, productionCredit: false, policy: 'Observation only. Declared profiles are candidates, not proof. No native/browser numerical verifier was executed.',
    ports: manifests.filter(port => queue.affectedManifestIds.includes(port.id)).map(port => {
      const declared = (port.profiles ?? []).filter(profile => profile.blenderVersion === discovery.build.version).map(profile => profile.id)
      return { id: port.id, nativeNode: port.nativeNode, domain: port.domain, status: declared.length ? 'needs-fresh-qualified-verification' : 'needs-target-profile', declaredVersionProfiles: declared, productionCredit: false, productionCases: 0 }
    }) }
}

export async function watchBlenderNodes(options, { run = executeWatchCommand } = {}) {
  const root = await realpath(resolve(options.root ?? defaultRoot)), configPath = resolve(options.config ?? join(root, 'config/blender-node-watch.json'))
  const configBytes = await readFile(configPath), config = validateWatchConfig(JSON.parse(configBytes.toString('utf8')))
  const catalogInput = await repositoryPath(root, config.baseline.catalog), portsInput = await repositoryPath(root, config.portsDirectory, true), catalogBytes = await readFile(catalogInput)
  const baselineCatalog = JSON.parse(catalogBytes.toString('utf8'))
  assert.deepEqual(baselineCatalog.blenderVersionTuple, config.baseline.version, 'Baseline catalog version does not match configuration')
  assert.ok(typeof baselineCatalog.blenderBuildHash === 'string' && config.baseline.commit.startsWith(baselineCatalog.blenderBuildHash), 'Baseline catalog build does not match exact source commit')
  assert.ok(options.output && options.cacheDir, 'Specify --output and --cache-dir')
  const output = resolve(options.output), cacheDir = resolve(options.cacheDir)
  assert.ok(output !== root && !ownedPath(output, root), 'Output must not contain the SceneToWeb repository')
  await mkdir(dirname(output), { recursive: true })
  // Exclusive creation makes every checkout/scaffold/log below this directory owned.
  await mkdir(output)
  const reportPath = join(output, 'watch-report.json'), work = join(output, '.work'), logs = join(output, 'logs')
  await mkdir(work); await mkdir(logs)
  const inputs = join(output, 'inputs'), catalogPath = join(inputs, 'baseline.catalog.json'), portsPath = join(inputs, 'node-ports')
  const manifestInputs = []
  const report = { schemaVersion: 1, kind: 'blendlink-blender-node-watch-v1', status: 'running', supportPromotion: false, productionCredit: false, productionCases: 0, configSha256: sha(configBytes), baselineCatalogSha256: sha(catalogBytes), manifestInputs, startedAt: new Date().toISOString(), steps: [], cachePolicy: 'Archive bytes are rehashed; source/native/numeric proof is never reused.' }
  let counter = 0
  const command = async (label, file, args, extra = {}) => {
    const id = String(++counter).padStart(3, '0') + '-' + label, entry = { id, file, argv: args, cwd: extra.cwd ?? root, status: 'running', startedAt: new Date().toISOString(), stdout: 'logs/' + id + '.stdout.log', stderr: 'logs/' + id + '.stderr.log' }
    report.steps.push(entry); await writeJson(reportPath, report)
    process.stdout.write(`BLENDLINK_NODE_WATCH_STEP ${id}\n`)
    try {
      const value = await run(file, args, { cwd: root, env: process.env, ...extra, stdoutPath: join(output, entry.stdout), stderrPath: join(output, entry.stderr) })
      entry.status = 'passed'; entry.exitCode = 0; return value
    } catch (error) { entry.status = 'failed'; entry.exitCode = error.exitCode ?? null; entry.error = error.message; throw error }
    finally { entry.completedAt = new Date().toISOString(); await writeJson(reportPath, report) }
  }
  const node = (label, script, args) => command(label, process.execPath, [join(root, 'scripts', script), ...args])
  const git = (label, directory, args) => command(label, 'git', ['-C', directory, ...args], { env: gitEnvironment() })
  async function verifySource(label, directory, commit, tree) {
    const actualCommit = (await git(label + '-commit', directory, ['rev-parse', 'HEAD'])).stdout.trim(), actualTree = (await git(label + '-tree', directory, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()
    assert.equal(actualCommit, commit, 'Actual source checkout commit differs from requested build'); assert.equal(actualTree, tree, 'Actual source tree differs from the official commit tree')
    assert.equal((await git(label + '-origin', directory, ['remote', 'get-url', 'origin'])).stdout.trim(), OFFICIAL_REPOSITORY)
    assert.equal(await realpath((await git(label + '-root', directory, ['rev-parse', '--show-toplevel'])).stdout.trim()), await realpath(directory), 'Source checkout ownership changed')
    assert.equal((await git(label + '-clean', directory, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout, '', 'Source checkout must remain clean')
  }
  async function checkout(label, commit, tree) {
    const directory = join(work, label); await mkdir(directory)
    await git(label + '-init', directory, ['init', '--quiet'])
    await git(label + '-remote', directory, ['remote', 'add', 'origin', OFFICIAL_REPOSITORY])
    await git(label + '-fetch', directory, ['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'fetch', '--no-tags', '--depth=1', '--filter=blob:none', 'origin', commit])
    await git(label + '-sparse', directory, ['sparse-checkout', 'set', '--cone', '--skip-checks', ...WATCHED_SOURCE_ROOTS, ...OPTIONAL_SOURCE_ROOTS])
    await git(label + '-checkout', directory, ['checkout', '--quiet', '--detach', commit])
    await verifySource(label, directory, commit, tree)
    return directory
  }
  try {
    await mkdir(inputs); await mkdir(portsPath)
    await writeFile(join(inputs, 'watch-config.json'), configBytes, { flag: 'wx' }); await writeFile(catalogPath, catalogBytes, { flag: 'wx' })
    for (const entry of (await readdir(portsInput, { withFileTypes: true })).filter(file => file.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(entry.isFile(), 'Port manifests must be plain files')
      const bytes = await readFile(join(portsInput, entry.name)); await writeFile(join(portsPath, entry.name), bytes, { flag: 'wx' }); manifestInputs.push({ file: entry.name, sha256: sha(bytes) })
    }
    const discoveryPath = join(output, 'discovery.json')
    if (options.discovery) { const discovery = validateDiscovery(await json(resolve(options.discovery))); await writeJson(discoveryPath, discovery) }
    else await node('discover', 'discover-blender-build.mjs', ['--output', discoveryPath])
    const discovery = validateDiscovery(await json(discoveryPath)); report.discoveryIdentity = discovery.identity.value; report.targetCommit = discovery.source.commit; await writeJson(reportPath, report)
    const baselineSource = await checkout('baseline-source', config.baseline.commit, config.baseline.tree), targetSource = await checkout('target-source', discovery.source.commit, discovery.source.tree)
    const baselineSnapshot = join(output, 'baseline.snapshot.json'), preliminarySnapshot = join(output, 'target.source-only.snapshot.json'), preliminaryQueue = join(output, 'source-only.workqueue.json')
    await node('baseline-snapshot', 'node-ports.mjs', ['snapshot', '--source-dir', baselineSource, '--catalog', catalogPath, '--output', baselineSnapshot])
    await node('target-source-snapshot', 'node-ports.mjs', ['snapshot', '--source-dir', targetSource, '--output', preliminarySnapshot])
    await node('source-only-diff', 'node-ports.mjs', ['diff', '--before', baselineSnapshot, '--after', preliminarySnapshot, '--ports-dir', portsPath, '--output', preliminaryQueue])
    // Revision, not watched-file changes, controls actual binary/catalog capture.
    const revisionChanged = config.baseline.commit !== discovery.source.commit
    report.sourceRevisionChanged = revisionChanged
    let targetCatalogPath = catalogPath
    if (revisionChanged) {
      const acquiredPath = join(output, 'acquired.json'), nativeWork = join(work, 'native')
      await node('acquire', 'acquire-blender-build.mjs', ['--discovery', discoveryPath, '--cache-dir', cacheDir, '--work-dir', nativeWork, '--output', acquiredPath])
      const acquired = await json(acquiredPath)
      assert.equal(acquired.kind, 'blender-build-acquisition'); assert.equal(acquired.qualification, 'unqualified'); assert.deepEqual(acquired.source, discovery.source); assert.equal(acquired.identity.value, discovery.identity.value)
      assert.deepEqual(acquired.native.versionTuple, discovery.build.versionTuple); assert.ok(discovery.source.commit.startsWith(acquired.native.buildHash))
      const executable = await realpath(acquired.native.executable); assert.ok(ownedPath(await realpath(nativeWork), executable), 'Acquired executable is outside owned extraction')
      assert.ok((await lstat(acquired.native.executable)).isFile(), 'Acquired executable is not a regular file')
      targetCatalogPath = join(output, 'target.catalog.json')
      await command('native-catalog', executable, ['--background', '--factory-startup', '-t', '1', '--python-exit-code', '1', '--python', join(root, 'scripts/audit-node-coverage.py'), '--', '--catalog-output', targetCatalogPath], { timeoutMs: 30 * 60_000, env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' } })
      const catalog = await json(targetCatalogPath)
      assert.equal(catalog.schemaVersion, 1); assert.deepEqual(catalog.blenderVersionTuple, discovery.build.versionTuple, 'Actual catalog version differs from acquired binary')
      assert.equal(catalog.blenderBuildHash, acquired.native.buildHash, 'Actual native catalog build differs from the acquired binary')
      assert.notEqual(catalog.selection?.completeInventory, false, 'A focused partial catalog cannot stand in for full native inventory')
      report.nativeCatalog = { captured: true, path: 'target.catalog.json', sha256: sha(await readFile(targetCatalogPath)), buildHash: catalog.blenderBuildHash }
    } else report.nativeCatalog = { captured: false, reason: 'The source revision equals the exact baseline; baseline native catalog retained.' }
    await verifySource('baseline-final', baselineSource, config.baseline.commit, config.baseline.tree); await verifySource('target-final', targetSource, discovery.source.commit, discovery.source.tree)
    const targetSnapshot = join(output, 'target.snapshot.json'), queuePath = join(output, 'workqueue.json'), packets = join(output, 'tasks')
    await node('target-native-snapshot', 'node-ports.mjs', ['snapshot', '--source-dir', targetSource, '--catalog', targetCatalogPath, '--output', targetSnapshot])
    await node('native-source-diff', 'node-ports.mjs', ['diff', '--before', baselineSnapshot, '--after', targetSnapshot, '--ports-dir', portsPath, '--output', queuePath, '--packet-dir', packets])
    const queue = await json(queuePath)
    assert.equal(queue.requiresNativeCatalog, false, 'Final queue requires an actual complete native comparison')
    assert.ok(queue.items.length <= 10_000, 'Unexpected workqueue size')
    for (const item of queue.items) {
      assert.match(item.id, /^[a-f0-9]{16}$/); assert.equal(item.supportPromotion, false)
      if (item.nativeNode) await node('scaffold-' + item.id, 'node-ports.mjs', ['scaffold', '--queue', queuePath, '--work-item', join(packets, item.id, 'work-item.json'), '--output', join(packets, item.id, 'scaffold')])
    }
    const manifests = []
    for (const entry of (await readdir(portsPath, { withFileTypes: true })).filter(file => file.name.endsWith('.json'))) { assert.ok(entry.isFile()); manifests.push(await json(join(portsPath, entry.name))) }
    await writeJson(join(output, 'verification-plan.json'), planUnqualifiedPorts(manifests, queue, discovery))
    report.status = 'observed-needs-review'; report.workItems = queue.items.length; report.queueDigest = queue.inputDigest; report.affectedManifestIds = queue.affectedManifestIds
    report.completedAt = new Date().toISOString(); await writeJson(reportPath, report)
    return report
  } catch (error) {
    report.status = 'failed'; report.error = { name: error.name, message: error.message, stack: error.stack }; report.completedAt = new Date().toISOString(); await writeJson(reportPath, report)
    throw error
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), options = {}, keys = { '--config': 'config', '--output': 'output', '--cache-dir': 'cacheDir', '--discovery': 'discovery' }
    assert.equal(args.length % 2, 0, 'Flags require values')
    for (let index = 0; index < args.length; index += 2) { const key = keys[args[index]], value = args[index + 1]; assert.ok(key && value && !value.startsWith('--') && !Object.hasOwn(options, key), 'Unknown/duplicate/missing flag'); options[key] = value }
    const result = await watchBlenderNodes(options); process.stdout.write(JSON.stringify({ status: result.status, supportPromotion: false, productionCases: 0, workItems: result.workItems }) + '\n')
  } catch (error) { process.stderr.write('BLENDLINK_NODE_WATCH_FAILED: ' + error.message + '\n'); process.exitCode = 1 }
}
