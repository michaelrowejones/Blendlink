// MTLX-TSL-001 — the per-node differential harness. Nothing enters the
// future Blender-node -> TSL compiler without a cell here: Cycles bakes the
// node graph's 0..1 UV tile as float ground truth, the hand-written TSL
// mapping renders on WebGPURenderer into a float target, and the two float
// fields must agree numerically within each cell's stated tolerance. The
// first cells reproduce the published failure classes (inverted logic, UV
// orientation, rotate/place matrix order, disagreeing noise).
//
//   node experiments/tsl-node-differential/run.mjs
//   BLENDLINK_TSL_DIFF_REUSE=1  # skip re-baking the Blender reference
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const experimentDir = resolve(import.meta.dirname)
const repositoryRoot = resolve(experimentDir, '..', '..')
const outputDir = join(experimentDir, 'output')
const referenceDir = join(outputDir, 'reference')
mkdirSync(outputDir, { recursive: true })

const cellsManifest = JSON.parse(
  readFileSync(join(experimentDir, 'cells.json'), 'utf8'),
)
const SIZE = cellsManifest.size

const blender = process.env.BLENDLINK_BLENDER_PATH
  ?? 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
if (process.env.BLENDLINK_TSL_DIFF_REUSE !== '1'
  || !existsSync(join(referenceDir, 'manifest.json'))) {
  if (!existsSync(blender)) {
    throw new Error(`Blender executable not found: ${blender}`)
  }
  const stdout = execFileSync(blender, [
    '--background', '--factory-startup', '--python-exit-code', '1',
    '--python', join(experimentDir, 'reference.py'),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (!stdout.includes('BLENDLINK_TSL_DIFFERENTIAL_REFERENCE_DONE')) {
    throw new Error(`Blender reference bake did not finish:\n${stdout.slice(-2000)}`)
  }
}
const reference = JSON.parse(
  readFileSync(join(referenceDir, 'manifest.json'), 'utf8'),
)

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
    if (existsSync(candidate)) return await import(pathToFileURL(candidate).href)
  }
  throw new Error(`Playwright is unavailable; looked at: ${candidates.join(', ')}`)
}

const { createServer } = await import(pathToFileURL(join(
  repositoryRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js',
)).href)
const recipeModule = join(
  repositoryRoot, 'packages', 'blendlink', 'dist', 'tslNodeRecipe.js',
)
if (!existsSync(recipeModule)) {
  throw new Error(
    `built tslNodeRecipe module missing (${recipeModule}); run npm run build`,
  )
}
const server = await createServer({
  configFile: false,
  root: experimentDir,
  logLevel: 'warn',
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: { '@blendlink-tsl-recipe': recipeModule },
  },
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
    fs: { allow: [repositoryRoot] },
  },
})
await server.listen()
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}/`

const { chromium } = await importPlaywright()
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const executablePath = executableCandidates.find((item) => existsSync(item))
if (!executablePath) throw new Error('no Chromium executable found')

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 320, height: 320 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text())
})

function stats(referencePixels, renderedPixels) {
  // reference: (SIZE*SIZE*3) float32 rows BOTTOM-UP (Blender image order).
  // rendered: (SIZE*SIZE*components) float32 rows TOP-DOWN — measured by
  // the uv-gradient cell on 2026-07-27: WebGPU readback row order is the
  // inverse of Blender's, the exact documented "UV upside down" failure
  // class. The flip below is that measurement, not an assumption.
  const components = renderedPixels.length / (SIZE * SIZE)
  const diffs = new Float64Array(SIZE * SIZE * 3)
  for (let row = 0; row < SIZE; row += 1) {
    const renderedRow = SIZE - 1 - row
    for (let column = 0; column < SIZE; column += 1) {
      const texel = row * SIZE + column
      const renderedTexel = renderedRow * SIZE + column
      for (let channel = 0; channel < 3; channel += 1) {
        diffs[texel * 3 + channel] = Math.abs(
          referencePixels[texel * 3 + channel]
          - renderedPixels[renderedTexel * components + channel],
        )
      }
    }
  }
  const sorted = Float64Array.from(diffs).sort()
  const sum = diffs.reduce((total, value) => total + value, 0)
  return {
    meanAbs: sum / diffs.length,
    p99Abs: sorted[Math.floor(sorted.length * 0.99)],
    maxAbs: sorted[sorted.length - 1],
  }
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  const environment = await page.evaluate(() => window.__tslDiffInit())
  if (environment.error) {
    throw new Error(`TSL harness init failed: ${environment.error}`)
  }
  for (const cell of cellsManifest.cells) {
    if (!reference.cells[cell.id]) {
      throw new Error(`reference missing cell ${cell.id}`)
    }
  }

  const results = {}
  const failures = []
  for (const cell of cellsManifest.cells) {
    const errorsBefore = pageErrors.length
    const rendered = await page.evaluate(
      ({ id, pipeline, analyticCamera }) =>
        window.__tslDiffRun(id, pipeline, undefined, analyticCamera),
      {
        id: cell.id,
        pipeline: cell.pipeline ?? 'ir',
        analyticCamera: Boolean(cell.analyticCamera),
      },
    )
    if (pageErrors.length > errorsBefore) {
      failures.push(
        `${cell.id}: page errors during render: `
        + pageErrors.slice(errorsBefore).join(' | ').slice(0, 400),
      )
    }
    if (!rendered.ok) {
      results[cell.id] = { ok: false, error: rendered.error }
      failures.push(`${cell.id}: TSL render failed: ${rendered.error}`)
      continue
    }
    const renderedPixels = new Float32Array(
      Uint8Array.from(atob(rendered.base64), (c) => c.charCodeAt(0)).buffer,
    )
    mkdirSync(join(outputDir, 'rendered'), { recursive: true })
    writeFileSync(
      join(outputDir, 'rendered', `${cell.id}.f32`),
      Buffer.from(renderedPixels.buffer),
    )
    const referencePixels = new Float32Array(
      readFileSync(join(referenceDir, reference.cells[cell.id].path)).buffer,
    )
    const measured = stats(referencePixels, renderedPixels)
    const gated = Boolean(cell.gate)
    let pass = true
    if (gated) {
      pass = measured.meanAbs <= cell.tolerance.meanAbs
        && measured.p99Abs <= cell.tolerance.p99Abs
        && measured.maxAbs <= cell.tolerance.maxAbs
      if (!pass) {
        failures.push(
          `${cell.id} (${cell.failureClass}): mean ${measured.meanAbs.toExponential(3)} `
          + `p99 ${measured.p99Abs.toExponential(3)} max ${measured.maxAbs.toExponential(3)} `
          + `exceeds ${JSON.stringify(cell.tolerance)}`,
        )
      }
    }
    results[cell.id] = {
      ok: true,
      gated,
      pass: gated ? pass : null,
      measured,
      failureClass: cell.failureClass,
    }
  }

  // --- Scene stage: the compiler against real corpus materials ----------
  const sceneResults = {}
  if (process.argv.includes('--scenes')) {
    const inventory = JSON.parse(readFileSync(
      join(repositoryRoot, 'docs', 'demo-corpus-inventory.json'), 'utf8',
    ))
    const sceneIds = [
      'cube-diorama', 'blender-4.0-splash', 'trapx-painterly',
      'ellie-animation',
    ]
    const sceneTolerance = { meanAbs: 1e-3, p99Abs: 5e-3, maxAbs: 1e-2 }
    for (const sceneId of sceneIds) {
      const entry = inventory.scenes.find((item) => item.id === sceneId)
      const scenePath = entry
        ? resolve(repositoryRoot, entry.localPath)
        : null
      if (!scenePath || !existsSync(scenePath)) {
        sceneResults[sceneId] = { skipped: `source unavailable: ${scenePath}` }
        continue
      }
      const sceneDir = join(outputDir, 'scenes', sceneId)
      if (process.env.BLENDLINK_TSL_DIFF_REUSE !== '1'
        || !existsSync(join(sceneDir, 'manifest.json'))) {
        const stdout = execFileSync(blender, [
          '--background', '--factory-startup', '--disable-autoexec',
          '--python-exit-code', '1',
          '--python', join(experimentDir, 'scene_coverage.py'),
          '--', scenePath, sceneId, sceneDir, '12',
        ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
        if (!stdout.includes(`TSL_SCENE_COVERAGE_DONE ${sceneId}`)
          && !stdout.includes(`TSL_SCENE_SKIPPED ${sceneId}`)) {
          throw new Error(
            `scene coverage did not finish for ${sceneId}:\n${stdout.slice(-2000)}`,
          )
        }
      }
      const coverage = JSON.parse(
        readFileSync(join(sceneDir, 'coverage.json'), 'utf8'),
      )
      const sceneManifest = JSON.parse(
        readFileSync(join(sceneDir, 'manifest.json'), 'utf8'),
      )
      const differentials = {}
      for (const [cellId, cellEntry] of Object.entries(sceneManifest.cells)) {
        const rendered = await page.evaluate(
          ({ id, irPath }) => window.__tslDiffRun(id, 'ir', irPath),
          {
            id: cellId,
            irPath: `/output/scenes/${sceneId}/ir/${cellId}.json`,
          },
        )
        if (!rendered.ok) {
          differentials[cellId] = { ok: false, error: rendered.error }
          failures.push(`${sceneId}/${cellId}: TSL render failed: ${rendered.error}`)
          continue
        }
        const renderedPixels = new Float32Array(
          Uint8Array.from(atob(rendered.base64), (c) => c.charCodeAt(0)).buffer,
        )
        const referencePixels = new Float32Array(
          readFileSync(join(sceneDir, cellEntry.path)).buffer,
        )
        const measured = stats(referencePixels, renderedPixels)
        const pass = measured.meanAbs <= sceneTolerance.meanAbs
          && measured.p99Abs <= sceneTolerance.p99Abs
          && measured.maxAbs <= sceneTolerance.maxAbs
        if (!pass) {
          failures.push(
            `${sceneId}/${cellId}: mean ${measured.meanAbs.toExponential(3)} `
            + `p99 ${measured.p99Abs.toExponential(3)} `
            + `max ${measured.maxAbs.toExponential(3)}`,
          )
        }
        differentials[cellId] = { ok: true, pass, measured }
      }
      sceneResults[sceneId] = { coverage, differentials }
    }
  }

  const evidence = {
    experiment: 'tsl-node-differential',
    ledgerRow: 'MTLX-TSL-001',
    command: 'node experiments/tsl-node-differential/run.mjs [--scenes]',
    size: SIZE,
    webgpuBackendReal: Boolean(environment.backend),
    referenceBackend: Object.values(reference.cells)[0]?.backend ?? null,
    cells: results,
    ...(Object.keys(sceneResults).length > 0 ? { scenes: sceneResults } : {}),
    pageErrorCount: pageErrors.length,
    pageErrorSample: pageErrors.slice(0, 8),
    limits: [
      'Cells drive the production IR pipeline (tsl_ir.py -> tslNodeRecipe.ts); only diagnostic cells without an IR route stay hand-written.',
      'One 64px tile per configuration; scene sampling covers UV-driven compiled channels only (the tile proxy provides UV space).',
      'Scene coverage refusals are the compiler to-do list, tallied by named reason.',
    ],
  }
  writeFileSync(
    join(outputDir, 'evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  if (failures.length > 0) {
    throw new Error(`TSL differential failures:\n  - ${failures.join('\n  - ')}`)
  }
  const noise = results['noise-mx-divergence']?.measured
  console.log(
    'BLENDLINK_TSL_NODE_DIFFERENTIAL_PASSED '
    + `cells=${cellsManifest.cells.length} `
    + `gated=${cellsManifest.cells.filter((cell) => cell.gate).length} `
    + `backend=${environment.backend ? 'webgpu' : 'fallback'} `
    + `noiseDivergenceMean=${noise ? noise.meanAbs.toFixed(4) : 'n/a'}`,
  )
} finally {
  await browser.close()
  await server.close()
}
