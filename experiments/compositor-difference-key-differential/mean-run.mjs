import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { validateDifferenceMeanReference } from '../../scripts/lib/difference-precision-evidence.mjs'
const args = process.argv.slice(2), out = args.indexOf('--out')
assert.ok(out > 0 && args[out + 1], 'Pass native mean directories then --out /absolute/evidence')
const evidence = resolve(args[out + 1]), root = resolve(import.meta.dirname, '../..'), publicDir = join(evidence, 'public')
await mkdir(publicDir, { recursive: true }); const files = [], modules = {}
for (const [index, directory] of args.slice(0, out).entries()) {
  const name = index + '.json'; await copyFile(join(resolve(directory), 'mean.json'), join(publicDir, name))
  validateDifferenceMeanReference(JSON.parse(await readFile(join(publicDir, name), 'utf8')), process.env.BLENDLINK_DIFFERENCE_EXPECTED_NATIVE)
  files.push(name)
}
await writeFile(join(publicDir, 'index.json'), JSON.stringify(files))
for (const name of ['tslCompositorDifferenceKey.ts', 'tslCompositorCpuDistanceRatio.ts']) {
  const bytes = await readFile(join(root, 'packages/blendlink/src', name)); await writeFile(join(evidence, name), bytes)
  modules[name] = createHash('sha256').update(bytes).digest('hex')
}
await writeFile(join(evidence, 'provenance.json'), JSON.stringify({ proof: 'independent native CPU mean vs immutable production TS helper source', modules, references: args.slice(0, out) }, null, 2))
const server = await createServer({ configFile: false, root: import.meta.dirname, publicDir, cacheDir: join(evidence, 'cache'),
  resolve: { dedupe: ['three'], alias: { 'blendlink-mean-under-test': join(evidence, 'tslCompositorDifferenceKey.ts') } },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [root, evidence] } } })
let browser; const results = [], failures = []
try {
  await server.listen(); browser = await chromium.launch({ headless: true, ...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL ? { channel: process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL } : {}),
    args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')] })
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(String(error))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    try {
      await page.goto(server.resolvedUrls.local[0] + 'mean.html?backend=' + backend)
      await page.waitForFunction(() => window.__meanResult || window.__meanFailure, null, { timeout: 120000 })
      const result = await page.evaluate(() => ({ rows: window.__meanResult, failure: window.__meanFailure }))
      results.push({ backend, ...result, errors }); await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2))
      assert.equal(result.failure, undefined); assert.deepEqual(errors, []); assert.equal(result.rows.length, files.length)
      for (const row of result.rows) { assert.equal(row.count, 16384); assert.equal(row.mismatches, 0, JSON.stringify(row)); assert.equal(row.remainingTextures, 0) }
      console.log('BLENDLINK_DIFFERENCE_CPU_MEAN_BITS_PASSED', backend, result.rows.reduce((s, row) => s + row.count, 0))
    } catch (error) {
      failures.push({ backend, error: String(error) })
      if (!results.some(row => row.backend === backend)) results.push({ backend, error: String(error), errors, progress: await page.evaluate(() => window.__meanProgress).catch(() => null) })
      await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2))
    } finally { await page.close() }
  }
} finally { await browser?.close(); await server.close() }
assert.equal(failures.length, 0, JSON.stringify(failures))
