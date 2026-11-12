// Native Blender pixels -> exported programs -> built browser runtime.
// Requires a supported Node runtime, built package, Blender and Chromium.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { NODE_PARITY_SUITES, nodeParityPlan } from './lib/node-parity-plan.mjs'

const plan = nodeParityPlan(process.argv.slice(2))
if (process.argv.includes('--list-suites')) {
  console.log(JSON.stringify({ suites: NODE_PARITY_SUITES, selected: plan.selected })); process.exit(0)
}

const root = resolve(import.meta.dirname, '..')
const evidence = resolve(process.env.BLENDLINK_NATIVE_NODE_EVIDENCE || join(root, 'artifacts/verification-native-node-gate'))
mkdirSync(evidence, { recursive: true })
rmSync(join(evidence, 'report.json'), { force: true })
rmSync(join(evidence, 'browser'), { recursive: true, force: true })
const failures = []
function attempt(label, action) {
  try { action(); return true }
  catch (error) {
    failures.push({ label, message: String(error.message).split('\n')[0] })
    console.error('BLENDLINK_NODE_GATE_STEP_FAILED ' + label + ': ' + String(error.message).split('\n')[0])
    return false
  }
}
function run(label, executable, args, extraEnv = {}, timeout = 600_000) {
  console.log('BLENDLINK_NODE_GATE_STEP ' + label)
  const started = Date.now()
  const result = spawnSync(executable, args, {
    cwd: root, env: { ...process.env, ...extraEnv }, encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true,
  })
  const output = (result.stdout ?? '') + '\n' + (result.stderr ?? '')
  writeFileSync(join(evidence, label + '.log'), output)
  assert.ok(!result.error && result.status === 0,
    `${label}: ${result.error?.message ?? `exit ${result.status}`}\n${output.slice(-6000)}`)
  console.log(`BLENDLINK_NODE_GATE_STEP_PASSED ${label} ${(Date.now() - started) / 1000}s`)
  return output
}

const blender = run('discovery', process.execPath,
  [join(root, 'packages/blendlink/dist/cli.js'), 'discover']).trim().split(/\r?\n/).filter(Boolean).at(-1)
assert.ok(blender, 'Blender discovery returned no executable')
const capabilitiesFile = join(evidence, 'native-capabilities.json')
run('native-capabilities', blender, ['--background', '--factory-startup', '--python-exit-code', '1',
  '--python', join(root, 'experiments/native-compositor-differential/capabilities.py'), '--', capabilitiesFile])
const capabilities = JSON.parse(readFileSync(capabilitiesFile, 'utf8'))
assert.equal(typeof capabilities.offlineGpuAvailable, 'boolean', 'Native GPU capability was not reported')
assert.equal(typeof capabilities.gpuParityVersionSupported, 'boolean', 'Native GPU parity version support was not reported')
for (const key of ['sharedUtilityShaderAvailable', 'sharedUtilityCompositorAvailable', 'whitePointCompositorAvailable', 'blurGammaCompositorAvailable', 'sharedVectorCompositorAvailable'])
  assert.equal(typeof capabilities[key], 'boolean', `Native utility capability ${key} was not reported`)
const references = []
const referenceSets = []
const inapplicableFamilies = []
const compositorFamilies = [
  ['math', 'compositor_math_check.py', 'BLENDLINK_COMPOSITOR_MATH_REFERENCES'],
  ['blur', 'compositor_blur_check.py', 'BLENDLINK_COMPOSITOR_BLUR_REFERENCES'],
  ['flip', 'compositor_flip_check.py', 'BLENDLINK_COMPOSITOR_FLIP_REFERENCES'],
  ['filter', 'compositor_filter_check.py', 'BLENDLINK_COMPOSITOR_FILTER_REFERENCES'],
  ['switch', 'compositor_switch_check.py', 'BLENDLINK_COMPOSITOR_SWITCH_REFERENCES'],
  ['blur-interop', 'compositor_blur_interop_check.py', 'BLENDLINK_COMPOSITOR_BLUR_INTEROP_REFERENCES'],
  ['blur-kernel', 'compositor_blur_kernel_check.py', 'BLENDLINK_COMPOSITOR_BLUR_KERNEL_REFERENCES'],
  ['color-balance', 'compositor_color_balance_check.py', 'BLENDLINK_COLOR_BALANCE_REFERENCES'],
  ['color-channels', 'compositor_color_channels_check.py', 'BLENDLINK_COLOR_CHANNEL_REFERENCES'],
  ['pointwise', 'compositor_pointwise_check.py', 'BLENDLINK_COMPOSITOR_POINTWISE_REFERENCES'],
  ['alpha', 'compositor_alpha_check.py', 'BLENDLINK_COMPOSITOR_ALPHA_REFERENCES'],
  ['alpha-conversion', 'compositor_alpha_conversion_check.py', 'BLENDLINK_COMPOSITOR_ALPHA_CONVERSION_REFERENCES'],
  ['mix', 'compositor_mix_check.py', 'BLENDLINK_COMPOSITOR_MIX_REFERENCES'],
  ['color-controls', 'compositor_color_check.py', 'BLENDLINK_COMPOSITOR_COLOR_REFERENCES'],
  ['hue-correct', 'compositor_hue_correct_check.py', 'BLENDLINK_COMPOSITOR_HUE_CORRECT_REFERENCES'],
]
if (capabilities.sharedVectorCompositorAvailable) compositorFamilies.push(
  ['vectors', 'compositor_vector_check.py', 'BLENDLINK_COMPOSITOR_VECTOR_REFERENCES'])
else if (plan.compositor) inapplicableFamilies.push({ family: 'compositor-vector-utilities',
  reason: 'Actual compositor creation probe found no shared vector/XYZ node family' })
if (capabilities.blurGammaCompositorAvailable) compositorFamilies.push(
  ['blur-gamma', 'compositor_blur_gamma_check.py', 'BLENDLINK_COMPOSITOR_BLUR_GAMMA_REFERENCES'])
else if (plan.compositor) inapplicableFamilies.push({ family: 'compositor-blur-gamma',
  reason: 'Native Blur creation probe exposes no legacy gamma correction property' })
if (capabilities.whitePointCompositorAvailable) compositorFamilies.push(
  ['white-point', 'compositor_whitepoint_check.py', 'BLENDLINK_COMPOSITOR_WHITEPOINT_REFERENCES'])
else if (plan.compositor) inapplicableFamilies.push({ family: 'compositor-white-point',
  reason: 'Native Color Balance creation/selector probe exposes no White Point mode' })
if (capabilities.sharedUtilityCompositorAvailable) compositorFamilies.push(
  ['shared-utilities', 'shared_utility_check.py', 'BLENDLINK_SHARED_UTILITY_REFERENCES'])
else if (plan.compositor) inapplicableFamilies.push({ family: 'compositor-shared-utilities',
  reason: 'Native node creation probe found no shared Boolean/Integer input nodes in this compositor' })
if (plan.compositor) for (const [family, file, variable] of compositorFamilies) {
  const directory = join(evidence, family)
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  const complete = attempt('native-' + family, () => run('native-' + family, blender, ['--background', '--factory-startup', '--python-exit-code', '1',
    '--python', join(root, 'packages/blender-addon/tests', file)], {
    [variable]: directory, BLENDLINK_COMPOSITOR_CHANNEL_DEVICE: 'CPU',
    BLENDLINK_COMPOSITOR_POINTWISE_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_ALPHA_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_ALPHA_CONVERSION_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_VECTOR_DEVICE: 'CPU',
    BLENDLINK_COMPOSITOR_MIX_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_BLUR_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_FLIP_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_FILTER_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_SWITCH_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_BLUR_INTEROP_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_BLUR_KERNEL_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_BLUR_GAMMA_DEVICE: 'CPU',
    BLENDLINK_COMPOSITOR_COLOR_DEVICE: 'CPU', BLENDLINK_SHARED_UTILITY_DEVICE: 'CPU',
    BLENDLINK_COMPOSITOR_MATH_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_BALANCE_DEVICE: 'CPU',
    BLENDLINK_COMPOSITOR_HUE_CORRECT_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_WHITEPOINT_DEVICE: 'CPU',
  }))
  if (complete) {
    references.push(directory)
    referenceSets.push({ family, device: 'CPU', directory,
      cases: JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8')).length })
  }
}
let nativeCompositorGpu
if (!plan.compositor) {
  nativeCompositorGpu = { status: 'not-requested', reason: 'Explicit ' + plan.suite + ' suite' }
} else if (capabilities.offlineGpuAvailable && capabilities.gpuParityVersionSupported) {
  const gpuFamilies = [
    ['math-gpu', 'compositor_math_check.py', 'BLENDLINK_COMPOSITOR_MATH_REFERENCES', 'BLENDLINK_COMPOSITOR_MATH_DEVICE'],
    ['blur-gpu', 'compositor_blur_check.py', 'BLENDLINK_COMPOSITOR_BLUR_REFERENCES', 'BLENDLINK_COMPOSITOR_BLUR_DEVICE'],
    ['flip-gpu', 'compositor_flip_check.py', 'BLENDLINK_COMPOSITOR_FLIP_REFERENCES', 'BLENDLINK_COMPOSITOR_FLIP_DEVICE'],
    ['filter-gpu', 'compositor_filter_check.py', 'BLENDLINK_COMPOSITOR_FILTER_REFERENCES', 'BLENDLINK_COMPOSITOR_FILTER_DEVICE'],
    ['switch-gpu', 'compositor_switch_check.py', 'BLENDLINK_COMPOSITOR_SWITCH_REFERENCES', 'BLENDLINK_COMPOSITOR_SWITCH_DEVICE'],
    ['blur-interop-gpu', 'compositor_blur_interop_check.py', 'BLENDLINK_COMPOSITOR_BLUR_INTEROP_REFERENCES', 'BLENDLINK_COMPOSITOR_BLUR_INTEROP_DEVICE'],
    ['blur-kernel-gpu', 'compositor_blur_kernel_check.py', 'BLENDLINK_COMPOSITOR_BLUR_KERNEL_REFERENCES', 'BLENDLINK_COMPOSITOR_BLUR_KERNEL_DEVICE'],
    ['color-balance-gpu', 'compositor_color_balance_check.py', 'BLENDLINK_COLOR_BALANCE_REFERENCES', 'BLENDLINK_COMPOSITOR_BALANCE_DEVICE'],
    ['color-channels-gpu', 'compositor_color_channels_check.py', 'BLENDLINK_COLOR_CHANNEL_REFERENCES', 'BLENDLINK_COMPOSITOR_CHANNEL_DEVICE'],
    ['alpha-gpu', 'compositor_alpha_check.py', 'BLENDLINK_COMPOSITOR_ALPHA_REFERENCES', 'BLENDLINK_COMPOSITOR_ALPHA_DEVICE'],
    ['alpha-conversion-gpu', 'compositor_alpha_conversion_check.py', 'BLENDLINK_COMPOSITOR_ALPHA_CONVERSION_REFERENCES', 'BLENDLINK_COMPOSITOR_ALPHA_CONVERSION_DEVICE'],
    ['mix-gpu', 'compositor_mix_check.py', 'BLENDLINK_COMPOSITOR_MIX_REFERENCES', 'BLENDLINK_COMPOSITOR_MIX_DEVICE'],
    ['pointwise-gpu', 'compositor_pointwise_check.py', 'BLENDLINK_COMPOSITOR_POINTWISE_REFERENCES', 'BLENDLINK_COMPOSITOR_POINTWISE_DEVICE'],
    ['color-controls-gpu', 'compositor_color_check.py', 'BLENDLINK_COMPOSITOR_COLOR_REFERENCES', 'BLENDLINK_COMPOSITOR_COLOR_DEVICE'],
    ['hue-correct-gpu', 'compositor_hue_correct_check.py', 'BLENDLINK_COMPOSITOR_HUE_CORRECT_REFERENCES', 'BLENDLINK_COMPOSITOR_HUE_CORRECT_DEVICE'],
  ]
  if (capabilities.sharedVectorCompositorAvailable) gpuFamilies.push(
    ['vectors-gpu', 'compositor_vector_check.py', 'BLENDLINK_COMPOSITOR_VECTOR_REFERENCES', 'BLENDLINK_COMPOSITOR_VECTOR_DEVICE'])
  if (capabilities.blurGammaCompositorAvailable) gpuFamilies.push(
    ['blur-gamma-gpu', 'compositor_blur_gamma_check.py', 'BLENDLINK_COMPOSITOR_BLUR_GAMMA_REFERENCES', 'BLENDLINK_COMPOSITOR_BLUR_GAMMA_DEVICE'])
  if (capabilities.whitePointCompositorAvailable) gpuFamilies.push(
    ['white-point-gpu', 'compositor_whitepoint_check.py', 'BLENDLINK_COMPOSITOR_WHITEPOINT_REFERENCES', 'BLENDLINK_COMPOSITOR_WHITEPOINT_DEVICE'])
  if (capabilities.sharedUtilityCompositorAvailable) gpuFamilies.push(
    ['shared-utilities-gpu', 'shared_utility_check.py', 'BLENDLINK_SHARED_UTILITY_REFERENCES', 'BLENDLINK_SHARED_UTILITY_DEVICE'])
  for (const [family, file, variable, deviceVariable] of gpuFamilies) {
    const directory = join(evidence, family)
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
    attempt('native-' + family, () => {
    run('native-' + family, blender, ['--background', '--factory-startup', '--python-exit-code', '1',
      '--python', join(root, 'packages/blender-addon/tests', file)], { [variable]: directory, [deviceVariable]: 'GPU' })
    const rows = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'))
    assert.ok(rows.length > 0, `${family}: native GPU generator produced no cases`)
    for (const row of rows) {
      const fixture = JSON.parse(readFileSync(join(directory, row.case + '.json'), 'utf8'))
      assert.equal(fixture.compositorDevice, 'GPU', `${row.case}: native GPU was substituted`)
    }
    references.push(directory)
    referenceSets.push({ family, device: 'GPU', directory, cases: rows.length })
    })
  }
  const gpuModelProofs = [
    ['math-spatial-gpu', 'compositor_math_spatial_check.py', 'BLENDLINK_COMPOSITOR_MATH_SPATIAL_REFERENCES'],
    ['execution-model-gpu', 'compositor_device_check.py', 'BLENDLINK_COMPOSITOR_DEVICE_REFERENCES'],
    ['trigonometry-gpu', 'compositor_trig_check.py', 'BLENDLINK_COMPOSITOR_TRIG_REFERENCES'],
  ]
  for (const [family, file, variable] of gpuModelProofs) {
    const directory = join(evidence, family)
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
    attempt('native-' + family, () => {
      run('native-' + family, blender, ['--background', '--factory-startup', '--python-exit-code', '1',
        '--python', join(root, 'packages/blender-addon/tests', file)], { [variable]: directory })
      const rows = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'))
      assert.ok(rows.length > 0, `${family}: native execution model generator produced no cases`)
      const devices = new Set(rows.map(row => {
        const fixture = JSON.parse(readFileSync(join(directory, row.case + '.json'), 'utf8'))
        assert.ok(['CPU', 'GPU'].includes(fixture.compositorDevice), `${row.case}: native device was not identified`)
        return fixture.compositorDevice
      }))
      assert.ok(devices.has('GPU'), `${family}: native GPU was substituted`)
      references.push(directory)
      referenceSets.push({ family, device: [...devices].sort().join('+'), directory, cases: rows.length })
    })
  }
  nativeCompositorGpu = { status: 'generated', families: [...gpuFamilies, ...gpuModelProofs].map(([family]) => family) }
} else if (!capabilities.offlineGpuAvailable) {
  nativeCompositorGpu = { status: 'unavailable', reason: capabilities.availabilityReason }
  console.log('BLENDLINK_NATIVE_COMPOSITOR_GPU_UNAVAILABLE ' + capabilities.availabilityReason)
} else {
  nativeCompositorGpu = { status: 'not-certified', reason: capabilities.gpuParityReason }
  console.log('BLENDLINK_NATIVE_COMPOSITOR_GPU_NOT_CERTIFIED ' + capabilities.gpuParityReason)
}
const compositorCases = referenceSets.reduce((sum, set) => sum + set.cases, 0)
// The browser runner gives each backend250ms per native case. Keep the outer
// process deadline consistent with both backends and startup/provenance work.
const compositorTimeout = Math.max(600_000, compositorCases * 500 + 60_000)
const compositorComplete = references.length > 0 && attempt('compositor-browser', () => run('compositor-browser', process.execPath, ['experiments/native-compositor-differential/run.mjs',
  '--built', '--out', join(evidence, 'browser'), ...references], {}, compositorTimeout))
if (nativeCompositorGpu.status === 'generated') nativeCompositorGpu.status = compositorComplete &&
  !failures.some(item => item.label.endsWith('-gpu')) ? 'passed' : 'not-verified'
if (plan.shaders) {
  for (const [family, flag] of [
    ['mapping', null], ['mix', '--mix'], ['map-range', '--map-range'],
    ['math', '--math'], ['math-boundary', '--boundary'], ['hue-ramp', '--hue-ramp'],
    ['vectors', '--vectors'],
    ['brick', '--brick'], ['clamp', '--clamp'], ['images', '--images'],
  ]) {
    attempt('shader-' + family, () => run('shader-' + family, process.execPath, ['experiments/tsl-node-differential/run-mapping.mjs',
      '--built', ...(flag ? [flag] : [])], { BLENDLINK_BLENDER: blender,
        BLENDLINK_TSL_DIFF_ARTIFACTS: join(evidence, 'shader-' + family) }))
  }
  attempt('spectral', () => run('spectral', process.execPath, ['experiments/spectral-node-differential/run.mjs', '--built'],
    { BLENDLINK_BLENDER: blender, BLENDLINK_SPECTRAL_EVIDENCE: join(evidence, 'spectral') }))
  attempt('curves', () => run('curves', process.execPath, ['experiments/curve-node-differential/run.mjs', '--built'],
    { BLENDLINK_BLENDER: blender, BLENDLINK_CURVE_EVIDENCE: join(evidence, 'curves') }))
  attempt('vector-transform', () => {
    const directory = join(evidence, 'vector-transform')
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
    run('vector-transform-native', blender, ['--background', '--factory-startup', '--python-exit-code', '1',
      '--python', join(root, 'packages/blender-addon/tests/vector_transform_check.py')],
    { BLENDLINK_VECTOR_TRANSFORM_REFERENCES: directory })
    run('vector-transform-final', process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
      'experiments/vector-transform-differential/export.test.ts'],
    { BLENDLINK_VECTOR_TRANSFORM_NATIVE: directory, BLENDLINK_VECTOR_TRANSFORM_BLENDER: blender,
      BLENDLINK_VECTOR_TRANSFORM_BUILT: '1' })
    run('vector-transform-browser', process.execPath, ['experiments/vector-transform-differential/run.mjs', directory, '--built'])
  })
  attempt('published-images', () => {
    const directory = join(evidence, 'published-images')
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
    run('published-images-native', blender, ['--background', '--factory-startup', '--python-exit-code', '1',
      '--python', join(root, 'packages/blender-addon/tests/multi_image_program_check.py')],
    { BLENDLINK_MULTI_IMAGE_FIXTURE: directory })
    run('published-images-final', process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
      'experiments/multi-image-differential/export.test.ts'],
    { BLENDLINK_MULTI_IMAGE_NATIVE: directory, BLENDLINK_MULTI_IMAGE_BLENDER: blender,
      BLENDLINK_MULTI_IMAGE_BUILT: '1' })
    run('published-images-browser', process.execPath, ['experiments/multi-image-differential/run.mjs', '--built'],
      { BLENDLINK_MULTI_IMAGE_NATIVE: directory })
  })
  attempt('wave', () => run('wave', process.execPath, ['experiments/wave-node-differential/run.mjs', '--built'],
    { BLENDLINK_BLENDER: blender, BLENDLINK_WAVE_EVIDENCE: join(evidence, 'wave') }))
  attempt('color-conversions', () => run('color-conversions', process.execPath,
    ['experiments/color-conversion-differential/run.mjs', '--built'],
    { BLENDLINK_BLENDER: blender, BLENDLINK_COLOR_EVIDENCE: join(evidence, 'color-conversions') }))
  if (capabilities.sharedUtilityShaderAvailable) {
    attempt('shared-utilities', () => run('shared-utilities', process.execPath,
      ['experiments/shared-utility-differential/run.mjs', '--built'],
      { BLENDLINK_BLENDER: blender, BLENDLINK_UTILITY_EVIDENCE: join(evidence, 'shared-utilities') }))
  } else inapplicableFamilies.push({ family: 'shader-shared-utilities',
    reason: 'Native node creation probe found no shared Boolean/Integer input nodes in this shader context' })
}
if (plan.geometry) attempt('geometry', () => run('geometry', process.execPath,
  ['experiments/geometry-context-differential/suite.mjs', '--built'],
  { BLENDLINK_GEOMETRY_BLENDER: blender, BLENDLINK_GEOMETRY_NATIVE: join(evidence, 'geometry') }, 1_800_000))
if (plan.geometry) attempt('normal-map', () => run('normal-map', process.execPath,
  ['experiments/normal-node-differential/suite.mjs', '--built', '--profiles', 'shared,cycles-zero'],
  { BLENDLINK_NORMAL_NODE_BLENDER: blender, BLENDLINK_NORMAL_NODE_NATIVE: join(evidence, 'normal-map') }, 1_800_000))
if (plan.noiseFbm) attempt('noise-fractal', () => run('noise-fractal', process.execPath,
  ['experiments/noise-fractal-differential/run.mjs', '--built'],
  { BLENDLINK_BLENDER: blender, BLENDLINK_NOISE_EVIDENCE: join(evidence, 'noise-fractal'),
    BLENDLINK_NOISE_VARYING: '', BLENDLINK_NOISE_TYPES: '["FBM"]' }, 1_800_000))
if (plan.noiseTypes) attempt('noise-types', () => run('noise-types', process.execPath,
  ['experiments/noise-fractal-differential/run.mjs', '--built'],
  { BLENDLINK_BLENDER: blender, BLENDLINK_NOISE_EVIDENCE: join(evidence, 'noise-types'),
    BLENDLINK_NOISE_VARYING: '', BLENDLINK_NOISE_TYPES: '["MULTIFRACTAL","HETERO_TERRAIN","HYBRID_MULTIFRACTAL","RIDGED_MULTIFRACTAL"]' }, 1_800_000))
if (plan.noiseTypes) attempt('noise-varying', () => run('noise-varying', process.execPath,
  ['experiments/noise-fractal-differential/run.mjs', '--built'],
  { BLENDLINK_BLENDER: blender, BLENDLINK_NOISE_EVIDENCE: join(evidence, 'noise-varying'),
    BLENDLINK_NOISE_VARYING: '1', BLENDLINK_NOISE_TYPES: '["FBM","MULTIFRACTAL","HETERO_TERRAIN","HYBRID_MULTIFRACTAL","RIDGED_MULTIFRACTAL"]' }, 1_800_000))
let browser = []
try { browser = JSON.parse(readFileSync(join(evidence, 'browser/results.json'), 'utf8')) } catch { /* Failed families are recorded above. */ }
writeFileSync(join(evidence, 'report.json'), JSON.stringify({
  requestedSuite: plan.suite, selectedSuites: plan.selected,
  nativeCompositorDevices: [...new Set(referenceSets.flatMap(set => set.device.split('+')))],
  nativeCompositorGpu, nativeCapabilities: capabilities, references, referenceSets, inapplicableFamilies, compositorTimeout,
  compositor: browser.map(({ backend, rows, failure, error }) => ({ backend, cases: rows?.length ?? 0,
    maximumAbsoluteError: rows?.length ? Math.max(...rows.map(row => row.max)) : null, failure: failure ?? error ?? null })),
  shaderFamilies: [...(plan.shaders ? ['mapping', 'mix', 'map-range', 'math', 'math-boundary', 'hue-ramp', 'vectors', 'brick', 'clamp', 'images', 'spectral', 'curves', 'vector-transform', 'published-images', 'wave', 'color-conversions',
    ...(capabilities.sharedUtilityShaderAvailable ? ['shared-utilities'] : [])] : []),
    ...(plan.geometry ? ['geometry', 'normal-map'] : []), ...(plan.noiseFbm ? ['noise-fractal'] : []), ...(plan.noiseTypes ? ['noise-types', 'noise-varying'] : [])],
  builtRuntime: true, failures,
}, null, 2) + '\n')
assert.deepEqual(failures, [], 'Native node parity failed; all independent family logs were retained')
console.log('BLENDLINK_NATIVE_NODE_GATE_PASSED ' + plan.suite + ': native references and built runtime on both browser backends')
