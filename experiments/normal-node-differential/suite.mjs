import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const blender = process.env.BLENDLINK_NORMAL_NODE_BLENDER ?? process.env.BLENDER_BIN
if (!blender)
  throw new Error('Set BLENDLINK_NORMAL_NODE_BLENDER to an actual native Blender executable')
const built = process.argv.includes('--built')
const bumpOnly = process.argv.includes('--bump')
const geometryOnly = process.argv.includes('--geometry-normal')
const argument = process.argv.indexOf('--profiles')
const profiles = (argument < 0 ? 'shared' : process.argv[argument + 1]).split(',')
if (profiles.some((value) => !['shared', 'single', 'flat', 'hq', 'cycles-zero'].includes(value)))
  throw new Error('Unknown geometry profile')
const destination = resolve(
  process.env.BLENDLINK_NORMAL_NODE_NATIVE ??
    join(root, 'artifacts/verification-normal-nodes-suite'),
)
mkdirSync(destination, { recursive: true })
const results = []
for (const profile of profiles) {
  const native = join(destination, profile)
  const env = {
    ...process.env,
    BLENDLINK_NORMAL_NODE_NATIVE: native,
    BLENDLINK_NORMAL_NODE_REFERENCES: native,
    BLENDLINK_NORMAL_NODE_BLENDER: blender,
    BLENDLINK_NORMAL_NODE_BUILT: built ? '1' : '0',
    BLENDLINK_NORMAL_NODE_BUMP_ONLY: bumpOnly ? '1' : '0',
    BLENDLINK_NORMAL_NODE_GEOMETRY_ONLY: geometryOnly ? '1' : '0',
    BLENDLINK_NORMAL_NODE_CYCLES_ZERO: profile === 'cycles-zero' ? '1' : '0',
    BLENDLINK_NORMAL_NODE_SINGLE_OWNER: profile === 'single' ? '1' : '0',
    BLENDLINK_NORMAL_NODE_FLAT: profile === 'flat' ? '1' : '0',
    BLENDLINK_NORMAL_NODE_HIGH_QUALITY: profile === 'hq' ? '1' : '0',
  }
  const run = (command, args) => execFileSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (!process.argv.includes('--reuse-native'))
    run(blender, [
      '--background',
      '--factory-startup',
      '--python-exit-code',
      '1',
      '--python',
      'packages/blender-addon/tests/normal_nodes_check.py',
    ])
  run(process.execPath, [
    'packages/blendlink/scripts/run-vitest.mjs',
    'experiments/normal-node-differential/export.test.ts',
  ])
  run(process.execPath, [
    'experiments/normal-node-differential/run.mjs',
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
  JSON.stringify({ built, bumpOnly, geometryOnly, profiles: results }, null, 2),
)
console.log(
  'BLENDLINK_NORMAL_NODE_SUITE_PASSED ' +
    JSON.stringify(
      results.map(({ profile, nativeVersion, results }) => ({ profile, nativeVersion, results })),
    ),
)
