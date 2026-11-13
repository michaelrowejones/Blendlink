import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { captureRuntimeSnapshot, hash } from '../../scripts/lib/runtime-provenance.mjs'

const root = resolve(import.meta.dirname, '../..'), evidence = resolve(process.argv[2])
await mkdir(evidence, { recursive: true })
const snapshot = join(evidence, 'snapshot'), { provenance } = await captureRuntimeSnapshot({ root, built: true, destination: snapshot, label: 'luma-performance' })
const harness = join(evidence, 'harness'); await mkdir(harness, { recursive: true })
provenance.harnessSha256 = {}
for (const name of ['performance.html', 'performance-browser.ts']) {
  const bytes = await readFile(join(import.meta.dirname, name))
  await copyFile(join(import.meta.dirname, name), join(harness, name)); provenance.harnessSha256[name] = hash(bytes)
}
const server = await createServer({ configFile: false, root: harness, cacheDir: join(evidence, 'cache'), resolve: { dedupe: ['three'], alias: { 'luma-key-under-test': join(snapshot, 'tslCompositorLuminanceKey.js') } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, evidence] } } })
let browser
const reports = []
try {
  await server.listen(); browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] })
  provenance.browserVersion = browser.version()
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(server.resolvedUrls.local[0] + 'performance.html?backend=' + backend)
    await page.waitForFunction(() => window.__lumaPerformance || window.__lumaPerformanceError, null, { timeout: 120000 })
    const result = await page.evaluate(() => ({ rows: window.__lumaPerformance, error: window.__lumaPerformanceError }))
    reports.push({ backend, ...result, errors }); await page.close()
    assert.equal(result.error, undefined); assert.deepEqual(errors, []); assert.equal(result.rows.length, 6)
  }
  console.log('BLENDLINK_LUMA_COMPLETED_FRAME_TIMING_RECORDED')
} finally { await browser?.close(); await server.close(); await writeFile(join(evidence, 'results.json'), JSON.stringify(reports, null, 2)); await writeFile(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2)) }
