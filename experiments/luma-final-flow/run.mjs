import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { chromium } from '@playwright/test'
import sharp from '../../packages/blendlink/dist/sharpSecurity.js'
import { defaultPreviewStudioCacheRoot, planPreviewStudio } from '../../packages/blendlink/dist/preview.js'
import { captureRuntimeProvenance } from '../../scripts/lib/runtime-provenance.mjs'

const root = resolve(import.meta.dirname, '../..'), evidence = join(root, 'artifacts/verification-luma-final-flow')
const sources = join(evidence, 'source'), hosting = join(evidence, 'hosting'), cli = join(root, 'packages/blendlink/dist/cli.js')
const blender = process.env.BLENDLINK_BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender'
const env = { ...process.env, BLENDLINK_BLENDER: blender, XDG_CACHE_HOME: join(evidence, 'cache'), BLENDLINK_PROGRESS: '1' }
mkdirSync(evidence, { recursive: true })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const report = { schemaVersion: 1, kind: 'saved-blend-final-preview-visitor-integration', numericalOracleReplacement: false, phases: [] }
let preview, server, browser, currentPage
let previewLog = ''
function run(args, log, cwd = root) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  writeFileSync(join(evidence, log), (result.stdout || '') + (result.stderr || ''))
  return result
}
const snapshot = directory => readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
  const path = join(directory, entry.name)
  return entry.isDirectory() ? snapshot(path).map(([file, hash]) => [entry.name + '/' + file, hash]) : [[entry.name, sha(readFileSync(path))]]
})
async function until(predicate, timeout = 90000) {
  const deadline = Date.now() + timeout
  while (!await predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for the artist flow'); await new Promise(resolve => setTimeout(resolve, 100)) }
}
async function delta(a, b) {
  const left = await sharp(a).removeAlpha().raw().toBuffer(), right = await sharp(b).removeAlpha().raw().toBuffer()
  assert.equal(left.length, right.length)
  return left.reduce((total, value, index) => total + Math.abs(value - right[index]), 0) / left.length
}

function observeRuntime(backend) {
  const frames = new Set(), textures = new Set(), buffers = new Set(), contexts = [], adapters = [], webglRenderers = [], references = new WeakMap()
  const track = (live, value) => { const reference = new WeakRef(value); references.set(value, reference); live.add(reference) }
  const release = (live, value) => live.delete(references.get(value))
  const count = live => { for (const reference of live) if (!reference.deref()) live.delete(reference); return live.size }
  const originalFrame = window.requestAnimationFrame.bind(window), originalCancel = window.cancelAnimationFrame.bind(window)
  window.requestAnimationFrame = callback => { let id; id = originalFrame(now => { frames.delete(id); callback(now) }); frames.add(id); return id }
  window.cancelAnimationFrame = id => { frames.delete(id); originalCancel(id) }
  const originalContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...args) { const value = originalContext.call(this, type, ...args); if (value && ['webgpu', 'webgl2', 'webgl'].includes(type)) contexts.push(type); if (value && type === 'webgl2') { const extension = value.getExtension('WEBGL_debug_renderer_info'); webglRenderers.push(value.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? value.RENDERER)) }; return value }
  function objects(type, create, destroy, live) {
    const prototype = globalThis[type]?.prototype
    if (!prototype?.[create]) return
    const original = prototype[create]
    prototype[create] = function (...args) { const value = original.apply(this, args); if (value) track(live, value); return value }
    if (destroy && prototype[destroy]) { const release = prototype[destroy]; prototype[destroy] = function (value, ...args) { live.delete(references.get(value)); return release.call(this, value, ...args) } }
  }
  objects('WebGL2RenderingContext', 'createTexture', 'deleteTexture', textures)
  objects('WebGL2RenderingContext', 'createBuffer', 'deleteBuffer', buffers)
  for (const [method, type, live] of [['createTexture', 'GPUTexture', textures], ['createBuffer', 'GPUBuffer', buffers]]) {
    objects('GPUDevice', method, null, live)
    const prototype = globalThis[type]?.prototype
    if (prototype?.destroy) { const destroy = prototype.destroy; prototype.destroy = function (...args) { release(live, this); return destroy.apply(this, args) } }
  }
  if (backend === 'webgl2') Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined })
  else if (navigator.gpu) {
    const original = navigator.gpu.requestAdapter.bind(navigator.gpu)
    navigator.gpu.requestAdapter = async options => { const adapter = await original(options); if (adapter) adapters.push({ vendor: adapter.info.vendor, architecture: adapter.info.architecture, isFallbackAdapter: adapter.info.isFallbackAdapter }); return adapter }
  }
  window.__keyerRuntime = () => ({ pendingFrames: frames.size, textures: count(textures), buffers: count(buffers), contexts, adapters, webglRenderers })
}

async function attach(context, backend) {
  await context.addInitScript(observeRuntime, backend)
  const page = await context.newPage(), errors = [], failed = [], external = [], documents = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.status() >= 400) failed.push({ url: response.url(), status: response.status() })
    if (/\.presentation\.json(?:\?|$)/.test(response.url())) documents.push(response.body().then(bytes => ({ url: response.url(), bytes, document: JSON.parse(bytes.toString()) })).catch(error => ({ url: response.url(), error: String(error) })))
  })
  page.on('request', request => { if (!['http://127.0.0.1', 'data:'].some(prefix => request.url().startsWith(prefix))) external.push(request.url()) })
  const state = { page, errors, failed, external, documents, expectedFailure: false, consoleErrors: [], expectedConsoleFailures: [] }
  page.on('console', message => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (state.expectedFailure && /Failed to load resource|net::ERR_FAILED|Failed to fetch/.test(text)) state.expectedConsoleFailures.push(text)
    else state.consoleErrors.push(text)
  })
  return state
}
async function assertInstalled(state, canvas, variant, expectedHash) {
  const documents = await Promise.all(state.documents), fetched = documents.filter(value => value.document).at(-1)
  assert.ok(fetched, 'Actual app did not fetch source presentation')
  if (expectedHash) assert.equal(sha(fetched.bytes), expectedHash)
  const ops = fetched.document.compositor?.ops || []
  if (variant !== 'Identity') {
    assert.equal(ops.find(op => op.kind === 'luminance-key')?.properties.luminance_key_model, 'native-luminance-key-cpu-rne-v1')
    assert.equal(ops.find(op => op.kind === 'luminance-key')?.properties.luminance_key_cpu_profile.sourcePlatform, 'darwin')
  }
  if (variant === 'Both') assert.equal(ops.find(op => op.kind === 'difference-key')?.properties.difference_key_model, 'native-difference-key-cpu-exact-v2')
  const installed = await canvas.evaluate(element => ({ order: JSON.parse(element.dataset.postprocessingOrder || 'null'), skipped: element.dataset.tslMaterialsSkipped }))
  assert.ok(installed.order?.includes('blender-compositor')); assert.equal(installed.skipped, '0')
  assert.deepEqual(state.errors, []); assert.deepEqual(state.consoleErrors, []); assert.deepEqual(state.failed, []); assert.deepEqual(state.external, [])
  return { presentationSha256: sha(fetched.bytes), models: ops.filter(op => /key$/.test(op.kind)).map(op => op.properties), installed }
}
async function terminate(page, kind) {
  const before = await page.evaluate(() => window.__keyerRuntime())
  await page.evaluate(kind => window.dispatchEvent(kind === 'visitor' ? new PageTransitionEvent('pagehide', { persisted: false }) : new Event('beforeunload')), kind)
  await page.waitForTimeout(100)
  const after = await page.evaluate(() => window.__keyerRuntime())
  assert.equal(after.pendingFrames, 0)
  if (kind === 'visitor') assert.equal(await page.locator('canvas').getAttribute('data-postprocessing-order'), null)
  else assert.equal(await page.locator('canvas.active').count(), 0)
  return { proofRole: 'actual renderer cleanup handler with API allocation observations; weak API observations do not establish zero GPU memory or cache release', before, after }
}

try {
  report.productionRuntime = (await captureRuntimeProvenance({ root, built: true, label: 'keyer-final-flow' })).provenance
  if (!process.argv.includes('--reuse-fixture')) {
    const result = spawnSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', join(import.meta.dirname, 'fixture.py'), '--', sources], { cwd: root, env, encoding: 'utf8' })
    writeFileSync(join(evidence, 'fixture.log'), result.stdout + result.stderr); assert.equal(result.status, 0)
  }
  const receipt = JSON.parse(readFileSync(join(sources, 'source-receipt.json'))), pins = {}
  for (const variant of ['Identity', 'Luminance', 'Both']) {
    const blend = join(sources, variant + '.blend'), sourceBytes = readFileSync(blend), site = join(hosting, 'nested', variant.toLowerCase())
    assert.equal(sha(sourceBytes), receipt.files.find(file => file.variant === variant).sha256)
    const result = run(['export', '--blend', blend, '--out', site], 'export-' + variant.toLowerCase() + '.log'); assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(readFileSync(blend), sourceBytes, 'Final export changed the saved source')
    const plan = planPreviewStudio(blend, { cacheRoot: join(defaultPreviewStudioCacheRoot(env), 'website-exports') })
    const manifestBytes = readFileSync(join(plan.workspace, 'src/generated', variant + '.manifest.json')), manifest = JSON.parse(manifestBytes)
    const glb = readFileSync(join(site, manifest.url.replace(/^\//, ''))), presentation = readFileSync(join(site, manifest.sourcePresentation.url.replace(/^\//, '')))
    assert.equal(sha(glb).slice(0, 16), manifest.hash); assert.equal(sha(presentation).slice(0, 16), manifest.sourcePresentation.hash)
    assert.equal(presentation.length, manifest.sourcePresentation.bytes); assert.equal(sha(sourceBytes).slice(0, 16), manifest.blendBytesHash)
    assert.equal(manifest.runtimeAssetPublication.immutable, true)
    writeFileSync(join(evidence, variant + '.manifest.json'), manifestBytes)
    pins[variant] = { sourceSha256: sha(sourceBytes), manifestSha256: sha(manifestBytes), presentationSha256: sha(presentation), presentationPointer: manifest.sourcePresentation,
      glbSha256: sha(glb), sceneHash: manifest.hash, immutableBundle: manifest.runtimeAssetPublication, manifest, site }
    report.phases.push({ flow: 'Final standalone export', variant, ...pins[variant], manifest: undefined, site: undefined, sourcePreserved: true })
    console.log('BLENDLINK_KEYER_FLOW Final export ' + variant)
  }
  const saved = readFileSync(join(sources, 'Luminance.blend')), prior = snapshot(pins.Luminance.site)
  writeFileSync(join(sources, 'Luminance.blend'), 'intentional invalid owned source')
  try { assert.notEqual(run(['export', '--blend', join(sources, 'Luminance.blend'), '--out', pins.Luminance.site], 'expected-failed-export.log').status, 0); assert.deepEqual(snapshot(pins.Luminance.site), prior) }
  finally { writeFileSync(join(sources, 'Luminance.blend'), saved) }
  report.phases.push({ flow: 'Final export failure', everyPublishedFilePreserved: true, sourceRestored: true })

  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost'), path = resolve(hosting, '.' + url.pathname, url.pathname.endsWith('/') ? 'index.html' : '')
    if (!path.startsWith(hosting + sep) || !existsSync(path)) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' }[extname(path)] || 'application/octet-stream'); response.end(readFileSync(path))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ channel: process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL || 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] })
  for (const backend of ['webgpu', 'webgl2']) {
    const screenshots = {}
    for (const variant of ['Identity', 'Luminance', 'Both']) {
      const context = await browser.newContext({ viewport: { width: 640, height: 480 } }), state = await attach(context, backend), { page } = state
      currentPage = page; await page.goto(origin + '/nested/' + variant.toLowerCase() + '/')
      await page.waitForSelector('body[data-ready="true"]', { timeout: 90000 })
      const installed = await assertInstalled(state, page.locator('canvas'), variant, pins[variant].presentationSha256)
      screenshots[variant] = await page.locator('canvas').screenshot({ path: join(evidence, 'visitor-' + backend + '-' + variant + '.png') })
      if (variant === 'Identity') assert.ok((await sharp(screenshots[variant]).stats()).channels.some(channel => channel.stdev > 5), 'Actual exported 3D geometry was blank')
      const runtime = await page.evaluate(() => window.__keyerRuntime())
      assert.ok(runtime.contexts.includes(backend === 'webgpu' ? 'webgpu' : 'webgl2'))
      if (variant === 'Luminance') {
        await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150)
        assert.equal(await page.locator('body').getAttribute('data-ready'), 'true')
        state.expectedFailure = true; await page.route('**/*.glb*', route => route.abort()); await page.reload(); await page.locator('#retry:not([hidden])').waitFor()
        assert.notEqual(await page.locator('body').getAttribute('data-ready'), 'true')
        await page.unroute('**/*.glb*'); state.failed.length = 0; state.documents.length = 0
        await page.locator('#retry').click(); await page.waitForSelector('body[data-ready="true"]', { timeout: 90000 })
        state.expectedFailure = false
        await assertInstalled(state, page.locator('canvas'), variant, pins[variant].presentationSha256)
      }
      const cleanup = await terminate(page, 'visitor')
      report.phases.push({ flow: 'actual standalone visitor', variant, backend, installed, runtime, cleanup,
        failedLoadRetry: variant === 'Luminance', narrowResize: variant === 'Luminance', errors: state.errors })
      await context.close()
    }
    const lumaEffect = await delta(screenshots.Identity, screenshots.Luminance), differenceEffect = await delta(screenshots.Luminance, screenshots.Both)
    assert.ok(lumaEffect > 1 && differenceEffect > .1, 'A fetched graph had no visible effect')
    report.phases.push({ flow: 'actual visitor compositor effects', backend, lumaEffect, differenceEffect, proofRole: 'paired saved-scene screenshots, not a replacement for float numerical parity' })
  }

  const watched = join(sources, 'Watched.blend'); writeFileSync(watched, readFileSync(join(sources, 'Luminance.blend')))
  preview = spawn(process.execPath, [cli, 'preview', '--blend', watched, '--no-open'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  preview.stdout.on('data', chunk => { previewLog += chunk }); preview.stderr.on('data', chunk => { previewLog += chunk })
  let previewUrl
  await until(() => { if (preview.exitCode !== null) throw new Error(previewLog); previewUrl = stripVTControlCharacters(previewLog).match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/)?.[1]; return !!previewUrl })
  for (const backend of ['webgpu', 'webgl2']) {
    const context = await browser.newContext({ viewport: { width: 640, height: 640 } }), state = await attach(context, backend), { page } = state
    currentPage = page; await page.goto(previewUrl + '?backend=' + backend)
    const ready = () => page.waitForFunction(() => document.querySelector('#status-chip')?.dataset.phase === 'ready', null, { timeout: 90000 })
    await ready(); await assertInstalled(state, page.locator('canvas.active'), 'Luminance')
    state.expectedFailure = true; await page.route('**/*.glb*', route => route.abort()); await page.reload()
    await page.locator('#retry-preview:not([hidden])').waitFor()
    assert.equal(await page.locator('canvas.active').count(), 0)
    await page.unroute('**/*.glb*'); state.failed.length = 0; state.documents.length = 0
    await page.locator('#retry-preview').click(); await ready()
    state.expectedFailure = false
    await assertInstalled(state, page.locator('canvas.active'), 'Luminance')
    const captures = {}, frameCounts = []
    for (const variant of ['Luminance', 'Both', 'Identity', 'Luminance']) {
      const before = await page.locator('#generation').innerText()
      if (variant !== 'Luminance' || captures.Luminance) {
        report.activeStep = 'Preview ' + backend + ' save ' + variant
        writeFileSync(watched, readFileSync(join(sources, variant + '.blend')))
        await until(async () => await page.locator('#generation').innerText() !== before && await page.locator('#status-chip').getAttribute('data-phase') === 'ready')
      }
      await assertInstalled(state, page.locator('canvas.active'), variant)
      assert.equal(await page.locator('canvas.active').count(), 1)
      frameCounts.push((await page.evaluate(() => window.__keyerRuntime())).pendingFrames)
      captures[variant] = await page.locator('canvas.active').screenshot({ path: join(evidence, 'preview-' + backend + '-' + variant + '.png') })
      console.log('BLENDLINK_KEYER_FLOW Preview ' + backend + ' ' + variant)
    }
    const lumaEffect = await delta(captures.Identity, captures.Luminance), differenceEffect = await delta(captures.Luminance, captures.Both)
    assert.ok(lumaEffect > 1 && differenceEffect > .1)
    const saved = readFileSync(watched)
    writeFileSync(watched, 'intentional invalid owned save')
    await page.waitForFunction(() => document.querySelector('#status-chip')?.dataset.phase === 'failed', null, { timeout: 90000 })
    assert.equal(await page.locator('canvas.active').count(), 1)
    writeFileSync(watched, saved); await ready()
    assert.ok(frameCounts.every(count => count <= frameCounts[0] + 1), 'Renderer frame loops grew across saved replacements')
    const cleanup = await terminate(page, 'preview')
    report.phases.push({ flow: 'actual Preview Studio', backend, lumaEffect, differenceEffect, firstLoadRetry: true, savedFailureKeepsHealthyCanvas: true, replacementCanvasCount: 1, frameCounts, cleanup, errors: state.errors })
    await context.close()
  }
  writeFileSync(join(evidence, 'preview.log'), previewLog)
  for (const file of receipt.files) assert.equal(sha(readFileSync(join(sources, file.file))), file.sha256)
  report.sourceReceipt = receipt; report.status = 'passed'
  console.log('BLENDLINK_KEYER_FINAL_PREVIEW_FLOW_PASSED')
} catch (error) {
  report.status = 'failed'; report.error = String(error)
  if (currentPage && !currentPage.isClosed()) { try { await currentPage.screenshot({ path: join(evidence, 'failed-step.png') }); writeFileSync(join(evidence, 'failed-step.txt'), await currentPage.locator('body').innerText()) } catch {} }
  throw error
} finally {
  await browser?.close()
  if (preview && preview.exitCode === null && preview.signalCode === null) {
    const stopped = new Promise(resolve => preview.once('close', resolve))
    preview.kill('SIGTERM'); await stopped
  }
  if (server) await new Promise(resolve => server.close(resolve))
  writeFileSync(join(evidence, 'preview.log'), previewLog)
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
}
