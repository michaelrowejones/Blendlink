// Generate references with compositor_color_balance_check.py, then pass one or
// more reference directories here. Tests import the actual runtime source.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const arguments_ = process.argv.slice(2)
let output
let built = false
const sources = []
for (let index = 0; index < arguments_.length; index++) {
  const argument = arguments_[index]
  if (argument === '--out') {
    output = arguments_[++index]
    if (!output || output.startsWith('--')) throw new Error('--out requires an evidence directory')
  } else if (argument === '--built') built = true
  else sources.push(argument)
}
const evidence = output ? resolve(output) : join(root, 'artifacts/verification-native-compositor', `${Date.now()}-${process.pid}`)
console.log('BLENDLINK_COMPOSITOR_EVIDENCE ' + evidence)
const hash = content => createHash('sha256').update(content).digest('hex')
const normalizeEmit = content => content.replaceAll('\r\n', '\n').replace(/^\/\/# sourceMappingURL=.*$/gm, '').trimEnd()
const configuration = ts.readConfigFile(join(root, 'packages/blendlink/tsconfig.json'), ts.sys.readFile)
if (configuration.error) throw new Error(ts.flattenDiagnosticMessageText(configuration.error.messageText, '\n'))
const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, join(root, 'packages/blendlink'))
const provenance = { mode: built ? 'built' : 'source', typescript: ts.version, modules: [] }
for (const name of ['tslSourceCompositor', 'tslNodeRecipe']) {
  const source = join(root, 'packages/blendlink/src', name + '.ts')
  const emitted = join(root, 'packages/blendlink/dist', name + '.js')
  const contents = await readFile(source, 'utf8')
  // These package modules are ESM. Transpile independently and compare emitted
  // bytes, so a recently touched but stale dist file cannot satisfy the gate.
  const expected = normalizeEmit(ts.transpileModule(contents, { fileName: source,
    compilerOptions: { ...parsed.options, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, sourceMap: false, declaration: false } }).outputText)
  let actual, emittedTime
  try { actual = normalizeEmit(await readFile(emitted, 'utf8')); emittedTime = (await stat(emitted)).mtimeMs }
  catch (error) { if (built) throw new Error(`Missing built compositor module ${name}; run npm run build first`, { cause: error }) }
  const sourceTime = (await stat(source)).mtimeMs
  const record = { name, sourceSha256: hash(contents), expectedEmitterSha256: hash(expected),
    emitterSha256: actual === undefined ? null : hash(actual),
    sourceMtimeMs: sourceTime, emitterMtimeMs: emittedTime ?? null,
    emitterMatchesSource: actual === expected }
  provenance.modules.push(record)
  if (built) {
    assert.ok(emittedTime >= sourceTime, `${name} dist predates source; rebuild before --built verification`)
    assert.ok(actual === expected, `${name} emitted JavaScript differs from current source; rebuild before --built verification`)
  }
}
provenance.extractorSha256 = hash(await readFile(join(root, 'packages/blendlink/blender/compositor_graph.py')))
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
await writeFile(join(references, 'index.json'), JSON.stringify(cases))
const server = await createServer({ configFile: false, root: import.meta.dirname, publicDir,
  cacheDir: join(evidence, 'vite-cache'),
  resolve: { dedupe: ['three'], alias: { 'blendlink-compositor-under-test': join(root,
    built ? 'packages/blendlink/dist/tslSourceCompositor.js' : 'packages/blendlink/src/tslSourceCompositor.ts') } },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } })
let browser
const results = []
const failures = []
const extraBrowserArgs = JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')
assert.ok(Array.isArray(extraBrowserArgs) && extraBrowserArgs.every(value => typeof value === 'string'),
  'BLENDLINK_TEST_CHROMIUM_ARGS must be a JSON array of Chromium argument strings')
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...extraBrowserArgs] })
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage()
    const errors = []
    const consoleErrors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    try {
      await page.goto(server.resolvedUrls.local[0] + '?backend=' + backend)
      await page.waitForFunction(() => window.__compositorResults || window.__compositorFailure, null, { timeout: 60000 })
      const report = await page.evaluate(() => ({ rows: window.__compositorResults, failure: window.__compositorFailure }))
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
      if (!results.some(result => result.backend === backend)) results.push({ backend, error: String(error), pageErrors: errors, consoleErrors })
      await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2))
    } finally { await page.close() }
  }
  assert.equal(failures.length, 0, failures.join('\n'))
} finally { await browser?.close(); await server.close() }
