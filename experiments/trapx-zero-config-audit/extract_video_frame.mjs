import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, '..', '..')
const output = join(here, 'output')
const videoPath = join(output, 'source-authored-frame00000-0000.mp4')
const screenshotPath = join(output, 'source-cycles-camera-frame-0000.png')
await mkdir(output, { recursive: true })

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

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
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
})

const failures = []
let video
try {
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
    `http://127.0.0.1:${address.port}/video_review.html`,
    { waitUntil: 'networkidle' },
  )
  await page.waitForFunction(() => window.__trapxVideoReady === true)
  video = await page.evaluate(() => window.__trapxVideoEvidence)
  await page.locator('#review').screenshot({ path: screenshotPath })
  await page.close()
} finally {
  await browser.close()
  await vite.close()
}

if (failures.length > 0) {
  throw new Error(`Browser failures: ${failures.join('; ')}`)
}
if (
  video.videoWidth !== 1080 ||
  video.videoHeight !== 1080 ||
  video.canvasWidth !== 1080 ||
  video.canvasHeight !== 1080
) {
  throw new Error(`Unexpected authored frame dimensions: ${JSON.stringify(video)}`)
}

const evidence = {
  schemaVersion: 1,
  kind: 'trapx-authored-cycles-frame-review-extraction',
  status: 'verified',
  sourceTruth: {
    engine: 'CYCLES',
    camera: 'Camera',
    frame: 0,
    resolution: [1080, 1080],
  },
  transport:
    'Blender authored one-frame FFMPEG/H264 output decoded by Chromium and copied to an sRGB canvas for human review. This is not a lossless raw render.',
  browser: {
    executable: chrome,
    playwrightVersion: JSON.parse(
      await readFile(playwright.packageJson, 'utf8'),
    ).version,
    failures,
  },
  video,
  artifacts: {
    authoredVideo: {
      path:
        'experiments/trapx-zero-config-audit/output/' +
        'source-authored-frame00000-0000.mp4',
      sha256: await sha256(videoPath),
    },
    reviewFrame: {
      path:
        'experiments/trapx-zero-config-audit/output/' +
        'source-cycles-camera-frame-0000.png',
      sha256: await sha256(screenshotPath),
    },
  },
}
await writeFile(
  join(output, 'source-video-frame-evidence.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
)
console.log(
  `BLENDLINK_TRAPX_AUTHORED_FRAME_EXTRACTED ` +
    `video=${evidence.artifacts.authoredVideo.sha256} ` +
    `png=${evidence.artifacts.reviewFrame.sha256}`,
)
