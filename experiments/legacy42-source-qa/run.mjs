// Source-only native QA: deliberately no build, CLI discovery or ZIP install.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..'), tests = join(root, 'packages/blender-addon/tests')
const blender = process.env.BLENDLINK_BLENDER; assert.ok(blender, 'Set the verified Blender4.2 executable')
const evidence = resolve(process.env.BLENDLINK_LEGACY_QA_EVIDENCE || join(root, 'artifacts/legacy42-remaining-source'))
mkdirSync(evidence, { recursive: true })
const native = execFileSync(blender, ['--version'], { encoding: 'utf8' })
assert.match(native, /Blender 4\.2\.0/); assert.match(native, /a51f293548ad/)
const only = process.argv.indexOf('--only'), requested = only < 0 ? null : process.argv[only + 1]?.split(',')
if (only >= 0) assert.ok(requested?.length)
const suites = [], manual = []
for (const file of readdirSync(tests).filter(name => name.endsWith('.py')).sort()) {
  if (file <= 'desktop_task_check.py') continue
  const source = readFileSync(join(tests, file), 'utf8')
  const optOut = source.match(/^#\s*blendlink-headless-suite:\s*manual\s*(.*)$/m)
  if (optOut) { manual.push({ file, reason: optOut[1] }); continue }
  const emitted = [...source.matchAll(/(?:print|oracle\.finish)\(\s*f?["'](BLENDLINK_[A-Z0-9_]+)/g)].map(match => match[1])
  const declared = source.match(/^#\s*blendlink-headless-sentinel:\s*(BLENDLINK_[A-Z0-9_]+)\s*$/m)?.[1]
  assert.ok(emitted.length, file + ' has no success sentinel')
  if (declared) assert.ok(emitted.includes(declared))
  suites.push({ file, sentinel: declared ?? emitted.at(-1) })
}
if (requested) for (const file of requested) assert.ok(suites.some(suite => suite.file === file), 'Unknown/non-source suite ' + file)
const selected = suites.filter(suite => !requested || requested.includes(suite.file))
  .sort((a, b) => Number(a.file === 'run_headless.py') - Number(b.file === 'run_headless.py'))
const rows = [], report = join(evidence, 'report.json')
const initialHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const sourceHashes = Object.fromEntries(['packages/blender-addon', 'packages/blendlink/blender'].flatMap(directory =>
  readdirSync(join(root, directory)).filter(name => name.endsWith('.py')).map(name => {
    const path = join(directory, name); return [path, hash(join(root, path))]
  })))
const fixtureHashes = Object.fromEntries(selected.map(({ file }) => [file, hash(join(tests, file))]))
function save(complete = false) {
  writeFileSync(report, JSON.stringify({ kind: 'isolated native source suites; no installed ZIP/build/numeric browser proof',
    native, blender, initialHead, sourceHashes, fixtureHashes, scope: 'Alphabetically after desktop_task_check.py, omnibus last',
    selected: selected.map(suite => suite.file), manual, complete, rows,
    workspaceStable: Object.entries(sourceHashes).every(([file, digest]) => hash(join(root, file)) === digest)
      && Object.entries(fixtureHashes).every(([file, digest]) => hash(join(tests, file)) === digest),
  }, null, 2))
}
save()
for (const suite of selected) {
  const started = Date.now(), logFile = join(evidence, suite.file + '.log'), output = createWriteStream(logFile)
  const resources = join(evidence, 'resources', suite.file); mkdirSync(resources, { recursive: true })
  const process_ = spawn(blender, ['--background', '--factory-startup', '-t', '1', '--python-exit-code', '1',
    '--python-expr', 'import _cycles; _cycles.set_device_override("CPU")', '--python', join(tests, suite.file)], {
    cwd: join(root, 'packages/blender-addon'), env: { ...process.env, BLENDER_USER_RESOURCES: resources, BLENDLINK_TEST_CYCLES_DEVICE: 'CPU' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let timedOut = false, force
  const timer = setTimeout(() => { timedOut = true; process_.kill('SIGTERM'); force = setTimeout(() => process_.kill('SIGKILL'), 2000) }, 900_000)
  for (const stream of [process_.stdout, process_.stderr]) stream.on('data', data => output.write(data))
  const result = await new Promise(resolve => {
    process_.once('error', error => resolve({ error: String(error) }))
    process_.once('close', (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(timer); clearTimeout(force); await new Promise(resolve => output.end(resolve))
  const text = readFileSync(logFile, 'utf8'), sentinel = text.includes(suite.sentinel)
  const forbidden = ['Code marked as unreachable has been executed.', 'source\\blender\\makesrna\\intern\\rna_mesh.cc:1549'].filter(phrase => text.includes(phrase))
  const passed = !timedOut && !result.error && result.code === 0 && !result.signal && sentinel && !forbidden.length
  const row = { file: suite.file, ...result, timedOut, sentinel: suite.sentinel, sentinelObserved: sentinel,
    notApplicableMarkers: [...new Set(text.match(/BLENDLINK_[A-Z0-9_]+_(?:UNAVAILABLE|NOT_APPLICABLE)\b/g) ?? [])],
    forbidden, passed, durationMs: Date.now() - started, logFile, fixtureSha256: hash(join(tests, suite.file)) }
  rows.push(row); save()
  console.log('BLENDLINK_LEGACY_SOURCE_' + (passed ? 'PASSED ' : 'FAILED ') + JSON.stringify(row))
  if (!passed) console.log(text.trim().split(/\r?\n/).slice(-22).join('\n'))
}
save(true)
console.log('BLENDLINK_LEGACY_SOURCE_COMPLETE ' + JSON.stringify({ cases: rows.length, passed: rows.filter(row => row.passed).length, failures: rows.filter(row => !row.passed).map(row => row.file) }))
if (rows.some(row => !row.passed)) process.exitCode = 1
