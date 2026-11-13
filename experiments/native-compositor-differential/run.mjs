// Generate references with compositor_color_balance_check.py, then pass one or
// more reference directories here. Tests import the actual runtime source.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeProvenance, hash, normalizeEmit } from '../../scripts/lib/runtime-provenance.mjs'

const root = resolve(import.meta.dirname, '../..')
const arguments_ = process.argv.slice(2)
let output
let built = false
let timeoutMs
const sources = []
for (let index = 0; index < arguments_.length; index++) {
  const argument = arguments_[index]
  if (argument === '--out') {
    output = arguments_[++index]
    if (!output || output.startsWith('--')) throw new Error('--out requires an evidence directory')
  } else if (argument === '--timeout-ms') {
    timeoutMs = Number(arguments_[++index])
    assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 3600000,
      '--timeout-ms requires an integer from 1000 to 3600000')
  } else if (argument === '--built') built = true
  else sources.push(argument)
}
const evidence = output ? resolve(output) : join(root, 'artifacts/verification-native-compositor', `${Date.now()}-${process.pid}`)
console.log('BLENDLINK_COMPOSITOR_EVIDENCE ' + evidence)
const { provenance, sourceRecords } = await captureRuntimeProvenance({ root, built, label: 'compositor' })
provenance.extractorSha256 = hash(await readFile(join(root, 'packages/blendlink/blender/compositor_graph.py')))
const snapshot = join(evidence, 'module-snapshot')
const moduleDirectory = join(root, 'packages/blendlink', built ? 'dist' : 'src')
const extension = built ? '.js' : '.ts'
await rm(snapshot, { recursive: true, force: true })
await mkdir(snapshot, { recursive: true })
provenance.snapshot = { directory: snapshot, mode: provenance.mode, files: [], sourceMaps: [] }
for (const entry of (await readdir(moduleDirectory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isFile() || !entry.name.endsWith(extension) || entry.name.endsWith('.test.ts')) continue
  const contents = await readFile(join(moduleDirectory, entry.name))
  await writeFile(join(snapshot, entry.name), contents)
  const record = { name: entry.name, sha256: hash(contents) }
  provenance.snapshot.files.push(record)
  if (built) {
    const name = entry.name + '.map'
    try {
      const map = await readFile(join(moduleDirectory, name))
      await writeFile(join(snapshot, name), map)
      provenance.snapshot.sourceMaps.push({ name, sha256: hash(map) })
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const guarded = provenance.modules.find(module => entry.name === module.name + extension)
  if (built) assert.ok(guarded, `Built snapshot module ${entry.name} has no guarded production source`)
  if (guarded) {
    const tested = built ? hash(normalizeEmit(contents.toString('utf8'))) : record.sha256
    assert.equal(tested, built ? guarded.emitterSha256 : guarded.sourceSha256,
      `${entry.name} changed while the immutable test snapshot was prepared; retry the run`)
    guarded.testedSnapshotSha256 = record.sha256
  }
}
assert.ok(provenance.modules.every(module => module.testedSnapshotSha256), 'The snapshot is missing an entry module')
const publicDir = join(evidence, 'browser-input')
const references = join(publicDir, 'references')
await mkdir(references, { recursive: true })
await writeFile(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2))
const directories = sources.length ? sources.map(path => resolve(path)) : [
  join(root, 'artifacts/verification-color-balance/legacy'),
  join(root, 'artifacts/verification-color-balance/modern'),
]
const cases = []
for (const [index, directory] of directories.entries()) {
  const entries = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))
  for (const entry of entries) {
    assert.match(entry.case, /^[a-z0-9_.-]+$/i, 'Reference case names must be filenames')
    const file = `${index}-${entry.case}.json`
    await copyFile(join(directory, entry.case + '.json'), join(references, file))
    cases.push({ file })
  }
}
assert.ok(cases.length, 'No native compositor references were supplied')
provenance.browserTimeoutMs = timeoutMs ?? Math.max(120000, cases.length * 250)
await writeFile(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2))
await writeFile(join(references, 'index.json'), JSON.stringify(cases))
const server = await createServer({ configFile: false, root: import.meta.dirname, publicDir,
  cacheDir: join(evidence, 'vite-cache'),
  resolve: { dedupe: ['three'], alias: { 'blendlink-compositor-under-test': join(snapshot, 'tslSourceCompositor' + extension) } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, evidence] } } })
let browser
const results = []
const failures = []
const extraBrowserArgs = JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')
assert.ok(Array.isArray(extraBrowserArgs) && extraBrowserArgs.every(value => typeof value === 'string'),
  'BLENDLINK_TEST_CHROMIUM_ARGS must be a JSON array of Chromium argument strings')
try {
  await server.listen()
  const channel = process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL || null
  assert.ok(channel === null || channel === 'chromium', 'Only the bundled chromium channel is allowed')
  const args = ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...extraBrowserArgs]
  browser = await chromium.launch({ headless: true, args, ...(channel ? { channel } : {}) })
  provenance.browserChannel = channel
  provenance.browserVersion = browser.version()
  provenance.browserLaunchArgs = args
  provenance.harnessSha256 = Object.fromEntries(await Promise.all(['browser.ts', 'run.mjs', 'relative-resize.ts'].map(async name =>
    [name, hash(await readFile(join(import.meta.dirname, name)))])))
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage()
    const errors = []
    const consoleErrors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text())
      else if (message.text().startsWith('BLENDLINK_COMPOSITOR_PROGRESS ')) console.log(message.text())
    })
    try {
      await page.goto(server.resolvedUrls.local[0] + '?backend=' + backend)
      await page.waitForFunction(() => window.__compositorResults || window.__compositorFailure, null,
        { timeout: provenance.browserTimeoutMs })
      const report = await page.evaluate(() => ({ rows: window.__compositorResults, failure: window.__compositorFailure,
        gpu: window.__compositorGPU }))
      results.push({ backend, ...report, pageErrors: errors, consoleErrors })
      await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2))
      assert.equal(report.failure, undefined)
      assert.deepEqual(errors, [])
      assert.deepEqual(consoleErrors, [])
      assert.equal(report.rows.length, cases.length)
      for (const row of report.rows) {
        assert.equal(row.backend, backend)
        assert.ok(!row.error && Number.isFinite(row.max) && row.max <= 2e-5, JSON.stringify(row))
        if (row.exactAlpha) assert.equal(row.channels[3], 0, 'Compositor alpha differs from its exact native reference')
      }
      console.log(`BLENDLINK_NATIVE_COMPOSITOR_PASSED ${backend} mode=${provenance.mode} cases=${report.rows.length} max=${Math.max(...report.rows.map(row => row.max))}`)
    } catch (error) {
      failures.push(`${backend}: ${error.message}`)
      if (!results.some(result => result.backend === backend)) {
        let progress
        try { progress = await page.evaluate(() => window.__compositorProgress) } catch { /* page unavailable */ }
        results.push({ backend, error: String(error), pageErrors: errors, consoleErrors, progress })
      }
      await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2))
    } finally { await page.close() }
  }
  assert.equal(failures.length, 0, failures.join('\n'))
} finally {
  await browser?.close()
  await server.close()
  // The proof names the immutable copied bytes. Changes made by another agent
  // during the run are recorded separately; they cannot hot-reload the test.
  provenance.workspaceChangesDuringRun = []
  for (const record of [...provenance.snapshot.files, ...provenance.snapshot.sourceMaps]) {
    let current = null
    try { current = hash(await readFile(join(moduleDirectory, record.name))) } catch { /* removed after capture */ }
    if (current !== record.sha256) provenance.workspaceChangesDuringRun.push({
      name: record.name, testedSha256: record.sha256, currentSha256: current,
    })
  }
  provenance.workspaceSourceChangesDuringRun = []
  for (const record of sourceRecords) {
    let current = null
    try { current = hash(await readFile(record.source)) } catch { /* removed after capture */ }
    const captured = hash(record.contents)
    if (current !== captured) provenance.workspaceSourceChangesDuringRun.push({
      name: record.name + '.ts', testedSha256: captured, currentSha256: current,
    })
  }
  await writeFile(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2))
}
