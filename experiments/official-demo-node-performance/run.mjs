import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('../../', import.meta.url))), directory = fileURLToPath(new URL('./', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), json = async path => JSON.parse(await readFile(path, 'utf8'))
const corpus = await json(join(directory, 'corpus.json')), args = process.argv.slice(2), options = { repeat: 1 }
for (let index = 0; index < args.length; index++) {
  const key = args[index]
  if (['--render', '--stock-export', '--floor-experiment', '--camera-control', '--profile-materials'].includes(key)) { assert.ok(!options[key], 'Duplicate ' + key); options[key] = true; continue }
  assert.ok(['--blender', '--output', '--sources', '--scene', '--repeat'].includes(key) && args[index + 1] && !args[index + 1].startsWith('--') && !Object.hasOwn(options, key), 'Unknown/duplicate/missing option ' + key)
  options[key] = args[++index]
}
assert.ok(options['--blender'] && options['--output'], 'Use run.mjs --blender FILE --output NEW_DIRECTORY [--sources DIRECTORY] [--scene ID] [--repeat 1..5] [--render] [--camera-control] [--stock-export] [--floor-experiment]')
const repeats = Number(options['--repeat'] ?? options.repeat); assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 5)
const selected = corpus.scenes.filter(scene => !options['--scene'] || scene.id === options['--scene']); assert.ok(selected.length, 'Unknown corpus scene')
if (options['--floor-experiment']) assert.ok(selected.length === 1 && selected[0].id === 'cube-diorama', 'Floor experiment is explicitly Cube-only')
const output = resolve(options['--output']), sources = resolve(options['--sources'] ?? join(root, 'artifacts/verification-official-demo-performance/sources'))
await mkdir(output); await mkdir(join(output, 'copies'))
const reports = { schemaVersion: 1, kind: 'official-demo-performance-run-v1', proofRole: 'Real-scene native compatibility/cost triage, not Final/browser/fidelity qualification.', corpusSha256: hash(await readFile(join(directory, 'corpus.json'))), probeSha256: hash(await readFile(join(directory, 'probe.py'))), sourceCommit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), nodeVersion: process.version, host: { platform: process.platform, architecture: process.arch }, startedAt: new Date().toISOString(), requested: options, rows: [] }
async function sdkIdentity() {
  const records = []
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('SDK fingerprint does not follow symlinks')
      const name = join(path, entry.name)
      if (entry.isDirectory() && entry.name !== '__pycache__') await visit(name)
      else if (entry.isFile() && /\.(py|json)$/.test(entry.name)) records.push({ path: relative(root, name), sha256: hash(await readFile(name)) })
    }
  }
  await visit(join(root, 'packages/blender-addon')); await visit(join(root, 'packages/blendlink/blender'))
  return { records, sha256: hash(JSON.stringify(records)) }
}
const sdk = await sdkIdentity(); reports.sdkSources = sdk; await writeFile(join(output, 'run.json'), JSON.stringify(reports, null, 2))
function glbSummary(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF'); assert.equal(bytes.readUInt32LE(4), 2)
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')), scene = document.scenes[document.scene ?? 0], visited = new Set()
  let draws = 0, triangles = 0
  function visit(index) { assert.ok(!visited.has(index), 'Stock GLB node is repeated/cyclic'); visited.add(index); const node = document.nodes[index]; if (node.mesh !== undefined) for (const primitive of document.meshes[node.mesh].primitives) { draws++; if ((primitive.mode ?? 4) === 4) triangles += document.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3 }; for (const child of node.children ?? []) visit(child) }
  for (const index of scene.nodes ?? []) visit(index)
  return { bytes: bytes.length, sha256: hash(bytes), renderedTriangles: triangles, drawPrimitives: draws, materials: document.materials?.length ?? 0, images: document.images?.length ?? 0, embeddedImageBytes: (document.images ?? []).reduce((sum, image) => sum + (image.bufferView === undefined ? 0 : document.bufferViews[image.bufferView].byteLength), 0), role: 'Current-frame stock exporter control, not Blendlink Final.' }
}
let failed = false
for (const scene of selected) {
  const source = join(sources, scene.fileName), sourceBytes = await readFile(source), expected = scene.extractedSha256 ?? scene.sha256
  assert.equal(hash(sourceBytes), expected, 'Source does not match official corpus pin: ' + scene.id)
  assert.ok((await lstat(source)).isFile())
  const copy = join(output, 'copies', scene.fileName); await copyFile(source, copy)
  for (let iteration = 1; iteration <= repeats; iteration++) {
    const pycache = await mkdtemp(join(output, '.python-cache-'))
    const initializePython = 'import sys, os; sys.pycache_prefix=' + JSON.stringify(pycache) + '; sys.dont_write_bytecode=True; assert os.path.isdir(sys.pycache_prefix) and sys.dont_write_bytecode; print("BLENDLINK_DEMO_PYTHON_CACHE", sys.pycache_prefix, sys.dont_write_bytecode)'
    const sceneOutput = join(output, scene.id + '-' + iteration), argv = ['--background', '--factory-startup', '--disable-autoexec', copy, '-t', '1', '--python-exit-code', '1', '--python-expr', initializePython, '--python', join(directory, 'probe.py'), '--', '--sdk-root', root, '--output', sceneOutput, '--geometry', '--materials', ...['--render', '--camera-control', '--stock-export', '--floor-experiment', '--profile-materials'].filter(flag => options[flag])]
    let result, processWallMs
    try {
      const start = performance.now(); result = spawnSync(resolve(options['--blender']), argv, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180_000 }); processWallMs = performance.now() - start
    } finally { await rm(pycache, { recursive: true, force: true }) }
    const row = { scene: scene.id, iteration, argv, processWallMs, processExit: result.status, signal: result.signal, error: result.error?.message, sourceSha256Before: expected, sourceSha256After: hash(await readFile(source)), copySha256After: hash(await readFile(copy)), sourcePreserved: false, report: null }
    await writeFile(sceneOutput + '.stdout.log', result.stdout ?? ''); await writeFile(sceneOutput + '.stderr.log', result.stderr ?? '')
    assert.equal(row.sourceSha256After, expected); assert.equal(row.copySha256After, expected); row.sourcePreserved = true
    try { row.report = await json(join(sceneOutput, 'report.json')); if (row.report.phases.stockExport?.status === 'passed') row.stockArtifact = glbSummary(await readFile(join(sceneOutput, 'stock-control.glb'))) } catch (error) { row.reportReadError = error.message }
    row.status = result.status === 0 && row.report && Object.values(row.report.phases).every(phase => phase.status === 'passed') ? 'observed' : 'probe-failed'
    failed ||= row.status === 'probe-failed'; reports.rows.push(row); await writeFile(join(output, 'run.json'), JSON.stringify(reports, null, 2) + '\n')
    console.log(JSON.stringify({ scene: scene.id, iteration, status: row.status, processWallMs: row.processWallMs, materialOutcomes: row.report?.phases.materialPlan?.result?.outcomes, channelRefusals: row.report?.phases.materialPlan?.result?.channelRefusals?.length, triangles: row.report?.phases.geometry?.result?.trianglesSumPerObject }))
  }
}
reports.sdkSourcesStable = (await sdkIdentity()).sha256 === sdk.sha256; assert.equal(reports.sdkSourcesStable, true, 'SDK source changed during probe')
reports.completedAt = new Date().toISOString(); reports.status = failed ? 'probe-failures-retained' : 'observed-not-qualified'; await writeFile(join(output, 'run.json'), JSON.stringify(reports, null, 2) + '\n')
process.exitCode = failed ? 1 : 0
