/* SPDX-License-Identifier: MIT */
/** Strict family close reuses both independent archived-word readers. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { executeNodePortCommand, fingerprintNodePortInputs, nodePortHash } from '../../scripts/lib/node-port-contract.mjs'
import { assertLensHorizontalControls } from '../../scripts/lib/node-port-lens-horizontal-evidence.mjs'
const root = resolve(import.meta.dirname, '../..'), [directory, destination, ...extra] = process.argv.slice(2)
assert.ok(directory && destination && !extra.length, 'Use verify.mjs EVIDENCE OUTPUT')
const out = resolve(directory), json = async path => JSON.parse(await readFile(path))
const manifest = await json(join(root, 'node-ports/compositor-lens-horizontal.json')), inputs = await json(join(out, 'matrix-inputs.json'))
assert.equal((await fingerprintNodePortInputs(root, manifest)).inputDigest, inputs.inputDigest, 'Lens declared inputs changed before independent close')
const invoke = async (name, args) => {
  const result = await executeNodePortCommand({ argv: [process.execPath, 'experiments/compositor-lens-horizontal/' + name + '.mjs', ...args], cwd: root,
    timeoutMs: 120000, logPath: join(out, 'reader-' + name + '.log') })
  assert.equal(result.exitCode, 0, name + ' independent reader failed'); assert.equal(result.timedOut, false); assert.equal(result.error, undefined)
}
await invoke('verify-pilot', [join(out, 'native'), join(out, 'policy'), join(out, 'sampling-metal'), join(out, 'sampling-software'), join(out, 'closed-sampling.json')])
await invoke('verify-public', [join(out, 'native'), join(out, 'final'), join(out, 'public-native'), join(out, 'baseline-metal'), join(out, 'baseline-software'),
  join(out, 'compare-metal'), join(out, 'compare-software'), join(out, 'closed-public.json')])
const sampling = await json(join(out, 'closed-sampling.json')), installed = await json(join(out, 'closed-public.json')), runs = []
assert.equal(sampling.runtimeFingerprint, installed.runtimeFingerprint)
for (const profile of ['metal', 'software']) {
  const raw = await json(join(out, 'sampling-' + profile, 'report.json')), publicReport = await json(join(out, 'compare-' + profile, 'report.json'))
  for (let i = 0; i < 2; i++) assertLensHorizontalControls(raw.apis[i], publicReport.apis[i])
  runs.push({ profile, apis: publicReport.apis.map(api => ({ backend: api.backend, gpu: api.gpu, cases: api.rows.length })) })
}
const archives = {}
for (const [key, folder, python, finals] of [['policy', 'policy', 1, 0], ['native', 'native', 1, 0], ['final', 'final', 5, 4], ['publicNative', 'public-native', 1, 0]]) {
  const archive = await json(join(out, folder, 'archive.json')); assert.equal(archive.proof.complete, true)
  assert.equal(archive.proof.pythonInvocations, python); assert.equal(archive.proof.finalInvocations, finals)
  const prefixes = new Set(archive.proof.invocations.filter(call => call.result.pythonGuardApplied).map(call => call.result.cacheDirectory))
  assert.equal(prefixes.size, python)
  archives[key] = { pythonInvocations: python, finalInvocations: finals, uniqueCachePrefixes: prefixes.size }
}
const result = { status: 'QUALIFIED_PARTIAL_HORIZONTAL_LENS_CPU_FINAL', supportCredit: 0, nativeGraphs: 4, savedFinalScenes: 4,
  nativeSamePixelCases: 20, nativeRenders: 40, browserCaseRuns: 48, primaryFloat32Words: 41760, supportingSamplingCases: 48,
  supportingSamplingWords: 41760, exactLinearWordDifferences: 0, resizeFrames: 48, installedCycles: 48,
  guardRefusals: 20, savedDisposeCases: 4, detachedDisposals: 4, cancellations: 4, uniqueActualPythonPrefixes: 8, archives,
  displayAudit: { words: installed.displayWords, alphaWordDifferences: 0, nonfiniteClassDifferences: 0, limit: 3e-5,
    maxClampedAbsoluteError: installed.maxDisplayClampedAbsoluteError, bitExactClaim: false }, runtimeFingerprint: sampling.runtimeFingerprint,
  sourcePolicy: { positive: 2, refusals: 14, numericalCredit: 0 }, runs,
  closedReaders: { sampling: nodePortHash(await readFile(join(out, 'closed-sampling.json'))), public: nodePortHash(await readFile(join(out, 'closed-public.json'))) },
  inputDigest: inputs.inputDigest }
await writeFile(resolve(destination), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result))
