import assert from 'node:assert/strict'
import test from 'node:test'
import { diagnoseNodePortTimings } from './node-port-timings.mjs'

const invocation = (args, elapsedMs, extra = {}) => ({ result: { args, elapsedMs, exitCode: 0, ...extra } })
const report = () => ({ schemaVersion: 1, kind: 'blendlink-node-port-verification-v1', status: 'qualified', manifestId: 'fixture',
  steps: [{ id: 'build', elapsedMs: 200, exitCode: 0 }, { id: 'suite', elapsedMs: 1000, exitCode: 0 }],
  nativePythonProof: { invocations: [invocation(['--version'], 5),
    invocation(['-b', 'test.blend', '--python-expr', 'guard', '--python', '/sdk/export_scene.py', '--', '--version'], 300),
    invocation(['--python', '/fixture/native.py'], 100), invocation(['--python', '/fixture/native.py'], 200)] } })

test('nested native work is separate from command time, with useful rankings and action statistics', () => {
  const result = diagnoseNodePortTimings(report(), { reviewAfterMs: 500 })
  assert.equal(result.commandSumMs, 1200)
  assert.equal(result.commands[0].id, 'suite')
  assert.equal(result.commands[0].shareOfRecordedCommands, 1000 / 1200)
  assert.equal(result.commands[0].reviewSuggested, true)
  assert.equal(result.commands[1].reviewSuggested, false)
  assert.equal(result.nativeInvocations.sumMs, 605)
  assert.deepEqual(result.nativeInvocations.byAction['final-export'], { count: 1, sumMs: 300, medianMs: 300, p95Ms: 300, maximumMs: 300 })
  assert.equal(result.nativeInvocations.byAction['native-python'].medianMs, 150)
  assert.equal(result.nativeInvocations.byAction.identity.count, 1)
  assert.equal(result.numericalCredit, false)
})
test('failed and incomplete invocations stay visible; empty reports do not invent timings', () => {
  const input = report(); input.steps[0].exitCode = 1
  input.nativePythonProof.invocations.push({ error: { message: 'launch failed' } }, invocation(['-b'], 0, { aborted: true }))
  const result = diagnoseNodePortTimings(input)
  assert.equal(result.commands.find(row => row.id === 'build').reviewSuggested, true)
  assert.equal(result.nativeInvocations.failedCount, 1)
  assert.equal(result.nativeInvocations.missingResultCount, 1)
  const empty = diagnoseNodePortTimings({ ...input, steps: [], nativePythonProof: null })
  assert.equal(empty.commandSumMs, 0)
  assert.equal(empty.nativeInvocations.p95Ms, null)
})
test('malformed timing receipts and nonfinite or negative durations refuse', () => {
  for (const value of [-1, NaN, Infinity, '100']) {
    const input = report(); input.steps[0].elapsedMs = value
    assert.throws(() => diagnoseNodePortTimings(input), /Elapsed/)
  }
  assert.throws(() => diagnoseNodePortTimings({ ...report(), kind: 'other' }), /verification report/)
  const input = report(); input.nativePythonProof.invocations[0].result.args = ['--version', 2]
  assert.throws(() => diagnoseNodePortTimings(input), /arguments/)
})
