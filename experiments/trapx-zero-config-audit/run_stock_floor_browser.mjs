import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, '..', '..')
const output = join(here, 'output')
const glbPath = join(output, 'blendlink', 'trapxUntouched.glb')
const sourceFramePath = join(output, 'source-cycles-camera-frame-0000.png')
const screenshotPath = join(output, 'retained-stock-floor-authored-camera.png')
const evidencePath = join(output, 'retained-stock-floor-browser-evidence.json')

async function loadPlaywright() {
  const candidates = [
    join(repository, 'node_modules', 'playwright', 'index.mjs'),
    join(
      dirname(repository),
      'MichaelRoweJonesSite',
      'node_modules',
      'playwright',
      'index.mjs',
    ),
  ]
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.R_OK)
      return {
        module: await import(pathToFileURL(candidate).href),
        packageJson: join(dirname(candidate), 'package.json'),
      }
    } catch {
      // Try the next installed workspace dependency.
    }
  }
  throw new Error('Playwright is unavailable in Blendlink and the dogfood site.')
}

async function findChrome(chromium) {
  for (const candidate of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    chromium.executablePath(),
  ]) {
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error('Chrome/Chromium is unavailable.')
}

const sha256 = async (path) =>
  createHash('sha256').update(await readFile(path)).digest('hex')

async function rgb(path) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== 1080 || info.height !== 1080 || info.channels !== 3) {
    throw new Error(`Unexpected comparison image: ${JSON.stringify(info)}`)
  }
  return data
}

function compare(source, floor) {
  const count = source.length / 3
  let absolute = 0
  let unionAbsolute = 0
  let unionChannels = 0
  let sourceForeground = 0
  let floorForeground = 0
  let intersection = 0
  let union = 0
  const sourceMean = [0, 0, 0]
  const floorMean = [0, 0, 0]
  for (let offset = 0; offset < source.length; offset += 3) {
    const sourceMask =
      source[offset] + source[offset + 1] + source[offset + 2] > 30
    const floorMask = floor[offset] + floor[offset + 1] + floor[offset + 2] > 30
    if (sourceMask) sourceForeground += 1
    if (floorMask) floorForeground += 1
    if (sourceMask && floorMask) intersection += 1
    if (sourceMask || floorMask) union += 1
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(
        source[offset + channel] - floor[offset + channel],
      )
      absolute += difference
      if (sourceMask || floorMask) {
        unionAbsolute += difference
        unionChannels += 1
      }
      if (sourceMask) sourceMean[channel] += source[offset + channel]
      if (floorMask) floorMean[channel] += floor[offset + channel]
    }
  }
  return {
    dimensions: [1080, 1080],
    allPixelMeanAbsoluteError: absolute / (count * 3),
    unionForegroundMeanAbsoluteError: unionAbsolute / unionChannels,
    silhouette: {
      thresholdRgbSum: 30,
      sourceForeground,
      floorForeground,
      intersection,
      union,
      intersectionOverUnion: intersection / union,
    },
    foregroundMeanRgb: {
      source: sourceMean.map((value) => value / sourceForeground),
      floor: floorMean.map((value) => value / floorForeground),
    },
  }
}

const vite = await createServer({
  root: here,
  server: {
    host: '127.0.0.1',
    port: 0,
    fs: { allow: [repository] },
  },
  optimizeDeps: { noDiscovery: true },
  logLevel: 'error',
})
await vite.listen()
const address = vite.httpServer.address()
if (!address || typeof address === 'string') {
  throw new Error('Vite did not expose a local port.')
}

const playwright = await loadPlaywright()
const { chromium } = playwright.module
const chrome = await findChrome(chromium)
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
})

const failures = []
let result
let browserVersion
try {
  browserVersion = await browser.version()
  const page = await browser.newPage({
    viewport: { width: 1080, height: 1080 },
    deviceScaleFactor: 1,
  })
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`))
  page.on('requestfailed', (request) => {
    failures.push(`request: ${request.url()} ${request.failure()?.errorText}`)
  })
  await page.goto(
    `http://127.0.0.1:${address.port}/stock_floor.html`,
    { waitUntil: 'networkidle', timeout: 120_000 },
  )
  await page.waitForFunction(
    () => window.__trapxStockFloor?.ready === true,
    undefined,
    { timeout: 180_000 },
  )
  const state = await page.evaluate(() => window.__trapxStockFloor)
  if (state?.error) throw new Error(state.error)
  if (!state?.result) throw new Error('Browser did not publish stock-floor evidence.')
  result = state.result
  await page.locator('canvas').screenshot({ path: screenshotPath })
  await page.close()
} finally {
  await browser.close()
  await vite.close()
}

if (failures.length > 0) {
  throw new Error(`Browser failures: ${failures.join('; ')}`)
}
if (result.counts.meshes !== 1 || result.counts.lights !== 2) {
  throw new Error(`Unexpected structural floor: ${JSON.stringify(result.counts)}`)
}
if (result.materials[0]?.transparent !== false) {
  throw new Error('The stock floor was expected to load as opaque.')
}
if (result.materials[0]?.transmission !== 0) {
  throw new Error('The stock floor unexpectedly gained optical transmission.')
}
if (result.pixels.nonBlack < 100_000) {
  throw new Error(`The stock floor is visibly empty: ${result.pixels.nonBlack}`)
}

const comparison = compare(
  await rgb(sourceFramePath),
  await rgb(screenshotPath),
)
const threePackage = resolve(repository, 'node_modules/three/package.json')
const gltfLoader = resolve(
  repository,
  'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
)
const evidence = {
  schemaVersion: 1,
  kind: 'trapx-retained-stock-core-floor-browser',
  status: 'verified-structural-floor',
  classification:
    'Retained pre-fix stock Blender glTF loaded in raw Three r184. It is a material/structure floor equivalent to the core exporter path delegated by inspected Needle 1.4.2, not a coherent Needle runtime result and not a successful current Blendlink publication.',
  sourceTruth: {
    engine: 'CYCLES',
    camera: 'Camera',
    frame: 0,
    reviewTransport: 'authored H264 decoded to Chromium canvas',
  },
  browser: {
    executable: chrome,
    version: browserVersion,
    playwrightVersion: JSON.parse(
      await readFile(playwright.packageJson, 'utf8'),
    ).version,
    failures,
  },
  toolchain: {
    threeVersion: JSON.parse(await readFile(threePackage, 'utf8')).version,
    threePackageSha256: await sha256(threePackage),
    gltfLoaderSha256: await sha256(gltfLoader),
  },
  result,
  comparison,
  artifacts: {
    sourceReviewFrame: {
      path:
        'experiments/trapx-zero-config-audit/output/' +
        'source-cycles-camera-frame-0000.png',
      sha256: await sha256(sourceFramePath),
    },
    retainedStockGlb: {
      path:
        'experiments/trapx-zero-config-audit/output/' +
        'blendlink/trapxUntouched.glb',
      sha256: await sha256(glbPath),
    },
    screenshot: {
      path:
        'experiments/trapx-zero-config-audit/output/' +
        'retained-stock-floor-authored-camera.png',
      sha256: await sha256(screenshotPath),
    },
  },
  limitations: [
    'Raw Three core load only; no coherent Needle runtime/postprocessing result was executed.',
    'The retained GLB predates the current Final material gate and is not accepted publication evidence.',
    'Three uses NoToneMapping, sRGB output, no shadow map, no environment, and no Blender compositor.',
    'SwiftShader proves deterministic browser correctness, not physical-GPU performance.',
    'The source reference is H264-decoded human-review evidence, so image metrics are descriptive rather than release thresholds.',
  ],
}
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(
  `BLENDLINK_TRAPX_STOCK_FLOOR_BROWSER_VERIFIED ` +
    `glb=${evidence.artifacts.retainedStockGlb.sha256} ` +
    `png=${evidence.artifacts.screenshot.sha256} ` +
    `visible=${result.pixels.nonBlack} ` +
    `iou=${comparison.silhouette.intersectionOverUnion.toFixed(6)} ` +
    `mae=${comparison.allPixelMeanAbsoluteError.toFixed(6)}`,
)
