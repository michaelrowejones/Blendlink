const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/node_modules/playwright')

const githubRoot = 'C:/Users/micha/Documents/GitHub'
const artifactDir = 'C:/Users/micha/Documents/GitHub/blendlink/artifacts/component-behaviors-accessibility-2026'
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.json', 'application/json'],
])

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  if (pathname === '/favicon.ico') { response.writeHead(204).end(); return }
  const relative = pathname === '/' ? '/blendlink/artifacts/component-behaviors-accessibility-2026/harness.html' : pathname
  const file = path.resolve(githubRoot, `.${relative}`)
  const fromRoot = path.relative(githubRoot, file)
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    response.writeHead(403).end('forbidden')
    return
  }
  fs.readFile(file, (error, body) => {
    if (error) { response.writeHead(404).end(String(error)); return }
    response.writeHead(200, { 'content-type': mime.get(path.extname(file)) ?? 'application/octet-stream' })
    response.end(body)
  })
})

const point = { x: 400, y: 300 }
const failures = []
const consoleMessages = []
let launchedBrowser

async function main() {
  const step = value => process.stderr.write(`[behavior-audit] ${value}\n`)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  step('server ready')
  const port = server.address().port
  const executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  const browser = launchedBrowser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--autoplay-policy=document-user-activation-required',
      '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies',
    ],
  })
  const context = await browser.newContext({ viewport: { width: 900, height: 760 }, hasTouch: true })
  const page = await context.newPage()
  page.on('console', message => {
    consoleMessages.push(`${message.type()}: ${message.text()}`)
    process.stderr.write(`[browser ${message.type()}] ${message.text()}\n`)
  })
  page.on('pageerror', error => {
    failures.push(`pageerror: ${error.stack ?? error}`)
    process.stderr.write(`[browser pageerror] ${error.stack ?? error}\n`)
  })
  await page.goto(`http://127.0.0.1:${port}/`)
  step('page loaded')
  await page.waitForFunction(() => window.__AUDIT_READY === true, null, { timeout: 10_000 })
  step('harness ready')

  const report = {
    capturedAt: new Date().toISOString(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    versions: { three: await page.evaluate(() => document.querySelector('#status').textContent) },
    core: await page.evaluate(() => window.audit.runCore()),
  }
  step('core complete')

  // Run audio before any trusted input so the fresh origin has no user
  // activation and Chromium's autoplay policy remains observable.
  await page.evaluate(() => window.audit.setupInteraction('audio', { autoplay: true, spatial: true }))
  report.audioAutoplayBeforeGesture = await page.evaluate(() => window.audit.inspectInteraction())
  await page.evaluate(() => window.audit.disposeAll())
  await page.evaluate(() => window.audit.setupInteraction('audio', { autoplay: false, spatial: true, toggle: true }))
  report.audioTriggerBeforeGesture = await page.evaluate(() => window.audit.inspectInteraction())
  await page.touchscreen.tap(point.x, point.y)
  await page.waitForTimeout(100)
  report.audioTriggerAfterGesture = await page.evaluate(() => window.audit.inspectInteraction())
  await page.touchscreen.tap(point.x, point.y)
  report.audioTriggerAfterSecondTap = await page.evaluate(() => window.audit.inspectInteraction())
  await page.evaluate(() => window.audit.disposeAll())
  step('audio complete')

  report.pointer = {}
  await page.evaluate(() => window.audit.setupInteraction('open-url'))
  await page.mouse.click(point.x, point.y)
  report.pointer.openUrlMouse = await page.evaluate(() => window.audit.inspectInteraction())

  await page.evaluate(() => window.audit.setupInteraction('open-url'))
  await page.touchscreen.tap(point.x, point.y)
  report.pointer.openUrlTouch = await page.evaluate(() => window.audit.inspectInteraction())

  await page.evaluate(() => window.audit.setupInteraction('open-url'))
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  report.pointer.openUrlKeyboard = await page.evaluate(() => window.audit.inspectInteraction())

  await page.evaluate(() => window.audit.setupInteraction('open-url', { occluded: true }))
  await page.mouse.click(point.x, point.y)
  report.pointer.openUrlBehindOccluder = await page.evaluate(() => window.audit.inspectInteraction())

  await page.evaluate(() => window.audit.setupInteraction('hover'))
  await page.mouse.move(point.x, point.y)
  await page.evaluate(() => window.audit.update(0.016))
  report.pointer.hoverMouse = await page.evaluate(() => window.audit.inspectInteraction())
  await page.mouse.move(10, 10)
  await page.evaluate(() => window.audit.update(0.016))
  report.pointer.hoverMouseLeave = await page.evaluate(() => window.audit.inspectInteraction())

  await page.evaluate(() => window.audit.setupInteraction('hover', { occluded: true }))
  await page.mouse.move(point.x, point.y)
  await page.evaluate(() => window.audit.update(0.016))
  report.pointer.hoverBehindOccluder = await page.evaluate(() => window.audit.inspectInteraction())

  await page.evaluate(() => window.audit.setupInteraction('hover'))
  await page.touchscreen.tap(point.x, point.y)
  await page.evaluate(() => window.audit.update(0.016))
  report.pointer.hoverTouchTap = await page.evaluate(() => window.audit.inspectInteraction())
  step('pointer complete')

  await page.evaluate(() => window.audit.setupInteraction('animation', { speed: 2, loop: false }))
  await page.mouse.click(point.x, point.y)
  report.animationAfterClick = await page.evaluate(() => window.audit.update(0.25))
  await page.mouse.click(point.x, point.y)
  report.animationAfterReplay = await page.evaluate(() => window.audit.update(0.1))
  report.animationAfterDispose = await page.evaluate(async () => {
    await window.audit.disposeAll()
    return { animatedX: window.__animated.position.x }
  })
  await page.evaluate(() => window.audit.setupInteraction('animation', { speed: 1, loop: true }))
  await page.mouse.click(point.x, point.y)
  report.animationLoopAfter125 = await page.evaluate(() => window.audit.update(1.25))
  await page.evaluate(() => window.audit.disposeAll())
  step('animation complete')

  report.failuresAndOwnership = await page.evaluate(() => window.audit.runFailuresAndOwnership())
  step('failure/ownership complete')
  report.console = consoleMessages
  report.pageFailures = failures
  await page.screenshot({ path: path.join(artifactDir, 'browser-harness.png'), fullPage: true })
  fs.writeFileSync(path.join(artifactDir, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}

main().catch(async error => {
  console.error(error)
  process.exitCode = 1
  try { await launchedBrowser?.close() } catch {}
}).finally(() => server.close())
