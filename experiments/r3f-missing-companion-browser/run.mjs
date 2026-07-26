import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'
import { createExternalTextureGlb } from '../r3f-atomic-presentation-prototype/fixture-assets.mjs'

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
const glb = createExternalTextureGlb('missing-base-color.png')
const requests = []

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function fixturePlugin() {
  return {
    name: 'blendlink-missing-companion-fixture',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (!url.pathname.startsWith('/fixtures/')) {
          next()
          return
        }
        const record = {
          method: request.method ?? 'GET',
          path: url.pathname,
          status: url.pathname.endsWith('.glb') ? 200 : 404,
        }
        requests.push(record)
        if (record.status === 200) {
          response.statusCode = 200
          response.setHeader('Content-Type', 'model/gltf-binary')
          response.setHeader('Content-Length', String(glb.length))
          response.end(glb)
          return
        }
        response.statusCode = 404
        response.setHeader('Content-Type', 'text/plain')
        response.end('intentional missing companion')
      })
    },
  }
}

const server = await createServer({
  root,
  logLevel: 'error',
  plugins: [fixturePlugin()],
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
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a port')
  browser = await chromium.launch({
    headless: true,
    ...(systemChromium ? {
      executablePath: systemChromium,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    } : {}),
  })
  const page = await browser.newPage({
    viewport: { width: 900, height: 560 },
    deviceScaleFactor: 1,
  })
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const url = `http://127.0.0.1:${address.port}/`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => window.__blendlinkMissingCompanionEvidence?.settled === true,
    null,
    { timeout: 20_000 },
  )
  const evidence = await page.evaluate(() => window.__blendlinkMissingCompanionEvidence)
  assert(evidence.readyCount === 0, `fixture published Ready ${evidence.readyCount} times`)
  assert(evidence.failedCount === 1, `fixture published Failed ${evidence.failedCount} times`)
  assert(
    evidence.failureName === 'ThreeCompiledSceneDependencyError',
    `unexpected failure type ${evidence.failureName}`,
  )
  assert(
    /missing-base-color\.png/i.test(evidence.failureMessage ?? ''),
    `failure did not name the missing file: ${evidence.failureMessage}`,
  )
  assert(
    /base path[\s\S]*CDN[\s\S]*CORS/i.test(evidence.failureMessage ?? ''),
    `failure omitted deployment guidance: ${evidence.failureMessage}`,
  )
  assert(
    !evidence.phases.includes('ready'),
    `phase history incorrectly contained Ready: ${evidence.phases.join(' > ')}`,
  )
  assert(
    evidence.committedFixtureNodes === 0,
    `fixture committed ${evidence.committedFixtureNodes} incomplete scene nodes`,
  )
  assert(
    evidence.boundaryErrors.length === 1,
    `Error Boundary observed ${evidence.boundaryErrors.length} errors`,
  )
  // React's development build reports a render error to the global error
  // channel before the nearest Error Boundary commits its fallback. Require
  // that every such report is the same intentional dependency failure.
  assert(
    pageErrors.length >= 1
      && pageErrors.every((message) =>
        /Three's GLTF loader|missing-base-color\.png/i.test(message)),
    `unexpected page errors: ${pageErrors.join('; ')}`,
  )
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) =>
      !/ThreeCompiledSceneDependencyError|missing-base-color\.png/i.test(message)
      && !/^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/i
        .test(message),
  )
  assert(
    unexpectedConsoleErrors.length === 0,
    `unexpected console errors: ${unexpectedConsoleErrors.join('; ')}`,
  )
  assert(
    requests.some((request) =>
      request.path === '/fixtures/missing-companion.glb' && request.status === 200),
    'browser did not fetch the fixture GLB',
  )
  assert(
    requests.some((request) =>
      request.path === '/fixtures/missing-base-color.png' && request.status === 404),
    'browser did not observe the intentional companion 404',
  )

  const screenshot = resolve(root, 'missing-companion-browser.png')
  await page.screenshot({ path: screenshot, fullPage: true })
  const browserVersion = await browser.version()
  const output = {
    generatedAt: new Date().toISOString(),
    browserVersion,
    fixture: {
      glbBytes: glb.length,
      glbSha256: createHash('sha256').update(glb).digest('hex'),
      missingCompanion: '/fixtures/missing-base-color.png',
    },
    source: {
      reactThreeFiberSha256: sha256(resolve(repository, 'packages/blendlink/src/reactThreeFiber.ts')),
      threeRuntimeSha256: sha256(resolve(repository, 'packages/blendlink/src/threeRuntime.ts')),
      threeVersion: JSON.parse(
        readFileSync(resolve(repository, 'node_modules/three/package.json'), 'utf8'),
      ).version,
    },
    requests,
    evidence,
    pageErrors,
    consoleErrors,
    screenshot,
  }
  writeFileSync(resolve(root, 'evidence.json'), `${JSON.stringify(output, null, 2)}\n`)
  console.log(
    `Missing-companion browser gate passed: ${browserVersion}; ` +
      `phases=${evidence.phases.join('>')}; Ready=${evidence.readyCount}; ` +
      `Failed=${evidence.failedCount}; committed=${evidence.committedFixtureNodes}`,
  )
} finally {
  await browser?.close()
  await server.close()
}
