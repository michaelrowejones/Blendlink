import { describe, expect, it } from 'vitest'
import type { CompiledSceneAudit } from './compiledSceneAudit.js'
import {
  isBlockingVerifyIssue,
  materialCollapseVerificationIssue,
} from './sync.js'

function collapsedAudit(): CompiledSceneAudit {
  return {
    materialPayloadCollapse: {
      detected: true,
      affectedTriangles: 1_100_070,
      totalRenderedTriangles: 1_100_070,
      dominantAffectedTriangles: 717_417,
      checks: {
        materialDiagnosticsPresent: true,
        everyUsedMaterialNeedsBake: true,
        allRenderedTrianglesAffected: true,
        usedMaterialsLackMeaningfulPayload: true,
      },
      families: [{
        reasons: ['Shader graph is not portable.'],
        materials: ['Bush.001', 'Bush.002', 'Bush.003'],
        affectedTriangles: 717_417,
      }],
    },
    materialPortability: {
      diagnosticsPresent: true,
      totalRenderedTriangles: 1_100_070,
      unboundRenderedTriangles: 0,
      usedMaterials: 33,
      diagnosedUsedMaterials: 33,
      needsBakeUsedMaterials: 33,
      needsBakeRenderedTriangles: 1_100_070,
      needsBakeMeaningfulPayloadTriangles: 0,
      cyclesAppearanceBlockedUsedMaterials: 29,
    },
  } as CompiledSceneAudit
}

describe('material-collapse verification policy', () => {
  it('blocks an unacknowledged collapse using artifact-scoped Cycles evidence', () => {
    const issue = materialCollapseVerificationIssue({ name: 'splash' }, collapsedAudit())
    expect(issue).toMatchObject({ scene: 'splash', severity: 'error' })
    expect(issue?.problem).toMatch(/1,100,070.*65\.2%.*Bush\.001/s)
    expect(issue?.fix).toMatch(/29 used material.*applicationMaterialAdapter/s)
    expect(isBlockingVerifyIssue(issue!)).toBe(true)
  })

  it('surfaces but accepts a named website-owned adapter acknowledgement', () => {
    const issue = materialCollapseVerificationIssue({
      name: 'splash',
      applicationMaterialAdapter: {
        acknowledgePayloadCollapse: true,
        description: 'src/materials/installSplashMaterials.ts',
      },
    }, collapsedAudit())
    expect(issue).toMatchObject({ scene: 'splash', severity: 'warning' })
    expect(issue?.problem).toContain('src/materials/installSplashMaterials.ts')
    expect(issue?.fix).toMatch(/application browser gate/)
    expect(isBlockingVerifyIssue(issue!)).toBe(false)
  })
})
