import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CompiledSceneAudit } from './compiledSceneAudit.js'
import {
  isBlockingVerifyIssue,
  materialCollapseVerificationIssue,
} from './sync.js'
import { MANIFEST_SCHEMA_VERSION, parseManifest } from './typegen.js'
import {
  inspectRealtimePlanMaterialDiagnostics,
  readPlanSyncDuration,
} from './planManifest.js'

describe('plan manifest metadata', () => {
  it('refuses an obsolete published manifest instead of hiding its schema drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-plan-manifest-'))
    const path = join(root, 'hero.manifest.json')
    writeFileSync(path, JSON.stringify({
      generator: 'blendlink',
      schemaVersion: 2,
      lastSyncDurationMs: 4200,
    }))

    expect(() => readPlanSyncDuration(path)).toThrow(
      /Manifest schemaVersion 2 is not the supported version 3/,
    )
  })

  it('accepts schema v3 Appearance range metadata', () => {
    const manifest = parseManifest(JSON.stringify({
      generator: 'blendlink',
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      hash: 'appearance-v3',
      url: '/models/hero.glb',
      states: {
        day: { atlases: { main: '/models/hero.day.main.png' }, default: true },
      },
      bakeOutputs: { main: 'appearance' },
      stateScales: { day: { main: 2.5 } },
    }))

    expect(manifest?.schemaVersion).toBe(3)
    expect(manifest?.bakeOutputs?.main).toBe('appearance')
    expect(manifest?.stateScales?.day?.main).toBe(2.5)
  })

  it('blocks an unresolved used needsBake material when realtime planning has no bake plan', () => {
    const inspection = inspectRealtimePlanMaterialDiagnostics({
      materials: [
        {
          material: 'Autumn Grass',
          status: 'needsBake',
          label: 'Needs Bake',
          summary: 'The active shader graph cannot publish faithfully as editable glTF.',
          reasons: ['Shader to RGB is not a portable stock glTF material node.'],
          usedBy: ['ForeGround_terrain'],
          materialCompilation: {
            intent: 'automatic',
            outcome: 'preserved',
            fidelity: 'full-surface',
            transport: 'stock',
            limitations: [],
          },
        },
        {
          material: 'Unused Residue',
          status: 'needsBake',
          label: 'Needs Bake',
          summary: 'Unused.',
          reasons: ['Unused material residue.'],
          usedBy: [],
        },
      ],
    }, {})

    expect(inspection).toEqual({
      errors: [{
        code: 'material.used-needs-bake',
        material: 'Autumn Grass',
        usedBy: ['ForeGround_terrain'],
        summary: 'The active shader graph cannot publish faithfully as editable glTF.',
        reasons: ['Shader to RGB is not a portable stock glTF material node.'],
      }],
      warnings: [],
    })
  })

  it('does not relabel exact Appearance ownership or an explicit lowering as unresolved realtime loss', () => {
    const diagnostics = {
      materials: [{
        material: 'Selected Website Field',
        status: 'needsBake' as const,
        label: 'Needs Bake',
        summary: 'The full authored graph is not stock glTF.',
        reasons: ['Shader to RGB is not portable.'],
        usedBy: ['Hero'],
        materialCompilation: {
          intent: 'webColor' as const,
          outcome: 'lowered' as const,
          fidelity: 'selected-field' as const,
          transport: 'vertexColor' as const,
          limitations: ['The artist selected an intrinsic field.'],
        },
      }],
    }

    expect(inspectRealtimePlanMaterialDiagnostics(
      diagnostics,
      {},
    )).toEqual({ errors: [], warnings: [] })
    expect(inspectRealtimePlanMaterialDiagnostics({
      ...diagnostics,
      materials: diagnostics.materials.map((item) => ({
        ...item,
        materialCompilation: {
          ...item.materialCompilation,
          outcome: 'preserved' as const,
        },
      })),
    }, {
      bakePlan: {
        objects: [{
          name: 'Hero',
          atlas: 'main',
          bakeOutput: 'appearance',
        }],
        dynamicObjects: [],
      },
    })).toEqual({ errors: [], warnings: [] })
  })

  it('accepts a needsBake use only when that object is owned by an Appearance atlas', () => {
    const diagnostics = {
      materials: [{
        material: 'Painted Hero',
        status: 'needsBake' as const,
        label: 'Needs Bake',
        summary: 'The authored surface requires Appearance transport.',
        reasons: ['Shader to RGB is not portable stock glTF.'],
        usedBy: ['Hero'],
      }],
    }

    expect(inspectRealtimePlanMaterialDiagnostics(diagnostics, {
      bakePlan: {
        objects: [{
          name: 'Hero',
          atlas: 'main',
          bakeOutput: 'appearance',
        }],
        dynamicObjects: [],
      },
    })).toEqual({ errors: [], warnings: [] })
  })

  it.each(['preview', 'final'] as const)(
    'keeps Dynamic and Lighting uses unresolved in %s plan inspection',
    () => {
      const inspection = inspectRealtimePlanMaterialDiagnostics({
        materials: [
          {
            material: 'Shared Painted Surface',
            status: 'needsBake',
            label: 'Needs Bake',
            summary: 'The authored surface is not portable stock glTF.',
            reasons: ['Shader to RGB is not portable stock glTF.'],
            usedBy: ['Appearance Receiver', 'Dynamic Survivor'],
          },
          {
            material: 'Lighting Receiver Surface',
            status: 'needsBake',
            label: 'Needs Bake',
            summary: 'Lighting retains this live material.',
            reasons: ['The active Surface graph is not portable stock glTF.'],
            usedBy: ['Lighting Receiver'],
          },
        ],
      }, {
        bakePlan: {
          objects: [
            {
              name: 'Appearance Receiver',
              atlas: 'appearance',
              bakeOutput: 'appearance',
            },
            {
              name: 'Lighting Receiver',
              atlas: 'lighting',
              bakeOutput: 'lighting',
            },
          ],
          dynamicObjects: [{
            name: 'Dynamic Survivor',
            reason: 'explicit blendlink_dynamic',
          }],
        },
      })

      expect(inspection).toEqual({
        errors: [
          {
            code: 'material.used-needs-bake',
            material: 'Lighting Receiver Surface',
            usedBy: ['Lighting Receiver'],
            summary: 'Lighting retains this live material.',
            reasons: ['The active Surface graph is not portable stock glTF.'],
          },
          {
            code: 'material.used-needs-bake',
            material: 'Shared Painted Surface',
            usedBy: ['Dynamic Survivor'],
            summary: 'The authored surface is not portable stock glTF.',
            reasons: ['Shader to RGB is not portable stock glTF.'],
          },
        ],
        warnings: [],
      })
    },
  )

  it('does not exempt an ambiguous duplicate name with conflicting Hybrid ownership', () => {
    const inspection = inspectRealtimePlanMaterialDiagnostics({
      materials: [{
        material: 'Same Material [linked library 2]',
        status: 'needsBake',
        label: 'Needs Bake',
        summary: 'The linked live surface is not portable stock glTF.',
        reasons: ['Noise Texture is not portable stock glTF.'],
        // Blender permits linked Objects from different libraries to share
        // the same bare name. The current sidecar intentionally stays loud
        // until it carries a stable qualified occurrence key.
        usedBy: ['Same Object'],
      }],
    }, {
      bakePlan: {
        objects: [
          {
            name: 'Same Object',
            atlas: 'main',
            bakeOutput: 'appearance',
          },
          {
            name: 'Same Object',
            atlas: 'lighting',
            bakeOutput: 'lighting',
          },
        ],
        dynamicObjects: [],
      },
    })

    expect(inspection).toEqual({
      errors: [{
        code: 'material.used-needs-bake',
        material: 'Same Material [linked library 2]',
        usedBy: ['Same Object'],
        summary: 'The linked live surface is not portable stock glTF.',
        reasons: ['Noise Texture is not portable stock glTF.'],
      }],
      warnings: [],
    })
  })

  it('keeps only Hybrid live uses visible in an application-adapter acknowledgement', () => {
    const inspection = inspectRealtimePlanMaterialDiagnostics({
      materials: [{
        material: 'Shared Painted Surface',
        status: 'needsBake',
        label: 'Needs Bake',
        summary: 'The authored surface is not portable stock glTF.',
        reasons: ['Shader to RGB is not portable stock glTF.'],
        usedBy: ['Appearance Receiver', 'Dynamic Survivor'],
      }],
    }, {
      bakePlan: {
        objects: [{
          name: 'Appearance Receiver',
          atlas: 'main',
          bakeOutput: 'appearance',
        }],
        dynamicObjects: [{
          name: 'Dynamic Survivor',
          reason: 'explicit blendlink_dynamic',
        }],
      },
      applicationMaterialAdapter: {
        acknowledgePayloadCollapse: true,
        description: 'src/materials/installHybrid.ts',
      },
    })

    expect(inspection).toEqual({
      errors: [],
      warnings: [{
        code: 'material.used-needs-bake',
        material: 'Shared Painted Surface',
        usedBy: ['Dynamic Survivor'],
        summary: 'The authored surface is not portable stock glTF.',
        reasons: ['Shader to RGB is not portable stock glTF.'],
        acknowledgedBy: 'src/materials/installHybrid.ts',
      }],
    })
  })

  it('keeps an explicit application adapter as the same loud nonblocking exception as verify', () => {
    const adapter = {
      acknowledgePayloadCollapse: true as const,
      description: 'src/materials/installAutumnMaterials.ts',
    }
    const diagnostics = {
      materials: [{
        material: 'Autumn Grass',
        status: 'needsBake' as const,
        label: 'Needs Bake',
        summary: 'The active shader graph cannot publish faithfully as editable glTF.',
        reasons: ['Shader to RGB is not a portable stock glTF material node.'],
        usedBy: ['ForeGround_terrain'],
      }],
    }

    expect(inspectRealtimePlanMaterialDiagnostics(diagnostics, {
      applicationMaterialAdapter: adapter,
    })).toEqual({
      errors: [],
      warnings: [{
        code: 'material.used-needs-bake',
        material: 'Autumn Grass',
        usedBy: ['ForeGround_terrain'],
        summary: 'The active shader graph cannot publish faithfully as editable glTF.',
        reasons: ['Shader to RGB is not a portable stock glTF material node.'],
        acknowledgedBy: 'src/materials/installAutumnMaterials.ts',
      }],
    })

    const verification = materialCollapseVerificationIssue({
      name: 'autumn',
      applicationMaterialAdapter: adapter,
    }, {
      materialPayloadCollapse: {
        detected: true,
        affectedTriangles: 12,
        totalRenderedTriangles: 12,
        dominantAffectedTriangles: 12,
        checks: {
          materialDiagnosticsPresent: true,
          everyUsedMaterialNeedsBake: true,
          allRenderedTrianglesAffected: true,
          usedMaterialsLackMeaningfulPayload: true,
        },
        families: [{
          reasons: diagnostics.materials[0]!.reasons,
          materials: ['Autumn Grass'],
          affectedTriangles: 12,
        }],
      },
      materialPortability: {
        cyclesAppearanceBlockedUsedMaterials: 1,
      },
    } as CompiledSceneAudit)
    expect(verification).toMatchObject({
      severity: 'warning',
      problem: expect.stringContaining(adapter.description),
    })
    expect(isBlockingVerifyIssue(verification!)).toBe(false)
  })
})
