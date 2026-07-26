import type { SceneManifest } from './typegen.js'
import type {
  CompiledMaterialPortabilityCoverage,
  CompiledSceneAudit,
  CompiledSceneMeshContributor,
} from './compiledSceneAudit.js'

export type PerformanceTier = 'mobile' | 'balanced' | 'showcase'

export interface PerformanceBudgets {
  tier: PerformanceTier
  /** Build artifact bytes needed before optional progressive sidecars. */
  initialBytes: number
  gpuTextureBytes: number
  drawCalls: number
  triangles: number
  targetFrameMs: number
}

export interface PerformanceDiagnostic {
  severity: 'info' | 'warning'
  metric: 'initial-bytes' | 'gpu-textures' | 'draw-calls' | 'triangles' | 'runtime-evidence'
  actual?: number
  budget?: number
  message: string
  recommendation: string
}

export interface StaticPerformanceReport {
  evidence: 'build-estimate'
  tier: PerformanceTier
  budgets: PerformanceBudgets
  measurements: {
    initialBytes: number
    textureSourceBytes: number
    gpuTextureBytes: number | null
    triangles: number
    drawCalls: number | null
    meshes: number
    animationBytes: number | null
    deliveryBytes: number | null
    deliverySavedBytes: number | null
  }
  diagnostics: PerformanceDiagnostic[]
  passesBuildBudgets: boolean
  runtimeMeasurementRequired: true
}

export interface CompiledScenePerformanceReport extends StaticPerformanceReport {
  artifact: {
    evidence: 'artifact-exact'
    sha256: string
    glbBytes: number
    decodedAccessorBytes: number
    decodedGeometryAccessorBytes: number
    embeddedImageBytes: number
    embeddedImages: number
    primitives: number
    materials: number
    dominantTriangleMesh: CompiledSceneMeshContributor | null
    dominantDecodedGeometryMesh: CompiledSceneMeshContributor | null
    materialPortability: CompiledMaterialPortabilityCoverage
  }
}

/** Deliberately conservative starting profiles, not universal web limits.
 * `blendlink perf` prints the selected profile and real projects may supply
 * explicit budgets derived from their representative target devices. */
export function defaultPerformanceBudgets(tier: PerformanceTier): PerformanceBudgets {
  if (tier === 'mobile') {
    return {
      tier,
      initialBytes: 2 * 1024 * 1024,
      gpuTextureBytes: 64 * 1024 * 1024,
      drawCalls: 100,
      triangles: 250_000,
      targetFrameMs: 1000 / 30,
    }
  }
  if (tier === 'showcase') {
    return {
      tier,
      initialBytes: 15 * 1024 * 1024,
      gpuTextureBytes: 256 * 1024 * 1024,
      drawCalls: 500,
      triangles: 2_000_000,
      targetFrameMs: 1000 / 30,
    }
  }
  return {
    tier,
    initialBytes: 5 * 1024 * 1024,
    gpuTextureBytes: 128 * 1024 * 1024,
    drawCalls: 250,
    triangles: 1_000_000,
    targetFrameMs: 1000 / 60,
  }
}

/** Build-time truth behind one small interface. Browser GPU time, upload,
 * transcode target, and long tasks cannot be inferred from a manifest, so the
 * report says so instead of pretending static counts are frame-rate proof. */
export function analyzeManifestPerformance(
  manifest: SceneManifest,
  budgets: PerformanceBudgets = defaultPerformanceBudgets('balanced'),
): StaticPerformanceReport {
  const stats = manifest.stats
  const diagnostics: PerformanceDiagnostic[] = []
  compare(
    diagnostics,
    'initial-bytes',
    stats.bytes,
    budgets.initialBytes,
    'Compiled scene GLB',
    'Publish a bootstrap scene and stream texture/mesh detail only when the authored camera can use it.',
  )
  if (stats.gpuTextureBytes === undefined) {
    diagnostics.push({
      severity: 'info',
      metric: 'gpu-textures',
      message: 'GPU texture residency is unavailable for this build.',
      recommendation: 'Rebuild with texture inspection enabled and confirm the browser-selected target formats.',
    })
  } else {
    compare(
      diagnostics,
      'gpu-textures',
      stats.gpuTextureBytes,
      budgets.gpuTextureBytes,
      'Estimated GPU texture residency',
      'Lower the projected texel-density tier, split independently visible atlases, or use a verified GPU-compressed path.',
    )
  }
  if (stats.drawCallsEstimate === undefined) {
    diagnostics.push({
      severity: 'info', metric: 'draw-calls',
      message: 'Draw-call evidence is unavailable for this build.',
      recommendation: 'Measure renderer.info after component and state installation.',
    })
  } else {
    compare(
      diagnostics,
      'draw-calls',
      stats.drawCallsEstimate,
      budgets.drawCalls,
      'Estimated draw calls',
      'Canonicalize materials, instance identical meshes, then batch eligible static meshes sharing a material.',
    )
  }
  compare(
    diagnostics,
    'triangles',
    stats.triangles,
    budgets.triangles,
    'Triangles',
    'Add authored or generated projected-error LODs for eligible static meshes.',
  )
  diagnostics.push({
    severity: 'info',
    metric: 'runtime-evidence',
    message: 'Build budgets pass only static evidence; runtime acceptance is still required.',
    recommendation: `Measure cold load plus p95 CPU/GPU frame time against ${budgets.targetFrameMs.toFixed(2)} ms on representative devices.`,
  })
  return {
    evidence: 'build-estimate',
    tier: budgets.tier,
    budgets,
    measurements: {
      initialBytes: stats.bytes,
      textureSourceBytes: stats.texturesBytes,
      gpuTextureBytes: stats.gpuTextureBytes ?? null,
      triangles: stats.triangles,
      drawCalls: stats.drawCallsEstimate ?? null,
      meshes: stats.meshes,
      animationBytes: stats.animationBytes ?? null,
      deliveryBytes: stats.deliveryBytes ?? null,
      deliverySavedBytes: stats.deliverySavedBytes ?? null,
    },
    diagnostics,
    passesBuildBudgets: !diagnostics.some((entry) => entry.severity === 'warning'),
    runtimeMeasurementRequired: true,
  }
}

/** Add exact final-GLB evidence to the stable manifest budget policy. This is
 * intentionally separate from watch-time compilation: decoding a large GLB
 * belongs in explicit `perf`/release checks, not every save-driven preview. */
export function analyzeCompiledScenePerformance(
  manifest: SceneManifest,
  audit: CompiledSceneAudit,
  budgets: PerformanceBudgets = defaultPerformanceBudgets('balanced'),
): CompiledScenePerformanceReport {
  if (audit.glb.manifestHash !== manifest.hash || audit.glb.bytes !== manifest.stats.bytes) {
    throw new Error('Compiled performance evidence does not belong to this scene manifest.')
  }
  // Manifest stats count unique mesh definitions. The final-artifact audit
  // expands default-scene node and EXT_mesh_gpu_instancing usage, which is the
  // work the renderer actually receives and therefore the budget truth.
  const base = analyzeManifestPerformance({
    ...manifest,
    stats: { ...manifest.stats, triangles: audit.counts.renderedTriangles },
  }, budgets)
  const dominantDecodedGeometry = audit.meshContributors[0] ?? null
  const dominantTriangle = [...audit.meshContributors].sort((left, right) =>
    right.renderedTriangles - left.renderedTriangles
      || right.referencedDecodedAccessorBytes - left.referencedDecodedAccessorBytes
      || left.index - right.index,
  )[0] ?? null
  const triangleShare = dominantTriangle && audit.counts.renderedTriangles > 0
    ? dominantTriangle.renderedTriangles / audit.counts.renderedTriangles
    : 0
  const geometryDominatesDecodedResources = audit.counts.decodedGeometryAccessorBytes > 0
    && audit.counts.decodedGeometryAccessorBytes >= audit.counts.embeddedImageBytes * 2
  const diagnostics = base.diagnostics.map((diagnostic): PerformanceDiagnostic => {
    if (diagnostic.metric === 'triangles' && dominantTriangle && triangleShare >= 0.5) {
      const node = dominantTriangle.nodes.length > 0
        ? dominantTriangle.nodes.join(', ')
        : '(no default-scene node name)'
      return {
        ...diagnostic,
        recommendation:
          `Inspect evaluated modifiers on ${JSON.stringify(node)} (mesh ${JSON.stringify(dominantTriangle.name)}): ` +
          `it accounts for ${(triangleShare * 100).toFixed(1)}% of rendered triangles. ` +
          'Reduce redundant evaluated geometry or author an explicit LOD before changing global quality.',
      }
    }
    if (diagnostic.metric === 'initial-bytes' && geometryDominatesDecodedResources) {
      return {
        ...diagnostic,
        recommendation:
          `The decoded artifact contains ${formatBytes(audit.counts.decodedGeometryAccessorBytes)} of geometry ` +
          `versus ${formatBytes(audit.counts.embeddedImageBytes)} of embedded images. ` +
          'Reduce authored evaluated geometry first; Meshopt can reduce transfer bytes but does not remove triangles or decoded work.',
      }
    }
    return diagnostic
  })
  return {
    ...base,
    diagnostics,
    artifact: {
      evidence: 'artifact-exact',
      sha256: audit.glb.sha256,
      glbBytes: audit.glb.bytes,
      decodedAccessorBytes: audit.counts.decodedAccessorBytes,
      decodedGeometryAccessorBytes: audit.counts.decodedGeometryAccessorBytes,
      embeddedImageBytes: audit.counts.embeddedImageBytes,
      embeddedImages: audit.counts.embeddedImages,
      primitives: audit.counts.primitives,
      materials: audit.counts.materials,
      dominantTriangleMesh: dominantTriangle,
      dominantDecodedGeometryMesh: dominantDecodedGeometry,
      materialPortability: audit.materialPortability,
    },
  }
}

export interface TextureResolutionCandidate<T = unknown> {
  width: number
  height: number
  value: T
}

export interface TextureResolutionRequest {
  /** Largest projected screen dimension occupied by this atlas. */
  projectedPixels: number
  devicePixelRatio: number
  tier: PerformanceTier
  saveData?: boolean
  deviceMemoryGb?: number
}

/** Select the smallest useful resident image. This policy is independent of
 * codecs and renderer adapters, so one decision serves Three, R3F, Preview,
 * and a future TSL/WebGPU adapter. */
export function selectTextureResolution<T>(
  candidates: readonly TextureResolutionCandidate<T>[],
  request: TextureResolutionRequest,
): TextureResolutionCandidate<T> | null {
  if (candidates.length === 0) return null
  const ordered = [...candidates].sort((a, b) => Math.max(a.width, a.height) - Math.max(b.width, b.height))
  const dprCap = request.saveData || request.tier === 'mobile'
    ? 1
    : request.tier === 'showcase'
      ? 2.5
      : 2
  const memoryCap = request.deviceMemoryGb !== undefined && request.deviceMemoryGb <= 2
    ? 1024
    : request.deviceMemoryGb !== undefined && request.deviceMemoryGb <= 4
      ? 2048
      : Number.POSITIVE_INFINITY
  const desired = Math.min(
    request.projectedPixels * Math.min(Math.max(request.devicePixelRatio, 1), dprCap),
    memoryCap,
  )
  return ordered.find((candidate) => Math.max(candidate.width, candidate.height) >= desired)
    ?? ordered[ordered.length - 1]!
}

export interface AdaptiveQualityState {
  level: 0 | 1 | 2
  slowSamples: number
  fastSamples: number
}

/** Hysteretic quality policy. Adapters translate level 0/1/2 into coherent
 * DPR, LOD, post, shadow, and texture choices; the controller never mutates a
 * renderer and therefore remains deterministic and easy to test. */
export function updateAdaptiveQuality(
  state: AdaptiveQualityState,
  frameMs: number,
  targetFrameMs: number,
): AdaptiveQualityState {
  if (!Number.isFinite(frameMs) || frameMs < 0 || !Number.isFinite(targetFrameMs) || targetFrameMs <= 0) {
    throw new Error('Adaptive quality samples and target frame time must be finite positive values.')
  }
  const slow = frameMs > targetFrameMs * 1.15
  const fast = frameMs < targetFrameMs * 0.72
  const next: AdaptiveQualityState = {
    level: state.level,
    slowSamples: slow ? state.slowSamples + 1 : 0,
    fastSamples: fast ? state.fastSamples + 1 : 0,
  }
  if (next.slowSamples >= 4 && next.level > 0) {
    return { level: (next.level - 1) as 0 | 1, slowSamples: 0, fastSamples: 0 }
  }
  if (next.fastSamples >= 45 && next.level < 2) {
    return { level: (next.level + 1) as 1 | 2, slowSamples: 0, fastSamples: 0 }
  }
  return next
}

function compare(
  diagnostics: PerformanceDiagnostic[],
  metric: PerformanceDiagnostic['metric'],
  actual: number,
  budget: number,
  label: string,
  recommendation: string,
): void {
  if (actual <= budget) return
  diagnostics.push({
    severity: 'warning',
    metric,
    actual,
    budget,
    message: `${label} is ${formatMetric(actual, metric)}; the declared ${formatMetric(budget, metric)} budget is exceeded by ${formatMetric(actual - budget, metric)}.`,
    recommendation,
  })
}

function formatMetric(value: number, metric: PerformanceDiagnostic['metric']): string {
  const bytes = metric === 'initial-bytes' || metric === 'gpu-textures'
  return bytes && value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(2)} MB`
    : Number.isInteger(value)
      ? value.toLocaleString('en-US')
      : value.toFixed(2)
}

function formatBytes(value: number): string {
  return value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(2)} MB`
    : value >= 1024
      ? `${(value / 1024).toFixed(2)} KB`
      : `${value.toLocaleString('en-US')} bytes`
}
