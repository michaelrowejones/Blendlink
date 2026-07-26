# Runtime production polish: evidence and testable contracts

Date: 2026-07-21

Status: implemented research record with graded evidence. This note distinguishes code and unit contracts from one production Next/Chromium run. It does not generalize that run to WebKit, Firefox, mobile devices, deployed CDNs, or every decoder/CSP combination.

Evidence snapshot for this implementation pass:

- **Unit-verified:** 13/13 focused tests passed across scene presentation, Web
  Audio, pointer interaction, browser-smoke classification, and the R3F factory.
  Only the scene-presentation tests exercise presentation-state merging; the
  R3F factory test does not mount a Canvas or prove a frame.
- **Production-browser verified:** 8/8 Next/Chromium component and failure
  fixtures passed in one serial run. The exact command and covered cases are
  recorded in section 7.
- **Future/device-matrix:** Firefox, WebKit, real touch/pen/mobile autoplay,
  deployed CDN/service-worker paths, actual required-KTX2 CSP failure/success,
  and transparent WebGL restoration remain unproven.

## Scope and versions inspected

This pass covers the remaining production-facing polish around pointer input, Web Audio activation, decoder workers under CSP, WebGL failure, deployment bases, and Playwright instrumentation.

The dogfood application currently installs React 19.2.4, Next 16.2.6, Three 0.184.0 (r184), `@react-three/fiber` 9.6.1, `@react-three/drei` 10.7.7, and Playwright 1.60.0. Blendlink currently installs meshoptimizer 1.2.0. The current Next documentation is for 16.2.10, so framework claims below are limited to stable documented configuration behavior rather than patch-specific internals. Local installed source was inspected where behavior depends on Three or meshoptimizer implementation details.

Primary sources:

- [W3C Pointer Events Level 3 Recommendation](https://www.w3.org/TR/pointerevents3/)
- [Web Audio API 1.1](https://webaudio.github.io/web-audio-api/)
- [HTML user activation model](https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation)
- [Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)
- [Khronos WebGL 1.0 specification](https://registry.khronos.org/webgl/specs/latest/1.0/)
- [Three r184 `WebGLRenderer`](https://github.com/mrdoob/three.js/blob/r184/src/renderers/WebGLRenderer.js)
- [Three r184 `KTX2Loader`](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/KTX2Loader.js)
- [Three r184 `Audio`](https://github.com/mrdoob/three.js/blob/r184/src/audio/Audio.js) and [`AudioContext`](https://github.com/mrdoob/three.js/blob/r184/src/audio/AudioContext.js)
- [meshoptimizer decoder source](https://github.com/zeux/meshoptimizer/blob/master/js/meshopt_decoder.mjs)
- [Next `basePath`](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath) and [`assetPrefix`](https://nextjs.org/docs/app/api-reference/config/next-config-js/assetPrefix)
- [Vite `base`](https://vite.dev/config/shared-options.html#base), [public base path](https://vite.dev/guide/build.html#public-base-path), and [public directory](https://vite.dev/guide/assets.html#the-public-directory)
- [Playwright fixtures](https://playwright.dev/docs/test-fixtures), [browser contexts](https://playwright.dev/docs/browser-contexts), [`page.addInitScript`](https://playwright.dev/docs/api/class-page#page-add-init-script), and [service-worker network caveat](https://playwright.dev/docs/network#missing-network-events-and-service-workers)

## Conclusions

1. Blendlink's per-pointer down/up transaction is the implemented abstraction for virtual scene targets. It remains separate from browser DOM `click` targeting because every Three hit shares the same canvas DOM target. Native application controls use native links/buttons and `click`. Unit tests cover transaction edge cases; the production Chromium component lab proves real canvas click, drag suppression, hover, and native keyboard activation, but not touch, pen, or multi-touch.
2. The audio coordinator implements the required activation ordering: call `AudioContext.resume()` synchronously inside the trusted gesture, then start audio only after the context is actually `running`. Readiness follows `AudioContext.state` and `statechange`, is exposed through the installed scene and React presentation helper, and was exercised by a trusted Chromium canvas click. WebKit/mobile autoplay and interruption behavior remain device-matrix work.
3. Three r184's KTX2 loader uses Blob workers. A normal HTTPS policy that permits only `worker-src 'self'` is not sufficient for that worker mechanism; `blob:` must be explicitly permitted unless Blendlink later supplies a non-Blob strategy. The production fixture proves, with a real response header, that this Blob-worker prerequisite is blocked and classifiable. It deliberately does **not** prove that the fixture's otherwise-ready scene required KTX2 or that an actual KTX2 scene reached Blendlink's recoverable failure UI. Meshopt workers remain optional and can fall back to the main thread.
4. Three internally attempts context restoration, but Blendlink does not promise transparent in-place recovery. A production Chromium fixture now proves the chosen contract: forced loss becomes a loud application error and retry remounts the application-owned Canvas to a ready scene. Creation failure separately reaches an application-owned fallback. Cross-browser and complete GPU-resource restoration matrices remain future work.
5. `assetBaseUrl` is the correct explicit boundary. Next `assetPrefix` is not a public-asset base. Vite accepts relative bases (`./` and empty string), while Blendlink intentionally rejects them today. That is a current limitation to document and test, not silently describe as Vite-compatible.
6. `createBrowserSmokeEvidence()` now provides a stable package-owned classifier, while dogfood keeps Playwright instrumentation, route, Canvas, thresholds, and assertions application-owned. One production Chromium run passed the component lab plus base-path, Blob-worker CSP prerequisite, WebGL creation/loss, zero-size/empty-render, CORS, and retry fixtures. A reusable Playwright fixture is still optional future leverage rather than a prerequisite for the classifier.

## Current claims: implemented, verified, and future

| Area | Implemented in current worktree | Evidence already present | Not yet proven / future |
| --- | --- | --- | --- |
| Pointer activation | `threeInteractions.ts` tracks gestures by `pointerId`, captures when available, requires the same virtual target at down and up, suppresses movement beyond a threshold, and clears on `pointercancel` and `lostpointercapture`. | Unit tests cover activation, movement, cancellation, and lost capture. Production Chromium verifies projected canvas click, drag suppression, hover, semantic controls, and native keyboard activation. | Touch scrolling, pen, multi-touch, mobile capture loss, and WebKit/Firefox. |
| Touch ownership | Blendlink does not mutate the application canvas's `touch-action`. The dogfood overlay uses `touchAction: 'pan-y'`. | Code inspection only. | Mobile browser proof that vertical page scrolling remains owned by the site while scene taps work. |
| Accessible activation | Component installation exposes application-renderable immutable control records; DOM rendering remains application-owned. | Unit interaction tests plus production Chromium focus/Enter activation and an axe WCAG A/AA scan. | Screen-reader/manual assistive-technology and cross-browser evidence. |
| Web Audio | `threeAudio.ts` exposes `unavailable`, `blocked`, `ready`, and `failed`; calls `resume()` synchronously; observes `statechange`; and never closes the shared Three context. The presentation store subscribes without owning the enable-sound UI. | Unit tests simulate suspended/running ownership and state changes. Production Chromium verifies a drag does not play audio, a trusted canvas click does, and readiness is application-visible. | Keyboard audio unlock, WebKit/mobile autoplay denial, interruption, tab/background transitions, output-device failures, and retry UX. |
| Renderer presentation | R3F reports attempt-scoped `loading`, `bootstrap`, `full`, or `failed` quality separately from installation, then marks `presented` after its completed frame callback. The React/store adapter merges these facts without erasing newer evidence. | Store/unit contracts plus production Chromium assertions for a presented frame and non-pending full quality. | Pixel fidelity, display-compositor proof, WebXR, hidden-tab behavior, and browser/device matrix. |
| Worker CSP | Three KTX2 and meshoptimizer worker implementations are known from installed source. Blendlink's Meshopt setup falls back to the main thread if worker setup throws. | Unit/source inspection plus an actual restrictive response-header Chromium fixture proving a Blob worker is blocked and classified. | A required-KTX2 scene failure/recovery fixture, the matching `blob:` success fixture, and Meshopt fallback browser evidence. |
| WebGL failure | Preview and R3F surface renderer/context failures; the application owns retry/remount. | Unit/source inspection plus production Chromium creation-failure fallback and forced-loss -> error -> Canvas-remount -> ready. | WebKit/Firefox/device coverage and any future transparent in-place restoration claim. |
| Asset bases | Package-owned loaders can rebase the complete compiler-declared graph and Basis prefix through `assetBaseUrl`; app-owned loaders are required to supply their own policy. | Unit tests cover root and absolute CDN bases and reject relative bases. Current dogfood verifies root deployment. | Next sub-path, CDN, cross-origin CORS, and Vite relative-base behavior in packed production consumers. |
| Browser smoke | `createBrowserSmokeEvidence()` classifies declared-asset request/HTTP failure, console/page errors, worker CSP, decoder/CORS failure, zero-size Canvas, WebGL unavailable/lost, visibly empty output, and unexpected service-worker control. Dogfood supplies the application-owned instrumentation and thresholds. | Classifier unit tests plus one production Next/Chromium run: 8/8 component and failure fixtures passed. | Reusable fixture, service-worker projects, deployed CDN/origin, actual required-KTX2 CSP failure/success, and Firefox/WebKit/device matrices. |

## 1. Pointer input, capture, cancellation, and click

### What the platform guarantees

Pointer Events Level 3 says that a user agent suppressing a pointer stream dispatches `pointercancel`, then boundary events, and implicitly releases pointer capture. `pointerup` also implicitly releases capture. Direct-manipulation devices may receive implicit capture on `pointerdown`, and explicit capture overrides ordinary hit testing for subsequent pointer events.

`touch-action` is decided before the gesture. Changing it after panning or zooming has begun does not change that gesture. It is therefore application layout policy, not something a compiled scene should rewrite at runtime.

The platform's DOM `click` target is derived from pointer capture or from the nearest common inclusive ancestor of pointer down/up targets. That does not solve Three targeting: both virtual objects have the same DOM canvas target. Blendlink must perform a virtual down/up transaction itself.

Pointer Events do not cover keyboard input. The specification encourages high-level `click`, focus, and blur for equivalent functionality. Application-rendered native `<button>` and `<a>` controls are therefore the correct keyboard/assistive surface; the canvas interaction service should not synthesize a parallel keyboard model.

### Current design assessment

The current `createThreeInteractionServices()` implementation is aligned with those rules:

- state is keyed by `pointerId`, not one global down record;
- only primary-button activation begins a transaction;
- the same virtual target must win the raycast at pointer up;
- movement beyond the CSS-pixel threshold suppresses activation;
- `pointercancel` and `lostpointercapture` clear without activation;
- pointer capture is best-effort tracking, not a claim over scrolling;
- touch does not produce hover;
- Blendlink does not set `touch-action` on the site-owned canvas.

One nuance should remain explicit: `isPrimary === false` excludes secondary simultaneous touches. That is a deliberate single-activation policy, not universal multi-touch behavior.

Evidence is now two-tiered. Vitest exercises activation, movement, cancellation,
lost capture, focus, and disposal deterministically. The production Next/Chromium
component lab uses projected object positions and real Playwright pointer input:
dragging beyond the threshold does not play audio, a later click does, hover
enters/leaves, and an application-rendered native control activates from Enter.
This is browser evidence for mouse and keyboard paths only; it is not touch or
pen evidence.

### Testable invariants

- A primary pointer activates a scene action exactly once only when down and up resolve to the same virtual target and movement is within the threshold.
- `pointercancel`, `lostpointercapture`, disposal, or a different up target produces zero activation.
- Two pointer IDs never overwrite or finish each other's transaction.
- A touch drag that becomes vertical page scroll produces no scene activation, and the page still scrolls when the application declares `touch-action: pan-y`.
- Mouse and pen hover can enter/leave; touch never leaves authored hover stuck on.
- Native accessible controls invoke the same behavior callback as canvas activation, with modified link-click behavior left to the application's native element.

## 2. Web Audio activation and readiness

### What the platform guarantees

Web Audio's `resume()` returns a promise. If an `AudioContext` is not allowed to start, the promise may remain pending until it becomes allowed; it rejects when the context is closed. Successful resumption sets the control and rendering states to `running` and queues `statechange`.

`statechange` also represents suspend, interruption, closure, and some system audio failures. Web Audio 1.1 includes the `interrupted` state. A context interrupted while already suspended may not reveal the transition for privacy reasons. Consequently, a one-time successful `resume()` is not a permanent “audio ready” claim.

HTML's user-activation model is transient. Three r184's `Audio.play()` does not resume the shared `AudioContext`. Blendlink must make the gated `resume()` call synchronously in the trusted event callback, before awaiting unrelated work.

### Current design assessment

`createThreeAudioCoordinator()` follows this ordering and observes `statechange`. It distinguishes unavailable, blocked, ready, and failed, and it avoids closing a global/application-shared Three audio context during scene cleanup. These are appropriate package-level semantics without forcing a loading or permission UI.

`InstalledThreeCompiledScene.components.audio` exposes this control directly.
`createCompiledScenePresentationStore()` subscribes to its readiness, and
`useCompiledScenePresentation()` exposes the snapshot while leaving the
enable-sound button and trusted gesture to the website. The production Chromium
component fixture verified that a drag is suppressed and a later trusted canvas
click starts the authored audio. It did not verify keyboard audio unlock,
interruption, background-tab transitions, or mobile/WebKit autoplay policy.

The readiness labels should be interpreted precisely:

- `blocked`: a context exists but is not currently running; this includes suspended and interrupted states;
- `ready`: the context is currently running, not a promise that sound is audible;
- `failed`: an actual resume/action error or closed context;
- `unavailable`: this installed scene currently has no attached audio context.

### Testable invariants

- `resume()` is invoked synchronously inside trusted pointer and native keyboard `click` activation.
- Authored playback begins only after `context.state === 'running'`.
- A rejected resume produces a recoverable, application-readable failure; it is not swallowed and does not claim ready.
- `statechange` from running to suspended/interrupted changes readiness back to blocked; a later gesture can retry.
- Disposal removes listeners and leases but never closes an application/global Three audio context.
- Browser tests do not use synthetic `dispatchEvent()` as proof of user activation; they use Playwright's trusted click/tap/keyboard input.

The synchronous-resume ordering and readiness transitions are unit-verified.
Trusted mouse activation is production-Chromium verified. The remaining items
above are still browser/device-matrix requirements.

## 3. Installation, renderer presentation, and application state

The R3F adapter now reports two deliberately separate event streams:

- `onLoadStateChange` reports attempt-scoped transport/installation facts:
  Loading, Preparing, Ready, and recoverable Failed;
- `onPresentationStateChange` reports renderer evidence for the same attempt:
  `loading`, `bootstrap`, `full`, or `failed`, plus `presented`.

`bootstrap` means the installed scene has its complete atomic first-presentation
state. `full` means any tracked baked-atlas quality promotion settled and the
adapter invalidated again. Neither means a browser frame completed. The adapter
sets `presented` only after R3F's frame callback has run and a following
`requestAnimationFrame` callback is observed. This is stronger than installation
ready, but it is still not a screenshot oracle, a GPU-fence proof, or evidence
that the operating-system compositor displayed every result.

`createCompiledScenePresentationStore()` is the framework-neutral Module that
merges those attempt-scoped streams, semantic `accessibleControls`, baked
quality, Web Audio readiness, postprocessing ownership, and continuous-frame
policy. It ignores stale attempts and late promotion settlement. The optional
React Adapter, `useCompiledScenePresentation()` from `blendlink/react`, exposes
the same snapshot plus callbacks and reset without prescribing Suspense,
fallback, retry, DOM controls, or analytics. `blendlink/scene-presentation`
exposes the store without loading React.

Store transitions are unit-verified, including stale renderer/promotion
ordering. The production Chromium component lab passed assertions for Ready,
non-pending full quality, and `presented: true`, alongside a non-empty Canvas
pixel probe. Those remain distinct assertions: the presented flag alone does
not prove visible or correct pixels.

## 4. CSP and decoder workers

### Exact installed behavior

Three r184's `KTX2Loader` builds worker source in memory, creates `URL.createObjectURL(new Blob(...))`, and constructs `new Worker(blobUrl)`. This is a required part of KTX2 transcoding in that loader. Its disposal terminates the pool and revokes the URL.

The installed meshoptimizer decoder's `useWorkers()` similarly creates a Blob URL and `Worker` instances. Blendlink only enables this optimization above its threshold and catches worker-setup failure, emitting a warning before using the decoder on the main thread. KTX2 and Meshopt therefore have different truthful failure contracts: KTX2 worker failure can make a required asset unavailable; Meshopt worker failure can be a measured degradation.

CSP3 defines `worker-src` for Worker, SharedWorker, and ServiceWorker creation. If absent, the fallback chain is `child-src`, then `script-src`, then `default-src`. A normal HTTPS `'self'` source does not by itself authorize a `blob:` worker URL; the Blob scheme must be allowed explicitly. The minimal worker addition for Three's default implementation is therefore `worker-src 'self' blob:` plus whatever other origins the application needs. This is not a complete site CSP recommendation.

`securitypolicyviolation` can target a Document or worker global as appropriate. A listener installed on the document before application scripts is useful evidence, but it is not a universal worker-global observer. Smoke tests must also inspect runtime failures, console/page errors, worker events, network results, and visual output.

### Product boundary

Blendlink should publish decoder requirements and failures; the website owns its response headers. Blendlink must not weaken or inject the site's CSP. If an application chooses a CSP without `blob:`, a future package-owned alternative would need a static same-origin worker entry and proof against the installed decoder versions. Until then, failure must be explicit.

### Testable invariants

- A strict-CSP smoke serves an actual response header, not only a meta tag or mocked console message. **Verified in production Chromium.**
- With `worker-src 'self'` and no `blob:`, a real Blob worker is blocked and the classifier records both the CSP-worker prerequisite and the separately supplied decoder failure evidence. **Verified in production Chromium.**
- With a required KTX2 asset and `worker-src 'self'` (no `blob:`), the scene reaches an artist-readable recoverable error and never reports ready or leaves a blank canvas.
- With `worker-src 'self' blob:`, the same KTX2 scene loads and renders visible pixels with no CSP violation.
- If Meshopt Blob workers are blocked, Blendlink emits exactly the documented fallback warning, decodes successfully on the main thread, and does not report worker cancellation or off-thread decoding that did not occur.
- Every worker pool and Blob URL owned by a disposed installation is terminated/revoked by its owning loader; shared application loaders are not disposed by Blendlink.

The current restrictive-CSP route deliberately loads its scene successfully and
then probes the Blob-worker prerequisite. It must not be cited as evidence that
an actual KTX2-required scene failed, or that every KTX2 scene needs an
application CSP change. Those two KTX2 scene cases remain future fixtures.

## 5. WebGL creation failure and context loss

### What the platform and Three guarantee

WebGL fires `webglcontextcreationerror` when context creation fails and may return `null` from `getContext()`. Its `statusMessage` is platform-dependent diagnostic text.

On `webglcontextlost`, all WebGL objects become invalid and extensions are disabled except the loss extension. Restoration is attempted only if the loss event is canceled. After `webglcontextrestored`, previous textures, buffers, and extensions are not restored as usable application resources; the application must restore state and resources.

Three r184's `WebGLRenderer` installs lost, restored, and creation-error listeners. It calls `preventDefault()` on loss and recreates internal WebGL subsystems on restoration while preserving selected renderer settings. That is valuable, but it is not sufficient evidence that Blendlink's externally owned scene resources, generated textures, postprocessing pipeline, reflection probes, loaders, audio/components, and R3F lifecycle all recover.

### Recommended contract

Compare two designs:

1. **Transparent in-place restore.** Preserve the Canvas and installation and rely on Three plus component-specific restore hooks. This offers the smoothest UX but requires proof for every GPU resource owner and every installed component.
2. **Explicit failure and full remount.** Surface a recoverable runtime error, let the application render its own fallback/retry UI, dispose the installation, and recreate the application-owned Canvas/renderer/scene transaction. This is simpler, honest, and restores from CPU/source assets rather than assuming old GPU objects survived.

Design 2 is now the implemented first production contract. In production
Chromium, forced `WEBGL_lose_context` moved the application to an artist-readable
error, and its Retry action remounted the application-owned Canvas and returned
to ready. A separate creation-failure fixture reached the site's visible WebGL
fallback. Keep design 1 as a prototype until a much broader browser/resource
matrix proves it; no transparent restoration claim is made.

### Testable invariants

- Renderer creation failure produces application-readable error state with the browser's available diagnostic; no “ready” event fires.
- Forced loss via `WEBGL_lose_context` leaves the old installation non-ready and never continues analytics/interaction as if rendering were healthy.
- Retry creates a new renderer and installation, reloads or rehydrates resources, and reaches the visible-pixel threshold.
- If restoration is later claimed, tests must cover KTX2 textures, baked atlases, probes, postprocessing, animation, authored state changes, and interaction after restore—not only a clear color.
- Context-failure tests run in a dedicated project because SwiftShader, browser flags, and `WEBGL_lose_context` availability differ from the primary production project.

## 6. Next, Vite, CDN, and base-path addressing

### Framework facts

Next's `basePath` is a build-time sub-path and is inlined into client bundles. Next links/router apply it automatically, but public/image-like URLs need an explicit prefix. Next documents `basePath` as the sub-path mechanism.

Next's `assetPrefix` targets framework chunks under `/_next/static`. It does not rewrite files in `public`. Blendlink must never infer a scene asset root from `assetPrefix`.

Vite's `base` accepts a root path, full URL, empty string, or `./`. Vite rewrites statically known asset references; dynamic construction uses the exact `import.meta.env.BASE_URL`. Public-directory files are copied as-is and referenced from the root. Blendlink's current resolver supports origin-root paths and absolute HTTP(S) CDN URLs but rejects relative bases. Its suggestion to pass `import.meta.env.BASE_URL` is therefore only correct when that value is root-based or absolute.

### Recommended contract

Keep `assetBaseUrl` explicit and package-owned-loader-only. It rebases the compiler-declared graph plus the Basis prefix, while application-owned loaders/managers remain responsible for their own URL modifier, headers, credentials, and CORS policy.

For Vite relative deployments, compare two designs:

1. Resolve a relative base against `document.baseURI` in the application before passing it to Blendlink.
2. Extend Blendlink's resolver to accept relative bases with a required resolution URL/environment.

Design 1 is the smallest current integration and keeps document-route policy application-owned. Design 2 is more ergonomic but should not be implemented until semantics for nested routes, static embeds, SSR, and URL serialization are tested. Until then, relative Vite bases are a loud documented limitation.

### Testable invariants

- Packed consumers build and load under `/`, a non-root path such as `/portfolio/`, and an absolute cross-origin CDN base.
- The complete compiler-declared graph—GLB, atlas variants, HDR/EXR/KTX2, probes, manifests/companions, and Basis decoder assets—resolves beneath the selected base. No raw `/models/...` escape remains.
- Next sub-path proof uses a production build with `basePath`, not a dev-server rewrite. `assetPrefix` is tested separately and is never treated as the public-scene base.
- Cross-origin assets verify CORS with the real fetch/worker/texture request modes and fail loudly when headers are absent.
- Vite tests include `/gallery/` and either prove `./`/empty-base support or assert the exact actionable rejection. Documentation must match the chosen behavior.

## 7. Browser evidence classifier and application-owned production fixtures

### Current evidence

The package now exports `createBrowserSmokeEvidence()` from
`blendlink/browser-smoke`. It is deliberately a classifier, not a route or
Playwright owner. Applications record evidence for compiler-declared asset
responses/failures, console/page errors, worker CSP, decoder and CORS failures,
Canvas geometry/WebGL/visible pixels, and service-worker policy; the classifier
deduplicates issues and provides one loud `assertHealthy()` failure.

The dogfood application supplies the production instrumentation and policy. Its
component smoke waits for the application-owned status, captures page errors,
crashes, console output and scene responses, checks Canvas bounds and pixels,
exercises semantic controls, animation, hover and audio, runs axe, and verifies
failure/retry. Its failure suite adds an explicit base path, restrictive
response-header CSP Blob-worker prerequisite, WebGL loss/remount and creation
failure, zero-size/empty-render evidence, and a real auxiliary cross-origin
response without ACAO.

One production Next/Chromium command passed all eight component/failure cases:
`npx playwright test e2e/blendlink-production-failures.spec.ts e2e/blendlink-components-lab.spec.ts --workers=1`.
That is not Firefox, WebKit, mobile, deployed-origin, service-worker, or actual
required-KTX2 failure/success evidence.

Playwright gives every test its own isolated BrowserContext and default Page. A reusable fixture should extend the application's existing `test`, instrument that page/context, and return collected evidence. It should not quietly create a second context, because doing so can lose configured base URL, storage, proxy, permissions, service-worker, browser-channel, and teardown behavior.

Network routing/events can miss requests served by Service Workers. A deterministic asset-completeness project should use `serviceWorkers: 'block'`, or explicitly declare that it is testing the application's Service Worker path. The ordinary production project may keep the application's real service-worker policy.

### Implemented small interface

The classifier accepts only evidence facts and two optional application policies:

- `declaredAssetUrls`: optional output of `compiledSceneAssetUrls(descriptor)`
  after application base resolution, so unrelated website requests are not
  mislabeled scene failures;
- `minimumVisiblePixelFraction`: an application-chosen threshold; Blendlink does
  not invent a universal pixel oracle.

The application records events and retains navigation, server/context,
instrumentation timing, console allowlists, screenshots, exercise actions, and
final assertions. A future `createBlendlinkSmokeFixture()` may reduce repeated
Playwright wiring, but it should extend the application's existing `test` and
consume its `page`/`context` rather than create a second hidden browser context.

### Testable invariants

- Instrumentation is registered before `goto`; document CSP monitoring uses `addInitScript`.
- The fixture extends the supplied Playwright `test` and consumes its existing `page` and `context` fixtures.
- An expected asset is counted successful only after a response below 400, not merely a request event. Lazy assets are required only after the application's `exercise()` has selected the relevant state/quality path.
- `serviceWorkers: 'block'` is explicit in deterministic network projects; real-Service-Worker coverage is a separate project.
- Installation `ready`, renderer `presented`, and visible-pixel evidence remain
  separate facts. Production Chromium verifies all three for the component lab;
  `presented` is not a pixel-fidelity or display-compositor oracle.
- Creation failure, context loss/remount, Blob-worker CSP rejection, CORS denial,
  zero-size/empty output, missing GLB, and retry have dedicated Chromium cases.
  Actual required-KTX2 CSP failure/success, missing companions, deployed CDN,
  and cross-browser/device behavior remain future cases.

## Prioritized remaining polish

1. **Extend input/audio verification beyond desktop Chromium.** Add trusted touch,
   pen, keyboard-audio, WebKit/mobile autoplay, interruption, and background-tab
   cases while retaining application ownership of `touch-action` and DOM.
2. **Add actual decoder/CSP scene projects.** Keep the verified Blob-worker
   prerequisite distinct from a required-KTX2 failure, the matching `blob:`
   success, and Meshopt's truthful main-thread fallback.
3. **Add service-worker and deployed-origin projects.** Cover complete declared
   assets, absolute CDN/CORS, Next sub-path deployment, and Vite relative-base
   limitations rather than generalizing the local auxiliary CORS fixture.
4. **Broaden WebGL failure evidence.** Run Firefox/WebKit/device matrices and
   keep application remount as the contract; do not claim transparent restore.
5. **Extract a reusable Playwright fixture only if repeated application wiring
   warrants it.** The implemented classifier is already package-owned and does
   not require Blendlink to own a route or browser context.

These steps stay inside Blendlink's product boundary: the package owns compiler/runtime complexity and exposes evidence; the website retains its route, Canvas, layout, loading UI, analytics, headers, framework, deployment, and final smoke assertions.
