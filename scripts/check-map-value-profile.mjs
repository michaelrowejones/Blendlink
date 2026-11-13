import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readMapValueSourceProfile, verifyMapValueCurrentSources } from './lib/map-value-profile.mjs'

const args = process.argv.slice(2), current = args.includes('--current-sources')
if (current) args.splice(args.indexOf('--current-sources'), 1)
const expected = args[0] === '--expect' ? args.splice(0, 2)[1] : 'any'
assert.ok(['any', 'qualified', 'source-profile-refused', 'native-node-absent'].includes(expected))
assert.equal(args.length, 1, 'Pass [--expect qualified|source-profile-refused|native-node-absent] reference-directory')
const directory = resolve(args[0]), rows = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'))
const profile = readMapValueSourceProfile(directory, rows)
if (current) verifyMapValueCurrentSources(profile, fileURLToPath(new URL('..', import.meta.url)))
if (expected !== 'any') assert.equal(profile.status, expected, 'Map Value outcome differs from the required numerical/refusal/absence canary')
writeFileSync(join(directory, 'source-profile-summary.json'), JSON.stringify(profile, null, 2) + '\n')
console.log('BLENDLINK_MAP_VALUE_SOURCE_PROFILE_VERIFIED status=' + profile.status
  + ' numericalMapValueCases=' + profile.numericalMapValueCases + ' independentControls=' + profile.controlCases
  + ' currentSources=' + current)
