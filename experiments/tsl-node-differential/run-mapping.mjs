// Focused live-node proofs: native Blender channel pixels -> production IR
// -> the real TSL builder -> WebGPURenderer, with both of its backend families.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot } from '../../scripts/lib/runtime-provenance.mjs'

const experiment = resolve(import.meta.dirname)
const root = resolve(experiment, '../..')
const extraBrowserArgs = JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')
assert.ok(Array.isArray(extraBrowserArgs) && extraBrowserArgs.every(value => typeof value === 'string'),
  'BLENDLINK_TEST_CHROMIUM_ARGS must be a JSON array of Chromium argument strings')
const vectorFamily = process.argv.includes('--vectors')
const brickFamily = process.argv.includes('--brick')
const clampFamily = process.argv.includes('--clamp')
const imageFamily = process.argv.includes('--images')
const mathFamily = process.argv.includes('--math')
const hueFamily = process.argv.includes('--hue-ramp')
const boundaryFamily = process.argv.includes('--boundary')
const mixFamily = process.argv.includes('--mix')
const mapRangeFamily = process.argv.includes('--map-range')
const family = imageFamily ? 'IMAGES' : clampFamily ? 'CLAMP' : brickFamily ? 'BRICK' : vectorFamily ? 'VECTORS' : mathFamily ? 'MATH' : hueFamily ? 'HUE_RAMP' : boundaryFamily ? 'MATH_BOUNDARY' : mapRangeFamily ? 'MAP_RANGE' : mixFamily ? 'MIX' : 'MAPPING'
const option = name => {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), name + ' requires a value')
  return process.argv[index + 1]
}
const retainedReference = option('--reference-dir')
const evidence = process.env.BLENDLINK_TSL_DIFF_ARTIFACTS ? resolve(process.env.BLENDLINK_TSL_DIFF_ARTIFACTS) : join(root, imageFamily ? 'artifacts/verification-images' : clampFamily ? 'artifacts/verification-clamp' : brickFamily ? 'artifacts/verification-brick' : vectorFamily ? 'artifacts/verification-vectors' : mathFamily ? 'artifacts/verification-shader-math' : hueFamily ? 'artifacts/verification-hue-ramp' : boundaryFamily ? 'artifacts/verification-math-boundary' : mapRangeFamily ? 'artifacts/verification-map-range' : mixFamily ? 'artifacts/verification-mix-math' : 'artifacts/verification-mapping')
const reference = retainedReference ? resolve(retainedReference) : join(evidence, 'reference')
mkdirSync(evidence, { recursive: true })
rmSync(join(evidence, 'report.json'), { force: true })
const manifest = JSON.parse(readFileSync(join(experiment, 'cells.json'), 'utf8'))
let ids = imageFamily
  ? ['constant-linear', 'uv-gradient', ...manifest.cells.filter(cell => cell.imageSampling || cell.imagePrecisionControl).map(cell => cell.id)]
  : clampFamily
  ? ['constant-linear', 'uv-gradient', ...manifest.cells.filter(cell => cell.clampSweep).map(cell => cell.id)]
  : brickFamily
  ? ['constant-linear', 'uv-gradient', ...manifest.cells.filter(cell => cell.brickSweep).map(cell => cell.id)]
  : vectorFamily
  ? ['constant-linear', 'uv-gradient', 'mapping-rotate', 'mapping-texture-mode', ...manifest.cells.filter(cell => cell.vectorSweep || cell.vectorTransform || cell.mappingSweep || cell.id.startsWith('vector-rotate-')).map(cell => cell.id)]
  : mathFamily
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
const selectedIds = option('--ids')?.split(',')
if (selectedIds) {
  assert.ok(selectedIds.length && selectedIds.every(id => ids.includes(id)), '--ids must name cases in the selected family')
  ids = ids.filter(id => selectedIds.includes(id))
}
let cells = ids.map(id => {
  const cell = manifest.cells.find(item => item.id === id)
  assert.ok(cell, `Missing ${family} differential cell ${id}`)
  return cell
})
const source = join(root, 'packages/blendlink/src/tslNodeRecipe.ts')
const built = join(root, 'packages/blendlink/dist/tslNodeRecipe.js')
const useBuilt = process.argv.includes('--built')
// Freeze both sides before native rendering begins. Other agents may edit a
// helper while a long oracle runs; every import still resolves to this capture.
const snapshot = join(evidence, 'module-snapshot-' + Date.now() + '-' + process.pid)
const nativeSnapshot = join(snapshot, 'native')
mkdirSync(nativeSnapshot, { recursive: true })
const { provenance: runtimeProvenance } = await captureRuntimeSnapshot({ root, built: useBuilt, destination: snapshot, label: family })
mkdirSync(nativeSnapshot, { recursive: true })
const testedModuleHashes = Object.fromEntries(runtimeProvenance.snapshot.files.map(file => [file.name, file.sha256]))
for (const directory of ['packages/blendlink/blender', 'packages/blender-addon'])
  for (const file of readdirSync(join(root, directory))) {
    if (file.endsWith('.py') || file.endsWith('.json')) copyFileSync(join(root, directory, file), join(nativeSnapshot, file))
  }
for (const file of ['reference.py', 'brick_reference.py', 'cells.json'])
  copyFileSync(join(experiment, file), join(nativeSnapshot, file))
const testedNativeModuleHashes = Object.fromEntries(readdirSync(nativeSnapshot).filter(file => /\.(py|json)$/.test(file))
  .map(file => [file, createHash('sha256').update(readFileSync(join(nativeSnapshot, file))).digest('hex')]))
const builder = join(snapshot, 'tslNodeRecipe.' + (useBuilt ? 'js' : 'ts'))
const emitter = join(root, 'packages/blender-addon/tsl_ir.py')
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const sourceHash = sha256(source)
const emitterHash = sha256(emitter)
let oracleOutput = 'Retained native Blender references (no new native capture)'
if (!retainedReference) {
const blender = process.env.BLENDLINK_BLENDER_PATH ?? process.env.BLENDLINK_BLENDER ?? execFileSync(process.execPath, [join(root, 'packages/blendlink/dist/cli.js'), 'discover'], {
  encoding: 'utf8', env: process.env,
}).trim().split(/\r?\n/).at(-1)
assert.ok(blender && existsSync(blender), 'Blender discovery did not return an executable')
const oracle = join(evidence, 'reference.py')
writeFileSync(oracle, [
  'import importlib.util, sys, json', 'from pathlib import Path',
  `sys.path.insert(0, ${JSON.stringify(nativeSnapshot)})`,
  `spec=importlib.util.spec_from_file_location("focused_reference", ${JSON.stringify(join(nativeSnapshot, 'reference.py'))})`,
  'module=importlib.util.module_from_spec(spec)', 'spec.loader.exec_module(module)',
  `selected=set(${JSON.stringify(ids)})`,
  '# Probe actual assignment in a shader tree, not global context-insensitive RNA alone.',
  'material=module.bpy.data.materials.new("Native Vector Operation Availability")',
  'material.use_nodes=True', 'probe=material.node_tree.nodes.new("ShaderNodeVectorMath")',
  'available=set()',
  'for item in probe.bl_rna.properties["operation"].enum_items:',
  '    if not item.identifier: continue',
  '    try: probe.operation=item.identifier',
  '    except (TypeError, ValueError): continue',
  '    available.add(item.identifier)',
  'requested=[cell for cell in module.CELLS["cells"] if cell["id"] in selected]',
  'skipped=[{"cell":cell["id"],"missingVectorMathOperations":[op for op in cell.get("requiresVectorMathOperations",[]) if op not in available]} for cell in requested]',
  'for item,cell in zip(skipped,requested):',
  '    minimum=cell.get("requiresBlenderVersion")',
  '    if minimum and tuple(module.bpy.app.version)<tuple(minimum): item["minimumBlenderVersion"]=minimum',
  'skipped=[item for item in skipped if item["missingVectorMathOperations"] or item.get("minimumBlenderVersion")]',
  'excluded={item["cell"] for item in skipped}',
  'module.CELLS={"size":64,"cells":[cell for cell in requested if cell["id"] not in excluded]}',
  `module.OUTPUT=Path(${JSON.stringify(reference)})`,
  '# CPU-only native oracle; this is not Blender GPU-render evidence.',
  'module.bakelib._CYCLES_GPU_BACKENDS=()', 'module.main()',
  'path=module.OUTPUT/"manifest.json"', 'document=json.loads(path.read_text())',
  'document["skippedNativeModes"]=skipped', 'document["nativeVectorMathOperations"]=sorted(available)',
  'document["nativeBlenderVersion"]=list(module.bpy.app.version)',
  'path.write_text(json.dumps(document,indent=2))', '',
].join('\n'))
oracleOutput = execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', oracle], {
  cwd: root, env: { ...process.env, BLENDLINK_TSL_NATIVE_MODULES: nativeSnapshot }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
})
writeFileSync(join(evidence, 'blender.log'), oracleOutput)
assert.match(oracleOutput, /BLENDLINK_TSL_DIFFERENTIAL_REFERENCE_DONE/)
}
const referenceManifest = JSON.parse(readFileSync(join(reference, 'manifest.json'), 'utf8'))
const skippedNativeModes = referenceManifest.skippedNativeModes ?? []
for (const id of ids) {
  const skipped = skippedNativeModes.find(item => item.cell === id)
  if (skipped) {
    const declared = cells.find(cell => cell.id === id)
    const missing = skipped.missingVectorMathOperations
    const validMissing = missing.length > 0 && missing.every(op =>
      declared.requiresVectorMathOperations?.includes(op) && !referenceManifest.nativeVectorMathOperations.includes(op))
    const versionNumber = version => version.reduce((sum, item, index) => sum + item * 1000 ** (2 - index), 0)
    const validVersion = skipped.minimumBlenderVersion &&
      JSON.stringify(skipped.minimumBlenderVersion) === JSON.stringify(declared.requiresBlenderVersion) &&
      versionNumber(referenceManifest.nativeBlenderVersion) < versionNumber(skipped.minimumBlenderVersion)
    assert.ok(validMissing || validVersion, 'An applicable native configuration was skipped')
    console.log(`BLENDLINK_${family}_NATIVE_CONFIGURATION_UNAVAILABLE ${id} ${JSON.stringify(skipped)}`)
  } else assert.ok(referenceManifest.cells[id], `Blender oracle missed ${id}`)
}
cells = cells.filter(cell => !skippedNativeModes.some(item => item.cell === cell.id))
const floats = bytes => new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
function difference(referencePixels, rendered, components, flipRows, allowance) {
  assert.equal(referencePixels.length, 64 * 64 * 3)
  assert.equal(rendered.length, 64 * 64 * components)
  const differences = []
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) for (let channel = 0; channel < 3; channel++) {
    const expected = referencePixels[(y * 64 + x) * 3 + channel]
    const actual = rendered[((flipRows ? 63 - y : y) * 64 + x) * components + channel]
    assert.ok(Number.isFinite(expected) && Number.isFinite(actual), 'Nonfinite material-graph sample')
    differences.push(Math.max(0, Math.abs(expected - actual) - (allowance?.(x, y, channel) ?? 0)))
  }
  differences.sort((a, b) => a - b)
  return { meanAbs: differences.reduce((a, b) => a + b, 0) / differences.length,
    p99Abs: differences[Math.floor(differences.length * .99)], maxAbs: differences.at(-1) }
}
const server = await createServer({
  root: experiment, configFile: false, logLevel: 'warn', cacheDir: join(evidence, 'vite-cache'),
  optimizeDeps: { noDiscovery: true }, resolve: { alias: { '@blendlink-tsl-recipe': builder } },
  server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null, hmr: false, fs: { allow: [root, reference] } },
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
    const positionControls = new Map()
    let imageRenderPrecisionCertified = false
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
      let maximumPrecisionBudget = budget.maxAbs
      if (cell.brickSweep?.positionControl) {
        let magnitude = 0
        for (let index = 0; index < expected.length; index++) magnitude = Math.max(magnitude, Math.abs(expected[index] - 2))
        positionControls.set(cell.id, { maximumError: measured.maxAbs, magnitude,
          expected, actual, components: rendered.components, flipRows: flipRows ?? false })
      }
      let precisionResidual = measured
      let maximumPositionAllowance = 0
      let nativeTargetAllowance = 0
      if (cell.nativeEngine === 'EEVEE') {
        const halfUlp = value => Math.max(2 ** (Math.floor(Math.log2(Math.abs(value) || 2 ** -14)) - 10), 2 ** -24)
        if (cell.imagePrecisionControl) {
          for (let channel = 0; channel < 3; channel++) {
            const value = cell.imagePrecisionControl[channel], reference = expected[channel], units = reference / halfUlp(reference)
            assert.ok(Math.abs(units - Math.round(units)) < 2e-4, 'Native image carrier is not representable half-float')
            assert.ok(Math.abs(value - reference) <= halfUlp(value) + 2e-6, 'Independent native image carrier exceeds half-float bound')
          }
          imageRenderPrecisionCertified = true
        }
        assert.ok(imageRenderPrecisionCertified, 'Native image target precision requires preceding independent controls')
        precisionResidual = difference(expected, actual, rendered.components, flipRows ?? false, (x, y, channel) => {
          const precision = halfUlp(expected[(y * 64 + x) * 3 + channel])
          nativeTargetAllowance = Math.max(nativeTargetAllowance, precision)
          return precision
        })
      }
      if (cell.smoothMortarPositionControl) {
        const control = positionControls.get(cell.smoothMortarPositionControl)
        assert.ok(control, 'Sharp mortar requires its preceding independent position control')
        const size = cell.brickSweep.inputs?.['Mortar Size'] ?? .02
        const smooth = cell.brickSweep.inputs?.['Mortar Smooth'] ?? .1
        assert.ok(size > 0 && smooth > 0, 'A discontinuous mortar cannot use a derivative allowance')
        const ulp = value => 2 ** (Math.floor(Math.log2(Math.max(Math.abs(value), 2 ** -126))) - 23)
        // Recovering p from its +2 carrier costs up to one ULP. The Brick
        // partition/remainder path adds at most eight rounded float operations
        // at this independently measured coordinate magnitude. Noise and hard
        // edges receive no such allowance; mean and p99 also stay unchanged.
        const distancePrecision = control.maximumError + ulp(control.magnitude + 2) +
          8 * ulp(control.magnitude + 1)
        const derivative = 1.5 / (size * smooth)
        const colorAmplitude = cell.brickSweep.output === 'Fac' ? 1 : 1.02
        maximumPrecisionBudget += derivative * distancePrecision * colorAmplitude
        const properties = cell.brickSweep.properties ?? {}
        const width = cell.brickSweep.inputs?.['Brick Width'] ?? .5
        const height = cell.brickSweep.inputs?.['Row Height'] ?? .25
        const offsetFrequency = properties.offset_frequency ?? 2, squashFrequency = properties.squash_frequency ?? 2
        const allowance = (x, y) => {
          const nativeIndex = (y * 64 + x) * 3
          const actualIndex = ((control.flipRows ? 63 - y : y) * 64 + x) * control.components
          const p = [control.expected[nativeIndex] - 2, control.expected[nativeIndex + 1] - 2]
          const error = Math.max(...[0, 1].map(channel =>
            Math.abs(control.expected[nativeIndex + channel] - control.actual[actualIndex + channel]) +
            ulp(control.expected[nativeIndex + channel]) + ulp(control.actual[actualIndex + channel])))
          const delta = error + 8 * ulp(Math.max(...p.map(Math.abs)) + 1)
          const row = Math.floor(p[1] / height)
          const w = width * (offsetFrequency && squashFrequency && row % squashFrequency === 0 ? Math.fround(properties.squash ?? 1) : 1)
          const offset = offsetFrequency && squashFrequency && row % offsetFrequency === 0 ? w * Math.fround(properties.offset ?? .5) : 0
          const brick = Math.floor((p[0] + offset) / w)
          const local = [p[0] + offset - w * brick, p[1] - height * row]
          const distance = Math.min(...local, w - local[0], height - local[1])
          const low = (1 - (distance + delta) / size) / smooth
          const high = (1 - (distance - delta) / size) / smooth
          // Outside the transition, the mortar is exactly saturated. An
          // input uncertainty interval receives only its local derivative,
          // rather than excusing every image pixel by a global maximum.
          const q = Math.min(1, Math.max(0, Math.min(high, Math.max(low, .5))))
          const localDerivative = high <= 0 || low >= 1 ? 0 : 6 * q * (1 - q) / (size * smooth)
          const bound = localDerivative * delta * colorAmplitude
          maximumPositionAllowance = Math.max(maximumPositionAllowance, bound)
          return bound
        }
        precisionResidual = difference(expected, actual, rendered.components, flipRows ?? false, allowance)
      }
      if (cell.claim === 'approximate') {
        assert.equal(cell.divergenceKind, 'bounded')
        assert.ok(cell.provenBy?.length && cell.provenBy.every(id => cells.some(item => item.id === id && item.claim === 'exact')), 'Approximate cells require included exact algorithm proofs')
      }
      const cellFailures = ['meanAbs', 'p99Abs', 'maxAbs']
        .filter(metric => precisionResidual[metric] > budget[metric])
        .map(metric => `${backend}/${cell.id} precision residual ${metric}=${precisionResidual[metric]} exceeds ${budget[metric]}`)
      failures.push(...cellFailures)
      results.push({ backend, cell: cell.id, flipRows: flipRows ?? null, ...measured,
        maximumPrecisionBudget, maximumPositionAllowance, nativeTargetAllowance, precisionResidual,
        positionPrecisionControl: cell.smoothMortarPositionControl ?? null })
      writeFileSync(join(evidence, `${backend}-${cell.id}.f32`), Buffer.from(actual.buffer))
      console.log(`BLENDLINK_${family}_CELL_${cellFailures.length ? 'FAILED' : 'PASSED'} ${backend} ${cell.id} maxAbs=${measured.maxAbs.toExponential(4)}`)
    }
    await page.close()
  }
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({
    family, oracle: 'Native Blender graphs, Cycles CPU isolated channels or explicitly selected EEVEE emission, linear float readback',
    builder: useBuilt ? 'built production module' : 'production TypeScript source via Vite',
    sourceSha256: sourceHash, emitterSha256: retainedReference ? null : emitterHash,
    nativeCapture: retainedReference ? 'retained reference replay; no current emitter execution' : 'fresh native capture',
    nativeReferenceDirectory: reference,
    nativeManifestSha256: sha256(join(reference, 'manifest.json')),
    testedIrSha256: Object.fromEntries(cells.map(cell => [cell.id, sha256(join(reference, 'ir', cell.id + '.json'))])),
    snapshot, runtimeProvenance, testedModuleHashes, testedNativeModuleHashes: retainedReference ? null : testedNativeModuleHashes,
    blender: oracleOutput.match(/Blender [^\r\n]+/)?.[0],
    sourceStable: sha256(source) === sourceHash, emitterStable: sha256(emitter) === emitterHash,
    requestedCellIds: ids, skippedNativeModes, nativeVectorMathOperations: referenceManifest.nativeVectorMathOperations,
    results, failures,
  }, null, 2) + '\n')
  assert.deepEqual(failures, [], `${family} native differential failed; see report.json`)
  console.log(`BLENDLINK_${family}_DIFFERENTIAL_PASSED both WebGPURenderer backends`)
} finally {
  await browser?.close()
  await server.close()
}
