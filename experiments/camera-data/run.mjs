import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot, hash } from '../../scripts/lib/runtime-provenance.mjs'
const headlessValue = process.env.BLENDLINK_TEST_CHROMIUM_HEADLESS ?? '1'
assert.ok(['0', '1'].includes(headlessValue), 'BLENDLINK_TEST_CHROMIUM_HEADLESS must be 0 or 1')
const headless = headlessValue === '1'
const root = resolve(import.meta.dirname, '../..'),
  built = process.argv.includes('--built'), ownership=process.argv.includes('--ownership'),
  diagnosticDeviceLoss = process.argv.includes('--diagnostic-device-loss')
assert.ok(!diagnosticDeviceLoss || !ownership, 'The explicit device-loss failure control belongs to the numerical fixture')
const native = resolve(
  process.env.BLENDLINK_CAMERA_DATA_NATIVE ?? join(root, 'artifacts/camera-data/native53'),
)
const compiled = join(native, 'compiled'),
  proof = JSON.parse(await readFile(join(compiled, 'proof.json'), 'utf8'))
if (built) assert.equal(proof.exporter, 'built')
const snapshot = join(native, 'runtime-snapshot-' + (built ? 'built' : 'source')+'-'+(process.env.BLENDLINK_TEST_PROFILE??'default')+(ownership?'-ownership':''))
const { provenance } = await captureRuntimeSnapshot({
  root,
  built,
  destination: snapshot,
  label: 'Camera Data',
})
provenance.browserFixtureSha256=hash(await readFile(join(import.meta.dirname,ownership?'ownership.js':'browser.js')))
provenance.nativeFixtureSha256 = hash(
  await readFile(join(root, 'packages/blender-addon/tests/camera_data_check.py')),
)
assert.equal(
  proof.references.fixtureSha256,
  provenance.nativeFixtureSha256,
  'Regenerate native Camera Data references after fixture edits',
)
assert.equal(
  proof.nativeReferenceSha256,
  hash(await readFile(join(native, 'native-reference.json'))),
  'Final proof must bind the exact native reference bytes',
)
const browserProof = {
  ...proof,
  scenes: proof.scenes.map((scene) => ({
    ...scene,
    manifestUrl: '/@fs' + join(compiled, scene.manifestUrl.replace(/^\//, '')),
  })),
}
const server = await createServer({
  root: import.meta.dirname,
  publicDir: join(compiled, 'public'),
  configFile: false,
  logLevel: 'warn',
  cacheDir: join(native, 'vite-cache'),
  optimizeDeps: { noDiscovery: true },
  resolve: {
    dedupe: ['three'],
    alias: {
      '@blendlink-camera-recipe': join(snapshot, 'tslNodeRecipe' + (built ? '.js' : '.ts')),
      '@blendlink-camera-program': join(snapshot, 'tslMaterialProgram' + (built ? '.js' : '.ts')),
      '@blendlink-camera-document': join(snapshot, 'materialProgramDocument' + (built ? '.js' : '.ts')),
      '@blendlink-camera-runtime': join(snapshot, 'tslMaterialRuntime' + (built ? '.js' : '.ts')),
    },
  },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, native] } },
})
let browser
const rows = [],
  failures = []
const reportPath = join(native, (ownership?'ownership-report-':'browser-report-')+(process.env.BLENDLINK_TEST_PROFILE??'default')+'.json')
const report = { schemaVersion: 1, built, provenance, diagnosticDeviceLoss, requestedHeadless: headless, complete: false,
  completedAllBackends: false, rows, failures, backendRuns: [] }
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2))
const describe = error => ({ name: error.name, message: error.message, stack: error.stack })
await save()
try {
  await server.listen()
  browser = await chromium.launch({
    headless,
    ...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL ? {channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL} : {}),
    args: [
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      ...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS ?? '[]'),
    ],
  })
  report.browserVersion = browser.version()
  const session = await browser.newBrowserCDPSession()
  report.systemInfo = await session.send('SystemInfo.getInfo')
  report.commandLine = await session.send('Browser.getBrowserCommandLine')
    .then(result => result.arguments).catch(error => ({ unavailable: error.message }))
  await session.detach()
  await save()
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage(),
      errors = []
    const run = { backend, status: 'running', startedAt: new Date().toISOString(),
      errors, progress: [], pageEvents: [] }
    report.backendRuns.push(run)
    await save()
    await page.exposeFunction('cameraDataProgress', phase => { run.progress.push(phase) })
    page.on('crash', () => run.pageEvents.push({ event: 'crash', at: new Date().toISOString() }))
    page.on('close', () => run.pageEvents.push({ event: 'close', at: new Date().toISOString() }))
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    try {
      await page.goto(server.resolvedUrls.local[0] + (ownership?'ownership.html':'')+'?backend=' + backend +
        (diagnosticDeviceLoss ? '&diagnosticDeviceLoss=1' : ''))
      await page.waitForFunction(() => typeof window.runProof === 'function')
      const result = await page.evaluate((proof) => window.runProof(proof), browserProof)
      // Retain completed numerical rows before any console/backend assertion.
      rows.push(result)
      failures.push(...result.failures)
      run.result = result
      run.status = 'completed'
      await save()
      assert.deepEqual(errors, [])
      assert.equal(result.backend, backend)
      assert.deepEqual(result.uncapturedErrors ?? [], [], 'Uncaptured GPU errors invalidate the proof')
      assert.deepEqual(result.contextEvents ?? [], [], 'Unexpected WebGL context events invalidate the proof')
      assert.deepEqual((result.deviceLosses ?? []).filter(event => event.phase?.name !== 'renderer-dispose'), [],
        'Unexpected WebGPU device loss invalidates the proof')
    } catch (error) {
      run.status = 'failed'
      run.error = describe(error)
      run.partial = await page.evaluate(() => window.cameraDataProof ?? null).catch(snapshotError => ({
        unavailable: describe(snapshotError),
      }))
      failures.push({ backend, kind: 'execution-or-validation', error: run.error })
    } finally {
      run.finishedAt = new Date().toISOString()
      await save()
      await page.close()
    }
  }
  report.complete = true
  report.completedAllBackends = report.backendRuns.length === 2 && report.backendRuns.every(run => run.status === 'completed')
  await save()
  assert.deepEqual(failures, [], 'Native geometry contexts differ; see browser-report.json')
  assert.equal(report.completedAllBackends, true, 'Both requested browser backends must complete')
  console.log(
    (ownership?'BLENDLINK_CAMERA_DATA_OWNERSHIP_PASSED ':'BLENDLINK_CAMERA_DATA_BROWSER_PASSED ') +
      JSON.stringify(
        rows.map((row) => ({ backend: row.backend, cases: row.cases, maximum: row.maximum })),
      ),
  )
} catch (error) {
  report.error = describe(error)
  await save()
  throw error
} finally {
  await browser?.close()
  await server.close()
}
