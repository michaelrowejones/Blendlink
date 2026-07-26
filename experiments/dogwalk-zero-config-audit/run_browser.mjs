import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const output = resolve(root, 'output')
const mode = process.argv[2] ?? 'stock-floor'
const modes = {
  'stock-floor': {
    glb: 'stock-needle-core-floor.glb',
    screenshot: 'stock-floor-authored-camera.png',
    evidence: 'stock-browser-evidence.json',
    classification:
      'research-only raw stock glTF in Three r184; no Blendlink or coherent Needle runtime',
  },
  'static-current-frame': {
    glb: 'static-current-frame-prototype.glb',
    screenshot: 'static-current-frame-authored-camera.png',
    evidence: 'static-current-frame-browser-evidence.json',
    classification:
      'prototype static authored-frame stock glTF in Three r184; not shipped Blendlink behavior',
  },
  'static-current-pose': {
    glb: 'static-current-pose-prototype.glb',
    screenshot: 'static-current-pose-authored-camera.png',
    evidence: 'static-current-pose-browser-evidence.json',
    classification:
      'prototype static authored-frame/current-pose stock glTF in Three r184; not shipped Blendlink behavior',
  },
  'current-pose-with-animations': {
    glb: 'current-pose-with-animations-prototype.glb',
    screenshot: 'current-pose-with-animations-authored-camera.png',
    evidence: 'current-pose-with-animations-browser-evidence.json',
    classification:
      'prototype authored-frame/current-pose stock glTF with actions in Three r184; not shipped Blendlink behavior',
  },
  'current-pose-shadows-off': {
    glb: 'current-pose-with-animations-prototype.glb',
    screenshot: 'current-pose-shadows-off.png',
    evidence: 'current-pose-shadows-off-browser-evidence.json',
    shadows: false,
    classification:
      'prototype authored-frame/current-pose stock glTF shadow control in Three r184; not shipped Blendlink behavior',
  },
  'current-pose-hide-shadow-casters': {
    glb: 'current-pose-with-animations-prototype.glb',
    screenshot: 'current-pose-hide-shadow-casters.png',
    evidence: 'current-pose-hide-shadow-casters-browser-evidence.json',
    shadows: false,
    hideShadowCasters: true,
    classification:
      'prototype authored-frame/current-pose stock glTF material-visibility control in Three r184; not shipped Blendlink behavior',
  },
  'current-pose-anisotropy-max': {
    glb: 'current-pose-with-animations-prototype.glb',
    screenshot: 'current-pose-anisotropy-max.png',
    evidence: 'current-pose-anisotropy-max-browser-evidence.json',
    shadows: false,
    anisotropy: 'max',
    classification:
      'prototype authored-frame/current-pose stock glTF anisotropy control in Three r184; not shipped Blendlink behavior',
  },
}
const selected = modes[mode]
if (!selected) throw new Error(`Unknown mode ${mode}`)
const playwrightModule = resolve(
  process.env.BLENDLINK_PLAYWRIGHT_MODULE ??
    resolve(repository, '../MichaelRoweJonesSite/node_modules/playwright/index.mjs'),
)
const { chromium } = await import(pathToFileURL(playwrightModule).href)
const executable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find(existsSync)
const sha256 = async (path) =>
  createHash('sha256').update(await readFile(path)).digest('hex')

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
  if (!address || typeof address === 'string') {
    throw new Error('Vite did not expose a TCP port')
  }
  browser = await chromium.launch({
    headless: true,
    ...(executable
      ? {
          executablePath: executable,
          args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
        }
      : {}),
  })
  const page = await browser.newPage({
    viewport: { width: 1000, height: 500 },
    deviceScaleFactor: 1,
  })
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const query = new URLSearchParams({ glb: selected.glb })
  if (selected.shadows === false) query.set('shadows', 'off')
  if (selected.hideShadowCasters) query.set('shadowCasters', 'hide')
  if (selected.anisotropy) query.set('anisotropy', selected.anisotropy)
  const url = `http://127.0.0.1:${address.port}/?${query}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForFunction(
    () => window.__dogwalkEvidence?.ready === true,
    undefined,
    { timeout: 180_000 },
  )
  const state = await page.evaluate(() => window.__dogwalkEvidence)
  if (state?.error) throw new Error(state.error)
  if (!state?.result) throw new Error('Browser did not publish DOGWALK evidence')
  if (pageErrors.length || consoleErrors.length) {
    throw new Error(
      `Browser errors: ${[...pageErrors, ...consoleErrors].join('; ')}`,
    )
  }
  const screenshot = resolve(output, selected.screenshot)
  await page.screenshot({ path: screenshot })
  const report = {
    schemaVersion: 1,
    classification: selected.classification,
    browser: await browser.version(),
    url,
    result: state.result,
    artifacts: {
      glbSha256: await sha256(resolve(output, selected.glb)),
      screenshotSha256: await sha256(screenshot),
      sourceSha256:
        '7f8718cfd89baf59151cc4ba431eeab38b9ff260ffa0054d93293f228a70cc36',
    },
    limitations: [
      'Uses the exported camera node with its default/rest transform and no animation playback.',
      selected.shadows === false
        ? 'Disables all Three shadows as a diagnostic control.'
        : 'Enables Three AgX and shadows but does not recreate Blender compositor, depth of field, ambient occlusion, or world nodes.',
      'Uses SwiftShader when system Chrome is available; it is not physical-GPU performance evidence.',
    ],
  }
  await writeFile(
    resolve(output, selected.evidence),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
