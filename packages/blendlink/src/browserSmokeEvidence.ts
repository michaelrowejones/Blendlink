export type BrowserSmokeIssueCode =
  | 'asset-request-failed'
  | 'asset-http-error'
  | 'console-error'
  | 'page-error'
  | 'csp-worker-blocked'
  | 'decoder-failed'
  | 'cors-failed'
  | 'canvas-zero-size'
  | 'webgl-unavailable'
  | 'webgl-context-lost'
  | 'render-visibly-empty'
  | 'unexpected-service-worker'

export interface BrowserSmokeIssue {
  readonly code: BrowserSmokeIssueCode
  readonly message: string
  readonly url?: string
}

export type BrowserSmokeEvidenceEvent =
  | Readonly<{ kind: 'response'; url: string; status: number }>
  | Readonly<{ kind: 'request-failed'; url: string; error: string }>
  | Readonly<{ kind: 'console-error'; message: string }>
  | Readonly<{ kind: 'page-error'; message: string }>
  | Readonly<{ kind: 'csp-violation'; directive: string; blockedUrl: string }>
  | Readonly<{ kind: 'decoder-failed'; decoder: 'ktx2' | 'meshopt'; message: string }>
  | Readonly<{ kind: 'cors-failed'; url: string; message: string }>
  | Readonly<{
      kind: 'canvas'
      cssWidth: number
      cssHeight: number
      webgl: 'available' | 'unavailable' | 'lost'
      visiblePixelFraction?: number
    }>
  | Readonly<{ kind: 'service-worker'; controlled: boolean; expected: boolean }>

export interface BrowserSmokeEvidence {
  record(event: BrowserSmokeEvidenceEvent): void
  readonly issues: readonly BrowserSmokeIssue[]
  assertHealthy(): void
}

function pathname(value: string): string {
  try { return new URL(value, 'https://blendlink.invalid/').pathname }
  catch { return value.split(/[?#]/, 1)[0] ?? value }
}

/** Stable evidence classifier for application-owned Playwright/browser gates.
 * It owns no route, server, browser, Canvas, or pixel threshold. */
export function createBrowserSmokeEvidence(options: {
  declaredAssetUrls?: readonly string[]
  minimumVisiblePixelFraction?: number
} = {}): BrowserSmokeEvidence {
  const declared = new Set((options.declaredAssetUrls ?? []).map(pathname))
  const minimumVisible = options.minimumVisiblePixelFraction
  if (minimumVisible !== undefined
      && !(Number.isFinite(minimumVisible) && minimumVisible >= 0 && minimumVisible <= 1)) {
    throw new Error(`minimumVisiblePixelFraction must be between 0 and 1; got ${minimumVisible}.`)
  }
  const issues: BrowserSmokeIssue[] = []
  const add = (issue: BrowserSmokeIssue): void => {
    if (!issues.some((known) => known.code === issue.code
        && known.message === issue.message && known.url === issue.url)) issues.push(Object.freeze(issue))
  }
  const isDeclared = (url: string): boolean => declared.size === 0 || declared.has(pathname(url))

  return {
    record(event) {
      switch (event.kind) {
        case 'response':
          if (event.status >= 400 && isDeclared(event.url)) add({
            code: 'asset-http-error',
            message: `Compiled scene asset returned HTTP ${event.status}: ${event.url}`,
            url: event.url,
          })
          break
        case 'request-failed':
          if (isDeclared(event.url)) add({
            code: 'asset-request-failed',
            message: `Compiled scene asset request failed: ${event.url} (${event.error})`,
            url: event.url,
          })
          break
        case 'console-error': add({ code: 'console-error', message: event.message }); break
        case 'page-error': add({ code: 'page-error', message: event.message }); break
        case 'csp-violation':
          if (/worker-src|child-src|script-src/i.test(event.directive)) add({
            code: 'csp-worker-blocked',
            message: `Content Security Policy blocked a decoder worker (${event.directive}): ${event.blockedUrl}`,
            url: event.blockedUrl,
          })
          break
        case 'decoder-failed': add({
          code: 'decoder-failed',
          message: `${event.decoder.toUpperCase()} decoder failed: ${event.message}`,
        }); break
        case 'cors-failed': add({
          code: 'cors-failed',
          message: `Cross-origin scene asset failed CORS: ${event.url} (${event.message})`,
          url: event.url,
        }); break
        case 'canvas':
          if (!(event.cssWidth > 0 && event.cssHeight > 0)) add({
            code: 'canvas-zero-size',
            message: `Canvas has no visible layout area (${event.cssWidth} × ${event.cssHeight} CSS px).`,
          })
          if (event.webgl === 'unavailable') add({
            code: 'webgl-unavailable', message: 'The browser could not create a WebGL context.',
          })
          if (event.webgl === 'lost') add({
            code: 'webgl-context-lost', message: 'The scene WebGL context was lost.',
          })
          if (minimumVisible !== undefined && event.visiblePixelFraction !== undefined
              && event.visiblePixelFraction < minimumVisible) add({
            code: 'render-visibly-empty',
            message: `Only ${(event.visiblePixelFraction * 100).toFixed(2)}% of Canvas pixels met the application visibility probe; expected at least ${(minimumVisible * 100).toFixed(2)}%.`,
          })
          break
        case 'service-worker':
          if (event.controlled !== event.expected) add({
            code: 'unexpected-service-worker',
            message: event.controlled
              ? 'A service worker unexpectedly controlled the smoke page and may hide network failures.'
              : 'The smoke page expected service-worker control but none was active.',
          })
          break
      }
    },
    get issues() { return Object.freeze([...issues]) },
    assertHealthy() {
      if (issues.length === 0) return
      throw new Error(
        `Blendlink production browser evidence failed:\n${issues.map((issue) => `- [${issue.code}] ${issue.message}`).join('\n')}`,
      )
    },
  }
}
