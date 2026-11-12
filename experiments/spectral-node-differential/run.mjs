import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '../..')
const evidence = resolve(process.env.BLENDLINK_SPECTRAL_EVIDENCE || join(root, 'artifacts/verification-spectral-nodes'))
const references = join(evidence, 'reference')
mkdirSync(evidence, { recursive: true })
rmSync(join(evidence, 'report.json'), { force: true })
const built = process.argv.includes('--built')
const snapshot = join(evidence, 'module-snapshot-' + Date.now() + '-' + process.pid)
const nativeSnapshot = join(snapshot, 'native')
mkdirSync(nativeSnapshot, { recursive: true })
const copied = {}
for (const file of readdirSync(join(root, built ? 'packages/blendlink/dist' : 'packages/blendlink/src'))) {
  if (!file.endsWith(built ? '.js' : '.ts') || file.endsWith('.test.ts')) continue
  const content = readFileSync(join(root, built ? 'packages/blendlink/dist' : 'packages/blendlink/src', file))
  writeFileSync(join(snapshot, file), content)
  copied[file] = createHash('sha256').update(content).digest('hex')
}
for (const directory of ['packages/blendlink/blender', 'packages/blender-addon'])
  for (const file of readdirSync(join(root, directory))) {
    if (!file.endsWith('.py') && !file.endsWith('.json')) continue
    copyFileSync(join(root, directory, file), join(nativeSnapshot, file))
  }
const nativeReference = join(nativeSnapshot, '__spectral_reference__.py')
copyFileSync(join(import.meta.dirname, 'reference.py'), nativeReference)
const testedNativeModuleHashes = Object.fromEntries(readdirSync(nativeSnapshot).filter(file => /\.(py|json)$/.test(file))
  .map(file => [file, createHash('sha256').update(readFileSync(join(nativeSnapshot, file))).digest('hex')]))
const sources = ['packages/blendlink/src/tslNodeRecipe.ts', 'packages/blendlink/src/tslSpectralNodes.ts',
  'packages/blender-addon/tsl_ir.py', 'packages/blender-addon/spectral_ir.py', 'packages/blender-addon/spectral_tables.json']
const hash = file => createHash('sha256').update(readFileSync(join(root, file))).digest('hex')
const sourceHashes = Object.fromEntries(sources.map(file => [file, hash(file)]))
if (built) for (const name of ['tslNodeRecipe', 'tslSpectralNodes'])
  assert.ok(statSync(join(root, `packages/blendlink/dist/${name}.js`)).mtimeMs >=
    statSync(join(root, `packages/blendlink/src/${name}.ts`)).mtimeMs, 'Build before testing emitted spectral nodes')
if (!process.argv.includes('--reuse-reference')) {
  const blender = process.env.BLENDLINK_BLENDER || execFileSync(process.execPath,
    [join(root, 'packages/blendlink/dist/cli.js'), 'discover'], { encoding: 'utf8' }).trim().split(/\r?\n/).at(-1)
  assert.ok(blender && existsSync(blender))
  const log = execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1',
    '--python', nativeReference], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, BLENDLINK_SPECTRAL_REFERENCES: references, BLENDLINK_SPECTRAL_NATIVE_MODULES: nativeSnapshot } })
  writeFileSync(join(evidence, 'reference.log'), log)
  assert.match(log, /BLENDLINK_SPECTRAL_REFERENCES_PASSED/)
}
const manifest = JSON.parse(readFileSync(join(references, 'index.json'), 'utf8'))
const size = manifest.size
const floats = buffer => new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
const server = await createServer({ configFile: false, root: join(root, 'experiments/tsl-node-differential'),
  cacheDir: join(evidence, 'vite-cache'), logLevel: 'warn', optimizeDeps: { noDiscovery: true },
  resolve: { alias: { '@blendlink-tsl-recipe': join(snapshot, 'tslNodeRecipe.' + (built ? 'js' : 'ts')) } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root] } } })
let browser
const rows = [], failures = []
try {
  await server.listen()
  const args = JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')
  assert.ok(Array.isArray(args) && args.every(value => typeof value === 'string'))
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...args] })
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(server.resolvedUrls.local[0] + (backend === 'webgl2' ? '?backend=webgl2' : ''))
    const initialized = await page.evaluate(() => window.__tslDiffInit())
    assert.equal(initialized.error, null)
    assert.equal(initialized.backend, backend === 'webgpu')
    let flip = false, calibration = 0
    const nativeHalfModels = new Set(['nearest-even', 'toward-zero'])
    for (const cell of manifest.cases) {
      const rendered = await page.evaluate(({ id, path }) => window.__tslDiffRun(id, 'ir', path, false, null, null),
        { id: cell.id, path: '/@fs/' + join(references, 'ir', cell.id + '.json') })
      assert.ok(rendered.ok, `${backend}/${cell.id}: ${rendered.error}`)
      assert.deepEqual(errors, [], `${backend}/${cell.id} shader/browser errors`)
      const actual = floats(Buffer.from(rendered.base64, 'base64'))
      const expected = floats(readFileSync(join(references, cell.id + '.f32')))
      assert.equal(expected.length, size * size * 3)
      assert.equal(actual.length, size * size * rendered.components)
      const halfUlp = value => Math.max(2 ** (Math.floor(Math.log2(Math.abs(value) || 2 ** -14)) - 10), 2 ** -24)
      const measure = (flipped, tolerance = Infinity) => {
        let maximum = 0, sum = 0, maximumRatio = 0, renderPrecisionAllowance = 0
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let channel = 0; channel < 3; channel++) {
          const value = actual[(y * size + x) * rendered.components + channel]
          assert.ok(Number.isFinite(value))
          const reference = expected[(((flipped ? size - 1 - y : y) * size + x) * 3) + channel]
          const error = Math.abs(value - reference)
          const precision = cell.engine === 'CYCLES' ? 0 : halfUlp(reference)
          renderPrecisionAllowance = Math.max(renderPrecisionAllowance, precision)
          maximumRatio = Math.max(maximumRatio, error / (tolerance + precision))
          maximum = Math.max(maximum, error); sum += error
        }
        return { maximum, mean: sum / expected.length, maximumRatio, renderPrecisionAllowance }
      }
      if (cell.kind === 'uv-gradient') {
        flip = measure(true).maximum < measure(false).maximum
        calibration = measure(flip).maximum
        assert.ok(calibration <= (cell.engine === 'CYCLES' ? 4e-5 : 7e-4),
          'Native/Three UV calibration exceeded its measured rasterization domain')
      }
      if (cell.kind === 'constant' && cell.engine !== 'CYCLES') {
        const values = cell.value || [0.25, 0.5, 0.75]
        for (let channel = 0; channel < 3; channel++) {
          const units = values[channel] / halfUlp(values[channel])
          const low = Math.floor(units), fraction = units - low
          const nearestEven = (fraction > .5 || (fraction === .5 && low % 2 !== 0) ? low + 1 : low) * halfUlp(values[channel])
          const towardZero = Math.trunc(units) * halfUlp(values[channel])
          if (Math.abs(expected[channel] - nearestEven) >= 2e-6) nativeHalfModels.delete('nearest-even')
          if (Math.abs(expected[channel] - towardZero) >= 2e-6) nativeHalfModels.delete('toward-zero')
          assert.ok(nativeHalfModels.size, 'Native render precision matches neither independently specified half-float model')
        }
      }
      // Fixed-input fixtures have no rasterization allowance. Live UV inputs
      // use a conservative derivative bound times independently measured UV
      // error, rather than changing the spectral color function to fit pixels.
      const sensitivity = cell.kind === 'blackbody' ? 0.005 : 0.07
      const allowance = cell.bounds ? calibration * (cell.bounds[1] - cell.bounds[0]) * sensitivity : 0
      const tolerance = cell.kind === 'uv-gradient' ? (cell.engine === 'CYCLES' ? 4e-5 : 7e-4) : 6e-6 + allowance
      const metrics = measure(flip, tolerance)
      const row = { backend, id: cell.id, engine: cell.engine, ...metrics, tolerance, calibration,
        nativeRenderPrecisionModels: cell.engine === 'CYCLES' ? ['float32'] : [...nativeHalfModels], rasterizationAllowance: allowance }
      rows.push(row)
      if (metrics.maximumRatio > 1) failures.push(row)
      console.log(`BLENDLINK_SPECTRAL_${metrics.maximumRatio <= 1 ? 'PASSED' : 'FAILED'} ${backend} ${cell.id} max=${metrics.maximum} ratio=${metrics.maximumRatio}`)
    }
    await page.close()
  }
  const stable = sources.every(file => sourceHashes[file] === hash(file))
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ blender: manifest.blender, nativeBuild: manifest.buildHash,
    built, sourceHashes, snapshot, testedModuleHashes: copied, testedNativeModuleHashes, workspaceStable: stable, rows, failures }, null, 2))
  assert.deepEqual(failures, [], 'Native spectral pixels differ; see report.json')
  console.log(`BLENDLINK_SPECTRAL_DIFFERENTIAL_PASSED ${manifest.cases.length} cases on both backends`)
} finally { await browser?.close(); await server.close() }
