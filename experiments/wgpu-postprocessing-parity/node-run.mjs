// WGPU-NODE-001 — Phase 4 Track 0 fixture gate for the node-based
// post-processing pipeline.  Three questions, one per column family:
//   1. Does every node-pipeline cell construct AND render on native WebGPU?
//   2. Does the same cell construct AND render on the WebGL2 fallback
//      backend (forceWebGL) — the "no device-support reduction" premise?
//   3. Is each effect visibly active (pixels differ from the same backend's
//      render-pass-only baseline) where activity is expected?
// The pinned pmndrs WebGL stack renders beside them as the look-continuity
// control (mean-luma context only; the algorithms differ by design).
// Non-cells are NAMED: vignette/tilt-shift/kuwahara wait on Track B nodes.
//
//   node experiments/wgpu-postprocessing-parity/node-run.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const experimentDir = resolve(import.meta.dirname)
const repositoryRoot = resolve(experimentDir, '..', '..')
const outputDir = join(experimentDir, 'output')
mkdirSync(outputDir, { recursive: true })

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
  'n8ao-webgpu': pinnedVersion('n8ao-webgpu'),
  postprocessing: pinnedVersion('postprocessing'),
  n8ao: pinnedVersion('n8ao'),
}
if (pins.three !== '0.184.0' || pins['n8ao-webgpu'] !== '0.1.0') {
  throw new Error(
    `installed pins moved: ${JSON.stringify(pins)}; re-measure before `
    + 'trusting WGPU-NODE-001 on a different three or n8ao-webgpu',
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
  resolve: {
    alias: {
      // The WebGPU post service is intentionally not a package subpath (it
      // loads via the renderer-family branch); the service cells drive the
      // BUILT module so the harness measures exactly what ships.
      '@blendlink-dist': join(repositoryRoot, 'packages', 'blendlink', 'dist'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
    fs: { allow: [repositoryRoot] },
  },
})
await server.listen()
const address = server.httpServer.address()
const baseUrl = `http://127.0.0.1:${address.port}/node-index.html`

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

// Cells whose pixels must differ from the same backend's render-pass-only
// baseline.  tone-mapping/lut3d(neutral) are legitimately near-identity;
// the AA family differs only at edges, gated on render success alone.
const ACTIVE_EXPECTED = new Set([
  'bloom', 'selective-bloom', 'chromatic-aberration', 'pixelation',
  'outline', 'depth-of-field', 'custom-effect', 'n8ao',
  'vignette', 'tilt-shift', 'kuwahara', 'radial-chromatic-aberration',
  'geometry-pixelation',
])

let exitCode = 0
try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  const environment = await page.evaluate(() => window.__wgpuNodeInit())
  await page.waitForFunction(() => window.__wgpuNodeReady())
  const ids = await page.evaluate(() => window.__wgpuNodeIds())

  const overlap = ids.node.filter((id) => ids.pendingTrackB.includes(id))
  if (overlap.length > 0) {
    throw new Error(
      `ids listed both as node cells and Track B pending: ${overlap.join(', ')}`,
    )
  }

  const control = {}
  for (const effectId of ids.control) {
    control[effectId] = await page.evaluate(
      (id) => window.__wgpuNodeControl(id), effectId,
    )
  }

  const node = { native: {}, fallback: {} }
  for (const backendId of ['native', 'fallback']) {
    for (const effectId of ids.node) {
      node[backendId][effectId] = await page.evaluate(
        ({ backend, id }) => window.__wgpuNodeEffect(backend, id),
        { backend: backendId, id: effectId },
      )
    }
  }

  const failures = []
  for (const backendId of ['native', 'fallback']) {
    const baseline = node[backendId]['render-pass-only']
    for (const effectId of ids.node) {
      const cell = node[backendId][effectId]
      if (!cell?.ok) {
        failures.push(
          `${backendId}/${effectId}: ${cell?.phase ?? 'missing'} — ${cell?.error ?? 'no result'}`,
        )
        continue
      }
      if (cell.pixels.nonFinitePixels > 0) {
        failures.push(
          `${backendId}/${effectId}: ${cell.pixels.nonFinitePixels} non-finite pixels`,
        )
      }
      if (cell.pixels.nonBackgroundPixels === 0) {
        failures.push(`${backendId}/${effectId}: rendered fully black`)
      }
      if (
        ACTIVE_EXPECTED.has(effectId) && baseline?.ok
        && cell.pixels.sha256 === baseline.pixels.sha256
      ) {
        failures.push(
          `${backendId}/${effectId}: pixels identical to render-pass-only — effect inactive`,
        )
      }
    }
  }

  // Production-service cells: the built ThreeWebgpuPostPipelineService
  // driven end-to-end on both backends.
  const serviceIds = await page.evaluate(() => window.__wgpuServiceCellIds())
  const service = { native: {}, fallback: {} }
  for (const backendId of ['native', 'fallback']) {
    for (const cellId of serviceIds) {
      service[backendId][cellId] = await page.evaluate(
        ({ backend, id }) => window.__wgpuServiceCell(backend, id),
        { backend: backendId, id: cellId },
      )
    }
  }
  for (const backendId of ['native', 'fallback']) {
    const baseline = service[backendId]['service-baseline']
    for (const cellId of serviceIds) {
      const cell = service[backendId][cellId]
      if (!cell?.ok) {
        failures.push(
          `${backendId}/${cellId}: ${cell?.phase ?? 'missing'} — ${cell?.error ?? 'no result'}`,
        )
        continue
      }
      if (cell.pixels.nonBackgroundPixels === 0) {
        failures.push(`${backendId}/${cellId}: rendered fully black`)
      }
      if (
        cellId !== 'service-baseline' && baseline?.ok
        && cell.pixels.sha256 === baseline.pixels.sha256
      ) {
        failures.push(`${backendId}/${cellId}: pixels identical to the no-effect service baseline`)
      }
    }
  }

  // Track C ground truth: the built tslMaterialRuntime over the real
  // compiled cube-diorama publication.
  const showcaseModels = join(
    repositoryRoot, 'showcases', 'cube-diorama', 'public', 'models',
  )
  const fsUrl = (path) => `/@fs/${path.replace(/\\/g, '/')}`
  const runtimeConfig = {
    glbUrl: fsUrl(join(showcaseModels, 'cubeDiorama.glb')),
    programsUrl: fsUrl(join(showcaseModels, 'cubeDiorama.materials.json')),
  }
  const runtime = {}
  const runtimeAvailable = existsSync(join(showcaseModels, 'cubeDiorama.materials.json'))
  if (runtimeAvailable) {
    for (const backendId of ['native', 'fallback']) {
      runtime[backendId] = await page.evaluate(
        ({ backend, config }) => window.__wgpuRuntimeCell(backend, config),
        { backend: backendId, config: runtimeConfig },
      )
      const cell = runtime[backendId]
      if (!cell?.ok) {
        failures.push(
          `${backendId}/runtime-diorama: ${cell?.phase ?? 'missing'} — ${cell?.error ?? 'no result'}`,
        )
        continue
      }
      if (cell.applied < 1) {
        failures.push(`${backendId}/runtime-diorama: no material application (matched ${cell.materials})`)
      }
      if (cell.after.nonBackgroundPixels === 0) {
        failures.push(`${backendId}/runtime-diorama: rendered fully black after install`)
      }
      if (cell.after.sha256 === cell.before.sha256) {
        failures.push(
          `${backendId}/runtime-diorama: pixels identical before/after install — programs changed nothing`,
        )
      }
    }
  } else {
    console.log('runtime-diorama cells skipped: showcase publication not present')
  }

  // Track C proof: per-object uniform values through one shared node
  // material (lifts the per-mesh fork for generated/object_coords).
  const objectUniform = {}
  for (const backendId of ['native', 'fallback']) {
    objectUniform[backendId] = await page.evaluate(
      (backend) => window.__wgpuObjectUniformProbe(backend), backendId,
    )
    const probe = objectUniform[backendId]
    if (!probe?.ok) {
      failures.push(
        `${backendId}/object-uniform: ${probe?.phase ?? 'missing'} — ${probe?.error ?? 'no result'}`,
      )
    } else if (
      Math.abs(probe.leftRed - 0.25) > 0.02 || Math.abs(probe.rightRed - 0.75) > 0.02
    ) {
      failures.push(
        `${backendId}/object-uniform: per-object values not delivered `
        + `(left=${probe.leftRed.toFixed(3)}, right=${probe.rightRed.toFixed(3)})`,
      )
    }
  }

  const crossBackend = {}
  for (const effectId of ids.node) {
    const native = node.native[effectId]
    const fallback = node.fallback[effectId]
    if (native?.ok && fallback?.ok) {
      crossBackend[effectId] = {
        meanLumaDelta: Math.abs(
          native.pixels.meanLuma - fallback.pixels.meanLuma,
        ),
        identicalSha: native.pixels.sha256 === fallback.pixels.sha256,
      }
    }
  }

  const lookContinuity = {}
  for (const effectId of ids.node) {
    const controlCell = control[effectId]
    const nativeCell = node.native[effectId]
    if (controlCell?.ok && nativeCell?.ok) {
      lookContinuity[effectId] = {
        controlMeanLuma: controlCell.pixels.meanLuma,
        nativeMeanLuma: nativeCell.pixels.meanLuma,
        meanLumaDelta: Math.abs(
          controlCell.pixels.meanLuma - nativeCell.pixels.meanLuma,
        ),
      }
    }
  }

  const summary = {
    pins,
    nativeBackendReal: Boolean(environment.backends?.native?.isWebGPUBackend),
    fallbackBackendIsWebGL: environment.backends?.fallback?.constructed === true
      && environment.backends?.fallback?.isWebGPUBackend !== true,
    nodeCellsAttempted: ids.node.length,
    nodeCellsPassingNative: ids.node
      .filter((id) => node.native[id]?.ok).length,
    nodeCellsPassingFallback: ids.node
      .filter((id) => node.fallback[id]?.ok).length,
    serviceCellsAttempted: serviceIds.length,
    serviceCellsPassingNative: serviceIds
      .filter((id) => service.native[id]?.ok).length,
    serviceCellsPassingFallback: serviceIds
      .filter((id) => service.fallback[id]?.ok).length,
    controlCellsPassing: ids.control
      .filter((id) => control[id]?.ok).length,
    pendingTrackB: ids.pendingTrackB,
    failures,
  }

  const evidence = {
    experiment: 'wgpu-postprocessing-parity (node pipeline)',
    ledgerRow: 'WGPU-NODE-001',
    command: 'node experiments/wgpu-postprocessing-parity/node-run.mjs',
    executablePath,
    environment,
    control,
    node,
    service,
    runtime,
    objectUniform,
    crossBackend,
    lookContinuity,
    summary,
    pageErrorCount: pageErrors.length,
    pageErrorSample: pageErrors.slice(0, 12),
    limits: [
      'One deterministic scene; production Blendlink scenes are broader.',
      'Node cells read back through an explicit RenderTarget (rows top-down); the WebGL control captures its canvas (rows bottom-up) — only orientation-independent stats compare across the two.',
      'Look continuity is mean-luma context, not pixel identity: the node pipeline intentionally replaces the pmndrs algorithms.',
      'vignette/tilt-shift/kuwahara have no node cells until Track B writes the Blendlink-owned display nodes.',
    ],
  }
  writeFileSync(
    join(outputDir, 'node-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )

  if (failures.length > 0) {
    exitCode = 1
    for (const failure of failures) console.error(`FAIL ${failure}`)
  }
  console.log(
    'BLENDLINK_WGPU_NODE_MEASURED '
    + `nativeBackend=${summary.nativeBackendReal ? 'native' : 'fallback-or-absent'} `
    + `native=${summary.nodeCellsPassingNative}/${summary.nodeCellsAttempted} `
    + `fallback=${summary.nodeCellsPassingFallback}/${summary.nodeCellsAttempted} `
    + `service=${summary.serviceCellsPassingNative}+${summary.serviceCellsPassingFallback}/${serviceIds.length * 2} `
    + `runtime=${['native', 'fallback'].filter((id) => runtime[id]?.ok).length}/${runtimeAvailable ? 2 : 0} `
    + `control=${summary.controlCellsPassing}/${ids.control.length} `
    + `pendingTrackB=${ids.pendingTrackB.length} `
    + `failures=${failures.length}`,
  )
} finally {
  await browser.close()
  await server.close()
}
process.exit(exitCode)
