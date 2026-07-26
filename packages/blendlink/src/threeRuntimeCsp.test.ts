import { describe, expect, it } from 'vitest'
import { watchForKtx2WorkerCspViolation } from './threeRuntime.js'

function violation(overrides: Partial<SecurityPolicyViolationEvent> = {}): Event {
  return Object.assign(new Event('securitypolicyviolation'), {
    blockedURI: 'blob:http://localhost/decoder',
    disposition: 'enforce',
    effectiveDirective: 'worker-src',
    ...overrides,
  })
}

describe('KTX2 worker CSP watch', () => {
  it('turns an enforced Blob worker violation into an actionable load failure', async () => {
    const target = new EventTarget()
    const watch = watchForKtx2WorkerCspViolation(target)
    expect(watch).not.toBeNull()

    target.dispatchEvent(violation())

    await expect(watch!.failure).rejects.toThrow(
      /KTX2 decoder worker was blocked.*worker-src.*allow `worker-src blob:`/i,
    )
    watch!.dispose()
  })

  it('accepts Chromium\'s redacted Blob blocked URI', async () => {
    const target = new EventTarget()
    const watch = watchForKtx2WorkerCspViolation(target)!

    target.dispatchEvent(violation({ blockedURI: 'blob' }))

    await expect(watch.failure).rejects.toThrow(/KTX2 decoder worker was blocked/i)
    watch.dispose()
  })

  it('ignores report-only, non-Blob, and unrelated policy violations', async () => {
    const target = new EventTarget()
    const watch = watchForKtx2WorkerCspViolation(target)!
    let settled = false
    void watch.failure.catch(() => { settled = true })

    target.dispatchEvent(violation({ disposition: 'report' }))
    target.dispatchEvent(violation({ blockedURI: 'https://cdn.example/worker.js' }))
    target.dispatchEvent(violation({ effectiveDirective: 'img-src' }))
    await Promise.resolve()

    expect(settled).toBe(false)
    watch.dispose()
  })
})
