import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = import.meta.dirname

function run(script) {
  const result = spawnSync(process.execPath, [resolve(root, script)], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${script} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
}

run('run_blendlink_plan.mjs')
run('run_blendlink_compile.mjs')

const output = resolve(root, 'output')
const planEvidence = JSON.parse(
  readFileSync(resolve(output, 'blendlink-plan-evidence.json'), 'utf8'),
)
const compileEvidence = JSON.parse(
  readFileSync(resolve(output, 'blendlink-compile-evidence.json'), 'utf8'),
)
const scene = planEvidence.result?.scenes?.[0]
const planErrors = scene?.inspection?.errors ?? []
const materialError = planErrors[0]
const retainedArtifacts = Object.keys(
  compileEvidence.retainedPreFixPublication?.before ?? {},
)

if (scene?.quality !== 'final') {
  throw new Error(`Expected a Final plan, received ${String(scene?.quality)}.`)
}
if (scene.plan !== null) {
  throw new Error('The TrapX control no longer produces the blocking Final plan.')
}
if (planEvidence.exitCode !== 1 || compileEvidence.exitCode !== 1) {
  throw new Error(
    `Expected plan and compile to refuse with exit 1; received ` +
      `${String(planEvidence.exitCode)} and ${String(compileEvidence.exitCode)}.`,
  )
}
if (
  !planEvidence.identities?.source?.unchanged ||
  !compileEvidence.source?.unchanged ||
  planEvidence.identities.source.sha256Before !==
    compileEvidence.source.sha256Before
) {
  throw new Error('Plan and compile did not preserve the same TrapX source bytes.')
}
if (
  planErrors.length !== 1 ||
  materialError?.code !== 'material.used-needs-bake' ||
  materialError?.material !== 'Showcase' ||
  materialError?.reasons?.length !== 14
) {
  throw new Error(
    'The Final plan no longer reports the one expected Showcase error with fourteen reasons.',
  )
}
const compileDiagnosticText = compileEvidence.stderr ?? ''
const expectedCompileDetails = [
  materialError.material,
  materialError.summary,
  ...materialError.reasons,
]
const missingCompileDetails = expectedCompileDetails.filter(
  (detail) => !compileDiagnosticText.includes(detail),
)
if (missingCompileDetails.length > 0) {
  throw new Error(
    `Final compile omitted plan diagnostic details:\n${missingCompileDetails.join('\n')}`,
  )
}
if (
  !compileEvidence.retainedPreFixPublication?.unchanged ||
  retainedArtifacts.length !== 5
) {
  throw new Error(
    'The refused compile did not preserve the exact five-file retained publication scope.',
  )
}

console.log(
  'BLENDLINK_PLAN_COMPILE_CONSISTENCY_PASSED ' +
    `errors=${planErrors.length} reasons=${materialError.reasons.length} ` +
    `retained=${retainedArtifacts.length}`,
)
