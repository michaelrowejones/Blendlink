import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const output = resolve(root, 'output')
mkdirSync(output, { recursive: true })

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function runNodeTool(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}).\n${result.stdout}\n${result.stderr}`)
  }
}

const npmCli = process.env.npm_execpath ?? resolve(
  dirname(process.execPath),
  'node_modules/npm/bin/npm-cli.js',
)
runNodeTool([npmCli, 'run', 'build', '--workspace', 'blendlink'], 'Blendlink production build')
runNodeTool([
  resolve(repository, 'node_modules/typescript/bin/tsc'),
  '-p',
  resolve(root, 'tsconfig.json'),
], 'Orbit demand fixture typecheck')

const { createServer } = await import('../../node_modules/vite/dist/node/index.js')
const defaultPlaywright = resolve(
  repository,
  '../MichaelRoweJonesSite/node_modules/playwright/index.mjs',
)
const playwrightModule = resolve(process.env.BLENDLINK_PLAYWRIGHT_MODULE ?? defaultPlaywright)
const { chromium } = await import(pathToFileURL(playwrightModule).href)
const chromiumCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const systemChromium = chromiumCandidates.find((candidate) => existsSync(candidate))

const server = await createServer({
  root,
  logLevel: 'error',
  optimizeDeps: {
    include: ['react', 'react-dom/client', '@react-three/fiber', 'three'],
  },
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
    fs: { allow: [repository] },
  },
})

async function waitForStableRenders(page, quietMs = 360) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const before = await page.evaluate(() =>
      window.__blendlinkOrbitDemand.evidence.renders)
    await page.waitForTimeout(quietMs)
    const after = await page.evaluate(() =>
      window.__blendlinkOrbitDemand.evidence.renders)
    if (before === after) return after
  }
  throw new Error('Orbit demand Canvas did not settle within the bounded quiet window')
}

let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Vite did not expose its port')
  const url = `http://127.0.0.1:${address.port}/`
  browser = await chromium.launch({
    headless: true,
    ...(systemChromium ? {
      executablePath: systemChromium,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    } : {}),
  })
  const page = await browser.newPage({
    viewport: { width: 1040, height: 820 },
    deviceScaleFactor: 1,
  })
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => window.__blendlinkOrbitDemand?.evidence.ready === true,
    null,
    { timeout: 30_000 },
  )
  await page.waitForFunction(
    () => window.__blendlinkOrbitDemand.evidence.renders >= 1
      && window.__blendlinkOrbitDemand.evidence.coloredPixels > 1_000,
    null,
    { timeout: 10_000 },
  )

  const initial = await page.evaluate(() => window.__blendlinkOrbitDemand.snapshot())
  const initialSettledRenders = await waitForStableRenders(page)
  const initialSettled = await page.evaluate(() => window.__blendlinkOrbitDemand.snapshot())
  assert(initial.ready, 'Orbit scene did not publish a ready handle')
  assert(initial.coloredPixels > 1_000, 'Orbit scene did not produce a visible first frame')
  assert(initialSettled.requiresContinuousFrames === false, 'Idle Orbit controls claimed frames')
  assert(
    initialSettled.renders === initialSettledRenders,
    'Initial Orbit scene rendered during the quiet verification interval',
  )

  const canvas = page.locator('#canvas-host canvas')
  const box = await canvas.boundingBox()
  assert(box, 'Orbit Canvas has no measurable browser box')
  const start = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 }
  const end = { x: start.x + box.width * 0.28, y: start.y - box.height * 0.16 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 3 })
  await page.mouse.up()

  await page.waitForFunction(
    (before) => {
      const value = window.__blendlinkOrbitDemand.evidence
      return value.renders >= before + 3
        && value.renderSamples.some((sample) => sample.requiresContinuousFrames)
    },
    initialSettled.renders,
    { timeout: 10_000 },
  )
  const afterInput = await page.evaluate(() => window.__blendlinkOrbitDemand.snapshot())
  const settledRenders = await waitForStableRenders(page, 420)
  const settled = await page.evaluate(() => window.__blendlinkOrbitDemand.snapshot())
  const cameraDelta = Math.hypot(
    settled.camera[0] - initialSettled.camera[0],
    settled.camera[1] - initialSettled.camera[1],
    settled.camera[2] - initialSettled.camera[2],
  )
  assert(
    afterInput.renders >= initialSettled.renders + 3,
    'Orbit input did not produce a multi-frame damping tail',
  )
  assert(cameraDelta > 0.2, `Orbit input did not materially move the camera (${cameraDelta})`)
  assert(settled.requiresContinuousFrames === false, 'Orbit did not report idle after damping')
  await page.waitForTimeout(420)
  const settledLater = await page.evaluate(() => window.__blendlinkOrbitDemand.snapshot())
  assert(
    settledLater.renders === settledRenders,
    'Orbit demand Canvas kept rendering after controls settled',
  )
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join('; ')}`)
  assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join('; ')}`)
  assert(settled.errors.length === 0, `Harness errors: ${settled.errors.join('; ')}`)

  await canvas.screenshot({ path: resolve(output, 'orbit-settled.png') })
  await page.screenshot({
    path: resolve(output, 'r3f-orbit-demand-browser.png'),
    fullPage: true,
  })

  const sourcePaths = {
    blendlinkR3fAdapter: resolve(repository, 'packages/blendlink/dist/reactThreeFiber.js'),
    blendlinkCameraControls: resolve(repository, 'packages/blendlink/dist/cameraControls.js'),
    blendlinkThreeRuntime: resolve(repository, 'packages/blendlink/dist/threeRuntime.js'),
    r3fLoop: resolve(repository, 'node_modules/@react-three/fiber/dist/events-b389eeca.esm.js'),
    threeOrbitControls: resolve(repository, 'node_modules/three/examples/jsm/controls/OrbitControls.js'),
  }
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    browser: await browser.version(),
    renderer: systemChromium
      ? 'System Chromium with ANGLE SwiftShader flags'
      : 'Playwright Chromium',
    url,
    versions: {
      blendlink: JSON.parse(readFileSync(
        resolve(repository, 'packages/blendlink/package.json'),
      )).version,
      react: JSON.parse(readFileSync(resolve(repository, 'node_modules/react/package.json'))).version,
      reactDom: JSON.parse(readFileSync(
        resolve(repository, 'node_modules/react-dom/package.json'),
      )).version,
      reactThreeFiber: JSON.parse(readFileSync(
        resolve(repository, 'node_modules/@react-three/fiber/package.json'),
      )).version,
      three: JSON.parse(readFileSync(resolve(repository, 'node_modules/three/package.json'))).version,
      playwright: JSON.parse(readFileSync(resolve(
        repository, '../MichaelRoweJonesSite/node_modules/playwright/package.json',
      ))).version,
      vite: JSON.parse(readFileSync(resolve(repository, 'node_modules/vite/package.json'))).version,
    },
    sources: Object.fromEntries(Object.entries(sourcePaths).map(([key, path]) => [
      key,
      { path, sha256: sha256(path) },
    ])),
    checkpoints: { initial, initialSettled, afterInput, settled, settledLater },
    cameraDelta,
    inputBurstRenders: afterInput.renders - initialSettled.renders,
    dampingRenders: settled.renders - initialSettled.renders,
    pageErrors,
    consoleErrors,
    artifacts: {
      canvas: {
        path: 'output/orbit-settled.png',
        sha256: sha256(resolve(output, 'orbit-settled.png')),
      },
      fullPage: {
        path: 'output/r3f-orbit-demand-browser.png',
        sha256: sha256(resolve(output, 'r3f-orbit-demand-browser.png')),
      },
    },
    assertions: {
      productionR3fAndThreeAdapters: true,
      visibleInitialFrame: true,
      initialIdleRenderCountStable: true,
      nativeOrbitInputWakesDemandCanvas: true,
      threeUpdateKeepsDampingFramesAlive: true,
      cameraMateriallyMoved: true,
      settledOrbitStopsDemandFrames: true,
      noBrowserErrors: true,
    },
    limits: [
      'Chromium with ANGLE SwiftShader only; no Firefox, WebKit, mobile, XR, WebGPU, or physical-GPU evidence.',
      'One perspective camera and mouse-rotation path; touch, keyboard, orthographic, free-flight, LOD, and post-processing remain outside this gate.',
      'The deterministic application-owned GLTFLoader fixture isolates control/render-loop behavior; it does not cover fetch, GLB parse, decoder, worker, CDN, or cache ownership.',
      'Renderer.render counts are the public observable; the gate does not inspect or promise R3F private internal.frames state.',
    ],
  }
  writeFileSync(resolve(output, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    'BLENDLINK_R3F_ORBIT_DEMAND_BROWSER_PASSED ' +
    `dampingRenders=${report.dampingRenders} ` +
    `cameraDelta=${cameraDelta.toFixed(3)} ` +
    `idleExtra=${settledLater.renders - settled.renders}`,
  )
} finally {
  await browser?.close()
  await server.close()
}
