import { spawnSync } from 'node:child_process'
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

const experimentDir = dirname(fileURLToPath(import.meta.url))
const repositoryDir = resolve(experimentDir, '..', '..')
const outputDir = resolve(experimentDir, 'output')
const workDir = resolve(outputDir, 'work')
const fixtureDir = resolve(workDir, 'fixture')
const sourcePath = resolve(fixtureDir, 'hybrid-material-gate.blend')
const generationPath = resolve(outputDir, 'generation.json')
const evidencePath = resolve(experimentDir, 'evidence.json')
const blender = process.env.BLENDLINK_BLENDER_52
  ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
const cli = resolve(repositoryDir, 'packages', 'blendlink', 'dist', 'cli.js')
const needleRoot = process.env.BLENDLINK_NEEDLE_ADDON_ROOT
  ?? 'C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/.cache/needle-spike/addon/Needle Engine Exporter for Blender'
const needleLightmapping = resolve(needleRoot, 'lightmapping', 'lightmapping.py')
const needlePacking = resolve(needleRoot, 'lightmapping', 'lightmapping_pack.py')

if (!outputDir.startsWith(experimentDir + sep)) {
  throw new Error(`refusing to clean output outside experiment: ${outputDir}`)
}
rmSync(outputDir, { recursive: true, force: true })
mkdirSync(fixtureDir, { recursive: true })

function normalized(path) {
  return path.replaceAll('\\', '/')
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function hash16(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

function fileIdentity(path, root = repositoryDir) {
  return {
    path: normalized(relative(root, path)),
    bytes: statSync(path).size,
    sha256: sha256(path),
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workDir,
    encoding: 'utf8',
    windowsHide: true,
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

function listFiles(root) {
  if (!existsSync(root)) return []
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  visit(root)
  return files.sort((left, right) => normalized(left).localeCompare(normalized(right)))
}

function listEntries(root) {
  if (!existsSync(root)) return []
  const entries = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      entries.push(path)
      if (entry.isDirectory()) visit(path)
    }
  }
  visit(root)
  return entries.sort((left, right) => normalized(left).localeCompare(normalized(right)))
}

function sourceCheckpoint(label, expected) {
  const actual = sha256(sourcePath)
  if (actual !== expected) {
    throw new Error(
      `source .blend changed at ${label}: expected ${expected}, received ${actual}`,
    )
  }
  return { label, sha256: actual }
}

const generated = run(blender, [
  '--background',
  '--factory-startup',
  '--disable-autoexec',
  '--python-exit-code', '73',
  '--python', resolve(experimentDir, 'make_fixture.py'),
  '--', sourcePath, generationPath,
], { cwd: experimentDir })
requireSuccess(generated, 'Blender fixture generation')
if (!generated.stdout.includes('BLENDLINK_HYBRID_MATERIAL_GATE_FIXTURE')) {
  throw new Error('fixture generation sentinel was absent')
}

const configText = `export default {
  outDir: 'public/models',
  genDir: 'src/generated',
  urlPrefix: '/models',
  scenes: [{
    name: 'hybridMaterialGate',
    file: 'fixture/hybrid-material-gate.blend',
  }],
}\n`
const configPath = resolve(workDir, 'blendlink.config.mjs')
writeFileSync(configPath, configText)

const publicationRegistry = resolve(outputDir, 'publication-registry')
const blenderUserResources = resolve(outputDir, 'blender-user-resources')
mkdirSync(publicationRegistry, { recursive: true })
mkdirSync(blenderUserResources, { recursive: true })
const childEnv = {
  ...process.env,
  BLENDLINK_PUBLICATION_LEASE_REGISTRY: publicationRegistry,
  BLENDER_USER_RESOURCES: blenderUserResources,
}

const initialSourceHash = sha256(sourcePath)
const sourceCheckpoints = [
  sourceCheckpoint('after-generation', initialSourceHash),
]

function runPlan(quality) {
  const args = [cli, 'plan', 'hybridMaterialGate']
  if (quality === 'preview') args.push('--preview')
  args.push('--json')
  const started = Date.now()
  const result = run(process.execPath, args, { env: childEnv })
  const durationMs = Date.now() - started
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(
      `${quality} plan did not emit JSON: ${error.message}\n` +
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  if (result.status !== 1) {
    throw new Error(
      `${quality} plan should refuse with exit 1, received ${result.status}\n` +
      `${result.stdout}\n${result.stderr}`,
    )
  }
  const scene = parsed.scenes?.[0]
  if (scene?.quality !== quality || !scene.plan) {
    throw new Error(`${quality} plan omitted its mixed-Hybrid plan: ${result.stdout}`)
  }

  const errors = scene.inspection?.errors ?? []
  const byMaterial = Object.fromEntries(errors.map((item) => [item.material, item]))
  const shared = byMaterial['Shared Painterly Surface']
  const lighting = byMaterial['Lighting Painterly Surface']
  if (
    errors.length !== 2
    || JSON.stringify(shared?.usedBy) !== JSON.stringify(['Dynamic Survivor'])
    || JSON.stringify(lighting?.usedBy) !== JSON.stringify(['Lighting Receiver'])
  ) {
    throw new Error(
      `${quality} plan did not retain exactly the live material occurrences: ` +
      `${JSON.stringify(errors)}`,
    )
  }
  if (errors.some((item) => item.usedBy?.includes('Appearance Receiver'))) {
    throw new Error(`${quality} plan incorrectly blocked the Appearance-owned occurrence`)
  }

  const appearancePlan = scene.plan.objects?.find(
    (item) => item.name === 'Appearance Receiver',
  )
  const lightingPlan = scene.plan.objects?.find(
    (item) => item.name === 'Lighting Receiver',
  )
  const dynamicPlan = scene.plan.dynamicObjects?.find(
    (item) => item.name === 'Dynamic Survivor',
  )
  if (
    appearancePlan?.atlas !== 'main'
    || appearancePlan?.bakeOutput !== 'appearance'
    || lightingPlan?.atlas !== 'lighting'
    || lightingPlan?.bakeOutput !== 'lighting'
    || !dynamicPlan
  ) {
    throw new Error(
      `${quality} plan lost exact ownership evidence: ` +
      `${JSON.stringify({
        appearancePlan,
        lightingPlan,
        dynamicPlan,
      })}`,
    )
  }
  return {
    command: `node packages/blendlink/dist/cli.js plan hybridMaterialGate${
      quality === 'preview' ? ' --preview' : ''
    } --json`,
    exitCode: result.status,
    durationMs,
    quality: scene.quality,
    ownership: {
      appearance: appearancePlan,
      lighting: lightingPlan,
      dynamic: dynamicPlan,
    },
    inspection: scene.inspection,
    stderr: result.stderr.trim(),
  }
}

const plans = {
  preview: runPlan('preview'),
}
sourceCheckpoints.push(sourceCheckpoint('after-preview-plan', initialSourceHash))
plans.final = runPlan('final')
sourceCheckpoints.push(sourceCheckpoint('after-final-plan', initialSourceHash))

function makeMinimalGlb() {
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0', generator: 'Blendlink Hybrid gate last-good seed' },
    scene: 0,
    scenes: [{ nodes: [] }],
  }))
  const paddedLength = (json.length + 3) & ~3
  const jsonChunk = Buffer.alloc(paddedLength, 0x20)
  json.copy(jsonChunk)
  const bytes = Buffer.alloc(12 + 8 + paddedLength)
  bytes.write('glTF', 0, 4, 'ascii')
  bytes.writeUInt32LE(2, 4)
  bytes.writeUInt32LE(bytes.length, 8)
  bytes.writeUInt32LE(paddedLength, 12)
  bytes.writeUInt32LE(0x4e4f534a, 16)
  jsonChunk.copy(bytes, 20)
  return bytes
}

const glbPath = resolve(workDir, 'public', 'models', 'hybridMaterialGate.glb')
const manifestPath = resolve(workDir, 'src', 'generated', 'hybridMaterialGate.manifest.json')
const modulePath = resolve(workDir, 'src', 'generated', 'hybridMaterialGate.gen.ts')
mkdirSync(dirname(glbPath), { recursive: true })
mkdirSync(dirname(manifestPath), { recursive: true })
const seedGlb = makeMinimalGlb()
if (
  seedGlb.toString('ascii', 0, 4) !== 'glTF'
  || seedGlb.readUInt32LE(4) !== 2
  || seedGlb.readUInt32LE(8) !== seedGlb.length
  || seedGlb.readUInt32LE(16) !== 0x4e4f534a
) {
  throw new Error('last-good seed is not a structurally valid glTF 2 GLB')
}
JSON.parse(
  seedGlb.subarray(20, 20 + seedGlb.readUInt32LE(12)).toString('utf8').trimEnd(),
)
const seedModule = Buffer.from(
  '// Valid TypeScript last-good sentinel; a failed compiler must preserve it.\n' +
  'export const hybridMaterialGate = { lastGood: true } as const\n',
)
const seedManifest = Buffer.from(`${JSON.stringify({
  generator: 'blendlink',
  schemaVersion: 3,
  hash: hash16(seedGlb),
  generatedModuleHash: hash16(seedModule),
  url: '/models/hybridMaterialGate.glb',
  sourceBlend: 'last-good-seed.blend',
  sourceHash: 'last-good-seed',
  nodes: [],
  materials: [],
  clips: {},
  markers: {},
  curves: {},
  vocabulary: {
    warnings: [],
    colliders: [],
    lods: [],
    physics: [],
  },
  excluded: [],
  stats: {
    bytes: seedGlb.length,
    triangles: 0,
    meshes: 0,
    texturesBytes: 0,
  },
}, null, 2)}\n`)
writeFileSync(glbPath, seedGlb)
writeFileSync(manifestPath, seedManifest)
writeFileSync(modulePath, seedModule)

const seeded = Object.fromEntries([
  ['glb', glbPath],
  ['manifest', manifestPath],
  ['module', modulePath],
].map(([name, path]) => [name, {
  path: normalized(relative(workDir, path)),
  bytes: statSync(path).size,
  sha256: sha256(path),
}]))

const compileStarted = Date.now()
const compiled = run(process.execPath, [
  cli,
  'compile',
  'hybridMaterialGate',
  '--force',
], { env: childEnv })
const compileDurationMs = Date.now() - compileStarted
if (compiled.status !== 1) {
  throw new Error(
    `Final force compile should refuse with exit 1, received ${compiled.status}\n` +
    `stdout:\n${compiled.stdout}\nstderr:\n${compiled.stderr}`,
  )
}
const compileText = `${compiled.stdout}\n${compiled.stderr}`
for (const expected of [
  'Blendlink Material Fidelity refused to publish hybridMaterialGate',
  'Shared Painterly Surface',
  'Dynamic Survivor',
  'Lighting Painterly Surface',
  'Lighting Receiver',
  'The staged export was discarded',
  'the previous publication was not changed',
]) {
  if (!compileText.includes(expected)) {
    throw new Error(`Final force compile omitted ${JSON.stringify(expected)}:\n${compileText}`)
  }
}
if (compileText.includes('Appearance Receiver')) {
  throw new Error(
    `Final force compile incorrectly reported the Appearance-owned use:\n${compileText}`,
  )
}
sourceCheckpoints.push(sourceCheckpoint('after-final-force-compile', initialSourceHash))

const preserved = Object.fromEntries(
  Object.entries({
    glb: glbPath,
    manifest: manifestPath,
    module: modulePath,
  }).map(([name, path]) => {
    const after = {
      path: normalized(relative(workDir, path)),
      bytes: statSync(path).size,
      sha256: sha256(path),
    }
    if (
      after.bytes !== seeded[name].bytes
      || after.sha256 !== seeded[name].sha256
    ) {
      throw new Error(
        `${name} publication changed across refused compile: ` +
        `${JSON.stringify({ before: seeded[name], after })}`,
      )
    }
    return [name, after]
  }),
)

const publicationFiles = listFiles(resolve(workDir, 'public')).map(
  (path) => normalized(relative(workDir, path)),
)
const generatedFiles = listFiles(resolve(workDir, 'src')).map(
  (path) => normalized(relative(workDir, path)),
)
const residue = [
  ...listEntries(workDir),
  ...listEntries(publicationRegistry),
].filter((path) =>
  /(?:^|[\\/])\.blendlink-stage-/u.test(path)
  || /\.blendlink-(?:next|backup)-/u.test(path),
).map((path) => normalized(relative(outputDir, path)))
if (residue.length > 0) {
  throw new Error(`refused compile left staging/transaction residue: ${residue.join(', ')}`)
}
if (
  JSON.stringify(publicationFiles) !== JSON.stringify([
    'public/models/hybridMaterialGate.glb',
  ])
  || JSON.stringify(generatedFiles) !== JSON.stringify([
    'src/generated/hybridMaterialGate.gen.ts',
    'src/generated/hybridMaterialGate.manifest.json',
  ])
) {
  throw new Error(
    `refused compile published unexpected files: ` +
    `${JSON.stringify({ publicationFiles, generatedFiles })}`,
  )
}

const baseline = JSON.parse(
  readFileSync(resolve(repositoryDir, 'docs', 'needle-baseline.json'), 'utf8'),
)
const baselineFile = (id) => {
  const entry = baseline.files.find((item) => item.id === id)
  if (!entry) throw new Error(`Needle baseline omits ${id}`)
  return entry
}
const needleIdentities = {
  addonVersion: baseline.identities.find(
    (item) => item.name === 'Needle Blender add-on',
  )?.version,
  lightmapping: {
    ...fileIdentity(needleLightmapping, needleRoot),
    baselineSha256: baselineFile('addon-lightmapping').sha256,
  },
  packing: {
    ...fileIdentity(needlePacking, needleRoot),
    baselineSha256: baselineFile('addon-lightmapping-pack').sha256,
  },
}
for (const [name, identity] of Object.entries({
  lightmapping: needleIdentities.lightmapping,
  packing: needleIdentities.packing,
})) {
  if (identity.sha256 !== identity.baselineSha256) {
    throw new Error(
      `Needle ${name} bytes differ from the pinned baseline: ` +
      `${identity.baselineSha256} -> ${identity.sha256}`,
    )
  }
}

const relevantDistFiles = [
  'cli.js',
  'config.js',
  'invoke.js',
  'planManifest.js',
  'sync.js',
  'typegen.js',
  'blender/bakelib.py',
  'blender/export_scene.py',
  'blender/material_compiler.py',
  'blender/procedural.py',
].map((path) => resolve(repositoryDir, 'packages', 'blendlink', 'dist', ...path.split('/')))
const dist = relevantDistFiles.map((path) => fileIdentity(path))
const distDigest = createHash('sha256')
for (const file of dist) {
  distDigest.update(file.path).update('\0').update(file.sha256).update('\n')
}

const generation = JSON.parse(readFileSync(generationPath, 'utf8'))
const evidence = {
  schemaVersion: 1,
  status: 'verified',
  runDate: new Date().toISOString(),
  command: 'node experiments/hybrid-material-gate-differential/run.mjs',
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    blenderExecutable: {
      absolutePath: normalized(resolve(blender)),
      ...fileIdentity(blender, dirname(blender)),
    },
    blender: generation.blender,
    gltfExporter: generation.gltfExporter,
    blendlink: {
      version: JSON.parse(
        readFileSync(resolve(repositoryDir, 'packages', 'blendlink', 'package.json'), 'utf8'),
      ).version,
      distTree: {
        algorithm: 'sha256(path + NUL + file sha256 + LF, listed order)',
        sha256: distDigest.digest('hex'),
        files: dist,
      },
      packageLock: fileIdentity(resolve(repositoryDir, 'package-lock.json')),
    },
  },
  fixture: {
    generator: fileIdentity(resolve(experimentDir, 'make_fixture.py')),
    runner: fileIdentity(resolve(experimentDir, 'run.mjs')),
    config: {
      path: normalized(relative(experimentDir, configPath)),
      bytes: Buffer.byteLength(configText),
      sha256: sha256(configPath),
    },
    generation,
    source: {
      path: normalized(relative(experimentDir, sourcePath)),
      bytes: statSync(sourcePath).size,
      sha256: initialSourceHash,
      checkpoints: sourceCheckpoints,
    },
  },
  needleBaseline: {
    auditDate: baseline.auditDate,
    integration: baseline.integration.status,
    behavior: (
      'Needle 1.4.2 selects separate object receivers, attaches one shared bake target, ' +
      'and invokes one native multi-object bake; object participation remains explicit.'
    ),
    relation: (
      'Blendlink matches the per-object ownership principle and improves on the audited ' +
      'Needle path with an occurrence-aware material-fidelity publication refusal. ' +
      'No analogous Needle material-portability gate was found.'
    ),
    addonRoot: normalized(resolve(needleRoot)),
    sources: needleIdentities,
  },
  plans,
  publicationTransaction: {
    command: (
      'node packages/blendlink/dist/cli.js compile hybridMaterialGate --force'
    ),
    exitCode: compiled.status,
    durationMs: compileDurationMs,
    stdout: compiled.stdout.trim(),
    stderr: compiled.stderr.trim(),
    seeded,
    preserved,
    publicationFiles,
    generatedFiles,
    residue,
  },
}
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)

console.log(
  'BLENDLINK_HYBRID_MATERIAL_GATE_DIFFERENTIAL_PASSED '
  + `source=${initialSourceHash} `
  + `dist=${evidence.environment.blendlink.distTree.sha256} `
  + `preview=${plans.preview.exitCode} final=${plans.final.exitCode} `
  + `compile=${compiled.status} preserved=${Object.keys(preserved).length}`,
)
