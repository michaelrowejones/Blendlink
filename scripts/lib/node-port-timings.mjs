import assert from 'node:assert/strict'

const duration = value => {
  assert.ok(Number.isFinite(value) && value >= 0, 'Elapsed time must be a finite nonnegative number')
  return value
}
function summarize(rows) {
  if (!rows.length) return { count: 0, sumMs: 0, medianMs: null, p95Ms: null, maximumMs: null }
  const values = rows.map(row => duration(row.elapsedMs)).sort((a, b) => a - b)
  return { count: values.length, sumMs: values.reduce((a, b) => a + b, 0),
    medianMs: values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2,
    p95Ms: values[Math.ceil(values.length * 0.95) - 1], maximumMs: values.at(-1) }
}
function nativeAction(args) {
  assert.ok(Array.isArray(args) && args.every(value => typeof value === 'string'), 'Native arguments must be strings')
  const end = args.indexOf('--'), options = end < 0 ? args : args.slice(0, end)
  const action = options.findIndex(value => ['--python', '-P', '--python-expr', '--python-text', '--python-console'].includes(value))
  const version = options.findIndex(value => ['--version', '-v'].includes(value))
  if (version >= 0 && (action < 0 || version < action)) return 'identity'
  const scripts = options.filter((value, index) => index && ['--python', '-P'].includes(options[index - 1]))
  return scripts.some(value => /(?:^|[/\\])export_scene\.py$/.test(value)) ? 'final-export' : action >= 0 ? 'native-python' : 'other'
}

/** Diagnostic only. Child durations overlap outer suite durations and are never added to them. */
export function diagnoseNodePortTimings(report, { reviewAfterMs = 20 * 60 * 1000 } = {}) {
  assert.equal(report.kind, 'blendlink-node-port-verification-v1', 'Use a node-port verification report')
  assert.equal(report.schemaVersion, 1)
  assert.ok(Number.isFinite(reviewAfterMs) && reviewAfterMs > 0, 'Review threshold must be positive')
  assert.ok(Array.isArray(report.steps) && report.steps.length <= 10000, 'Invalid command timing inventory')
  const steps = report.steps.map(step => {
    assert.ok(typeof step.id === 'string' && step.id.length > 0, 'Command id required')
    return { id: step.id, elapsedMs: duration(step.elapsedMs), failed: step.exitCode !== 0 || !!step.timedOut || !!step.error }
  })
  const commandSumMs = steps.reduce((sum, step) => sum + step.elapsedMs, 0)
  const commands = steps.map(step => ({ ...step, shareOfRecordedCommands: commandSumMs ? step.elapsedMs / commandSumMs : 0,
    reviewSuggested: step.failed || step.elapsedMs >= reviewAfterMs })).sort((a, b) => b.elapsedMs - a.elapsedMs)
  const invocations = report.nativePythonProof?.invocations ?? []
  assert.ok(Array.isArray(invocations) && invocations.length <= 10000, 'Invalid native timing inventory')
  const native = invocations.filter(row => row.result).map(row => ({ action: nativeAction(row.result.args),
    elapsedMs: duration(row.result.elapsedMs), failed: row.result.exitCode !== 0 || !!row.result.timedOut || !!row.result.aborted || !!row.result.error || !!row.error }))
  const byAction = Object.fromEntries(['identity', 'final-export', 'native-python', 'other'].map(action => [action, summarize(native.filter(row => row.action === action))]))
  return { schemaVersion: 1, kind: 'scenetoweb-node-port-timing-diagnosis-v1', manifestId: report.manifestId ?? null,
    qualificationStatus: report.status, numericalCredit: false, reviewAfterMs, commands, commandSumMs,
    nativeInvocations: { ...summarize(native), failedCount: native.filter(row => row.failed).length,
      missingResultCount: invocations.length - native.length, byAction },
    limits: ['Recorded command sum excludes hashing, browser identity probes and other unmeasured orchestration; it is not full transaction wall time.',
      'Native child elapsed times are nested in suite commands and may overlap each other. They are reported separately, never added or subtracted.',
      'Times describe proof execution, not runtime rendering performance or engineering effort. No numerical qualification is granted or reused.'] }
}
