import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const blender = process.env.BLENDLINK_GEOMETRY_BLENDER ?? process.env.BLENDER_BIN
if (!blender)
  throw new Error('Set BLENDLINK_GEOMETRY_BLENDER to an actual native Blender executable')
const built = process.argv.includes('--built')
const argument = process.argv.indexOf('--profiles')
const profiles = (argument < 0 ? 'shared,single,flat,hq' : process.argv[argument + 1]).split(',')
if (profiles.some((value) => !['shared', 'single', 'flat', 'hq'].includes(value)))
  throw new Error('Unknown geometry profile')
const destination = resolve(
  process.env.BLENDLINK_GEOMETRY_NATIVE ?? join(root, 'artifacts/verification-geometry-suite'),
)
mkdirSync(destination, { recursive: true })
const results = []
for (const profile of profiles) {
  const native = join(destination, profile)
  const env = {
    ...process.env,
    BLENDLINK_GEOMETRY_NATIVE: native,
    BLENDLINK_GEOMETRY_REFERENCES: native,
    BLENDLINK_GEOMETRY_BLENDER: blender,
    BLENDLINK_GEOMETRY_BUILT: built ? '1' : '0',
    BLENDLINK_GEOMETRY_SINGLE_OWNER: profile === 'single' ? '1' : '0',
    BLENDLINK_GEOMETRY_FLAT: profile === 'flat' ? '1' : '0',
    BLENDLINK_GEOMETRY_HIGH_QUALITY: profile === 'hq' ? '1' : '0',
  }
  const run = (command, args) => execFileSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (!process.argv.includes('--reuse-native')) run(blender, [
    '--background',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    'packages/blender-addon/tests/geometry_context_check.py',
  ])
  run(process.execPath, [
    'packages/blendlink/scripts/run-vitest.mjs',
    'experiments/geometry-context-differential/export.test.ts',
  ])
  run(process.execPath, [
    'experiments/geometry-context-differential/run.mjs',
    ...(built ? ['--built'] : []),
  ])
  const report = JSON.parse(readFileSync(join(native, 'browser-report.json'), 'utf8'))
  results.push({
    profile,
    nativeVersion: JSON.parse(readFileSync(join(native, 'native-reference.json'), 'utf8')).blender,
    results: report.rows.map((row) => ({
      backend: row.backend,
      cases: row.cases,
      maximum: row.maximum,
    })),
    provenance: report.provenance,
  })
}
writeFileSync(
  join(destination, 'results.json'),
  JSON.stringify({ built, profiles: results }, null, 2),
)
console.log(
  'BLENDLINK_GEOMETRY_SUITE_PASSED ' +
    JSON.stringify(
      results.map(({ profile, nativeVersion, results }) => ({ profile, nativeVersion, results })),
    ),
)
