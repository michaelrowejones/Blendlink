import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const artifacts = resolve(repository, 'artifacts/contact-shadows-differential-browser-2026')
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
const executablePath = chromiumCandidates.find((candidate) => existsSync(candidate))
const localDracoDecoder = readFileSync(resolve(
  repository,
  'experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js',
))
const localBasisTranscoder = readFileSync(resolve(
  repository,
  'experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/libs/basis/basis_transcoder.js',
))
const localBasisWasm = readFileSync(resolve(
  repository,
  'experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm',
))

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

mkdirSync(artifacts, { recursive: true })
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
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a port')
  const url = `http://127.0.0.1:${address.port}/`
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? {
      executablePath,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    } : {}),
  })
  const page = await browser.newPage({
    viewport: { width: 1240, height: 1800 },
    deviceScaleFactor: 1,
  })
  // Constructing Needle's real external Context creates its application menu,
  // which requests two UI fonts unrelated to Contact Shadows. Fulfil those
  // stylesheet requests locally so the evidence run remains deterministic and
  // does not need network access.
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.route('https://www.gstatic.com/draco/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: localDracoDecoder,
    }))
  await page.route('https://cdn.needle.tools/**/basis_transcoder.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: localBasisTranscoder,
    }))
  await page.route('https://cdn.needle.tools/**/basis_transcoder.wasm', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/wasm',
      body: localBasisWasm,
    }))
  const pageErrors = []
  const consoleErrors = []
  const failedRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({ text: message.text(), location: message.location() })
    }
  })
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText ?? 'unknown',
    })
  })
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.waitForFunction(
    () => window.__contactShadowEvidence?.ready === true,
    undefined,
    { timeout: 120_000 },
  )
  const evidence = await page.evaluate(() => window.__contactShadowEvidence)
  assert(evidence, 'Browser fixture did not publish evidence')
  assert(evidence.errors.length === 0, `Fixture errors: ${evidence.errors.join('; ')}`)
  assert(
    pageErrors.length === 0,
    `Page errors: ${JSON.stringify({ pageErrors, failedRequests, consoleErrors })}`,
  )
  assert(consoleErrors.length === 0, `Console errors: ${JSON.stringify({ consoleErrors, failedRequests })}`)
  const { needle, blendlink, rawAlphaComparison } = evidence.matched

  assert(needle.externalContext?.constructor === 'Context', 'Needle did not run in its real Context')
  assert(needle.externalContext?.isManagedExternally === true, 'Needle Context did not accept external ownership')
  assert(needle.externalContext?.rendererIdentity, 'Needle Context replaced the external renderer')
  assert(needle.externalContext?.sceneIdentity, 'Needle Context replaced the external Scene')
  assert(needle.externalContext?.cameraIdentity, 'Needle Context replaced the external camera')
  assert(needle.passCount === 5, `Needle pass count was ${needle.passCount}, expected 5`)
  assert(blendlink.passCount === 5, `Blendlink pass count was ${blendlink.passCount}, expected 5`)
  assert(needle.target.depthBuffer === true, 'Needle target unexpectedly omitted its default depth attachment')
  assert(blendlink.target.depthBuffer === false, 'Blendlink target allocated an unused depth attachment')
  assert(blendlink.target.stencilBuffer === false, 'Blendlink target allocated an unused stencil attachment')
  assert(blendlink.scheduling.firstFrameAuxiliaryRenders === 5, 'Blendlink static first frame was not five passes')
  assert(blendlink.scheduling.laterStaticAuxiliaryRenders === 0, 'Blendlink static scene did not settle to zero')
  assert(
    blendlink.scheduling.continuousAuxiliaryRenders.every((count) => count === 5),
    `Blendlink continuous pass counts drifted: ${blendlink.scheduling.continuousAuxiliaryRenders}`,
  )
  assert(
    needle.scheduling.needleDefaultAuxiliaryRenders.every((count) => count === 5),
    `Needle default pass counts drifted: ${needle.scheduling.needleDefaultAuxiliaryRenders}`,
  )
  assert(needle.mask.nonzeroAlpha > 100, 'Needle raw mask was empty')
  assert(blendlink.mask.nonzeroAlpha > 100, 'Blendlink raw mask was empty')
  assert(rawAlphaComparison.pearson > 0.95, `Raw masks lost structural agreement: ${JSON.stringify(rawAlphaComparison)}`)

  const layers = evidence.layers
  assert(layers.needle.cameraLayerMask === 64, 'Needle layer camera fixture drifted')
  assert(layers.blendlink.cameraLayerMask === 64, 'Blendlink layer camera fixture drifted')
  assert(layers.needle.helperPlaneLayerMask === 4, 'Pinned Needle helper plane no longer uses layer 2')
  assert(layers.blendlink.helperPlaneLayerMask === 64, 'Blendlink helper did not inherit the app camera mask')
  assert(
    layers.blendlink.shadowDarkenedPixels > layers.needle.shadowDarkenedPixels + 50,
    `Non-layer-0 visibility improvement was not measurable: ${JSON.stringify(layers)}`,
  )

  const exclusions = evidence.exclusions
  assert(
    exclusions.blendlink.regions.center > exclusions.blendlink.regions.left * 2,
    `Blendlink transparent exclusion was not measurable: ${JSON.stringify(exclusions.blendlink.regions)}`,
  )
  assert(
    exclusions.blendlink.regions.center > exclusions.blendlink.regions.right * 2,
    `Blendlink allowOverride=false exclusion was not measurable: ${JSON.stringify(exclusions.blendlink.regions)}`,
  )

  await page.screenshot({
    path: resolve(artifacts, 'contact-shadows-differential-grid.png'),
    fullPage: true,
  })
  for (const id of [
    'needle-composite',
    'blendlink-composite',
    'needle-raw',
    'blendlink-raw',
    'needle-layer',
    'blendlink-layer',
    'needle-exclusion',
    'blendlink-exclusion',
  ]) {
    await page.locator(`#${id}`).screenshot({ path: resolve(artifacts, `${id}.png`) })
  }

  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    url,
    browser: await browser.version(),
    source: {
      needleEngineVersion: JSON.parse(readFileSync(resolve(
        repository,
        'experiments/needle-spike/node_modules/@needle-tools/engine/package.json',
      ))).version,
      needleThreeVersion: JSON.parse(readFileSync(resolve(
        repository,
        'experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/package.json',
      ))).version,
      blendlinkVersion: JSON.parse(readFileSync(resolve(
        repository,
        'packages/blendlink/package.json',
      ))).version,
      blendlinkThreeVersion: JSON.parse(readFileSync(resolve(
        repository,
        'node_modules/three/package.json',
      ))).version,
      needleContactShadowsSha256: sha256(resolve(
        repository,
        'experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/ContactShadows.ts',
      )),
      needleContactShadowsRuntimeSha256: sha256(resolve(
        repository,
        'experiments/needle-spike/node_modules/@needle-tools/engine/lib/engine-components/ContactShadows.js',
      )),
      blendlinkContactShadowsSha256: sha256(resolve(
        repository,
        'packages/blendlink/dist/threeContactShadows.js',
      )),
    },
    pageErrors,
    consoleErrors,
    failedRequests,
    evidence: {
      ...evidence,
      dispose: undefined,
    },
    assertions: {
      actualNeedleExternalContext: true,
      fivePassTopologyBoth: true,
      needleDefaultFivePerFrame: true,
      rawMaskStructuralAgreement: true,
      blendlinkStaticFiveThenZero: true,
      blendlinkContinuousFivePerRefresh: true,
      blendlinkDepthlessTargets: true,
      blendlinkNonLayerZeroVisibility: true,
      blendlinkTransparentExclusion: true,
      blendlinkAllowOverrideFalseExclusion: true,
    },
    limits: [
      'The fixture invokes the actual pinned ContactShadows class through its lifecycle in an actual externally owned Needle Context; it does not boot the complete Needle web component or generated glTF loader.',
      'Needle Context construction imports decoder infrastructure even though this fixture loads no assets. The runner serves pinned local Three r169 Draco/Basis bytes and empty UI-font CSS in place of unrelated CDN requests so the comparison stays offline.',
      'Needle uses its bundled Three fork 0.169.19 while Blendlink uses Three 0.184.0. This run is byte-identical, but the assertion threshold is structural so a different conforming GPU is not rejected for harmless numeric drift.',
      'Chromium with ANGLE/SwiftShader is deterministic software-renderer evidence, not physical-GPU timing evidence.',
      'Renderer info draw calls are observed GL submission counts, but this fixture does not use EXT_disjoint_timer_query_webgl2 and makes no GPU-speed claim.',
      'The exclusion cells establish Blendlink behavior. They record Needle output without asserting that Needle excludes allowOverride=false materials.',
      'The fixture executes local production build output, not a freshly extracted npm tarball.',
    ],
  }
  writeFileSync(resolve(artifacts, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  await page.evaluate(() => window.__contactShadowEvidence?.dispose())
  console.log(
    `BLENDLINK_CONTACT_SHADOWS_DIFFERENTIAL_PASSED ` +
    `needleDraws=${needle.drawCalls} blendlinkDraws=${blendlink.drawCalls} ` +
    `maskPearson=${rawAlphaComparison.pearson.toFixed(6)} staticLater=0`,
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
