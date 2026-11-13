import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { assertFloatToIntAdapterScope, nativeFinalEvidenceHash, nodePortEvidenceAdapter } from './node-port-evidence.mjs'
import { readNodePortManifest, validateNodePortManifest, fingerprintNodePortInputs } from './node-port-contract.mjs'
import { runNodePort } from '../test-node-port.mjs'

const root = resolve(import.meta.dirname, '../..')
const manifest = await readNodePortManifest(join(root, 'node-ports/float-to-int.json'))
const scope = () => ({ manifest: structuredClone(manifest), profile: structuredClone(manifest.profiles[0]), completedRuns: structuredClone(manifest.profiles[0].runs) })

test('Float to Integer adapter is bound to actual class/context and explicit CPU-MF source semantics', () => {
  assertFloatToIntAdapterScope(scope())
  assert.equal(manifest.lifecycle, 'production')
  assert.equal(manifest.profiles[0].nativeSource.backend, null)
  assert.equal(manifest.profiles[0].nativeSource.evaluator, 'CPU-MF')
  for (const patch of [{ nativeNode: 'FunctionNodeIntegerMath' }, { domain: 'shader' }]) {
    assert.throws(() => validateNodePortManifest({ ...structuredClone(manifest), ...patch }), /Float to Integer evidence cannot qualify/)
  }
  const forged = structuredClone(manifest)
  forged.profiles[0].nativeSource.backend = 'METAL'
  assert.throws(() => validateNodePortManifest(forged), /must not assert a GPU backend/)
  assert.ok(nodePortEvidenceAdapter('squeeze-v1'))
  assert.ok(nodePortEvidenceAdapter('float-to-int-literal-v1'))
  for (const name of ['asserted-future-adapter', 'constructor', '__proto__', 'toString']) assert.equal(nodePortEvidenceAdapter(name), null)
})

test('partial profile/run/domain receipts cannot qualify the closed Float to Integer adapter', () => {
  for (const mutate of [
    value => { value.manifest.nativeNode = 'ShaderNodeMath' },
    value => { value.manifest.domain = 'shader' },
    value => { value.profile.blenderVersion = '5.4.0' },
    value => { value.profile.blenderBuildHash = 'unmeasured' },
    value => { value.profile.nativeSource.evaluator = 'GPU' },
    value => { value.profile.nativeSource.backend = 'METAL' },
    value => { value.profile.hostPlatforms = ['linux'] },
    value => { value.profile.expectedStatus = 'not-applicable' },
    value => { value.completedRuns.pop() },
    value => { value.completedRuns[1].adapter = 'metal' },
    value => { value.manifest.evidence.productionCases = 0 },
    value => { value.manifest.evidence.refusedNativeCases = 1 },
  ]) { const value = scope(); mutate(value); assert.throws(() => assertFloatToIntAdapterScope(value)) }
})

test('native/Final sharing pins every source device and Final receipt', async t => {
  const evidence = await mkdtemp(join(tmpdir(), 'scenetoweb-evidence-sharing-'))
  t.after(() => rm(evidence, { recursive: true, force: true }))
  const adapter = nodePortEvidenceAdapter('float-to-int-literal-v1')
  const empty = await nativeFinalEvidenceHash(adapter, evidence)
  const { mkdir } = await import('node:fs/promises')
  for (const path of adapter.nativeFinalPaths) {
    await mkdir(resolve(evidence, path, '..'), { recursive: true })
    await writeFile(join(evidence, path), 'original-' + path)
  }
  const baseline = await nativeFinalEvidenceHash(adapter, evidence)
  assert.notEqual(baseline, empty)
  for (const path of adapter.nativeFinalPaths) {
    const bytes = await readFile(join(evidence, path))
    await writeFile(join(evidence, path), 'changed')
    assert.notEqual(await nativeFinalEvidenceHash(adapter, evidence), baseline, path)
    await writeFile(join(evidence, path), bytes)
  }
  assert.equal(await nativeFinalEvidenceHash(adapter, evidence), baseline)
})

test('dry-run plans both adapters and fresh native work without reading or launching Blender', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'scenetoweb-port-plan-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const blender = join(directory, 'not-an-executable')
  await writeFile(blender, 'This must never execute or be hashed')
  const result = await runNodePort({ root, id: 'float-to-int', profile: 'mac-53', blender, evidence: join(directory, 'untouched'), dryRun: true })
  assert.equal(result.status, 'planned'); assert.equal(result.runnable, true)
  assert.equal(result.nativeIdentity.sha256, null); assert.equal(result.productionCredit, false)
  const suites = result.commands.filter(command => command.id.startsWith('suite-'))
  assert.deepEqual(suites.map(command => command.id), ['suite-metal', 'suite-software'])
  assert.equal(suites[0].argv.includes('--reuse-native'), false)
  assert.equal(suites[1].argv.includes('--reuse-native'), true)
  assert.equal(suites[0].env.BLENDLINK_TEST_PROFILE, 'metal')
  assert.equal(suites[1].env.BLENDLINK_TEST_PROFILE, 'software')
  await assert.rejects(readFile(join(directory, 'untouched/report.json')), { code: 'ENOENT' })
})


test('unrelated fixture edits preserve qualification inputs while shared oracle changes invalidate them', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'scenetoweb-fixture-closure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const candidate = structuredClone(manifest)
  candidate.inputs.runtime = ['runtime.ts']; candidate.inputs.sdk = ['package.json']; candidate.inputs.tests = ['verify.mjs']
  const files = ['packages/blender-addon/procedural.py', 'packages/blender-addon/web_runtime_limits.json', 'packages/blender-addon/tests/compositor_float_to_int_check.py',
    'packages/blender-addon/tests/compositor_reference.py', 'packages/blender-addon/tests/unrelated_check.py',
    'packages/blendlink/blender/compositor_graph.py', 'experiments/float-to-int-native/values.py', 'runtime.ts', 'package.json', 'verify.mjs']
  for (const path of files) { await mkdir(resolve(directory, path, '..'), { recursive: true }); await writeFile(join(directory, path), 'original') }
  const before = await fingerprintNodePortInputs(directory, candidate)
  await writeFile(join(directory, 'packages/blender-addon/tests/unrelated_check.py'), 'new independent probe')
  assert.equal((await fingerprintNodePortInputs(directory, candidate)).inputDigest, before.inputDigest)
  await writeFile(join(directory, 'packages/blender-addon/tests/compositor_reference.py'), 'new native oracle')
  const after = await fingerprintNodePortInputs(directory, candidate)
  assert.notEqual(after.nativeInputDigest, before.nativeInputDigest)
  assert.equal(after.runtimeInputDigest, before.runtimeInputDigest)
})
