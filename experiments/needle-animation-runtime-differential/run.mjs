import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '../../node_modules/vite/dist/node/index.js'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const output = resolve(root, 'output')
const deformationOutput = resolve(
  repository,
  'experiments/animation-deformation-browser/output',
)
const coherent = resolve(repository, 'experiments/needle-coherent-addon-1.4.2')
const defaultPlaywright = resolve(
  repository,
  '../MichaelRoweJonesSite/node_modules/playwright/index.mjs',
)
const playwrightModule = resolve(process.env.BLENDLINK_PLAYWRIGHT_MODULE ?? defaultPlaywright)
const { chromium } = await import(pathToFileURL(playwrightModule).href)
const chromiumCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const systemChromium = chromiumCandidates.find((candidate) => existsSync(candidate))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalized(path) {
  return relative(repository, path).replaceAll('\\', '/')
}

function manifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function parseGlbJson(path) {
  const bytes = readFileSync(path)
  assert(bytes.toString('ascii', 0, 4) === 'glTF', 'shared fixture was not a binary glTF')
  const jsonLength = bytes.readUInt32LE(12)
  const jsonType = bytes.readUInt32LE(16)
  assert(jsonType === 0x4e4f534a, 'shared fixture first GLB chunk was not JSON')
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trimEnd())
}

function isExpectedOfflineExternal(url, text) {
  const expected =
    url.startsWith('https://www.gstatic.com/draco/') ||
    url.startsWith('https://fonts.googleapis.com/') ||
    url.startsWith('https://needle.tools/api/v1/rum/t')
  return expected && text.includes('ERR_NETWORK_ACCESS_DENIED')
}

mkdirSync(output, { recursive: true })

const glbPath = resolve(deformationOutput, 'animation-deformation-fixture.glb')
const referencePath = resolve(deformationOutput, 'blender-reference.json')
const blendlinkEvidencePath = resolve(deformationOutput, 'evidence.json')
for (const path of [glbPath, referencePath, blendlinkEvidencePath]) {
  assert(
    existsSync(path),
    `shared deformation artifact is missing: ${path}; run ` +
      'node experiments/animation-deformation-browser/run.mjs first',
  )
}

const blendlinkEvidence = manifest(blendlinkEvidencePath)
const glbJson = parseGlbJson(glbPath)
assert(
  sha256(glbPath) === blendlinkEvidence.artifacts.glbSha256,
  'shared GLB bytes no longer match the Blendlink deformation evidence',
)
assert(
  sha256(referencePath) === blendlinkEvidence.artifacts.referenceSha256,
  'shared Blender oracle bytes no longer match the Blendlink deformation evidence',
)
assert(
  !JSON.stringify(glbJson).includes('NEEDLE_components'),
  'shared GLB unexpectedly contains NEEDLE_components metadata',
)

const engineManifestPath = resolve(coherent, 'node_modules/@needle-tools/engine/package.json')
const projectThreeManifestPath = resolve(coherent, 'node_modules/three/package.json')
const engineThreeManifestPath = resolve(
  coherent,
  'node_modules/@needle-tools/engine/node_modules/three/package.json',
)
const engineManifest = manifest(engineManifestPath)
const projectThreeManifest = manifest(projectThreeManifestPath)
const engineThreeManifest = manifest(engineThreeManifestPath)
assert(engineManifest.version === '5.1.4', `expected Needle Engine 5.1.4, got ${engineManifest.version}`)
assert(projectThreeManifest.version === '0.169.21', `expected project Three 0.169.21, got ${projectThreeManifest.version}`)
assert(engineThreeManifest.version === '0.169.19', `expected Engine Three 0.169.19, got ${engineThreeManifest.version}`)
const npmExecutable =
  process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm'
const npmArguments =
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd ls --all']
    : ['ls', '--all']
const npmLsRun = spawnSync(npmExecutable, npmArguments, {
  cwd: coherent,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 120_000,
  maxBuffer: 16 * 1024 * 1024,
})
assert(
  npmLsRun.status === 0,
  `coherent Needle fixture failed npm ls --all (exit ${npmLsRun.status}):\n` +
    `${String(npmLsRun.error ?? '')}\n` +
    `${String(npmLsRun.stdout ?? '')}\n${String(npmLsRun.stderr ?? '')}`,
)
const npmLsOutput = `${npmLsRun.stdout ?? ''}${npmLsRun.stderr ?? ''}`

const decoderRoots = {
  '/experiments/needle-animation-runtime-differential/include/draco/': resolve(
    coherent,
    'node_modules/@needle-tools/engine/node_modules/three/examples/jsm/libs/draco/gltf',
  ),
  '/experiments/needle-animation-runtime-differential/include/ktx2/': resolve(
    coherent,
    'node_modules/@needle-tools/engine/node_modules/three/examples/jsm/libs/basis',
  ),
}

const server = await createServer({
  root: repository,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  plugins: [{
    name: 'serve-exact-installed-needle-decoder-fallbacks',
    configureServer(viteServer) {
      viteServer.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
        for (const [prefix, directory] of Object.entries(decoderRoots)) {
          if (!pathname.startsWith(prefix)) continue
          const name = basename(pathname)
          const file = resolve(directory, name)
          if (!existsSync(file)) {
            response.statusCode = 404
            response.end(`Installed Needle decoder file is missing: ${name}`)
            return
          }
          response.setHeader(
            'Content-Type',
            name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
          )
          response.end(readFileSync(file))
          return
        }
        next()
      })
    },
  }],
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
  if (!address || typeof address === 'string') throw new Error('Vite did not expose its port')
  const url =
    `http://127.0.0.1:${address.port}/experiments/` +
    'needle-animation-runtime-differential/index.html'
  browser = await chromium.launch({
    headless: true,
    ...(systemChromium ? {
      executablePath: systemChromium,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    } : {}),
  })
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 1,
  })
  const pageErrors = []
  const consoleErrors = []
  const failedRequests = []
  const httpErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({
        text: message.text(),
        location: message.location(),
      })
    }
  })
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText ?? 'unknown request failure',
    })
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      httpErrors.push({
        url: response.url(),
        status: response.status(),
      })
    }
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => window.__needleAnimationRuntimeEvidence?.ready === true,
    undefined,
    { timeout: 60_000 },
  )
  const browserState = await page.evaluate(() => ({
    evidence: window.__needleAnimationRuntimeEvidence?.evidence,
    errors: window.__needleAnimationRuntimeEvidence?.errors ?? [],
  }))
  assert(browserState.errors.length === 0, `browser fixture errors: ${browserState.errors.join('; ')}`)
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`)
  assert(browserState.evidence, 'browser did not publish Needle animation evidence')
  const unexpectedConsoleErrors = consoleErrors.filter(
    (entry) => !isExpectedOfflineExternal(entry.location.url, entry.text),
  )
  const unexpectedFailedRequests = failedRequests.filter(
    (entry) => !isExpectedOfflineExternal(entry.url, entry.error),
  )
  assert(
    unexpectedConsoleErrors.length === 0,
    `unexpected console errors: ${JSON.stringify(unexpectedConsoleErrors)}`,
  )
  assert(
    unexpectedFailedRequests.length === 0,
    `unexpected failed requests: ${JSON.stringify(unexpectedFailedRequests)}`,
  )
  assert(httpErrors.length === 0, `HTTP error responses: ${JSON.stringify(httpErrors)}`)
  const evidence = browserState.evidence

  assert(
    evidence.engineAdvertisedVersion === '0.0.0',
    `unbundled Needle runtime advertised unexpected version ${evidence.engineAdvertisedVersion}`,
  )
  assert(evidence.loadingPath === '<needle-engine src autoplay>', 'fixture bypassed Needle web-component loading')
  assert(
    evidence.playbackPath === 'Animation.play(exclusive:false)/pause/time/update',
    'fixture bypassed Needle Animation component playback',
  )
  assert(evidence.component.constructorName === 'Animation', `expected Animation component, got ${evidence.component.constructorName}`)
  assert(evidence.component.autoCreatedWithoutNeedleComponentMetadata, 'fixture did not exercise metadata-free autoplay fallback')
  assert(
    evidence.component.initialAutoplayActionNames.length === 1,
    `expected Needle fallback to start one clip, got ${evidence.component.initialAutoplayActionNames.length}`,
  )
  assert(
    evidence.component.actionCount === evidence.clipNames.length,
    `expected one action per clip, got ${evidence.component.actionCount} for ${evidence.clipNames.length}`,
  )
  assert(
    evidence.component.coordinatedClipCount === evidence.clipNames.length,
    `coordinated ${evidence.component.coordinatedClipCount} of ${evidence.clipNames.length} clips`,
  )
  assert(evidence.component.playReturnedPromise, 'Animation.play did not return its runtime completion promise')
  assert(evidence.component.registeredMixerCount === 1, `expected one registered Needle mixer, got ${evidence.component.registeredMixerCount}`)
  assert(evidence.samples.length === 9, `expected nine samples, got ${evidence.samples.length}`)
  assert(
    evidence.maxima.transformPositionError <= 2e-5,
    `transform position error ${evidence.maxima.transformPositionError} exceeded 2e-5`,
  )
  assert(
    evidence.keyMaxima.transformQuaternionAngleRadians <= 2e-4,
    `key quaternion error ${evidence.keyMaxima.transformQuaternionAngleRadians} exceeded 2e-4 rad`,
  )
  assert(
    evidence.maxima.transformQuaternionAngleRadians <= 1e-3,
    `subframe quaternion error ${evidence.maxima.transformQuaternionAngleRadians} exceeded 1e-3 rad`,
  )
  assert(
    evidence.maxima.morphInfluenceError <= 2e-5,
    `morph influence error ${evidence.maxima.morphInfluenceError} exceeded 2e-5`,
  )
  assert(
    evidence.maxima.deformedPointHausdorff <= 2e-4,
    `deformed point Hausdorff ${evidence.maxima.deformedPointHausdorff} exceeded 2e-4`,
  )
  assert(
    evidence.pixels.nonBackground > 10_000,
    `Needle render had only ${evidence.pixels.nonBackground} non-background pixels`,
  )
  assert(
    evidence.pixels.chromatic > 5_000,
    `Needle render had only ${evidence.pixels.chromatic} chromatic pixels`,
  )
  assert(evidence.crossCopy.loadedRootIsEngineObject3D, 'loaded root was not an Engine-copy Object3D')
  assert(evidence.crossCopy.skinnedMeshIsEngineSkinnedMesh, 'loaded mesh was not an Engine-copy SkinnedMesh')
  assert(evidence.crossCopy.componentMixerIsEngineAnimationMixer, 'component mixer was not from Engine Three')
  assert(evidence.crossCopy.projectVectorAcceptedByLoadedObject, 'Engine Object3D rejected a project-copy Vector3 result target')
  assert(
    evidence.crossCopy.projectVectorPositionDelta <= 1e-12,
    `project-copy Vector3 interop changed position by ${evidence.crossCopy.projectVectorPositionDelta}`,
  )

  const screenshotPath = resolve(output, 'needle-animation-runtime-browser.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  const engineScreenshotPath = resolve(output, 'needle-animation-runtime-canvas.png')
  await page.locator('#stage').screenshot({ path: engineScreenshotPath })
  const disposal = await page.evaluate(
    () => window.__needleAnimationRuntimeEvidence?.dispose(),
  )
  assert(disposal?.elementDisconnected, 'Needle element remained connected after disposal')
  assert(disposal?.elementContextCleared, 'Needle element retained its Context after disposal')
  assert(disposal?.rendererClearedFromContext, 'Needle Context retained its renderer after disposal')
  assert(disposal?.registeredMixersAfterDispose === 0, 'Needle Context retained registered animation mixers')
  assert(disposal?.actionsRunningAfterDispose === 0, 'Needle Animation actions remained running after disposal')

  const sources = {
    experimentPage: resolve(root, 'index.html'),
    experimentBrowser: resolve(root, 'main.ts'),
    experimentRunner: resolve(root, 'run.mjs'),
    experimentResearch: resolve(root, 'README.md'),
    coherentPackage: resolve(coherent, 'package.json'),
    coherentLock: resolve(coherent, 'package-lock.json'),
    needleEngineManifest: engineManifestPath,
    needleEngineEntry: resolve(coherent, 'node_modules/@needle-tools/engine/lib/needle-engine.js'),
    needleEngineConstants: resolve(
      coherent,
      'node_modules/@needle-tools/engine/src/engine/engine_constants.ts',
    ),
    needleWebComponent: resolve(
      coherent,
      'node_modules/@needle-tools/engine/src/engine/webcomponents/needle-engine.ts',
    ),
    needleLoader: resolve(
      coherent,
      'node_modules/@needle-tools/engine/src/engine/engine_loaders.ts',
    ),
    needleAnimationAutoplay: resolve(
      coherent,
      'node_modules/@needle-tools/engine/src/engine-components/AnimationUtilsAutoplay.ts',
    ),
    needleAnimationComponent: resolve(
      coherent,
      'node_modules/@needle-tools/engine/src/engine-components/Animation.ts',
    ),
    needleAnimationRegistry: resolve(
      coherent,
      'node_modules/@needle-tools/engine/src/engine/engine_animation.ts',
    ),
    needleContext: resolve(
      coherent,
      'node_modules/@needle-tools/engine/src/engine/engine_context.ts',
    ),
    projectThreeManifest: projectThreeManifestPath,
    engineThreeManifest: engineThreeManifestPath,
    engineThreeAnimationMixer: resolve(
      coherent,
      'node_modules/@needle-tools/engine/node_modules/three/src/animation/AnimationMixer.js',
    ),
    engineThreeSkinnedMesh: resolve(
      coherent,
      'node_modules/@needle-tools/engine/node_modules/three/src/objects/SkinnedMesh.js',
    ),
    engineDracoDecoder: resolve(
      coherent,
      'node_modules/@needle-tools/engine/node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js',
    ),
    engineDracoWasm: resolve(
      coherent,
      'node_modules/@needle-tools/engine/node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm',
    ),
    engineBasisTranscoder: resolve(
      coherent,
      'node_modules/@needle-tools/engine/node_modules/three/examples/jsm/libs/basis/basis_transcoder.js',
    ),
    engineBasisWasm: resolve(
      coherent,
      'node_modules/@needle-tools/engine/node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm',
    ),
    sharedGlb: glbPath,
    sharedBlenderOracle: referencePath,
    blendlinkDifferentialEvidence: blendlinkEvidencePath,
  }
  for (const [name, path] of Object.entries(sources)) {
    assert(existsSync(path), `source ${name} is missing: ${path}`)
  }

  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    browser: await browser.version(),
    url,
    scope: {
      capabilityId: 'NDL-ANM-001',
      claim: 'Needle runtime-only animation/deformation differential',
      addonPipelineEndToEndCoherence: false,
      reason:
        'The shared GLB was exported by Blendlink, then independently loaded and ' +
        'played through the exact add-on-selected Needle runtime package stack.',
    },
    versions: {
      needleEngine: engineManifest.version,
      projectThreePackage: `${projectThreeManifest.name}@${projectThreeManifest.version}`,
      engineThreePackage: `${engineThreeManifest.name}@${engineThreeManifest.version}`,
      vite: manifest(resolve(repository, 'node_modules/vite/package.json')).version,
      playwright: manifest(resolve(
        repository,
        '../MichaelRoweJonesSite/node_modules/playwright/package.json',
      )).version,
    },
    coherentTree: {
      command: 'npm ls --all',
      exitCode: npmLsRun.status,
      outputLines: npmLsOutput.trimEnd().split(/\r?\n/).length,
      outputSha256: sha256Text(npmLsOutput),
    },
    glbStructure: {
      extensionsUsed: glbJson.extensionsUsed ?? [],
      extensionsRequired: glbJson.extensionsRequired ?? [],
      containsNeedleComponents: false,
      animationNames: (glbJson.animations ?? []).map((animation) => animation.name),
    },
    sources: Object.fromEntries(
      Object.entries(sources).map(([name, path]) => [
        name,
        {
          path: normalized(path),
          sha256: sha256(path),
        },
      ]),
    ),
    artifacts: {
      sharedBlendSha256: blendlinkEvidence.artifacts.blendSha256,
      sharedGlbSha256: sha256(glbPath),
      sharedReferenceSha256: sha256(referencePath),
      screenshotSha256: sha256(screenshotPath),
      canvasSha256: sha256(engineScreenshotPath),
    },
    pageErrors,
    consoleErrors,
    failedRequests,
    httpErrors,
    expectedOfflineExternalFailures: {
      console: consoleErrors.length,
      requests: failedRequests.length,
    },
    unexpectedConsoleErrors,
    unexpectedFailedRequests,
    evidence,
    disposal,
    assertions: {
      exactNeedleEnginePackage: true,
      exactProjectAndNestedThreePackages: true,
      sameGlbAndBlenderOracleAsBlendlinkDifferential: true,
      needleWebComponentLoader: true,
      metadataFreeNeedleAnimationFallback: true,
      defaultAutoplayStartsOneOfThreeIndependentClips: true,
      developerCoordinatedAllClipsNonExclusive: true,
      needleAnimationComponentPlayback: true,
      nineFixedTimesIncludingFourSubframes: true,
      objectTranslationAndQuaternion: true,
      animatedMorphInfluence: true,
      twoBoneSkinnedWorldPointSet: true,
      crossCopyIdentityRecorded: true,
      crossCopyVectorInteropMeasured: true,
      browserRenderedNonblankArtifact: true,
      disposalCompleted: true,
    },
    limits: [
      'Runtime-only evidence: the GLB is the Blendlink production export, not an export produced by the Needle Blender add-on or Needle build pipeline.',
      'The GLB intentionally has no NEEDLE_components metadata. Needle Engine autoplay creates its Animation component through AnimationUtils.autoplayAnimations.',
      'The test controls a runtime-created Needle Animation component after load. It does not exercise AnimatorController, PlayableDirector, or generated project scripts.',
      'Chromium/ANGLE WebGL evidence only; Firefox, WebKit, mobile GPUs, physical GPUs, WebGPU, CDN/base-path, and strict CSP are not covered.',
      'Nine times cover five authored keys and four fractional subframes. Constraints, drivers, NLA strip blending, additive clips, root motion, topology-changing modifiers, VAT, and KHR_animation_pointer remain outside it.',
      'The project and Engine package tree intentionally contains two @needle-tools/three patch versions. Constructor identity and structural Vector3 interoperability are measured; no general cross-copy safety claim is made.',
      'External font or telemetry request failures, if any, are recorded rather than treated as animation/deformation failures. Page and runtime errors still fail the gate.',
    ],
  }
  writeFileSync(
    resolve(output, 'evidence.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
    'NEEDLE_ANIMATION_RUNTIME_DIFFERENTIAL_PASSED ' +
      `position=${evidence.maxima.transformPositionError.toExponential(3)} ` +
      `quaternion=${evidence.maxima.transformQuaternionAngleRadians.toExponential(3)}rad ` +
      `morph=${evidence.maxima.morphInfluenceError.toExponential(3)} ` +
      `skin=${evidence.maxima.deformedPointHausdorff.toExponential(3)} ` +
      `threeIdentity=${evidence.crossCopy.loadedRootIsProjectObject3D ? 'shared' : 'separate'}`
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
