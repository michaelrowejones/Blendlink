import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot } from '../../scripts/lib/runtime-provenance.mjs'
import { freezeTslHarness } from '../../scripts/lib/frozen-tsl-harness.mjs'

const root = resolve(import.meta.dirname, '../..')
const evidence = resolve(process.env.BLENDLINK_VECTOR_COMPONENT_EVIDENCE || join(root, 'artifacts/verification-vector-component'))
const references = resolve(process.env.BLENDLINK_VECTOR_COMPONENT_REFERENCES || join(evidence, 'reference'))
const built = process.argv.includes('--built'), snapshot = join(evidence, 'runtime-' + Date.now() + '-' + process.pid)
const nativeBackend = process.env.BLENDLINK_VECTOR_COMPONENT_NATIVE_BACKEND
assert.ok(nativeBackend === undefined || ['METAL', 'OPENGL', 'VULKAN'].includes(nativeBackend), 'Unknown requested native backend')
mkdirSync(evidence, { recursive: true })
const { provenance } = await captureRuntimeSnapshot({ root, built, destination: snapshot, label: 'Get Vector Component' })
const native = join(snapshot, 'native'); mkdirSync(native)
for (const directory of built ? ['packages/blendlink/dist/blender'] : ['packages/blendlink/blender', 'packages/blender-addon']) {
  for (const name of readdirSync(join(root, directory))) {
    if (!name.endsWith('.py') && !name.endsWith('.json')) continue
    if (built) {
      const source = ['packages/blendlink/blender', 'packages/blender-addon'].map(directory => join(root, directory, name)).find(existsSync)
      assert.ok(source); assert.deepEqual(readFileSync(join(root, directory, name)), readFileSync(source), 'Built native source changed: ' + name)
    }
    copyFileSync(join(root, directory, name), join(native, name))
  }
}
if (!process.argv.includes('--reuse-reference')) {
  const blender = process.env.BLENDLINK_BLENDER; assert.ok(blender && existsSync(blender))
  const log = execFileSync(blender, ['--background', '--factory-startup', ...(nativeBackend ? ['--gpu-backend', nativeBackend.toLowerCase()] : []), '-t', '1', '--python-exit-code', '1',
    '--python', join(import.meta.dirname, 'reference.py')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, BLENDLINK_VECTOR_COMPONENT_MODULES: native, BLENDLINK_VECTOR_COMPONENT_REFERENCES: references } })
  writeFileSync(join(evidence, 'native.log'), log); assert.match(log, /BLENDLINK_VECTOR_COMPONENT_REFERENCES_PASSED 44/)
}
const manifest = JSON.parse(readFileSync(join(references, 'index.json'), 'utf8'))
assert.equal(manifest.native, '5.3.0'); assert.equal(manifest.hash, '02f0899d78e3'); assert.equal(manifest.sourceEngine, 'BLENDER_EEVEE')
assert.ok(['METAL', 'OPENGL', 'VULKAN'].includes(manifest.nativeGpuPlatform?.backend))
for (const field of ['vendor', 'renderer']) assert.ok(typeof manifest.nativeGpuPlatform[field] === 'string' && manifest.nativeGpuPlatform[field].length)
if (nativeBackend) assert.equal(manifest.nativeGpuPlatform.backend, nativeBackend, 'Actual native renderer must match the requested backend')
assert.equal(manifest.size, 64); assert.equal(manifest.cases.length, 44)
assert.equal(manifest.nativeCarrierCalibration.independentSocketUvFormula, true)
assert.equal(manifest.nativeCarrierCalibration.halfRepresentable, true)
assert.ok(Number.isFinite(manifest.nativeCarrierCalibration.maximumBudgetRatio) && manifest.nativeCarrierCalibration.maximumBudgetRatio <= 1)
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const runnerSha256 = sha(import.meta.filename)
assert.equal(manifest.fixtureSha256, sha(join(import.meta.dirname, 'reference.py')))
for (const [name, hash] of Object.entries(manifest.nativeModules)) assert.equal(hash, sha(join(native, name)))
for (const cell of manifest.cases) {
  assert.equal(cell.nativeComponentVsSeparateBitMismatches, 0)
  assert.equal(cell.independentNativeCarrierCalibration.halfRepresentable, true)
  assert.ok(Number.isFinite(cell.independentNativeCarrierCalibration.maximumBudgetRatio) && cell.independentNativeCarrierCalibration.maximumBudgetRatio <= 1)
  assert.equal(cell.nativePixelSha256, sha(join(references, cell.id + '.f32')))
  assert.equal(cell.evaluationStage, cell.kind === 'uv-control' || cell.vector === 'uv' || cell.vector === 'object' ? 'shader' : 'constant')
}
const rawDirectory = join(snapshot, 'raw-selection-ir'); mkdirSync(rawDirectory)
for (const cell of manifest.cases.filter(cell => cell.kind === 'component')) {
  const document = JSON.parse(readFileSync(join(references, 'ir', cell.id + '.json'), 'utf8'))
  assert.equal(document.output.op, 'math'); assert.equal(document.output.operation, 'ADD'); assert.deepEqual(document.output.b, { op: 'const_float', value: .5 })
  assert.equal(document.output.a.op, 'math'); assert.equal(document.output.a.operation, 'MULTIPLY'); assert.deepEqual(document.output.a.b, { op: 'const_float', value: 1 / 1024 })
  const selection = document.output.a.a
  assert.equal(selection.op, 'separate'); assert.equal(selection.channel, 'xyz'[cell.index])
  writeFileSync(join(rawDirectory, cell.id + '.json'), JSON.stringify({ ...document, output: selection }))
}
const harness = freezeTslHarness(root, snapshot)
const main = join(harness.directory, 'main.js'), originalHarness = readFileSync(main, 'utf8')
assert.equal(originalHarness.split('normalize, uv, vec3 }').length, 2)
assert.equal(originalHarness.split('    material.colorNode = colorNode').length, 2)
// The material lighting output clamps negative radiance. Raw scalar controls
// bypass that final carrier stage; the production IR builder stays untouched.
writeFileSync(main, originalHarness.replace('normalize, uv, vec3 }', 'normalize, uv, vec3, vec4 }')
  .replace('    material.colorNode = colorNode', "    material.colorNode = colorNode\n    if (cellId.endsWith('-raw')) material.fragmentNode = vec4(colorNode, 1)"))
const effectiveHarnessSha256 = sha(main)
const server = await createServer({ configFile: false, root: harness.directory, cacheDir: join(evidence, 'vite-cache'),
  logLevel: 'warn', optimizeDeps: { noDiscovery: true },
  resolve: { alias: { '@blendlink-tsl-recipe': join(snapshot, 'tslNodeRecipe.' + (built ? 'js' : 'ts')) } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, evidence, references] } } })
const rows = [], rawSelectionRows = [], failures = [], environments = []
let browser
try {
  await server.listen()
  const channel = process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL; assert.ok(!channel || channel === 'chromium')
  const args = JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]'); assert.ok(Array.isArray(args) && args.every(value => typeof value === 'string'))
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...args] })
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(server.resolvedUrls.local[0] + (backend === 'webgl2' ? '?backend=webgl2' : ''))
    const initialized = await page.evaluate(() => window.__tslDiffInit())
    assert.equal(initialized.error, null); assert.equal(initialized.backend, backend === 'webgpu')
    const environment = await page.evaluate(() => window.__tslDiffEnvironment()); environments.push({ backend, ...environment })
    let flip = false, targetTextures = null
    for (const cell of manifest.cases) {
      const rendered = await page.evaluate(({ id, path, attributes }) => window.__tslDiffRun(id, 'ir', path, false, null, attributes),
        { id: cell.id, path: '/@fs/' + join(references, 'ir', cell.id + '.json'), attributes: cell.objectAttributes })
      if (!rendered.ok || errors.length) { failures.push({ backend, id: cell.id, execution: rendered.error, errors: [...errors] }); continue }
      const bytes = Buffer.from(rendered.base64, 'base64'), actual = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const expectedBytes = readFileSync(join(references, cell.id + '.f32'))
      const expected = new Float32Array(expectedBytes.buffer.slice(expectedBytes.byteOffset, expectedBytes.byteOffset + expectedBytes.byteLength))
      assert.equal(actual.length, 64 * 64 * rendered.components); assert.equal(expected.length, 64 * 64 * 3)
      const measure = flip => {
        let maximum = 0, ratio = 0
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) for (let c = 0; c < 3; c++) {
          const value = actual[(y * 64 + x) * rendered.components + c], native = expected[((flip ? 63 - y : y) * 64 + x) * 3 + c]
          assert.ok(Number.isFinite(value)); const error = Math.abs(value - native)
          const halfUlp = Math.max(2 ** (Math.floor(Math.log2(Math.abs(native) || 2 ** -14)) - 10), 2 ** -24)
          maximum = Math.max(maximum, error); ratio = Math.max(ratio, error / (6e-6 + halfUlp))
        }
        return { maximum, ratio, flip }
      }
      if (cell.kind === 'uv-control') flip = measure(true).maximum < measure(false).maximum
      const metrics = measure(flip)
      const row = { backend, id: cell.id, nativeStage: cell.evaluationStage, ...metrics }; rows.push(row)
      if (metrics.ratio > 1) failures.push(row)
      const memory = await page.evaluate(() => window.__tslDiffEnvironment())
      // The generic fixture keeps its one output render target alive. Reapply
      // must not add any texture owned by these texture-free scalar programs.
      targetTextures ??= memory.memory.textures
      assert.equal(targetTextures, 1); assert.equal(memory.memory.textures, targetTextures)
      console.log('BLENDLINK_VECTOR_COMPONENT_' + (metrics.ratio <= 1 ? 'PASSED ' : 'FAILED ') + JSON.stringify(row))
      if (cell.kind === 'component') {
        const raw = await page.evaluate(({ id, path, attributes }) => window.__tslDiffRun(id, 'ir', path, false, null, attributes),
          { id: cell.id + '-raw', path: '/@fs/' + join(rawDirectory, cell.id + '.json'), attributes: cell.objectAttributes })
        assert.ok(raw.ok, raw.error); assert.deepEqual(errors, [])
        const rawBytes = Buffer.from(raw.base64, 'base64'), values = new Float32Array(rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength))
        assert.equal(values.length, 64 * 64 * raw.components)
        let mismatches = 0, maximum = 0
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
          const expected = cell.vector === 'uv' ? cell.index === 0 ? (x + .5) / 64 : cell.index === 1 ? ((flip ? 63 - y : y) + .5) / 64 : 0 : Math.fround(cell.values[cell.index])
          for (let c = 0; c < 3; c++) {
            const actual = values[(y * 64 + x) * raw.components + c]
            assert.ok(Number.isFinite(actual)); if (actual !== expected) mismatches++
            maximum = Math.max(maximum, Math.abs(actual - expected))
          }
        }
        const rawRow = { backend, id: cell.id, mismatches, maximum, zeroSignClaim: false }; rawSelectionRows.push(rawRow)
        if (mismatches) failures.push({ ...rawRow, proof: 'independent raw Float32 selection' })
      }
    }
    const final = await page.evaluate(() => window.__tslDiffEnvironment())
    assert.equal(final.deviceLoss, null); assert.equal(final.memory.textures, targetTextures)
    environments.at(-1).resourceCheck = { outputTargetTextures: targetTextures, addedProgramTextures: 0 }
    await page.close()
  }
} catch (error) { failures.push({ execution: String(error.stack || error) }) }
finally {
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ built, provenance, harness, native: manifest.native, nativeHash: manifest.hash,
    nativeGpuPlatform: manifest.nativeGpuPlatform,
    nativeSelectionGraphs: manifest.cases.length - 2, independentCarrierControls: 2, nativeComponentVsSeparateBitMismatches: 0,
    carrierAllowance: { absolute: 6e-6, additional: 'one native scene-target half ULP' },
    nativeCarrierCalibration: manifest.nativeCarrierCalibration,
    runnerSha256, effectiveHarnessSha256, rawFragmentCarrier: 'Direct vec4 of the production scalar builder; bypasses negative-radiance material clamp',
    environments, rows, rawSelectionRows, failures }, null, 2))
  await browser?.close(); await server.close()
}
assert.equal(rows.length, 88); assert.equal(rawSelectionRows.length, 84); assert.deepEqual(failures, [])
console.log('BLENDLINK_VECTOR_COMPONENT_DIFFERENTIAL_PASSED 44 cells on both APIs')
