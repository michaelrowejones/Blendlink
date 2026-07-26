import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'
import {
  createAtomicGreenPng,
  createExternalTextureGlb,
} from './fixture-assets.mjs'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
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

const externalPng = createAtomicGreenPng()
const externalGlb = createExternalTextureGlb('atomic-green.png')
const fixtureRequests = []
const fixtureAssets = new Map([
  ['/external-assets/atomic-scene.glb', {
    bytes: externalGlb,
    contentType: 'model/gltf-binary',
    delayMs: 180,
  }],
  ['/external-assets/atomic-green.png', {
    bytes: externalPng,
    contentType: 'image/png',
    delayMs: 220,
  }],
])

function externalAssetFixturePlugin() {
  return {
    name: 'blendlink-external-asset-fixture',
    configureServer(viteServer) {
      viteServer.middlewares.use((request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
        const asset = fixtureAssets.get(requestUrl.pathname)
        if (!asset) {
          next()
          return
        }
        const record = {
          method: request.method ?? 'GET',
          path: requestUrl.pathname,
          startedAt: Date.now(),
          completedAt: null,
          status: null,
          bytes: asset.bytes.length,
          delayMs: asset.delayMs,
        }
        fixtureRequests.push(record)
        setTimeout(() => {
          response.statusCode = 200
          response.setHeader('Content-Type', asset.contentType)
          response.setHeader('Content-Length', String(asset.bytes.length))
          response.setHeader('Cache-Control', 'no-store')
          response.end(asset.bytes, () => {
            record.completedAt = Date.now()
            record.status = 200
          })
        }, asset.delayMs)
      })
    },
  }
}

const server = await createServer({
  root,
  logLevel: 'error',
  plugins: [externalAssetFixturePlugin()],
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', '@react-three/fiber', 'three'],
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
    viewport: { width: 1120, height: 860 },
    deviceScaleFactor: 1,
  })
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto(url, { waitUntil: 'networkidle' })
  try {
    await page.waitForFunction(
      () => window.__r3fAtomicEvidence?.ready === true,
      null,
      { timeout: 30_000 },
    )
  } catch (error) {
    const timeoutEvidence = await page.evaluate(() => window.__r3fAtomicEvidence)
    const timeoutSummary = timeoutEvidence ? {
      ready: timeoutEvidence.ready,
      strictMode: timeoutEvidence.strictMode,
      cells: Object.fromEntries(Object.entries(timeoutEvidence.cells).map(([mode, cell]) => [
        mode,
        {
          phase: cell.phase,
          effectSetups: cell.effectSetups,
          effectCleanups: cell.effectCleanups,
          staleAttemptsStopped: cell.staleAttemptsStopped,
          completedAttempts: cell.completedAttempts,
          gateBlocks: cell.gateBlocks,
          competingRenders: cell.competingRenders,
          compileAsyncCalls: cell.compileAsyncCalls,
          managerStartedUrls: cell.managerStartedUrls,
          managerCompletedUrls: cell.managerCompletedUrls,
          externalGltfLoads: cell.externalGltfLoads,
          externalTextureDecodeChecks: cell.externalTextureDecodeChecks,
          externalTextureInitCalls: cell.externalTextureInitCalls,
          externalTextureImageKind: cell.externalTextureImageKind,
          counts: cell.counts,
          errors: cell.errors,
        },
      ])),
      errors: timeoutEvidence.errors,
    } : null
    console.error('R3F atomic prototype timeout evidence:', JSON.stringify(timeoutSummary, null, 2))
    console.error('R3F atomic prototype page errors:', JSON.stringify(pageErrors))
    console.error('R3F atomic prototype console errors:', JSON.stringify(consoleErrors))
    throw error
  }
  const evidence = await page.evaluate(() => window.__r3fAtomicEvidence)
  assert(evidence, 'browser fixture did not publish evidence')
  assert(evidence.errors.length === 0, `fixture errors: ${evidence.errors.join('; ')}`)
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('; ')}`)
  assert(
    evidence.strictMode.reactDomEffectSetups >= 2,
    'ReactDOM root Strict Mode did not replay the sentinel Effect setup',
  )
  assert(
    evidence.strictMode.reactDomEffectCleanups >= 1,
    'ReactDOM root Strict Mode did not replay the sentinel Effect cleanup',
  )

  for (const [mode, cell] of Object.entries(evidence.cells)) {
    assert(cell.effectSetups >= 1, `${mode} did not start an installation attempt`)
    assert(cell.completedAttempts === 1, `${mode} completed ${cell.completedAttempts} attempts`)
    assert(cell.gateBlocks > 0, `${mode} did not exercise the priority-1 frame gate`)
    assert(cell.competingRenders > 0, `${mode} did not exercise the priority-2 renderer`)
    assert(cell.compileAsyncCalls >= 1, `${mode} did not reach the Three compileAsync barrier`)
    assert(cell.counts['ready-green'] >= 3, `${mode} never presented the ready green state`)
  }

  const live = evidence.cells['live-gate']
  const hidden = evidence.cells['visibility-gate']
  const detached = evidence.cells['detached-commit']
  const production = evidence.cells['production-adapter']
  const external = evidence.cells['production-external-assets']
  assert(
    live.counts['partial-red'] > 0,
    'the live-mutation control did not expose partial red pixels through the competing renderer',
  )
  assert(
    hidden.counts['partial-red'] > 0,
    'the root-visibility design did not expose its scene-global partial red state',
  )
  assert(
    detached.counts['baseline-blue'] > 0,
    'the detached design did not preserve the application baseline while preparing',
  )
  assert(
    detached.counts['partial-red'] === 0,
    `the detached design exposed ${detached.counts['partial-red']} partial red frames`,
  )
  assert(
    production.counts['baseline-blue'] > 0,
    'the production adapter did not preserve the application baseline while preparing',
  )
  assert(
    production.counts['partial-red'] === 0,
    `the production adapter exposed ${production.counts['partial-red']} partial red frames`,
  )
  assert(
    production.counts['ready-green'] >= 3,
    'the production adapter did not present the prepared green root',
  )
  assert(
    production.detachedPreparationChecks >= 2,
    'the marked production component adapter did not run its detached preparation checks',
  )
  assert(
    production.livePreparationLeaks === 0,
    `the production adapter observed its root in the live world ${production.livePreparationLeaks} times`,
  )
  assert(
    production.adapterActivations === 1,
    `the production component adapter activated ${production.adapterActivations} times`,
  )
  assert(
    production.adapterCommittedSceneMatches === 1,
    'the production component adapter did not receive the committed application Scene',
  )
  assert(
    production.adapterCommittedCameraMatches === 1,
    'the production component adapter did not receive the prepared committed camera',
  )
  assert(
    external.counts['baseline-blue'] > 0,
    'the external-asset adapter did not preserve the application baseline while fetching',
  )
  assert(
    external.counts['partial-red'] === 0,
    `the external-asset adapter exposed ${external.counts['partial-red']} partial red frames`,
  )
  assert(
    external.counts['ready-green'] >= 3,
    'the external-asset adapter did not present the decoded green texture',
  )
  assert(
    external.samples.filter((sample) => sample.phase !== 'ready').every(
      (sample) => sample.classification === 'baseline-blue',
    ),
    'the external-asset adapter changed the visible application world before Ready',
  )
  const firstExternalReadySample = external.samples.find((sample) => sample.phase === 'ready')
  assert(
    firstExternalReadySample?.classification === 'ready-green',
    `the first external-asset Ready sample was ${
      firstExternalReadySample?.classification ?? 'missing'
    } rather than the decoded texture`,
  )
  assert(external.externalGltfLoads === 1, `external GLTF completed ${external.externalGltfLoads} times`)
  assert(
    external.managerStartedUrls.some((url) => url.endsWith('/atomic-scene.glb')),
    'the application-owned LoadingManager did not observe the GLB start',
  )
  assert(
    external.managerStartedUrls.some((url) => url.endsWith('/atomic-green.png')),
    'the application-owned LoadingManager did not observe the companion PNG start',
  )
  assert(
    external.managerCompletedUrls.some((url) => url.endsWith('/atomic-green.png')),
    'the application-owned LoadingManager did not observe the companion PNG decode completion',
  )
  assert(
    external.externalTextureDecodeChecks === 1,
    `the external PNG passed ${external.externalTextureDecodeChecks} decode checks`,
  )
  assert(
    external.externalTextureDimensions?.[0] === 2
      && external.externalTextureDimensions?.[1] === 2,
    `the external PNG dimensions were ${external.externalTextureDimensions?.join('x') ?? 'missing'}`,
  )
  assert(
    external.externalTextureImageKind === 'ImageBitmap',
    `the external PNG decoded through ${external.externalTextureImageKind ?? 'an unknown image type'}`,
  )
  assert(
    external.externalTextureInitCalls === 1,
    `WebGLRenderer.initTexture ran ${external.externalTextureInitCalls} times for the external PNG`,
  )
  assert(
    external.detachedPreparationChecks >= 2 && external.livePreparationLeaks === 0,
    'external texture preparation did not remain detached through its upload-init delay',
  )
  assert(
    external.adapterActivations === 1
      && external.adapterCommittedSceneMatches === 1
      && external.adapterCommittedCameraMatches === 1,
    'the external texture adapter did not activate exactly once against the committed Scene/camera',
  )
  for (const phase of ['fetching-glb', 'fetching-texture', 'uploading-texture', 'compiling-textured']) {
    assert(
      external.samples.some((sample) => (
        sample.phase === phase && sample.classification === 'baseline-blue'
      )),
      `the competing renderer did not sample the application baseline during ${phase}`,
    )
  }
  const glbRequests = fixtureRequests.filter((request) => (
    request.method === 'GET' && request.path === '/external-assets/atomic-scene.glb'
  ))
  const pngRequests = fixtureRequests.filter((request) => (
    request.method === 'GET' && request.path === '/external-assets/atomic-green.png'
  ))
  assert(glbRequests.length === 1, `fixture server observed ${glbRequests.length} GLB GET requests`)
  assert(pngRequests.length === 1, `fixture server observed ${pngRequests.length} PNG GET requests`)
  assert(
    glbRequests[0].status === 200 && pngRequests[0].status === 200,
    'fixture server did not complete both external-asset requests with HTTP 200',
  )
  assert(
    glbRequests[0].completedAt <= pngRequests[0].startedAt,
    'the companion PNG request began before the GLB response exposed its URI',
  )

  await page.screenshot({
    path: resolve(root, 'r3f-atomic-presentation.png'),
    fullPage: true,
  })
  const report = {
    schemaVersion: 3,
    observedAt: new Date().toISOString(),
    browser: await browser.version(),
    url,
    renderer: systemChromium ? 'System Chromium with ANGLE SwiftShader flags' : 'Playwright Chromium',
    installedSources: {
      react: { version: '19.0.0' },
      reactDom: {
        version: '19.0.0',
        path: 'node_modules/react-dom/cjs/react-dom-client.development.js',
        sha256: sha256(resolve(repository, 'node_modules/react-dom/cjs/react-dom-client.development.js')),
      },
      reactThreeFiber: {
        version: '9.6.1',
        path: 'node_modules/@react-three/fiber/dist/events-b389eeca.esm.js',
        sha256: sha256(resolve(repository, 'node_modules/@react-three/fiber/dist/events-b389eeca.esm.js')),
      },
      three: {
        version: '0.184.0',
        path: 'node_modules/three/src/renderers/WebGLRenderer.js',
        sha256: sha256(resolve(repository, 'node_modules/three/src/renderers/WebGLRenderer.js')),
      },
      threeGltfLoader: {
        version: '0.184.0',
        path: 'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
        sha256: sha256(resolve(repository, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js')),
      },
      threeImageBitmapLoader: {
        version: '0.184.0',
        path: 'node_modules/three/src/loaders/ImageBitmapLoader.js',
        sha256: sha256(resolve(repository, 'node_modules/three/src/loaders/ImageBitmapLoader.js')),
      },
      needleContext: {
        version: '5.1.7',
        path: 'experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_context.ts',
        sha256: sha256(resolve(
          repository,
          'experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_context.ts',
        )),
      },
      blendlinkR3fAdapter: {
        path: 'packages/blendlink/src/reactThreeFiber.ts',
        sha256: sha256(resolve(repository, 'packages/blendlink/src/reactThreeFiber.ts')),
      },
      blendlinkThreeRuntime: {
        path: 'packages/blendlink/src/threeRuntime.ts',
        sha256: sha256(resolve(repository, 'packages/blendlink/src/threeRuntime.ts')),
      },
      fixtureGenerator: {
        path: 'experiments/r3f-atomic-presentation-prototype/fixture-assets.mjs',
        sha256: sha256(resolve(root, 'fixture-assets.mjs')),
      },
    },
    externalAssetFixture: {
      glb: {
        path: '/external-assets/atomic-scene.glb',
        bytes: externalGlb.length,
        sha256: createHash('sha256').update(externalGlb).digest('hex'),
      },
      companionPng: {
        path: '/external-assets/atomic-green.png',
        bytes: externalPng.length,
        sha256: createHash('sha256').update(externalPng).digest('hex'),
      },
      requests: fixtureRequests.map((request) => ({
        ...request,
        durationMs: request.completedAt - request.startedAt,
      })),
    },
    pageErrors,
    consoleErrors,
    evidence,
    assertions: {
      realReactDomStrictModeEffectReplayObserved: true,
      r3fSceneEffectReplayObserved: Object.values(evidence.cells).every(
        (cell) => cell.effectSetups >= 2 && cell.effectCleanups >= 1,
      ),
      realR3fPriorityOneGateExercised: true,
      realPriorityTwoCompetingRendererExercised: true,
      liveMutationLeakedPartialPixels: true,
      hiddenRootLeakedSceneGlobalPixels: true,
      detachedPreparePreservedBaselineUntilAtomicCommit: true,
      productionAdapterSourceExecuted: true,
      productionAdapterPreservedBaselineUntilLayoutCommit: true,
      productionMarkedAdapterPreparedOffLiveWorld: true,
      productionMarkedAdapterReceivedCommittedSceneAndCamera: true,
      realNetworkGlbAndCompanionPngFetched: true,
      externalPngDecodedBeforeAdapterPreparation: true,
      externalTextureUploadInitializationRanBeforeCommit: true,
      externalAssetPreparationPreservedBaselineUntilLayoutCommit: true,
      externalAssetFirstPresentedSamplesUsedDecodedTexture: true,
    },
    limits: [
      'The first three cells are explicit design controls. The fourth and fifth import and execute the current Blendlink source createR3FCompiledScene path, but remain local browser fixtures rather than published-application smoke tests.',
      'Chromium with ANGLE SwiftShader only; no Firefox, WebKit, mobile, XR, WebGPU, or physical-GPU evidence.',
      'The synthetic production cell remains a controlled lifecycle differential. The external-asset cell adds a generated real GLB, a separately requested PNG, Chromium ImageBitmap decode, explicit WebGLRenderer.initTexture, and a later visible textured frame.',
      'The fixture does not exercise KTX2/Basis workers or transcoding, Meshopt/Draco decoding, HDR/EXR environment preparation, reflection capture, postprocessing rebind, CORS, CSP, CDN, or deployment base paths.',
      'WebGLRenderer.initTexture initiates upload work but is not a GPU-completion fence. compileAsync is a shader-stall barrier, not proof that all texture work completed without a first-frame stall.',
    ],
  }
  writeFileSync(resolve(root, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    'BLENDLINK_R3F_ATOMIC_PRESENTATION_PROTOTYPE_PASSED ' +
      `livePartial=${live.counts['partial-red']} ` +
      `hiddenPartial=${hidden.counts['partial-red']} ` +
      `detachedPartial=${detached.counts['partial-red']} ` +
      `productionPartial=${production.counts['partial-red']} ` +
      `externalPartial=${external.counts['partial-red']} ` +
      `externalFetches=${glbRequests.length + pngRequests.length} ` +
      `externalTextureInit=${external.externalTextureInitCalls} ` +
      `reactDomStrictSetups=${evidence.strictMode.reactDomEffectSetups} ` +
      `r3fEffectSetups=${detached.effectSetups}`,
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
