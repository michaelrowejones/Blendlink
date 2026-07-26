import assert from 'node:assert/strict'
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
import {
  BLENDLINK_THREE_R184_COMPILED_PROFILE,
  inspectGltfRuntimeCompatibility,
} from '../../packages/blendlink/dist/gltfRuntimeCompatibility.js'

const here = import.meta.dirname
const repository = path.resolve(here, '..', '..')
const output = path.resolve(here, 'output')
const assetRoot = path.resolve(output, 'assets')
const manifestPath = path.resolve(here, 'corpus.json')
const evidencePath = path.resolve(output, 'evidence.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const flags = new Set(process.argv.slice(2))
const fetchMissing = flags.has('--fetch')
const runBrowser = flags.has('--browser')

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sha256File(file) {
  return sha256Bytes(readFileSync(file))
}

function normalized(relativePath) {
  return relativePath.replaceAll('\\', '/')
}

async function acquireFile(file) {
  const target = path.resolve(assetRoot, file.path)
  if (!target.startsWith(`${assetRoot}${path.sep}`)) {
    throw new Error(`Corpus file escaped the asset root: ${file.path}`)
  }
  if (!existsSync(target)) {
    if (!fetchMissing) {
      throw new Error(
        `Missing official Khronos fixture ${file.path}. ` +
        `Run "node experiments/khronos-runtime-corpus/run.mjs --fetch" once, ` +
        `then use the default offline gate.`,
      )
    }
    const url = new URL(file.path, manifest.source.rawBaseUrl)
    const response = await fetch(url, { redirect: 'error' })
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(
      bytes.byteLength,
      file.bytes,
      `${file.path} fetched ${bytes.byteLength} bytes; expected ${file.bytes}`,
    )
    assert.equal(
      sha256Bytes(bytes),
      file.sha256,
      `${file.path} did not match the pinned SHA-256`,
    )
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  const bytes = readFileSync(target)
  assert.equal(bytes.byteLength, file.bytes, `${file.path} byte count drifted`)
  assert.equal(sha256Bytes(bytes), file.sha256, `${file.path} SHA-256 drifted`)
  return target
}

function parseDocument(entryPath) {
  const bytes = readFileSync(entryPath)
  if (entryPath.endsWith('.gltf')) return JSON.parse(bytes.toString('utf8'))
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${entryPath} is not a GLB`)
  assert.equal(bytes.readUInt32LE(4), 2, `${entryPath} is not GLB version 2`)
  const jsonLength = bytes.readUInt32LE(12)
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${entryPath} has no leading JSON chunk`)
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim())
}

function allAnimationPaths(document) {
  return [
    ...new Set(
      (document.animations ?? []).flatMap((animation) =>
        (animation.channels ?? []).map((channel) => channel.target?.path),
      ),
    ),
  ]
}

function allInterpolations(document) {
  return [
    ...new Set(
      (document.animations ?? []).flatMap((animation) =>
        (animation.samplers ?? []).map((sampler) => sampler.interpolation ?? 'LINEAR'),
      ),
    ),
  ]
}

function allPrimitiveAttributes(document) {
  return [
    ...new Set(
      (document.meshes ?? []).flatMap((mesh) =>
        (mesh.primitives ?? []).flatMap((primitive) => Object.keys(primitive.attributes ?? {})),
      ),
    ),
  ]
}

function maxMorphTargets(document) {
  return Math.max(
    0,
    ...(document.meshes ?? []).flatMap((mesh) =>
      (mesh.primitives ?? []).map((primitive) => primitive.targets?.length ?? 0),
    ),
  )
}

function negativeScaleNodeCount(document) {
  return (document.nodes ?? []).filter((node) => {
    if (node.scale) return node.scale[0] * node.scale[1] * node.scale[2] < 0
    if (!node.matrix) return false
    const m = node.matrix
    const determinant = (
      m[0] * (m[5] * m[10] - m[6] * m[9])
      - m[4] * (m[1] * m[10] - m[2] * m[9])
      + m[8] * (m[1] * m[6] - m[2] * m[5])
    )
    return determinant < 0
  }).length
}

function animationPointerChannelCount(document) {
  return (document.animations ?? []).flatMap((animation) => animation.channels ?? [])
    .filter((channel) =>
      channel.target?.path === 'pointer'
      || channel.target?.extensions?.KHR_animation_pointer,
    )
    .length
}

function materialExtensionCount(document, extension) {
  return (document.materials ?? [])
    .filter((material) => material.extensions?.[extension])
    .length
}

function classifyCompatibility(document) {
  const report = inspectGltfRuntimeCompatibility(
    document,
    BLENDLINK_THREE_R184_COMPILED_PROFILE,
  )
  return {
    profile: report.profile,
    issueCodes: report.issues.map((issue) => issue.code),
    unsupportedRequired: report.issues
      .filter((issue) => issue.code === 'runtime.required-extension-unsupported')
      .map((issue) => issue.extension)
      .sort(),
    unsupportedAnimationPointerChannels: report.issues
      .filter((issue) => issue.code === 'runtime.animation-pointer-unsupported')
      .length,
    compatible: report.compatible,
  }
}

function structuralEvidence(asset, document) {
  const expect = asset.expect ?? {}
  assert.equal(document.asset?.version?.startsWith('2'), true, `${asset.id} is not glTF 2.x`)
  if (expect.animationsAtLeast !== undefined) {
    assert(
      (document.animations?.length ?? 0) >= expect.animationsAtLeast,
      `${asset.id} animation count was below ${expect.animationsAtLeast}`,
    )
  }
  if (expect.skinsAtLeast !== undefined) {
    assert(
      (document.skins?.length ?? 0) >= expect.skinsAtLeast,
      `${asset.id} skin count was below ${expect.skinsAtLeast}`,
    )
  }
  if (expect.morphTargetsAtLeast !== undefined) {
    assert(
      maxMorphTargets(document) >= expect.morphTargetsAtLeast,
      `${asset.id} morph-target count was below ${expect.morphTargetsAtLeast}`,
    )
  }
  const animationPaths = allAnimationPaths(document)
  for (const value of expect.animationPaths ?? []) {
    assert(animationPaths.includes(value), `${asset.id} omitted animation path ${value}`)
  }
  const interpolations = allInterpolations(document)
  for (const value of expect.interpolations ?? []) {
    assert(interpolations.includes(value), `${asset.id} omitted ${value} interpolation`)
  }
  const primitiveAttributes = allPrimitiveAttributes(document)
  for (const value of expect.primitiveAttributes ?? []) {
    assert(primitiveAttributes.includes(value), `${asset.id} omitted primitive attribute ${value}`)
  }
  const extensionsUsed = document.extensionsUsed ?? []
  for (const value of expect.extensionsUsed ?? []) {
    assert(extensionsUsed.includes(value), `${asset.id} omitted extensionsUsed ${value}`)
  }
  const extensionsRequired = document.extensionsRequired ?? []
  for (const value of expect.extensionsRequired ?? []) {
    assert(extensionsRequired.includes(value), `${asset.id} omitted extensionsRequired ${value}`)
  }
  if (expect.materialExtension) {
    assert(
      materialExtensionCount(document, expect.materialExtension) >= 1,
      `${asset.id} declared but did not bind ${expect.materialExtension} on a material`,
    )
  }
  if (expect.negativeScaleNodesAtLeast !== undefined) {
    assert(
      negativeScaleNodeCount(document) >= expect.negativeScaleNodesAtLeast,
      `${asset.id} has no expected negative-scale node`,
    )
  }
  if (expect.animationPointerChannelsAtLeast !== undefined) {
    assert(
      animationPointerChannelCount(document) >= expect.animationPointerChannelsAtLeast,
      `${asset.id} has no expected animation-pointer channel`,
    )
  }
  const compatibility = classifyCompatibility(document)
  assert.deepEqual(
    compatibility.unsupportedRequired,
    expect.unsupportedRequired ?? [],
    `${asset.id} required-extension classification drifted`,
  )
  if (asset.outcome === 'load') {
    assert.equal(
      compatibility.compatible,
      true,
      `${asset.id} was expected to load but compatibility rejected it`,
    )
  } else {
    assert.equal(
      compatibility.compatible,
      false,
      `${asset.id} was expected to be refused before optimistic loading`,
    )
  }
  return {
    assetVersion: document.asset.version,
    generator: document.asset.generator ?? null,
    sceneCount: document.scenes?.length ?? 0,
    nodeCount: document.nodes?.length ?? 0,
    meshCount: document.meshes?.length ?? 0,
    materialCount: document.materials?.length ?? 0,
    skinCount: document.skins?.length ?? 0,
    animationCount: document.animations?.length ?? 0,
    animationPaths,
    interpolations,
    primitiveAttributes,
    maxMorphTargets: maxMorphTargets(document),
    negativeScaleNodes: negativeScaleNodeCount(document),
    animationPointerChannels: animationPointerChannelCount(document),
    extensionsUsed,
    extensionsRequired,
    compatibility,
  }
}

function assertBrowserAsset(asset, browser) {
  assert(browser, `${asset.id} has no browser evidence`)
  assert.equal(
    browser.compatibility.profile,
    BLENDLINK_THREE_R184_COMPILED_PROFILE.id,
    `${asset.id} browser compatibility profile drifted`,
  )
  assert.equal(
    browser.compatibility.compatible,
    asset.outcome === 'load',
    `${asset.id} browser production gate outcome drifted`,
  )
  assert.equal(
    browser.loadedCompatibility.compatible,
    asset.outcome === 'load',
    `${asset.id} browser loaded-parser outcome drifted`,
  )
  assert.equal(
    browser.loadedCompatibility.profile,
    'configured Three r184 loaded parser',
    `${asset.id} browser loaded-parser profile drifted`,
  )
  if (browser.loadedCompatibility.issueCodes.includes('runtime.animation-pointer-unsupported')) {
    assert.equal(
      browser.loadedCompatibility.noOpPointerPluginStillRefused,
      true,
      `${asset.id} no-op pointer plugin did not remain refused`,
    )
  }
  const expected = asset.expect.browser
  if (expected) {
    assert(browser.meshCount >= 1, `${asset.id} loaded no browser meshes`)
    for (const [key, actualKey] of [
      ['skinnedMeshesAtLeast', 'skinnedMeshCount'],
      ['morphMeshesAtLeast', 'morphMeshCount'],
      ['animationTracksAtLeast', 'animationTrackCount'],
      ['negativeDeterminantsAtLeast', 'negativeDeterminantCount'],
      ['tangentGeometriesAtLeast', 'tangentGeometryCount'],
      ['uvGeometriesAtLeast', 'uvGeometryCount'],
      ['textureTransformsAtLeast', 'nonIdentityTextureTransforms'],
    ]) {
      if (expected[key] !== undefined) {
        assert(
          browser[actualKey] >= expected[key],
          `${asset.id} browser ${actualKey}=${browser[actualKey]} was below ${expected[key]}`,
        )
      }
    }
    for (const value of expected.interpolations ?? []) {
      assert(browser.interpolations.includes(value), `${asset.id} browser omitted ${value}`)
    }
    if (expected.materialType) {
      assert(
        browser.materialTypes.includes(expected.materialType),
        `${asset.id} browser omitted ${expected.materialType}`,
      )
    }
    if (expected.materialProperty) {
      assert(
        (browser.materialProperties[expected.materialProperty]?.length ?? 0) >= 1,
        `${asset.id} browser omitted material property ${expected.materialProperty}`,
      )
    }
  }
  const bypass = asset.expect.browserBypassProbe
  if (bypass) {
    assert.equal(browser.meshCount >= 1, bypass.loadsOptimistically)
    assert.equal(
      browser.animationTrackCount,
      bypass.animationTracks,
      `${asset.id} optimistic GLTFLoader track count changed`,
    )
  }
}

async function browserEvidence(assets) {
  const playwrightCandidates = [
    process.env.BLENDLINK_PLAYWRIGHT_MODULE,
    path.resolve(repository, 'node_modules', 'playwright', 'index.mjs'),
    path.resolve(repository, '..', 'MichaelRoweJonesSite', 'node_modules', 'playwright', 'index.mjs'),
  ].filter(Boolean)
  const playwrightModule = playwrightCandidates.find((candidate) => existsSync(candidate))
  assert(playwrightModule, 'Playwright is missing from Blendlink and the dogfood site')
  const browserInput = {
    assets: assets.map((asset) => ({
      id: asset.id,
      outcome: asset.outcome,
      entryUrl: `/output/assets/${normalized(asset.entry)}`,
      expect: {
        browser: asset.expect.browser,
        browserBypassProbe: asset.expect.browserBypassProbe,
      },
    })),
  }
  mkdirSync(output, { recursive: true })
  writeFileSync(
    path.resolve(output, 'browser-input.json'),
    `${JSON.stringify(browserInput, null, 2)}\n`,
  )
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
    page = await browser.newPage()
    const pageErrors = []
    const consoleErrors = []
    const consoleWarnings = []
    const failedRequests = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
      if (message.type() === 'warning') consoleWarnings.push(message.text())
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
      () => window.__khronosRuntimeCorpus?.ready === true,
      undefined,
      { timeout: 120_000 },
    )
    const result = await page.evaluate(() => window.__khronosRuntimeCorpus)
    assert(!result.error, `browser corpus failed: ${result.error}`)
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`)
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('; ')}`)
    assert.deepEqual(failedRequests, [], `failed requests: ${JSON.stringify(failedRequests)}`)
    const byId = new Map(result.evidence.map((entry) => [entry.id, entry]))
    for (const asset of assets) assertBrowserAsset(asset, byId.get(asset.id))
    assert(
      consoleWarnings.some((warning) => warning.includes('Unknown extension "KHR_node_visibility"')),
      'raw Three bypass did not expose its required-extension warning',
    )
    return {
      browserVersion: await browser.version(),
      pageErrors,
      consoleErrors,
      consoleWarnings,
      failedRequests,
      assets: result.evidence,
    }
  } finally {
    if (page) await page.close()
    if (browser) await browser.close()
    await server.close()
  }
}

assert.equal(manifest.schemaVersion, 1, 'unsupported corpus schemaVersion')
assert.match(manifest.source.revision, /^[0-9a-f]{40}$/, 'source revision is not immutable')
assert(
  manifest.source.rawBaseUrl.includes(manifest.source.revision),
  'raw source URL is not pinned to the recorded revision',
)
const threePackage = JSON.parse(readFileSync(path.resolve(repository, 'node_modules/three/package.json')))
assert.equal(threePackage.version, manifest.runtime.threeVersion, 'installed Three version drifted')
const loaderPath = path.resolve(repository, manifest.runtime.gltfLoaderPath)
const compatibilityModulePath = path.resolve(
  repository,
  'packages/blendlink/dist/gltfRuntimeCompatibility.js',
)
assert.equal(readFileSync(loaderPath).byteLength, manifest.runtime.gltfLoaderBytes, 'GLTFLoader bytes drifted')
assert.equal(sha256File(loaderPath), manifest.runtime.gltfLoaderSha256, 'GLTFLoader SHA-256 drifted')
const loaderSource = readFileSync(loaderPath, 'utf8')
for (const extension of manifest.runtime.builtInExtensionsCovered) {
  assert(
    loaderSource.includes(`'${extension}'`),
    `pinned GLTFLoader source no longer names built-in extension ${extension}`,
  )
}
for (const extension of manifest.runtime.externalPluginOnly) {
  assert(
    loaderSource.includes(`[${extension}]`),
    `pinned GLTFLoader source no longer identifies external plugin ${extension}`,
  )
}

mkdirSync(output, { recursive: true })
const structural = []
let totalBytes = 0
const assetIds = new Set()
const coveredBuiltInExtensions = new Set()
for (const asset of manifest.assets) {
  assert(!assetIds.has(asset.id), `duplicate corpus asset id ${asset.id}`)
  assetIds.add(asset.id)
  assert(
    asset.license?.evidenceUrl?.startsWith('https://github.com/KhronosGroup/glTF-Sample-Assets/blob/'),
    `${asset.id} has no official immutable license-evidence URL`,
  )
  assert(
    asset.license.evidenceUrl.includes(manifest.source.revision),
    `${asset.id} license evidence is not revision-pinned`,
  )
  assert(
    asset.files.some((file) => file.path === asset.entry),
    `${asset.id} entry is absent from its exact file closure`,
  )
  for (const extension of asset.expect.extensionsUsed ?? []) {
    if (manifest.runtime.builtInExtensionsCovered.includes(extension)) {
      coveredBuiltInExtensions.add(extension)
    }
  }
  for (const file of asset.files) {
    await acquireFile(file)
    totalBytes += file.bytes
  }
  const entryPath = path.resolve(assetRoot, asset.entry)
  const document = parseDocument(entryPath)
  structural.push({
    id: asset.id,
    model: asset.model,
    outcome: asset.outcome,
    role: asset.role,
    license: asset.license,
    entry: asset.entry,
    entrySha256: sha256File(entryPath),
    files: asset.files,
    evidence: structuralEvidence(asset, document),
  })
}
assert.deepEqual(
  [...coveredBuiltInExtensions].sort(),
  [...manifest.runtime.builtInExtensionsCovered].sort(),
  'official positive cells no longer cover every declared built-in extension',
)

const browser = runBrowser ? await browserEvidence(manifest.assets) : null
const report = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  source: manifest.source,
  runtime: {
    threeVersion: manifest.runtime.threeVersion,
    gltfLoaderPath: manifest.runtime.gltfLoaderPath,
    gltfLoaderBytes: manifest.runtime.gltfLoaderBytes,
    gltfLoaderSha256: manifest.runtime.gltfLoaderSha256,
    blendlinkCompatibilityPath: normalized(path.relative(repository, compatibilityModulePath)),
    blendlinkCompatibilitySha256: sha256File(compatibilityModulePath),
    blendlinkCompatibilityProfile: BLENDLINK_THREE_R184_COMPILED_PROFILE.id,
  },
  acquisition: {
    mode: fetchMissing ? 'fetch-missing-then-verify' : 'offline-verify-only',
    assetCount: manifest.assets.length,
    fileCount: manifest.assets.reduce((sum, asset) => sum + asset.files.length, 0),
    totalBytes,
  },
  structural,
  browser,
  assertions: {
    immutableUpstreamRevision: true,
    exactPerFileBytesAndSha256: true,
    perAssetLicenseEvidence: true,
    positiveRequiredExtensionsSupported: true,
    requiredUnsupportedExtensionRejectedBeforeLoad: true,
    optionalUnsupportedAnimationPointerLossRejectedSemantically: true,
    productionCompatibilityModuleUsedStructurally: true,
    productionCompatibilityModuleUsedInBrowser: browser ? true : 'not-run',
    loadedParserAdapterUsedInBrowser: browser ? true : 'not-run',
    noOpPluginNameRefusedInBrowser: browser ? true : 'not-run',
    rawThreeOptimisticBypassObserved: browser ? true : 'not-run',
    everyCoveredBuiltInMaterialExtensionLoadedInBrowser: browser ? true : 'not-run',
  },
  limits: [
    'This starts after Blender export and does not validate Blender-to-glTF compilation.',
    'Structural mode proves exact bytes and JSON contracts; browser mode proves Three r184 object/material construction, not Khronos Sample Viewer pixel equivalence.',
    'EXT_materials_bump is present in Three r184 but has no official glTF-Sample-Assets cell at the pinned revision, so it remains an explicit corpus gap.',
    'KHR_materials_variants and KHR_animation_pointer are external-plugin paths in Three r184, not built-in GLTFLoader support.',
    'Decoder, Basis/KTX2, Meshopt, Draco, deployment, CSP, and CORS cells belong to separate runtime/deployment matrices.',
  ],
}
writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`)
console.log(
  `BLENDLINK_KHRONOS_RUNTIME_CORPUS_PASSED ` +
  `assets=${manifest.assets.length} files=${report.acquisition.fileCount} ` +
  `bytes=${totalBytes} browser=${browser ? 'yes' : 'no'}`,
)
