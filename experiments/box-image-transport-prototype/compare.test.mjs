import assert from 'node:assert/strict'
import test from 'node:test'
import { compare, closePrototype } from './compare.mjs'

const bytes = values => Buffer.from(new Float32Array(values).buffer)
test('independent reader enforces both absolute and ULP gates and rejects malformed readbacks', () => {
  assert.equal(compare(bytes([.5]), bytes([.5]), 2 ** -20, 8).violations, 0)
  assert.equal(compare(bytes([.5 + 2 ** -24]), bytes([.5]), 2 ** -20, 8).violations, 0)
  assert.equal(compare(bytes([.5 + 9 * 2 ** -24]), bytes([.5]), 2 ** -20, 8).violations, 1)
  assert.equal(compare(bytes([32 + 2 ** -18]), bytes([32]), 2 ** -20, 8).violations, 1)
  assert.throws(() => compare(bytes([NaN]), bytes([0]), 1), /Nonfinite/)
  assert.throws(() => compare(bytes([1, 2]), bytes([1]), 1))
})

const native = process.env.SCENETOWEB_BOX_NATIVE, browser = process.env.SCENETOWEB_BOX_BROWSER
test('retained failed browser run stays rejected while its raw numeric diagnostic retains errors and zero credit',
  { skip: !native || !browser ? 'Optional original native/browser archives not supplied' : false }, async () => {
    await assert.rejects(closePrototype(native, browser))
    const result = await closePrototype(native, browser, { diagnosticOnly: true })
    assert.equal(result.status, 'DIAGNOSTIC_ONLY_AFTER_FAILED_CLOSURE_ZERO_CREDIT')
    assert.equal(result.supportCredit, 0)
    assert.equal(result.finalExportCredit, 0)
    assert.ok(result.browserErrors.some(row => row.pageErrors.length > 0))
    assert.equal(result.weightViolations, 0)
    assert.ok(result.samplerDiagnosticViolations > 0)
  })
