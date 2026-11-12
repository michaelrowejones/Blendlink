// Focused live-node proofs: native Blender channel pixels -> production IR
// -> the real TSL builder -> WebGPURenderer, with both of its backend families.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const experiment = resolve(import.meta.dirname)
const root = resolve(experiment, '../..')
const extraBrowserArgs = JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')
assert.ok(Array.isArray(extraBrowserArgs) && extraBrowserArgs.every(value => typeof value === 'string'),
  'BLENDLINK_TEST_CHROMIUM_ARGS must be a JSON array of Chromium argument strings')
const mathFamily = process.argv.includes('--math')
const hueFamily = process.argv.includes('--hue-ramp')
const boundaryFamily = process.argv.includes('--boundary')
const mixFamily = process.argv.includes('--mix')
const mapRangeFamily = process.argv.includes('--map-range')
const family = mathFamily ? 'MATH' : hueFamily ? 'HUE_RAMP' : boundaryFamily ? 'MATH_BOUNDARY' : mapRangeFamily ? 'MAP_RANGE' : mixFamily ? 'MIX' : 'MAPPING'
const evidence = process.env.BLENDLINK_TSL_DIFF_ARTIFACTS ? resolve(process.env.BLENDLINK_TSL_DIFF_ARTIFACTS) : join(root, mathFamily ? 'artifacts/verification-shader-math' : hueFamily ? 'artifacts/verification-hue-ramp' : boundaryFamily ? 'artifacts/verification-math-boundary' : mapRangeFamily ? 'artifacts/verification-map-range' : mixFamily ? 'artifacts/verification-mix-math' : 'artifacts/verification-mapping')
const reference = join(evidence, 'reference')
mkdirSync(evidence, { recursive: true })
rmSync(join(evidence, 'report.json'), { force: true })
const manifest = JSON.parse(readFileSync(join(experiment, 'cells.json'), 'utf8'))
const ids = mathFamily
  ? ['constant-linear', 'uv-gradient', ...manifest.cells.filter(cell => cell.id.startsWith('math-')).map(cell => cell.id)]
  : hueFamily
  ? ['constant-linear', 'uv-gradient', 'colorramp-linear', 'colorramp-bspline', ...manifest.cells.filter(cell => cell.hueRamp).map(cell => cell.id)]
  : boundaryFamily
  ? ['constant-linear', 'uv-gradient', ...manifest.cells.filter(cell => cell.boundaryProof).map(cell => cell.id)]
  : mapRangeFamily
  ? ['constant-linear', 'uv-gradient', 'map-range-linear', 'map-range-smoothstep', ...manifest.cells.filter(cell => cell.mapRange).map(cell => cell.id)]
  : mixFamily
  ? ['constant-linear', 'uv-gradient', 'mix-overlay', 'mix-divide', ...manifest.cells.filter(cell => cell.genericMix).map(cell => cell.id)]
  : ['constant-linear', 'uv-gradient', 'mapping-rotate', 'mapping-texture-mode',
    'mapping-point-xyz', 'mapping-texture-xyz', 'mapping-vector-xyz', 'mapping-texture-zero-scale']
const cells = ids.map(id => {
  const cell = manifest.cells.find(item => item.id === id)
  assert.ok(cell, `Missing ${family} differential cell ${id}`)
  return cell
})
const source = join(root, 'packages/blendlink/src/tslNodeRecipe.ts')
const built = join(root, 'packages/blendlink/dist/tslNodeRecipe.js')
const useBuilt = process.argv.includes('--built')
if (useBuilt) {
  assert.ok(existsSync(built), 'Build the compiler before using --built')
  assert.ok(statSync(built).mtimeMs >= statSync(source).mtimeMs, 'Built TSL builder is stale; coordinate a build before using --built')
}
const builder = useBuilt ? built : source
const emitter = join(root, 'packages/blender-addon/tsl_ir.py')
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const sourceHash = sha256(source)
const emitterHash = sha256(emitter)
const blender = process.env.BLENDLINK_BLENDER_PATH ?? process.env.BLENDLINK_BLENDER ?? execFileSync(process.execPath, [join(root, 'packages/blendlink/dist/cli.js'), 'discover'], {
  encoding: 'utf8', env: process.env,
}).trim().split(/\r?\n/).at(-1)
assert.ok(blender && existsSync(blender), 'Blender discovery did not return an executable')
const oracle = join(evidence, 'reference.py')
writeFileSync(oracle, `import importlib.util, sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location("mapping_reference", ${JSON.stringify(join(experiment, 'reference.py'))})\nmodule=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\nselected=set(${JSON.stringify(ids)})\nmodule.CELLS={"size":64,"cells":[cell for cell in module.CELLS["cells"] if cell["id"] in selected]}\nmodule.OUTPUT=Path(${JSON.stringify(reference)})\n# This oracle is explicitly CPU-only; do not label it GPU evidence.\nmodule.bakelib._CYCLES_GPU_BACKENDS=()\nmodule.main()\n`)
const oracleOutput = execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', oracle], {
  cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
})
writeFileSync(join(evidence, 'blender.log'), oracleOutput)
assert.match(oracleOutput, /BLENDLINK_TSL_DIFFERENTIAL_REFERENCE_DONE/)
const referenceManifest = JSON.parse(readFileSync(join(reference, 'manifest.json'), 'utf8'))
for (const id of ids) assert.ok(referenceManifest.cells[id], `Blender oracle missed ${id}`)
const floats = bytes => new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
function difference(referencePixels, rendered, components, flipRows) {
  assert.equal(referencePixels.length, 64 * 64 * 3)
  assert.equal(rendered.length, 64 * 64 * components)
  const differences = []
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) for (let channel = 0; channel < 3; channel++) {
    const expected = referencePixels[(y * 64 + x) * 3 + channel]
    const actual = rendered[((flipRows ? 63 - y : y) * 64 + x) * components + channel]
    assert.ok(Number.isFinite(expected) && Number.isFinite(actual), 'Nonfinite material-graph sample')
    differences.push(Math.abs(expected - actual))
  }
  differences.sort((a, b) => a - b)
  return { meanAbs: differences.reduce((a, b) => a + b, 0) / differences.length,
    p99Abs: differences[Math.floor(differences.length * .99)], maxAbs: differences.at(-1) }
}
const server = await createServer({
  root: experiment, configFile: false, logLevel: 'warn', cacheDir: join(evidence, 'vite-cache'),
  optimizeDeps: { noDiscovery: true }, resolve: { alias: { '@blendlink-tsl-recipe': builder } },
  server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [root] } },
})
let browser
const results = []
const failures = []
try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...extraBrowserArgs] })
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage({ viewport: { width: 320, height: 320 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(base + (backend === 'webgl2' ? '/?backend=webgl2' : '/'))
    const environment = await page.evaluate(() => window.__tslDiffInit())
    assert.equal(environment.error, null, `${backend} initialization failed`)
    assert.equal(environment.backend, backend === 'webgpu', `Requested ${backend} but got another backend`)
    let flipRows
    for (const cell of cells) {
      const irPath = '/@fs/' + join(reference, 'ir', `${cell.id}.json`).replaceAll('\\', '/')
      const rendered = await page.evaluate(({ id, path }) => window.__tslDiffRun(id, 'ir', path, false, null, null), { id: cell.id, path: irPath })
      assert.equal(rendered.ok, true, `${backend}/${cell.id}: ${rendered.error}`)
      assert.deepEqual(errors, [], `${backend}/${cell.id} emitted browser/shader errors`)
      assert.ok(rendered.components === 3 || rendered.components === 4, 'Unexpected float readback layout')
      const actual = floats(Buffer.from(rendered.base64, 'base64'))
      const expected = floats(readFileSync(join(reference, `${cell.id}.f32`)))
      if (cell.id === 'uv-gradient') {
        const direct = difference(expected, actual, rendered.components, false)
        const flipped = difference(expected, actual, rendered.components, true)
        flipRows = flipped.maxAbs < direct.maxAbs
      }
      const measured = difference(expected, actual, rendered.components, flipRows ?? false)
      const budget = cell.claim === 'approximate' ? cell.divergenceBudget : cell.tolerance
      assert.ok(budget, `${cell.id} has no numerical acceptance budget`)
      if (cell.claim === 'approximate') {
        assert.equal(cell.divergenceKind, 'bounded')
        assert.ok(cell.provenBy?.length && cell.provenBy.every(id => cells.some(item => item.id === id && item.claim === 'exact')), 'Approximate cells require included exact algorithm proofs')
      }
      const cellFailures = ['meanAbs', 'p99Abs', 'maxAbs']
        .filter(metric => measured[metric] > budget[metric])
        .map(metric => `${backend}/${cell.id} ${metric}=${measured[metric]} exceeds ${budget[metric]}`)
      failures.push(...cellFailures)
      results.push({ backend, cell: cell.id, flipRows: flipRows ?? null, ...measured })
      writeFileSync(join(evidence, `${backend}-${cell.id}.f32`), Buffer.from(actual.buffer))
      console.log(`BLENDLINK_${family}_CELL_${cellFailures.length ? 'FAILED' : 'PASSED'} ${backend} ${cell.id} maxAbs=${measured.maxAbs.toExponential(4)}`)
    }
    await page.close()
  }
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({
    family, oracle: 'Blender Cycles CPU, native node graphs, linear float channels',
    builder: useBuilt ? 'built production module' : 'production TypeScript source via Vite',
    sourceSha256: sourceHash, emitterSha256: emitterHash,
    blender: oracleOutput.match(/Blender [^\r\n]+/)?.[0],
    sourceStable: sha256(source) === sourceHash, emitterStable: sha256(emitter) === emitterHash,
    results, failures,
  }, null, 2) + '\n')
  assert.equal(sha256(source), sourceHash, 'TSL source changed during verification; rerun against stable source')
  assert.equal(sha256(emitter), emitterHash, 'IR emitter changed during verification; rerun against stable source')
  assert.deepEqual(failures, [], `${family} native differential failed; see report.json`)
  console.log(`BLENDLINK_${family}_DIFFERENTIAL_PASSED both WebGPURenderer backends`)
} finally {
  await browser?.close()
  await server.close()
}
