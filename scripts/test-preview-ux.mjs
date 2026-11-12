// Real desktop publishing flow, without external accounts or user scenes.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { chromium, firefox, webkit } from '@playwright/test'
import sharp from '../packages/blendlink/dist/sharpSecurity.js'

const root = resolve(import.meta.dirname, '..')
const cli = join(root, 'packages/blendlink/dist/cli.js')
const evidence = join(root, 'artifacts/verification-preview-ux')
mkdirSync(evidence, { recursive: true })
for (const file of ['report.json', 'failed-step.png', 'failed-step.txt']) rmSync(join(evidence, file), { force: true })
const work = mkdtempSync(join(tmpdir(), 'blendlink-preview-ux-'))
const blend = join(work, 'Scene With Spaces.blend')
const output = join(work, 'hosting/nested/site')
const environment = { ...process.env, BLENDLINK_PROGRESS: '1', XDG_CACHE_HOME: join(work, 'cache'),
  ...(process.platform === 'win32' ? { LOCALAPPDATA: join(work, 'cache') } : {}) }
const blender = execFileSync(process.execPath, [cli, 'discover'], { encoding: 'utf8', env: environment }).trim().split(/\r?\n/).at(-1)
let preview, server, browser, currentPage
let previewLog = ''
const report = []

async function imageDelta(left, right) {
  const a = await sharp(left).removeAlpha().raw().toBuffer()
  const b = await sharp(right).removeAlpha().raw().toBuffer()
  assert.equal(a.length, b.length)
  let difference = 0
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i])
  return difference / a.length
}
async function assertPlayback(canvas, moving) {
  let previous = await canvas.screenshot()
  let maximum = 0
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 250))
    const current = await canvas.screenshot()
    maximum = Math.max(maximum, await imageDelta(previous, current))
    previous = current
    if (moving && maximum > 0.1) return
  }
  assert.ok(moving ? maximum > 0.1 : maximum < 0.05,
    `Expected ${moving ? 'moving' : 'paused'} scene pixels; mean frame difference ${maximum}`)
}
function snapshotWebsite(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = prefix + entry.name
    const path = join(directory, entry.name)
    return entry.isDirectory() ? snapshotWebsite(path, name + '/') :
      [[name, createHash('sha256').update(readFileSync(path)).digest('hex')]]
  })
}
async function replaceSavedScene(page, bytes) {
  const previous = await page.locator('#generation').innerText()
  writeFileSync(blend, bytes)
  await page.waitForFunction(previous => {
    return document.querySelector('#status-chip')?.dataset.phase === 'ready' &&
      document.querySelector('#generation')?.textContent !== previous
  }, previous, { timeout: 45000 })
}

async function until(test, timeout = 45000) {
  const deadline = Date.now() + timeout
  while (!await test()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for preview startup. ' + previewLog.slice(-4000))
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
async function stopPreview() {
  if (!preview) return
  const child = preview
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Preview did not stop within 15 seconds')) }, 15000)
      child.once('exit', () => { clearTimeout(deadline); resolve() })
      child.kill('SIGTERM')
    })
  }
  child.stdout?.destroy(); child.stderr?.destroy(); child.unref()
  preview = null
}
async function runCliResult(args, cwd = root) {
  const child = spawn(process.execPath, [cli, ...args], { env: environment, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  return { code, output }
}
async function runCli(args, cwd = root) {
  const { code, output } = await runCliResult(args, cwd)
  if (code !== 0) throw new Error(output)
  return output
}
const launchOptions = { headless: true, ...(process.env.CI ? { args: ['--enable-unsafe-swiftshader'] } : {}) }
const softwareDisplay = process.env.BLENDLINK_TEST_SOFTWARE_DISPLAY === '1'
const localWebkitTouch = process.env.BLENDLINK_TEST_WEBKIT_TOUCH === '1'
const inputMode = name => name === 'webkit' && localWebkitTouch ? 'touch' : 'mouse'
async function activate(page, selector, name) {
  if (inputMode(name) === 'touch') await page.locator(selector).tap()
  else await page.locator(selector).click()
}
function launchBrowser(name, engine) {
  // CI supplies a display for Firefox's software WebGL implementation.
  return engine.launch(name === 'chromium' ? launchOptions : {
    headless: !softwareDisplay,
    ...(name === 'firefox' && softwareDisplay ? { firefoxUserPrefs: { 'webgl.force-enabled': true } } : {}),
  })
}

try {
  execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1',
    '--python', join(root, 'scripts/preview-ux-fixture.py'), '--', work,
  ], { env: environment, stdio: 'pipe' })
  const saved = readFileSync(blend)
  const planningScene = join(work, 'Planning Scene.blend')
  const planningBytes = readFileSync(planningScene)
  for (const quality of ['final', 'preview']) {
    const result = await runCli(['plan', '--blend', planningScene, '--json', ...(quality === 'preview' ? ['--preview'] : [])], work)
    const records = result.split(/\r?\n/).filter(line => line.startsWith('##blendlink ')).map(line => JSON.parse(line.slice(12)))
    const measured = records.find(record => record.atlasPlan)?.atlasPlan
    assert.equal(measured?.quality, quality)
    assert.equal(measured?.sourceBlend, planningScene)
    assert.ok(measured?.plan.objects.some(object => object.name === 'Cube'))
    const json = JSON.parse(result.split(/\r?\n/).filter(line => !line.startsWith('##blendlink ')).join('\n'))
    assert.equal(json.scenes[0].quality, quality)
    assert.equal(json.scenes[0].plan.bakeCount, 1)
  }
  assert.ok(readFileSync(planningScene).equals(planningBytes), 'Atlas planning modified the saved source')
  assert.ok(!existsSync(join(work, 'cache')), 'Atlas planning installed website dependencies')
  assert.ok(!existsSync(join(work, 'src')) && !existsSync(join(work, 'public')), 'Atlas planning generated website files')
  report.push({ flow: 'standalone atlas planning', final: true, preview: true, noBake: true, sourceUnchanged: true, noWebsiteRequired: true })
  console.log('BLENDLINK_PREVIEW_UX_PASSED standalone atlas planning without a website')
  preview = spawn(process.execPath, [cli, 'preview', '--blend', blend, '--no-open'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  preview.stdout.on('data', chunk => { previewLog += chunk })
  preview.stderr.on('data', chunk => { previewLog += chunk })
  let url
  await until(() => {
    url = stripVTControlCharacters(previewLog).match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/)?.[1]
    if (preview.exitCode !== null) throw new Error(previewLog)
    return !!url
  })
  browser = await chromium.launch(launchOptions)
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  currentPage = page
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  const ready = () => page.waitForFunction(() => document.querySelector('#status-chip')?.dataset.phase === 'ready', null, { timeout: 45000 })
  await ready()
  console.log('BLENDLINK_PREVIEW_UX_STEP preview ready')
  assert.deepEqual(errors, [])
  await assertPlayback(page.locator('canvas.active'), true)
  await page.locator('#pause').click()
  assert.equal(await page.locator('#pause').innerText(), 'Play')
  await assertPlayback(page.locator('canvas.active'), false)
  await page.screenshot({ path: join(evidence, 'preview-desktop.png') })
  await page.locator('#inspect').click()
  assert.equal(await page.locator('#pause').isDisabled(), true)
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'CANVAS')
  const keyboardBefore = await page.locator('canvas.active').screenshot()
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(350)
  assert.ok(await imageDelta(keyboardBefore, await page.locator('canvas.active').screenshot()) > 0.1,
    'Keyboard inspection did not move the camera')
  await page.mouse.move(700, 500); await page.mouse.down(); await page.mouse.move(820, 570, { steps: 10 }); await page.mouse.up()
  await page.locator('#reset').click()
  assert.equal(await page.locator('#inspect').getAttribute('aria-pressed'), 'false')
  assert.equal(await page.locator('#notice').isVisible(), false)
  await page.locator('#mobile').click()
  await page.waitForTimeout(350)
  const phone = await page.locator('#viewport').boundingBox()
  assert.ok(Math.abs(phone.width / phone.height - 0.5) < 0.01)
  await page.screenshot({ path: join(evidence, 'preview-phone.png') })
  await page.locator('#mobile').click()
  await page.waitForTimeout(350)
  const download = page.waitForEvent('download')
  await page.locator('#capture').click()
  const capture = join(evidence, 'captured.png')
  await (await download).saveAs(capture)
  assert.ok((await sharp(capture).stats()).channels.some(channel => channel.stdev > 5), 'PNG capture is blank')
  // Reference comparison must pause even if Inspect disabled the Pause button.
  await page.locator('#inspect').click()
  await page.locator('#reference-file').setInputFiles(capture)
  await page.locator('#comparison-controls').waitFor({ state: 'visible' })
  assert.equal(await page.locator('#pause').innerText(), 'Play')
  assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true')
  await assertPlayback(page.locator('canvas.active'), false)
  await page.locator('#mobile').click()
  assert.equal(await page.locator('#reference-image').isVisible(), false)
  await page.waitForTimeout(350)
  const comparedPhone = await page.locator('#viewport').boundingBox()
  assert.ok(Math.abs(comparedPhone.width / comparedPhone.height - 0.5) < 0.01)
  await page.locator('#reference-file').setInputFiles(capture)
  await page.locator('#comparison-controls').waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#reference-image').isVisible(), false)
  assert.equal(await page.evaluate(() => document.activeElement.id), 'compare')
  await page.locator('#reference-file').setInputFiles(capture)
  await page.locator('#comparison-controls').waitFor({ state: 'visible' })
  await page.locator('#comparison-difference').check()
  await page.keyboard.press('Escape')
  await page.locator('#reference-file').setInputFiles(capture)
  await page.locator('#comparison-controls').waitFor({ state: 'visible' })
  assert.equal(await page.evaluate(() => document.activeElement.id), 'comparison-difference')
  await page.keyboard.press('Escape')
  await page.locator('#mobile').click()
  console.log('BLENDLINK_PREVIEW_UX_STEP comparison and keyboard controls')
  await page.locator('#details').click()
  assert.equal(await page.evaluate(() => document.activeElement.id), 'close-details')
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'details')
  await page.setViewportSize({ width: 390, height: 844 })
  for (const button of await page.locator('.toolbar button').all()) {
    const box = await button.boundingBox()
    assert.ok(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.y >= 0 &&
      box.x + box.width <= 391 && box.y + box.height <= 845,
    `Phone toolbar action is clipped or too small: ${await button.innerText()}`)
  }
  await page.locator('#details').click()
  const drawer = await page.locator('#drawer').boundingBox()
  assert.ok(drawer.x >= 0 && drawer.x + drawer.width <= 391, 'Details overflowed the phone viewport')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone page overflowed horizontally')
  await page.screenshot({ path: join(evidence, 'preview-narrow.png') })
  await page.keyboard.press('Escape')
  await page.locator('#reference-file').setInputFiles(capture)
  await page.locator('#comparison-controls').waitFor({ state: 'visible' })
  const comparison = await page.locator('#comparison-controls').boundingBox()
  const toolbar = await page.locator('.toolbar').boundingBox()
  assert.ok(comparison.y + comparison.height <= toolbar.y, 'Reference comparison covered phone toolbar')
  await page.screenshot({ path: join(evidence, 'preview-narrow-comparison.png') })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })
  const reduced = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1100, height: 800 } })
  const reducedPage = await reduced.newPage()
  currentPage = reducedPage
  const reducedErrors = []
  reducedPage.on('pageerror', error => reducedErrors.push(error.message))
  await reducedPage.goto(url)
  await reducedPage.waitForFunction(() => document.querySelector('#status-chip')?.dataset.phase === 'ready', null, { timeout: 45000 })
  assert.equal(await reducedPage.locator('#pause').innerText(), 'Play')
  await assertPlayback(reducedPage.locator('canvas.active'), false)
  await reducedPage.locator('#pause').click()
  await assertPlayback(reducedPage.locator('canvas.active'), true)
  assert.deepEqual(reducedErrors, [])
  assert.equal(await reducedPage.locator('#status-chip').getAttribute('data-phase'), 'ready')
  await reduced.close()
  currentPage = page
  // A failed initial browser load can recover without another Blender export.
  await page.route('**/*.glb*', route => route.abort())
  await page.reload()
  await page.locator('#retry-preview:not([hidden])').waitFor()
  await page.unroute('**/*.glb*')
  await page.locator('#retry-preview').click()
  await ready()
  // A malformed saved update must keep the healthy canvas, then recover when
  // the artist's next valid save arrives. Only this test's own file is changed.
  writeFileSync(blend, 'intentional invalid Blender fixture')
  await page.waitForFunction(() => document.querySelector('#status-chip')?.dataset.phase === 'failed', null, { timeout: 45000 })
  assert.equal(await page.locator('canvas.active').count(), 1)
  writeFileSync(blend, saved)
  await ready()
  // An authored Start Still action can be started from the actual Play button.
  await replaceSavedScene(page, readFileSync(join(work, 'Manual Scene.blend')))
  assert.equal(await page.locator('#pause').innerText(), 'Play')
  await assertPlayback(page.locator('canvas.active'), false)
  await page.locator('#pause').click()
  await assertPlayback(page.locator('canvas.active'), true)
  await replaceSavedScene(page, saved)
  assert.deepEqual(errors, [])
  assert.equal(await page.locator('#status-chip').getAttribute('data-phase'), 'ready')
  report.push({ flow: 'preview', animationPixels: true, pausedPixels: true, manualPlayback: true,
    comparison: true, narrowViewport: true, reducedMotion: true, inspection: true,
    phoneRatio: phone.width / phone.height, nonblankCapture: true, keyboard: true, retry: true, savedFailureRecovery: true })
  await browser.close(); browser = null
  for (const [name, engine] of Object.entries({ firefox, webkit })) {
    browser = await launchBrowser(name, engine)
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: inputMode(name) === 'touch' })
    currentPage = page
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    await page.waitForFunction(() => document.querySelector('#status-chip')?.dataset.phase === 'ready', null, { timeout: 45000 })
    await activate(page, '#inspect', name)
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'CANVAS')
    await page.locator('#reference-file').setInputFiles(capture)
    await page.locator('#comparison-controls').waitFor({ state: 'visible' })
    assert.equal(await page.locator('#pause').innerText(), 'Play')
    await page.keyboard.press('Escape')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'compare')
    await activate(page, '#details', name)
    await page.keyboard.press('Escape')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'details')
    await page.setViewportSize({ width: 390, height: 844 })
    await activate(page, '#details', name)
    const close = await page.locator('#close-details').boundingBox()
    assert.ok(close.width >= 44 && close.height >= 44)
    await page.keyboard.press('Escape')
    await page.screenshot({ path: join(evidence, `preview-narrow-${name}.png`) })
    assert.deepEqual(errors, [])
    assert.equal(await page.locator('#status-chip').getAttribute('data-phase'), 'ready')
    report.push({ flow: 'preview controls', browser: name, keyboard: true, comparison: true, input: inputMode(name), narrowViewport: true, errors })
    await browser.close(); browser = null
    console.log(`BLENDLINK_PREVIEW_UX_PASSED preview controls ${name}`)
  }
  await stopPreview()
  await until(async () => {
    try { await fetch(url, { signal: AbortSignal.timeout(500) }); return false }
    catch { return true }
  }, 5000)
  console.log('BLENDLINK_PREVIEW_UX_PASSED preview inspection, capture, retry and save recovery')

  writeFileSync(join(evidence, 'export.log'), await runCli(['export', '--blend', blend, '--out', output]))
  assert.ok(existsSync(join(output, 'index.html')))
  assert.ok(existsSync(join(output, 'HOSTING.txt')))
  assert.match(readFileSync(join(output, 'THIRD_PARTY_NOTICES.txt'), 'utf8'), /MIT License/)
  assert.ok(!existsSync(join(output, '.blendlink-preview-control.json')))
  const previousExport = snapshotWebsite(output)
  writeFileSync(blend, 'intentional invalid export fixture')
  const failedExport = await runCliResult(['export', '--blend', blend, '--out', output])
  assert.notEqual(failedExport.code, 0)
  assert.deepEqual(snapshotWebsite(output), previousExport, 'Failed export modified the prior website')
  writeFileSync(blend, saved)
  report.push({ flow: 'standalone export transaction', failedCompilePreservesEveryFile: true })
  server = createServer((request, response) => {
    const path = resolve(join(work, 'hosting'), '.' + new URL(request.url, 'http://localhost').pathname, request.url.endsWith('/') ? 'index.html' : '')
    if (!path.startsWith(join(work, 'hosting') + sep) || !existsSync(path)) { response.writeHead(404).end(); return }
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.html': 'text/html' }[extname(path)] || 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': type }); response.end(readFileSync(path))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const hostedUrl = `http://127.0.0.1:${server.address().port}/nested/site/`
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    // Linux software WebGL needs a display for Firefox. CI provides Xvfb;
    // this is software-renderer evidence, not a physical GPU benchmark.
    browser = await launchBrowser(name, engine)
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: inputMode(name) === 'touch' })
    currentPage = page
    const errors = [], failedAssets = [], external = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('requestfailed', request => failedAssets.push(request.url()))
    page.on('response', response => { if (response.status() >= 400) failedAssets.push(response.url()) })
    page.on('request', request => { if (new URL(request.url()).origin !== new URL(hostedUrl).origin) external.push(request.url()) })
    await page.goto(hostedUrl)
    await page.waitForFunction(() => document.body.dataset.ready === 'true' || !document.querySelector('#retry')?.hidden, null, { timeout: 45000 })
    if (await page.locator('body').getAttribute('data-ready') !== 'true') {
      await page.screenshot({ path: join(evidence, `website-${name}-failed.png`) })
      throw new Error(`${name} website failed: ${await page.locator('#status').innerText()}\n${errors.join('\n')}`)
    }
    assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []); assert.deepEqual(external, [])
    await assertPlayback(page.locator('canvas'), true)
    await activate(page, '#pause', name)
    assert.equal(await page.locator('#pause').innerText(), 'Play')
    await assertPlayback(page.locator('canvas'), false)
    assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []); assert.deepEqual(external, [])
    assert.equal(await page.locator('body').getAttribute('data-ready'), 'true')
    const screenshot = await page.screenshot({ path: join(evidence, `website-${name}.png`) })
    assert.ok((await sharp(screenshot).stats()).channels.some(channel => channel.stdev > 5), 'Exported website is blank')
    report.push({ flow: 'standalone website', browser: name, input: inputMode(name), subfolder: true, nonblank: true,
      animationPixels: true, pausedPixels: true, errors: [...errors], failedAssets: [...failedAssets], external: [...external] })
    if (name === 'chromium') {
      await page.goto('about:blank')
      await page.goBack()
      await page.waitForSelector('body[data-ready="true"]', { timeout: 45000 })
      await page.route('**/*.glb*', route => route.abort())
      await page.reload()
      await page.locator('#retry:not([hidden])').waitFor()
      assert.notEqual(await page.locator('body').getAttribute('data-ready'), 'true')
      await page.unroute('**/*.glb*')
      await page.locator('#retry').click()
      await page.waitForSelector('body[data-ready="true"]', { timeout: 45000 })
      assert.deepEqual(errors, [])
      report.push({ flow: 'standalone recovery', failedLoadRetry: true, backForward: true })
    }
    await browser.close(); browser = null
    console.log(`BLENDLINK_PREVIEW_UX_PASSED website ${name}`)
  }
  {
    // Replacing this scene's own export must publish the new authored behavior.
    writeFileSync(blend, readFileSync(join(work, 'Manual Scene.blend')))
    await runCli(['export', '--blend', blend, '--out', output])
    browser = await chromium.launch(launchOptions)
    let page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    currentPage = page
    const visitorErrors = []
    page.on('pageerror', error => visitorErrors.push(error.message))
    await page.goto(hostedUrl)
    await page.waitForSelector('body[data-ready="true"]', { timeout: 45000 })
    assert.equal(await page.locator('#pause').innerText(), 'Play')
    await assertPlayback(page.locator('canvas'), false)
    await page.locator('#pause').click()
    await assertPlayback(page.locator('canvas'), true)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await assertPlayback(page.locator('canvas'), true) // Explicit visitor choice wins.
    assert.deepEqual(visitorErrors, [])
    assert.equal(await page.locator('body').getAttribute('data-ready'), 'true')
    await browser.close(); browser = null

    writeFileSync(blend, readFileSync(join(work, 'Orbit Scene.blend')))
    await runCli(['export', '--blend', blend, '--out', output])
    browser = await chromium.launch(launchOptions)
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } })
    page = await context.newPage()
    currentPage = page
    page.on('pageerror', error => visitorErrors.push(error.message))
    await page.goto(hostedUrl)
    await page.waitForSelector('body[data-ready="true"]', { timeout: 45000 })
    assert.equal(await page.locator('#pause').innerText(), 'Play')
    await assertPlayback(page.locator('canvas'), false)
    const beforeOrbit = await page.locator('canvas').screenshot()
    await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(800, 470, { steps: 12 }); await page.mouse.up()
    await page.waitForTimeout(350)
    assert.ok(await imageDelta(beforeOrbit, await page.locator('canvas').screenshot()) > 0.1,
      'Reduced-motion visitor could not navigate the authored orbit camera')
    assert.deepEqual(visitorErrors, [])
    assert.equal(await page.locator('body').getAttribute('data-ready'), 'true')
    report.push({ flow: 'standalone replacement', manualPlay: true, reducedMotionOrbit: true, explicitPlaybackPreference: true })
    await browser.close(); browser = null
    console.log('BLENDLINK_PREVIEW_UX_PASSED replacement, manual playback, reduced-motion navigation and rollback')
  }
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n')
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: join(evidence, 'failed-step.png') }).catch(() => {})
    writeFileSync(join(evidence, 'failed-step.txt'), await currentPage.locator('body').innerText().catch(() => 'Page unavailable'))
  }
  throw error
} finally {
  if (browser) await browser.close()
  await stopPreview()
  if (server) server.close()
  writeFileSync(join(evidence, 'preview.log'), previewLog)
  rmSync(work, { recursive: true, force: true })
}
