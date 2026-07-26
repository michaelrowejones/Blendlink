import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { createServer } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const output = join(here, 'output')
await mkdir(output, { recursive: true })

async function playwright() {
  for (const candidate of [
    join(root, 'node_modules', 'playwright', 'index.mjs'),
    join(dirname(root), 'MichaelRoweJonesSite', 'node_modules', 'playwright', 'index.mjs'),
  ]) {
    try {
      await access(candidate, fsConstants.R_OK)
      return await import(pathToFileURL(candidate).href)
    } catch {
      // Try the next installed workspace dependency.
    }
  }
  throw new Error('Playwright is unavailable in the Blendlink and dogfood workspaces.')
}

async function chrome(chromium) {
  for (const candidate of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    chromium.executablePath(),
  ]) {
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // Try the next browser.
    }
  }
  throw new Error('Chrome/Chromium is unavailable.')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function pixel(path, point) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const x = Math.max(0, Math.min(info.width - 1, point.x))
  const y = Math.max(0, Math.min(info.height - 1, point.y))
  const offset = (y * info.width + x) * info.channels
  return [...data.subarray(offset, offset + 3)]
}

const vite = await createServer({
  root: here,
  server: {
    host: '127.0.0.1',
    port: 0,
    fs: { allow: [root] },
  },
  optimizeDeps: { noDiscovery: true },
  logLevel: 'error',
})
await vite.listen()
const address = vite.httpServer.address()
if (!address || typeof address === 'string') throw new Error('Vite did not expose a local port.')
const url = `http://127.0.0.1:${address.port}/`
const { chromium } = await playwright()
const browser = await chromium.launch({
  executablePath: await chrome(chromium),
  headless: true,
})

const failures = []
let evidence
const projectedPath = join(output, 'projected-surface.png')
const restoredPath = join(output, 'restored-surface.png')
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 400 },
    deviceScaleFactor: 1,
  })
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`))
  page.on('requestfailed', (request) => {
    failures.push(`request: ${request.url()} ${request.failure()?.errorText}`)
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__fixedCameraSurfaceReady === true)
  evidence = await page.evaluate(() => window.__fixedCameraSurfaceEvidence)
  await page.screenshot({ path: projectedPath })
  const disposed = await page.evaluate(() => window.__disposeFixedCameraSurface())
  await page.screenshot({ path: restoredPath })
  evidence.disposed = disposed
  await page.close()
} finally {
  await browser.close()
  await vite.close()
}

assert(failures.length === 0, `browser failures: ${failures.join('; ')}`)
assert(evidence.geometryPreserved === true, 'selected receiver geometry was replaced')
assert(evidence.foregroundMaterialPreserved === true, 'unrelated material was replaced')
assert(evidence.installedMaterialChanged === true, 'selected material was not replaced')
assert(evidence.installedMaterialType === 'MeshBasicMaterial', 'projector is not unlit MeshBasicMaterial')
assert(evidence.bindingCount === 1 && evidence.materialCount === 1, 'binding/material counts drifted')
assert(evidence.raycast?.object === 'Selected surface primitive', 'retained receiver no longer raycasts')
assert(/viewport aspect/i.test(evidence.wrongAspectError), 'wrong aspect did not fail loudly')
assert(/camera matrix changed/i.test(evidence.movedCameraError), 'moved camera did not fail loudly')
assert(evidence.disposed?.materialRestored === true, 'dispose did not restore the authored material')
assert(evidence.disposed?.geometryPreserved === true, 'dispose changed receiver geometry')
assert(evidence.disposed?.installedMaterialDisposed === true, 'dispose leaked its projected material')

const projectedReceiver = await pixel(projectedPath, evidence.samplePoints.receiver)
const restoredReceiver = await pixel(restoredPath, evidence.samplePoints.receiver)
const projectedForeground = await pixel(projectedPath, evidence.samplePoints.foreground)
const restoredForeground = await pixel(restoredPath, evidence.samplePoints.foreground)
assert(
  projectedReceiver[1] > projectedReceiver[0] && projectedReceiver[2] > projectedReceiver[0],
  `projected receiver is not cyan: ${projectedReceiver}`,
)
assert(
  restoredReceiver[0] > restoredReceiver[1] && restoredReceiver[0] > restoredReceiver[2],
  `restored receiver is not authored orange: ${restoredReceiver}`,
)
assert(
  projectedForeground.every((value, index) => value === restoredForeground[index]),
  `unrelated foreground pixels changed: ${projectedForeground} -> ${restoredForeground}`,
)

const sourcePath = join(root, 'packages', 'blendlink', 'src', 'threeFixedCameraAppearance.ts')
const result = {
  schemaVersion: 1,
  kind: 'blendlink-fixed-camera-surface-browser-differential',
  status: 'prototype',
  source: {
    path: 'packages/blendlink/src/threeFixedCameraAppearance.ts',
    sha256: createHash('sha256').update(await readFile(sourcePath)).digest('hex'),
  },
  browser: {
    chrome: true,
    webgl2: evidence.webgl2,
    failures,
  },
  evidence,
  pixels: {
    projectedReceiver,
    restoredReceiver,
    projectedForeground,
    restoredForeground,
  },
  captures: {
    projected: {
      path: 'experiments/fixed-camera-surface-browser/output/projected-surface.png',
      sha256: createHash('sha256').update(await readFile(projectedPath)).digest('hex'),
    },
    restored: {
      path: 'experiments/fixed-camera-surface-browser/output/restored-surface.png',
      sha256: createHash('sha256').update(await readFile(restoredPath)).digest('hex'),
    },
  },
  boundary:
    'This proves the package-owned runtime projector on one synthetic static opaque surface. ' +
    'It does not prove compiler capture, manifest/asset-graph publication, R3F lifecycle, or Splash production parity.',
}
await writeFile(join(output, 'evidence.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(
  `BLENDLINK_FIXED_CAMERA_SURFACE_BROWSER_PASSED ` +
    `projected=${projectedReceiver.join(',')} restored=${restoredReceiver.join(',')} ` +
    `raycast=${evidence.raycast.distance.toFixed(6)}`,
)
