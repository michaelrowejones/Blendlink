// SPDX-License-Identifier: Apache-2.0
// Private research, not an SDK or publication acceptance gate.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { candidate, qualifies, assertNativeStage, assertActualApis } from './trial-domain.mjs'

const root = resolve(import.meta.dirname, '../..'), args = process.argv.slice(2)
const variant = args[args.indexOf('--variant') + 1] || 'intrinsic-v1'
const costOnly = args.includes('--cost-only'), measureCost = costOnly || args.includes('--cost')
assert.ok(['intrinsic-v1', 'portable-trig-v1'].includes(variant))
const profile = process.env.BLENDLINK_TEST_PROFILE || 'software'
assert.ok(['software', 'metal'].includes(profile))
const evidence = resolve(process.env.BLENDLINK_RADIAL_TRIAL_EVIDENCE || join(root, 'artifacts/radial', `trial-${variant}-${profile}-${Date.now()}`))
const nativeDirectories = (process.env.BLENDLINK_RADIAL_TRIAL_NATIVE || 'artifacts/radial/eevee52-calibrated,artifacts/radial/eevee53-calibrated').split(',').map(path => resolve(root, path))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const snapshot = join(evidence, 'snapshot'), sourcePins = {}, rows = [], executions = [], initializations = [], costs = []
await mkdir(snapshot, { recursive: true })
for (const [source, destination] of [['experiments/radial-tiling-research/trial-kernel.js', 'trial-kernel.js'], ['experiments/radial-tiling-research/trial-browser.js', 'trial-browser.js'], ['experiments/radial-tiling-research/trial.html', 'index.html'], ['packages/blendlink/src/tslPortableTrig.ts', 'tslPortableTrig.ts']]) {
  const bytes = await readFile(join(root, source)); sourcePins[source] = hash(bytes)
  await copyFile(join(root, source), join(snapshot, destination))
  assert.equal(hash(await readFile(join(snapshot, destination))), hash(bytes))
}
sourcePins['package-lock.json'] = hash(await readFile(join(root, 'package-lock.json')))
for (const file of ['experiments/radial-tiling-research/trial-run.mjs', 'experiments/radial-tiling-research/trial-domain.mjs', 'node_modules/three/build/three.core.js', 'node_modules/three/build/three.module.js', 'node_modules/three/build/three.webgpu.js', 'node_modules/three/build/three.tsl.js']) sourcePins[file] = hash(await readFile(join(root, file)))
const inputs = []
for (const directory of nativeDirectories) {
  const bytes = await readFile(join(directory, 'index.json')), native = JSON.parse(bytes)
  assert.equal(native.proofRole, 'ACTUAL_NATIVE_EEVEE_KERNEL_RESEARCH_NO_PORT')
  assert.equal(native.sourceEngine, 'BLENDER_EEVEE'); assert.equal(native.nativeGpuProfile.backend, 'METAL')
  assert.ok(['5.2.0', '5.3.0'].includes(native.version.join('.')))
  assert.equal(native.sourcePreserved, true); assert.equal(native.sourceReloadPreserved, true)
  const fixturePins = await Promise.all(['native_eevee.py', 'trial_reference.py'].map(async name => ({ name, sha256: hash(await readFile(join(root, 'experiments/radial-tiling-research', name))) })))
  const matchingFixture = fixturePins.find(row => row.sha256 === native.fixtureSha256)
  assert.ok(matchingFixture, 'Native fixture is not one of the current actual EEVEE generators')
  assert.equal(native.carrier.absoluteQuantizationBound, 16 / 2 ** 29)
  const fieldBytes = await readFile(join(directory, native.inputField.file)); assert.equal(hash(fieldBytes), native.inputField.sha256)
  assert.equal(native.sourceBlendSha256, hash(await readFile(join(directory, 'actual-source-materials.blend'))))
  const size = Math.sqrt(native.inputField.shape[0]); assert.ok(Number.isInteger(size))
  const field = new Float32Array(fieldBytes.buffer.slice(fieldBytes.byteOffset, fieldBytes.byteOffset + fieldBytes.length))
  const cases = []
  for (const entry of native.cases.filter(row => Number.isInteger(row.case.sides) && row.case.sides >= 3 && row.case.roundness === 0)) {
    assertNativeStage(entry.case.stage)
    const expectedBytes = await readFile(join(directory, entry.decoded)); assert.equal(hash(expectedBytes), entry.sha256)
    const mask = await readFile(join(directory, entry.finiteBandMask)); assert.equal(hash(mask), entry.finiteBandMaskSha256)
    for (const [key, sha] of [['packed', 'packedSha256'], ['coarse', 'coarseSha256']]) assert.equal(hash(await readFile(join(directory, entry[key]))), entry[sha])
    cases.push({ ...entry, expected: new Float32Array(expectedBytes.buffer.slice(expectedBytes.byteOffset, expectedBytes.byteOffset + expectedBytes.length)), mask })
  }
  inputs.push({ directory, native, size, field, cases, indexSha256: hash(bytes) })
}

const server = await createServer({ root: snapshot, configFile: false, publicDir: false, cacheDir: join(evidence, 'vite-cache'), logLevel: 'warn', optimizeDeps: { noDiscovery: true }, resolve: { dedupe: ['three'], alias: { '@radial-trial-kernel': join(snapshot, 'trial-kernel.js'), '@radial-portable-trig': join(snapshot, 'tslPortableTrig.ts') } }, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root] } } })
let browser, status = 'running', gpuProcessInfo
const report = () => ({ proofRole: costOnly ? 'PRIVATE_RADIAL_COMPLETED_FRAME_COST_TRIAL' : 'PRIVATE_RADIAL_UNROUNDED_KERNEL_TRIAL', status, variant, profile, candidate, kernelTolerance: 2e-5, nativeCarrierBudget: 16 / 2 ** 29, native: inputs.map(x => ({ version: x.native.version, buildHash: x.native.buildHash, nativeGpuProfile: x.native.nativeGpuProfile, indexSha256: x.indexSha256, cases: x.cases.length })), sourcePins, gpuProcessInfo, initializations, rows, executions, costs, noProductionOpcode: true, finalSiteProofs: 0 })
const save = () => writeFile(join(evidence, 'report.json'), JSON.stringify(report(), null, 2))
await save()
try {
  await server.listen()
  const flags = JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]'); assert.ok(Array.isArray(flags) && flags.every(x => typeof x === 'string'))
  browser = await chromium.launch({ headless: true, ...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL ? { channel: process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL } : {}), args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...flags] })
  const session = await browser.newBrowserCDPSession(); gpuProcessInfo = await session.send('SystemInfo.getInfo')
  for (const backend of ['webgpu', 'webgl2']) {
    for (const input of (costOnly ? inputs.slice(0, 1) : inputs)) {
      const label = input.native.version.join('-') + '-' + backend
      const page = await browser.newPage(), errors = []
      page.on('pageerror', error => errors.push(String(error)))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      try {
        await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => typeof window.initializeTrial === 'function')
        const init = await page.evaluate(value => window.initializeTrial(value), { backend, input: '/@fs' + join(input.directory, input.native.inputField.file), size: input.size })
        assert.equal(init.backend, backend)
        const driver = JSON.stringify(init.gpu).toLowerCase()
        if (profile === 'software') assert.match(driver, /swiftshader/)
        else { assert.match(driver, /apple|metal/); assert.doesNotMatch(driver, /swiftshader/) }
        initializations.push({ ...init, nativeVersion: input.native.version, requestedBackend: backend })
        const calibration = await page.evaluate(value => window.runTrial(value), { mode: 'input', output: 'y' })
        // Use an exact independent input-plane orientation control, not kernel pixels.
        const read = payload => { const b = Buffer.from(payload, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) }
        const values = read(calibration.pixels)
        const inputError = flip => {
          let maximum = 0
          for (let y = 0; y < input.size; y++) for (let x = 0; x < input.size; x++) maximum = Math.max(maximum, Math.abs(values[(y * input.size + x) * 4] - input.field[((flip ? input.size - 1 - y : y) * input.size + x) * 3 + 1]))
          return maximum
        }
        const flip = inputError(true) < inputError(false), inputMaximum = inputError(flip)
        assert.equal(inputMaximum, 0, 'Raw Float32 input transport/orientation calibration must be exact')
        initializations.at(-1).inputControl = { maximum: inputMaximum, flip, rawFloat32: true }
        if (measureCost && input === inputs[0]) {
          const cost = await page.evaluate(value => window.benchmarkTrial(value), { variant })
          assert.equal(cost.backend, backend); assert.deepEqual(cost.errors, []); assert.deepEqual(errors, [])
          for (const row of cost.rows) {
            const shader = row.shader; delete row.shader
            row.fragmentShaderSha256 = hash(shader.fragmentShader); row.fragmentShaderBytes = Buffer.byteLength(shader.fragmentShader)
            const file = backend + '-cost-' + row.mode + (backend === 'webgpu' ? '.wgsl' : '.glsl')
            await writeFile(join(evidence, file), shader.fragmentShader); row.fragmentShaderFile = file
          }
          costs.push(cost); await save()
        }
        for (const entry of (costOnly ? [] : input.cases)) {
          const literal = entry.case.stage === 'literal' ? entry.case.coordinate : null
          const output = entry.channel !== null ? (entry.channel === 0 ? 'x' : 'y') : { 'Segment ID': 'id', 'Segment Width': 'width', 'Segment Rotation': 'rotation' }[entry.output]
          const rendered = await page.evaluate(value => window.runTrial(value), { sides: entry.case.sides, normalize: entry.case.normalize, variant, output, literal, captureShader: true })
          assert.equal(rendered.backend, backend); assert.deepEqual(rendered.errors, []); assert.deepEqual(errors, [])
          const actual = read(rendered.pixels), raw = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength)
          const filename = label + '-' + entry.id + '.f32'; await writeFile(join(evidence, filename), raw)
          const shaderFile = filename.replace('.f32', backend === 'webgpu' ? '.wgsl' : '.glsl')
          await writeFile(join(evidence, shaderFile), rendered.shader.fragmentShader)
          let maximum = 0, allComparableMaximum = 0, failedSamples = 0, qualifiedSamples = 0, nativeUnqualifiedSamples = 0, outsideCandidateSamples = 0, nonfiniteCandidateSamples = 0, rawNonfiniteSamples = 0, literalMaximum = 0, literalFailedSamples = 0
          const witnesses = []
          for (let y = 0; y < input.size; y++) for (let x = 0; x < input.size; x++) {
            const sample = (flip ? input.size - 1 - y : y) * input.size + x, value = actual[(y * input.size + x) * 4]
            if (!Number.isFinite(value)) rawNonfiniteSamples++
            if (!entry.mask[sample]) { nativeUnqualifiedSamples++; continue }
            const expected = entry.expected[sample], error = Math.abs(value - expected)
            if (Number.isFinite(error)) allComparableMaximum = Math.max(allComparableMaximum, error)
            if (literal) { if (Number.isFinite(error)) literalMaximum = Math.max(literalMaximum, error); if (!Number.isFinite(value) || error > 2e-5 + input.native.carrier.absoluteQuantizationBound) literalFailedSamples++ }
            const point = [input.field[sample * 3], input.field[sample * 3 + 1]]
            if (literal || !qualifies(...point, entry.case.sides)) { outsideCandidateSamples++; continue }
            qualifiedSamples++
            if (!Number.isFinite(value)) nonfiniteCandidateSamples++
            else maximum = Math.max(maximum, error)
            const allowance = output === 'id' ? 0 : 2e-5 + input.native.carrier.absoluteQuantizationBound
            if (!Number.isFinite(value) || error > allowance) { failedSamples++; if (witnesses.length < 4) witnesses.push({ sample, point, value: Number.isFinite(value) ? value : String(value), expected, error: Number.isFinite(error) ? error : String(error), allowance }) }
          }
          rows.push({ nativeVersion: input.native.version, backend, id: entry.id, output, nativeSourceStage: literal ? 'native-mf-literal-control' : 'native-shader-field', rawFile: filename, rawSha256: hash(raw), fragmentShaderFile: shaderFile, fragmentShaderSha256: hash(rendered.shader.fragmentShader), fragmentShaderBytes: Buffer.byteLength(rendered.shader.fragmentShader), maximum, allComparableMaximum, rawNonfiniteSamples, failedSamples, qualifiedSamples, nativeUnqualifiedSamples, outsideCandidateSamples, nonfiniteCandidateSamples, literalMaximum, literalFailedSamples, witnesses, elapsedMs: rendered.elapsedMs })
          await save()
        }
      } catch (error) { executions.push({ label, requestedBackend: backend, error: String(error), pageErrors: errors }) }
      finally { await page.evaluate(() => window.closeTrial?.()).catch(() => {}); await page.close(); await save() }
    }
  }
  for (const [file, pin] of Object.entries(sourcePins)) assert.equal(hash(await readFile(join(root, file))), pin, 'Private source changed during captured run')
  assert.equal(executions.length, 0, 'Actual backend execution failed; inspect report')
  if (!costOnly) assertActualApis(initializations)
  if (!costOnly) assert.ok(rows.some(row => row.qualifiedSamples > 0))
  assert.equal(rows.reduce((n, row) => n + row.failedSamples, 0), 0, 'Bounded private trial failed; raw pixels and witnesses retained')
  status = costOnly ? 'completed-frame-cost-recorded' : 'bounded-candidate-passed-with-explicit-exclusions'
  if (costOnly) console.log('BLENDLINK_RADIAL_PRIVATE_COST_CAPTURED', variant, profile, costs.length, 'actual APIs; no numerical pass claim')
  else console.log('BLENDLINK_RADIAL_PRIVATE_TRIAL_PASSED', variant, profile, rows.length, 'output planes; exclusions and native-MF controls remain separate')
} catch (error) { status = 'failed'; await save(); throw error }
finally { await save(); await browser?.close(); await server.close() }
