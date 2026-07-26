// PROTOTYPE — one-command Blender + Chromium selected-field surface differential.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const here = import.meta.dirname
const repository = path.resolve(here, '..', '..')
const output = path.resolve(here, 'output')
const blender = process.env.BLENDLINK_BLENDER_PATH
  ?? 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
const playwrightRoot = path.resolve(
  process.argv[2]
  ?? process.env.BLENDLINK_PLAYWRIGHT_ROOT
  ?? path.resolve(repository, '..', 'MichaelRoweJonesSite', 'node_modules'),
)
const playwrightModule = path.resolve(playwrightRoot, 'playwright', 'index.mjs')
const needleAddonRoot = path.resolve(
  repository,
  '..',
  'MichaelRoweJonesSite',
  '.cache',
  'needle-spike',
  'addon',
  'Needle Engine Exporter for Blender',
)
const needleEngineRoot = path.resolve(
  repository,
  'experiments',
  'needle-spike',
  'node_modules',
  '@needle-tools',
  'engine',
)

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function packageVersion(file) {
  return JSON.parse(readFileSync(file, 'utf8')).version
}

async function run(command, args) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repository,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('close', resolve)
  })
  assert.equal(code, 0, `${command} exited with code ${code}`)
}

async function rgbRmse(leftPath, rightPath) {
  const left = await sharp(leftPath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const right = await sharp(rightPath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual(left.info, right.info, 'image dimensions/channels differ')
  let squared = 0
  for (let index = 0; index < left.data.length; index += 1) {
    const delta = Number(left.data[index]) - Number(right.data[index])
    squared += delta * delta
  }
  return Math.sqrt(squared / left.data.length) / 255
}

async function labeledImage(file, label) {
  const image = sharp(file)
  const meta = await image.metadata()
  const labelHeight = 38
  const labelSvg = Buffer.from(
    `<svg width="${meta.width}" height="${labelHeight}">` +
    `<rect width="100%" height="100%" fill="#101216"/>` +
    `<text x="18" y="25" fill="#f5f7fb" font-family="Arial" font-size="17">${label}</text>` +
    `</svg>`,
  )
  return await sharp({
    create: {
      width: meta.width,
      height: meta.height + labelHeight,
      channels: 4,
      background: '#101216',
    },
  }).composite([
    { input: labelSvg, left: 0, top: 0 },
    { input: file, left: 0, top: labelHeight },
  ]).png().toBuffer()
}

mkdirSync(output, { recursive: true })
assert(existsSync(blender), `Blender executable is missing: ${blender}`)
assert(existsSync(playwrightModule), `Playwright module is missing: ${playwrightModule}`)

await run(blender, [
  '--background',
  '--factory-startup',
  '--python',
  path.resolve(here, 'run_blender.py'),
])

const blenderEvidencePath = path.resolve(output, 'blender-evidence.json')
assert(existsSync(blenderEvidencePath), 'Blender did not write evidence')
const blenderEvidence = JSON.parse(readFileSync(blenderEvidencePath, 'utf8'))
for (const [name, passed] of Object.entries(blenderEvidence.checks)) {
  assert.equal(passed, true, `Blender check failed: ${name}`)
}

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
const captures = {}
try {
  await server.listen()
  const address = server.httpServer.address()
  assert(address && typeof address !== 'string', 'Vite did not expose a port')
  const origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? {
      executablePath,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    } : {}),
  })
  for (const variant of ['unlit', 'lit']) {
    const page = await browser.newPage({
      viewport: { width: 800, height: 500 },
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
    await page.goto(`${origin}/?variant=${variant}`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    })
    await page.waitForFunction(
      () => window.__selectedFieldSurfaceEvidence?.ready === true,
      undefined,
      { timeout: 120_000 },
    )
    const evidence = await page.evaluate(() => window.__selectedFieldSurfaceEvidence)
    assert(evidence, `${variant} browser evidence is absent`)
    assert.deepEqual(pageErrors, [], `${variant} page errors: ${pageErrors.join('; ')}`)
    assert.deepEqual(consoleErrors, [], `${variant} console errors: ${consoleErrors.join('; ')}`)
    assert.deepEqual(failedRequests, [], `${variant} failed requests: ${JSON.stringify(failedRequests)}`)
    const screenshot = path.resolve(output, `browser-${variant}.png`)
    await page.locator('canvas').screenshot({ path: screenshot })
    captures[variant] = {
      screenshot,
      screenshotSha256: sha256(screenshot),
      evidence,
      pageErrors,
      consoleErrors,
      failedRequests,
    }
    await page.close()
  }
} finally {
  if (browser) await browser.close()
  await server.close()
}

assert.equal(captures.unlit.evidence.material.type, 'MeshBasicMaterial')
assert.equal(captures.unlit.evidence.material.isMeshBasicMaterial, true)
assert.equal(captures.lit.evidence.material.type, 'MeshStandardMaterial')
assert.equal(captures.lit.evidence.material.isMeshStandardMaterial, true)
assert.equal(captures.unlit.evidence.material.mapWidth, 256)
assert.equal(captures.lit.evidence.material.mapWidth, 256)

const unlitReceive = captures.unlit.evidence.receivedShadow.changed
const litReceive = captures.lit.evidence.receivedShadow.changed
const unlitCast = captures.unlit.evidence.castShadow.changed
const litCast = captures.lit.evidence.castShadow.changed
const unlitLight = captures.unlit.evidence.directLightResponse.changed
const litLight = captures.lit.evidence.directLightResponse.changed
assert(
  unlitReceive <= 8,
  `Unlit selected field unexpectedly received a shadow across ${unlitReceive} pixels`,
)
assert(
  litReceive >= 500,
  `Lit selected field did not measurably receive the occluder shadow: ${litReceive}`,
)
assert(unlitCast >= 300, `Unlit selected caster did not cast: ${unlitCast}`)
assert(litCast >= 300, `Lit selected caster did not cast: ${litCast}`)
assert(unlitLight <= 8, `Unlit selected field reacted to direct light: ${unlitLight}`)
assert(litLight >= 5_000, `Lit selected field did not react to direct light: ${litLight}`)

const sourceEevee = path.resolve(output, 'source-eevee.png')
const publishedUnlitEevee = path.resolve(output, 'published-unlit-eevee.png')
const publishedLitEevee = path.resolve(output, 'published-lit-eevee.png')
const imageComparisons = {
  blenderSourceToPublishedLitRmse: await rgbRmse(sourceEevee, publishedLitEevee),
  blenderSourceToPublishedUnlitRmse: await rgbRmse(sourceEevee, publishedUnlitEevee),
  blenderSourceToBrowserLitRmse: await rgbRmse(sourceEevee, captures.lit.screenshot),
  blenderSourceToBrowserUnlitRmse: await rgbRmse(sourceEevee, captures.unlit.screenshot),
}
assert(
  imageComparisons.blenderSourceToPublishedLitRmse
  < imageComparisons.blenderSourceToPublishedUnlitRmse,
  `The lit carrier did not preserve source Eevee semantics more closely: ${JSON.stringify(imageComparisons)}`,
)

const panels = await Promise.all([
  labeledImage(sourceEevee, 'Source Eevee · selected field → Principled'),
  labeledImage(captures.unlit.screenshot, 'Current transport · KHR_materials_unlit'),
  labeledImage(captures.lit.screenshot, 'Candidate transport · stock glTF PBR'),
])
const panelMeta = await sharp(panels[0]).metadata()
await sharp({
  create: {
    width: panelMeta.width * panels.length,
    height: panelMeta.height,
    channels: 4,
    background: '#101216',
  },
}).composite(panels.map((input, index) => ({
  input,
  left: index * panelMeta.width,
  top: 0,
}))).png().toFile(path.resolve(output, 'three-way-overview.png'))

const needleAddonExport = path.resolve(needleAddonRoot, 'blender_export.py')
const needleEngineLoader = path.resolve(needleEngineRoot, 'src', 'engine', 'engine_loaders.gltf.ts')
const needleThreeLoader = path.resolve(
  needleEngineRoot,
  'node_modules',
  'three',
  'examples',
  'jsm',
  'loaders',
  'GLTFLoader.js',
)
const report = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  verdict: {
    ordinarySelectedFields: 'preserve-lit-surface-response',
    explicitUnlitSkyOrEmissive: 'preserve-unlit-surface-response',
    reason: (
      'The identical selected-field texture remains color-addressable in both ' +
      'carriers, but only stock PBR responds to the Sun and receives its shadow. ' +
      'Both opaque carriers still cast shadows when the website enables them.'
    ),
  },
  sourceIdentity: {
    blender: blenderEvidence.blenderVersion,
    blendlink: packageVersion(path.resolve(repository, 'packages', 'blendlink', 'package.json')),
    blendlinkThree: packageVersion(path.resolve(repository, 'node_modules', 'three', 'package.json')),
    blendlinkMaterialCompilerSha256: sha256(path.resolve(
      repository,
      'packages',
      'blender-addon',
      'material_compiler.py',
    )),
    needleIntegrationStatus: 'mixed-source',
    needleAddon: {
      version: '1.4.2',
      exportPath: needleAddonExport.replaceAll('\\', '/'),
      exportSha256: sha256(needleAddonExport),
    },
    needleEngine: {
      version: packageVersion(path.resolve(needleEngineRoot, 'package.json')),
      loaderPath: needleEngineLoader.replaceAll('\\', '/'),
      loaderSha256: sha256(needleEngineLoader),
    },
    needleThree: {
      version: packageVersion(path.resolve(
        needleEngineRoot,
        'node_modules',
        'three',
        'package.json',
      )),
      gltfLoaderPath: needleThreeLoader.replaceAll('\\', '/'),
      gltfLoaderSha256: sha256(needleThreeLoader),
    },
  },
  needleBehavior: {
    relation: 'match-candidate',
    observation: (
      'Needle add-on 1.4.2 calls Blender stock glTF export without a material ' +
      'surface rewrite. Needle Engine 5.1.7 creates its GLTFLoader from its ' +
      'bundled Three; that loader maps ordinary core metallic-roughness to ' +
      'MeshStandardMaterial and KHR_materials_unlit to MeshBasicMaterial.'
    ),
    limit: (
      'This is exact per-package source evidence under integration=mixed-source, ' +
      'not a coherent Needle export-to-browser differential.'
    ),
  },
  blender: blenderEvidence,
  browser: {
    browserVersion: captures.lit.evidence.renderer.webglVersion,
    unlit: captures.unlit,
    lit: captures.lit,
  },
  imageComparisons,
  assertions: {
    identicalSelectedFieldTextureBytes: true,
    currentUnlitLoadsAsMeshBasic: true,
    candidateLitLoadsAsMeshStandard: true,
    unlitDoesNotReceiveOccluderShadow: true,
    litReceivesOccluderShadow: true,
    bothOpaqueVariantsCastShadow: true,
    unlitIgnoresDirectLight: true,
    litRespondsToDirectLight: true,
    blenderLitCarrierCloserToSourceEevee: true,
  },
  proposedInterface: {
    seam: 'material compiler planning',
    internalDecision: 'surfaceResponse: auto | lit | unlit',
    default: (
      'Auto follows the active Surface graph: any selected-field path through ' +
      'a BSDF is lit; a direct Background/Emission-only path is unlit; mixed or ' +
      'unreachable paths block until explicitly resolved.'
    ),
    artistOverride: (
      'One namespaced enum on the existing Blendlink Web Color marker, exposed ' +
      'only when Auto is ambiguous. No website configuration is required.'
    ),
    manifestImpact: (
      'No schema reshape is required: retain the existing selected-field ' +
      'transport, widen existing gltfEvidence.unlit from literal true to a ' +
      'boolean, and use the generated material-rule extra to attest the choice. ' +
      'An optional additive surfaceResponse diagnostic may be recorded.'
    ),
  },
  limits: [
    'The selected field is opaque, static, unit-range color on one UV set.',
    'The fixture proves ordinary diffuse/PBR response, not arbitrary Principled extensions.',
    'Chromium uses ANGLE/SwiftShader for deterministic pixels, not physical-GPU timing.',
    'Three and Eevee use different realtime shading implementations; only the Blender source-versus-published Blender comparison is an equal-renderer image claim.',
    'Cast/receive behavior also requires the application-owned renderer shadow map and mesh/light flags; material transport alone cannot enable them.',
    'The prototype does not alter production code or claim the current automatic classifier is implemented.',
  ],
}
writeFileSync(
  path.resolve(output, 'evidence.json'),
  `${JSON.stringify(report, null, 2)}\n`,
)
console.log(
  `BLENDLINK_SELECTED_FIELD_SURFACE_DIFFERENTIAL_PASSED ` +
  `receive=${unlitReceive}->${litReceive} cast=${unlitCast}/${litCast} ` +
  `light=${unlitLight}->${litLight} ` +
  `eeveeRmse=${imageComparisons.blenderSourceToPublishedUnlitRmse.toFixed(6)}` +
  `->${imageComparisons.blenderSourceToPublishedLitRmse.toFixed(6)}`,
)
