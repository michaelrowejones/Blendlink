import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { readDifferencePrecisionProfile, readDifferenceTinyRefusals } from './lib/difference-precision-evidence.mjs'
import { readDifferenceProfileRefusal } from './lib/difference-profile-refusal.mjs'
assert.ok(process.argv.length === 3 || process.argv.length === 4 && ['--tiny', '--ordinary'].includes(process.argv[2]), 'Usage: check-difference-precision.mjs [--tiny|--ordinary] directory')
const tiny = process.argv[2] === '--tiny', directory = resolve(process.argv.at(-1))
const rows = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'))
let result
if (process.argv[2] === '--ordinary') {
  const { isMeasuredDifferenceRneProfile } = await import('../packages/blendlink/dist/tslCompositorDifferenceKey.js')
  const refused = readDifferenceProfileRefusal(directory, rows, isMeasuredDifferenceRneProfile)
  if (refused) result = { ...refused, numericalDifferenceCases: 0, controlCases: 1 }
  else {
    const q = JSON.parse(readFileSync(join(directory, 'qualification.json'), 'utf8'))
    assert.equal(q.sourcePreserved, true); assert.equal(q.cases, rows.length); assert.ok(rows.length > 1)
    if (q.device === 'GPU' && q.backend === 'OPENGL') assert.equal(isMeasuredDifferenceRneProfile(q.nativeGpuProfile), true)
    let numerical = 0, controls = 0
    for (const row of rows) {
      assert.match(row.case, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
      const record = JSON.parse(readFileSync(join(directory, row.case + '.json'), 'utf8'))
      assert.equal(record.program.status, 'extracted'); assert.equal(record.compositorDevice, q.device)
      if (record.program.ops.some(op => op.kind === 'difference-key')) numerical++
      else { assert.ok(row.case.endsWith('-difference-key-independent-control')); controls++ }
    }
    assert.equal(controls, 1); assert.equal(numerical, rows.length - 1)
    result = { status: 'qualified', numericalDifferenceCases: numerical, controlCases: controls, sourceDevice: q.device }
  }
} else result = (tiny ? readDifferenceTinyRefusals : readDifferencePrecisionProfile)(directory, rows)
writeFileSync(join(directory, 'precision-summary.json'), JSON.stringify(result, null, 2))
console.log('BLENDLINK_DIFFERENCE_PRECISION_VERIFIED ' + JSON.stringify(result))
