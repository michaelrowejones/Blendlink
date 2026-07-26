import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  verifyProductionAuditReport,
  verifyReviewedDependencyChain,
} from './production-audit-policy.mjs'

function reviewedReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      '@gltf-transform/functions': {
        severity: 'high',
        isDirect: true,
        via: ['ndarray-pixels'],
      },
      'ndarray-pixels': {
        severity: 'high',
        isDirect: true,
        via: ['sharp'],
      },
      sharp: {
        severity: 'high',
        isDirect: true,
        via: [{
          source: 1124066,
          name: 'sharp',
          severity: 'high',
          url: 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj',
          range: '<0.35.0',
        }],
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0, low: 0, moderate: 0, high: 3, critical: 0, total: 3,
      },
    },
  }
}

function currentLockfile() {
  return JSON.parse(
    readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
  )
}

describe('production audit release policy', () => {
  it('accepts only the exact reviewed Sharp/libvips chain', () => {
    assert.deepEqual(verifyProductionAuditReport(reviewedReport()), {
      status: 'reviewed-workaround',
      advisory: 'GHSA-f88m-g3jw-g9cj',
    })
  })

  it('rejects a new advisory even when its count looks unchanged', () => {
    const report = reviewedReport()
    report.vulnerabilities.sharp.via[0].url =
      'https://github.com/advisories/GHSA-new-unreviewed'
    assert.throws(
      () => verifyProductionAuditReport(report),
      /unreviewed production audit result/i,
    )
  })

  it('requires the reviewed ndarray-pixels pin to remain a direct dependency', () => {
    const report = reviewedReport()
    report.vulnerabilities['ndarray-pixels'].isDirect = false
    assert.throws(
      () => verifyProductionAuditReport(report),
      /ndarray-pixels severity\/directness changed/i,
    )
  })

  it('rejects a clean report while the reviewed vulnerable snapshot is pinned', () => {
    assert.throws(
      () => verifyProductionAuditReport({
        auditReportVersion: 2,
        vulnerabilities: {},
        metadata: {
          vulnerabilities: {
            info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0,
          },
        },
      }),
      /omitted the reviewed Sharp advisory/i,
    )
  })

  it('content-identifies the exact dependency chain whose workaround was reviewed', () => {
    assert.deepEqual(verifyReviewedDependencyChain(currentLockfile()), {
      functions: '4.4.1',
      ndarrayPixels: '5.0.1',
      sharp: '0.34.5',
      fingerprint: '191da92116d726780930ad4f31f049b6493a571ae656250b78785d5a84d11868',
    })
  })

  it('rejects dependency-chain drift until it is reviewed again', () => {
    const changed = structuredClone(currentLockfile())
    changed.packages['node_modules/sharp'].version = '0.34.6'
    assert.throws(
      () => verifyReviewedDependencyChain(changed),
      /reviewed production dependency chain changed/i,
    )
  })

  it('rejects resolved native-payload drift even when versions stay unchanged', () => {
    const changed = structuredClone(currentLockfile())
    changed.packages['node_modules/@img/sharp-win32-x64'].integrity =
      'sha512-unreviewed'
    assert.throws(
      () => verifyReviewedDependencyChain(changed),
      /content fingerprint/i,
    )
  })
})
