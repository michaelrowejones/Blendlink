import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readCpuLumaQualification, verifyProductionLumaBrowser } from './precision-protocol.mjs'

const root = resolve(import.meta.dirname, '../..'), evidence = resolve(process.argv[2] || 'artifacts/verification-luma-cpu-host')
const blender = process.env.BLENDLINK_BLENDER
assert.ok(blender, 'BLENDLINK_BLENDER must name the actual native executable')
const expectedAdmission=process.env.BLENDLINK_LUMA_EXPECTED_SOURCE_ADMISSION
assert.ok(expectedAdmission===undefined||['PRODUCTION_QUALIFIED','SOURCE_ADMISSION_NA'].includes(expectedAdmission),
  'Expected source admission must be an explicit production or N/A outcome')
await mkdir(evidence, { recursive: true })
const report = { schemaVersion: 1, kind: 'native-cpu-luma-host-qualification', status: 'running',
  hostPlatform: process.platform, hostArchitecture: process.arch, productionAdmissionCases: 0, steps: [] }
async function run(name, executable, args, env = {}) {
  const result = spawnSync(executable, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  await writeFile(join(evidence, name + '.log'), (result.stdout || '') + (result.stderr || '') + (result.error ? '\n' + result.error.stack : ''))
  report.steps.push({ name, exitCode: result.status, signal: result.signal }); await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  assert.equal(result.status, 0, name + ' failed; inspect retained log')
}
async function native(name, script, env) {
  await run(name, blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script], env)
}
try {
  const ordinary = join(evidence, 'ordinary'), trial = join(evidence, 'experimental'), words = join(evidence, 'words'), dot = join(evidence, 'dot'), ratio = join(evidence, 'ratio')
  const fixture = 'packages/blender-addon/tests/compositor_luminance_key_check.py'
  await native('ordinary-native', fixture, { BLENDLINK_COMPOSITOR_LUMINANCE_KEY_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_LUMINANCE_KEY_REFERENCES: ordinary, BLENDLINK_LUMA_CPU_EXACT_EXPERIMENT: '0' })
  await native('experimental-native', fixture, { BLENDLINK_COMPOSITOR_LUMINANCE_KEY_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_LUMINANCE_KEY_REFERENCES: trial, BLENDLINK_LUMA_CPU_EXACT_EXPERIMENT: '1' })
  const base = await readCpuLumaQualification(ordinary), experiment = await readCpuLumaQualification(trial)
  assert.equal(base.packet.productionAdmission, experiment.packet.productionAdmission)
  if(expectedAdmission!==undefined)assert.equal(base.packet.productionAdmission,expectedAdmission,
    'The requested source admission was not emitted by actual production extraction')
  assert.equal(base.packet.experimentalKernelTrial,false);assert.equal(experiment.packet.experimentalKernelTrial,true)
  assert.deepEqual(base.packet.sourceCpuProfile, experiment.packet.sourceCpuProfile)
  const original = JSON.parse(await readFile(join(ordinary, 'index.json'))), expanded = JSON.parse(await readFile(join(trial, 'index.json')))
  assert.ok(expanded.length >= original.length)
  // Original native pixels and source programs must not be changed to earn the trial.
  for (const row of original.slice(0, base.packet.ordinaryCases)) assert.deepEqual(
    JSON.parse(await readFile(join(ordinary, row.case + '.json'))), JSON.parse(await readFile(join(trial, row.case + '.json'))))
  Object.assign(report, { productionSourceAdmission: base.packet.productionAdmission, sourceCpuProfile: base.packet.sourceCpuProfile,
    sourceVersion: base.packet.sourceVersion, sourceBuildHash: base.packet.sourceBuildHash, ordinarySourceCases: original.length,
    experimentalKernelCases: experiment.packet.precisionCases, originalNativeAndSourceProgramsUnchanged: true })
  await native('word-native', 'experiments/luma-cpu-precision/word_reference.py', { BLENDLINK_LUMA_WORD_REFERENCES: words })
  await native('dot-native', 'experiments/luma-cpu-precision/dot_reference.py', { BLENDLINK_LUMA_DOT_REFERENCES: dot })
  await native('ratio-native', 'experiments/luma-cpu-precision/ratio_reference.py', { BLENDLINK_LUMA_RATIO_REFERENCES: ratio })
  // Keep actual API/driver diagnostics even when the browser cannot start the
  // numerical trial. Native source captures above remain intact on failure.
  await run('browser-profile', process.execPath, ['experiments/luma-cpu-precision/browser-profile.mjs', join(evidence, 'browser-profile.json')])
  await run('ordinary-browser', process.execPath, ['experiments/native-compositor-differential/run.mjs', '--built', '--out', join(evidence, 'ordinary-browser'), ordinary])
  if(base.packet.productionAdmission==='PRODUCTION_QUALIFIED'){
    const productionResults=JSON.parse(await readFile(join(evidence,'ordinary-browser/results.json')))
    report.productionAdmissionCases=verifyProductionLumaBrowser(productionResults,base.packet)
    report.productionBrowserContract='actual-production-compositor-bit-exact-v1'
  }
  await run('experimental-kernel-browser', process.execPath, ['experiments/luma-cpu-precision/kernel-trial-run.mjs', '--built', '--out', join(evidence, 'experimental-browser'), trial])
  const primitives = [join(dot, 'dot.json'), join(ratio, 'ratio.json')]
  if (base.packet.sourceCpuProfile.mode === 'gradual-rne') primitives.push(join(words, 'multiply/word.json'), join(words, 'add/word.json'))
  await run('primitive-browser', process.execPath, ['experiments/luma-cpu-precision/primitive-run.mjs', ...primitives, '--out', join(evidence, 'primitive-browser')])
  report.status = 'passed'; console.log('BLENDLINK_LUMA_HOST_QUALIFICATION_PASSED sourceAdmission=' + base.packet.productionAdmission + ' experimentalKernelCases=' + experiment.packet.precisionCases)
} catch (error) { report.status = 'failed'; report.error = String(error); throw error }
finally { await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2)) }
