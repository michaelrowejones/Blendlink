import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot } from '../../scripts/lib/runtime-provenance.mjs'
import { freezeTslHarness } from '../../scripts/lib/frozen-tsl-harness.mjs'
import { applyFieldTableOverlay } from '../noise-field-kernel/overlay.mjs'

const started = Date.now()
const harnessSha256 = createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex')
const root = resolve(import.meta.dirname, '../..')
const evidence = resolve(process.env.BLENDLINK_NOISE_EVIDENCE || join(root, 'artifacts/verification-noise-fractal'))
const references = join(evidence, 'reference')
mkdirSync(evidence, { recursive: true })
rmSync(join(evidence, 'report.json'), { force: true })
const built = process.argv.includes('--built')
const snapshot = join(evidence, 'module-snapshot-' + Date.now() + '-' + process.pid)
const nativeSnapshot = join(snapshot, 'native')
let { provenance } = await captureRuntimeSnapshot({ root, built, destination: snapshot, label: 'noise' })
let runtimeSnapshot = snapshot
const fieldTableExperiment = process.env.BLENDLINK_NOISE_FIELD_TABLE_EXPERIMENT === '1'
if (fieldTableExperiment) {
  const overlay = await applyFieldTableOverlay({ root, snapshot, built, provenance })
  runtimeSnapshot = overlay.snapshot; provenance = overlay.provenance
}
const frozenHarness = freezeTslHarness(root, snapshot)
const fieldUvControls = process.env.BLENDLINK_NOISE_FIELD_TABLE_CONTROLS === '1'
if (fieldTableExperiment || fieldUvControls) {
  const mainPath = join(frozenHarness.directory, 'main.js')
  let source = readFileSync(mainPath, 'utf8')
  const reset = '  if (state.error) return { ok: false, error: state.error }'
  assert.equal(source.split(reset).length, 2)
  source = source.replace(reset, reset + `
  state.fieldTables=[];window.__fieldTableDiagnostic=stats=>state.fieldTables.push(stats)
  const fieldUv=state.mesh.geometry.getAttribute('uv')
  state.fieldBaseUv??=Float32Array.from(fieldUv.array)
  const fieldUvWindow=objectAttributes?.__fieldUvWindow??[0,0,1,1]
  for(let index=0;index<fieldUv.count;index++)fieldUv.setXY(index,
    state.fieldBaseUv[index*2]*(fieldUvWindow[2]-fieldUvWindow[0])+fieldUvWindow[0],
    state.fieldBaseUv[index*2+1]*(fieldUvWindow[3]-fieldUvWindow[1])+fieldUvWindow[1])
  fieldUv.needsUpdate=true
`)
  source = source.replace('      base64: btoa(binary),', '      base64: btoa(binary),\n      fieldTables:state.fieldTables,')
  writeFileSync(mainPath, source)
  frozenHarness.hashes['main.js'] = createHash('sha256').update(source).digest('hex')
}
const copied = Object.fromEntries(provenance.snapshot.files.map(file => [file.name, file.sha256]))
mkdirSync(nativeSnapshot, { recursive: true })
for (const directory of ['packages/blendlink/blender', 'packages/blender-addon'])
  for (const file of readdirSync(join(root, directory))) {
    if (!file.endsWith('.py') && !file.endsWith('.json')) continue
    copyFileSync(join(root, directory, file), join(nativeSnapshot, file))
  }
const nativeFixtures = Object.fromEntries(['reference.py','mf_coordinate_reference.py'].map(name => {
  const source = join(import.meta.dirname,name), target = join(nativeSnapshot,name)
  const bytes = readFileSync(source)
  writeFileSync(target,bytes)
  return [name,createHash('sha256').update(bytes).digest('hex')]
}))
const sources = ['packages/blendlink/src/tslNodeRecipe.ts', 'packages/blender-addon/tsl_ir.py', 'packages/blender-addon/shader_domains.py']
const hash = file => createHash('sha256').update(readFileSync(join(root, file))).digest('hex')
const sourceHashes = Object.fromEntries(sources.map(file => [file, hash(file)]))
if (!process.argv.includes('--reuse-reference')) {
  const blender = process.env.BLENDLINK_BLENDER || execFileSync(process.execPath,
    [join(root, 'packages/blendlink/dist/cli.js'), 'discover'], { encoding: 'utf8' }).trim().split(/\r?\n/).at(-1)
  assert.ok(blender && existsSync(blender))
  const log = execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1',
    '--python', join(nativeSnapshot, 'reference.py')], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, BLENDLINK_NOISE_REFERENCES: references, BLENDLINK_NOISE_NATIVE_MODULES: nativeSnapshot } })
  writeFileSync(join(evidence, 'reference.log'), log)
  assert.match(log, /BLENDLINK_NOISE_REFERENCES_PASSED/)
}
const manifest = JSON.parse(readFileSync(join(references, 'index.json'), 'utf8'))
if (manifest.size !== 64) {
  assert.ok([128].includes(manifest.size), 'Noise experimental proof size is unqualified')
  const mainPath = join(frozenHarness.directory, 'main.js'), source = readFileSync(mainPath, 'utf8')
  assert.equal(source.split('const SIZE = 64').length, 2)
  const resized = source.replace('const SIZE = 64', 'const SIZE = ' + manifest.size)
  writeFileSync(mainPath, resized); frozenHarness.hashes['main.js'] = createHash('sha256').update(resized).digest('hex')
}

const idsIndex = process.argv.indexOf('--ids')
const requestedIds = idsIndex < 0 ? null : process.argv[idsIndex + 1]?.split(',')
if (idsIndex >= 0) assert.ok(requestedIds?.length && new Set(requestedIds).size === requestedIds.length &&
  requestedIds.every(id => manifest.cases.some(cell => cell.id === id)), '--ids must select unique native case IDs')
const requestedCases = requestedIds ? manifest.cases.filter(cell => requestedIds.includes(cell.id)) : manifest.cases
const requestedEngines = new Set(requestedCases.filter(cell => cell.kind === 'noise').map(cell => cell.engine))
// A field subset still needs independent row-orientation and render-precision
// controls. Omitting them can make correct shaders appear to disagree wildly.
const implicitControlIds = requestedIds ? manifest.cases.filter(cell => requestedEngines.has(cell.engine) &&
  ['constant', 'image-control'].includes(cell.kind) && !requestedIds.includes(cell.id)).map(cell => cell.id) : []
const cases = requestedIds ? manifest.cases.filter(cell => requestedIds.includes(cell.id) || implicitControlIds.includes(cell.id)) : manifest.cases

writeFileSync(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2))
const size = manifest.size
const floats = buffer => new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
const server = await createServer({ configFile: false, root: frozenHarness.directory,
  cacheDir: join(evidence, 'vite-cache'), logLevel: 'warn', optimizeDeps: { noDiscovery: true },
  resolve: { alias: { '@blendlink-tsl-recipe': join(runtimeSnapshot, 'tslNodeRecipe.' + (built ? 'js' : 'ts')) } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root] } } })
const browserChannel = process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL || null
assert.ok(browserChannel === null || browserChannel === 'chromium', 'Only the bundled chromium channel is allowed')
let browser
let browserVersion = null, browserLaunchArgs = []
const rows = [], failures = [], executionFailures = []
function retainReport(finished = false) {
  const stable = sources.every(file => sourceHashes[file] === hash(file))
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ blender: manifest.blender, nativeBuild: manifest.buildHash,
    built: built && !fieldTableExperiment, productionBuildVerified: built, fieldTableExperiment, fieldUvControls, elapsedMs: Date.now() - started, nativeGpuBackend: manifest.gpuBackend, cyclesDevice: manifest.cyclesDevice,
    sourceHashes, harnessSha256, testedHarnessHashes: frozenHarness.hashes, provenance, snapshot: runtimeSnapshot, baselineSnapshot: snapshot, testedModuleHashes: copied, refusals: manifest.refusals ?? [],
    nativeModuleHashes: manifest.nativeModuleHashes, nativeFixtureHashes: nativeFixtures, workspaceStable: stable,
    finished, completedAllCases: rows.length === cases.length * 2, expectedCasesPerBackend: cases.length, nativeCases: manifest.cases.length, requestedIds, implicitControlIds, browserVersion, browserLaunchArgs, browserChannel,
    rows, failures, executionFailures }, null, 2))
}

try {
  await server.listen()
  const args = JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')
  assert.ok(Array.isArray(args) && args.every(value => typeof value === 'string'))
  browserLaunchArgs = ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...args]
  browser = await chromium.launch({ headless: true, args: browserLaunchArgs, ...(browserChannel ? { channel: browserChannel } : {}) })
  browserVersion = browser.version()
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage()
    const errors = []
    let currentCase = null
    try {
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(server.resolvedUrls.local[0] + (backend === 'webgl2' ? '?backend=webgl2' : ''))
    const initialized = await page.evaluate(() => window.__tslDiffInit())
    assert.equal(initialized.error, null)
    assert.equal(initialized.backend, backend === 'webgpu')
    let flip = false
    for (const cell of cases) {
      currentCase = cell.id
      if (requestedIds) retainReport()
      const renderStarted = Date.now()
      const rendered = await page.evaluate(({ id, path, attributes }) => window.__tslDiffRun(id, 'ir', path, false, null, attributes),
        { id: cell.id, path: '/@fs/' + join(references, 'ir', cell.id + '.json'), attributes: cell.objectAttributes })
      assert.ok(rendered.ok, `${backend}/${cell.id}: ${rendered.error}`)
      assert.deepEqual(errors, [], `${backend}/${cell.id} shader/browser errors`)
      const actual = floats(Buffer.from(rendered.base64, 'base64'))
      const actualFile = backend + '-' + cell.id + '.f32'
      writeFileSync(join(evidence, actualFile), Buffer.from(rendered.base64, 'base64'))
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
      if (cell.kind === 'image-control') {
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
      // Every lookup input is fixed or nearest-sampled at its texel center.
      // No UV rasterization allowance is applied. Native EEVEE's scene target
      // is independently verified above; the node's own table/filter precision
      // is reproduced separately in the production shader.
      const tolerance = 2e-5
      const metrics = measure(flip, tolerance)
      const row = { backend, id: cell.id, engine: cell.engine, fieldTables: rendered.fieldTables ?? [], actualFile, components: rendered.components, ...metrics, tolerance, derivedRawMaximum: metrics.maximum / (cell.oracleScale ?? 1), renderAndReadbackMs: Date.now() - renderStarted, flipRows: flip }
      row.browserEnvironment = await page.evaluate(() => window.__tslDiffEnvironment())
      rows.push(row)
      if (rows.length % 32 === 0) retainReport()
      if (metrics.maximumRatio > 1) failures.push(row)
      console.log(`BLENDLINK_NOISE_${metrics.maximumRatio <= 1 ? 'PASSED' : 'FAILED'} ${backend} ${cell.id} max=${metrics.maximum} ratio=${metrics.maximumRatio}`)
    }
    } catch (error) {
      let browserEnvironment = null
      try { browserEnvironment = await page.evaluate(() => window.__tslDiffEnvironment()) } catch {}
      executionFailures.push({ backend, case: currentCase, message: String(error?.message ?? error), shaderErrors: errors, browserEnvironment })
      console.error('BLENDLINK_NOISE_BACKEND_FAILED ' + backend + '/' + currentCase + ': ' + String(error?.message ?? error))
    } finally {
      retainReport()
      await page.close()
    }
  }
  const mfCoordinateIdentities=[]
  if(executionFailures.length===0) for(const backend of ['webgpu','webgl2']) for(const cell of cases) {
    if(!cell.mfCoordinateVariant || !cell.mfCoordinateLiteral)continue
    const authored=cell.id.replace('-literal','-authored')
    if(!cases.some(candidate=>candidate.id===authored))continue
    assert.deepEqual(readFileSync(join(evidence,backend+'-'+cell.id+'.f32')),
      readFileSync(join(evidence,backend+'-'+authored+'.f32')), 'Runtime MF coordinate arithmetic/literal pixels differ: '+backend+'/'+cell.id)
    mfCoordinateIdentities.push({backend,authored,literal:cell.id})
  }
  writeFileSync(join(evidence,'mf-coordinate-identities.json'),JSON.stringify(mfCoordinateIdentities,null,2))
  retainReport(true)
  assert.deepEqual(executionFailures, [], 'Noise browser execution failed; partial pixels and metrics were retained')
  assert.deepEqual(failures, [], 'Native Noise pixels differ; see report.json')
  if (fieldTableExperiment) assert.ok(rows.some(row => row.fieldTables.length > 0),
    'Experimental field table selection lowered no native field; inspect source sampling/profile admission')
  console.log(`BLENDLINK_NOISE_DIFFERENTIAL_PASSED ${cases.length} cases on both backends`)
} finally { await browser?.close(); await server.close() }
