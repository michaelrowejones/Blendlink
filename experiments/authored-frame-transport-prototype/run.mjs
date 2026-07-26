import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const output = resolve(root, 'output')
const blender = process.env.BLENDLINK_BLENDER_PATH
  ?? 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
const needleSource = resolve(
  repository,
  '../MichaelRoweJonesSite/.cache/needle-spike/addon/' +
    'Needle Engine Exporter for Blender/blender_export.py',
)
const gltfRoot = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\5.2\\scripts\\addons_core\\io_scene_gltf2'
const defaultPlaywright = resolve(
  repository,
  '../MichaelRoweJonesSite/node_modules/playwright/index.mjs',
)
const playwrightModule = resolve(
  process.env.BLENDLINK_PLAYWRIGHT_MODULE ?? defaultPlaywright,
)
const { chromium } = await import(pathToFileURL(playwrightModule).href)
const chromiumCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const executablePath = chromiumCandidates.find((candidate) => existsSync(candidate))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function identity(path) {
  const stat = statSync(path, { bigint: true })
  return {
    path,
    bytes: Number(stat.size),
    mtimeNs: Number(stat.mtimeNs),
    sha256: sha256(path),
  }
}

function runBlender(args, sentinel) {
  const result = spawnSync(blender, args, {
    cwd: repository,
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
    maxBuffer: 24 * 1024 * 1024,
  })
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (!combined.includes(sentinel)) {
    throw new Error(
      `Blender did not emit ${sentinel} (exit ${result.status}).\n` +
        combined.slice(-10_000),
    )
  }
  if (result.error) throw result.error
  return {
    status: result.status,
    stdoutTail: String(result.stdout ?? '').slice(-7000),
    stderrTail: String(result.stderr ?? '').slice(-7000),
  }
}

function parseGlbJson(path) {
  const bytes = readFileSync(path)
  assert(bytes.toString('ascii', 0, 4) === 'glTF', `${path} is not GLB`)
  const length = bytes.readUInt32LE(12)
  assert(bytes.readUInt32LE(16) === 0x4e4f534a, `${path} first chunk is not JSON`)
  return JSON.parse(bytes.toString('utf8', 20, 20 + length).trimEnd())
}

mkdirSync(output, { recursive: true })
assert(existsSync(blender), `Blender 5.2 binary is missing: ${blender}`)
assert(existsSync(needleSource), `Needle source is missing: ${needleSource}`)
assert(
  sha256(needleSource) === '6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77',
  'Needle blender_export.py identity changed',
)

const generation = runBlender(
  [
    '--background',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    resolve(root, 'generate_fixture.py'),
    '--',
    output,
  ],
  'BLENDLINK_AUTHORED_FRAME_FIXTURE_GENERATED',
)
const blendPath = resolve(output, 'authored-frame-fixture.blend')
const sourceBeforeExport = identity(blendPath)
const exporting = runBlender(
  [
    '--background',
    blendPath,
    '--python-exit-code',
    '1',
    '--python',
    resolve(root, 'export_variants.py'),
    '--',
    output,
  ],
  'BLENDLINK_AUTHORED_FRAME_VARIANTS_EXPORTED',
)
const sourceAfterExport = identity(blendPath)
assert(
  JSON.stringify(sourceAfterExport) === JSON.stringify(sourceBeforeExport),
  'export command changed the fixture .blend bytes or timestamp',
)

const reference = JSON.parse(readFileSync(resolve(output, 'blender-reference.json')))
const exportReport = JSON.parse(readFileSync(resolve(output, 'export-report.json')))
assert(
  exportReport.sourceBefore.sha256 === exportReport.sourceAfter.sha256,
  'Blender-side report did not restore source identity',
)
assert(
  exportReport.variants['one-pass-scene'].frameAfterOperator === 20,
  'fixture no longer reproduces SCENE/current-frame in-memory frame leakage',
)
assert(
  exportReport.variants['one-pass-scene'].frameAfterTransaction === 10,
  'prototype transaction did not restore authored frame 10',
)
const diagnostics = exportReport.sourceInventory.proposedDiagnostics
assert(diagnostics.length === 1, `expected one loud driver diagnostic, got ${diagnostics.length}`)
assert(
  diagnostics[0].code === 'animation.material-driver-not-portable' &&
    diagnostics[0].message.includes('DrivenCubeMaterial') &&
    diagnostics[0].message.includes('Roughness'),
  `driver diagnostic was not artist-readable: ${JSON.stringify(diagnostics[0])}`,
)

const glbs = Object.fromEntries(
  Object.keys(exportReport.variants).map((name) => {
    const path = resolve(output, `${name}.glb`)
    const json = parseGlbJson(path)
    return [name, { path, identity: identity(path), json }]
  }),
)
for (const [name, value] of Object.entries(glbs)) {
  const extensions = value.json.extensionsUsed ?? []
  assert(
    !extensions.includes('KHR_animation_pointer'),
    `${name} unexpectedly exported KHR_animation_pointer`,
  )
}
assert(
  glbs['needle-floor'].json.animations.every((animation) =>
    animation.channels.every((channel) =>
      !['ConstrainedCube', 'DrivenCube'].includes(
        glbs['needle-floor'].json.nodes[channel.target.node]?.name,
      ),
    ),
  ),
  'Needle floor unexpectedly transported constrained/driver-only objects',
)
const sceneTargets = new Set(
  glbs['one-pass-scene'].json.animations.flatMap((animation) =>
    animation.channels.map((channel) =>
      glbs['one-pass-scene'].json.nodes[channel.target.node]?.name,
    ),
  ),
)
for (const required of ['ConstrainedCube', 'DrivenCube', 'AuthoredCamera', 'DeformBone']) {
  assert(sceneTargets.has(required), `SCENE sampling omitted ${required}`)
}

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
  assert(address && typeof address !== 'string', 'Vite did not expose a TCP port')
  const url = `http://127.0.0.1:${address.port}/`
  browser = await chromium.launch({
    headless: true,
    ...(executablePath
      ? {
          executablePath,
          args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
        }
      : {}),
  })
  const page = await browser.newPage({
    viewport: { width: 1200, height: 820 },
    deviceScaleFactor: 1,
  })
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => window.__authoredFrameEvidence?.ready === true,
    undefined,
    { timeout: 60_000 },
  )
  const browserState = await page.evaluate(() => window.__authoredFrameEvidence)
  assert(browserState, 'browser did not publish evidence')
  assert(browserState.errors.length === 0, browserState.errors.join('\n'))
  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`)
  const evidence = browserState.evidence
  assert(evidence, 'browser evidence payload is missing')
  console.log(
    'AUTHORED_FRAME_OBSERVED ' +
      JSON.stringify({
        needle: evidence.needle,
        designA: evidence.designA,
        designB: evidence.designB,
        designC: evidence.designC,
        designD: evidence.designD,
        actionsBakedDiagnostic: evidence.actionsBakedDiagnostic,
      }),
  )

  const threshold = 7e-4
  assert(
    evidence.needle.initial.maximumPortable <= threshold,
    `Needle floor no longer represents frame 0: ${evidence.needle.initial.maximumPortable}`,
  )
  assert(
    evidence.needle.savedFramePortableError > 0.1,
    `Needle floor unexpectedly represents saved frame: ${evidence.needle.savedFramePortableError}`,
  )
  assert(
    evidence.designA.initial.maximumPortable <= threshold,
    `design A initial mismatch ${evidence.designA.initial.maximumPortable}`,
  )
  assert(
    evidence.designA.maxima.maximumPortable <= threshold,
    `design A clip mismatch ${evidence.designA.maxima.maximumPortable}`,
  )
  assert(
    evidence.designB.initial.maximumPortable <= threshold,
    `design B initial mismatch ${evidence.designB.initial.maximumPortable}`,
  )
  assert(
    evidence.designB.maxima.maximumPortable <= threshold,
    `design B clip mismatch ${evidence.designB.maxima.maximumPortable}`,
  )
  assert(
    evidence.designC.initial.maximumPortable <= threshold,
    `design C initial mismatch ${evidence.designC.initial.maximumPortable}`,
  )
  assert(
    evidence.designC.maxima.maximumPortable <= threshold,
    `design C clip mismatch ${evidence.designC.maxima.maximumPortable}`,
  )
  assert(
    evidence.designD.initial.maximumPortable <= threshold,
    `design D idle mismatch ${evidence.designD.initial.maximumPortable}`,
  )
  assert(
    evidence.designD.restoredIdle.maximumPortable <= threshold,
    `design D stop/idle restoration mismatch ${evidence.designD.restoredIdle.maximumPortable}`,
  )
  assert(
    evidence.designD.developerClipPlaybackMaxima.maximumPortable > 0.1,
    'design D should expose that ordinary Actions omit follower/driver playback',
  )
  assert(
    evidence.materialDriver.referenceValues[0] !==
      evidence.materialDriver.referenceValues.at(-1),
    'material driver oracle did not change',
  )
  assert(
    new Set(evidence.materialDriver.designAObservedValues).size === 1,
    'core glTF unexpectedly animated the unsupported material driver',
  )
  assert(
    evidence.pixels.nonBackground > 20_000 && evidence.pixels.chromatic > 8_000,
    `browser render is empty: ${JSON.stringify(evidence.pixels)}`,
  )

  const screenshotPath = resolve(output, 'browser-evidence.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  const canvasPath = resolve(output, 'browser-canvas.png')
  await page.locator('#stage').screenshot({ path: canvasPath })
  await page.evaluate(() => window.__authoredFrameEvidence.dispose())

  // Fill the size-dependent dual-artifact cost after browser measurement.
  evidence.designB.extraArtifactBytes = glbs['static-current'].identity.bytes

  const exporterSources = {
    entry: resolve(gltfRoot, '__init__.py'),
    exportTransaction: resolve(gltfRoot, 'blender/exp/export.py'),
    tree: resolve(gltfRoot, 'blender/exp/tree.py'),
    animationActions: resolve(gltfRoot, 'blender/exp/animation/action.py'),
    animationUtilities: resolve(gltfRoot, 'blender/exp/animation/anim_utils.py'),
    sampledCache: resolve(
      gltfRoot,
      'blender/exp/animation/sampled/sampling_cache.py',
    ),
  }
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    classification: 'prototype; no production Blendlink behavior changed',
    versions: {
      blender: reference.blender.version,
      blenderGltfExporter: reference.gltfExporter.version.join('.'),
      three: JSON.parse(readFileSync(resolve(repository, 'node_modules/three/package.json'))).version,
      vite: JSON.parse(readFileSync(resolve(repository, 'node_modules/vite/package.json'))).version,
      playwright: JSON.parse(readFileSync(resolve(
        repository,
        '../MichaelRoweJonesSite/node_modules/playwright/package.json',
      ))).version,
      browser: await browser.version(),
      needleAddon: '1.4.2',
    },
    sources: {
      needleBlenderExport: identity(needleSource),
      ...Object.fromEntries(
        Object.entries(exporterSources).map(([name, path]) => [name, identity(path)]),
      ),
      generator: identity(resolve(root, 'generate_fixture.py')),
      exporterPrototype: identity(resolve(root, 'export_variants.py')),
      browserPrototype: identity(resolve(root, 'main.ts')),
      runner: identity(resolve(root, 'run.mjs')),
      experimentReadme: identity(resolve(root, 'README.md')),
      researchRecord: identity(resolve(
        repository,
        'docs/research-authored-current-frame-transport-2026.md',
      )),
    },
    sourceRestoration: {
      before: sourceBeforeExport,
      after: sourceAfterExport,
      blenderReportBefore: exportReport.sourceBefore,
      blenderReportAfter: exportReport.sourceAfter,
      onePassFrameAfterOperator:
        exportReport.variants['one-pass-scene'].frameAfterOperator,
      onePassFrameAfterTransaction:
        exportReport.variants['one-pass-scene'].frameAfterTransaction,
    },
    exporterDefaults: exportReport.exporterDefaults,
    sourceInventory: exportReport.sourceInventory,
    glbs: Object.fromEntries(
      Object.entries(glbs).map(([name, value]) => [
        name,
        {
          identity: value.identity,
          asset: value.json.asset,
          animationNames: (value.json.animations ?? []).map((animation) => animation.name),
          animationChannelCount: (value.json.animations ?? []).reduce(
            (sum, animation) => sum + animation.channels.length,
            0,
          ),
          extensionsUsed: value.json.extensionsUsed ?? [],
        },
      ]),
    ),
    browser: {
      url,
      pageErrors,
      consoleErrors,
      evidence,
    },
    commands: {
      run: 'node experiments/authored-frame-transport-prototype/run.mjs',
    },
    artifacts: {
      blenderReference: identity(resolve(output, 'blender-authored-frame.png')),
      browserPage: identity(screenshotPath),
      browserCanvas: identity(canvasPath),
    },
    generation,
    exporting,
  }
  writeFileSync(resolve(output, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    'BLENDLINK_AUTHORED_FRAME_TRANSPORT_PROTOTYPE_PASSED ' +
      `A=${evidence.designA.maxima.maximumPortable.toExponential(3)} ` +
      `B=${evidence.designB.maxima.maximumPortable.toExponential(3)} ` +
      `C=${evidence.designC.maxima.maximumPortable.toExponential(3)} ` +
      `D-idle=${evidence.designD.initial.maximumPortable.toExponential(3)} ` +
      `D-play=${evidence.designD.developerClipPlaybackMaxima.maximumPortable.toExponential(3)}`,
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
