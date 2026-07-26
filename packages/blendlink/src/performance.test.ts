import { describe, expect, it } from 'vitest'
import type { SceneManifest } from './typegen.js'
import {
  analyzeCompiledScenePerformance,
  analyzeManifestPerformance,
  defaultPerformanceBudgets,
  selectTextureResolution,
  updateAdaptiveQuality,
} from './performance.js'

function manifest(stats: SceneManifest['stats']): SceneManifest {
  return { stats } as SceneManifest
}

describe('performance policy', () => {
  it('reports static evidence honestly and preserves runtime acceptance', () => {
    const report = analyzeManifestPerformance(manifest({
      bytes: 12_000_000,
      texturesBytes: 11_000_000,
      gpuTextureBytes: 91_000_000,
      triangles: 9_782,
      meshes: 39,
      drawCallsEstimate: 42,
    }), defaultPerformanceBudgets('mobile'))
    expect(report.passesBuildBudgets).toBe(false)
    expect(report.runtimeMeasurementRequired).toBe(true)
    expect(report.diagnostics.map((entry) => entry.metric)).toContain('initial-bytes')
    expect(report.diagnostics.map((entry) => entry.metric)).toContain('gpu-textures')
    expect(report.diagnostics.map((entry) => entry.metric)).not.toContain('triangles')
  })

  it('formats counts as counts and byte budgets as bytes', () => {
    const report = analyzeManifestPerformance(manifest({
      bytes: 12_000_000,
      texturesBytes: 0,
      gpuTextureBytes: 0,
      triangles: 2_106_644,
      meshes: 19,
      drawCallsEstimate: 19,
    }), defaultPerformanceBudgets('balanced'))
    const transfer = report.diagnostics.find((entry) => entry.metric === 'initial-bytes')
    const triangles = report.diagnostics.find((entry) => entry.metric === 'triangles')
    expect(transfer?.message).toMatch(/11\.44 MB.*5\.00 MB/)
    expect(triangles?.message).toMatch(/2,106,644.*1,000,000.*1,106,644/)
    expect(triangles?.message).not.toMatch(/MB/)
  })

  it('uses separate triangle and decoded-byte rankings for specific artist actions', () => {
    const source = manifest({
      bytes: 60_000_000,
      texturesBytes: 1_000_000,
      gpuTextureBytes: 4_000_000,
      triangles: 2_000_000,
      meshes: 2,
      drawCallsEstimate: 2,
    })
    source.hash = '0123456789abcdef'
    const report = analyzeCompiledScenePerformance(source, {
      glb: { bytes: 60_000_000, sha256: '0'.repeat(64), manifestHash: source.hash },
      counts: {
        meshes: 2, materials: 1, primitives: 2, renderedPrimitiveInstances: 2,
        renderedTriangles: 2_000_000,
        decodedAccessors: 12, decodedAccessorBytes: 115_000_000,
        decodedGeometryAccessors: 12, decodedGeometryAccessorBytes: 115_000_000,
        embeddedImages: 1, embeddedImageBytes: 1_000_000,
      },
      meshContributors: [
        {
          index: 1, name: 'RigPayload', nodes: ['Character'], instances: 1, primitives: 1,
          triangles: 10_000, renderedTriangles: 10_000,
          referencedDecodedAccessorBytes: 60_000_000, materials: ['Skin'],
        },
        {
          index: 0, name: 'Plane.005', nodes: ['Floor'], instances: 1, primitives: 1,
          triangles: 1_990_000, renderedTriangles: 1_990_000,
          referencedDecodedAccessorBytes: 54_000_000, materials: ['Boards'],
        },
      ],
      materialBindings: [],
      materialPortability: {
        diagnosticsPresent: false, totalRenderedTriangles: 2_000_000,
        unboundRenderedTriangles: 2_000_000, usedMaterials: 0,
        diagnosedUsedMaterials: 0, needsBakeUsedMaterials: 0,
        needsBakeRenderedTriangles: 0, needsBakeMeaningfulPayloadTriangles: 0,
        cyclesAppearanceBlockedUsedMaterials: 0,
      },
      materialPayloadCollapse: {
        detected: false, affectedTriangles: 0, totalRenderedTriangles: 2_000_000,
        dominantAffectedTriangles: 0,
        checks: {
          materialDiagnosticsPresent: false, everyUsedMaterialNeedsBake: false,
          allRenderedTrianglesAffected: false, usedMaterialsLackMeaningfulPayload: false,
        },
        families: [],
      },
    }, defaultPerformanceBudgets('balanced'))
    expect(report.artifact.dominantTriangleMesh?.nodes).toEqual(['Floor'])
    expect(report.artifact.dominantDecodedGeometryMesh?.nodes).toEqual(['Character'])
    expect(report.diagnostics.find((entry) => entry.metric === 'triangles')?.recommendation)
      .toMatch(/Floor.*Plane\.005.*99\.5%.*evaluated geometry/)
    expect(report.diagnostics.find((entry) => entry.metric === 'initial-bytes')?.recommendation)
      .toMatch(/109\.67 MB of geometry.*976\.56 KB of embedded images.*Meshopt/)
  })

  it('budgets rendered instances from the artifact instead of unique mesh definitions', () => {
    const source = manifest({
      bytes: 1_000,
      texturesBytes: 0,
      gpuTextureBytes: 0,
      triangles: 1,
      meshes: 1,
      drawCallsEstimate: 1,
    })
    source.hash = '0123456789abcdef'
    const report = analyzeCompiledScenePerformance(source, {
      glb: { bytes: 1_000, sha256: '0'.repeat(64), manifestHash: source.hash },
      counts: {
        meshes: 1, materials: 0, primitives: 1, renderedPrimitiveInstances: 300_000,
        renderedTriangles: 300_000,
        decodedAccessors: 1, decodedAccessorBytes: 36,
        decodedGeometryAccessors: 1, decodedGeometryAccessorBytes: 36,
        embeddedImages: 0, embeddedImageBytes: 0,
      },
      meshContributors: [], materialBindings: [],
      materialPortability: {
        diagnosticsPresent: false, totalRenderedTriangles: 300_000,
        unboundRenderedTriangles: 300_000, usedMaterials: 0,
        diagnosedUsedMaterials: 0, needsBakeUsedMaterials: 0,
        needsBakeRenderedTriangles: 0, needsBakeMeaningfulPayloadTriangles: 0,
        cyclesAppearanceBlockedUsedMaterials: 0,
      },
      materialPayloadCollapse: {
        detected: false, affectedTriangles: 0, totalRenderedTriangles: 300_000,
        dominantAffectedTriangles: 0,
        checks: {
          materialDiagnosticsPresent: false, everyUsedMaterialNeedsBake: false,
          allRenderedTrianglesAffected: false, usedMaterialsLackMeaningfulPayload: false,
        },
        families: [],
      },
    }, defaultPerformanceBudgets('mobile'))

    expect(report.measurements.triangles).toBe(300_000)
    expect(report.passesBuildBudgets).toBe(false)
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      metric: 'triangles', actual: 300_000, budget: 250_000,
    }))
  })

  it('selects the smallest useful texture while respecting data and memory caps', () => {
    const candidates = [512, 1024, 2048, 4096].map((width) => ({ width, height: width, value: width }))
    expect(selectTextureResolution(candidates, {
      projectedPixels: 700, devicePixelRatio: 2, tier: 'balanced', deviceMemoryGb: 8,
    })?.value).toBe(2048)
    expect(selectTextureResolution(candidates, {
      projectedPixels: 1900, devicePixelRatio: 3, tier: 'mobile', saveData: true,
    })?.value).toBe(2048)
    expect(selectTextureResolution(candidates, {
      projectedPixels: 3000, devicePixelRatio: 2, tier: 'showcase', deviceMemoryGb: 2,
    })?.value).toBe(1024)
  })

  it('uses sustained evidence and hysteresis before changing quality', () => {
    let state = { level: 2 as const, slowSamples: 0, fastSamples: 0 }
    for (let index = 0; index < 3; index += 1) state = updateAdaptiveQuality(state, 21, 16.67)
    expect(state.level).toBe(2)
    state = updateAdaptiveQuality(state, 21, 16.67)
    expect(state.level).toBe(1)
    for (let index = 0; index < 44; index += 1) state = updateAdaptiveQuality(state, 8, 16.67)
    expect(state.level).toBe(1)
    state = updateAdaptiveQuality(state, 8, 16.67)
    expect(state.level).toBe(2)
  })
})
