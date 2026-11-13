import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readCompositorComponentProfile, verifyCompositorComponentCurrentSources, validateCompositorComponentBrowser } from './lib/compositor-vector-component-profile.mjs'
const args = process.argv.slice(2), mode = args.shift(), root = resolve(import.meta.dirname, '..')
assert.ok(['--source', '--browser'].includes(mode) && args.length >= 1)
if (mode === '--source') {
  for (const directory of args) {
    const qualification = readCompositorComponentProfile(directory)
    verifyCompositorComponentCurrentSources(qualification, root)
    const { caseIds, ...summary } = qualification
    console.log('BLENDLINK_COMPOSITOR_COMPONENT_SOURCE_VERIFIED ' + JSON.stringify({ ...summary, indexedCases: caseIds.length }))
  }
} else {
  const [result, ...sources] = args
  assert.ok(sources.length, '--browser requires actual native source directories; counts alone are insufficient')
  const profiles = sources.map(directory => readCompositorComponentProfile(directory))
  for (const qualification of profiles) verifyCompositorComponentCurrentSources(qualification, root)
  const report = validateCompositorComponentBrowser(JSON.parse(readFileSync(result, 'utf8')), profiles)
  console.log('BLENDLINK_COMPOSITOR_COMPONENT_BROWSER_EXACT ' + JSON.stringify(report))
}
