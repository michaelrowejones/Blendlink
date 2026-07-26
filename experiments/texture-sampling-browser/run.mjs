import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const here = import.meta.dirname
const repository = path.resolve(here, '..', '..')
const output = path.resolve(here, 'output')
const playwrightCandidates = [
  process.env.BLENDLINK_PLAYWRIGHT_MODULE,
  path.resolve(repository, 'node_modules', 'playwright', 'index.mjs'),
  path.resolve(repository, '..', 'MichaelRoweJonesSite', 'node_modules', 'playwright', 'index.mjs'),
].filter(Boolean)
const playwrightModule = playwrightCandidates.find((candidate) => existsSync(candidate))
assert(playwrightModule, 'Playwright is missing from Blendlink and the dogfood site')
const { chromium } = await import(pathToFileURL(playwrightModule).href)
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const executablePath = browserCandidates.find((candidate) => existsSync(candidate))

const server = await createServer({
  root: here,
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
let page
try {
  await server.listen()
  const address = server.httpServer.address()
  assert(address && typeof address !== 'string', 'Vite did not expose a port')
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? {
      executablePath,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    } : {}),
  })
  page = await browser.newPage({
    viewport: { width: 128, height: 128 },
    deviceScaleFactor: 1,
  })
  const pageErrors = []
  const consoleErrors = []
  const failedRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText ?? 'unknown',
    })
  })
  await page.goto(`http://127.0.0.1:${address.port}/`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  })
  await page.waitForFunction(
    () => window.__blendlinkTextureSamplingEvidence !== undefined,
    undefined,
    { timeout: 120_000 },
  )
  const evidence = await page.evaluate(
    () => window.__blendlinkTextureSamplingEvidence,
  )
  assert.equal(
    evidence.ready,
    true,
    `browser texture-sampling gate failed: ${evidence.error ?? JSON.stringify(evidence)}`,
  )
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`)
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('; ')}`)
  assert.deepEqual(failedRequests, [], `failed requests: ${JSON.stringify(failedRequests)}`)
  const maximum = evidence.rendererMaxAnisotropy
  const balanced = Math.min(4, maximum)
  assert(maximum >= 1, `invalid renderer maximum anisotropy: ${maximum}`)
  assert.deepEqual(evidence.authored, { property: 1, native: 1 })
  assert.equal(evidence.balancedApplied.property, balanced)
  assert.equal(evidence.balancedApplied.native, balanced)
  assert.equal(evidence.qualityApplied.property, maximum)
  assert.equal(evidence.qualityApplied.native, maximum)
  assert.deepEqual(evidence.balancedResumed, {
    property: balanced,
    native: balanced,
  })
  assert.deepEqual(evidence.authoredRestored, { property: 1, native: 1 })

  mkdirSync(output, { recursive: true })
  const sourceFiles = [
    path.resolve(repository, 'packages/blendlink/src/threeTextureSampling.ts'),
    path.resolve(here, 'main.ts'),
    path.resolve(here, 'run.mjs'),
  ]
  const identity = Object.fromEntries(sourceFiles.map((file) => [
    path.relative(repository, file).replaceAll('\\', '/'),
    createHash('sha256').update(readFileSync(file)).digest('hex'),
  ]))
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    browser: await browser.version(),
    evidence,
    assertions: {
      actualWebglSamplerStartsAuthored: true,
      numericFourMatchesNeedleWhenSupported: true,
      rendererMaximumReachesActualWebglSampler: true,
      sharedLeaseFallsBackToRemainingMaximum: true,
      lastLeaseRestoresAuthoredSampler: true,
    },
    sourceSha256: identity,
    limitations: [
      'This validates Three r184 property-to-WebGL sampler transport and Blendlink lease behavior.',
      'SwiftShader is not physical-GPU performance evidence.',
      'DOGWALK is the separate scene-level visual differential; this fixture does not quantify image quality.',
    ],
  }
  writeFileSync(
    path.resolve(output, 'evidence.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
    `BLENDLINK_TEXTURE_SAMPLING_BROWSER_PASSED max=${maximum} balanced=${balanced}`,
  )
} finally {
  if (page) await page.close()
  if (browser) await browser.close()
  await server.close()
}
