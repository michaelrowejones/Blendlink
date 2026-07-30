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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
// The harness gates the BUILT module, which is the point -- a cell must prove
// what ships. But a stale build silently measures the previous mapping against
// the current Blender reference, which reads as a decorrelated failure of a
// cell whose TSL half simply is not there yet. That cost a correct noise
// distortion mapping a false 6.6e-2 "refutation" and a revert on 2026-07-30.
// Refuse instead of measuring a lie.
const recipeSource = join(
  repositoryRoot, 'packages', 'blendlink', 'src', 'tslNodeRecipe.ts',
)
if (existsSync(recipeSource)) {
  const builtAt = statSync(recipeModule).mtimeMs
  const editedAt = statSync(recipeSource).mtimeMs
  if (editedAt > builtAt) {
    throw new Error(
      'built tslNodeRecipe.js is older than src/tslNodeRecipe.ts '
      + `(${new Date(builtAt).toISOString()} vs `
      + `${new Date(editedAt).toISOString()}); run npm run build first, or the `
      + 'harness measures the previous TSL mapping against the current '
      + 'Blender reference and every edited cell fails for the wrong reason.',
    )
  }
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

/** First-order amplitude and second-order spatial agreement.
 *
 * For a cell whose divergence is `decorrelated`, per-texel comparison is
 * impossible in principle -- Blender's White Noise hashes the RAW BITS of an
 * interpolated coordinate, and the two rasterizers' interpolated UVs differ by
 * ulps, so the avalanche decorrelates every texel on any two backends. What
 * IS testable is that both sides draw from the same distribution with the same
 * spatial structure.
 *
 * The histogram alone is not enough: it passes a blurred field, a DC-shifted
 * field, and a wrongly-scaled one. Pairing it with a radially-averaged power
 * spectrum pins amplitude AND structure.
 *
 * Deliberately reports no p-value. The tile's values are spatially correlated
 * for every noise except White Noise, so a nominal alpha would over-reject,
 * and the reference is one fixed realization rather than repeated draws.
 */
function distributionStats(referencePixels, renderedPixels, bins = 32) {
  const components = renderedPixels.length / (SIZE * SIZE)
  const reference = []
  const rendered = []
  // Same row flip as stats(): a measurement, not an assumption.
  for (let row = 0; row < SIZE; row += 1) {
    const renderedRow = SIZE - 1 - row
    for (let column = 0; column < SIZE; column += 1) {
      const texel = row * SIZE + column
      const renderedTexel = renderedRow * SIZE + column
      for (let channel = 0; channel < 3; channel += 1) {
        reference.push(referencePixels[texel * 3 + channel])
        rendered.push(renderedPixels[renderedTexel * components + channel])
      }
    }
  }
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length
  const std = (values, m) => Math.sqrt(
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length,
  )
  const refMean = mean(reference)
  const tslMean = mean(rendered)
  const refStd = std(reference, refMean)
  const tslStd = std(rendered, tslMean)
  const low = Math.min(...reference, ...rendered)
  const high = Math.max(...reference, ...rendered)
  const span = high - low || 1
  const histogram = (values) => {
    const counts = new Float64Array(bins)
    for (const value of values) {
      const index = Math.min(bins - 1, Math.floor(((value - low) / span) * bins))
      counts[index] += 1
    }
    return counts.map((count) => count / values.length)
  }
  const refHistogram = histogram(reference)
  const tslHistogram = histogram(rendered)
  let histogramL1 = 0
  for (let index = 0; index < bins; index += 1) {
    histogramL1 += Math.abs(refHistogram[index] - tslHistogram[index])
  }
  // Radially-averaged power, luminance only, DC ring excluded: a DFT over the
  // tile costs SIZE^4 naively, so this samples a coarse ring set instead.
  const luminance = (values) => {
    const plane = new Float64Array(SIZE * SIZE)
    for (let texel = 0; texel < SIZE * SIZE; texel += 1) {
      plane[texel] = (values[texel * 3] + values[texel * 3 + 1]
        + values[texel * 3 + 2]) / 3
    }
    return plane
  }
  // A proper separable 2D DFT, radially averaged. An earlier version probed
  // 8 single diagonal frequencies, which for a white field is one Fourier
  // coefficient per ring -- a chi-squared statistic with ~2 degrees of
  // freedom, whose variance is so high that two genuinely independent white
  // fields disagree by L1 ~ 1.1. That was the estimator failing, not the
  // mapping, and loosening the tolerance to accommodate it would have been
  // the exact dishonesty this tier is built to prevent. Averaging every
  // coefficient in each ring cuts the variance instead.
  const radialPower = (plane, rings = 8) => {
    // Separable: rows then columns, O(2 * SIZE^3) rather than O(SIZE^4).
    const rowReal = new Float64Array(SIZE * SIZE)
    const rowImaginary = new Float64Array(SIZE * SIZE)
    for (let row = 0; row < SIZE; row += 1) {
      for (let ku = 0; ku < SIZE; ku += 1) {
        let real = 0
        let imaginary = 0
        for (let column = 0; column < SIZE; column += 1) {
          const phase = (-2 * Math.PI * ku * column) / SIZE
          const value = plane[row * SIZE + column]
          real += value * Math.cos(phase)
          imaginary += value * Math.sin(phase)
        }
        rowReal[row * SIZE + ku] = real
        rowImaginary[row * SIZE + ku] = imaginary
      }
    }
    const power = new Float64Array(rings)
    const counts = new Float64Array(rings)
    const nyquist = SIZE / 2
    for (let ku = 0; ku < SIZE; ku += 1) {
      for (let kv = 0; kv < SIZE; kv += 1) {
        let real = 0
        let imaginary = 0
        for (let row = 0; row < SIZE; row += 1) {
          const phase = (-2 * Math.PI * kv * row) / SIZE
          const cos = Math.cos(phase)
          const sin = Math.sin(phase)
          real += rowReal[row * SIZE + ku] * cos
            - rowImaginary[row * SIZE + ku] * sin
          imaginary += rowReal[row * SIZE + ku] * sin
            + rowImaginary[row * SIZE + ku] * cos
        }
        // Signed frequencies, DC excluded: DC carries the mean, which
        // meanDelta already gates.
        const su = ku > nyquist ? ku - SIZE : ku
        const sv = kv > nyquist ? kv - SIZE : kv
        if (su === 0 && sv === 0) continue
        const radius = Math.hypot(su, sv) / nyquist
        const ring = Math.min(rings - 1, Math.floor(radius * rings))
        power[ring] += real * real + imaginary * imaginary
        counts[ring] += 1
      }
    }
    for (let ring = 0; ring < rings; ring += 1) {
      if (counts[ring] > 0) power[ring] /= counts[ring]
    }
    const total = power.reduce((sum, v) => sum + v, 0) || 1
    return Array.from(power, (v) => v / total)
  }
  const refPower = radialPower(luminance(reference))
  const tslPower = radialPower(luminance(rendered))
  let radialSpectrumL1 = 0
  for (let ring = 0; ring < refPower.length; ring += 1) {
    radialSpectrumL1 += Math.abs(refPower[ring] - tslPower[ring])
  }
  return {
    refMean, tslMean, meanDelta: Math.abs(refMean - tslMean),
    refStd, tslStd,
    stdDeltaFraction: Math.abs(refStd - tslStd) / (refStd || 1),
    histogramL1, radialSpectrumL1,
  }
}

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
      ({ id, pipeline, analyticCamera, analyticLight, objectAttributes }) =>
        window.__tslDiffRun(
          id, pipeline, undefined, analyticCamera, analyticLight,
          objectAttributes,
        ),
      {
        id: cell.id,
        pipeline: cell.pipeline ?? 'ir',
        analyticCamera: Boolean(cell.analyticCamera),
        analyticLight: cell.analyticLight ?? null,
        objectAttributes: cell.objectAttributes ?? null,
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
    const claim = cell.claim ?? (cell.gate ? 'exact' : 'diagnostic')
    const gated = Boolean(cell.gate)
    let pass = true
    let distribution
    if (claim === 'approximate') {
      // The anti-betrayal lock. An approximation is not a loosened proof, so
      // it may not carry a per-texel tolerance at all -- you have to delete
      // the tolerance and declare a different KIND of gate. Without this the
      // tier degrades into "raise the number until it passes", which is
      // exactly what the project owner's decision must NOT be read as.
      if (cell.tolerance != null) {
        throw new Error(
          `${cell.id}: claim 'approximate' with a per-texel tolerance -- an `
          + 'approximation is not a loosened proof. Delete tolerance and '
          + 'declare distributionTolerance (decorrelated) or '
          + 'divergenceBudget (bounded).',
        )
      }
      // An approximation may never be the only evidence for its own
      // algorithm. A distribution gate is genuinely weak -- any competent
      // hash passes a histogram test against any other, and a corrupted
      // Jenkins final-mix still yields a uniform histogram and a flat
      // spectrum. provenBy names the EXACT cells that pin the algorithm, so
      // this cell's honest claim is only that the residual divergence is
      // confined to sample position.
      for (const dependency of cell.provenBy ?? []) {
        const evidence = results[dependency]
        const declared = cellsManifest.cells.find((c) => c.id === dependency)
        if (!declared || (declared.claim ?? 'exact') !== 'exact') {
          throw new Error(
            `${cell.id}: provenBy names ${dependency}, which is not a `
            + "claim 'exact' cell -- an approximation cannot rest on another "
            + 'approximation.',
          )
        }
        if (!evidence || evidence.pass !== true) {
          throw new Error(
            `${cell.id}: provenBy names ${dependency}, which did not pass -- `
            + 'the algorithm behind this approximation is unproven.',
          )
        }
      }
      if (cell.divergenceKind === 'decorrelated') {
        distribution = distributionStats(referencePixels, renderedPixels)
        const budget = cell.distributionTolerance
        pass = distribution.meanDelta <= budget.meanDelta
          && distribution.stdDeltaFraction <= budget.stdDeltaFraction
          && distribution.histogramL1 <= budget.histogramL1
          && distribution.radialSpectrumL1 <= budget.radialSpectrumL1
        // Inverted floor: if the per-texel error collapses, the thing is no
        // longer decorrelated and the approximation should be retired rather
        // than kept as a standing excuse.
        const floor = cell.perTexelFloor?.meanAbsAtLeast
        if (floor != null && measured.meanAbs < floor) {
          failures.push(
            `${cell.id} (${cell.failureClass}): per-texel meanAbs `
            + `${measured.meanAbs.toExponential(3)} fell BELOW the declared `
            + `floor ${floor} -- this configuration may now be exactly `
            + "provable; promote it to claim 'exact' rather than leaving an "
            + 'approximation in place.',
          )
          pass = false
        }
        if (!pass && distribution.meanDelta > budget.meanDelta) {
          failures.push(
            `${cell.id} (${cell.failureClass}, approximate/decorrelated): `
            + `meanDelta ${distribution.meanDelta.toExponential(3)} `
            + `histogramL1 ${distribution.histogramL1.toFixed(4)} `
            + `radialSpectrumL1 ${distribution.radialSpectrumL1.toFixed(4)} `
            + `exceeds ${JSON.stringify(budget)} -- the distributions `
            + 'disagree, so this is a mapping defect, not decorrelation.',
          )
        }
      } else {
        throw new Error(
          `${cell.id}: claim 'approximate' needs divergenceKind `
          + "'decorrelated' (bounded is not implemented yet).",
        )
      }
    } else if (gated) {
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
      claim,
      gated,
      pass: claim === 'approximate' || gated ? pass : null,
      measured,
      ...(distribution ? { distribution } : {}),
      ...(cell.provenBy ? { provenBy: cell.provenBy } : {}),
      ...(cell.declaredDivergence
        ? { declaredDivergence: cell.declaredDivergence } : {}),
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
          '--', scenePath, sceneId, sceneDir, '999',
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
    // Hoisted so an approximation cannot be skimmed past inside a hundred-odd
    // per-cell entries. `claims` is the honest headline; `approximations`
    // names every declared divergence with the exact cells that prove its
    // algorithm.
    claims: Object.values(results).reduce((counts, entry) => {
      if (entry.claim) counts[entry.claim] = (counts[entry.claim] ?? 0) + 1
      return counts
    }, {}),
    approximations: Object.entries(results)
      .filter(([, entry]) => entry.claim === 'approximate')
      .map(([id, entry]) => ({
        id,
        failureClass: entry.failureClass,
        pass: entry.pass,
        perTexel: entry.measured,
        distribution: entry.distribution ?? null,
        provenBy: entry.provenBy ?? [],
      })),
    ...(Object.keys(sceneResults).length > 0 ? { scenes: sceneResults } : {}),
    pageErrorCount: pageErrors.length,
    pageErrorSample: pageErrors.slice(0, 8),
    limits: [
      'Cells drive the production IR pipeline (tsl_ir.py -> tslNodeRecipe.ts); only diagnostic cells without an IR route stay hand-written.',
      'One 64px tile per configuration; scene sampling covers UV-driven compiled channels only (the tile proxy provides UV space).',
      'Scene coverage refusals are the compiler to-do list, tallied by named reason.',
      "claim:approximate cells are gated on DECLARED DIVERGENCE, not on exactness: a decorrelated cell is gated on distribution agreement (mean, std, histogram, radial spectrum) because per-texel agreement is impossible in principle, and its algorithm is proven separately by the cells named in provenBy. The word 'proven' belongs to claim:exact only.",
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
  const claimCounts = { exact: 0, approximate: 0, diagnostic: 0 }
  for (const cell of cellsManifest.cells) {
    const claim = cell.claim ?? (cell.gate ? 'exact' : 'diagnostic')
    claimCounts[claim] = (claimCounts[claim] ?? 0) + 1
  }
  const worstApproximation = Object.entries(results)
    .filter(([, entry]) => entry.claim === 'approximate' && entry.measured)
    .map(([id, entry]) => ({ id, meanAbs: entry.measured.meanAbs }))
    .sort((a, b) => b.meanAbs - a.meanAbs)[0]
  console.log(
    // Report CLAIMS, not gates. `gated=` used to fold every cell with
    // gate:true into one number, which is where an approximation would
    // silently weaken the headline: 118 gated reads as 118 proven. The word
    // "proven" now belongs to exact only.
    'BLENDLINK_TSL_NODE_DIFFERENTIAL_PASSED '
    + `cells=${cellsManifest.cells.length} `
    + `exact=${claimCounts.exact} `
    + `approximate=${claimCounts.approximate} `
    + `diagnostic=${claimCounts.diagnostic} `
    + (worstApproximation
      ? `worstDeclaredDivergence=${worstApproximation.id}:`
        + `${worstApproximation.meanAbs.toExponential(2)} ` : '')
    + `backend=${environment.backend ? 'webgpu' : 'fallback'} `
    + `noiseDivergenceMean=${noise ? noise.meanAbs.toFixed(4) : 'n/a'}`,
  )
} finally {
  await browser.close()
  await server.close()
}
