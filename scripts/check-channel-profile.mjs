import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { readChannelProfileRefusal } from './lib/channel-profile-refusal.mjs'

const directory = resolve(process.argv[2])
const rows = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'))
const refused = readChannelProfileRefusal(directory, rows)
if (refused) {
  writeFileSync(join(directory, 'source-profile-summary.json'), JSON.stringify(refused, null, 2))
  console.log('BLENDLINK_CHANNEL_KEY_SOURCE_PROFILE_REFUSAL_VERIFIED numericalChannelCases=0 independentControls=1')
} else {
  assert.ok(rows.length > 1, 'Qualified Channel Key source requires a numerical corpus')
  const qualification = JSON.parse(readFileSync(join(directory, 'qualification.json'), 'utf8'))
  assert.equal(qualification.sourcePreserved, true); assert.equal(qualification.cases, rows.length)
  assert.ok(qualification.device === 'CPU' || qualification.device === 'GPU' && qualification.sourceBackend === 'METAL')
  let numericalCases = 0
  for (const row of rows) {
    const record = JSON.parse(readFileSync(join(directory, row.case + '.json'), 'utf8'))
    assert.equal(record.program.status, 'extracted')
    if (record.program.ops.some(op => op.kind === 'channel-key')) numericalCases++
  }
  assert.ok(numericalCases > 0, 'Independent controls cannot replace numerical Channel Key cases')
  console.log('BLENDLINK_CHANNEL_KEY_NUMERICAL_SOURCE_VERIFIED cases=' + numericalCases)
}
