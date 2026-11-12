// Real desktop publishing flow, without external accounts or user scenes.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
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
const work = mkdtempSync(join(tmpdir(), 'blendlink-preview-ux-'))
const blend = join(work, 'Scene With Spaces.blend')
const output = join(work, 'hosting/nested/site')
const environment = { ...process.env, BLENDLINK_PROGRESS: '1', XDG_CACHE_HOME: join(work, 'cache'),
  ...(process.platform === 'win32' ? { LOCALAPPDATA: join(work, 'cache') } : {}) }
const blender = execFileSync(process.execPath, [cli, 'discover'], { encoding: 'utf8', env: environment }).trim().split(/\r?\n/).at(-1)
let preview, server, browser
let previewLog = ''
const report = []

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
async function runCli(args) {
  const child = spawn(process.execPath, [cli, ...args], { env: environment, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(output)))
  })
  return output
}
const launchOptions = { headless: true, ...(process.env.CI ? { args: ['--enable-unsafe-swiftshader'] } : {}) }
const softwareDisplay = process.env.BLENDLINK_TEST_SOFTWARE_DISPLAY === '1'

try {
  execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python-expr',
    `import bpy; bpy.ops.wm.read_factory_settings(use_empty=False); bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(blend)})`,
  ], { env: environment, stdio: 'pipe' })
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
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  const ready = () => page.waitForFunction(() => document.querySelector('#status-chip')?.dataset.phase === 'ready', null, { timeout: 45000 })
  await ready()
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(evidence, 'preview-desktop.png') })
  await page.locator('#inspect').click()
  assert.equal(await page.locator('#pause').isDisabled(), true)
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
  await page.locator('#details').click()
  assert.equal(await page.evaluate(() => document.activeElement.id), 'close-details')
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'details')
  // A failed initial browser load can recover without another Blender export.
  await page.route('**/*.glb*', route => route.abort())
  await page.reload()
  await page.locator('#retry-preview:not([hidden])').waitFor()
  await page.unroute('**/*.glb*')
  await page.locator('#retry-preview').click()
  await ready()
  // A malformed saved update must keep the healthy canvas, then recover when
  // the artist's next valid save arrives. Only this test's own file is changed.
  const saved = readFileSync(blend)
  writeFileSync(blend, 'intentional invalid Blender fixture')
  await page.waitForFunction(() => document.querySelector('#status-chip')?.dataset.phase === 'failed', null, { timeout: 45000 })
  assert.equal(await page.locator('canvas.active').count(), 1)
  writeFileSync(blend, saved)
  await ready()
  report.push({ flow: 'preview', inspection: true, phoneRatio: phone.width / phone.height, nonblankCapture: true, keyboard: true, retry: true, savedFailureRecovery: true })
  await browser.close(); browser = null
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
    browser = await engine.launch(name === 'chromium' ? launchOptions : {
      headless: !softwareDisplay,
      ...(name === 'firefox' && softwareDisplay ? { firefoxUserPrefs: { 'webgl.force-enabled': true } } : {}),
    })
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
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
    const screenshot = await page.screenshot({ path: join(evidence, `website-${name}.png`) })
    assert.ok((await sharp(screenshot).stats()).channels.some(channel => channel.stdev > 5), 'Exported website is blank')
    report.push({ flow: 'standalone website', browser: name, subfolder: true, nonblank: true, errors, failedAssets, external })
    await browser.close(); browser = null
    console.log(`BLENDLINK_PREVIEW_UX_PASSED website ${name}`)
  }
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n')
} finally {
  if (browser) await browser.close()
  await stopPreview()
  if (server) server.close()
  writeFileSync(join(evidence, 'preview.log'), previewLog)
  rmSync(work, { recursive: true, force: true })
}
