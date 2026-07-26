import { describe, expect, it } from 'vitest'
import type { CompiledSceneAudit } from './compiledSceneAudit.js'
import {
  formatHumanWarnings,
  formatMaterialPortabilityAdvisory,
  performanceResultFails,
} from './cliWarnings.js'

const rename = (authored: string, loaded: string): string =>
  `node "${authored}" loads as "${loaded}" in three.js (loader-sanitized) — ` +
  'the typed map uses the loaded name.'

describe('human CLI warning formatting', () => {
  it('summarizes repetitive loader renames while preserving every other warning in order', () => {
    const material = "material 'Paint': Needs Bake — Mix Shader is not portable."
    const light = 'Web Light "Sun": Transmission 0 is not represented.'

    expect(formatHumanWarnings([
      material,
      rename('Bush.001', 'Bush001'),
      light,
      rename('Flower.002', 'Flower002'),
      rename('Pencil.003', 'Pencil003'),
      rename('Tree.004', 'Tree004'),
      rename('Leaf.005', 'Leaf005'),
    ])).toEqual([
      material,
      '5 node names were adjusted by Three.js while loading; generated typed bindings already use the adjusted names.',
      'Name examples: "Bush.001" → "Bush001", "Flower.002" → "Flower002", ' +
        '"Pencil.003" → "Pencil003" (+2 more). Full list: generated scene manifest → vocabulary.warnings.',
      light,
    ])
  })

  it('keeps a small number of loader renames verbatim', () => {
    const warnings = [
      rename('Cube.001', 'Cube001'),
      rename('Cube.002', 'Cube002'),
      'A distinct warning.',
    ]

    expect(formatHumanWarnings(warnings)).toEqual(warnings)
  })

  it('does not aggregate warnings that merely mention loader sanitization', () => {
    const warning = 'A custom adapter reported loader-sanitized metadata with no rename pair.'
    expect(formatHumanWarnings([warning])).toEqual([warning])
  })

  it('groups repeated material graph consequences while keeping manifest drill-down', () => {
    const warning = (name: string) =>
      `material '${name}': Needs Bake — Mix Shader combines shaders. Hue/Saturation/Value is not portable.`
    expect(formatHumanWarnings([
      warning('Bush.001'),
      'A distinct warning.',
      warning('Bush.002'),
      warning('Bush.003'),
      warning('Bush.004'),
      warning('Bush.005'),
    ])).toEqual([
      '5 materials: Needs Bake — Mix Shader combines shaders. Hue/Saturation/Value is not portable.',
      'Material examples: "Bush.001", "Bush.002", "Bush.003" (+2 more). ' +
        'Full material evidence: generated scene manifest → sceneDiagnostics.materials.records.',
      'A distinct warning.',
    ])
  })

  it('keeps small and structurally different material warnings verbatim', () => {
    const warnings = [
      "material 'Paint': Needs Bake — Noise Texture is not portable.",
      "material 'Glass': Needs Bake — Mix Shader is not portable.",
      "material 'Fabric': Needs Bake — Noise Texture is not portable.",
    ]
    expect(formatHumanWarnings(warnings)).toEqual(warnings)
  })

  it('reports partial Needs Bake coverage as a prioritized non-blocking advisory', () => {
    const audit = {
      materialPortability: {
        diagnosticsPresent: true, totalRenderedTriangles: 1_000, unboundRenderedTriangles: 0,
        usedMaterials: 3, diagnosedUsedMaterials: 3, needsBakeUsedMaterials: 2,
        needsBakeRenderedTriangles: 800, needsBakeMeaningfulPayloadTriangles: 750,
        cyclesAppearanceBlockedUsedMaterials: 0,
      },
      materialBindings: [
        { name: 'Small', renderedTriangles: 200, diagnostic: { status: 'needsBake' } },
        { name: 'Hero', renderedTriangles: 600, diagnostic: { status: 'needsBake' } },
        { name: 'Portable', renderedTriangles: 200, diagnostic: { status: 'exact' } },
      ],
      materialPayloadCollapse: { detected: false },
    } as unknown as CompiledSceneAudit

    expect(formatMaterialPortabilityAdvisory(audit)).toEqual([
      'Visual parity review: 2/3 used materials covering 80.0% (800 tris) are Needs Bake; ' +
        '50 tris have no meaningful glTF material payload.',
      'Prioritize: Hero (600 tris), Small (200 tris).',
      'No matched used material is marked blocked from the current Cycles Appearance bake; ' +
        'bake/materialize or simplify it, then compare the browser result with an authored reference.',
      'The artifact is not completely collapsed, so this advisory does not fail the build.',
    ])
    expect(performanceResultFails({
      report: { passesBuildBudgets: true }, audit,
    })).toBe(false)
  })

  it('keeps complete material collapse and budget overruns blocking', () => {
    expect(performanceResultFails({
      report: { passesBuildBudgets: true },
      audit: { materialPayloadCollapse: { detected: true } } as CompiledSceneAudit,
    })).toBe(true)
    expect(performanceResultFails({
      report: { passesBuildBudgets: true },
      audit: { materialPayloadCollapse: { detected: true } } as CompiledSceneAudit,
      applicationMaterialAdapter: 'src/materials/installHeroMaterials.ts',
    })).toBe(false)
    expect(performanceResultFails({
      report: { passesBuildBudgets: false },
    })).toBe(true)
  })
})
