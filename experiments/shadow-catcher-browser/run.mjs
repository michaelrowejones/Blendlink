import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const artifactDirectory = resolve(repository, 'artifacts/shadow-catcher-browser-2026')
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
  const page = await browser.newPage({ viewport: { width: 1120, height: 980 }, deviceScaleFactor: 1 })
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__shadowCatcherEvidence?.ready === true)
  const evidence = await page.evaluate(() => window.__shadowCatcherEvidence)
  assert(evidence, 'browser fixture did not publish evidence')
  assert(evidence.errors.length === 0, `browser fixture errors: ${evidence.errors.join('; ')}`)
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('; ')}`)

  const { mask, descendants, occluder, additive } = evidence.cells
  for (const [name, cell] of Object.entries(evidence.cells)) {
    assert(cell.components === 1, `${name} did not install exactly one component`)
    assert(cell.requiresContinuousFrames === false, `${name} incorrectly kept demand rendering active`)
    assert(
      JSON.stringify(cell.layerMasksBefore) === JSON.stringify(cell.layerMasksInstalled),
      `${name} changed application-owned raycast layers`,
    )
    assert(cell.transparent > 10_000, `${name} transparent Canvas had too little transparent area`)
  }
  assert(mask.materialTypes.every((type) => type === 'ShadowMaterial'), 'Mask did not install ShadowMaterial')
  assert(
    mask.partialAlpha > 80,
    `Mask produced no measurable partial-alpha shadow: ${JSON.stringify(mask)}`,
  )
  assert(
    descendants.materialTypes.every((type) => type === 'ShadowMaterial'),
    'Descendant group did not install every receiver',
  )
  assert(
    descendants.partialAlpha > 100,
    `Descendant group produced no measurable shadows: ${JSON.stringify(descendants)}`,
  )
  assert(occluder.materialTypes.length === 1, 'Occluder receiver count drifted')
  assert(occluder.center[3] === 0, `Occluder center wrote color/alpha: ${occluder.center}`)
  assert(occluder.left[3] === 255, `Occluder control pixel was not visible: ${occluder.left}`)
  assert(additive.nonzeroRgb > 10_000, 'Additive default produced no visible direct-light pixels')
  assert(additive.center[3] > 0, 'Additive default produced zero alpha at its lit center')

  await page.screenshot({
    path: resolve(artifactDirectory, 'shadow-catcher-browser-grid.png'),
    fullPage: true,
  })
  for (const name of ['mask', 'descendants', 'occluder', 'additive']) {
    await page.locator(`#${name}`).screenshot({
      path: resolve(artifactDirectory, `${name}.png`),
    })
  }
  const disposed = await page.evaluate(() => window.__shadowCatcherEvidence?.dispose())
  assert(disposed, 'browser fixture did not return disposal evidence')
  for (const [name, result] of Object.entries(disposed)) {
    assert(result.materialsRestored, `${name} did not restore authored material identity`)
  }

  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    url,
    browser: await browser.version(),
    threeVersion: JSON.parse(readFileSync(resolve(repository, 'node_modules/three/package.json'))).version,
    blendlinkVersion: JSON.parse(
      readFileSync(resolve(repository, 'packages/blendlink/package.json')),
    ).version,
    source: {
      threeRuntimeSha256: sha256(resolve(repository, 'packages/blendlink/dist/threeRuntime.js')),
      shadowCatcherSha256: sha256(resolve(repository, 'packages/blendlink/dist/threeShadowCatcher.js')),
      needleShadowCatcherSha256: sha256(resolve(
        repository,
        'experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/ShadowCatcher.ts',
      )),
    },
    pageErrors,
    consoleErrors,
    cells: evidence.cells,
    disposed,
    assertions: {
      maskPartialAlpha: true,
      descendantGroup: true,
      applicationLayersPreserved: true,
      occluderDepthWithoutColor: true,
      additiveVisibleAtDefaults: true,
      staticDemandPolicy: true,
      materialIdentityRestored: true,
    },
    limits: [
      'Local production module build, not a freshly extracted npm tarball.',
      'Chromium/ANGLE evidence only; Firefox, WebKit, mobile, WebGPU/TSL, and physical GPU timing remain pending.',
      'Pinned Needle source identity is recorded, but this run does not execute Needle runtime pixels side by side.',
    ],
  }
  writeFileSync(
    resolve(artifactDirectory, 'evidence.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
    `BLENDLINK_SHADOW_CATCHER_BROWSER_PASSED ` +
      `maskPartial=${mask.partialAlpha} descendantsPartial=${descendants.partialAlpha} ` +
      `additiveRgb=${additive.nonzeroRgb}`,
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
