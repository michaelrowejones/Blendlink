import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot, hash } from '../../scripts/lib/runtime-provenance.mjs'
const root = resolve(import.meta.dirname, '../..'),
  built = process.argv.includes('--built')
const native = resolve(
  process.env.BLENDLINK_NORMAL_NODE_NATIVE ??
    join(root, 'artifacts/verification-normal-nodes/native53'),
)
const compiled = join(native, 'compiled'),
  proof = JSON.parse(await readFile(join(compiled, 'proof.json'), 'utf8'))
if (built) assert.equal(proof.exporter, 'built')
const snapshot = join(native, 'runtime-snapshot-' + (built ? 'built' : 'source'))
const { provenance } = await captureRuntimeSnapshot({
  root,
  built,
  destination: snapshot,
  label: 'Primary normal',
})
provenance.browserHarnessSha256 = Object.fromEntries(await Promise.all(
  ['browser.js', 'index.html', 'run.mjs'].map(async file => [file, hash(await readFile(join(import.meta.dirname, file)))]),
))
provenance.nativeFixtureSha256 = hash(
  await readFile(join(root, 'packages/blender-addon/tests/normal_nodes_check.py')),
)
assert.equal(
  proof.references.fixtureSha256,
  provenance.nativeFixtureSha256,
  'Regenerate native geometry references after fixture edits',
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
      '@blendlink-geometry-runtime': join(snapshot, 'tslMaterialRuntime' + (built ? '.js' : '.ts')),
    },
  },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, native] } },
})
let browser
const rows = [],
  failures = []
try {
  await server.listen()
  const channel = process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL || null
  assert.ok(channel === null || channel === 'chromium', 'Only the bundled Chromium channel is allowed')
  browser = await chromium.launch({
    ...(channel ? { channel } : {}),
    headless: true,
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
    await page.goto(server.resolvedUrls.local[0] + '?backend=' + backend)
    await page.waitForFunction(() => typeof window.runProof === 'function')
    const result = await page.evaluate((proof) => window.runProof(proof), browserProof)
    assert.deepEqual(errors, [])
    assert.equal(result.backend, backend)
    rows.push(result)
    failures.push(...result.failures)
    await page.close()
  }
  await writeFile(
    join(native, 'browser-report.json'),
    JSON.stringify({ built, browserVersion: browser.version(), browserChannel: channel, provenance, rows, failures }, null, 2),
  )
  assert.deepEqual(failures, [], 'Native geometry contexts differ; see browser-report.json')
  console.log(
    'BLENDLINK_NORMAL_NODE_BROWSER_PASSED ' +
      JSON.stringify(
        rows.map((row) => ({ backend: row.backend, cases: row.cases, maximum: row.maximum })),
      ),
  )
} finally {
  await browser?.close()
  await server.close()
}
