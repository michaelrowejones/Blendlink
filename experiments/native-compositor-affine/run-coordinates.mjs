import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot, hash } from '../../scripts/lib/runtime-provenance.mjs'

const root = resolve(import.meta.dirname, '../..'), source = resolve(process.argv[2]), evidence = resolve(process.argv[3])
const built = process.argv.includes('--built')
const { provenance, sourceRecords } = await captureRuntimeSnapshot({ root, built, destination: join(evidence, 'module-snapshot'), label: 'affine-coordinate-fma' })
const accurate = process.argv.includes('--accurate')
const adapter = `export { ${accurate ? 'buildCompositorCoordinateFma' : 'buildNativeNoiseFma'} as buildCoordinateFma } from './${accurate ? 'tslCompositorCoordinateFma' : 'tslNativeNoisePrecision'}.${built ? 'js' : 'ts'}'\n`
const entry = join(evidence, 'module-snapshot/coordinate-adapter.ts')
await writeFile(entry, adapter)
provenance.adapter = { accurate, sha256: hash(adapter) }
const input = await readFile(source)
provenance.nativeCoordinates = { path: source, sha256: hash(input) }
await mkdir(join(evidence, 'public'), { recursive: true })
await writeFile(join(evidence, 'public/coordinates.json'), input)
await writeFile(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2))
const server = await createServer({ configFile: false, root: import.meta.dirname, publicDir: join(evidence, 'public'),
  cacheDir: join(evidence, 'vite-cache'), resolve: { dedupe: ['three'], alias: {
    'affine-fma-under-test': entry,
  } }, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, evidence] } } })
let browser
const results = []
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] })
  const url = server.resolvedUrls.local[0]
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage(), errors = [], consoleErrors = []
    page.on('pageerror', error => errors.push(String(error)))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.goto(url + 'coordinates.html?backend=' + backend)
    await page.waitForFunction(() => window.__affineResults || window.__affineFailure, undefined, { timeout: 180000 })
    const result = await page.evaluate(() => ({ rows: window.__affineResults, failure: window.__affineFailure }))
    results.push({ backend, ...result, errors, consoleErrors })
    await page.close()
  }
} finally { await browser?.close(); await server.close() }
provenance.workspaceSourceChangesDuringRun = []
for (const module of sourceRecords) if (hash(await readFile(module.source)) !== hash(module.contents)) provenance.workspaceSourceChangesDuringRun.push(module.source)
await writeFile(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2))
await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2))
for (const backend of results) {
  assert.ok(!backend.failure, backend.failure)
  assert.equal(backend.errors.length + backend.consoleErrors.length, 0, JSON.stringify(backend))
  assert.ok(backend.rows.every(row => !row.error && row.bad === 0 && row.zeroSigns === 0 && row.shaderErrors.length === 0), JSON.stringify(backend.rows.filter(row => row.error || row.bad)))
  console.log('BLENDLINK_AFFINE_COORDINATES_PASSED', backend.backend, backend.rows.length,
    'max=' + Math.max(...backend.rows.map(row => row.max)), 'zeroSigns=' + backend.rows.reduce((sum, row) => sum + row.zeroSigns, 0))
}
