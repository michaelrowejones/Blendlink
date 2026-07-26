# Production browser smoke and loading ownership (2026)

## Scope and version of reality

This note audits the production-browser gap left by
`research-preview-to-website-2026.md`. It is intentionally separate from the
asset-addressing and R3F-installation research so those workstreams can be
synthesized before interfaces overlap.

The inspected repositories were dirty before this research. This note is the
only file changed by this workstream. The locally installed versions inspected
on 2026-07-21 were:

- Playwright `1.60.0` and `@playwright/test` `1.60.0` in
  MichaelRoweJonesSite;
- Next `16.2.6` in MichaelRoweJonesSite;
- Three `0.184.0` in both repositories;
- Meshoptimizer `1.2.0` in Blendlink.

Primary evidence includes the installed source and documentation for those
exact versions, plus the current official React, R3F, Three, Playwright,
WHATWG, W3C, Khronos, and Next documentation linked below.

## Production verification update (2026-07-24)

The implementation has advanced beyond the original audit below:

- `publish` now optionally runs the website's declared browser-smoke command
  after its existing production build and the second static artifact
  verification. The MichaelRoweJones command exercises the application-owned
  routes and Canvas rather than a generated Blendlink route;
- the production R3F adapter now prepares an exclusively owned root on a
  private Scene and commits Scene/renderer/camera/Component/host policy
  synchronously from a layout effect. Loading, failure/retry, bootstrap/full
  quality, and first-completed-frame facts remain application-facing facts,
  not a prescribed loading screen;
- the production-source competing-renderer differential passed in Chrome 150
  through ANGLE SwiftShader with partial-frame counts `5 / 9 / 0 / 0` for
  live mutation, root-only hiding, detached control, and the production
  adapter. The production cell retained 18 baseline frames during detached
  preparation/`compileAsync` and then 28 ready frames, with no page or console
  errors. This is synthetic basic-material evidence, not network/decoder,
  postprocessing, physical-GPU, or cross-browser proof;
- the current Next dogfood matrix covers a successful GLB scene, phone layout,
  missing assets and retry, relocated compiler-owned assets, blocked/allowed
  KTX2 Blob workers, context loss, WebGL creation failure, zero-height versus
  visibly-empty classification, real CORS failure, and the public hero.
  Application-authored visual thresholds remain deliberate; Blendlink still
  does not impose a universal nonblack-pixel oracle.

The 2026-07-24 publish run initially caught a real Contact Shadows activation
regression in the 21-component lab. The helper/capture pass retained the
private preparation Scene. The deep Component seam now supplies the committed
Scene/camera synchronously, focused tests pass, and the exact production
browser test passes. This is evidence for keeping the smoke gate application
owned and executable, rather than treating a green build as render proof.

## Conclusion

Blendlink should not generate or own an application route. The strongest
production smoke seam is an **optional application-declared route contract**:
the application supplies a production start command or script, a route, and a
DOM marker for one compiled scene; a package-owned Playwright implementation
collects and classifies the standard evidence. The application keeps its
route, Canvas, loading presentation, framework, CSP, and deployment.

The first dogfoodable step should be smaller: let `publish` optionally run an
application-owned smoke command, using the existing
`e2e/blendlink-lab.spec.ts`. That is low risk and immediately verifies the
production Next build. It is deliberately a prototype, not the final deep
module: every application otherwise has to reproduce request, CSP, WebGL,
layout, screenshot, and diagnostic logic.

Three important limits must remain explicit:

1. A local production-server smoke proves the built application integration,
   not the eventual CDN, headers, rewrites, or credentials at a deployed URL.
   A deployed-URL smoke is a second, post-deploy mode.
2. Browser events only prove dependencies actually requested by the exercised
   scenario. Lazy states, probes, or delivery variants need declared scenarios
   or a truthful complete-graph preload before they are browser-verified.
3. “Visibly non-empty” has no universal pixel threshold. A black transition,
   transparent Canvas, background-only scene, or intentionally sparse artwork
   can be valid. Always capture an image; only fail pixels against an
   application-declared visual oracle.

## Current implementation audit

### Implemented, verified, and missing

| Concern | Implemented now | Verified now | Remaining gap |
| --- | --- | --- | --- |
| Publish transaction | `publishWebsiteProject()` compiles Final, verifies artifacts, runs the application's `build`, verifies again, then optionally runs its declared browser-smoke command. | Unit coverage plus repeated production Next dogfood publishes. | A local smoke still proves only the exercised origin/routes; deployed CDN/header evidence is separate. |
| Preview browser validation | Preview Studio creates a candidate Canvas/renderer, installs the scene, resizes, updates, calls `compileAsync`, renders, waits one animation frame, checks context loss and shader logs, then atomically promotes the candidate. | Preview tests and the save-driven Studio workflow. | It is a disposable Blendlink-owned viewer, not the application's route, layout, CSP, loader overrides, or production build. It does not use a visual pixel oracle. |
| Atomic application activation | R3F prepares on a private Scene and synchronously commits the complete reversible presentation/host journal from a layout effect. | Coordinator/atomic tests and the production-source competing-renderer Chromium differential. | Real external texture/decoder/postprocessing pixels, physical GPU, and cross-browser evidence remain. |
| Application readiness | R3F exposes attempt-scoped Loading/Preparing/Ready/Failed plus Bootstrap/Full/Failed presentation quality and first-completed-frame acknowledgement. | Dogfood routes drive loading, ready, retry, progressive quality, and failure states. | No shared/ref-counted Suspense preload interface; `compileAsync` is not a presented-frame guarantee. |
| Application failure UX | Dogfood owns React error boundaries, visible alerts, recoverability policy, retry keys, and Canvas remount after context loss. | Missing GLB, worker CSP, context-loss, WebGL-creation, and retry scenarios. | Generic structured recoverability remains intentionally conservative; application policy still decides when external state is repaired. |
| Page/runtime errors | Dogfood records page errors, console output, response/request failures, CSP violations, and context evidence. | Main, failure, component, and public-hero production scenarios. | Package classification is still split between reusable evidence helpers and application Playwright adapters. |
| Asset requests | Dogfood records failed requests and HTTP `>=400` for scene-name/Basis URL patterns, and requires the dogfood GLB request. | The default scene and an intentional GLB abort are exercised. | URL regexes are application-specific and cannot prove unrequested/lazy companions. `requestfailed` alone does not include HTTP 404/500. |
| Canvas layout | Dogfood requires visible browser bounds and >90% viewport height/width on desktop/mobile. | Two production-browser scenarios. | No generic marker/threshold contract; zero CSS height and zero drawing-buffer size should be reported separately. |
| Visibly empty render | Dogfood screenshots the Canvas with Sharp and requires >2% non-black pixels plus content below 45% height. | The current workbench composition. | These are artwork-specific thresholds, not safe defaults for every Blendlink scene. |
| WebGL failure | Preview and R3F observe context loss; application owns fallback/remount. | Dogfood intentionally forces context loss and WebGL creation failure. | Physical-device loss/recovery and wider browser evidence remain. |
| KTX2 | The runtime installs/configures KTX2 and ships the Basis companions; dogfood request matching includes `blendlink-basis`. | A production Next/Chromium pair loads the same real required-KTX2 GLB under blocked and allowed Blob-worker policies; allowed reaches Ready with decoded `CompressedTexture` maps. | Missing/corrupt JS/WASM/KTX2 and unsupported-transcoder scenarios remain. |
| Meshopt | Runtime worker policy has main-thread fallback and bounded worker ownership. | Unit tests and normal dogfood scene load. | No browser scenario distinguishes successful worker decode, expected main-thread fallback, or a CSP-blocked worker warning. |
| CSP | An enforced Blob `worker-src`/fallback violation during a package-owned KTX2 load is correlated with that attempt, aborts private manager requests, and reports the required policy/loader remedy. | Production response headers, worker construction, `securitypolicyviolation`, GLB/Basis 200s, loud Error, and the allowed Ready control are asserted in Chromium. | Cross-browser and deployed-origin policy evidence remain. Application-owned loaders retain policy/error ownership. |
| CORS/CDN | Three loaders remain configurable and browser evidence classifies real cross-origin failures. | A two-origin production fixture without ACAO is classified as CORS rather than a missing local file. | Credentials/headers and deployed CDN/origin matrices remain. |
| Base path | `assetBaseUrl` relocates known compiler-owned requests; static graph verification remains authoritative. | A production route relocates the complete exercised compiler-owned graph. | Full immutable graph-addressed publication and broader Next/Vite deployment matrices remain. |
| Performance evidence | Pixel coverage and warning attachments are saved. | Dogfood test artifacts. | No ready duration, resource timing, transferred bytes, renderer counters, long tasks, or budget policy. |

### What the exact installed libraries imply

Playwright emits `console`, `pageerror`, `response`, `requestfailed`, `worker`,
and `crash` events. A network failure and an HTTP failure are different:
`requestfailed` is emitted for a failed request, while a 404/503 is a completed
HTTP response and must be caught from `response.status()`.
([Playwright Page](https://playwright.dev/docs/api/class-page),
[Playwright Request](https://playwright.dev/docs/api/class-request))

Playwright's `webServer` facility can start an application command before a
test and exposes command, cwd, environment, URL, timeout, stdout/stderr, and
reuse policy. This is a good adapter for a local production server, and the
dogfood config correctly uses `npm run build && npm run start`, rather than
testing Next development mode.
([Playwright web server](https://playwright.dev/docs/test-webserver)) The
installed Next 16.2.6 guide says `next build` creates the optimized production
build and `next start` runs that already-built application in production mode.
([Next CLI](https://nextjs.org/docs/app/api-reference/cli/next))

Three r184's `KTX2Loader` loads `basis_transcoder.js` and
`basis_transcoder.wasm`, combines the wrapper and worker body into a `Blob`,
creates an object URL, and constructs `new Worker(blobUrl)`. It also requires
`detectSupport(renderer)` and exposes `dispose()` for its worker pool/object
URL. This is source evidence, not an inference from a loader name.
([Three r184 `KTX2Loader` source](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/KTX2Loader.js),
[Three KTX2Loader contract](https://threejs.org/docs/pages/KTX2Loader.html))
Meshoptimizer 1.2.0's official decoder uses the same Blob-worker pattern when
`useWorkers(count)` is enabled.
([Meshoptimizer 1.2.0 decoder source](https://github.com/zeux/meshoptimizer/blob/v1.2/meshopt_decoder.mjs))

The glTF delivery contract itself can make these decoder paths optional or
required. `KHR_texture_basisu` permits a PNG/JPEG fallback when one is declared,
but putting it in `extensionsRequired` removes that fallback. Meshopt likewise
defines explicit fallback-buffer rules. A smoke report must use the actual
descriptor/GLB contract and must not assume every decoder failure has a core
fallback.
([Khronos `KHR_texture_basisu`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md),
[Khronos `EXT_meshopt_compression` fallback buffers](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md#fallback-buffers))

CSP `worker-src` controls Worker, SharedWorker, and ServiceWorker requests. If
it is absent, the effective policy falls back through `child-src`,
`script-src`, and `default-src`. A Blob worker must match the actual source
list; an explicit `blob:` source is the portable policy to test for these
loaders rather than assuming `'self'` is sufficient.
([CSP Level 3 `worker-src`](https://www.w3.org/TR/CSP3/#directive-worker-src),
[CSP fallback list](https://www.w3.org/TR/CSP3/#get-effective-directive-for-request))

Three r184 `LoadingManager.abort()` is conditional: it only aborts loaders that
implement loader abort and only when the browser supports `AbortSignal.any()`.
Therefore a browser gate must never report “cancellation verified” merely
because unmount ignored or disposed a late result.
([Three LoadingManager](https://threejs.org/docs/pages/LoadingManager.html),
[Three Loader](https://threejs.org/docs/pages/Loader.html))

Three's loader interface includes `crossOrigin`, request headers, and
`withCredentials`. The Fetch Standard requires the receiving origin to opt in
to CORS; credentialed cross-origin requests cannot use wildcard
`Access-Control-Allow-Origin` and additionally require
`Access-Control-Allow-Credentials: true`.
([Three Loader](https://threejs.org/docs/pages/Loader.html),
[WHATWG Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol))

`compileAsync()` is a shader-preparation barrier, not a rendered-image proof.
It resolves when the reachable scene can render without unnecessary shader
compilation stalls, and requires lighting/environment configuration first.
The gate still needs a real render and browser paint before visual evidence.
([Three WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html))

R3F explicitly offers a Canvas fallback when WebGL is unsupported and advises
an error boundary for GPU/context failures. Its Canvas owns the renderer,
scene, camera, sizing, and render loop, so the smoke seam belongs outside the
Canvas, observing the application's real integration.
([R3F Canvas](https://r3f.docs.pmnd.rs/api/canvas),
[R3F hooks](https://r3f.docs.pmnd.rs/api/hooks))

## Evidence model for a production smoke

The runner should return a report; output and exit status should be derived
from that report rather than scattered assertions. Each check is `passed`,
`failed`, or `not-run` with a reason. That makes omitted visual or CDN evidence
loud without pretending every optional check is a failure.

```ts
type SmokeCheckStatus = 'passed' | 'failed' | 'not-run'

interface BrowserSmokeCheck {
  category:
    | 'navigation' | 'page' | 'console' | 'network' | 'csp'
    | 'decoder' | 'layout' | 'webgl' | 'visual' | 'performance'
  status: SmokeCheckStatus
  summary: string
  evidence?: unknown
  fix?: string
}

interface BrowserSmokeReport {
  target: { url: string; mode: 'local-production' | 'deployed' }
  startedAt: string
  readyMs?: number
  checks: BrowserSmokeCheck[]
  artifacts: { screenshot?: string; trace?: string; json: string }
}
```

### Checks the package can own

| Failure | Browser evidence | Required policy |
| --- | --- | --- |
| Missing GLB/companion | Record every request from before navigation; fail relevant `requestfailed`; separately fail relevant HTTP `>=400`; retain URL, status, failure text, and initiator/resource type where available. | “Relevant” is the descriptor dependency set when known, otherwise app-declared URL matchers. Do not hide unrelated page failures, but allow exact app-owned exceptions for analytics/devices. |
| Base-path error | Navigate to the declared production route and require the expected scene GLB URL/marker. Capture redirect chain and final URL. | A root-only run is not base-path evidence. Run the build with the real build-time base configuration. |
| CORS error | Preserve request failure text, console error, response headers when exposed, and a CSP/CORS category. | Do not promise the same result for a future CDN; run `deployed` mode against that origin. |
| CSP worker failure | Capture `securitypolicyviolation`, console error, worker creation, and the effective document CSP header; correlate the blocked URL/directive with KTX2/Meshopt use. | Exercise the worker path. Small Meshopt assets may correctly stay on the main thread. |
| Decoder failure | Require ready/error terminal state; correlate Basis JS/WASM/KTX2/Meshopt requests and errors. Add optional fault-injection scenarios for missing/corrupt companions. | A normal success proves only the selected delivery variant and device path. |
| Zero-height Canvas | Read CSS bounding box, client size, HTML canvas width/height, computed visibility/opacity, and viewport ratios after ready. | Default failure only for zero/non-visible dimensions; composition ratios remain app policy. |
| WebGL creation/loss | Require a WebGL context or application fallback marker; record `webglcontextlost`, `isContextLost()`, page crash, and terminal status. | Do not require WebGL if the application deliberately declares a fallback success state. |
| Blank render | Always attach Canvas and page screenshots after two animation frames. | Failure needs a declared oracle: pixel coverage/background, snapshot, or application assertion. No generic black-pixel threshold. |
| Page/console failure | Record listeners before navigation; fail uncaught page errors and console errors; record warnings. | Warnings should be exact-allowlisted, never broadly ignored. |
| Performance | Record navigation-to-ready, request timings/status/cache headers, Resource Timing when visible, screenshot dimensions, and optional renderer counters. | Evidence is not a budget. Budgets are application-declared and device/browser-specific. |

Resource Timing can provide resolved URLs, durations, and transfer sizes, but
cross-origin detail is intentionally hidden unless the response passes the
timing-allow check (normally via `Timing-Allow-Origin`). Service worker timing
also describes the page-to-worker interaction, not every worker-side fetch.
The report must mark opaque values rather than converting zeros into fake
performance wins.
([W3C Resource Timing](https://www.w3.org/TR/resource-timing/#sec-cross-origin-resources))

WebGL loss is independently observable: `webglcontextlost` fires on the Canvas
and `isContextLost()` reports whether the context must be restored before
rendering resumes.
([WebGL context-lost event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event),
[WebGL `isContextLost`](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost))

### Local production versus deployed mode

The same report shape can support two adapters at one real seam:

- `local-production` starts the application's declared production command on
  an allocated loopback port. It proves build output, route integration,
  application CSP headers, decoders, Canvas layout, and render behavior.
- `deployed` receives an HTTPS URL and starts no process. It proves the actual
  base path, CDN objects, CORS, cache headers, redirects, and deployed CSP.

These are genuinely different adapters, so this seam is real rather than
hypothetical. Deployment and credentials remain application-owned. The runner
may accept Playwright `storageState` or headers in deployed mode, but should
never discover or persist credentials itself.

## Three radically different smoke-gate module interfaces

### Design 1 — minimal command seam

This design minimizes the interface to one optional application command.

```ts
interface BrowserSmokeCommand {
  command: string
  cwd?: string
}

interface PublishWebsiteOptions {
  browserSmoke?: BrowserSmokeCommand | false
}
```

Usage:

```js
export default {
  browserSmoke: {
    command: 'npx playwright test e2e/blendlink-lab.spec.ts',
  },
}
```

**Invariants and ordering.** The command runs only after Final compile, first
artifact verification, the application build, and second artifact
verification. `--assets-only` skips it because no production application build
was requested. A missing command never silently passes: the report says
`not-run` unless the application enabled it.

**Errors.** Spawn errors, non-zero status, and termination failure are loud and
include the command and application root. On Windows the implementation must
terminate the spawned process tree, consistent with this repository's process
rule.

**Hidden implementation and adapters.** The module hides only command
selection, ordering, output capture, and process lifetime. The application
command is the sole adapter.

**Depth, locality, and seam placement.** The interface is tiny but the module
is shallow: deleting it moves one command back into CI while all browser logic
remains duplicated in applications. Locality for process ordering is good;
locality for diagnostics is poor. The seam sits at the publish transaction,
not at browser behavior.

**Tradeoff.** This is the safest prototype and best immediate dogfood, but not
the final product interface.

### Design 2 — flexible Playwright scenario adapter seam

This design maximizes extension. Applications provide scenario adapters while
Blendlink provides collection and report helpers.

```ts
interface BrowserSmokeHarness {
  page: import('@playwright/test').Page
  evidence: {
    watchRequests(match: (url: URL) => boolean): void
    markReady(): void
    attach(name: string, body: Uint8Array | string): Promise<void>
  }
}

interface BrowserSmokeScenario {
  name: string
  path: string
  run(harness: BrowserSmokeHarness): Promise<void>
}

export function defineBrowserSmoke(
  scenarios: readonly BrowserSmokeScenario[],
): BrowserSmokeAdapter
```

Usage:

```ts
export default defineBrowserSmoke([{
  name: 'workbench',
  path: '/blendlink-lab',
  async run({ page, evidence }) {
    evidence.watchRequests(url => url.pathname.includes('/workbench-dogfood/'))
    const root = page.getByTestId('blendlink-lab')
    await expect(root).toHaveAttribute('data-blendlink-status', 'ready')
    evidence.markReady()
    expect((await root.locator('canvas').boundingBox())?.height).toBeGreaterThan(600)
  },
}])
```

**Invariants and ordering.** Global listeners are installed before navigation.
Every scenario must call `markReady()` exactly once or end in a declared
application fallback. Blendlink owns trace/screenshot/report finalization even
when the scenario throws.

**Errors.** Scenario exceptions become checks with adapter source/name and the
collected browser evidence. A scenario that returns without a terminal state
is an interface violation.

**Hidden implementation and adapters.** Playwright browser launch, production
server, event collection, trace, and artifact writing stay hidden. Scenario
files are adapters at the route-specific seam.

**Depth, locality, and seam placement.** The implementation can be deep, but
the interface leaks Playwright and assertion knowledge. It has high capability
and low default leverage. Browser mechanics remain local; readiness/layout/
visual policy spreads into each adapter. The seam is inside the browser test,
which is later than necessary for common behavior.

**Tradeoff.** Appropriate as an escape hatch for authentication, route
transitions, multiple states, or non-Canvas renderers. Too flexible as the
artist-first default.

### Design 3 — common-default declarative route contract (recommended)

This design optimizes for the common caller and keeps a flexible scenario
adapter as an escape hatch, not the main interface.

```ts
interface BrowserSmokeRoute {
  path: string
  /** Root owned and rendered by the application. */
  marker: string
  scene: string
  visual?:
    | { kind: 'coverage'; background: string; minimumRatio: number }
    | { kind: 'snapshot'; name: string; maxDiffPixels?: number }
}

interface BrowserSmokeConfig {
  mode?: 'local-production' | 'deployed'
  route: BrowserSmokeRoute
  /** Defaults to the application's `start` package script locally. */
  startCommand?: string
  url?: string
  timeoutMs?: number
  warningAllowlist?: readonly string[]
  adapter?: string
}
```

The marker has a deliberately small DOM interface:

```html
<main
  data-blendlink-scene="workbenchDogfood"
  data-blendlink-status="loading|preparing|ready|error"
>
  <!-- The application's own loading/error presentation and Canvas. -->
</main>
```

Usage:

```js
export default {
  browserSmoke: {
    route: {
      path: '/blendlink-lab',
      marker: '[data-blendlink-scene="workbenchDogfood"]',
      scene: 'workbenchDogfood',
      visual: { kind: 'coverage', background: '#000', minimumRatio: 0.02 },
    },
  },
}
```

**Invariants and ordering.** The application owns the marker, route, Canvas,
and presentation. `loading`/`preparing` must reach exactly one terminal state:
`ready` or `error`. `ready` means the configured scene is installed and
renderer preparation completed; the runner then waits for browser paint before
capturing visual evidence. A marker is unique on its route. A configured
visual oracle is required to claim a visible-render pass.

**Errors.** Missing/duplicate marker, missing Canvas, terminal `error`, timeout,
zero size, context loss, page/console/network/CSP/decoder failures, and failed
visual oracle receive distinct categories and fixes. If no visual oracle is
configured, visual is `not-run`, never `passed`.

**Hidden implementation and adapters.** The deep implementation owns server
lifetime, browser launch, pre-navigation listeners, response/request
classification, CSP violation capture, decoder correlation, Canvas metrics,
paint wait, screenshots, timing evidence, report formatting, and cleanup. The
two default origin adapters are local production and deployed URL. A scenario
adapter replaces only route-specific interaction when needed.

**Depth, locality, and seam placement.** This gives the strongest leverage:
two route facts unlock most checks. Browser/version changes and diagnostic
fixes stay local to one package module. The seam sits between the
application-owned route and package-owned evidence runner, which respects the
product boundary. The DOM marker is a stable testing/accessibility-adjacent
contract, not a generated route or loading screen.

**Tradeoff.** The marker requires a tiny application change and a documented
state vocabulary. Authenticated or multi-step routes still need the adapter.
That is acceptable because there are now at least two real adapters rather
than exposing every Playwright option in the default interface.

### Recommendation after comparison

Use Design 1 to dogfood immediately, then deepen into Design 3. Retain a narrow
Design 2 adapter only when a declarative route cannot reach the scene. This
sequence avoids inventing a generic browser interface before one production
site has exercised failure classification, but its destination is clear:
package-owned evidence logic and application-owned route/presentation.

A temporary generated harness should not be the production gate. It is useful
as an internal loader/asset-graph prototype, but it bypasses the exact things
this gate must prove: framework base paths, route layout, the application's
Canvas, CSP headers, router integration, loader overrides, and production
server behavior. The deletion test also exposes its weakness: removing the
harness removes its confidence rather than moving necessary complexity back to
the application.

## Loading UX and application-facing interface constraints

Before this implementation slice, the dogfood demonstrated the minimum viable
presentation (`loading`, `ready`, `error` plus an error boundary), but the
package's only interface was `onReady`. The interface comparison therefore
required state facts rather than prescribed visuals:

```ts
type BlendlinkLoadState =
  | { phase: 'loading'; itemsLoaded: number; itemsTotal: number; currentUrl?: string }
  | { phase: 'preparing' }
  | { phase: 'ready'; installed: InstalledThreeCompiledScene }
  | { phase: 'failed'; error: Error; recoverable: boolean }

interface R3FCompiledSceneProps {
  onLoadStateChange?(state: BlendlinkLoadState): void
  retryKey?: string | number
}
```

The shipped interface uses this shape with attempt identity and separate
renderer-presentation facts. The application still owns wording, layout,
fallbacks, retry controls, and analytics.

The state interface needs these invariants:

- `itemsLoaded/itemsTotal` is item progress, not byte percentage. Three's
  manager totals can grow as dependencies are discovered, and TextureLoader
  does not provide byte progress. The application's loading presentation must
  be allowed to stay indeterminate.
  ([Three LoadingManager](https://threejs.org/docs/pages/LoadingManager.html),
  [Three TextureLoader](https://threejs.org/docs/pages/TextureLoader.html))
- `preparing` covers renderer-bound KTX support detection, texture upload,
  scene policy installation, and shader compilation. A network/CPU preload is
  not allowed to emit `ready`.
- `ready` remains “installed and prewarmed”; the production smoke separately
  proves “presented” after an actual browser frame. Conflating these makes an
  `onReady` callback race the screenshot.
- `failed.recoverable` is true only when a new private load session can safely
  retry. A retry key must reset the React error boundary and load session
  together. The current dogfood boundary never resets.
- Shared application loaders/caches remain application-owned. Retry or unmount
  must not abort/dispose resources another Canvas or route owns.
- Preload needs a lease or ownership rule. A bare global `preload(url)` cannot
  truthfully promise cancellation or cleanup, particularly under Strict Mode.

React Suspense cannot see asynchronous work started in an Effect; it only
coordinates cached Promises read during rendering. React also retries a tree
that suspended before first mount from scratch. That is why merely wrapping
the effect-started adapter in `<Suspense>` cannot create a Suspense loading
interface. Atomic visibility is nevertheless provided independently by private
preparation plus synchronous layout commit; Suspense remains future cache/UI
coordination work rather than the transaction mechanism.
([React Suspense](https://react.dev/reference/react/Suspense)) React development
Strict Mode runs an extra Effect setup/cleanup cycle, so every load session and
state subscription must tolerate that sequence.
([React `useEffect`](https://react.dev/reference/react/useEffect))

React error boundaries catch child render errors and can update application
state/presentation, but reset is still an application/interface concern.
([React Component error boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary))

## Safe prototype and dogfood plan

The smallest warranted prototype is:

1. Add an opt-in `browserSmoke.command` at the publish seam (Design 1), with an
   explicit skipped result when absent.
2. Configure the dogfood command to run only
   `e2e/blendlink-lab.spec.ts` against its production Next server.
3. Add one stable `data-blendlink-scene="workbenchDogfood"` marker to the
   existing application-owned root; keep its loading UI unchanged.
4. Extend the dogfood spec in isolated scenarios to capture page crash and CSP
   violations, and test:
   - current production success;
   - missing GLB (already present);
   - missing Basis JS/WASM or KTX2 companion;
   - a CSP with `worker-src 'self'` that blocks the exercised Blob-worker path;
   - the matching policy with explicit `blob:` that allows it;
   - WebGL-disabled fallback/error behavior.
5. Extract only the repeated, evidenced collection logic into a package-owned
   runner after those scenarios stabilize. That extraction becomes Design 3.

Do not add a generated temporary route, a default pixel threshold, or a claim
that local success proves CDN deployment. Do not make Playwright a required
runtime dependency for normal Blendlink consumers; resolve it only for the
opt-in smoke command/adapter and fail with installation guidance when missing.

## Acceptance evidence for the eventual module

Implemented behavior should be separated from verification in the report and
`FEATURE_PARITY.md`:

- **Implemented:** opt-in config/CLI, report schema, local/deployed adapters,
  process cleanup, failure categories, artifacts.
- **Verified:** dogfood production Next route, default GLB/KTX path, missing
  asset, blocked/allowed worker policy, zero-height fixture, WebGL failure,
  visual oracle, exact warning policy.
- **Prototype:** route marker/state vocabulary and performance evidence until
  another application or fixture exercises the same interface.
- **Future:** provider-specific post-deploy orchestration, authenticated
  storage-state handling, multi-browser/device matrix, complete lazy-state
  scenario generation, and budgets based on representative hardware.

The browser gate should be additive to the existing static artifact verifier,
not a replacement. Static verification can prove the complete declared graph
without requesting it; the browser proves that selected graph paths load and
render under real application policy. Both are necessary, and neither should
claim the other's evidence.

## Implementation and verification outcome (2026-07-21)

The safe prototype landed as `website.browserSmoke.command`, ordered after the
Final compile, application build, and second static artifact verification.
The R3F adapter now exposes the proposed attempt-scoped Loading, Preparing,
Ready, and Failed facts plus `retryKey`; the application still owns their
presentation and error-boundary reset.

The MichaelRoweJonesSite production route verifies its stable scene/status
marker, production asset requests, page/console/CSP evidence collection,
Canvas sizing, an application-authored visible-pixel oracle, phone layout, and
missing-GLB failure plus successful retry. The configured smoke command passed
from the publish transaction and the same Playwright file passed standalone.

The hero dogfood descriptor explicitly declares `requiresKtx2: false`, so the
specialized route now loads the retained required-KTX2 workbench descriptor
instead of blocking an unused Basis URL. The paired production fixture proves
real GLB/Basis requests, Blob-worker construction, enforced CSP failure with a
loud terminal error, and the identical allowed policy reaching Ready with
decoded compressed maps. Missing/corrupt Basis/KTX2, Meshopt decoder failure,
service workers, and deployed-origin categories remain future fixture work.
