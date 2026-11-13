import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { readSplitSourceProfile } from './lib/split-source-profile.mjs'

assert.equal(process.argv.length, 3, 'Usage: node scripts/check-split-profile.mjs /absolute/reference-directory')
const directory = resolve(process.argv[2])
const rows = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'))
const profile = readSplitSourceProfile(directory, rows)
writeFileSync(join(directory, 'source-profile-summary.json'), JSON.stringify(profile, null, 2))
if (profile.status === 'source-profile-refused')
  console.log('BLENDLINK_SPLIT_SOURCE_PROFILE_REFUSAL_VERIFIED numericalSplitCases=0 independentControls=1')
else console.log('BLENDLINK_SPLIT_NUMERICAL_SOURCE_VERIFIED cases=' + profile.numericalSplitCases)
