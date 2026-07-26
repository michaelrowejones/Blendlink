import { describe, expect, it } from 'vitest'
import { createBrowserSmokeEvidence } from './browserSmokeEvidence.js'

describe('production browser evidence classifier', () => {
  it('classifies only compiler-declared asset failures', () => {
    const evidence = createBrowserSmokeEvidence({ declaredAssetUrls: ['/models/scene.glb'] })
    evidence.record({ kind: 'response', url: 'https://cdn.test/app.js', status: 500 })
    evidence.record({ kind: 'request-failed', url: 'https://cdn.test/models/scene.glb?v=1', error: 'CORS' })
    expect(evidence.issues.map((issue) => issue.code)).toEqual(['asset-request-failed'])
  })

  it('keeps CSP, decoder, CORS, Canvas, WebGL, pixels, and service workers distinct', () => {
    const evidence = createBrowserSmokeEvidence({ minimumVisiblePixelFraction: 0.02 })
    evidence.record({ kind: 'csp-violation', directive: 'worker-src', blockedUrl: 'blob:https://site/worker' })
    evidence.record({ kind: 'decoder-failed', decoder: 'ktx2', message: 'worker unavailable' })
    evidence.record({ kind: 'cors-failed', url: 'https://cdn.test/a.ktx2', message: 'missing ACAO' })
    evidence.record({ kind: 'canvas', cssWidth: 0, cssHeight: 300, webgl: 'lost', visiblePixelFraction: 0 })
    evidence.record({ kind: 'service-worker', controlled: true, expected: false })
    expect(evidence.issues.map((issue) => issue.code)).toEqual([
      'csp-worker-blocked', 'decoder-failed', 'cors-failed', 'canvas-zero-size',
      'webgl-context-lost', 'render-visibly-empty', 'unexpected-service-worker',
    ])
    expect(() => evidence.assertHealthy()).toThrow(/production browser evidence failed/i)
  })

  it('accepts a healthy application-declared Canvas probe', () => {
    const evidence = createBrowserSmokeEvidence({ minimumVisiblePixelFraction: 0.01 })
    evidence.record({ kind: 'response', url: '/models/scene.glb', status: 200 })
    evidence.record({ kind: 'canvas', cssWidth: 800, cssHeight: 600, webgl: 'available', visiblePixelFraction: 0.25 })
    evidence.record({ kind: 'service-worker', controlled: false, expected: false })
    expect(evidence.issues).toEqual([])
    expect(() => evidence.assertHealthy()).not.toThrow()
  })
})
