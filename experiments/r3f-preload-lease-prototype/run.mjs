import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
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

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const server = await createServer({
  root,
  cacheDir: resolve(repository, 'node_modules/.vite-preload-lease-prototype'),
  logLevel: 'error',
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client'] },
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
  if (!address || typeof address === 'string') {
    throw new Error('Vite did not expose its test port')
  }
  browser = await chromium.launch({
    headless: true,
    ...(systemChromium ? {
      executablePath: systemChromium,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    } : {}),
  })
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const url = `http://127.0.0.1:${address.port}/`
  await page.goto(url)
  await page.waitForFunction(
    () => window.__blendlinkLeaseEvidence?.ready !== undefined,
    null,
    { timeout: 15_000 },
  )
  const evidence = await page.evaluate(() => window.__blendlinkLeaseEvidence)
  assert(evidence.ready === true, evidence.error ?? 'prototype did not finish')
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('; ')}`)

  const unsafe = evidence.unsafeRenderAcquisition
  assert(unsafe.starts === 1, `unsafe render started ${unsafe.starts} attempts`)
  assert(unsafe.resolves === 1, `unsafe render resolved ${unsafe.resolves} attempts`)
  assert(unsafe.releaseObserved === false, 'abandoned render unexpectedly registered cleanup')
  assert(unsafe.activeEntries === 1, 'abandoned render did not retain its unowned cache entry')

  const strict = evidence.committedStrictLease
  assert(strict.effectSetups === 2, `Strict Mode ran ${strict.effectSetups} Effect setups`)
  assert(strict.effectCleanups === 2, `Strict Mode ran ${strict.effectCleanups} Effect cleanups`)
  assert(strict.starts === 1, `Strict Mode started ${strict.starts} preparation attempts`)
  assert(strict.displayedReady, 'committed Strict Mode owner did not reveal Ready content')
  assert(strict.activations === 1, `Strict Mode activated ${strict.activations} times`)
  assert(strict.cancels === 1, `final unmount canceled ${strict.cancels} attempts`)
  assert(strict.disposes === 1, `final unmount disposed ${strict.disposes} candidates`)
  assert(strict.activeEntries === 0, 'Strict Mode lease remained registered after final unmount')
  assert(
    strict.progress.includes('loading')
      && strict.progress.includes('preparing')
      && strict.progress.includes('prepared'),
    `progress fan-out was incomplete: ${strict.progress.join(', ')}`,
  )

  const pending = evidence.pendingRelease
  assert(pending.starts === 1, `pending case started ${pending.starts} attempts`)
  assert(pending.cancels === 1, `pending release canceled ${pending.cancels} attempts`)
  assert(pending.resolves === 1, 'non-cooperative pending attempt did not settle late')
  assert(pending.disposes === 1, `late candidate was disposed ${pending.disposes} times`)
  assert(pending.activations === 0 && pending.showedReady === false, 'stale attempt became visible')
  assert(pending.activeEntries === 0, 'released pending entry remained registered')

  const retry = evidence.exclusivityAndRetry
  assert(
    retry.exclusivityError.includes('exclusive'),
    `different owner was not rejected clearly: ${retry.exclusivityError}`,
  )
  assert(retry.retryAttempt > retry.firstAttempt, 'retry did not receive a new attempt identity')
  assert(retry.starts === 2, `retry path started ${retry.starts} attempts`)
  assert(retry.cancels === 2, `retry path canceled ${retry.cancels} attempts`)
  assert(retry.disposes === 2, `retry path disposed ${retry.disposes} late candidates`)
  assert(retry.activeEntries === 0, 'retry entries remained registered')

  await page.screenshot({
    path: resolve(root, 'r3f-preload-lease.png'),
    fullPage: true,
  })
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    browser: await browser.version(),
    url,
    installedSources: {
      react: {
        version: '19.0.0',
        path: 'node_modules/react/cjs/react.development.js',
        sha256: sha256(resolve(repository, 'node_modules/react/cjs/react.development.js')),
      },
      reactDom: {
        version: '19.0.0',
        path: 'node_modules/react-dom/cjs/react-dom-client.development.js',
        sha256: sha256(resolve(
          repository,
          'node_modules/react-dom/cjs/react-dom-client.development.js',
        )),
      },
      reactThreeFiber: {
        version: '9.6.1',
        path: 'node_modules/@react-three/fiber/dist/events-b389eeca.esm.js',
        sha256: sha256(resolve(
          repository,
          'node_modules/@react-three/fiber/dist/events-b389eeca.esm.js',
        )),
      },
      suspendReact: {
        version: '0.1.3',
        path: 'node_modules/suspend-react/index.js',
        sha256: sha256(resolve(repository, 'node_modules/suspend-react/index.js')),
      },
      three: {
        version: '0.184.0',
        path: 'node_modules/three/src/loaders/LoadingManager.js',
        sha256: sha256(resolve(
          repository,
          'node_modules/three/src/loaders/LoadingManager.js',
        )),
      },
      needleAddressables: {
        version: '5.1.7',
        path: 'experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_addressables.ts',
        sha256: sha256(resolve(
          repository,
          'experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_addressables.ts',
        )),
      },
    },
    pageErrors,
    consoleErrors,
    evidence,
    assertions: {
      renderTimeAcquisitionHasNoDeterministicAbandonmentCleanup: true,
      committedOwnerSurvivesStrictEffectReplayWithOneAttempt: true,
      finalReleaseCancelsAndDisposesExactlyOnce: true,
      lateNonCooperativeResultCannotActivateAndIsDisposed: true,
      mutableCandidateIsExclusiveAcrossLogicalOwners: true,
      retryGetsMonotonicAttemptIdentity: true,
    },
    limits: [
      'The candidate is a controlled asynchronous fake, not a GLB/KTX/HDR/EXR load or a WebGLRenderer-bound preparation.',
      'The prototype validates React ownership and registry transitions only. Three LoadingManager, decoder-worker, renderer, context-loss, and GPU behavior remain covered by their own focused gates.',
      'The one-microtask Strict Mode handoff is observed in React/ReactDOM 19.0.0 Chromium only and needs a production R3F regression before shipping.',
      'The unsafe case intentionally leaves one entry alive to prove that Client React exposes no deterministic cleanup for a render that suspended before commit.',
    ],
  }
  writeFileSync(resolve(root, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    'BLENDLINK_R3F_PRELOAD_LEASE_PROTOTYPE_PASSED ' +
      `unsafeEntries=${unsafe.activeEntries} ` +
      `strictStarts=${strict.starts} strictSetups=${strict.effectSetups} ` +
      `lateDisposes=${pending.disposes} retries=${retry.starts}`,
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
