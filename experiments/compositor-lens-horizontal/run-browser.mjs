/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import { cp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot, hash } from '../../scripts/lib/runtime-provenance.mjs'
const root = await realpath(resolve(import.meta.dirname, '../..')), native = await realpath(resolve(process.argv[2]))
assert.ok(process.argv[3] && ['metal', 'software'].includes(process.argv[4]), 'Use run-browser.mjs NATIVE FRESH_OUTPUT metal|software')
const out = resolve(process.argv[3]), profile = process.argv[4]; await mkdir(out)
// Immutable snapshots outside the checkout still resolve ordinary package
// dependencies through this task-local link, never a global /tmp/node_modules.
await symlink(join(root, 'node_modules'), join(out, 'node_modules'), 'dir')
const phase = process.argv[5] ?? 'sampling'
assert.ok(['sampling', 'baseline', 'compare'].includes(phase))
const publicationDirectory = phase === 'sampling' ? undefined : await realpath(resolve(process.argv[6]))
const referenceDirectory = phase === 'compare' ? await realpath(resolve(process.argv[7])) : undefined
const report = JSON.parse(await readFile(join(native, 'native.json'))), cases = []
assert.equal(report.status, 'CAPTURED_LENS_HORIZONTAL_CPU_PILOT_ZERO_CREDIT')
for (const row of report.rows) {
  const bytes = await readFile(join(native, row.folder, row.lens)); assert.equal(hash(bytes), row.lensSha256)
  cases.push(JSON.parse(bytes))
}
const { provenance } = await captureRuntimeSnapshot({ root, built: true, destination: join(out, 'runtime'), label: 'Horizontal lens CPU/native sampling pilot' })
await cp(join(root, 'packages/blendlink/dist/vendor'), join(out, 'runtime/vendor'), { recursive: true })
const entries = [], references = [], referenceFiles = []
if (publicationDirectory) {
  const publication = JSON.parse(await readFile(join(publicationDirectory, 'final.json')))
  assert.equal(publication.status, 'EXPORTED_LENS_HORIZONTAL_SAVED_ORIGINALS_ZERO_SUPPORT_CREDIT')
  for (const row of publication.rows) {
    for (const role of ['source', 'glb', 'manifest', 'presentation', 'module'])
      assert.equal(hash(await readFile(row[role + (role === 'source' ? 'File' : 'Path')])), row[role + 'Sha256'])
    entries.push({ ...row, moduleUrl: '/@fs' + row.modulePath, presentationUrl: '/@fs' + row.presentationPath })
  }
}
if (referenceDirectory) {
  const reference = JSON.parse(await readFile(join(referenceDirectory, 'native-public.json')))
  for (const row of reference.rows) {
    const canonical = { ...row }
    for (const role of ['baseline', 'linear', 'display']) {
      const file = await realpath(row[role + 'File'])
      assert.equal(hash(await readFile(file)), row[role + 'Sha256']); canonical[role + 'File'] = file; referenceFiles.push(file)
    }
    references.push({ ...canonical, baselineUrl: '/@fs' + canonical.baselineFile, linearUrl: '/@fs' + canonical.linearFile, displayUrl: '/@fs' + canonical.displayFile })
  }
}
const server = await createServer({ root: join(root, 'experiments/compositor-lens-horizontal'), configFile: false, logLevel: 'warn',
  ...(publicationDirectory ? { publicDir: join(publicationDirectory, 'compiled/public') } : {}),
  optimizeDeps: { noDiscovery: true }, resolve: { dedupe: ['three'], alias: { '@compositor': join(out, 'runtime/tslSourceCompositor.js'),
    '@runtime': join(out, 'runtime/threeRuntime.js'), '@pipeline': join(out, 'runtime/threeWebgpuPostPipeline.js') } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, out, ...referenceFiles, ...(publicationDirectory ? [publicationDirectory] : []), ...(referenceDirectory ? [referenceDirectory] : [])] } } })
let browser; const result = { status: 'running', profile, phase, provenance, nativeReportSha256: hash(await readFile(join(native, 'native.json'))), apis: [], supportCredit: 0, savedFinalCredit: 0 }
if (publicationDirectory) result.publicationSha256 = hash(await readFile(join(publicationDirectory, 'final.json')))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, ...(profile === 'metal' ? { channel: 'chromium' } : {}),
    args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...(profile === 'metal' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'])] })
  result.browserVersion = browser.version()
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage(), pageErrors = [], httpErrors = []
    page.on('pageerror', e => pageErrors.push(String(e))); page.on('response', r => { if (r.status() >= 400) httpErrors.push({ url: r.url(), status: r.status() }) })
    try {
      await page.goto(server.resolvedUrls.local[0] + (phase === 'sampling' ? '' : 'public.html'))
      await page.waitForFunction(phase => typeof window[phase === 'sampling' ? 'runLensHorizontalPilot' : 'runLensPublicPilot'] === 'function', phase)
      const api = await page.evaluate(data => window[data.phase === 'sampling' ? 'runLensHorizontalPilot' : 'runLensPublicPilot'](data),
        { cases, backend, profile, phase, entries, references, assetBaseUrl: server.resolvedUrls.local[0] })
      for (let i = 0; i < api.rows.length; i++) {
        const row = api.rows[i]
        for (const key of ['actual', 'baselinePixels', 'linearPixels', 'displayPixels']) if (Array.isArray(row[key])) {
          const bytes = Buffer.from(new Uint32Array(row[key]).buffer), file = backend + '-' + i + (key === 'actual' ? '' : '.' + key) + '.rgba32f'
          await writeFile(join(out, file), bytes)
          if (key === 'actual') { row.file = file; row.sha256 = hash(bytes) }
          else { row[key + 'File'] = join(out, file); row[key + 'Sha256'] = hash(bytes) }
          delete row[key]
        }
      }
      result.apis.push({ ...api, pageErrors, httpErrors })
      await writeFile(join(out, 'report.json'), JSON.stringify(result, null, 2) + '\n')
      assert.equal(api.backend, backend); assert.equal(api.status, phase === 'sampling' ? 'LENS_HORIZONTAL_BROWSER_PILOT_PASSED_ZERO_CREDIT'
        : phase === 'baseline' ? 'LENS_PUBLIC_BASELINE_PASSED_ZERO_CREDIT' : 'LENS_PUBLIC_COMPARE_PASSED_ZERO_CREDIT', api.error)
      assert.deepEqual(pageErrors, []); assert.deepEqual(httpErrors, [])
      const identity = JSON.stringify(api.gpu)
      if (profile === 'metal') { assert.match(identity, /apple|metal/i); assert.doesNotMatch(identity, /swiftshader/i) }
      else assert.match(identity, /swiftshader/i)
    } catch (error) { result.setupErrors = { backend, pageErrors, httpErrors }; throw error }
    finally { await page.close() }
  }
  result.status = 'LENS_HORIZONTAL_ALL_APIS_PILOT_PASSED_ZERO_CREDIT'
} catch (error) { result.status = 'LENS_HORIZONTAL_PILOT_FAILED_ZERO_CREDIT'; result.error = String(error); throw error }
finally {
  await writeFile(join(out, 'report.json'), JSON.stringify(result, null, 2) + '\n')
  await browser?.close(); await server.close()
}
console.log(JSON.stringify({ directory: out, status: result.status, profile, apis: result.apis.length }))
