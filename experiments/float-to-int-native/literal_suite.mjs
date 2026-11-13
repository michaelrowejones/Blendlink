// Fresh native -> saved Final -> one declared browser adapter transaction.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertLiteralFinal, assertLiteralQualification } from './literal_protocol.mjs'
import { hash } from '../../scripts/lib/runtime-provenance.mjs'

const root = resolve(import.meta.dirname, '../..'), args = process.argv.slice(2)
const allowed = new Set(['--built', '--reuse-native', '--blender', '--output'])
for (let index = 0; index < args.length; index++) {
  assert.ok(allowed.has(args[index]), 'Unknown Float to Integer suite argument')
  if (['--blender', '--output'].includes(args[index])) assert.ok(args[++index] && !args[index].startsWith('--'), 'Missing suite option value')
}
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
assert.ok(args.includes('--built'), 'Qualification requires the built production SDK')
const blender = option('--blender'), output = resolve(option('--output') ?? 'artifacts/verification-float-to-int')
const profile = process.env.BLENDLINK_TEST_PROFILE
assert.ok(blender, 'Specify the guarded Blender executable')
assert.ok(['metal', 'software'].includes(profile), 'Choose a declared browser profile')
await mkdir(output, { recursive: true })
const report = { status: 'running', built: true, profile, productionCases: 0, steps: [] }
async function run(name, executable, argv, env) {
  const result = spawnSync(executable, argv, { cwd: root, env: { ...process.env, ...env },
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600_000 })
  await writeFile(join(output, 'suite-' + profile + '-' + name + '.log'),
    (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? '\n' + result.error.stack : ''))
  report.steps.push({ name, exitCode: result.status, signal: result.signal })
  assert.equal(result.status, 0, name + ' failed; inspect retained transaction log')
}
try {
  await run('protocol', process.execPath, ['--test', 'experiments/float-to-int-native/literal_protocol.test.mjs'], {})
  for (const device of ['CPU', 'GPU']) {
    const folder = join(output, 'literal53-' + device.toLowerCase())
    await mkdir(folder, { recursive: true })
    const env = { BLENDLINK_FLOAT_TO_INT_REFERENCES: folder, BLENDLINK_FLOAT_TO_INT_DEVICE: device,
      BLENDLINK_FLOAT_TO_INT_ADDON: join(root, 'packages/blendlink/dist/addon'),
      BLENDLINK_FLOAT_TO_INT_BUILT: '1', BLENDLINK_BLENDER: blender }
    if (!args.includes('--reuse-native')) {
      await assert.rejects(readFile(join(folder, 'qualification.json')), { code: 'ENOENT' }, 'Native output must start fresh')
      await run('native-' + device, blender, ['--background', '--factory-startup', '-t', '1', '--python-exit-code', '1',
        '--python', 'packages/blender-addon/tests/compositor_float_to_int_check.py'], env)
      assertLiteralQualification(JSON.parse(await readFile(join(folder, 'qualification.json'))))
      await run('final-' + device, process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
        'experiments/float-to-int-native/literal_export.test.ts'], env)
    }
    const nativeBytes = await readFile(join(folder, 'qualification.json'))
    const native = assertLiteralQualification(JSON.parse(nativeBytes))
    assert.equal(native.device, device)
    assertLiteralFinal(JSON.parse(await readFile(join(folder, 'final-proof.json'))), native,
      { built: true, nativeSha256: hash(nativeBytes) })
    for (const phase of ['raw', 'final']) await run('browser-' + device + '-' + phase, process.execPath,
      ['experiments/float-to-int-native/literal_run.mjs', '--built', ...(phase === 'final' ? ['--final'] : [])], env)
  }
  report.status = 'passed'; report.productionCases = 156
  console.log('SCENETOWEB_FLOAT_TO_INT_SUITE_PASSED ' + profile)
} catch (error) { report.status = 'failed'; report.error = String(error); throw error }
finally { await writeFile(join(output, 'suite-' + profile + '.json'), JSON.stringify(report, null, 2) + '\n') }
