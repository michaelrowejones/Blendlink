import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import {captureRuntimeSnapshot} from '../../scripts/lib/runtime-provenance.mjs'

const root = resolve(import.meta.dirname, '../..')
const native = resolve(process.env.BLENDLINK_MULTI_IMAGE_NATIVE ?? join(root, 'artifacts/verification-multi-image/native53'))
const snapshot = join(native, 'runtime-snapshot')
const built=process.argv.includes('--built')
const {provenance}=await captureRuntimeSnapshot({root,built,destination:snapshot,label:'Final external image'})
if(built)assert.equal(JSON.parse(readFileSync(join(native,'final-report.json'),'utf8')).exporter,'built')
const server = await createServer({ root: import.meta.dirname, publicDir: join(native, 'public'), configFile: false, logLevel: 'warn',
  cacheDir: join(native, 'vite-cache'), optimizeDeps: { noDiscovery: true },
  resolve: { dedupe: ['three'], alias: { '@blendlink-program-runtime': join(snapshot, built?'tslMaterialRuntime.js':'tslMaterialRuntime.ts') } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, native] } } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] })
  const rows = []
  const reference = JSON.parse(readFileSync(join(native, 'native-reference.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(join(native, 'src/generated/multiImage.manifest.json'), 'utf8'))
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(server.resolvedUrls.local[0] + '?backend=' + backend)
    await page.waitForFunction(() => typeof window.runProof === 'function')
    const row = await page.evaluate(options => window.runProof(options), { manifest, reference })
    assert.equal(row.backend, backend)
    assert.equal(row.applied, Object.keys(reference.expected).length)
    assert.deepEqual(row.skipped, [])
    assert.deepEqual(errors, [])
    assert.equal(row.textureFetches, 2)
    assert.ok(row.maximum < 2e-6, JSON.stringify(row))
    rows.push(row); await page.close()
  }
  writeFileSync(join(native, 'browser-report.json'), JSON.stringify({ referenceVersion: reference.blender, built,provenance,
    source: 'Actual Final GLB + pinned sidecar/images + production installer, native channel oracle', rows }, null, 2))
  console.log('BLENDLINK_MULTI_IMAGE_FINAL_BROWSER_PASSED ' + JSON.stringify(rows))
} finally { await browser?.close(); await server.close() }
