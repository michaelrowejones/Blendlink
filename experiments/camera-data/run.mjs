import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot, hash } from '../../scripts/lib/runtime-provenance.mjs'
const root = resolve(import.meta.dirname, '../..'),
  built = process.argv.includes('--built'), ownership=process.argv.includes('--ownership')
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
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL ? {channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL} : {}),
    args: [
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      ...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS ?? '[]'),
    ],
  })
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage(),
      errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(server.resolvedUrls.local[0] + (ownership?'ownership.html':'')+'?backend=' + backend)
    await page.waitForFunction(() => typeof window.runProof === 'function')
    const result = await page.evaluate((proof) => window.runProof(proof), browserProof)
    assert.deepEqual(errors, [])
    assert.equal(result.backend, backend)
    rows.push(result)
    failures.push(...result.failures)
    await page.close()
  }
  await writeFile(
    join(native, (ownership?'ownership-report-':'browser-report-')+(process.env.BLENDLINK_TEST_PROFILE??'default')+'.json'),
    JSON.stringify({ built, provenance, rows, failures }, null, 2),
  )
  assert.deepEqual(failures, [], 'Native geometry contexts differ; see browser-report.json')
  console.log(
    (ownership?'BLENDLINK_CAMERA_DATA_OWNERSHIP_PASSED ':'BLENDLINK_CAMERA_DATA_BROWSER_PASSED ') +
      JSON.stringify(
        rows.map((row) => ({ backend: row.backend, cases: row.cases, maximum: row.maximum })),
      ),
  )
} finally {
  await browser?.close()
  await server.close()
}
