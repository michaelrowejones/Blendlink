// Run an explicitly pinned current-version lane without replacing legacy gates.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyReleaseProfileOutput, closeReleaseProfileWorkspace, validateReleaseNativeIdentity, validateReleaseProfile } from './lib/release-profile.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const args = process.argv.slice(2), options = {}
for (let index = 0; index < args.length; index++) {
  const flag = args[index]
  assert.ok(['--blender', '--evidence', '--preflight-only'].includes(flag), `Unknown option ${flag}`)
  assert.ok(!Object.hasOwn(options, flag), `Duplicate option ${flag}`)
  if (flag === '--preflight-only') options[flag] = true
  else { assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), `Missing value for ${flag}`); options[flag] = args[++index] }
}
assert.ok(options['--blender'] && options['--evidence'], 'Use --blender PATH --evidence NEW_DIRECTORY [--preflight-only]')
assert.ok(!process.env.BLENDLINK_HEADLESS_ONLY, 'A release profile cannot use a focused headless-suite filter')
const profile = validateReleaseProfile(JSON.parse(readFileSync(join(root, 'config/release-profiles/blender-5.3-macos-arm64.json'), 'utf8')))
const evidence = resolve(options['--evidence'])
assert.ok(!existsSync(evidence), 'Evidence directory must be new; never overwrite an earlier run')
mkdirSync(evidence, { recursive: true })
const commands = []
let identity, source, result
function run(label, executable, argv, env) {
  const start = Date.now()
  const child = spawnSync(executable, argv, { cwd: root, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    timeout: label === 'full-contract' ? 60 * 60 * 1000 : 60_000, windowsHide: true })
  const stdout = child.stdout ?? '', stderr = child.stderr ?? ''
  writeFileSync(join(evidence, label + '.stdout.log'), stdout)
  writeFileSync(join(evidence, label + '.stderr.log'), stderr)
  commands.push({ label, executable, argv, exitCode: child.status, signal: child.signal,
    error: child.error?.message ?? null, durationMs: Date.now() - start,
    stdoutSha256: hash(stdout), stderrSha256: hash(stderr) })
  return { ...child, output: stdout + '\n' + stderr }
}
try {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' })
  assert.equal(commit.status, 0); assert.equal(dirty.status, 0)
  source = { commit: commit.stdout.trim(), trackedDirty: Boolean(dirty.stdout.trim()),
    profileSha256: hash(JSON.stringify(profile)), runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    policySha256: hash(readFileSync(new URL('./lib/release-profile.mjs', import.meta.url))) }
  assert.ok(options['--preflight-only'] || !source.trackedDirty, 'Full contract requires committed, tracked-clean source')
  if (!options['--preflight-only']) {
    for (const file of ['package.json', 'scripts/test-release-profile.mjs', 'scripts/probe-release-blender.py',
      'scripts/lib/release-profile.mjs', 'config/release-profiles/blender-5.3-macos-arm64.json',
      'packages/blender-addon/tests/run_headless.py', 'packages/blender-addon/procedural.py']) {
      const committed = spawnSync('git', ['show', `HEAD:${file}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
      assert.ok(committed.status === 0 && hash(committed.stdout) === hash(readFileSync(join(root, file))),
        `Release gate source must be committed: ${file}`)
    }
  }
  const resources = join(evidence, 'blender-user-resources'); mkdirSync(resources)
  const env = { ...process.env, BLENDLINK_BLENDER: resolve(options['--blender']), BLENDLINK_TEST_CYCLES_DEVICE: profile.cyclesDevice,
    BLENDER_USER_RESOURCES: resources, LC_ALL: 'C', LANG: 'C' }
  const probe = run('native-identity', env.BLENDLINK_BLENDER, ['--background', '--factory-startup', '--disable-autoexec',
    '--python-exit-code', '1', '--python', join(root, 'scripts/probe-release-blender.py')], env)
  assert.equal(probe.status, 0, `Native identity probe failed: ${probe.error?.message ?? probe.output.slice(-1000)}`)
  const rows = probe.output.split(/\r?\n/).filter(line => line.startsWith('SCENETOWEB_RELEASE_NATIVE_IDENTITY '))
  assert.equal(rows.length, 1, 'Expected exactly one native identity record')
  identity = validateReleaseNativeIdentity(JSON.parse(rows[0].slice('SCENETOWEB_RELEASE_NATIVE_IDENTITY '.length)), profile,
    { platform: process.platform, architecture: process.arch })
  if (options['--preflight-only']) result = classifyReleaseProfileOutput({ exitCode: 0, output: '', preflightOnly: true })
  else {
    assert.ok(process.env.npm_execpath, 'Launch the complete lane with npm run test:release-profile')
    const child = run('full-contract', process.execPath, [process.env.npm_execpath, 'run', 'test:full'], env)
    result = classifyReleaseProfileOutput({ exitCode: child.status, signal: child.signal, output: child.output,
      profile, identity, host: { platform: process.platform, architecture: process.arch },
      policySourceHashes: Object.fromEntries(['run_headless.py', 'procedural.py'].map(file => [file,
        hash(readFileSync(join(root, 'packages/blender-addon', file === 'run_headless.py' ? 'tests/' + file : file)))])) })
    const end = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' })
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
    assert.equal(end.status, 0); assert.equal(head.status, 0)
    result = closeReleaseProfileWorkspace(result, { sourceCommit: source.commit,
      currentCommit: head.stdout.trim(), trackedChanges: end.stdout })
  }
} catch (error) {
  result = { ...(result ?? classifyReleaseProfileOutput({ exitCode: 1, output: '' })),
    status: 'failed', completeLocalContract: false, error: error.message }
} finally {
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), profile, source, identity, commands, ...result }
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, completeLocalContract: report.completeLocalContract, evidence }))
  if (!['preflight-passed', 'local-contract-passed'].includes(report.status)) process.exitCode = 1
}
