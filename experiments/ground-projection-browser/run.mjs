import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const artifactDirectory = resolve(repository, 'artifacts/ground-projection-browser-2026')
const defaultPlaywright = resolve(
  repository, '../MichaelRoweJonesSite/node_modules/playwright/index.mjs',
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

function encodeRgbe(red, green, blue) {
  const maximum = Math.max(red, green, blue)
  if (maximum <= 1e-32) return [0, 0, 0, 0]
  const exponent = Math.ceil(Math.log2(maximum))
  const scale = 255 / Math.pow(2, exponent)
  return [
    Math.max(0, Math.min(255, Math.round(red * scale))),
    Math.max(0, Math.min(255, Math.round(green * scale))),
    Math.max(0, Math.min(255, Math.round(blue * scale))),
    exponent + 128,
  ]
}

/** A tiny asymmetric lat-long HDR, served over the same origin so the
 * production loaders exercise a real fetch rather than a data-URL shortcut. */
function makeHdrBytes() {
  const width = 32
  const height = 16
  const header = Buffer.from(
    `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`,
    'ascii',
  )
  const pixels = Buffer.alloc(width * height * 4)
  const quadrants = [
    [0.92, 0.08, 0.05],
    [0.06, 0.82, 0.14],
    [0.06, 0.20, 0.94],
    [0.93, 0.70, 0.04],
  ]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const quadrant = Math.min(3, Math.floor(x / (width / 4)))
      const source = quadrants[quadrant]
      const lower = y >= height / 2
      const stripe = lower && y % 2 === 0 ? 0.36 : lower ? 0.58 : 1
      const marker = x === 1 && y === 2 ? 0.25 : 1
      const encoded = encodeRgbe(
        source[0] * stripe * marker,
        source[1] * stripe,
        source[2] * stripe,
      )
      Buffer.from(encoded).copy(pixels, (y * width + x) * 4)
    }
  }
  return Buffer.concat([header, pixels])
}

const hdrBytes = makeHdrBytes()
mkdirSync(artifactDirectory, { recursive: true })
const server = await createServer({
  root,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  plugins: [{
    name: 'blendlink-ground-projection-hdr-fixture',
    configureServer(viteServer) {
      viteServer.middlewares.use('/axis.hdr', (_request, response) => {
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/octet-stream')
        response.setHeader('Content-Length', String(hdrBytes.length))
        response.end(hdrBytes)
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
    viewport: { width: 1180, height: 1900 },
    deviceScaleFactor: 1,
  })
  const interceptedRequests = []
  await page.route('https://www.gstatic.com/draco/**', async (route) => {
    interceptedRequests.push(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      },
      body: '/* Ground Projection fixture: unrelated Needle DRACO bootstrap isolated. */',
    })
  })
  const pageErrors = []
  const consoleErrors = []
  const requestFailures = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    requestFailures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? 'unknown request failure',
    })
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__groundProjectionEvidence?.ready === true)
  const evidence = await page.evaluate(() => window.__groundProjectionEvidence)
  const ignoredNeedleBootstrapErrors = interceptedRequests.length > 0
    ? pageErrors.filter((message) => message === 'Failed to fetch')
    : []
  const relevantPageErrors = pageErrors.filter(
    (message) => !(interceptedRequests.length > 0 && message === 'Failed to fetch'),
  )
  const unrelatedNeedleDecoderFailures = requestFailures.filter(
    ({ url }) => url.startsWith('https://cdn.needle.tools/static/three/'),
  )
  const unexpectedRequestFailures = requestFailures.filter(
    ({ url }) => !url.startsWith('https://cdn.needle.tools/static/three/'),
  )
  const expectedDecoderConsoleErrors = consoleErrors.every(
    (message) => message.startsWith('Failed to load resource:'),
  ) && consoleErrors.length === unrelatedNeedleDecoderFailures.length
  assert(evidence, 'browser fixture did not publish evidence')
  assert(evidence.errors.length === 0, `browser fixture errors: ${evidence.errors.join('; ')}`)
  assert(relevantPageErrors.length === 0, `page errors: ${relevantPageErrors.join('; ')}`)
  assert(
    unexpectedRequestFailures.length === 0,
    `unexpected request failures: ${JSON.stringify(unexpectedRequestFailures)}`,
  )
  assert(
    consoleErrors.length === 0 || expectedDecoderConsoleErrors,
    `console errors: ${consoleErrors.join('; ')}; request failures: ${JSON.stringify(requestFailures)}`,
  )

  const common = evidence.shared.common
  const rotated = evidence.shared.rotated
  const needleRotationEffect = evidence.shared.needleEquirectangularRotationEffect
  const blendlinkRotationEffect = evidence.shared.blendlinkEquirectangularRotationEffect
  const intensity = evidence.shared.intensity
  const autoFit = evidence.shared.autoFit
  const cameraUnsafeToReference = evidence.shared.cameraUnsafeToReference
  const cameraRepairedToReference = evidence.shared.cameraRepairedToReference
  const cells = evidence.cells
  const pixelCount = 480 * 360
  for (const name of [
    'needleCommon', 'blendlinkCommon', 'needleRotated',
    'blendlinkRotated', 'needleIntensity', 'blendlinkIntensity',
    'needleAutoFit', 'blendlinkAutoFit',
    'cameraRepaired', 'cameraReference',
  ]) {
    assert(cells[name].summary.nonBlackPixels > pixelCount * 0.95, `${name} rendered mostly blank`)
    assert(cells[name].summary.opaquePixels === pixelCount, `${name} did not render opaque pixels`)
  }
  assert(
    cells.cameraUnsafe.summary.opaquePixels === pixelCount,
    'cameraUnsafe did not preserve an opaque renderer output',
  )
  assert(common.mae < 4, `shared no-rotation projection MAE was too high: ${common.mae}`)
  assert(common.rmse < 16, `shared no-rotation projection RMSE was too high: ${common.rmse}`)
  assert(
    common.changedPixelsOver8 < pixelCount * 0.08,
    `shared no-rotation projection exceeded 8-channel error over too much of the image`,
  )
  assert(
    rotated.mae > 10,
    `same-sign rotation unexpectedly matched; the regression probe no longer demonstrates the current gap`,
  )
  assert(
    needleRotationEffect.mae < 0.001,
    `Needle raw-equirectangular rotation behavior changed: ${needleRotationEffect.mae}`,
  )
  assert(
    blendlinkRotationEffect.mae > 10,
    `Blendlink raw-equirectangular rotation did not visibly rotate the projection`,
  )
  assert(intensity.mae < 4, `intensity-only projection MAE was too high: ${intensity.mae}`)
  assert(intensity.rmse < 16, `intensity-only projection RMSE was too high: ${intensity.rmse}`)
  assert(autoFit.mae < 4, `auto-fit projection MAE was too high: ${autoFit.mae}`)
  assert(autoFit.rmse < 16, `auto-fit projection RMSE was too high: ${autoFit.rmse}`)
  assert(
    autoFit.changedPixelsOver8 < pixelCount * 0.08,
    'auto-fit projection exceeded 8-channel error over too much of the image',
  )
  assert(
    cells.cameraUnsafe.clippedVertexCount > 0,
    'pre-fix far-plane control did not clip GroundedSkybox vertices',
  )
  assert(
    cameraUnsafeToReference.mae > 1,
    `pre-fix far-plane control was not visibly different from the safe reference: ${cameraUnsafeToReference.mae}`,
  )
  assert(
    cells.cameraRepaired.cameraFar >= cells.cameraRepaired.requiredFar,
    `package camera remained unsafe: ${cells.cameraRepaired.cameraFar} < ${cells.cameraRepaired.requiredFar}`,
  )
  assert(
    cells.cameraRepaired.clippedVertexCount === 0,
    `package camera still clipped ${cells.cameraRepaired.clippedVertexCount} vertices`,
  )
  assert(
    cameraRepairedToReference.mae < 0.01,
    `repaired camera differed from the far=1000 reference: ${cameraRepairedToReference.mae}`,
  )
  for (const kind of ['rejectedPerspective', 'rejectedOrthographic']) {
    const rejection = evidence.cameraOwnership[kind]
    assert(
      /application-owned camera far plane .* clips .* Grounded Backdrop vertices/i.test(rejection.message),
      `${kind} did not report an artist-readable clipping failure: ${rejection.message}`,
    )
    assert(rejection.farUnchanged === true, `${kind} camera far plane was mutated`)
    assert(rejection.projectionUnchanged === true, `${kind} projection matrix was mutated`)
    assert(rejection.rootRolledBack === true, `${kind} compiled root did not roll back`)
    assert(rejection.sceneChildren === 0, `${kind} left scene-owned objects attached`)
  }
  assert(cells.needleCommon.geometryTriangles === 16_128, 'Needle resolution-64 triangle count drifted')
  assert(cells.blendlinkCommon.geometryTriangles === 65_024, 'Blendlink resolution-128 triangle count drifted')
  const expectedAutoFit = [3, 0.5, 1]
  assert(
    cells.needleAutoFit.projectionPosition.every(
      (value, index) => Math.abs(value - expectedAutoFit[index]) < 0.001,
    ),
    `Needle auto-fit position drifted: ${cells.needleAutoFit.projectionPosition}`,
  )
  assert(
    cells.blendlinkAutoFit.projectionPosition.every(
      (value, index) => Math.abs(value - expectedAutoFit[index]) < 0.001,
    ),
    `Blendlink compiled-root auto-fit position drifted: ${cells.blendlinkAutoFit.projectionPosition}`,
  )

  await page.screenshot({
    path: resolve(artifactDirectory, 'ground-projection-differential.png'),
    fullPage: true,
  })
  for (const section of ['common', 'rotated', 'intensity', 'autofit', 'camera-safety']) {
    await page.locator(`#${section}`).screenshot({
      path: resolve(artifactDirectory, `${section}.png`),
    })
  }

  const disposed = await page.evaluate(() => window.__groundProjectionEvidence.dispose())
  for (const name of [
    'blendlinkCommon', 'blendlinkRotated', 'blendlinkIntensity', 'blendlinkAutoFit',
    'cameraUnsafe', 'cameraRepaired', 'cameraReference',
  ]) {
    assert(disposed[name].remainedParented === false, `${name} projection remained parented`)
    assert(disposed[name].installerDisposedGeometry === true, `${name} geometry was not disposed`)
  }
  for (const name of ['needleCommon', 'needleRotated', 'needleIntensity', 'needleAutoFit']) {
    assert(disposed[name].remainedParented === false, `${name} projection remained parented`)
    assert(
      disposed[name].componentDisposedGeometry === false,
      `${name} unexpectedly disposed geometry during component disable`,
    )
    assert(
      disposed[name].geometryAfterManualDispose < disposed[name].geometryAfterRemove,
      `${name} manual geometry disposal had no observable renderer-memory effect`,
    )
  }

  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    url,
    browser: await browser.version(),
    execution: {
      needle: 'Actual pinned GroundProjectedEnv TypeScript class and its nested Three dependency',
      blendlink: 'Current installLoadedThreeCompiledScene production source module',
      renderer: systemChromium ? 'System Chromium with ANGLE SwiftShader flags' : 'Playwright Chromium',
      viewport: [480, 360],
      deviceScaleFactor: 1,
    },
    versions: {
      needleEngine: JSON.parse(readFileSync(resolve(
        repository,
        'experiments/needle-spike/node_modules/@needle-tools/engine/package.json',
      ))).version,
      needleThree: JSON.parse(readFileSync(resolve(
        repository,
        'experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/package.json',
      ))).version,
      blendlink: JSON.parse(readFileSync(resolve(
        repository,
        'packages/blendlink/package.json',
      ))).version,
      blendlinkThree: JSON.parse(readFileSync(resolve(
        repository,
        'node_modules/three/package.json',
      ))).version,
    },
    source: {
      needleGroundProjection: {
        path: 'experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/GroundProjection.ts',
        sha256: sha256(resolve(
          repository,
          'experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/GroundProjection.ts',
        )),
      },
      needleGroundedSkybox: {
        path: 'experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/objects/GroundedSkybox.js',
        sha256: sha256(resolve(
          repository,
          'experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/objects/GroundedSkybox.js',
        )),
      },
      blendlinkThreeRuntime: {
        path: 'packages/blendlink/src/threeRuntime.ts',
        sha256: sha256(resolve(repository, 'packages/blendlink/src/threeRuntime.ts')),
      },
      blendlinkRuntime: {
        path: 'packages/blendlink/src/runtime.ts',
        sha256: sha256(resolve(repository, 'packages/blendlink/src/runtime.ts')),
      },
      blendlinkRenderableBounds: {
        path: 'packages/blendlink/src/threeRenderableBounds.ts',
        sha256: sha256(resolve(repository, 'packages/blendlink/src/threeRenderableBounds.ts')),
      },
      blendlinkGroundedCameraSafety: {
        path: 'packages/blendlink/src/threeGroundedCameraSafety.ts',
        sha256: sha256(resolve(repository, 'packages/blendlink/src/threeGroundedCameraSafety.ts')),
      },
      blendlinkGroundedSkybox: {
        path: 'node_modules/three/examples/jsm/objects/GroundedSkybox.js',
        sha256: sha256(resolve(
          repository,
          'node_modules/three/examples/jsm/objects/GroundedSkybox.js',
        )),
      },
      fixtureMain: {
        path: 'experiments/ground-projection-browser/main.ts',
        sha256: sha256(resolve(root, 'main.ts')),
      },
      fixtureRunner: {
        path: 'experiments/ground-projection-browser/run.mjs',
        sha256: sha256(resolve(root, 'run.mjs')),
      },
      fixtureHdr: {
        generated: '32x16 RGBE axis chart served at /axis.hdr',
        sha256: createHash('sha256').update(hdrBytes).digest('hex'),
      },
    },
    pageErrors,
    ignoredNeedleBootstrapErrors,
    consoleErrors,
    requestFailures,
    unrelatedNeedleDecoderFailures,
    interceptedRequests,
    shared: evidence.shared,
    cells,
    cameraOwnership: evidence.cameraOwnership,
    disposed,
    assertions: {
      actualPinnedNeedleClassExecuted: true,
      blendlinkProductionInstallerExecuted: true,
      commonProjectionPixelsWithinThreshold: true,
      rawEquirectangularBehaviorDifferenceObserved: true,
      needleRawEquirectangularRotationNoOpObserved: true,
      blendlinkRawEquirectangularRotationEffectObserved: true,
      intensityPixelsWithinThreshold: true,
      autoFitPositionAndPixelsWithinThreshold: true,
      unsafePackageFallbackControlVisiblyClips: true,
      packageFallbackCameraRepairMatchesSafeReference: true,
      unsafePerspectiveAndOrthographicApplicationCamerasRejectedWithoutMutation: true,
      exactGeometryBudgetsObserved: true,
      blendlinkDisposalObserved: true,
      needleDisableRetentionObserved: true,
      nonBlankOpaqueRenders: true,
    },
    limits: [
      'Chromium / ANGLE SwiftShader only; no physical-GPU timing, mobile, Firefox, WebKit, or WebGPU evidence.',
      'The fixture uses a generated 32x16 RGBE axis chart, not a production photographic HDR.',
      'The common pixel threshold was chosen to detect gross visual/orientation regressions, not to certify exact image identity.',
      'The rotation result applies to the raw equirectangular mapping used by Blendlink publication. Needle has a separate CubeUV shader branch; a PMREM/CubeUV visual differential remains pending.',
      'Auto-fit covers visible meshes beneath the compiled root at installation; later application-driven transforms and visibility changes do not continuously refit the projection.',
      'Projected horizon blur, AR/passthrough blending, camera motion after the one-time safety check, and repeated context-loss cycles remain unverified.',
      'Renderer memory counters show resource release behavior, not process-level VRAM reclamation.',
      'Importing the pinned Needle class transitively starts its default Google DRACO bootstrap; the fixture fulfills that unrelated request with an inert same-run response because no glTF/DRACO path is under test.',
      'The same Needle import also starts an unrelated Basis/KTX bootstrap. Network-restricted Chromium rejects it; the exact URLs and console messages are retained in evidence and no glTF/KTX path is under test.',
    ],
  }
  writeFileSync(
    resolve(artifactDirectory, 'evidence.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
    `BLENDLINK_GROUND_PROJECTION_BROWSER_PASSED ` +
      `commonMae=${common.mae.toFixed(4)} rotatedMae=${rotated.mae.toFixed(4)} ` +
      `autoFitMae=${autoFit.mae.toFixed(4)} ` +
      `unsafeFarMae=${cameraUnsafeToReference.mae.toFixed(4)} ` +
      `repairedFarMae=${cameraRepairedToReference.mae.toFixed(4)} ` +
      `needleTris=${cells.needleCommon.geometryTriangles} ` +
      `blendlinkTris=${cells.blendlinkCommon.geometryTriangles}`,
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
