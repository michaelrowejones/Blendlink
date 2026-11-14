import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildNodeTracker, exportNodeTracker, validatePriorities } from './export-node-tracker.mjs'
const root = resolve(import.meta.dirname, '..'), read = async path => JSON.parse(await readFile(join(root, path), 'utf8'))
const priorities = await read('config/node-port-priorities.json'), coverage = await read('docs/node-coverage/coverage.json'), capabilities = await read('docs/node-capabilities.json')
const catalogs = Object.fromEntries(await Promise.all(priorities.auditedVersions.map(async version => [version, await read('docs/node-coverage/blender-' + version + '.json')]))), source = { repository: 'michaelrowejones/Blendlink', commit: 'a'.repeat(40) }
const make = changes => buildNodeTracker({ coverage, capabilities, catalogs, priorities, source, now: () => 'fixed-test-time', ...changes })
const tracker = make(), knownKeys = new Set(tracker.rows.map(row => row.key))

test('compact exporter retains exact target/legacy denominators without enum/schema inflation or sheet-owned fields', async () => {
  const actual = await exportNodeTracker({ root, now: () => 'fixed-test-time' })
  assert.equal(actual.targetBlender, '5.3.0'); assert.equal(actual.summary.unionRows, 358); assert.equal(actual.summary.targetRows, 332); assert.equal(actual.summary.legacyRows, 26)
  assert.equal(actual.dependencyGroups.length, 9); assert.ok(JSON.stringify(actual).length < 1_000_000)
  assert.deepEqual(actual.summary.contexts.shader.statuses, coverage.reports.find(report => report.blenderVersion === '5.3.0').domains.shader.counts)
  assert.equal(new Set(actual.rows.map(row => row.key)).size, actual.rows.length)
  for (const row of actual.rows) { assert.ok(!Object.hasOwn(row, 'manualOverride') && !Object.hasOwn(row, 'effectivePriority') && !Object.hasOwn(row, 'userNotes')); assert.ok(!Object.hasOwn(row, 'socketSchemas')); assert.ok(row.evidenceUrls.every(url => url.startsWith('https://github.com/michaelrowejones/Blendlink/blob/' + actual.source.commit + '/'))) }
})

test('priority is separate from support, dependencies and usage evidence; research never promotes a node', () => {
  const get = key => tracker.rows.find(row => row.key === key)
  assert.equal(get('compositor:FunctionNodeFloatToInt').recommendedPriority, 'P0 Enablers'); assert.equal(get('compositor:FunctionNodeFloatToInt').targetStatus, 'partial'); assert.match(get('compositor:FunctionNodeFloatToInt').researchNote, /qualified partial literal production port/i)
  assert.equal(get('shader:ShaderNodeRadialTiling').recommendedPriority, 'P1 Artist workflows'); assert.equal(get('shader:ShaderNodeRadialTiling').targetStatus, 'partial'); assert.match(get('shader:ShaderNodeRadialTiling').limits, /Segment Width/); assert.match(get('shader:ShaderNodeRadialTiling').usageBasis, /official Radial/)
  const researchOnly=structuredClone(coverage);researchOnly.reports.find(row=>row.blenderVersion==='5.3.0').domains.shader.nodes.find(row=>row.id==='ShaderNodeRadialTiling').category='unsupported'
  assert.equal(make({coverage:researchOnly}).rows.find(row=>row.key==='shader:ShaderNodeRadialTiling').targetStatus,'unsupported','The same research/priority metadata cannot promote an unqualified coverage record')
  assert.equal(get('shader:ShaderNodeMath').recommendedPriority, 'Done'); assert.match(get('shader:ShaderNodeMath').priorityReason, /within.*limits/)
  assert.equal(get('shader:ShaderNodeCombineHSV').recommendedPriority, 'Legacy'); assert.equal(get('shader:ShaderNodeCombineHSV').targetStatus, 'not-available'); assert.equal(get('shader:ShaderNodeCombineHSV').versions['4.2.0'], 'partial')
  assert.ok(get('shader:ShaderNodeBump').dependencies.includes('image-sampling-lod')); assert.match(get('shader:ShaderNodeLightFalloff').usageBasis, /not user telemetry/)
})

test('unknown IDs, typo dependencies, cycles and configured Done promotions fail closed', () => {
  for (const mutate of [p => { p.nodeRules['shader:InventedNode'] = p.nodeRules['shader:ShaderNodeBump'] }, p => { p.nodeRules['shader:ShaderNodeBump'].dependsOn = ['typo'] }, p => { p.dependencyGroups['typed-field-contracts'].requires = ['image-sampling-lod'] }, p => { p.nodeRules['shader:ShaderNodeBump'].priority = 'Done' }]) { const changed = structuredClone(priorities); mutate(changed); assert.throws(() => validatePriorities(changed, knownKeys)) }
})

test('status regression returns a supported enabler to the backlog instead of leaving it Done', () => {
  const changed = structuredClone(coverage), node = changed.reports.find(r => r.blenderVersion === '5.3.0').domains.shader.nodes.find(n => n.id === 'ShaderNodeMath'); node.category = 'partial'
  const row = make({ coverage: changed }).rows.find(row => row.key === 'shader:ShaderNodeMath')
  assert.equal(row.targetStatus, 'partial'); assert.equal(row.recommendedPriority, 'P0 Enablers')
})

test('a stale generated capability map refuses automatic local export', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blendlink-tracker-stale-')); t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'config')); await mkdir(join(directory, 'docs/node-coverage'), { recursive: true })
  await writeFile(join(directory, 'config/node-port-priorities.json'), JSON.stringify(priorities)); await writeFile(join(directory, 'docs/node-coverage/coverage.json'), JSON.stringify(coverage)); await writeFile(join(directory, 'docs/node-capabilities.json'), '{}')
  await assert.rejects(exportNodeTracker({ root: directory }), /Coverage\/capability map disagree/)
})

test('classification refresh preserves the native inventory audit date', async () => {
  const tracker = await exportNodeTracker({ root })
  assert.equal(tracker.source.coverageGeneratedAt, coverage.generatedAt)
  assert.equal(tracker.source.nativeInventoryAuditGeneratedAt,
    coverage.classificationRefresh?.nativeInventoryAuditGeneratedAt ?? coverage.generatedAt)
  assert.equal(tracker.source.nativeInventoryRefreshed,
    coverage.classificationRefresh?.nativeInventoryRefreshed ?? true)
})
