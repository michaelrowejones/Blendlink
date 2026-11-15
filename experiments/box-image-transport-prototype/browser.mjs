import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { allowedRoots } from '../noise-color-export-preview-pilot/paths.mjs'
import { closePrototype } from './compare.mjs'

const [nativeArg, outArg, lease] = process.argv.slice(2)
assert.equal(lease, '--gpu-lease')
const nativeDir = resolve(nativeArg), out = resolve(outArg), root = resolve(import.meta.dirname, '../..'), three = resolve(root, 'node_modules/three'), hash = bytes => createHash('sha256').update(bytes).digest('hex')
const nativeBytes = await readFile(join(nativeDir, 'native.json')), native = JSON.parse(nativeBytes), contract = JSON.parse(await readFile(join(nativeDir, 'contract.json')))
assert.equal(native.status, 'CAPTURED_BOX_SOURCE_AND_SAMPLER_RESEARCH')
await mkdir(out); const fixture = join(out, 'fixture'); await mkdir(fixture)
for (const name of ['index.html', 'browser.js', 'candidate.mjs']) await copyFile(join(import.meta.dirname, name), join(fixture, name))
const report = { status: 'running', nativeSha256: hash(nativeBytes), apis: [], supportCredit: 0, pins: {} }
for (const name of ['browser.js', 'candidate.mjs', 'browser.mjs', 'compare.mjs', 'cases.mjs']) report.pins[name] = hash(await readFile(join(import.meta.dirname, name)))
for (const image of native.images) assert.equal(hash(await readFile(join(nativeDir, image.file))), image.sha256)
const server = await createServer({ root: fixture, cacheDir: join(out, 'vite-cache'), configFile: false, publicDir: false, logLevel: 'warn', optimizeDeps: { noDiscovery: true }, resolve: { alias: [{ find: 'three/webgpu', replacement: join(three, 'build/three.webgpu.js') }, { find: 'three/tsl', replacement: join(three, 'build/three.tsl.js') }, { find: /^three$/, replacement: join(three, 'build/three.module.js') }], dedupe: ['three'] }, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: await allowedRoots([root, three, nativeDir, out]) } } })
let browser
try {
  await server.listen(); browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=metal'] }); report.browserVersion = browser.version()
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage(), pageErrors = []; page.on('pageerror', error => pageErrors.push(String(error))); page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()) })
    await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => typeof window.captureBoxPrototype === 'function')
    let row
    try { row = await page.evaluate(p => window.captureBoxPrototype(p), { backend, contract, images: native.images, assetBase: server.resolvedUrls.local[0] + '@fs' + nativeDir + '/' }) }
    catch (error) { row = await page.evaluate(() => window.boxFailure); report.apis.push({ ...row, pageErrors }); throw error }
    assert.match(JSON.stringify(row.gpu), /apple|metal/i); assert.doesNotMatch(JSON.stringify(row.gpu), /swiftshader/i)
    for (const sample of [...row.rows, ...row.calibration]) {
      const bytes = Buffer.alloc(sample.words.length * 4); sample.words.forEach((word, i) => bytes.writeUInt32LE(word, i * 4)); const file = backend + '-' + sample.id + '.u32'; await writeFile(join(out, file), bytes, { flag: 'wx' }); sample.file = file; sample.sha256 = hash(bytes); sample.words = sample.words.length
    }
    report.apis.push({ ...row, pageErrors }); await page.close()
  }
  report.status = 'CAPTURED_BOX_BROWSER_RESEARCH'
} finally { await writeFile(join(out, 'browser.json'), JSON.stringify(report, null, 2) + '\n'); await browser?.close(); await server.close() }
const closed = await closePrototype(nativeDir, out); await writeFile(join(out, 'closed.json'), JSON.stringify(closed, null, 2) + '\n'); console.log(JSON.stringify({ status: closed.status, weightViolations: closed.weightViolations, samplerDiagnosticViolations: closed.samplerDiagnosticViolations }))
