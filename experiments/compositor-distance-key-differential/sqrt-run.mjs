import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { validateDistanceArithmeticReference } from '../../scripts/lib/distance-arithmetic-reference.mjs'

const args = process.argv.slice(2), position = args.indexOf('--out')
assert.ok(position > 0 && args[position + 1], 'Pass reference directories followed by --out /absolute/evidence')
const output = resolve(args[position + 1]), root = resolve(import.meta.dirname, '../..'), input = join(output, 'public')
await mkdir(input, { recursive: true }); const files = [], nativeRecords = []; let hasBitControls = false, hasRatioControls = false
for (const [index, directory] of args.slice(0, position).entries()) {
  const file = 'native-' + index + '.json'; await copyFile(join(resolve(directory), 'sqrt.json'), join(input, file)); files.push(file)
  const record = JSON.parse(await readFile(join(input, file), 'utf8'))
  nativeRecords.push({ file, ...validateDistanceArithmeticReference(record, process.env.BLENDLINK_DISTANCE_EXPECTED_NATIVE),
    referenceSha256: createHash('sha256').update(await readFile(join(input, file))).digest('hex') })
  hasBitControls ||= Boolean(record.bitControls); hasRatioControls ||= Boolean(record.ratioBitControls)
}
await writeFile(join(input, 'index.json'), JSON.stringify(files))
const bytes = await readFile(join(root, 'packages/blendlink/src/tslCompositorCpuSqrt.ts'))
await writeFile(join(output, 'tslCompositorCpuSqrt.ts'), bytes)
const ratioBytes = await readFile(join(root, 'packages/blendlink/src/tslCompositorCpuDistanceRatio.ts'))
await writeFile(join(output, 'tslCompositorCpuDistanceRatio.ts'), ratioBytes)
await writeFile(join(output, 'provenance.json'), JSON.stringify({ sha256: createHash('sha256').update(bytes).digest('hex'),
  module: 'packages/blendlink/src/tslCompositorCpuSqrt.ts', ratioSha256: createHash('sha256').update(ratioBytes).digest('hex'),
  proofKind: 'immutable-production-TypeScript-helper-source; separate from built Distance graph proof', nativeRecords,
  harnessSha256: Object.fromEntries(await Promise.all(['sqrt-run.mjs', 'sqrt-browser.ts'].map(async file =>
    [file, createHash('sha256').update(await readFile(join(import.meta.dirname, file))).digest('hex')]))),
  independentNativeReferences: args.slice(0, position) }, null, 2))
const server = await createServer({ configFile: false, root: import.meta.dirname, publicDir: input, cacheDir: join(output, 'cache'),
  resolve: { dedupe: ['three'], alias: { 'blendlink-sqrt-under-test': join(output, 'tslCompositorCpuSqrt.ts'),
    'blendlink-ratio-under-test': join(output, 'tslCompositorCpuDistanceRatio.ts') } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, output] } } })
let browser
const results = [], failures = []
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, ...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL ? { channel: process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL } : {}),
    args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')] })
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(String(error))); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    try {
      await page.goto(server.resolvedUrls.local[0] + 'sqrt.html?backend=' + backend)
      await page.waitForFunction(() => window.__sqrtResult || window.__sqrtFailure, null, { timeout: 120000 })
      const result = await page.evaluate(() => ({ rows: window.__sqrtResult, failure: window.__sqrtFailure, progress: window.__sqrtProgress }))
      results.push({ backend, ...result, errors }); await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
      assert.equal(result.failure, undefined); assert.deepEqual(errors, []); assert.equal(result.rows.length, files.length + Number(hasBitControls) + Number(hasRatioControls))
      for (const row of result.rows) {
        assert.equal(row.count, row.evidenceKind === 'native-cpu-field' ? 16384 : row.operation === 'ratio' ? 4 : 69)
        assert.equal(row.mismatches, 0, JSON.stringify(row)); assert.equal(row.remainingTextures, 0)
      }
      console.log('BLENDLINK_DISTANCE_CPU_MATH_BITS_PASSED', backend, result.rows.reduce((sum, row) => sum + row.count, 0))
    } catch (error) {
      const progress = await page.evaluate(() => window.__sqrtProgress).catch(() => null)
      if (!results.some(result => result.backend === backend)) results.push({ backend, error: String(error), errors, progress })
      failures.push({ backend, error: String(error) })
      await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
      await writeFile(join(output, 'failures.json'), JSON.stringify(failures, null, 2))
    } finally { await page.close() }
  }
} finally { await browser?.close(); await server.close() }
assert.equal(failures.length, 0, JSON.stringify(failures))
