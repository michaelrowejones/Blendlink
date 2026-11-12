import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { verifyProductionAuditReport, verifyReviewedDependencyChain } from './production-audit-policy.mjs'

const cleanReport = () => ({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
})
const lockfile = () => JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))

describe('production audit release policy', () => {
  it('accepts a clean production report', () => {
    assert.deepEqual(verifyProductionAuditReport(cleanReport()), { status: 'clean' })
  })
  it('rejects every advisory, including the formerly accepted workaround', () => {
    const report = cleanReport()
    report.vulnerabilities.sharp = { via: [{ url: 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj' }] }
    assert.throws(() => verifyProductionAuditReport(report), /unreviewed production audit result/i)
  })
  it('rejects malformed or contradictory empty reports', () => {
    for (const report of [{}, { ...cleanReport(), vulnerabilities: [] }, { ...cleanReport(), metadata: {} }]) {
      assert.throws(() => verifyProductionAuditReport(report), /unreviewed production audit result/i)
    }
    const report = cleanReport()
    report.metadata.vulnerabilities.high = 1
    assert.throws(() => verifyProductionAuditReport(report), /expected 0/)
  })
  it('content-identifies the patched image chain and native binaries', () => {
    assert.deepEqual(verifyReviewedDependencyChain(lockfile()), {
      functions: '4.4.1', ndarrayPixels: '5.2.0', sharp: '0.35.5',
      fingerprint: '60749f3030d3509ff3b303ff0419a93c2586440081524ef5f5e62b0b5fdca3b4',
    })
  })
  it('rejects dependency drift before trusting a clean report', () => {
    const changed = lockfile()
    changed.packages['node_modules/sharp'].version = '0.34.5'
    assert.throws(() => verifyReviewedDependencyChain(changed), /production dependency chain changed/i)
  })
  it('rejects a changed native payload at the same version', () => {
    const changed = lockfile()
    changed.packages['node_modules/@img/sharp-win32-x64'].integrity = 'sha512-unreviewed'
    assert.throws(() => verifyReviewedDependencyChain(changed), /content fingerprint/i)
  })
})
