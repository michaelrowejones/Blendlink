import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
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
const productionExporter = resolve(
  repository,
  'packages/blendlink/dist/blender/export_scene.py',
)
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

function runBlender(args, sentinel) {
  const result = spawnSync(blender, args, {
    cwd: repository,
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (!combined.includes(sentinel)) {
    throw new Error(
      `Blender did not emit ${sentinel} (exit ${result.status}).\n${combined.slice(-8000)}`,
    )
  }
  if (result.error) throw result.error
  return {
    status: result.status,
    stdoutTail: String(result.stdout ?? '').slice(-5000),
    stderrTail: String(result.stderr ?? '').slice(-5000),
  }
}

function parseGlbJson(path) {
  const bytes = readFileSync(path)
  assert(bytes.toString('ascii', 0, 4) === 'glTF', 'fixture output was not a binary glTF')
  const jsonLength = bytes.readUInt32LE(12)
  const jsonType = bytes.readUInt32LE(16)
  assert(jsonType === 0x4e4f534a, 'first GLB chunk was not JSON')
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trimEnd())
}

mkdirSync(output, { recursive: true })
assert(existsSync(blender), `Blender 5.2 binary is missing: ${blender}`)
assert(
  existsSync(productionExporter),
  `production exporter is missing: ${productionExporter}; run npm run build first`,
)
const productionRuntime = resolve(repository, 'packages/blendlink/dist/threeRuntime.js')
assert(
  existsSync(productionRuntime),
  `production Three runtime is missing: ${productionRuntime}; run npm run build first`,
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
  'BLENDLINK_ANIMATION_DEFORMATION_FIXTURE_GENERATED',
)

const settingsPath = resolve(output, 'settings.json')
const resultPath = resolve(output, 'export-result.json')
const glbPath = resolve(output, 'animation-deformation-fixture.glb')
writeFileSync(settingsPath, `${JSON.stringify({ mode: 'standard' }, null, 2)}\n`)
const exportRun = runBlender(
  [
    '--background',
    resolve(output, 'animation-deformation-fixture.blend'),
    '--python-exit-code',
    '1',
    '--python',
    productionExporter,
    '--',
    glbPath,
    settingsPath,
    resultPath,
  ],
  'BLENDLINK_OK export',
)
assert(existsSync(glbPath), 'production exporter did not create the fixture GLB')

const glb = parseGlbJson(glbPath)
const targetPaths = (glb.animations ?? []).flatMap((animation) =>
  (animation.channels ?? []).map((channel) => channel.target?.path),
)
assert((glb.skins ?? []).length === 1, `expected one glTF skin, got ${(glb.skins ?? []).length}`)
assert(
  (glb.meshes ?? []).some((mesh) =>
    (mesh.primitives ?? []).some((primitive) => (primitive.targets ?? []).length === 1),
  ),
  'fixture GLB did not contain exactly one morph target on any primitive',
)
for (const path of ['translation', 'rotation', 'weights']) {
  assert(targetPaths.includes(path), `fixture GLB omitted animation target ${path}`)
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
  if (!address || typeof address === 'string') throw new Error('Vite did not expose its port')
  const url = `http://127.0.0.1:${address.port}/`
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
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => window.__animationDeformationEvidence?.ready === true,
    undefined,
    { timeout: 60_000 },
  )
  const browserState = await page.evaluate(() => ({
    evidence: window.__animationDeformationEvidence?.evidence,
    errors: window.__animationDeformationEvidence?.errors ?? [],
  }))
  assert(browserState.evidence, 'browser did not publish animation/deformation evidence')
  assert(browserState.errors.length === 0, `browser fixture errors: ${browserState.errors.join('; ')}`)
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('; ')}`)
  const evidence = browserState.evidence
  console.log(`ANIMATION_DEFORMATION_OBSERVED ${JSON.stringify(evidence.maxima)}`)
  assert(evidence.blendlinkInstaller === 'installThreeCompiledScene', 'fixture bypassed production installer')
  assert(evidence.skinnedMesh.isSkinnedMesh, 'loaded object was not a Three.SkinnedMesh')
  assert(evidence.skinnedMesh.boneCount === 2, `expected two bones, got ${evidence.skinnedMesh.boneCount}`)
  assert(evidence.skinnedMesh.getVertexPosition, 'SkinnedMesh.getVertexPosition was unavailable')
  assert(
    Object.hasOwn(evidence.skinnedMesh.morphTargetDictionary, 'Bulge'),
    'loaded SkinnedMesh did not expose the Bulge morph target',
  )
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
    `browser render had only ${evidence.pixels.nonBackground} non-background pixels`,
  )
  assert(
    evidence.pixels.chromatic > 5_000,
    `browser render had only ${evidence.pixels.chromatic} chromatic pixels`,
  )

  const screenshotPath = resolve(output, 'animation-deformation-browser.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  const canvasPath = resolve(output, 'animation-deformation-canvas.png')
  await page.locator('#stage').screenshot({ path: canvasPath })
  const disposed = await page.evaluate(() => window.__animationDeformationEvidence?.dispose())
  assert(disposed, 'browser fixture disposal did not run')

  const reference = JSON.parse(readFileSync(resolve(output, 'blender-reference.json')))
  const exportResult = JSON.parse(readFileSync(resultPath))
  const blenderGltfModule = reference.gltfExporter.modulePath
  const blenderGltfRoot = resolve(blenderGltfModule, '..')
  const relevantSources = {
    generator: resolve(root, 'generate_fixture.py'),
    browserFixture: resolve(root, 'main.ts'),
    browserPage: resolve(root, 'index.html'),
    runner: resolve(root, 'run.mjs'),
    researchReadme: resolve(root, 'README.md'),
    blendlinkProductionRuntime: productionRuntime,
    blendlinkRuntimeContract: resolve(repository, 'packages/blendlink/dist/runtime.js'),
    blendlinkProductionExporter: productionExporter,
    threeGltfLoader: resolve(repository, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js'),
    threeAnimationMixer: resolve(repository, 'node_modules/three/src/animation/AnimationMixer.js'),
    threeMesh: resolve(repository, 'node_modules/three/src/objects/Mesh.js'),
    threeSkinnedMesh: resolve(repository, 'node_modules/three/src/objects/SkinnedMesh.js'),
    blenderGltfExporterEntry: blenderGltfModule,
    blenderGltfAnimationAction: resolve(
      blenderGltfRoot,
      'blender/exp/animation/action.py',
    ),
    blenderGltfFcurveSampler: resolve(
      blenderGltfRoot,
      'blender/exp/animation/fcurves/sampler.py',
    ),
    blenderGltfArmatureSampler: resolve(
      blenderGltfRoot,
      'blender/exp/animation/sampled/armature/sampler.py',
    ),
    blenderGltfShapeKeySampler: resolve(
      blenderGltfRoot,
      'blender/exp/animation/sampled/shapekeys/sampler.py',
    ),
    blenderGltfSkinGatherer: resolve(blenderGltfRoot, 'blender/exp/skins.py'),
  }
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    browser: await browser.version(),
    url,
    versions: {
      blender: reference.blender,
      blenderGltfExporter: reference.gltfExporter.version.join('.'),
      blendlink: JSON.parse(readFileSync(resolve(
        repository,
        'packages/blendlink/package.json',
      ))).version,
      three: JSON.parse(readFileSync(resolve(
        repository,
        'node_modules/three/package.json',
      ))).version,
      playwright: JSON.parse(readFileSync(resolve(
        repository,
        '../MichaelRoweJonesSite/node_modules/playwright/package.json',
      ))).version,
      vite: JSON.parse(readFileSync(resolve(repository, 'node_modules/vite/package.json'))).version,
    },
    sources: Object.fromEntries(
      Object.entries(relevantSources).map(([name, path]) => [
        name,
        { path, sha256: sha256(path) },
      ]),
    ),
    artifacts: {
      blendSha256: sha256(resolve(output, 'animation-deformation-fixture.blend')),
      glbSha256: sha256(glbPath),
      referenceSha256: sha256(resolve(output, 'blender-reference.json')),
      blenderReferenceImageSha256: sha256(resolve(output, 'blender-reference-frame13.png')),
      browserScreenshotSha256: sha256(screenshotPath),
      browserCanvasSha256: sha256(canvasPath),
    },
    glbStructure: {
      asset: glb.asset,
      nodeCount: glb.nodes?.length ?? 0,
      meshCount: glb.meshes?.length ?? 0,
      skinCount: glb.skins?.length ?? 0,
      jointCount: glb.skins?.[0]?.joints?.length ?? 0,
      animationCount: glb.animations?.length ?? 0,
      animationNames: (glb.animations ?? []).map((animation) => animation.name),
      animationChannelTargetPaths: targetPaths,
      morphTargetCounts: (glb.meshes ?? []).flatMap((mesh) =>
        (mesh.primitives ?? []).map((primitive) => primitive.targets?.length ?? 0),
      ),
    },
    exportResult: {
      blenderVersion: exportResult.blenderVersion,
      droppedExporterKwargs: exportResult.exporterKwargsDropped,
      warnings: exportResult.warnings,
    },
    generation,
    exportRun,
    pageErrors,
    consoleErrors,
    evidence,
    assertions: {
      sameBlendOracleAndProductionExport: true,
      productionBlendlinkInstaller: true,
      nineFixedTimesIncludingFourSubframes: true,
      exactAuthoredKeysAndBoundedStockSubframeInterpolation: true,
      objectTranslationAndQuaternion: true,
      twoBoneSkin: true,
      animatedMorphInfluence: true,
      skinnedMeshGetVertexPosition: true,
      evaluatedWorldPointSetParity: true,
      browserRenderedNonblankArtifact: true,
      disposalCompleted: true,
    },
    limits: [
      'Chromium/ANGLE WebGL evidence only; Firefox, WebKit, mobile GPUs, and WebGPU are not covered.',
      'The fixture validates core glTF transform, joint, skin, and morph paths. It does not cover constraints, drivers, NLA strip blending, additive clips, root motion policy, topology-changing modifiers, VAT caches, or KHR_animation_pointer.',
      'Nine comparison times include five authored keys and four fractional subframes, covering the stock exporter/Three linear interpolation path for this fixture. Bezier, constant, and cubic-spline interpolation remain outside it.',
      'At fractional subframes, Blender component-curve quaternion evaluation and glTF LINEAR quaternion interpolation are not byte-identical. The gate preserves exact-key evidence separately and bounds the measured angular approximation to 1e-3 radians.',
      'Vertex equality is a bidirectional world-space point-set Hausdorff metric because glTF triangulation and normal/UV seams may duplicate or reorder Blender vertices.',
      'Bone world-transform diagnostics are recorded but not release-gated: glTF exporters may legally reorient joint nodes while preserving the skinned result. The deformed vertex result is the behavioral contract.',
      'The browser loads local production dist files over a Vite HTTP server; this is not a packed-tarball, CDN/base-path, CSP, or deployed-site test.',
      'Needle is not rendered in this fixture. Its coherent-stack same-scene comparison is a separate gate; this fixture establishes the Blendlink side and Blender oracle independently.',
    ],
  }
  writeFileSync(
    resolve(output, 'evidence.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
    'BLENDLINK_ANIMATION_DEFORMATION_BROWSER_PASSED ' +
      `position=${evidence.maxima.transformPositionError.toExponential(3)} ` +
      `quaternion=${evidence.maxima.transformQuaternionAngleRadians.toExponential(3)}rad ` +
      `morph=${evidence.maxima.morphInfluenceError.toExponential(3)} ` +
      `skin=${evidence.maxima.deformedPointHausdorff.toExponential(3)} ` +
      `clips=${evidence.clipNames.length}`,
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
