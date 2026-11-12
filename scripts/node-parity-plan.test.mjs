import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { NODE_PARITY_SUITES, nodeParityPlan } from './lib/node-parity-plan.mjs'

test('every shard runs one group and their union covers the default gate', () => {
  const all = nodeParityPlan([]), seen = []
  for (const suite of NODE_PARITY_SUITES) {
    const plan = nodeParityPlan(['--suite', suite])
    assert.deepEqual(plan.selected, [suite])
    assert.equal([plan.compositor, plan.shaders, plan.geometry, plan.noiseFbm, plan.noiseTypes].filter(Boolean).length, 1)
    seen.push(...plan.selected)
  }
  assert.deepEqual(seen, all.selected)
  assert.equal(new Set(seen).size, seen.length)
  assert.ok(all.compositor && all.shaders && all.geometry && all.noiseFbm && all.noiseTypes)
})

test('missing, unknown and duplicated scopes fail before native work', () => {
  for (const args of [['--suite'], ['--suite', '--list-suites'], ['--suite', 'typo'],
    ['--suite', 'shaders', '--suite', 'noise-types']]) assert.throws(() => nodeParityPlan(args), /--suite/)
})

test('the executable exposes its actual selected scope without Blender or build products', () => {
  const result = spawnSync(process.execPath, ['scripts/test-node-parity.mjs', '--suite', 'noise-types', '--list-suites'],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { suites: NODE_PARITY_SUITES, selected: ['noise-types'] })
})

test('misspelled arguments cannot silently start an unbounded all-family run', () => {
  assert.throws(() => nodeParityPlan(['--sutie', 'geometry']), /Unknown node parity argument/)
})
