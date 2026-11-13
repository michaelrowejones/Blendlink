// Closed verification adapters. Each owns its source identity and evidence shape.
import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { nodePortHash, readSqueezeNodePortEvidence } from './node-port-contract.mjs'

const json = async path => JSON.parse(await readFile(path, 'utf8'))
const literalPaths = ['literal53-cpu/qualification.json', 'literal53-cpu/final-proof.json',
  'literal53-gpu/qualification.json', 'literal53-gpu/final-proof.json']

export function assertFloatToIntAdapterScope({ manifest, profile, completedRuns }) {
  assert.equal(manifest.evidence.adapter, 'float-to-int-literal-v1')
  assert.equal(manifest.nativeNode, 'FunctionNodeFloatToInt', 'Float to Integer evidence cannot qualify another native node')
  assert.equal(manifest.domain, 'compositor', 'Float to Integer evidence cannot qualify another tree context')
  assert.equal(profile.blenderVersion, '5.3.0'); assert.equal(profile.blenderBuildHash, '02f0899d78e3')
  assert.deepEqual(profile.hostPlatforms, ['darwin'])
  assert.deepEqual(profile.nativeSource, { profile: 'darwin-arm64-mf-v1', backend: null, evaluator: 'CPU-MF' })
  assert.equal(profile.expectedStatus, undefined)
  assert.deepEqual({ productionCases: manifest.evidence.productionCases, calibrationCases: manifest.evidence.calibrationCases,
    refusedNativeCases: manifest.evidence.refusedNativeCases }, { productionCases: 156, calibrationCases: 0, refusedNativeCases: 0 })
  assert.deepEqual(profile.runs.map(run => [run.id, run.adapter]), [['metal', 'metal'], ['software', 'software']])
  assert.deepEqual(completedRuns.map(run => [run.id, run.adapter]), profile.runs.map(run => [run.id, run.adapter]))
}

async function readFloatToIntEvidence({ root, evidence, manifest, profile, completedRuns }) {
  assertFloatToIntAdapterScope({ manifest, profile, completedRuns })
  for (const run of completedRuns) {
    const suite = await json(join(evidence, 'suite-' + run.id + '.json'))
    assert.equal(suite.status, 'passed'); assert.equal(suite.built, true)
    assert.equal(suite.profile, run.id); assert.equal(suite.productionCases, 156)
  }
  const { verifyLiteralEvidence } = await import(pathToFileURL(join(root, 'experiments/float-to-int-native/literal_verify.mjs')).href)
  const proof = await verifyLiteralEvidence({ root, directory: evidence })
  assert.equal(proof.status, 'QUALIFIED_LITERAL_BUILT_PORT')
  const finalSources = []
  for (const device of ['cpu', 'gpu']) {
    const folder = join(evidence, 'literal53-' + device), native = await json(join(folder, 'qualification.json'))
    for (const row of native.cases.filter(row => row.sourceFile)) {
      const path = await realpath(join(folder, row.sourceFile))
      assert.ok(path.startsWith((await realpath(evidence)) + sep), 'Saved Final source escaped the transaction')
      finalSources.push(path)
    }
  }
  return { status: 'qualified', productionCases: 156, nativeGraphs: proof.nativeGraphs,
    savedFinalScenes: proof.savedFinalScenes, caseRuns: proof.builtCaseRuns,
    primaryFloat32Words: proof.primaryFloat32Words, wordMismatches: 0, finalSources,
    files: await Promise.all(literalPaths.map(async path => ({ path, sha256: nodePortHash(await readFile(join(evidence, path))) }))),
    actualIdentity: { nativeVersion: [5, 3, 0], nativeBuild: '02f0899d78e3', nativeSource: {
      profile: 'darwin-arm64-mf-v1', evaluator: 'CPU-MF including GPU single values', gpuNumericalBackend: null,
      authoredCompositorDevices: ['CPU', 'GPU'] }, browsers: proof.receipts.map(row => ({ profile: row.profile, phase: row.phase,
        sourceDevice: row.sourceDevice, browserVersion: row.browserVersion, apis: row.apis })) } }
}

export const NODE_PORT_EVIDENCE_ADAPTERS = Object.freeze({
  'squeeze-v1': Object.freeze({ read: readSqueezeNodePortEvidence, nativeFinalPaths: ['references.json', 'final-proof.json'],
    finalSources: async evidence => (await json(join(evidence, 'references.json'))).cases.map(row => join(evidence, row.file)) }),
  'float-to-int-literal-v1': Object.freeze({ read: readFloatToIntEvidence, nativeFinalPaths: literalPaths,
    validate: ({ manifest, profile }) => assertFloatToIntAdapterScope({ manifest, profile, completedRuns: profile.runs }),
    finalSources: async evidence => (await Promise.all(['cpu', 'gpu'].map(async device => {
      const folder = join(evidence, 'literal53-' + device), native = await json(join(folder, 'qualification.json'))
      return native.cases.filter(row => row.sourceFile).map(row => join(folder, row.sourceFile))
    }))).flat() }),
})
export function nodePortEvidenceAdapter(name) { return Object.hasOwn(NODE_PORT_EVIDENCE_ADAPTERS, name) ? NODE_PORT_EVIDENCE_ADAPTERS[name] : null }
export async function nativeFinalEvidenceHash(adapter, evidence) {
  const files = []
  for (const path of adapter.nativeFinalPaths) {
    try { files.push([path, nodePortHash(await readFile(resolve(evidence, path)))]) }
    catch (error) { if (error.code !== 'ENOENT') throw error; files.push([path, null]) }
  }
  return nodePortHash(JSON.stringify(files))
}
