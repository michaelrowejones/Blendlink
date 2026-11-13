import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { freezeTslHarness } from '../../scripts/lib/frozen-tsl-harness.mjs'
import { captureRuntimeSnapshot } from '../../scripts/lib/runtime-provenance.mjs'

const root = resolve(import.meta.dirname, '../..')
const evidence = resolve(process.env.BLENDLINK_HSV_EVIDENCE || join(root, 'artifacts/verification-legacy-shader-hsv'))
const references = join(evidence, 'reference')
mkdirSync(evidence, { recursive: true })
rmSync(join(evidence, 'report.json'), { force: true })
const built = process.argv.includes('--built')
const snapshot = join(evidence, 'module-snapshot-' + Date.now() + '-' + process.pid)
const nativeSnapshot = join(snapshot, 'native')
const { provenance } = await captureRuntimeSnapshot({ root, built, destination: snapshot, label: 'legacy-hsv' })
const copied = Object.fromEntries(provenance.snapshot.files.map(file => [file.name, file.sha256]))
mkdirSync(nativeSnapshot, { recursive: true })
for (const directory of ['packages/blendlink/blender', 'packages/blender-addon'])
  for (const file of readdirSync(join(root, directory))) {
    if (!file.endsWith('.py') && !file.endsWith('.json')) continue
    copyFileSync(join(root, directory, file), join(nativeSnapshot, file))
  }
const sources = ['packages/blendlink/src/tslNodeRecipe.ts', 'packages/blendlink/src/tslColorConversion.ts',
  'packages/blender-addon/tsl_ir.py', 'packages/blender-addon/color_ir.py', 'packages/blender-addon/engine_fallback.py', 'packages/blender-addon/procedural.py']
const hash = file => createHash('sha256').update(readFileSync(join(root, file))).digest('hex')
const sourceHashes = Object.fromEntries(sources.map(file => [file, hash(file)]))
copyFileSync(join(import.meta.dirname,'reference.py'),join(nativeSnapshot,'reference.py'))
if (!process.argv.includes('--reuse-reference')) {
  const blender = process.env.BLENDLINK_BLENDER || execFileSync(process.execPath,
    [join(root, 'packages/blendlink/dist/cli.js'), 'discover'], { encoding: 'utf8' }).trim().split(/\r?\n/).at(-1)
  assert.ok(blender && existsSync(blender))
  const log = execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1',
    '--python', join(nativeSnapshot, 'reference.py')], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, BLENDLINK_HSV_REFERENCES: references, BLENDLINK_HSV_NATIVE_MODULES: nativeSnapshot } })
  writeFileSync(join(evidence, 'reference.log'), log)
  assert.match(log, /BLENDLINK_LEGACY_HSV_REFERENCES_PASSED/)
}
const frozenHarness=freezeTslHarness(root,snapshot)
const manifest = JSON.parse(readFileSync(join(references, 'index.json'), 'utf8'))
assert.equal(manifest.blender, '4.2.0', 'Legacy node availability is a source-version contract')
assert.equal(manifest.cases.length, 50)
assert.equal(manifest.baselines.length, 46)
assert.ok(manifest.baselines.every(cell => cell.legacyModernBitIdentical === true))
for (const cell of manifest.cases.filter(cell => cell.kind === 'conversion')) {
  const source = cell.sourceAdapter
  assert.equal(source.actualLegacyClass, cell.direction === 'combine' ? 'ShaderNodeCombineHSV' : 'ShaderNodeSeparateHSV')
  assert.deepEqual(cell.direction === 'combine' ? source.legacyInputs : source.legacyOutputs, ['H', 'S', 'V'])
  assert.equal(source.actualModernClass, cell.direction === 'combine' ? 'ShaderNodeCombineColor' : 'ShaderNodeSeparateColor')
  assert.equal(source.modernMode, 'HSV')
  assert.equal(source.emittedModel, 'eevee-gpu')
  assert.equal(source.sourceEvaluationEngine, 'EEVEE')
}
for (const [name, expected] of Object.entries(manifest.nativeModuleHashes)) {
  assert.match(name, /^[a-zA-Z0-9_.-]+$/)
  assert.equal(createHash('sha256').update(readFileSync(join(nativeSnapshot, name))).digest('hex'), expected,
    'Native reference producer changed: ' + name)
}
for(const cell of manifest.cases)if(cell.nativeResidualReconstruction){
  const proof=cell.nativeResidualReconstruction
  assert.equal(createHash('sha256').update(readFileSync(join(references,proof.baselineFile))).digest('hex'),proof.baselineSha256)
  assert.equal(createHash('sha256').update(readFileSync(join(references,'ir',cell.id+'.json'))).digest('hex'),proof.originalIrSha256)
  assert.equal(proof.targetCalibration,'carrier-rgb-grid')
  assert.ok(manifest.cases.some(item=>item.id===proof.targetCalibration&&item.targetAbsoluteBound===2**-10))
}
writeFileSync(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2))
const size = manifest.size
const floats = buffer => new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
const server = await createServer({ configFile: false, root: frozenHarness.directory,
  cacheDir: join(evidence, 'vite-cache'), logLevel: 'warn', optimizeDeps: { noDiscovery: true },
  resolve: { alias: { '@blendlink-tsl-recipe': join(snapshot, 'tslNodeRecipe.' + (built ? 'js' : 'ts')) } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, evidence] } } })
let browser
const rows = [], failures = [], environments = []
try {
  await server.listen()
  const args = JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')
  assert.ok(Array.isArray(args) && args.every(value => typeof value === 'string'))
  const channel=process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL; assert.ok(!channel || channel==='chromium');
  browser = await chromium.launch({ headless: true, ...(channel?{channel}:{}), args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...args] })
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(server.resolvedUrls.local[0] + (backend === 'webgl2' ? '?backend=webgl2' : ''))
    const initialized = await page.evaluate(() => window.__tslDiffInit())
    assert.equal(initialized.error, null)
    assert.equal(initialized.backend, backend === 'webgpu')
    environments.push({backend,...await page.evaluate(()=>window.__tslDiffEnvironment())})
    let flip = false
    for (const cell of manifest.cases) {
      const rendered = await page.evaluate(({ id, path, attributes }) => window.__tslDiffRun(id, 'ir', path, false, null, attributes),
        { id: cell.id, path: '/@fs/' + join(references, 'ir', cell.id + '.json'), attributes: cell.objectAttributes })
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
          const affineScale=cell.outputAffineScale??1,affineBias=cell.outputAffineBias??0
          const value = (actual[(y * size + x) * rendered.components + channel]-affineBias)/affineScale
          assert.ok(Number.isFinite(value))
          const encodedReference=expected[(((flipped ? size - 1 - y : y) * size + x) * 3) + channel]
          const reference = (encodedReference-affineBias)/affineScale
          const error = Math.abs(value - reference)
          const precision = (cell.targetAbsoluteBound ?? (cell.renderHalf ? halfUlp(encodedReference) : (cell.nativeResidualReconstruction ? cell.nativeResidualReconstruction.quantizationBound : 0)))/Math.abs(affineScale)
          renderPrecisionAllowance = Math.max(renderPrecisionAllowance, precision)
          maximumRatio = Math.max(maximumRatio, error / (tolerance + precision))
          maximum = Math.max(maximum, error); sum += error
        }
        return { maximum, mean: sum / expected.length, maximumRatio, renderPrecisionAllowance }
      }
      if (cell.id === 'carrier-rgb-grid' || cell.id === 'uv-gradient') {
        flip = measure(true).maximum < measure(false).maximum
      }
      if (cell.kind === 'constant' && cell.engine !== 'CYCLES') {
        for (let channel = 0; channel < 3; channel++) {
          const reference = expected[channel]
          const ulp = halfUlp(reference)
          assert.ok(Math.abs(reference / ulp - Math.round(reference / ulp)) < 2e-4,
            'Native EEVEE carrier is no longer a representable half-float value')
          assert.ok(Math.abs(reference - cell.value[channel]) <= halfUlp(cell.value[channel]) + 2e-6,
            'Independent native EEVEE carrier exceeds its half-float precision bound')
        }
      }
      // Fixed and nearest-centered inputs need no UV allowance. The native
      // carrier grid independently bounds the residual's target quantization;
      // the kernel budget is measured in raw HSV/RGB units after decoding.
      const tolerance = cell.targetAbsoluteBound ? 0 : (cell.tolerance ?? 6e-6)
      const metrics = measure(flip, tolerance)
      const row = { backend, id: cell.id, engine: cell.engine, ...metrics, tolerance, flipRows: flip }
      rows.push(row)
      if (metrics.maximumRatio > 1) failures.push(row)
      console.log(`BLENDLINK_HSV_${metrics.maximumRatio <= 1 ? 'PASSED' : 'FAILED'} ${backend} ${cell.id} max=${metrics.maximum} ratio=${metrics.maximumRatio}`)
    }
    await page.close()
  }
  const stable = sources.every(file => sourceHashes[file] === hash(file))
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ blender: manifest.blender, nativeBuild: manifest.buildHash,
    built, browserVersion:browser.version(),browserChannel:channel??'headless-shell',browserArguments:args,sourceHashes, provenance, snapshot, testedModuleHashes: copied, environments, legacyModernBitIdenticalCases: manifest.baselines.length, harnessHashes: frozenHarness.hashes, nativeModuleHashes: manifest.nativeModuleHashes, workspaceStable: stable, rows, failures }, null, 2))
  assert.deepEqual(failures, [], 'Native legacy HSV pixels differ; see report.json')
  console.log(`BLENDLINK_HSV_DIFFERENTIAL_PASSED ${manifest.cases.length} cases on both backends`)
} finally { await browser?.close(); await server.close() }
