import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateVectorComponentSource, validateVectorComponentBrowser } from './lib/vector-component-profile.mjs'

const [kind, file] = process.argv.slice(2)
assert.ok(process.argv.length === 4 && ['--source', '--browser', '--absent'].includes(kind),
  'Usage: check-vector-component-profile.mjs --source|--browser|--absent file.json')
const record = JSON.parse(readFileSync(file, 'utf8'))
const result = kind === '--browser' ? validateVectorComponentBrowser(record) : validateVectorComponentSource(record)
if (kind === '--absent') assert.equal(result.status, 'native-node-absent')
if (kind === '--source') assert.equal(result.status, 'qualified-source-selection')
console.log('BLENDLINK_VECTOR_COMPONENT_PROFILE_VERIFIED ' + JSON.stringify(result))
