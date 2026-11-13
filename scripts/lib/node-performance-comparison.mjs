import assert from 'node:assert/strict'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  assert.ok(value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value)), 'Identity must be finite JSON data')
  return JSON.stringify(value)
}

/** Nearest-rank percentiles of actual samples, never a supplied summary. */
export function summarizeSamples(samples) {
  assert.ok(Array.isArray(samples) && samples.length > 0 && samples.every(finite), 'Timing samples must be nonempty finite nonnegative numbers')
  for (let index = 0; index < samples.length; index++) assert.ok(Object.hasOwn(samples, index), 'Timing samples must be dense')
  const sorted = [...samples].sort((a, b) => a - b)
  const percentile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
  return { count: sorted.length, p50Ms: percentile(.5), p95Ms: percentile(.95), minMs: sorted[0], maxMs: sorted.at(-1) }
}

export function validatePolicy(policy) {
  assert.ok(object(policy), 'An explicit comparison policy is required')
  assert.deepEqual(Object.keys(policy).sort(), ['absoluteToleranceMs', 'minimumSamples', 'minimumTrials', 'relativeTolerance'])
  assert.ok(finite(policy.relativeTolerance) && policy.relativeTolerance <= 1, 'Relative tolerance must be 0..1')
  assert.ok(finite(policy.absoluteToleranceMs), 'Absolute tolerance must be finite and nonnegative')
  assert.ok(Number.isInteger(policy.minimumSamples) && policy.minimumSamples >= 30, 'At least 30 samples per trial are required')
  assert.ok(Number.isInteger(policy.minimumTrials) && policy.minimumTrials >= 3, 'At least three independent trials are required')
  return policy
}

/** Threshold screening, not a statistical significance or correctness claim.
 * A mixed result across paired trials is inconclusive instead of a pass. */
export function compareTimingTrials(baseline, candidate, policy) {
  validatePolicy(policy)
  const validate = trials => {
    assert.ok(Array.isArray(trials), 'Trials must be an array')
    const seen = new Set()
    for (const trial of trials) {
      assert.ok(Number.isInteger(trial.repeat) && trial.repeat >= 0 && !seen.has(trial.repeat), 'Trial repeat ids must be unique nonnegative integers')
      seen.add(trial.repeat); summarizeSamples(trial.samples)
    }
    return new Map(trials.map(trial => [trial.repeat, trial]))
  }
  const a = validate(baseline), b = validate(candidate)
  if (canonical([...a.keys()].sort((x,y)=>x-y)) !== canonical([...b.keys()].sort((x,y)=>x-y)))
    return { status: 'inconclusive', reason: 'Trial sets differ', trials: [] }
  if (a.size < policy.minimumTrials) return { status: 'inconclusive', reason: 'Too few trials', trials: [] }
  const trials = [...a.keys()].sort((x,y)=>x-y).map(repeat => {
    const before = summarizeSamples(a.get(repeat).samples), after = summarizeSamples(b.get(repeat).samples)
    const deltaMs = after.p95Ms - before.p95Ms
    const relative = before.p95Ms === 0 ? null : deltaMs / before.p95Ms
    const enoughSamples = before.count >= policy.minimumSamples && after.count >= policy.minimumSamples
    return { repeat, baseline: before, candidate: after, deltaMs, relative,
      exceeds: deltaMs > policy.absoluteToleranceMs && deltaMs > before.p95Ms * policy.relativeTolerance,
      enoughSamples }
  })
  if (trials.some(trial => !trial.enoughSamples)) return { status: 'inconclusive', reason: 'Too few samples', trials }
  const count = trials.filter(trial => trial.exceeds).length
  return { status: count === trials.length ? 'threshold-exceeded' : count === 0 ? 'within-threshold' : 'inconclusive',
    reason: count > 0 && count < trials.length ? 'Trials disagree; rerun on an idle matching device' : null, trials }
}

function comparePhaseTrials(baseline, candidate, phase, policy) {
  if ([...baseline, ...candidate].some(row => !finite(row.phases?.[phase])))
    return { status: 'unmeasured', reason: 'Phase timing is unavailable in at least one trial' }
  if (baseline.length < policy.minimumTrials) return { status: 'inconclusive', reason: 'Too few phase trials', trials: [] }
  const candidates = new Map(candidate.map(row => [row.repeat, row]))
  const trials = baseline.map(row => {
    const before = row.phases[phase], after = candidates.get(row.repeat).phases[phase], deltaMs = after - before
    return { repeat: row.repeat, baselineMs: before, candidateMs: after, deltaMs,
      exceeds: deltaMs > policy.absoluteToleranceMs && deltaMs > before * policy.relativeTolerance }
  })
  const count = trials.filter(trial => trial.exceeds).length
  return { status: count === trials.length ? 'threshold-exceeded' : count === 0 ? 'within-threshold' : 'inconclusive',
    reason: 'One observed phase duration per trial; no frame percentile or statistical significance is inferred', trials }
}

function validateReport(report) {
  assert.equal(report?.schemaVersion, 1)
  assert.equal(report?.kind, 'blendlink-runtime-benchmark-v1')
  assert.equal(report?.status, 'measured', 'Failed or partial benchmarks are not comparison evidence')
  assert.equal(report?.correctnessQualification, false, 'A benchmark cannot qualify numerical correctness')
  assert.ok(object(report.comparisonIdentity), 'Observed comparison identity is required')
  const identity = report.comparisonIdentity
  for (const key of ['profile', 'platform', 'architecture', 'cpuModel', 'hostOpaqueId', 'browserVersion', 'threeVersion', 'threeSourceDigest', 'harnessDigest', 'artifactsDigest'])
    assert.ok(typeof identity[key] === 'string' && identity[key].length > 0, 'Missing comparison identity: ' + key)
  assert.ok(object(identity.config) && Object.keys(identity.config).length > 0, 'Benchmark configuration is required')
  assert.ok(Array.isArray(report.rows) && report.rows.length > 0, 'Benchmark rows are required')
  const rows = new Map()
  for (const row of report.rows) {
    assert.equal(row.status, 'measured', 'Every compared row must have completed measurement')
    assert.ok(typeof row.caseId === 'string' && row.caseId.length > 0)
    assert.ok(['carrier', 'program'].includes(row.variant)); assert.ok(['webgl2', 'webgpu'].includes(row.backend))
    assert.ok(Number.isInteger(row.repeat) && row.repeat >= 0)
    assert.ok(object(row.gpu) && Object.keys(row.gpu).length > 0, 'Observed GPU identity is required')
    assert.equal(row.gpu.api, row.backend === 'webgpu' ? 'WebGPU' : 'WebGL2', 'Observed GPU API must match the requested backend')
    assert.ok(['renderer','unmaskedRenderer','vendor','architecture','device','description'].some(key =>
      typeof row.gpu[key] === 'string' && row.gpu[key].length > 0 && row.gpu[key].toLowerCase() !== 'unknown'), 'GPU identity cannot consist entirely of unknown values')
    assert.ok(Array.isArray(row.errors) && row.errors.length === 0, 'Rendering errors invalidate performance evidence')
    assert.ok(object(row.materials) && Number.isInteger(row.materials.applied) && row.materials.applied >= 0 && Array.isArray(row.materials.skipped))
    if (row.variant === 'program') {
      assert.ok(row.materials.applied > 0, 'A program benchmark must actually install a production program')
      for (const key of ['validationFrames','drawnProgramMeshes','drawnProgramMaterials'])
        assert.ok(Number.isInteger(row.drawCoverage?.[key]) && row.drawCoverage[key] > 0, 'An untimed validation frame must actually draw program materials: ' + key)
    }
    assert.equal(row.sourceRestored, true, 'Caller ownership restoration must pass')
    for (const metric of ['cpuSubmission', 'rafInterval']) summarizeSamples(row.steady?.[metric]?.samples)
    assert.equal(typeof row.steady?.gpuTimestamp?.available, 'boolean')
    if (row.steady.gpuTimestamp.available) summarizeSamples(row.steady.gpuTimestamp.distribution?.samples)
    else assert.ok(typeof row.steady.gpuTimestamp.reason === 'string' && row.steady.gpuTimestamp.reason.length > 0)
    const key = canonical([row.caseId, row.variant, row.backend, row.repeat])
    assert.ok(!rows.has(key), 'Duplicate benchmark row'); rows.set(key, row)
  }
  return rows
}

export function compareRuntimeBenchmarks(baseline, candidate, policy) {
  validatePolicy(policy)
  const before = validateReport(baseline), after = validateReport(candidate)
  const result = { schemaVersion: 1, kind: 'blendlink-runtime-performance-comparison-v1',
    performanceQualification: false, correctnessQualification: false, policy,
    status: 'not-comparable', reasons: [], metrics: [], resourceGrowth: [] }
  if (canonical(baseline.comparisonIdentity) !== canonical(candidate.comparisonIdentity)) result.reasons.push('Input, harness, configuration or observed host/browser/Three identity differs')
  if (canonical([...before.keys()].sort()) !== canonical([...after.keys()].sort())) result.reasons.push('Case/backend/variant/repeat sets differ')
  if (result.reasons.length) return result
  const groups = new Map()
  for (const [key, row] of before) {
    const next = after.get(key)
    if (canonical(row.gpu) !== canonical(next.gpu)) result.reasons.push('Observed GPU identity differs: ' + key)
    if (canonical(row.materials) !== canonical(next.materials)) result.reasons.push('Installed/refused material coverage differs: ' + key)
    const groupKey = canonical([row.caseId, row.variant, row.backend])
    const group = groups.get(groupKey) ?? { caseId: row.caseId, variant: row.variant, backend: row.backend, before: [], after: [] }
    group.before.push(row); group.after.push(next); groups.set(groupKey, group)
  }
  if (result.reasons.length) return result
  for (const { before: a, after: b, ...group } of groups.values()) {
    for (const phase of ['rendererInitMs', 'loadMs', 'installMs', 'compileMs', 'firstFrameMs'])
      result.metrics.push({ ...group, metric: phase, ...comparePhaseTrials(a, b, phase, policy) })
    for (const metric of ['cpuSubmission', 'rafInterval', 'gpuTimestamp']) {
      if (metric === 'gpuTimestamp' && [...a,...b].some(row => !row.steady.gpuTimestamp.available)) {
        result.metrics.push({ ...group, metric, status: 'unmeasured', reason: 'GPU timestamps were unavailable in at least one trial' }); continue
      }
      const series = rows => rows.map(row => ({ repeat: row.repeat, samples: metric === 'gpuTimestamp'
        ? row.steady.gpuTimestamp.distribution.samples : row.steady[metric].samples }))
      result.metrics.push({ ...group, metric, ...compareTimingTrials(series(a), series(b), policy) })
    }
    for (const row of b) {
      const first = row.resources?.afterDispose?.memory, repeated = row.resources?.afterReapplyDispose?.memory
      if (!object(first) || !object(repeated)) continue
      for (const [metric, value] of Object.entries(first)) if (finite(value) && finite(repeated[metric]) && repeated[metric] > value)
        result.resourceGrowth.push({ ...group, repeat: row.repeat, metric, before: value, after: repeated[metric] })
    }
  }
  result.status = result.resourceGrowth.length || result.metrics.some(metric => metric.status === 'threshold-exceeded') ? 'threshold-exceeded'
    : result.metrics.some(metric => metric.status === 'inconclusive') ? 'inconclusive' : 'within-threshold'
  result.scope = 'Configured thresholds for measured timing series only; unavailable GPU timing and physical-device coverage remain unqualified. Carrier cost is not visual equivalence.'
  return result
}
