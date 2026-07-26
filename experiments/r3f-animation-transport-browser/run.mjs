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

function buildBlendlink() {
  const npmCli = process.env.npm_execpath ?? resolve(
    dirname(process.execPath),
    'node_modules/npm/bin/npm-cli.js',
  )
  const result = spawnSync(
    process.execPath,
    [npmCli, 'run', 'build', '--workspace', 'blendlink'],
    {
      cwd: repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  if (result.status !== 0) {
    throw new Error(
      `Blendlink production build failed (${result.status}).\n` +
      `${result.stdout}\n${result.stderr}`,
    )
  }
}

function typecheckFixture() {
  const result = spawnSync(
    process.execPath,
    [
      resolve(repository, 'node_modules/typescript/bin/tsc'),
      '-p',
      resolve(root, 'tsconfig.json'),
    ],
    {
      cwd: repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  if (result.status !== 0) {
    throw new Error(
      `R3F animation transport fixture typecheck failed (${result.status}).\n` +
      `${result.stdout}\n${result.stderr}`,
    )
  }
}

async function waitForStableRenders(page, kind, quietMs = 260) {
  let previous = -1
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const before = await page.evaluate((target) =>
      window.__blendlinkR3fAnimationTransport.evidence[target].renders, kind)
    await page.waitForTimeout(quietMs)
    const after = await page.evaluate((target) =>
      window.__blendlinkR3fAnimationTransport.evidence[target].renders, kind)
    if (before === after) return { renders: after, quietMs }
    previous = after
  }
  throw new Error(`${kind} Canvas did not settle; last render count ${previous}`)
}

buildBlendlink()
typecheckFixture()

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

let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Vite did not expose its test port')
  const url = `http://127.0.0.1:${address.port}/`
  browser = await chromium.launch({
    headless: true,
    ...(systemChromium ? {
      executablePath: systemChromium,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    } : {}),
  })
  const page = await browser.newPage({
    viewport: { width: 1160, height: 980 },
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
    () => window.__blendlinkR3fAnimationTransport?.evidence.manual.ready === true,
    null,
    { timeout: 30_000 },
  )
  await page.waitForFunction(() => {
    const manual = window.__blendlinkR3fAnimationTransport.evidence.manual
    return manual.renders >= 1 && manual.coloredPixels > 1_000
  }, null, { timeout: 10_000 })

  const checkpoints = {}
  checkpoints.manualInitial = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))
  const manualInitialQuiet = await waitForStableRenders(page, 'manual')
  checkpoints.manualInitialQuiet = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))
  assert(checkpoints.manualInitial.phase === 'idle', 'Manual clip did not start idle')
  assert(
    checkpoints.manualInitial.renders >= 1 && checkpoints.manualInitial.coloredPixels > 1_000,
    'Manual ready state was not visibly rendered before application interaction',
  )
  assert(
    Math.abs(checkpoints.manualInitial.poseX - checkpoints.manualInitial.restX) < 1e-5,
    'Manual initial frame did not show the authored rest/start pose',
  )
  assert(
    checkpoints.manualInitial.requiresContinuousFrames === false,
    'Manual idle transport claimed continuous frames',
  )
  assert(
    checkpoints.manualInitialQuiet.renders === manualInitialQuiet.renders,
    'Manual idle render count was not stable',
  )

  // A demand Canvas may stay dormant much longer than the authored clip.
  // The first wake frame must establish a fresh animation clock origin rather
  // than treating that idle wall time as playback time.
  await page.waitForTimeout(1_350)
  const manualSamplesBeforePlay = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.evidence.manual.renderSamples.length)
  await page.evaluate(() => window.__blendlinkR3fAnimationTransport.manual.play('ManualMove'))
  await page.waitForFunction(
    (initialRenders) =>
      window.__blendlinkR3fAnimationTransport.evidence.manual.renders > initialRenders,
    checkpoints.manualInitialQuiet.renders,
    { timeout: 5_000 },
  )
  checkpoints.manualWakeFrame = await page.evaluate((sampleIndex) =>
    window.__blendlinkR3fAnimationTransport.evidence.manual.renderSamples[sampleIndex],
  manualSamplesBeforePlay)
  assert(checkpoints.manualWakeFrame, 'Manual play did not produce a captured wake frame')
  assert(
    checkpoints.manualWakeFrame.phase === 'playing'
      && checkpoints.manualWakeFrame.animationTime <= 0.1,
    'Manual play inherited idle wall time instead of establishing a fresh demand-frame origin: ' +
      JSON.stringify(checkpoints.manualWakeFrame),
  )
  await page.waitForFunction(
    (initialRenders) => {
      const next = window.__blendlinkR3fAnimationTransport.snapshot('manual')
      return next.phase === 'playing'
        && next.renders >= initialRenders + 5
        && Math.abs(next.poseX - next.restX) > 0.25
    },
    checkpoints.manualInitialQuiet.renders,
    { timeout: 10_000 },
  )
  checkpoints.manualPlaying = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))
  assert(
    checkpoints.manualPlaying.requiresContinuousFrames === true,
    'Manual play did not acquire continuous-frame demand',
  )

  await page.evaluate(() => window.__blendlinkR3fAnimationTransport.manual.pause())
  const pauseQuiet = await waitForStableRenders(page, 'manual')
  checkpoints.manualPaused = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))
  await page.waitForTimeout(280)
  checkpoints.manualPausedLater = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))
  assert(checkpoints.manualPaused.phase === 'paused', 'Manual pause did not publish paused')
  assert(
    checkpoints.manualPaused.requiresContinuousFrames === false,
    'Paused transport still claimed continuous frames',
  )
  assert(
    checkpoints.manualPausedLater.renders === pauseQuiet.renders,
    'Manual pause allowed additional Canvas renders after settling',
  )
  assert(
    Math.abs(checkpoints.manualPausedLater.poseX - checkpoints.manualPaused.poseX) < 1e-5,
    'Manual pose moved while paused',
  )

  const beforeSeek = checkpoints.manualPausedLater
  await page.evaluate(() => window.__blendlinkR3fAnimationTransport.manual.seek(0.85))
  await page.waitForFunction(
    (before) => window.__blendlinkR3fAnimationTransport.snapshot('manual').renders > before,
    beforeSeek.renders,
    { timeout: 5_000 },
  )
  checkpoints.manualSeek = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))
  assert(
    Math.abs(checkpoints.manualSeek.poseX - beforeSeek.poseX) > 0.35,
    'Manual seek did not change the object pose',
  )
  assert(
    Math.abs(checkpoints.manualSeek.pixelCentroidX - beforeSeek.pixelCentroidX) > 18,
    'Manual seek did not move the rendered cyan pixel centroid',
  )
  await page.locator('#manual-canvas canvas').screenshot({
    path: resolve(output, 'manual-seek.png'),
  })

  await page.evaluate(() => window.__blendlinkR3fAnimationTransport.manual.play())
  await page.waitForFunction(
    (before) => {
      const next = window.__blendlinkR3fAnimationTransport.snapshot('manual')
      return next.phase === 'playing'
        && next.renders >= before.renders + 4
        && Math.abs(next.poseX - before.poseX) > 0.08
    },
    checkpoints.manualSeek,
    { timeout: 10_000 },
  )
  checkpoints.manualResumed = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))

  await page.evaluate(() => window.__blendlinkR3fAnimationTransport.manual.stop())
  await page.waitForFunction(
    (before) => {
      const next = window.__blendlinkR3fAnimationTransport.snapshot('manual')
      return next.renders > before && next.phase === 'idle'
    },
    checkpoints.manualResumed.renders,
    { timeout: 5_000 },
  )
  await waitForStableRenders(page, 'manual')
  checkpoints.manualStopped = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))
  assert(Math.abs(checkpoints.manualStopped.time) < 1e-8, 'Manual stop did not reset time')
  assert(
    Math.abs(checkpoints.manualStopped.poseX - checkpoints.manualStopped.restX) < 1e-5,
    'Manual stop did not restore the authored rest/start pose',
  )
  assert(
    checkpoints.manualStopped.requiresContinuousFrames === false,
    'Manual stop retained continuous-frame demand',
  )

  await page.evaluate(() => window.__blendlinkR3fAnimationTransport.mountSequence())
  await page.waitForFunction(
    () => window.__blendlinkR3fAnimationTransport?.evidence.sequence.ready === true,
    null,
    { timeout: 30_000 },
  )
  checkpoints.sequenceReady = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('sequence'))
  assert(checkpoints.sequenceReady.phase === 'playing', 'Authored sequence did not autoplay')
  assert(
    checkpoints.sequenceReady.internalActionsPaused === true,
    'Authored sequence exposed a non-paused internal Three action',
  )
  const sequenceReadyRenders = checkpoints.sequenceReady.renders
  await page.waitForFunction(
    () => window.__blendlinkR3fAnimationTransport.snapshot('sequence').phase === 'finished',
    null,
    { timeout: 10_000 },
  )
  checkpoints.sequenceFinished = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('sequence'))
  assert(
    checkpoints.sequenceFinished.renders >= sequenceReadyRenders + 8,
    'Authored sequence did not keep demand renders alive while playing',
  )
  assert(
    checkpoints.sequenceFinished.internalActionsPaused === true,
    'Authored sequence actions were not kept paused during sampled playback',
  )
  assert(
    checkpoints.sequenceFinished.requiresContinuousFrames === false,
    'Finished bounded sequence retained continuous-frame demand',
  )
  const sequenceQuiet = await waitForStableRenders(page, 'sequence', 320)
  await page.waitForTimeout(320)
  checkpoints.sequenceSettled = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('sequence'))
  assert(
    checkpoints.sequenceSettled.renders === sequenceQuiet.renders,
    'Finished sequence continued rendering after demand settled',
  )
  await page.locator('#sequence-canvas canvas').screenshot({
    path: resolve(output, 'sequence-finished.png'),
  })

  checkpoints.manualBeforeDispose = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))
  await page.evaluate(() => window.__blendlinkR3fAnimationTransport.disposeManual())
  await page.waitForFunction(() => {
    const manual = window.__blendlinkR3fAnimationTransport.evidence.manual
    return manual.unmounted
      && manual.resources.geometryDisposed === 1
      && manual.resources.materialDisposed === 1
  }, null, { timeout: 10_000 })
  checkpoints.manualDisposed = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))
  const staleError = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.invokeStaleManual())
  assert(/disposed/i.test(staleError), `Stale handle did not fail as disposed: ${staleError}`)
  await page.waitForTimeout(360)
  checkpoints.manualDisposedLater = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.snapshot('manual'))
  assert(
    checkpoints.manualDisposedLater.renders === checkpoints.manualDisposed.renders,
    'Disposed manual scene produced later renders',
  )
  assert(
    checkpoints.manualDisposed.resources.geometryDisposed === 1
      && checkpoints.manualDisposed.resources.materialDisposed === 1,
    'Production disposal did not release the fixture geometry/material exactly once',
  )

  await page.evaluate(() => window.__blendlinkR3fAnimationTransport.disposeSequence())
  await page.waitForFunction(() =>
    window.__blendlinkR3fAnimationTransport.evidence.sequence.resources.geometryDisposed === 1
      && window.__blendlinkR3fAnimationTransport.evidence.sequence.resources.materialDisposed === 1,
  null, { timeout: 10_000 })
  await page.screenshot({
    path: resolve(output, 'r3f-animation-transport-browser.png'),
    fullPage: true,
  })

  const browserEvidence = await page.evaluate(() =>
    window.__blendlinkR3fAnimationTransport.evidence)
  const sequencePlayingSamples = browserEvidence.sequence.renderSamples.filter(
    (sample) => sample.phase === 'playing',
  )
  assert(
    sequencePlayingSamples.length >= 8,
    'Authored sequence did not capture enough playing-frame evidence',
  )
  assert(
    sequencePlayingSamples.every((sample) => sample.internalActionsPaused === true),
    'At least one authored-sequence playing frame exposed an unpaused Three action',
  )
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join('; ')}`)
  assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join('; ')}`)
  assert(browserEvidence.errors.length === 0, `Harness errors: ${browserEvidence.errors.join('; ')}`)

  const sourcePaths = {
    blendlinkR3fAdapter: resolve(repository, 'packages/blendlink/dist/reactThreeFiber.js'),
    blendlinkRuntime: resolve(repository, 'packages/blendlink/dist/runtime.js'),
    blendlinkThreeRuntime: resolve(repository, 'packages/blendlink/dist/threeRuntime.js'),
    r3f: resolve(repository, 'node_modules/@react-three/fiber/dist/events-b389eeca.esm.js'),
    threeAnimationAction: resolve(repository, 'node_modules/three/src/animation/AnimationAction.js'),
    threeAnimationMixer: resolve(repository, 'node_modules/three/src/animation/AnimationMixer.js'),
    reactDom: resolve(repository, 'node_modules/react-dom/cjs/react-dom-client.development.js'),
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
      blendlink: JSON.parse(readFileSync(resolve(
        repository,
        'packages/blendlink/package.json',
      ))).version,
      react: JSON.parse(readFileSync(resolve(repository, 'node_modules/react/package.json'))).version,
      reactDom: JSON.parse(readFileSync(
        resolve(repository, 'node_modules/react-dom/package.json'),
      )).version,
      reactThreeFiber: JSON.parse(readFileSync(
        resolve(repository, 'node_modules/@react-three/fiber/package.json'),
      )).version,
      three: JSON.parse(readFileSync(resolve(repository, 'node_modules/three/package.json'))).version,
      playwright: JSON.parse(readFileSync(resolve(
        repository,
        '../MichaelRoweJonesSite/node_modules/playwright/package.json',
      ))).version,
      vite: JSON.parse(readFileSync(resolve(repository, 'node_modules/vite/package.json'))).version,
      typescript: JSON.parse(readFileSync(
        resolve(repository, 'node_modules/typescript/package.json'),
      )).version,
    },
    sources: Object.fromEntries(Object.entries(sourcePaths).map(([key, path]) => [
      key,
      { path, sha256: sha256(path) },
    ])),
    artifacts: {
      manualSeek: {
        path: 'output/manual-seek.png',
        sha256: sha256(resolve(output, 'manual-seek.png')),
      },
      sequenceFinished: {
        path: 'output/sequence-finished.png',
        sha256: sha256(resolve(output, 'sequence-finished.png')),
      },
      fullPage: {
        path: 'output/r3f-animation-transport-browser.png',
        sha256: sha256(resolve(output, 'r3f-animation-transport-browser.png')),
      },
    },
    pageErrors,
    consoleErrors,
    checkpoints,
    browserEvidence,
    assertions: {
      productionR3fAdapterAndThreeInstaller: true,
      applicationCommandsUseReadyHandleAnimationOnly: true,
      manualInitialStaticVisibleBeforeInteraction: true,
      manualIdleRendersSettle: true,
      manualPlayKeepsDemandFramesAlive: true,
      manualPauseSettlesAndFreezesPose: true,
      manualSeekRequestsOneRenderAndMovesPixels: true,
      manualResumeReacquiresDemandFrames: true,
      manualStopRestoresStartPoseAndSettles: true,
      boundedNlaUsesPausedThreeActionsWhileDemandFramesContinue: true,
      boundedNlaFinishesAndSettles: true,
      staleAnimationTransportFailsAfterDisposal: true,
      fixtureGeometryAndMaterialDisposedExactlyOnce: true,
      noRendersAfterDisposal: true,
    },
    limits: [
      'Experiment-only gate using an application-owned deterministic GLTFLoader result; it does not cover fetch, GLB parse, decoder, worker, or cache ownership.',
      'Chromium with ANGLE SwiftShader only; no Firefox, WebKit, mobile, XR, WebGPU, or physical-GPU evidence.',
      'The fixture exercises one ordinary transform clip and one single-strip bounded NLA sequence; multi-clip blending, additive strips, bones, morphs, audio, LOD, controls, and post-processing render ownership remain outside it.',
      'Renderer.render counts are the public per-Canvas observable. The gate does not inspect or promise R3F private internal.frames state.',
      'The sequence internal-action assertion uses the production onReady InstalledThreeCompiledScene diagnostic surface; application commands still use only R3FCompiledSceneHandle.animation.',
      'Local Vite HTTP and production dist modules are exercised, not a packed tarball, CDN/base path, strict CSP, or deployed site.',
    ],
  }
  writeFileSync(resolve(output, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    'BLENDLINK_R3F_ANIMATION_TRANSPORT_BROWSER_PASSED ' +
    `manualPlayRenders=${checkpoints.manualPlaying.renders - checkpoints.manualInitialQuiet.renders} ` +
    `pauseExtraRenders=${checkpoints.manualPausedLater.renders - pauseQuiet.renders} ` +
    `seekPixelDelta=${Math.abs(
      checkpoints.manualSeek.pixelCentroidX - beforeSeek.pixelCentroidX,
    ).toFixed(1)} ` +
    `sequenceRenders=${checkpoints.sequenceFinished.renders - sequenceReadyRenders} ` +
    `sequenceAfterFinish=${checkpoints.sequenceSettled.renders - sequenceQuiet.renders} ` +
    `stale=${JSON.stringify(staleError)}`,
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
