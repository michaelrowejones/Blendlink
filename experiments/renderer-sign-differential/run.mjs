import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot, hash } from '../../scripts/lib/runtime-provenance.mjs'
const root = resolve(import.meta.dirname, '../..'),
  directory = resolve(
    process.env.BLENDLINK_RENDERER_SIGN_NATIVE ?? 'artifacts/verification-renderer-sign53',
  )
const baseline = process.argv.includes('--baseline')
const blender = process.env.BLENDLINK_RENDERER_SIGN_BLENDER
if (!blender) throw new Error('Set BLENDLINK_RENDERER_SIGN_BLENDER')
const env = { ...process.env, BLENDLINK_RENDERER_SIGN_REFERENCES: directory }
if (!process.argv.includes('--reuse-native'))
  execFileSync(
    blender,
    [
      '--background',
      '--factory-startup',
      '--python-exit-code',
      '1',
      '--python',
      'packages/blender-addon/tests/renderer_sign_transition_check.py',
    ],
    { cwd: root, env, stdio: 'inherit' },
  )
execFileSync(
  process.execPath,
  [
    'packages/blendlink/scripts/run-vitest.mjs',
    'experiments/renderer-sign-differential/export.test.ts',
  ],
  { cwd: root, env, stdio: 'inherit' },
)
const proof = JSON.parse(await readFile(join(directory, 'compiled/proof.json'), 'utf8'))
const snapshot = join(directory, 'runtime-snapshot-built'),
  { provenance } = await captureRuntimeSnapshot({
    root,
    built: true,
    destination: snapshot,
    label: 'Actual Final sign transitions',
  })
const fixtureSha256 = hash(
  await readFile(join(root, 'packages/blender-addon/tests/renderer_sign_transition_check.py')),
)
assert.equal(proof.reference.fixtureSha256, fixtureSha256)
const server = await createServer({
  root: import.meta.dirname,
  configFile: false,
  logLevel: 'warn',
  cacheDir: join(directory, 'vite-cache'),
  publicDir: join(directory, 'compiled/public'),
  optimizeDeps: { noDiscovery: true },
  resolve: {
    dedupe: ['three'],
    alias: { '@sign-runtime': join(snapshot, 'tslMaterialRuntime.js') },
  },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, directory] } },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL
      ? { channel: process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL }
      : {}),
    args: [
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      ...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS ?? '[]'),
    ],
  })
  const rows = []
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage(),
      errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(server.resolvedUrls.local[0])
    await page.waitForFunction(() => typeof window.runProof === 'function')
    const browserProof = {
      ...proof,
      withoutOrientationHook: baseline,
      scenes: proof.scenes.map((scene) => ({
        ...scene,
        manifestUrl: '/@fs' + join(directory, 'compiled', scene.manifestUrl),
      })),
    }
    if (baseline && backend === 'webgpu') {
      let failure
      try {
        await page.evaluate(({ proof, backend }) => window.runProof(proof, backend), {
          proof: browserProof,
          backend,
        })
      } catch (error) {
        failure = error.message
      }
      assert.match(
        failure ?? '',
        /Actual Final sign transition failed/,
        'The unpatched pipeline must reproduce the native pixel failure',
      )
      rows.push({
        backend,
        expectedFailure: true,
        failure,
        gpu: await page.evaluate(() => window.rendererSignGpu),
      })
    } else {
      const result = await page.evaluate(({ proof, backend }) => window.runProof(proof, backend), {
        proof: browserProof,
        backend,
      })
      rows.push(result)
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  const harnessSources = await Promise.all(
    ['browser.js', 'run.mjs', 'export.test.ts'].map(async (name) => ({
      name,
      sha256: hash(await readFile(join(import.meta.dirname, name))),
    })),
  )
  await writeFile(
    join(
      directory,
      (baseline ? 'baseline-' : 'results-') +
        (process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL ?? 'shell') +
        '.json',
    ),
    JSON.stringify(
      { provenance, fixtureSha256, harnessSources, sourceUnchanged: proof.sourceUnchanged, rows },
      null,
      2,
    ),
  )
  console.log(
    (baseline
      ? 'BLENDLINK_RENDERER_SIGN_BASELINE_REPRODUCED '
      : 'BLENDLINK_RENDERER_SIGN_BROWSER_PASSED ') +
      JSON.stringify(
        rows.map(({ backend, gpu, cases, maximum, callbackCalls, pipelineChecks }) => ({
          backend,
          gpu,
          cases,
          maximum,
          callbackCalls,
          pipelineChecks,
        })),
      ),
  )
} finally {
  await browser?.close()
  await server.close()
}
