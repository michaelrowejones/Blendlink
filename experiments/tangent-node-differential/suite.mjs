import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const blender = process.env.BLENDLINK_TANGENT_NODE_BLENDER ?? process.env.BLENDER_BIN
if (!blender)
  throw new Error('Set BLENDLINK_TANGENT_NODE_BLENDER to an actual native Blender executable')
const built = process.argv.includes('--built')
const flat = process.argv.includes('--flat')
const argument = process.argv.indexOf('--profiles')
const profiles = (argument < 0 ? 'shared' : process.argv[argument + 1]).split(',')
if (profiles.some((value) => !['shared', 'single', 'hq', 'named', 'flat'].includes(value)))
  throw new Error('Unknown UV tangent profile')
const destination = resolve(
  process.env.BLENDLINK_TANGENT_NODE_NATIVE ??
    join(root, 'artifacts/verification-tangent-nodes-suite'),
)
mkdirSync(destination, { recursive: true })
const results = []
for (const profile of profiles) {
  const native = join(destination, profile)
  const env = {
    ...process.env,
    BLENDLINK_TANGENT_NODE_NATIVE: native,
    BLENDLINK_TANGENT_NODE_REFERENCES: native,
    BLENDLINK_TANGENT_NODE_BLENDER: blender,
    BLENDLINK_TANGENT_NODE_BUILT: built ? '1' : '0',
    BLENDLINK_TANGENT_NODE_UV: profile === 'named' ? 'EditUV' : '',
    BLENDLINK_TANGENT_NODE_SINGLE_OWNER: profile === 'single' ? '1' : '0',
    BLENDLINK_TANGENT_NODE_FLAT: profile === 'flat' || flat ? '1' : '0',
    BLENDLINK_TANGENT_NODE_HIGH_QUALITY: profile === 'hq' ? '1' : '0',
  }
  const run = (command, args) => execFileSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (!process.argv.includes('--reuse-native'))
    run(blender, [
      '--background',
      '--factory-startup',
      '--python-exit-code',
      '1',
      '--python',
      'packages/blender-addon/tests/tangent_nodes_check.py',
    ])
  run(process.execPath, [
    'packages/blendlink/scripts/run-vitest.mjs',
    'experiments/tangent-node-differential/export.test.ts',
  ])
  run(process.execPath, [
    'experiments/tangent-node-differential/run.mjs',
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
  JSON.stringify({ built, flat, profiles: results }, null, 2),
)
console.log(
  'BLENDLINK_TANGENT_NODE_SUITE_PASSED ' +
    JSON.stringify(
      results.map(({ profile, nativeVersion, results }) => ({ profile, nativeVersion, results })),
    ),
)
