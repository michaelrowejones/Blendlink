// WGPU-PP-001 — measure the pinned post-processing stack against
// WebGPURenderer before any TSL port is planned (ADR 0006's first
// milestone).  Two separate questions, never conflated:
//   1. Do the exact pinned postprocessing@6.39.3 + n8ao@1.10.2 run at all
//      against three's WebGPURenderer?
//   2. Where both backends render, are the pixels identical?
// The sentinel means the MEASUREMENT completed; the answers live in
// output/evidence.json and the README table.
//
//   node experiments/wgpu-postprocessing-parity/run.mjs
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const experimentDir = resolve(import.meta.dirname)
const repositoryRoot = resolve(experimentDir, '..', '..')
const outputDir = join(experimentDir, 'output')
mkdirSync(outputDir, { recursive: true })

const require = createRequire(import.meta.url)

async function importPlaywright() {
  const candidates = [
    process.env.BLENDLINK_PLAYWRIGHT_MODULE,
    join(repositoryRoot, 'node_modules', 'playwright', 'index.mjs'),
    join(
      repositoryRoot, '..', 'MichaelRoweJonesSite',
      'node_modules', 'playwright', 'index.mjs',
    ),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return await import(pathToFileURL(candidate).href)
    }
  }
  throw new Error(`Playwright is unavailable; looked at: ${candidates.join(', ')}`)
}

function pinnedVersion(name) {
  return JSON.parse(readFileSync(
    join(repositoryRoot, 'node_modules', name, 'package.json'), 'utf8',
  )).version
}

const pins = {
  three: pinnedVersion('three'),
  postprocessing: pinnedVersion('postprocessing'),
  n8ao: pinnedVersion('n8ao'),
}
if (pins.postprocessing !== '6.39.3' || pins.n8ao !== '1.10.2'
  || pins.three !== '0.184.0') {
  throw new Error(
    `installed pins moved: ${JSON.stringify(pins)}; the WGPU-PP-001 answer `
    + 'is only valid for postprocessing@6.39.3 + n8ao@1.10.2 + three@0.184.0',
  )
}

const { createServer } = await import(pathToFileURL(join(
  repositoryRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js',
)).href)
const server = await createServer({
  configFile: false,
  root: experimentDir,
  logLevel: 'warn',
  optimizeDeps: { noDiscovery: true },
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
    fs: { allow: [repositoryRoot] },
  },
})
await server.listen()
const address = server.httpServer.address()
const baseUrl = `http://127.0.0.1:${address.port}/`

const { chromium } = await importPlaywright()
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const executablePath = executableCandidates.find((item) => existsSync(item))
if (!executablePath) {
  throw new Error(
    `no Chromium executable found; looked at: ${executableCandidates.join(', ')}`,
  )
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--disable-dawn-features=disallow_unsafe_apis',
  ],
})
const page = await browser.newPage({ viewport: { width: 640, height: 640 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text())
})

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  const environment = await page.evaluate(() => window.__wgpuPpInit())
  await page.waitForFunction(() => window.__wgpuPpReady())
  const effectIds = await page.evaluate(() => window.__wgpuPpEffectIds())

  const results = {}
  for (const backend of ['webgl', 'webgpu']) {
    results[backend] = {
      plain: await page.evaluate(
        (id) => window.__wgpuPpPlain(id), backend,
      ),
      effects: {},
    }
    for (const effectId of effectIds) {
      results[backend].effects[effectId] = await page.evaluate(
        ({ backendId, id }) => window.__wgpuPpEffect(backendId, id),
        { backendId: backend, id: effectId },
      )
    }
  }

  const comparisons = {}
  for (const effectId of effectIds) {
    const webgl = results.webgl.effects[effectId]
    const webgpu = results.webgpu.effects[effectId]
    if (webgl?.ok && webgpu?.ok) {
      comparisons[effectId] = {
        bothRendered: true,
        identicalSha: webgl.pixels.sha256 === webgpu.pixels.sha256,
        webglMeanLuma: webgl.pixels.meanLuma,
        webgpuMeanLuma: webgpu.pixels.meanLuma,
        meanLumaDelta: Math.abs(
          webgl.pixels.meanLuma - webgpu.pixels.meanLuma,
        ),
      }
    } else {
      comparisons[effectId] = {
        bothRendered: false,
        webglOk: Boolean(webgl?.ok),
        webgpuOk: Boolean(webgpu?.ok),
        webgpuFailurePhase: webgpu?.phase ?? null,
        webgpuError: webgpu?.error ?? null,
        webglError: webgl?.error ?? null,
      }
    }
  }

  const effectResults = Object.values(results.webgpu.effects)
  const summary = {
    pins,
    webgpuBackendReal: Boolean(
      environment.backends?.webgpu?.isWebGPUBackend,
    ),
    webgpuPlainSceneRenders: Boolean(results.webgpu.plain?.ok),
    question1RunsAtAll: {
      effectsAttempted: effectIds.length,
      effectsRunning: effectResults.filter((item) => item.ok).length,
      failurePhases: [...new Set(
        effectResults.filter((item) => !item.ok).map((item) => item.phase),
      )].sort(),
    },
    question2IdenticalPixels: {
      comparablePairs: Object.values(comparisons)
        .filter((item) => item.bothRendered).length,
      identicalPairs: Object.values(comparisons)
        .filter((item) => item.bothRendered && item.identicalSha).length,
    },
  }

  const evidence = {
    experiment: 'wgpu-postprocessing-parity',
    ledgerRow: 'WGPU-PP-001',
    command: 'node experiments/wgpu-postprocessing-parity/run.mjs',
    executablePath,
    environment,
    results,
    comparisons,
    summary,
    pageErrorCount: pageErrors.length,
    pageErrorSample: pageErrors.slice(0, 12),
    limits: [
      'One deterministic scene per backend; production Blendlink scenes are broader.',
      'Same-machine same-run pixel comparison; cross-device identity is not claimed.',
      'A WebGL2-fallback WebGPURenderer (webgpuBackendReal=false) measures the fallback path, not native WebGPU.',
    ],
  }
  writeFileSync(
    join(outputDir, 'evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )

  console.log(
    'BLENDLINK_WGPU_PP_MEASURED '
    + `webgpuBackend=${summary.webgpuBackendReal ? 'native' : 'fallback-or-absent'} `
    + `plainScene=${summary.webgpuPlainSceneRenders} `
    + `effectsRunning=${summary.question1RunsAtAll.effectsRunning}/`
    + `${summary.question1RunsAtAll.effectsAttempted} `
    + `identicalPairs=${summary.question2IdenticalPixels.identicalPairs}/`
    + `${summary.question2IdenticalPixels.comparablePairs}`,
  )
} finally {
  await browser.close()
  await server.close()
}
