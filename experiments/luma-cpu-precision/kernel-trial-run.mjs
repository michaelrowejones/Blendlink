import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { captureRuntimeSnapshot, hash } from '../../scripts/lib/runtime-provenance.mjs'
import { readCpuLumaQualification } from './precision-protocol.mjs'

const root = resolve(import.meta.dirname, '../..'), args = process.argv.slice(2), output = args.indexOf('--out')
assert.ok(output >= 0 && args[output + 1], '--out requires a directory')
const evidence = resolve(args[output + 1]), directories = args.filter((_, index) => index !== output && index !== output + 1 && args[index] !== '--built').map(path => resolve(path))
assert.ok(directories.length, 'Supply native precision reference directories')
const publicDir = join(evidence, 'public'), harness = join(evidence, 'harness'), snapshot = join(evidence, 'snapshot')
await mkdir(publicDir, { recursive: true }); await mkdir(harness, { recursive: true })
const { provenance } = await captureRuntimeSnapshot({ root, built: true, destination: snapshot, label: 'luma-kernel-trial' })
provenance.kind = 'experimental-private-kernel-qualification-not-production-admission'
provenance.productionAdmissionCases = 0; provenance.nativeQualifications = []; provenance.nativeFiles = []; provenance.harnessSha256 = {}
const index = []
for (const [number, directory] of directories.entries()) {
  const { packet, packetSha256, files } = await readCpuLumaQualification(directory)
  assert.ok(files.length, 'No numerical trial cases: regenerate with BLENDLINK_LUMA_CPU_EXACT_EXPERIMENT=1; SOURCE_ADMISSION_NA is not a numerical pass')
  provenance.nativeQualifications.push({ directory, sha256: packetSha256, ...packet })
  for (const row of files) {
    const file = number + '-' + row.file; await writeFile(join(publicDir, file), row.bytes)
    index.push({ file, profile: packet.sourceCpuProfile, productionAdmission: packet.productionAdmission })
    provenance.nativeFiles.push({ file, sha256: row.sha256 })
  }
}
await writeFile(join(publicDir, 'trial-index.json'), JSON.stringify(index))
for (const name of ['kernel-trial.html', 'kernel-trial-browser.ts']) {
  const bytes = await readFile(join(import.meta.dirname, name)); await copyFile(join(import.meta.dirname, name), join(harness, name)); provenance.harnessSha256[name] = hash(bytes)
}
const server = await createServer({ configFile: false, root: harness, publicDir, cacheDir: join(evidence, 'cache'), resolve: { dedupe: ['three'], alias: { 'luma-kernel-under-test': join(snapshot, 'tslCompositorCpuLuminanceKey.js'), 'luma-compositor-under-test': join(snapshot, 'tslSourceCompositor.js') } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, evidence] } } })
let browser
const results = [], failures = []
try {
  await server.listen()
  const channel = process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL || null, extra = JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')
  assert.ok(channel === null || channel === 'chromium'); assert.ok(Array.isArray(extra) && extra.every(arg => typeof arg === 'string'))
  const args = ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...extra]
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args })
  Object.assign(provenance, { browserChannel: channel, browserVersion: browser.version(), browserLaunchArgs: args })
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(server.resolvedUrls.local[0] + 'kernel-trial.html?backend=' + backend)
    await page.waitForFunction(() => window.__lumaTrialRows || window.__lumaTrialError, null, { timeout: 180000 })
    const report = await page.evaluate(() => ({ rows: window.__lumaTrialRows, error: window.__lumaTrialError }))
    results.push({ backend, ...report, errors }); await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2))
    if (report.error || errors.length || report.rows?.length !== index.length || report.rows?.some(row => row.max !== 0 || row.calibration !== 0 || row.remainingTextures !== 0)) failures.push({ backend, ...report, errors })
    await page.close()
  }
  assert.deepEqual(failures, []); console.log('BLENDLINK_LUMA_PRIVATE_KERNEL_TRIAL_PASSED ' + index.length * 2 + ' productionAdmissionCases=0')
} finally { await browser?.close(); await server.close(); await writeFile(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2)) }
