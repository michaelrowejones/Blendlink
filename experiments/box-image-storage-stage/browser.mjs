import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { allowedRoots } from '../noise-color-export-preview-pilot/paths.mjs'
import { closeStage } from './compare.mjs'

const [nativeArg, outArg, lease] = process.argv.slice(2); assert.equal(lease, '--gpu-lease')
const nativeDir = resolve(nativeArg), out = resolve(outArg), root = resolve(import.meta.dirname, '../..'), three = resolve(root, 'node_modules/three'), dist = resolve(root, 'packages/blendlink/dist'), sha = b => createHash('sha256').update(b).digest('hex')
const nativeBytes = await readFile(join(nativeDir, 'native.json')), native = JSON.parse(nativeBytes), contract = JSON.parse(await readFile(join(nativeDir, 'contract.json'))), inputs = JSON.parse(await readFile(join(nativeDir, 'geometry-inputs.json')))
assert.equal(native.status, 'CAPTURED_BOX_STORAGE_STAGE_RESEARCH')
await mkdir(out); const fixture = join(out, 'fixture'); await mkdir(fixture)
for (const name of ['index.html', 'browser.js', 'geometry-inputs.mjs']) await copyFile(join(import.meta.dirname, name), join(fixture, name))
const report = { status: 'running', nativeSha256: sha(nativeBytes), apis: [], pins: {}, supportCredit: 0 }
async function pin(path) { report.pins[path] = sha(await readFile(path)) }
async function tree(folder) { for (const entry of await readdir(folder, { withFileTypes: true })) { const path = join(folder, entry.name); if (entry.isDirectory()) await tree(path); else if (entry.isFile()) await pin(path) } }
for (const name of ['index.html', 'browser.js', 'browser.mjs', 'geometry-inputs.mjs', 'cases.mjs']) await pin(join(import.meta.dirname, name))
await pin(join(root, 'experiments/box-image-transport-prototype/candidate.mjs')); await tree(dist); await tree(three)
const server = await createServer({ root: fixture, cacheDir: join(out, 'vite-cache'), configFile: false, publicDir: false, logLevel: 'warn', optimizeDeps: { noDiscovery: true }, resolve: { alias: [{ find: '@geometry-context', replacement: join(dist, 'tslGeometryContext.js') }, { find: '@box-candidate', replacement: join(root, 'experiments/box-image-transport-prototype/candidate.mjs') }, { find: 'three/webgpu', replacement: join(three, 'build/three.webgpu.js') }, { find: 'three/tsl', replacement: join(three, 'build/three.tsl.js') }, { find: /^three$/, replacement: join(three, 'build/three.module.js') }], dedupe: ['three'] }, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: await allowedRoots([root, three, dist, nativeDir, out]) } } })
let browser
try {
    await server.listen(); browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=metal'] }); report.browserVersion = browser.version()
    for (const backend of ['webgpu', 'webgl2']) {
        const page = await browser.newPage(), pageErrors = [], httpErrors = []
        page.on('pageerror', error => pageErrors.push(String(error))); page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()) })
        page.on('response', response => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }) })
        await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => typeof window.captureBoxNormalStage === 'function')
        let api
        try { api = await page.evaluate(p => window.captureBoxNormalStage(p), { backend, contract, native, inputs, assetBase: server.resolvedUrls.local[0] + '@fs' + nativeDir + '/' }) }
        catch (error) { api = await page.evaluate(() => window.boxNormalFailure); report.apis.push({ ...api, pageErrors, httpErrors }); throw error }
        assert.match(JSON.stringify(api.gpu), /apple|metal/i); assert.doesNotMatch(JSON.stringify(api.gpu), /swiftshader/i)
        for (const row of [...api.rows, ...api.lodRows, api.storageCalibration]) {
            const bytes = Buffer.alloc(row.words.length * 4); row.words.forEach((word, i) => bytes.writeUInt32LE(word, i * 4)); row.file = backend + '-' + (row.id ?? 'storage-calibration') + '.u32'; row.sha256 = sha(bytes); row.words = row.words.length; await writeFile(join(out, row.file), bytes, { flag: 'wx' })
        }
        report.apis.push({ ...api, pageErrors, httpErrors }); await page.close()
    }
    report.status = 'CAPTURED_BOX_STORAGE_BROWSER_RESEARCH'
} finally { await writeFile(join(out, 'browser.json'), JSON.stringify(report, null, 2) + '\n'); await browser?.close(); await server.close() }
const result = await closeStage(nativeDir, out); await writeFile(join(out, 'closed.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result.stageTotals))
