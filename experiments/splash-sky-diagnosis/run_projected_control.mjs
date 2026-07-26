import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import {
  buildSemanticMasks,
  evaluateSplashFidelity,
} from '../splash-visual-fidelity-differential/metrics.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const splash = join(root, 'artifacts', 'release-dogfood', 'blender-4-splash')
const fixedCameraPrototype = join(root, 'experiments', 'eevee-fixed-camera-transport-prototype')
const output = join(here, 'output')
const paths = {
  reference: join(splash, 'blender-reference-selected-sky-0001.png'),
  current: join(splash, 'browser-evidence-blender-4-splash-selected-sky.png'),
  scene: join(
    splash,
    'public',
    'models',
    'blender40SplashSelectedSky',
    '3727e808731b5ac1550e15f4f0f0d37a533996685d9cb256030e289f68851fd2',
    'blender40SplashSelectedSky.glb',
  ),
  isolatedSky: join(output, 'isolated-sky.png'),
  three: join(root, 'node_modules', 'three'),
}

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
  throw new Error('Playwright is not installed in either workspace')
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
  throw new Error('Chrome/Chromium is unavailable')
}

function route(pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return join(fixedCameraPrototype, 'index.html')
  }
  if (pathname === '/main.mjs') return join(fixedCameraPrototype, 'main.mjs')
  if (pathname === '/assets/scene.glb') return paths.scene
  if (pathname === '/assets/isolated-sky.png') return paths.isolatedSky
  if (pathname === '/assets/eevee-reference.png') return paths.reference
  if (pathname.startsWith('/vendor/three/')) {
    const candidate = resolve(paths.three, pathname.slice('/vendor/three/'.length))
    if (!candidate.startsWith(`${paths.three}\\`)) throw new Error('Invalid vendor path')
    return candidate
  }
  return null
}

async function rgb(path) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

await mkdir(output, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    const path = route(new URL(request.url, 'http://127.0.0.1').pathname)
    if (!path) {
      response.writeHead(404)
      response.end('Not found')
      return
    }
    const bytes = await readFile(path)
    response.writeHead(200, {
      'Content-Type': {
        '.html': 'text/html',
        '.mjs': 'text/javascript',
        '.js': 'text/javascript',
        '.glb': 'model/gltf-binary',
        '.png': 'image/png',
      }[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    response.end(bytes)
  } catch (error) {
    response.writeHead(500)
    response.end(String(error))
  }
})
await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
const base = `http://127.0.0.1:${server.address().port}`
const { chromium } = await playwright()
const browser = await chromium.launch({
  executablePath: await chrome(chromium),
  headless: true,
})

const captures = {}
try {
  for (const [name, query] of [
    ['raw', '?mode=current&view=authored'],
    ['rawLinearNoMips', '?mode=current&view=authored&filter=linear-no-mips'],
    ['rawNearest', '?mode=current&view=authored&filter=nearest'],
    [
      'projectedSky',
      '?mode=projected&view=authored&surfaces=sky-patch&appearance=/assets/isolated-sky.png',
    ],
    [
      'projectedSkyOnly',
      '?mode=projected&view=authored&surfaces=backdrop-only&appearance=/assets/isolated-sky.png',
    ],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 600 },
      deviceScaleFactor: 1,
    })
    const failures = []
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(`console: ${message.text()}`)
    })
    page.on('pageerror', (error) => failures.push(`page: ${error.message}`))
    page.on('requestfailed', (request) => {
      failures.push(`request: ${request.url()} ${request.failure()?.errorText}`)
    })
    await page.goto(`${base}/${query}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__prototypeReady === true, null, {
      timeout: 120_000,
    })
    const capture = join(output, `${name}.png`)
    await page.screenshot({ path: capture })
    captures[name] = {
      path: capture,
      sha256: createHash('sha256').update(await readFile(capture)).digest('hex'),
      state: await page.evaluate(() => window.__prototypeState),
      failures,
    }
    await page.close()
  }
} finally {
  await browser.close()
  await new Promise((resolvePromise) => server.close(resolvePromise))
}

const reference = await rgb(paths.reference)
const masks = buildSemanticMasks(reference)
for (const capture of Object.values(captures)) {
  capture.fidelity = evaluateSplashFidelity(reference, await rgb(capture.path), masks)
}
const evidence = {
  schemaVersion: 1,
  kind: 'blendlink-splash-isolated-sky-projector-differential',
  inputs: Object.fromEntries(
    await Promise.all(
      Object.entries(paths)
        .filter(([key]) => key !== 'three')
        .map(async ([key, path]) => [
          key,
          {
            path,
            sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
          },
        ]),
    ),
  ),
  captures,
  passed:
    captures.raw.failures.length === 0 &&
    captures.projectedSky.failures.length === 0 &&
    captures.projectedSky.state.patchedMeshCount === 1 &&
    captures.projectedSkyOnly.failures.length === 0 &&
    captures.projectedSkyOnly.fidelity.symptoms['noisy-or-incorrect-sky'].passed,
}
await writeFile(join(output, 'projected-control-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify(evidence, null, 2))
if (!evidence.passed) process.exitCode = 1
