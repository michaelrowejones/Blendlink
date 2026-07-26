// PROTOTYPE — pure decision logic. No I/O belongs in this module.
export function evaluatePrototype(metrics) {
  const checks = {
    deterministic: metrics.comparison.repeatRmse <= 1e-8,
    closeToCyclesEmission: metrics.comparison.flatRegionRmse <= 0.04,
    meaningfulCoverage: metrics.eevee.coveredFraction >= 0.5,
    capturedEeveeOnlyMaterial: metrics.shaderToRgb.coveredFraction >= 0.5,
  }

  const required = Object.values(checks).every(Boolean)
  const speedRatio = metrics.cycles.seconds / Math.max(metrics.eevee.secondsB, 0.0001)
  const verdict = required
    ? speedRatio >= 1.25
      ? 'PROTOTYPE: promising — proceed to seams, color, and normal-detail fixture'
      : 'PROTOTYPE: faithful but speed benefit is not yet proven'
    : 'PROTOTYPE: do not integrate — one or more foundational checks failed'

  return { checks, speedRatio, verdict }
}
