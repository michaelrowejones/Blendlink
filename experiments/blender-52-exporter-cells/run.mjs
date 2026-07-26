import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { inspectGlb } from './inspect_glb.mjs'

const experimentDir = dirname(fileURLToPath(import.meta.url))
const repositoryDir = resolve(experimentDir, '..', '..')
const outputDir = resolve(experimentDir, 'output')
const blender = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
const exporterRoot = 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/scripts/addons_core/io_scene_gltf2'
const needleAddon = 'C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/.cache/needle-spike/addon/Needle Engine Exporter for Blender'
const threeRoot = resolve(repositoryDir, 'node_modules', 'three')
const cli = resolve(repositoryDir, 'packages', 'blendlink', 'dist', 'cli.js')
const materialAnalyzer = resolve(
  repositoryDir, 'packages', 'blender-addon', 'procedural.py',
)
const copiedMaterialAnalyzer = resolve(
  repositoryDir, 'packages', 'blendlink', 'dist', 'blender', 'procedural.py',
)

if (!outputDir.startsWith(experimentDir + sep)) {
  throw new Error(`refusing to clean output outside experiment: ${outputDir}`)
}
rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function normalized(path) {
  return path.replaceAll('\\', '/')
}

function listFiles(root, predicate = () => true) {
  const result = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && predicate(path)) result.push(path)
    }
  }
  visit(root)
  return result.sort((left, right) => normalized(left).localeCompare(normalized(right)))
}

function treeIdentity(root) {
  const files = listFiles(root, (path) => path.endsWith('.py'))
    .map((path) => ({
      path: normalized(relative(root, path)),
      bytes: statSync(path).size,
      sha256: sha256(path),
    }))
  const digest = createHash('sha256')
  for (const file of files) {
    digest.update(file.path)
    digest.update('\0')
    digest.update(file.sha256)
    digest.update('\n')
  }
  return {
    algorithm: 'sha256(sorted normalized relative path + NUL + per-file sha256 + LF)',
    fileCount: files.length,
    sha256: digest.digest('hex'),
    files,
  }
}

function spawn(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: experimentDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  if (result.error) throw result.error
  return result
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
}

const generated = spawn(
  blender,
  [
    '--background',
    '--factory-startup',
    '--python-exit-code', '73',
    '--python', resolve(experimentDir, 'create_fixtures.py'),
    '--', outputDir,
  ],
)
requireSuccess(generated, 'Blender fixture generation')
if (!generated.stdout.includes('BLENDLINK_BLENDER_52_EXPORTER_FIXTURES_CREATED')) {
  throw new Error('Blender generation sentinel was absent')
}

const generation = JSON.parse(readFileSync(resolve(outputDir, 'generation.json'), 'utf8'))
const sourceIdentity = {
  schemaVersion: 1,
  blender: generation.blender,
  gltfExporter: {
    ...generation.gltfExporter,
    normalizedRoot: normalized(exporterRoot),
    tree: treeIdentity(exporterRoot),
    representativeFiles: [
      '__init__.py',
      'blender/exp/material/materials.py',
      'blender/exp/material/unlit.py',
      'blender/exp/material/search_node_tree.py',
      'blender/exp/material/extensions/clearcoat.py',
      'blender/exp/material/extensions/transmission.py',
      'blender/exp/material/extensions/volume.py',
      'blender/exp/material/extensions/ior.py',
      'blender/exp/material/extensions/sheen.py',
      'blender/exp/material/extensions/specular.py',
      'blender/exp/material/extensions/anisotropy.py',
      'blender/exp/material/extensions/emission.py',
      'blender/exp/material/extensions/iridescence.py',
      'blender/exp/material/extensions/dispersion.py',
    ].map((path) => {
      const absolute = resolve(exporterRoot, path)
      return { path, bytes: statSync(absolute).size, sha256: sha256(absolute) }
    }),
  },
  needle: {
    addonVersion: '1.4.2',
    normalizedRoot: normalized(needleAddon),
    blenderExport: {
      path: 'blender_export.py',
      bytes: statSync(resolve(needleAddon, 'blender_export.py')).size,
      sha256: sha256(resolve(needleAddon, 'blender_export.py')),
    },
    invocation: generation.needleEquivalentStockExportArgs,
  },
  three: {
    version: JSON.parse(readFileSync(resolve(threeRoot, 'package.json'), 'utf8')).version,
    package: {
      path: normalized(relative(repositoryDir, resolve(threeRoot, 'package.json'))),
      sha256: sha256(resolve(threeRoot, 'package.json')),
    },
    loader: {
      path: normalized(relative(repositoryDir, resolve(threeRoot, 'examples/jsm/loaders/GLTFLoader.js'))),
      sha256: sha256(resolve(threeRoot, 'examples/jsm/loaders/GLTFLoader.js')),
    },
  },
}
writeFileSync(
  resolve(outputDir, 'source-identity.json'),
  `${JSON.stringify(sourceIdentity, null, 2)}\n`,
)

const stockNames = [
  'portable-factors',
  'portable-alpha-mask',
  'unsupported-procedural',
]
const stock = {}
for (const name of stockNames) {
  const path = resolve(outputDir, 'stock', `${name}.glb`)
  stock[name] = {
    path: normalized(relative(experimentDir, path)),
    bytes: statSync(path).size,
    sha256: sha256(path),
    inspection: await inspectGlb(path),
  }
}

function material(document, name) {
  const result = document.materials.find((item) => item.name === name)
  if (!result) throw new Error(`missing stock material ${name}`)
  return result
}

const portableDocument = stock['portable-factors'].inspection
const expectedExtensions = [
  'KHR_materials_anisotropy',
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_unlit',
  'KHR_materials_volume',
  'KHR_texture_transform',
]
for (const extension of expectedExtensions) {
  if (!portableDocument.extensionsUsed.includes(extension)) {
    throw new Error(`stock portable fixture did not emit ${extension}`)
  }
}
if (material(portableDocument, 'Cell.AlphaBlend').alphaMode !== 'BLEND') {
  throw new Error('direct Principled alpha did not emit glTF BLEND')
}
if (!material(portableDocument, 'Cell.Unlit').extensions.KHR_materials_unlit) {
  throw new Error('direct color-to-Surface graph did not emit KHR_materials_unlit')
}
if (material(
  stock['portable-alpha-mask'].inspection,
  'Cell.AlphaMask',
).alphaMode !== 'MASK') {
  throw new Error('recognized stock alpha clip graph did not emit glTF MASK')
}
const loadedTypes = new Set(portableDocument.threeMaterials.map((item) => item.type))
if (!loadedTypes.has('MeshBasicMaterial') || !loadedTypes.has('MeshPhysicalMaterial')) {
  throw new Error(`Three r184 did not instantiate expected material families: ${[...loadedTypes]}`)
}

function runPlan(scene) {
  const result = spawn(process.execPath, [cli, 'plan', scene, '--json'])
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(
      `Blendlink ${scene} plan did not return JSON: ${error.message}\n${result.stdout}\n${result.stderr}`,
    )
  }
  return {
    command: `node ../../packages/blendlink/dist/cli.js plan ${scene} --json`,
    exitCode: result.status,
    stdout: json,
    stderr: result.stderr,
  }
}

const plans = {
  portableFactors: runPlan('portableFactors'),
  portableAlphaMask: runPlan('portableAlphaMask'),
  unsupportedProcedural: runPlan('unsupportedProcedural'),
}
if (plans.portableFactors.exitCode !== 0) {
  throw new Error('portable factor cells should produce a non-blocked Blendlink plan')
}
if (plans.portableAlphaMask.exitCode !== 0) {
  throw new Error('recognized Blender 5.2 alpha-mask grammar should produce a non-blocked plan')
}
if (plans.unsupportedProcedural.exitCode !== 1) {
  throw new Error('unsupported procedural material should remain a loud exit-1 blocker')
}
const proceduralErrors = plans.unsupportedProcedural.stdout.scenes?.[0]?.inspection?.errors ?? []
if (!proceduralErrors.some(
  (item) => item.code === 'material.used-needs-bake'
    && item.material === 'Cell.UnsupportedNoise'
    && item.reasons?.some((reason) => reason.includes('Noise Texture')),
)) {
  throw new Error('unsupported Noise fixture lost its independent material.used-needs-bake evidence')
}

const compiledRoot = resolve(outputDir, 'blendlink')

async function compileScene(scene, stockName) {
  const result = spawn(process.execPath, [cli, 'compile', scene, '--force'])
  requireSuccess(result, `Blendlink ${scene} compile`)
  const stablePath = resolve(compiledRoot, `${scene}.glb`)
  const sceneCopyRoot = resolve(compiledRoot, scene)
  if (!existsSync(stablePath)) {
    throw new Error(`expected stable compiled GLB at ${normalized(stablePath)}`)
  }
  const copies = [
    stablePath,
    ...(existsSync(sceneCopyRoot)
      ? listFiles(sceneCopyRoot, (path) => path.endsWith('.glb'))
      : []),
  ]
  const manifestPath = resolve(outputDir, 'generated', `${scene}.manifest.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const compiled = {
    command: `node ../../packages/blendlink/dist/cli.js compile ${scene} --force`,
    stdout: result.stdout,
    stderr: result.stderr,
    path: normalized(relative(experimentDir, stablePath)),
    bytes: statSync(stablePath).size,
    sha256: sha256(stablePath),
    copies: copies.map((path) => ({
      path: normalized(relative(experimentDir, path)),
      bytes: statSync(path).size,
      sha256: sha256(path),
    })),
    manifest: {
      path: normalized(relative(experimentDir, manifestPath)),
      bytes: statSync(manifestPath).size,
      sha256: sha256(manifestPath),
      materialDiagnostics: manifest.sceneDiagnostics.materials,
    },
    inspection: await inspectGlb(stablePath),
  }
  if (compiled.sha256 !== stock[stockName].sha256) {
    throw new Error(
      `Blendlink changed ${scene} stock GLB bytes: ${
        stock[stockName].sha256
      } -> ${compiled.sha256}`,
    )
  }
  return compiled
}

const compiled = await compileScene('portableFactors', 'portable-factors')
const compiledAlphaMask = await compileScene('portableAlphaMask', 'portable-alpha-mask')
const diagnosticRecords = compiled.manifest.materialDiagnostics?.records ?? []
const diagnosticsByMaterial = Object.fromEntries(
  diagnosticRecords.map((record) => [record.material, record]),
)
for (const name of [
  'Cell.AlphaBlend',
  'Cell.Anisotropy',
  'Cell.Clearcoat',
  'Cell.CorePrincipled',
  'Cell.EmissiveStrength',
  'Cell.SheenFullWeight',
  'Cell.Specular',
  'Cell.TextureTransform',
  'Cell.TransmissionVolume',
  'Cell.Unlit',
]) {
  if (diagnosticsByMaterial[name]?.status !== 'exact') {
    throw new Error(`expected ${name} to be diagnosed Exact glTF`)
  }
}
if (
  compiled.manifest.materialDiagnostics.exact !== 10
  || compiled.manifest.materialDiagnostics.approximated !== 0
  || compiled.manifest.materialDiagnostics.needsBake !== 0
) {
  throw new Error('portable factor diagnostics did not resolve to ten Exact glTF records')
}
const alphaDiagnostics = compiledAlphaMask.manifest.materialDiagnostics
if (
  alphaDiagnostics.exact !== 1
  || alphaDiagnostics.approximated !== 0
  || alphaDiagnostics.needsBake !== 0
  || alphaDiagnostics.records?.[0]?.material !== 'Cell.AlphaMask'
) {
  throw new Error('portable alpha-mask compile did not retain one Exact glTF diagnostic')
}

const classifications = {
  portableFactors: {
    relation: 'verified-match-with-contextual-diagnostics',
    stockStructure: 'all asserted core/KHR material mappings emitted',
    threeR184: 'loaded',
    blendlinkPlan: 'accepted',
    blendlinkCompile: 'succeeded and retained the Needle-equivalent stock GLB byte-for-byte',
    limitations: [
      'Sheen Weight is Exact only at the exporter-faithful unlinked 0 and 1 endpoints; partial and linked weights stay loud.',
      'Thin Film is Exact only for the verified constant Principled inputs paired with enabled canonical glTF Material Output iridescence.',
      'No browser pixels are claimed by this structural/loader gate.',
    ],
  },
  portableAlphaMask: {
    relation: 'verified-match-with-stricter-graph-guardrails',
    stockStructure: 'alphaMode=MASK with authored alphaCutoff',
    threeR184: 'loaded',
    blendlinkPlan: 'accepted only for Blender 5.2.39-recognized clip topology',
    blendlinkCompile: 'succeeded and retained the Needle-equivalent stock GLB byte-for-byte',
  },
  unsupportedProcedural: {
    relation: 'verified-improvement-over-the-pinned-Needle-wrapper',
    stockStructure: 'stock exporter cannot preserve the Noise Texture graph as editable glTF',
    threeR184: 'loaded fallback payload',
    blendlinkPlan: 'refused with material.used-needs-bake; pinned Needle invokes this same stock exporter without an analogous material-portability preflight in its export wrapper',
  },
}

const evidence = {
  schemaVersion: 1,
  command: 'node experiments/blender-52-exporter-cells/run.mjs',
  sourceIdentity: 'output/source-identity.json',
  generation,
  stock,
  blendlink: {
    packageVersion: JSON.parse(
      readFileSync(resolve(repositoryDir, 'packages/blendlink/package.json'), 'utf8',
      ),
    ).version,
    cliSha256: sha256(cli),
    materialAnalyzer: {
      verifiedExporterVersion: '5.2.39',
      source: {
        path: normalized(relative(repositoryDir, materialAnalyzer)),
        sha256: sha256(materialAnalyzer),
      },
      copiedRuntime: {
        path: normalized(relative(repositoryDir, copiedMaterialAnalyzer)),
        sha256: sha256(copiedMaterialAnalyzer),
      },
    },
    plans,
    compiled,
    compiledAlphaMask,
  },
  classifications,
}
writeFileSync(resolve(outputDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)

console.log(
  'BLENDLINK_BLENDER_52_EXPORTER_CELLS_PASSED '
    + `exporter=${sourceIdentity.gltfExporter.tree.sha256} `
    + `stock=${stockNames.length} compiled=${compiled.sha256} `
    + `alpha=${compiledAlphaMask.sha256}`,
)
