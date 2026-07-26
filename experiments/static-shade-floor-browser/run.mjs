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
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const here = import.meta.dirname
const repository = path.resolve(here, '..', '..')
const output = path.resolve(here, 'output')
const glbPath = path.resolve(output, 'static-shade-floor.glb')
const blender = process.env.BLENDLINK_BLENDER_PATH
  ?? 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
const playwrightCandidates = [
  process.env.BLENDLINK_PLAYWRIGHT_MODULE,
  path.resolve(repository, 'node_modules', 'playwright', 'index.mjs'),
  path.resolve(repository, '..', 'MichaelRoweJonesSite', 'node_modules', 'playwright', 'index.mjs'),
].filter(Boolean)
const playwrightModule = playwrightCandidates.find((candidate) => existsSync(candidate))

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function runBlender() {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(blender, [
      '--background',
      '--factory-startup',
      '--python-exit-code',
      '1',
      '--python',
      path.resolve(
        repository,
        'packages',
        'blender-addon',
        'tests',
        'material_compiler_check.py',
      ),
    ], {
      cwd: repository,
      env: {
        ...process.env,
        BLENDLINK_STATIC_FLOOR_BROWSER_OUTPUT: glbPath,
      },
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('close', resolve)
  })
  assert.equal(code, 0, `Blender material carrier gate exited with code ${code}`)
}

function glbJson(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'not a GLB')
  assert.equal(bytes.readUInt32LE(4), 2, 'unsupported GLB version')
  const jsonLength = bytes.readUInt32LE(12)
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'first GLB chunk is not JSON')
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim())
}

function closeVector(actual, expected, epsilon = 1e-6) {
  return actual.length === expected.length
    && actual.every((value, index) => Math.abs(value - expected[index]) <= epsilon)
}

mkdirSync(output, { recursive: true })
assert(existsSync(blender), `Blender executable is missing: ${blender}`)
assert(playwrightModule, 'Playwright is missing from Blendlink and the dogfood site')
if (process.env.BLENDLINK_STATIC_FLOOR_REUSE !== '1') {
  await runBlender()
} else {
  assert(existsSync(glbPath), `Reusable generated carrier is missing: ${glbPath}`)
}

const glbBytes = readFileSync(glbPath)
const glbSha256 = sha256Bytes(glbBytes)
const document = glbJson(glbBytes)
const material = document.materials.find((entry) =>
  entry.extras?.blendlink_material_rule
    === 'blendlink.lit.selected-field-static-shade-floor')
assert(material, 'generated factorized material is absent from final GLB JSON')
const pbr = material.pbrMetallicRoughness
assert(pbr?.baseColorTexture, 'generated factorized material has no baseColorTexture')
assert(material.emissiveTexture, 'generated factorized material has no emissiveTexture')
assert.equal(
  pbr.baseColorTexture.index,
  material.emissiveTexture.index,
  'final GLB does not reuse one Texture index for Base Color and Emission',
)
assert.deepEqual(material.extensions ?? {}, {}, 'factorized material gained an extension')
assert(closeVector(pbr.baseColorFactor, [0.7, 0.7, 0.7, 1]))
assert(closeVector(material.emissiveFactor, [0.356, 0.44, 0.594]))

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
let page
try {
  await server.listen()
  const address = server.httpServer.address()
  assert(address && typeof address !== 'string', 'Vite did not expose a port')
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? {
      executablePath,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    } : {}),
  })
  page = await browser.newPage({
    viewport: { width: 640, height: 640 },
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
  await page.goto(`http://127.0.0.1:${address.port}/`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  })
  await page.waitForFunction(
    () => window.__staticShadeFloorEvidence !== undefined,
    undefined,
    { timeout: 120_000 },
  )
  const evidence = await page.evaluate(() => window.__staticShadeFloorEvidence)
  assert.equal(
    evidence.ready,
    true,
    `browser carrier failed before verification: ${evidence.error ?? JSON.stringify(evidence)}`,
  )
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`)
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('; ')}`)
  assert.deepEqual(failedRequests, [], `failed requests: ${JSON.stringify(failedRequests)}`)
  assert.equal(evidence.glbSha256, glbSha256, 'browser did not parse the exact attested GLB bytes')
  assert.equal(evidence.material.type, 'MeshStandardMaterial')
  assert.equal(evidence.material.sharedMapIdentity, true)
  assert.deepEqual(evidence.material.mapSize, [256, 256])
  assert(closeVector(evidence.material.baseColorFactor, [0.7, 0.7, 0.7]))
  assert(closeVector(evidence.material.emissiveFactor, [0.356, 0.44, 0.594]))
  assert.equal(evidence.material.metallicFactor, 0)
  assert.equal(evidence.material.roughnessFactor, 0.5)
  assert(
    evidence.lightOff.count >= 20_000 && evidence.lightOff.meanLuma >= 10,
    `light-off frame did not retain a visible emissive floor: ${JSON.stringify(evidence.lightOff)}`,
  )
  assert(
    evidence.directResponse.changed >= 10_000
      && evidence.directResponse.meanAbsoluteRgb >= 1,
    `light-on frame did not add a measurable PBR direct term: ${JSON.stringify(evidence.directResponse)}`,
  )

  await page.evaluate(() => window.__setStaticShadeFloorLight?.(false))
  await page.locator('canvas').screenshot({
    path: path.resolve(output, 'light-off-static-floor.png'),
  })
  await page.evaluate(() => window.__setStaticShadeFloorLight?.(true))
  await page.locator('canvas').screenshot({
    path: path.resolve(output, 'light-on-static-floor-plus-direct.png'),
  })

  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    glb: {
      path: path.relative(repository, glbPath).replaceAll('\\', '/'),
      sha256: glbSha256,
      bytes: glbBytes.byteLength,
      sharedTextureIndex: pbr.baseColorTexture.index,
      baseColorFactor: pbr.baseColorFactor,
      emissiveFactor: material.emissiveFactor,
    },
    browser: evidence,
    screenshots: {
      lightOff: 'output/light-off-static-floor.png',
      lightOn: 'output/light-on-static-floor-plus-direct.png',
    },
    assertions: {
      exactFetchedGlbBytes: true,
      finalJsonSharedTextureIndex: true,
      loadsAsMeshStandardMaterial: true,
      sharedThreeTextureIdentity: true,
      lightOffRetainsStaticEmissiveFloor: true,
      lightOnAddsDirectPbrResponse: true,
    },
    limit: (
      'This proves the generated stock carrier and its truthful exact/approximate split. ' +
      'It does not claim that the broader Blender 4 Splash DPM.002 response matches the recognizer.'
    ),
  }
  writeFileSync(
    path.resolve(output, 'evidence.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
    `BLENDLINK_STATIC_SHADE_FLOOR_BROWSER_PASSED ` +
    `floor=${evidence.lightOff.count}px ` +
    `direct=${evidence.directResponse.changed}px ` +
    `sha256=${glbSha256}`,
  )
} finally {
  if (page) await page.close()
  if (browser) await browser.close()
  await server.close()
}
