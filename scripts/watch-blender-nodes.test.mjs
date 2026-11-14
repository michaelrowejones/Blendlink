import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFile as callbackExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { buildIdentity } from './lib/blender-build-discovery.mjs'
import { digest, catalogNodes } from './lib/blender-node-changes.mjs'
import { watchBlenderNodes, validateWatchConfig, executeWatchCommand, planUnqualifiedPorts } from './watch-blender-nodes.mjs'
const execFile = promisify(callbackExecFile), repository = fileURLToPath(new URL('../', import.meta.url))
const baselineCommit = '02f0899d78e374b63e7181d9061e1f7ab03419cc', baselineTree = 'e05e50cc9d58ca09b36a8ed9352c489092436fe1', targetCommit = 'abcdef123456' + 'a'.repeat(28), targetTree = 'b'.repeat(40)
const source = 'source/blender/nodes/shader/nodes/node_shader_squeeze.cc'
const manifest = { ...JSON.parse(await readFile(join(repository, 'node-ports/squeeze.json'), 'utf8')), upstream: { direct: [source], shared: [] } }
const config = () => ({ schemaVersion: 1, repository: 'https://github.com/blender/blender.git', baseline: { commit: baselineCommit, tree: baselineTree, version: [5, 3, 0], catalog: 'docs/baseline.json' }, portsDirectory: 'node-ports' })
const catalog = (commit, version) => ({ schemaVersion: 1, blenderVersionTuple: version, blenderBuildHash: commit.slice(0, 12), socketSchemas: { default: { inputs: [], outputs: [] } }, domains: { shader: { nodes: [{ id: 'ShaderNodeSqueeze', contexts: ['root'], defaultSocketSchema: 'default', contextSocketSchemas: { root: 'default' }, enums: {}, enumStateExploration: { status: 'complete' } }], unavailable: [] }, compositor: { nodes: [], unavailable: [] } } })
function discovery(same = false) {
  const commit = same ? baselineCommit : targetCommit, version = same ? '5.3.0' : '5.4.0', hash = commit.slice(0, 12), name = `blender-${version}-alpha+main.${hash}-linux.x86_64-release.tar.xz`
  const value = { schemaVersion: 1, kind: 'blender-build-discovery', selection: { app: 'Blender', branch: 'main', platform: 'linux', architecture: 'x86_64' }, build: { version, versionTuple: version.split('.').map(Number), releaseCycle: 'alpha', hash, fileMtime: 100 }, source: { repository: 'blender/blender', commit, tree: same ? baselineTree : targetTree }, archive: { url: 'https://cdn.builder.blender.org/download/daily/' + name, fileName: name, sizeBytes: 100, checksumUrl: 'https://cdn.builder.blender.org/download/daily/' + name + '.sha256', sha256: 'c'.repeat(64) }, qualification: 'unqualified' }
  value.identity = { algorithm: 'sha256', value: buildIdentity(value) }; return value
}
const writeJson = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)) }
async function fixture(t, controls = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'blendlink-watch-test-')); t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'repository'), output = join(directory, 'evidence'), configPath = join(root, 'config.json')
  await writeJson(configPath, config()); await writeJson(join(root, 'docs/baseline.json'), catalog(baselineCommit, [5, 3, 0])); await writeJson(join(root, 'node-ports/squeeze.json'), manifest)
  const calls = [], found = discovery(controls.sameRevision)
  // This fixture deliberately supplies fake Git/native identities. Only sequencing,
  // source-only comparison, file ownership and protocol composition are proved here.
  const run = async (file, args, options) => {
    calls.push({ file, args, options }); let stdout = ''
    if (controls.failStep && args.includes(controls.failStep)) throw new Error('Deliberate fixture phase failure')
    if (file === 'git') {
      const directory = args[1], base = directory.endsWith('baseline-source'), commit = base ? baselineCommit : found.source.commit, tree = base ? baselineTree : found.source.tree
      assert.equal(options.env.GIT_LFS_SKIP_SMUDGE, '1'); assert.equal(options.env.GIT_CONFIG_GLOBAL, '/dev/null')
      const operation = args.slice(2)
      if (operation[0] === 'fetch' || operation.includes('fetch')) assert.ok(operation.includes(commit))
      if (operation[0] === 'rev-parse') stdout = operation[1] === 'HEAD' ? (controls.wrongCommit ? 'f'.repeat(40) : commit) : operation[1] === 'HEAD^{tree}' ? tree : directory
      if (operation[0] === 'remote' && operation[1] === 'get-url') stdout = 'https://github.com/blender/blender.git'
      if (operation[0] === 'status') stdout = controls.dirty ? ' M altered.cc\n' : ''
    } else if (args[0].endsWith('/discover-blender-build.mjs')) await writeJson(args[args.indexOf('--output') + 1], found)
    else if (args[0].endsWith('/acquire-blender-build.mjs')) {
      const work = args[args.indexOf('--work-dir') + 1], executable = join(work, 'unit-fixture', 'blender'); await mkdir(dirname(executable), { recursive: true })
      // Exercise the real launcher/supervisor against an explicit non-Blender
      // fixture. This proves process ordering and receipts, not Python or nodes.
      await writeFile(executable, '#!' + process.execPath + '\n' +
        'const fs=require("node:fs");const args=process.argv.slice(2);const first=args.findIndex(x=>["--python","--python-expr","-P"].includes(x));' +
        'if(args[first]!=="--python-expr"||!args[first+1].startsWith("import sys; sys.pycache_prefix=")||!args[first+1].endsWith("; sys.dont_write_bytecode=True"))process.exit(9);' +
        'const prefix=JSON.parse(args[first+1].slice("import sys; sys.pycache_prefix=".length,-"; sys.dont_write_bytecode=True".length));if(!fs.existsSync(prefix))process.exit(10);' +
        'fs.writeFileSync(args[args.indexOf("--catalog-output")+1],JSON.stringify(' + JSON.stringify(catalog(found.source.commit, controls.wrongCatalog ? [9, 0, 0] : found.build.versionTuple)) + '));\n', { mode: 0o700 })
      await writeJson(args[args.indexOf('--output') + 1], { ...found, kind: 'blender-build-acquisition', native: { versionTuple: found.build.versionTuple, buildHash: found.build.hash, executable } })
    } else if (args.includes('--catalog-output')) return executeWatchCommand(file, args, options)
    else if (args[0].endsWith('/node-ports.mjs') && args[1] === 'snapshot') {
      const directory = args[args.indexOf('--source-dir') + 1], base = directory.endsWith('baseline-source'), cat = args.includes('--catalog') ? JSON.parse(await readFile(args[args.indexOf('--catalog') + 1], 'utf8')) : null
      const value = { schemaVersion: 1, collectorVersion: 1, kind: 'blendlink-blender-node-source-snapshot-v1', sourceRevision: base ? baselineCommit : found.source.commit, watchScope: ['unit-fixture'], files: { [source]: 'unchanged-watched-source-bytes' }, nodeSources: { ShaderNodeSqueeze: [source] }, sourceDependencies: {}, catalogIdentity: cat ? { version: cat.blenderVersionTuple, build: cat.blenderBuildHash } : null, catalogNodes: cat ? catalogNodes(cat) : null }
      await writeJson(args[args.indexOf('--output') + 1], { ...value, inputDigest: digest(value) })
    } else if (args[0].endsWith('/node-ports.mjs')) {
      // Exercise the actual diff/packet/scaffold CLI on the fixture snapshots.
      const result = await execFile(process.execPath, [join(repository, 'scripts/node-ports.mjs'), ...args.slice(1)], { encoding: 'utf8' }); stdout = result.stdout
    } else throw new Error('Unexpected fixture command ' + file)
    await writeFile(options.stdoutPath, stdout || 'UNIT_FIXTURE_NOT_NATIVE_PROOF\n', { flag: 'wx' }); await writeFile(options.stderrPath, '', { flag: 'wx' })
    return { stdout, stderr: '', exitCode: 0 }
  }
  return { root, output, config: configPath, cacheDir: join(directory, 'cache'), calls, run, found }
}

test('watch config fixes official source origin and prevents escaping baseline/manifest inputs', () => {
  validateWatchConfig(config())
  for (const change of [value => { value.repository = 'https://evil.example/repo' }, value => { value.baseline.commit = 'v5.3.0' }, value => { value.baseline.tree = 'short' }, value => { value.baseline.catalog = '../outside' }, value => { value.portsDirectory = '/outside' }, value => { value.extraCommand = 'echo anything' }]) { const value = config(); change(value); assert.throws(() => validateWatchConfig(value)) }
})

test('new source revision always gets actual native capture even when all watched files are unchanged', async t => {
  const value = await fixture(t), report = await watchBlenderNodes(value, { run: value.run })
  assert.equal(report.status, 'observed-needs-review'); assert.equal(report.sourceRevisionChanged, true); assert.equal(report.nativeCatalog.captured, true); assert.equal(report.productionCases, 0); assert.equal(report.supportPromotion, false)
  assert.equal(value.calls.filter(call => call.args[0]?.endsWith('/discover-blender-build.mjs')).length, 1)
  assert.equal(value.calls.filter(call => call.args[0]?.endsWith('/acquire-blender-build.mjs')).length, 1)
  assert.equal(value.calls.filter(call => call.args.includes('--catalog-output')).length, 1)
  const proof = report.nativeCatalogPython.proof
  assert.equal(proof.complete, true); assert.equal(proof.numericalCredit, false); assert.equal(proof.pythonInvocations, 1)
  const invocation = proof.invocations[0].result
  assert.equal(invocation.pythonGuardApplied, true); assert.equal(invocation.cacheDisposed, true)
  await assert.rejects(readFile(invocation.cacheDirectory), { code: 'ENOENT' })
  assert.ok((await readdir(join(value.output, 'native-python-proof'))).includes('launcher.json'))
  const preliminary = JSON.parse(await readFile(join(value.output, 'source-only.workqueue.json'), 'utf8'))
  assert.equal(preliminary.nativeCatalogCompared, false); assert.ok(preliminary.items.every(item => item.reasons.every(reason => reason.kind !== 'native-node-removed')))
  const queue = JSON.parse(await readFile(join(value.output, 'workqueue.json'), 'utf8')); assert.deepEqual(queue.changedFiles, []); assert.deepEqual(queue.affectedManifestIds, ['squeeze'])
  const plan = JSON.parse(await readFile(join(value.output, 'verification-plan.json'), 'utf8')); assert.equal(plan.ports[0].status, 'needs-target-profile'); assert.equal(plan.ports[0].productionCredit, false)
  const scaffold = JSON.parse(await readFile(join(value.output, 'tasks', queue.items[0].id, 'scaffold/port-candidate.json'), 'utf8')); assert.equal(scaffold.productionCases, 0); assert.equal(scaffold.admission, 'NOT_IMPLEMENTED')
  const call = value.calls.find(call => call.args[1] === 'scaffold'); assert.ok(call.args.includes('--queue')); assert.equal(call.args[call.args.indexOf('--queue') + 1], join(value.output, 'workqueue.json'))
})

test('pre-resolved discovery is reused once and an identical baseline revision does not pretend a fresh capture', async t => {
  const value = await fixture(t, { sameRevision: true }), path = join(value.root, 'discovery.json'); await writeJson(path, value.found)
  const report = await watchBlenderNodes({ ...value, discovery: path }, { run: value.run })
  assert.equal(report.sourceRevisionChanged, false); assert.equal(report.nativeCatalog.captured, false)
  assert.equal(value.calls.filter(call => call.args[0]?.endsWith('/discover-blender-build.mjs')).length, 0); assert.equal(value.calls.filter(call => call.args.includes('--catalog-output')).length, 0)
  assert.equal(value.calls.filter(call => call.args[0]?.endsWith('/acquire-blender-build.mjs')).length, 0)
})

test('checkout commit drift and dirty source fail before acquisition, with retained failed report/log phases', async t => {
  for (const controls of [{ wrongCommit: true }, { dirty: true }]) {
    const value = await fixture(t, controls)
    await assert.rejects(watchBlenderNodes(value, { run: value.run }), /checkout commit|remain clean/)
    const report = JSON.parse(await readFile(join(value.output, 'watch-report.json'), 'utf8')); assert.equal(report.status, 'failed'); assert.equal(report.productionCredit, false)
    assert.equal(value.calls.filter(call => call.args[0]?.endsWith('/acquire-blender-build.mjs')).length, 0); assert.ok((await readdir(join(value.output, 'logs'))).length)
  }
})

test('native version mismatch and subprocess failure retain source-only evidence and never emit final success', async t => {
  for (const controls of [{ wrongCatalog: true }, { failStep: 'fetch' }, { failStep: '--catalog-output' }]) {
    const value = await fixture(t, controls)
    await assert.rejects(watchBlenderNodes(value, { run: value.run }))
    const report = JSON.parse(await readFile(join(value.output, 'watch-report.json'), 'utf8')); assert.equal(report.status, 'failed'); assert.equal(report.supportPromotion, false)
    if (controls.wrongCatalog) assert.ok((await readdir(value.output)).includes('source-only.workqueue.json'))
    assert.ok(!(await readdir(value.output)).includes('workqueue.json'))
    if (controls.failStep === '--catalog-output') {
      assert.equal(report.nativeCatalogPython.proof.complete, false)
      assert.equal(report.nativeCatalogPython.proof.numericalCredit, false)
    }
  }
})

test('an existing evidence directory is preserved before any discovery or mutation', async t => {
  const value = await fixture(t); await mkdir(value.output); await writeFile(join(value.output, 'artist-owned'), 'keep')
  await assert.rejects(watchBlenderNodes(value, { run: value.run }), /EEXIST/); assert.equal(value.calls.length, 0); assert.equal(await readFile(join(value.output, 'artist-owned'), 'utf8'), 'keep')
})

test('even an available declared version profile earns no automatic production credit', () => {
  const plan = planUnqualifiedPorts([manifest], { affectedManifestIds: ['squeeze'] }, discovery(true))
  assert.equal(plan.ports[0].status, 'needs-fresh-qualified-verification'); assert.equal(plan.productionCredit, false); assert.equal(plan.productionCases, 0)
})

test('command execution uses literal argv, retains both streams and reports a nonzero exit', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blendlink-watch-command-')); t.after(() => rm(directory, { recursive: true, force: true }))
  const stdoutPath = join(directory, 'stdout.log'), stderrPath = join(directory, 'stderr.log'), text = '$(false); literal argument with spaces'
  const result = await executeWatchCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1]); process.stderr.write("diagnostic")', text], { cwd: directory, env: process.env, stdoutPath, stderrPath })
  assert.equal(result.stdout, text); assert.equal(await readFile(stdoutPath, 'utf8'), text); assert.equal(await readFile(stderrPath, 'utf8'), 'diagnostic')
  await assert.rejects(executeWatchCommand(process.execPath, ['-e', 'process.stderr.write("real failure");process.exit(7)'], { cwd: directory, env: process.env, stdoutPath: join(directory, 'failed.stdout'), stderrPath: join(directory, 'failed.stderr') }), error => error.exitCode === 7 && /real failure/.test(error.message))
})

test('a timed-out command cannot leave a trapped child running indefinitely', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blendlink-watch-timeout-')); t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(executeWatchCommand(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},100)'], { cwd: directory, env: process.env, timeoutMs: 100, stdoutPath: join(directory, 'stdout'), stderrPath: join(directory, 'stderr') }), /timeout/)
})

test('the sparse checkout command order works on an empty owned Git worktree', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blendlink-watch-git-sequence-')); t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'source'), target = join(directory, 'target'), env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  await mkdir(join(source, 'source/blender/nodes'), { recursive: true }); await mkdir(target)
  await writeFile(join(source, 'CMakeLists.txt'), 'project(fixture)\n'); await writeFile(join(source, 'source/blender/nodes/fixture.cc'), '// fixture\n')
  const git = (path, args) => execFile('git', ['-C', path, ...args], { env, encoding: 'utf8' })
  await git(source, ['init', '--quiet']); await git(source, ['add', '.']); await git(source, ['-c', 'user.name=Unit Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'])
  const commit = (await git(source, ['rev-parse', 'HEAD'])).stdout.trim()
  await git(target, ['init', '--quiet']); await git(target, ['remote', 'add', 'origin', source]); await git(target, ['fetch', '--no-tags', '--depth=1', 'origin', commit])
  await git(target, ['sparse-checkout', 'set', '--cone', '--skip-checks', 'source/blender/nodes', 'source/future-missing'])
  await git(target, ['checkout', '--quiet', '--detach', commit])
  assert.equal((await git(target, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout, ''); assert.equal(await readFile(join(target, 'source/blender/nodes/fixture.cc'), 'utf8'), '// fixture\n')
})
