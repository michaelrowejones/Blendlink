import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const artifactDirectory = resolve(repository, 'artifacts/ground-projection-resolution-browser-2026')
const sourceExrPath = resolve(repository, 'experiments/needle-spike/assets/forest.exr')
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

assert(existsSync(sourceExrPath), `Photographic EXR fixture is missing: ${sourceExrPath}`)
mkdirSync(artifactDirectory, { recursive: true })
const exrBytes = readFileSync(sourceExrPath)
const server = await createServer({
  root,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  plugins: [{
    name: 'blendlink-ground-projection-resolution-exr',
    configureServer(viteServer) {
      viteServer.middlewares.use('/forest.exr', (_request, response) => {
        response.statusCode = 200
        response.setHeader('Content-Type', 'image/x-exr')
        response.setHeader('Content-Length', String(exrBytes.length))
        response.end(exrBytes)
      })
    },
  }],
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
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a port')
  const url = `http://127.0.0.1:${address.port}/`
  browser = await chromium.launch({
    headless: true,
    ...(systemChromium ? {
      executablePath: systemChromium,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    } : {}),
  })
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1200 },
    deviceScaleFactor: 1,
  })
  const pageErrors = []
  const consoleErrors = []
  const requestFailures = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', (request) => requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText ?? 'unknown request failure',
  }))

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => window.__groundProjectionResolutionEvidence?.ready === true,
  )
  const evidence = await page.evaluate(
    () => window.__groundProjectionResolutionEvidence,
  )
  assert(evidence, 'Browser fixture did not publish evidence')
  assert(evidence.errors.length === 0, `Fixture errors: ${evidence.errors.join('; ')}`)
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join('; ')}`)
  assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join('; ')}`)
  assert(requestFailures.length === 0, `Request failures: ${JSON.stringify(requestFailures)}`)
  assert(evidence.geometry.resolution64Triangles === 16_128, 'Resolution-64 triangle count drifted')
  assert(evidence.geometry.resolution128Triangles === 65_024, 'Resolution-128 triangle count drifted')

  const viewEntries = Object.entries(evidence.views)
  assert(viewEntries.length === 5, `Expected five viewpoints, observed ${viewEntries.length}`)
  for (const [name, view] of viewEntries) {
    const pixelCount = view.differential.pixelCount
    assert(
      view.resolution64.summary.opaquePixels === pixelCount,
      `${name} resolution-64 render was not fully opaque`,
    )
    assert(
      view.resolution128.summary.opaquePixels === pixelCount,
      `${name} resolution-128 render was not fully opaque`,
    )
    assert(
      view.resolution64.summary.nonBlackPixels > pixelCount * 0.95,
      `${name} resolution-64 render was mostly blank`,
    )
    assert(
      view.resolution128.summary.nonBlackPixels > pixelCount * 0.95,
      `${name} resolution-128 render was mostly blank`,
    )
  }

  const worstMae = Math.max(...viewEntries.map(([, view]) => view.differential.rgbMae))
  const worstRmse = Math.max(...viewEntries.map(([, view]) => view.differential.rgbRmse))
  const worstChangedOver8Fraction = Math.max(...viewEntries.map(([, view]) =>
    view.differential.changedPixelsOver8 / view.differential.pixelCount
  ))
  const safetyThresholds = {
    maximumRgbMae: 1,
    maximumRgbRmse: 6,
    maximumChangedPixelsOver8Fraction: 0.03,
  }
  const withinSafetyBudget =
    worstMae <= safetyThresholds.maximumRgbMae &&
    worstRmse <= safetyThresholds.maximumRgbRmse &&
    worstChangedOver8Fraction <= safetyThresholds.maximumChangedPixelsOver8Fraction
  assert(
    withinSafetyBudget === false,
    'Resolution 64 unexpectedly entered the declared image budget; re-evaluate the retain-128 decision.',
  )

  await page.screenshot({
    path: resolve(artifactDirectory, 'grounded-skybox-resolution-grid.png'),
    fullPage: true,
  })
  for (const [name] of viewEntries) {
    await page.locator(`#row-${name}`).evaluate((element) => {
      const figures = []
      let sibling = element.nextElementSibling
      while (sibling && figures.length < 3) {
        figures.push(sibling)
        sibling = sibling.nextElementSibling
      }
      const wrapper = document.createElement('section')
      wrapper.id = `capture-${element.id}`
      wrapper.style.display = 'grid'
      wrapper.style.gridTemplateColumns = 'repeat(3, 560px)'
      wrapper.style.gap = '18px'
      wrapper.style.background = '#0a0d12'
      wrapper.style.padding = '18px'
      element.parentElement?.insertBefore(wrapper, element)
      wrapper.append(element, ...figures)
      element.style.gridColumn = '1 / -1'
    })
    await page.locator(`#capture-row-${name}`).screenshot({
      path: resolve(artifactDirectory, `${name}.png`),
    })
  }

  const disposed = await page.evaluate(
    () => window.__groundProjectionResolutionEvidence.dispose(),
  )
  assert(disposed.sky64Parented === false, 'Resolution-64 mesh remained parented')
  assert(disposed.sky128Parented === false, 'Resolution-128 mesh remained parented')

  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    url,
    browser: await browser.version(),
    execution: {
      comparison: 'Three 0.184.0 GroundedSkybox at explicit resolutions 64 and 128',
      renderer: systemChromium ? 'System Chromium with ANGLE SwiftShader flags' : 'Playwright Chromium',
      sameRendererContext: true,
      sameTextureInstance: true,
      sameCameraPerPair: true,
      gpuTimerQueriesUsed: false,
      gpuSpeedClaim: false,
    },
    versions: {
      three: JSON.parse(readFileSync(resolve(repository, 'node_modules/three/package.json'))).version,
      vite: JSON.parse(readFileSync(resolve(repository, 'node_modules/vite/package.json'))).version,
    },
    source: {
      currentGroundedSkybox: {
        path: 'node_modules/three/examples/jsm/objects/GroundedSkybox.js',
        sha256: sha256(resolve(
          repository,
          'node_modules/three/examples/jsm/objects/GroundedSkybox.js',
        )),
      },
      pinnedNeedleGroundedSkybox: {
        path: 'experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/objects/GroundedSkybox.js',
        sha256: sha256(resolve(
          repository,
          'experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/objects/GroundedSkybox.js',
        )),
      },
      forestExr: {
        path: 'experiments/needle-spike/assets/forest.exr',
        bytes: exrBytes.length,
        sha256: sha256(sourceExrPath),
      },
      fixtureMain: {
        path: 'experiments/ground-projection-resolution-browser/main.ts',
        sha256: sha256(resolve(root, 'main.ts')),
      },
      fixtureRunner: {
        path: 'experiments/ground-projection-resolution-browser/run.mjs',
        sha256: sha256(resolve(root, 'run.mjs')),
      },
    },
    safetyPolicy: {
      thresholds: safetyThresholds,
      observedWorstCase: {
        rgbMae: worstMae,
        rgbRmse: worstRmse,
        changedPixelsOver8Fraction: worstChangedOver8Fraction,
      },
      result: 'failed',
      recommendation: 'retain-resolution-128',
      interpretation: 'Resolution 64 exceeded the declared photographic pixel-error budget, so this fixture does not support changing Blendlink to Needle resolution 64.',
    },
    settings: evidence.settings,
    renderer: evidence.renderer,
    geometry: {
      ...evidence.geometry,
      triangleReduction: evidence.geometry.resolution128Triangles -
        evidence.geometry.resolution64Triangles,
      triangleReductionFraction: 1 -
        evidence.geometry.resolution64Triangles / evidence.geometry.resolution128Triangles,
    },
    views: evidence.views,
    pageErrors,
    consoleErrors,
    requestFailures,
    disposed,
    assertions: {
      photographicExrFetchedAndRendered: true,
      fiveNearFloorAndHorizonViewsRendered: true,
      exactGeometryCountsObserved: true,
      resolution64ExceededDeclaredPixelErrorBudget: true,
      retainResolution128DecisionObserved: true,
      sameRendererTextureAndCameraPerPair: true,
      disposalObserved: true,
    },
    limits: [
      'Chrome / ANGLE SwiftShader only. No physical-GPU, mobile, Firefox, WebKit, WebGPU, XR, or context-loss evidence.',
      'No GPU timer queries were collected; triangle reduction is proven, but no GPU-time, frame-rate, power, memory-bandwidth, or battery-life improvement is claimed.',
      'The differential covers one 1024x512 photographic forest EXR, one capture height, one radius, five near-floor/horizon cameras, and a 560x350 output. It is not universal image-quality proof.',
      'Pixels were compared after ACES filmic tone mapping into an 8-bit sRGB render target. HDR-linear errors below or above that display transform are not measured.',
      'Resolution 128 is the reference because it is the current Three 0.184.0 default and current Blendlink behavior; this does not establish it as ground truth for all projections.',
      'The experiment isolates GroundedSkybox tessellation. It does not execute the Blendlink installer, Needle component, auto-fit, horizon blur, rotation, lighting, camera-far safety, or application post-processing.',
      'The safety thresholds are an explicit regression budget (RGB MAE <= 1, RGB RMSE <= 6, and <= 3% of pixels with any RGB channel error > 8), not a psychophysical just-noticeable-difference study.',
    ],
  }
  writeFileSync(
    resolve(artifactDirectory, 'evidence.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
    `BLENDLINK_GROUNDED_SKYBOX_RESOLUTION_BROWSER_PASSED ` +
      `recommendation=retain-128 ` +
      `worstMae=${worstMae.toFixed(4)} worstRmse=${worstRmse.toFixed(4)} ` +
      `worstOver8=${(worstChangedOver8Fraction * 100).toFixed(3)}% ` +
      `triangles64=${evidence.geometry.resolution64Triangles} ` +
      `triangles128=${evidence.geometry.resolution128Triangles}`,
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
