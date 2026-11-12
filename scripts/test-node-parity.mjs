// Native Blender pixels -> exported programs -> built browser runtime.
// Requires a supported Node runtime, built package, Blender and Chromium.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const evidence = resolve(process.env.BLENDLINK_NATIVE_NODE_EVIDENCE || join(root, 'artifacts/verification-native-node-gate'))
mkdirSync(evidence, { recursive: true })
rmSync(join(evidence, 'report.json'), { force: true })
function run(label, executable, args, extraEnv = {}) {
  console.log('BLENDLINK_NODE_GATE_STEP ' + label)
  const started = Date.now()
  const result = spawnSync(executable, args, {
    cwd: root, env: { ...process.env, ...extraEnv }, encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024, timeout: 600_000, windowsHide: true,
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
const references = []
for (const [family, file, variable] of [
  ['math', 'compositor_math_check.py', 'BLENDLINK_COMPOSITOR_MATH_REFERENCES'],
  ['color-balance', 'compositor_color_balance_check.py', 'BLENDLINK_COLOR_BALANCE_REFERENCES'],
  ['color-channels', 'compositor_color_channels_check.py', 'BLENDLINK_COLOR_CHANNEL_REFERENCES'],
  ['pointwise', 'compositor_pointwise_check.py', 'BLENDLINK_COMPOSITOR_POINTWISE_REFERENCES'],
  ['alpha', 'compositor_alpha_check.py', 'BLENDLINK_COMPOSITOR_ALPHA_REFERENCES'],
  ['mix', 'compositor_mix_check.py', 'BLENDLINK_COMPOSITOR_MIX_REFERENCES'],
]) {
  const directory = join(evidence, family)
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  run('native-' + family, blender, ['--background', '--factory-startup', '--python-exit-code', '1',
    '--python', join(root, 'packages/blender-addon/tests', file)], {
    [variable]: directory, BLENDLINK_COMPOSITOR_CHANNEL_DEVICE: 'CPU',
    BLENDLINK_COMPOSITOR_POINTWISE_DEVICE: 'CPU', BLENDLINK_COMPOSITOR_ALPHA_DEVICE: 'CPU',
    BLENDLINK_COMPOSITOR_MIX_DEVICE: 'CPU',
  })
  references.push(directory)
}
run('compositor-browser', process.execPath, ['experiments/native-compositor-differential/run.mjs',
  '--built', '--out', join(evidence, 'browser'), ...references])
for (const [family, flag] of [
  ['mapping', null], ['mix', '--mix'], ['map-range', '--map-range'],
  ['math', '--math'], ['math-boundary', '--boundary'], ['hue-ramp', '--hue-ramp'],
  ['vectors', '--vectors'],
  ['brick', '--brick'],
]) {
  run('shader-' + family, process.execPath, ['experiments/tsl-node-differential/run-mapping.mjs',
    '--built', ...(flag ? [flag] : [])], { BLENDLINK_BLENDER: blender,
      BLENDLINK_TSL_DIFF_ARTIFACTS: join(evidence, 'shader-' + family) })
}
run('spectral', process.execPath, ['experiments/spectral-node-differential/run.mjs', '--built'],
  { BLENDLINK_BLENDER: blender, BLENDLINK_SPECTRAL_EVIDENCE: join(evidence, 'spectral') })
run('curves', process.execPath, ['experiments/curve-node-differential/run.mjs', '--built'],
  { BLENDLINK_BLENDER: blender, BLENDLINK_CURVE_EVIDENCE: join(evidence, 'curves') })
const browser = JSON.parse(readFileSync(join(evidence, 'browser/results.json'), 'utf8'))
writeFileSync(join(evidence, 'report.json'), JSON.stringify({
  nativeCompositorDevice: 'CPU', references,
  compositor: browser.map(({ backend, rows }) => ({ backend, cases: rows.length,
    maximumAbsoluteError: Math.max(...rows.map(row => row.max)) })),
  shaderFamilies: ['mapping', 'mix', 'map-range', 'math', 'math-boundary', 'hue-ramp', 'vectors', 'brick', 'spectral', 'curves'],
  builtRuntime: true,
}, null, 2) + '\n')
console.log('BLENDLINK_NATIVE_NODE_GATE_PASSED native CPU references and built runtime on both browser backends')
