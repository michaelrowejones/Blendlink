import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const artifactDirectory = resolve(repository, 'artifacts/reflection-probe-browser-2026')
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

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertFace(actual, expected, label) {
  for (let channel = 0; channel < 3; channel += 1) {
    const minimum = expected[channel] === 1 ? 0.82 : -0.02
    const maximum = expected[channel] === 1 ? 1.08 : 0.06
    assert(
      Number.isFinite(actual[channel]) &&
        actual[channel] >= minimum &&
        actual[channel] <= maximum,
      `${label} face channel ${channel} expected ${expected[channel]} but read ${actual[channel]}`,
    )
  }
  assert(actual[3] >= 0.98 && actual[3] <= 1.02, `${label} face alpha was ${actual[3]}`)
}

mkdirSync(artifactDirectory, { recursive: true })
const server = await createServer({
  root,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
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
    viewport: { width: 1100, height: 920 },
    deviceScaleFactor: 1,
  })
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__reflectionProbeEvidence?.ready === true)
  const state = await page.evaluate(() => ({
    evidence: window.__reflectionProbeEvidence?.evidence,
    errors: window.__reflectionProbeEvidence?.errors ?? [],
  }))
  const evidence = state.evidence
  assert(evidence, 'browser fixture did not publish reflection-probe evidence')
  assert(state.errors.length === 0, `fixture errors: ${state.errors.join('; ')}`)
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('; ')}`)

  const success = evidence.success
  assert(success.lifecycle.cubeTargetsCreated === 1, 'success did not allocate one cube target')
  assert(success.lifecycle.cubeTargetsDisposed === 1, 'temporary success cube target was not disposed')
  assert(success.lifecycle.cubeCameraUpdates === 1, 'success did not perform one CubeCamera update')
  assert(
    JSON.stringify(success.lifecycle.receiverVisibilityAtUpdate) === JSON.stringify([false]),
    `assigned receiver was visible during capture: ${success.lifecycle.receiverVisibilityAtUpdate}`,
  )
  assert(success.lifecycle.generatorsCreated === 1, 'success did not allocate one PMREM generator')
  assert(success.lifecycle.generatorsDisposed === 1, 'temporary PMREM generator was not disposed')
  assert(success.lifecycle.pmremTargetsCreated === 1, 'success did not produce one PMREM target')
  assert(success.lifecycle.pmremTargetsDisposed === 0, 'owned PMREM target was disposed before handle cleanup')
  assert(success.receiverVisibleAfterCapture, 'receiver visibility was not restored after successful capture')
  assert(
    success.receiverRenderCallsDuringCapture === 0,
    `receiver rendered ${success.receiverRenderCallsDuringCapture} times while capture was active`,
  )
  assert(
    success.receiverRenderCallsAfterPresentation > 0,
    'receiver did not become visible in the application-owned presentation render',
  )
  assert(success.originalMaterialCloned, 'probe assignment mutated the authored material object')
  assert(success.pmremAssigned, 'assigned material did not receive the owned PMREM texture')
  assert(success.report.probesConfigured === 1, 'compiled report did not configure one probe')
  assert(success.report.objectsAssigned === 1, 'compiled report did not assign one receiver')
  assert(success.report.runtimeCaptures === 1, 'compiled report did not count the runtime capture')
  assert(success.report.publishedTextures === 0, 'runtime fixture unexpectedly loaded a published texture')
  assert(
    success.report.capturePixels === 6 * 64 ** 2,
    `compiled capture-pixel accounting drifted: ${success.report.capturePixels}`,
  )

  const expectedFaces = [
    [1, 0, 0],
    [0, 1, 1],
    [0, 1, 0],
    [1, 0, 1],
    [0, 0, 1],
    [1, 1, 0],
  ]
  const faceLabels = ['+X', '-X', '+Y', '-Y', '+Z', '-Z']
  assert(evidence.faceCenters.length === 6, 'capture did not expose six cube face centers')
  for (let index = 0; index < expectedFaces.length; index += 1) {
    assertFace(evidence.faceCenters[index], expectedFaces[index], faceLabels[index])
  }
  console.log(`REFLECTION_PROBE_PIXEL_EVIDENCE ${JSON.stringify(success.pixels)}`)
  assert(success.pixels.nonBackground > 15_000, 'presentation render was mostly blank')
  assert(success.pixels.chromatic > 1_000, 'presentation receiver lacked visible chromatic PMREM evidence')
  assert(
    success.pixels.chromatic > success.negativeControlPixels.chromatic + 5_000,
    `PMREM did not materially exceed the no-env-map chromatic control ` +
      `(${success.negativeControlPixels.chromatic} -> ${success.pixels.chromatic})`,
  )
  assert(success.pixels.center[3] === 255, 'presentation center had zero alpha')

  const failure = evidence.forcedFailure
  assert(
    /intentional browser CubeCamera failure/.test(failure.message),
    `forced failure was not surfaced: ${failure.message}`,
  )
  assert(failure.receiverVisibleAfterFailure, 'receiver visibility was not restored after failure')
  assert(failure.lifecycle.cubeTargetsCreated === 1, 'failure did not allocate one cube target')
  assert(failure.lifecycle.cubeTargetsDisposed === 1, 'failure cube target was not disposed')
  assert(failure.lifecycle.generatorsCreated === 1, 'failure did not allocate one PMREM generator')
  assert(failure.lifecycle.generatorsDisposed === 1, 'failure PMREM generator was not disposed')
  assert(failure.lifecycle.pmremTargetsCreated === 0, 'failure unexpectedly produced a PMREM target')
  assert(
    JSON.stringify(failure.lifecycle.receiverVisibilityAtUpdate) === JSON.stringify([false]),
    'forced failure did not occur while the receiver was excluded',
  )

  await page.screenshot({
    path: resolve(artifactDirectory, 'reflection-probe-browser.png'),
    fullPage: true,
  })
  await page.locator('#stage').screenshot({
    path: resolve(artifactDirectory, 'reflection-probe-canvas.png'),
  })
  const disposed = await page.evaluate(() => window.__reflectionProbeEvidence?.dispose())
  assert(disposed, 'browser fixture did not publish disposal evidence')
  assert(disposed.materialIdentityRestored, 'disposal did not restore authored material identity')
  assert(disposed.pmremTargetsDisposed === 1, 'owned PMREM target was not disposed exactly once')
  assert(disposed.cubeTargetsDisposed === 1, 'success cube target disposal count drifted')
  assert(disposed.generatorsDisposed === 1, 'success generator disposal count drifted')
  assert(disposed.secondDisposeWasIdempotent, 'compiled probe disposal was not idempotent')
  assert(
    disposed.texturesAfterDispose <= disposed.texturesBeforeDispose,
    `GPU texture count increased during disposal (${disposed.texturesBeforeDispose} -> ${disposed.texturesAfterDispose})`,
  )

  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    url,
    browser: await browser.version(),
    playwrightVersion: JSON.parse(readFileSync(resolve(
      repository,
      '../MichaelRoweJonesSite/node_modules/playwright/package.json',
    ))).version,
    viteVersion: JSON.parse(readFileSync(resolve(repository, 'node_modules/vite/package.json'))).version,
    threeVersion: JSON.parse(readFileSync(resolve(repository, 'node_modules/three/package.json'))).version,
    blendlinkVersion: JSON.parse(
      readFileSync(resolve(repository, 'packages/blendlink/package.json')),
    ).version,
    source: {
      threePackageJsonSha256: sha256(resolve(
        repository,
        'node_modules/three/package.json',
      )),
      playwrightPackageJsonSha256: sha256(resolve(
        repository,
        '../MichaelRoweJonesSite/node_modules/playwright/package.json',
      )),
      reflectionProbesDistSha256: sha256(resolve(
        repository,
        'packages/blendlink/dist/reflectionProbes.js',
      )),
      threeCubeCameraSha256: sha256(resolve(
        repository,
        'node_modules/three/src/cameras/CubeCamera.js',
      )),
      threePmremGeneratorSha256: sha256(resolve(
        repository,
        'node_modules/three/src/extras/PMREMGenerator.js',
      )),
      threeWebGlRendererSha256: sha256(resolve(
        repository,
        'node_modules/three/src/renderers/WebGLRenderer.js',
      )),
      needleReflectionProbeSha256: sha256(resolve(
        repository,
        'experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/ReflectionProbe.ts',
      )),
    },
    pageErrors,
    consoleErrors,
    evidence,
    disposed,
    assertions: {
      sixCardinalFaceCenters: true,
      receiverExcludedDuringRealCubeUpdate: true,
      receiverRestoredOnSuccessAndFailure: true,
      pmremVisibleAndAssigned: true,
      noEnvironmentNegativeControl: true,
      temporaryResourcesDisposed: true,
      ownedPmremDisposedWithHandle: true,
      materialIdentityRestored: true,
      compiledReportAccounting: true,
    },
    limits: [
      'Chromium with WebGL2/ANGLE evidence only; Firefox, WebKit, mobile, WebGPU/TSL, and physical-GPU timing remain pending.',
      'Cardinal orientation is asserted on the production cubemap immediately before PMREM conversion. The final PMREM is proven assigned and visibly chromatic, but this fixture does not decode CubeUV texels into six independent postfilter directions.',
      'The failure path is a deterministic injected CubeCamera.update exception after real GPU objects are constructed; it is not a browser context-loss simulation.',
      'The forced failure proves Blendlink receiver/resource cleanup, not Three CubeCamera internal renderer-target/XR restoration after a renderer.render exception.',
      'renderer.info.memory.textures is recorded only as a coarse retained-resource sentinel; the exact ownership assertion comes from the returned PMREM render target disposal event.',
      'This executes the local production dist module, not a freshly extracted npm tarball or deployed CDN artifact.',
      'Pinned Needle source identity is recorded for the no-runtime-capture comparison, but Needle is not rendered side by side because its runtime has no analogous CubeCamera path.',
    ],
  }
  writeFileSync(
    resolve(artifactDirectory, 'evidence.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
      `BLENDLINK_REFLECTION_PROBE_BROWSER_PASSED ` +
      `captureMs=${evidence.captureMilliseconds.toFixed(1)} ` +
      `chromatic=${success.negativeControlPixels.chromatic}->${success.pixels.chromatic} ` +
      `textures=${disposed.texturesBeforeDispose}->${disposed.texturesAfterDispose}`,
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
