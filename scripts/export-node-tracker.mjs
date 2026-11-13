#!/usr/bin/env node
// Local, core-only tracker data. No network, Google credentials or support writes.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const defaultRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
const CATEGORIES = ['supported', 'partial', 'bake-only', 'unsupported', 'structural']
const PRIORITIES = ['P0 Enablers', 'P1 Artist workflows', 'P2 Completion', 'P3 Later', 'Done', 'Legacy']
const CONTEXTS = ['shader', 'compositor']
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const pathSafe = value => typeof value === 'string' && value && !isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '..' && part !== '.')
const nativeKey = value => /^(shader|compositor):(?:ShaderNode|CompositorNode|FunctionNode|GeometryNode|Node)[A-Za-z0-9_]+$/.test(value)

export function validatePriorities(config, knownKeys) {
  assert.ok(record(config) && config.schemaVersion === 1, 'Expected node priorities schema1')
  assert.match(config.targetBlender, /^\d+\.\d+\.\d+$/)
  assert.ok(Array.isArray(config.auditedVersions) && config.auditedVersions.includes(config.targetBlender) && new Set(config.auditedVersions).size === config.auditedVersions.length)
  config.auditedVersions.forEach(version => assert.match(version, /^\d+\.\d+\.\d+$/))
  assert.deepEqual(config.priorityOrder, PRIORITIES, 'Priority labels/order must remain explicit')
  assert.equal(config.defaultPendingPriority, 'P2 Completion')
  for (const field of ['legacyPolicy', 'priorityBasis']) assert.ok(typeof config[field] === 'string' && config[field])
  assert.ok(record(config.dependencyGroups) && record(config.nodeRules))
  const known = key => assert.ok(nativeKey(key) && knownKeys.has(key), 'Unknown audited node/context key: ' + key)
  const group = id => assert.ok(Object.hasOwn(config.dependencyGroups, id), 'Unknown dependency group: ' + id)
  for (const [id, value] of Object.entries(config.dependencyGroups)) {
    assert.match(id, /^[a-z][a-z0-9-]*$/); assert.ok(value.label && value.rationale)
    assert.ok(Array.isArray(value.nodeKeys) && value.nodeKeys.length && new Set(value.nodeKeys).size === value.nodeKeys.length); value.nodeKeys.forEach(known)
    assert.ok(Array.isArray(value.requires)); value.requires.forEach(group)
  }
  const visited = new Set()
  function visit(id, stack = new Set()) { assert.ok(!stack.has(id), 'Cyclic dependency group: ' + id); if (visited.has(id)) return; for (const next of config.dependencyGroups[id].requires) visit(next, new Set([...stack, id])); visited.add(id) }
  Object.keys(config.dependencyGroups).forEach(id => visit(id))
  for (const [key, rule] of Object.entries(config.nodeRules)) { known(key); assert.ok(PRIORITIES.slice(0, 4).includes(rule.priority), 'Done/Legacy are derived from audited status, not configured promotions'); assert.ok(typeof rule.reason === 'string' && rule.reason); assert.ok(Array.isArray(rule.dependsOn)); rule.dependsOn.forEach(group) }
  for (const name of ['researchNotes', 'researchEvidencePaths', 'sceneObservations']) assert.ok(record(config[name]))
  for (const name of ['researchNotes', 'sceneObservations']) for (const [key, value] of Object.entries(config[name])) { known(key); assert.ok(typeof value === 'string' && value) }
  for (const [key, paths] of Object.entries(config.researchEvidencePaths)) { known(key); assert.ok(Array.isArray(paths)); paths.forEach(path => assert.ok(pathSafe(path))) }
  assert.ok(Array.isArray(config.observationEvidence)); config.observationEvidence.forEach(path => assert.ok(pathSafe(path)))
  return config
}

export function buildNodeTracker({ coverage, capabilities, catalogs, priorities, source, now = () => new Date().toISOString() }) {
  assert.equal(coverage.schemaVersion, 1); assert.equal(capabilities.schemaVersion, 1)
  const reports = new Map(coverage.reports.map(report => [report.blenderVersion.match(/^\d+\.\d+\.\d+/)?.[0], report]))
  const all = new Map(), classified = new Map(), refused = new Set()
  for (const version of priorities.auditedVersions) {
    assert.ok(reports.has(version) && catalogs[version], 'Missing audited version: ' + version)
    for (const context of CONTEXTS) {
      const native = catalogs[version].domains[context], report = reports.get(version).domains[context]
      assert.ok(native && report && Array.isArray(native.nodes) && Array.isArray(report.nodes))
      const actual = new Set(native.nodes.map(node => node.id)); assert.equal(actual.size, native.nodes.length, 'Duplicate native inventory key')
      assert.equal(actual.size, report.nodes.length, 'Coverage/native inventory counts differ')
      for (const node of report.nodes) {
        assert.ok(actual.has(node.id) && CATEGORIES.includes(node.category), 'Coverage does not match actual inventory')
        const key = context + ':' + node.id, slot = version + ':' + key
        assert.ok(!classified.has(slot), 'Duplicate coverage key'); classified.set(slot, node)
        all.set(key, { key, context, nativeNodeId: node.id })
      }
      for (const item of native.unavailable ?? []) refused.add(version + ':' + context + ':' + item.id)
    }
  }
  validatePriorities(priorities, new Set(all.keys()))
  assert.ok(source && /^[a-f0-9]{40}$/.test(source.commit) && typeof source.repository === 'string')
  const baseUrl = `https://github.com/${source.repository}/blob/${source.commit}/`
  const url = path => { assert.ok(pathSafe(path), 'Evidence path must be repository-relative'); return baseUrl + path.split('/').map(encodeURIComponent).join('/') }
  const rows = [...all.values()].map(identity => {
    const { key, context, nativeNodeId } = identity, versions = {}, nativeAvailability = {}
    for (const version of priorities.auditedVersions) { versions[version] = classified.get(version + ':' + key)?.category ?? 'not-available'; nativeAvailability[version] = versions[version] !== 'not-available' ? 'present' : refused.has(version + ':' + key) ? 'creation-refused' : 'not-observed' }
    const presentVersions = priorities.auditedVersions.filter(version => versions[version] !== 'not-available'), latestPresentVersion = presentVersions.at(-1), latest = classified.get(latestPresentVersion + ':' + key), target = classified.get(priorities.targetBlender + ':' + key)
    const entry = capabilities.entries[key] ?? {}, effective = { ...entry, ...entry.versionOverrides?.[latestPresentVersion] }, rule = priorities.nodeRules[key]
    let recommendedPriority, priorityReason
    if (!target) { recommendedPriority = 'Legacy'; priorityReason = 'Absent from the Blender ' + priorities.targetBlender + ' audited context; preserve existing legacy routes and guards without counting them as target-version ports.' }
    else if (['supported', 'structural'].includes(target.category)) { recommendedPriority = 'Done'; priorityReason = target.category === 'structural' ? 'Existing structural contract within declared limits; this is not a numerical node port.' : 'Covered within the declared input/mode/profile limits; maintain regression coverage. Done does not mean arbitrary inputs or complete-scene pixel parity.' }
    else { recommendedPriority = rule?.priority ?? priorities.defaultPendingPriority; priorityReason = rule?.reason ?? 'Complete the recorded mode/domain/source-profile gaps. Relative workflow frequency and unlock value are unknown; this is the default engineering backlog tier.' }
    const dependencies = [...new Set(rule?.dependsOn ?? [])], paths = [...latest.evidence.map(item => item.path), ...(effective.runtimePath ? [effective.runtimePath] : []), 'docs/node-capabilities.json', `docs/node-coverage/blender-${latestPresentVersion}.json`, ...(priorities.researchEvidencePaths[key] ?? [])]
    return { ...identity, name: latest.label, presentInTarget: Boolean(target), targetStatus: target?.category ?? 'not-available', latestPresentVersion, latestPresentStatus: latest.category, versions, nativeAvailability,
      recommendedPriority, priorityReason, dependencies, dependencyLabels: dependencies.map(id => priorities.dependencyGroups[id].label),
      usageBasis: 'Engineering inference, not user telemetry or numeric popularity. ' + (priorities.sceneObservations[key] ?? 'No usage observation is established by this tracker; native availability does not prove EEVEE viability.'),
      limits: latest.limits, note: latest.unreviewedCapability ? 'Capability needs explicit review; no automatic support promotion.' : latest.category === 'bake-only' ? 'Bake route only; not live node translation.' : latest.category === 'unsupported' ? 'No reviewed live compiler/extractor + runtime route.' : 'Classification is limited to the exact recorded scope; modes and arbitrary graph combinations are not additional covered nodes.',
      researchNote: priorities.researchNotes[key] ?? '', evidenceUrls: [...new Set(paths)].map(url) }
  }).sort((a, b) => a.context.localeCompare(b.context) || a.nativeNodeId.localeCompare(b.nativeNodeId))
  const count = values => Object.fromEntries(values.map(value => [value, rows.filter(row => row.recommendedPriority === value).length]))
  const contexts = Object.fromEntries(CONTEXTS.map(context => { const current = rows.filter(row => row.context === context && row.presentInTarget); return [context, { total: current.length, statuses: Object.fromEntries(CATEGORIES.map(category => [category, current.filter(row => row.targetStatus === category).length])) }] }))
  return { schemaVersion: 1, kind: 'blendlink-node-tracker-v1', targetBlender: priorities.targetBlender, generatedAt: now(), source,
    policy: { countUnit: 'One native node ID in one audited shader/compositor context; modes and root/group subcontexts do not multiply rows. Geometry-only contexts excluded.', legacy: priorities.legacyPolicy, priorityBasis: priorities.priorityBasis, priorityOrder: priorities.priorityOrder, manualOverrides: 'Recommendations only. The external sheet owns manual overrides and user notes; this exporter never reads or overwrites them.' },
    summary: { unionRows: rows.length, targetRows: rows.filter(row => row.presentInTarget).length, legacyRows: rows.filter(row => !row.presentInTarget).length, contexts, priorityCounts: count(PRIORITIES) },
    dependencyGroups: Object.entries(priorities.dependencyGroups).map(([id, value]) => ({ id, ...value, pendingNodeKeys: value.nodeKeys.filter(key => !['Done', 'Legacy'].includes(rows.find(row => row.key === key).recommendedPriority)), note: 'Roadmap prerequisites only; membership does not imply implementation or numerical support.' })), rows }
}

export async function exportNodeTracker({ root = defaultRoot, prioritiesPath = 'config/node-port-priorities.json', now } = {}) {
  root = resolve(root)
  const files = new Map(), load = async path => { assert.ok(pathSafe(path)); const bytes = await readFile(join(root, path)); files.set(path, sha(bytes)); return JSON.parse(bytes.toString('utf8')) }
  const priorities = await load(prioritiesPath), coverage = await load('docs/node-coverage/coverage.json'), capabilities = await load('docs/node-capabilities.json'), catalogs = {}
  assert.equal(files.get('docs/node-capabilities.json'), coverage.capabilityMapSha256, 'Coverage/capability map disagree; regenerate coverage before refreshing the tracker')
  for (const version of priorities.auditedVersions) catalogs[version] = await load('docs/node-coverage/blender-' + version + '.json')
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), branch = execFileSync('git', ['-C', root, 'branch', '--show-current'], { encoding: 'utf8' }).trim()
  const sourceFingerprintDrift = []
  for (const [path, expected] of Object.entries(coverage.sourceSha256)) { assert.ok(pathSafe(path)); let actual; try { actual = sha(await readFile(join(root, path))) } catch (error) { if (error.code !== 'ENOENT') throw error; actual = null }; if (actual !== expected) sourceFingerprintDrift.push({ path, expectedSha256: expected, actualSha256: actual }) }
  return buildNodeTracker({ coverage, capabilities, catalogs, priorities, now, source: { repository: 'michaelrowejones/Blendlink', commit, branch, remoteVerification: 'Not performed; this exporter is local only. Automation should run a published checkout.', coverageGeneratedAt: coverage.generatedAt, files: [...files].map(([path, sha256]) => ({ path, sha256 })), sourceFingerprintDrift, validationFailures: coverage.capabilityValidationFailures, nativeAvailabilityChanges: coverage.nativeAvailabilityChanges } })
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), options = {}, allowed = { '--root': 'root', '--priorities': 'prioritiesPath', '--output': 'output' }
    assert.equal(args.length % 2, 0, 'Use --output FILE [--root DIR] [--priorities REPOSITORY_RELATIVE_FILE]')
    for (let index = 0; index < args.length; index += 2) { const key = allowed[args[index]], value = args[index + 1]; assert.ok(key && value && !value.startsWith('--') && !Object.hasOwn(options, key), 'Unknown/duplicate/missing option'); options[key] = value }
    const result = await exportNodeTracker(options), text = JSON.stringify(result, null, 2) + '\n'
    if (options.output) { const path = resolve(options.output), temporary = path + '.' + randomUUID() + '.tmp'; await mkdir(dirname(path), { recursive: true }); try { await writeFile(temporary, text, { flag: 'wx' }); await rename(temporary, path) } finally { await rm(temporary, { force: true }) } }
    else process.stdout.write(text)
  } catch (error) { process.stderr.write('BLENDLINK_NODE_TRACKER_EXPORT_FAILED: ' + error.message + '\n'); process.exitCode = 1 }
}
