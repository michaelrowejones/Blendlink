# R3F lifecycle, loading, cancellation, and scene ownership

Date: 2026-07-24

## Production atomic-activation update (2026-07-24)

Blendlink now uses the two-phase architecture selected by this research in its
production Three and R3F paths:

- `startThreeCompiledScenePreparation()` and
  `prepareLoadedThreeCompiledScene()` load and configure an exclusively owned
  GLTF root on a private `THREE.Scene`. Baked state, environment, look, fog,
  shadows, camera/controls, reflection work, Components, texture preparation,
  and `compileAsync(root, camera, stagingScene)` complete without attaching the
  root or changing the application Scene's presentation policy;
- `PreparedThreeCompiledScene.commit()` applies the complete reversible
  presentation journal synchronously. `createR3FCompiledScene()` performs that
  commit from a layout effect, swaps the R3F camera through a host lease, and
  requests one application-owned frame. Failed activation rolls back in
  reverse order; stale generations cannot commit;
- renderer sizing remains application-owned. Frame requests produced while
  preparing are buffered, and Component/camera/composer/audio/contact-shadow
  live integration is deferred until activation;
- a marked advanced adapter created with `defineThreeComponentAdapter()` may
  allocate or mutate only detached state in its factory. Its synchronous
  `activate(scene, camera)` receives the committed Scene/camera. Unmarked
  custom adapters, parented/shared GLTF roots, and application-owned
  interaction/accessibility services that cannot prove staging safety fail
  loudly instead of weakening the atomic contract;
- cancellation is generation-safe and invokes an owned private
  `LoadingManager` when available. Non-abortable decode, transcode, or
  `compileAsync` work may still settle late; its detached resources remain
  alive until settlement and the stale candidate is then disposed. This is
  truthful commit cancellation, not a claim that every browser worker or GPU
  operation stopped immediately.

The production-source Chromium differential now has four cells under an
always-rendering priority-2 application renderer. The current 2026-07-24 run
recorded partial frames `5 / 9 / 0 / 0` for live mutation, root-only hiding,
detached control, and the real `createR3FCompiledScene()` path. The production
cell preserved 18 baseline frames through delayed custom preparation and real
`WebGLRenderer.compileAsync`, then presented 28 ready frames with zero partial
red pixels, two detached checks, zero live-world preparation leaks, and one
synchronous activation whose committed Scene and camera identities both
matched. It ran in Chrome 150 through ANGLE SwiftShader with a
synthetic loader/basic material; network GLB, KTX/HDR/EXR, postprocessing,
physical-GPU, and cross-browser pixels remain separate evidence work.

Unit evidence now includes 15 coordinator cases, five atomic Three cases, and
the wider lifecycle suites. Dogfooding found one real scene-level activation
regression: Contact Shadows initially retained its private preparation Scene.
The deep adapter now transfers its auto-fit helper and capture pass to the
committed Scene/camera synchronously; focused module/component tests and the
production 21-component browser lab verify the fix.

The public MichaelRoweJonesSite dogfood also now carries Blendlink's real
attempt identity through its site-specific lamp preparation and keeps its
application-owned painter Canvas at `frameloop="never"` while a deliberately
stalled GLB is loading. A production Playwright differential observes no
scene-intro or renderer draw-count evidence during that interval, then verifies
the same attempt reaches Ready and the authored intro completes. This is a
developer-integration/performance improvement while preserving the website's
Canvas ownership; it does not redefine a package-wide guarantee that arbitrary
applications perform no frames while loading.

There is still no shared, reference-counted render-time Suspense/preload cache.
The public prepared handle is an advanced one-attempt renderer-bound lease, not
a reusable Suspense resource, and `compileAsync` remains shader preparation
rather than a complete GPU-ready or presented-frame barrier.

## Previous implementation update (2026-07-23)

This section records the intermediate state that led to the production
transaction. The 2026-07-24 update above is authoritative where they differ.

- one private `LoadingManager` is now shared across package-owned GLTF, KTX2,
  HDR/EXR, probe, baked-texture, audio, and LUT loading; its observable counts
  feed attempt-scoped Loading/Preparing/Ready/Failed state;
- canceling an owned attempt calls `LoadingManager.abort()` for manager-backed
  browser requests, prevents late Ready publication, and disposes late results;
  application-owned managers/loaders deliberately retain cancellation/cache
  ownership. Focused `threeRuntime.test.ts` spies now prove that repeated
  cancellation invokes the private attempt manager exactly once and never
  invokes an application-owned manager. A registered r184 differential also
  proves that Three's URL-only in-flight `FileLoader` coalescing crosses manager
  boundaries, so this direct ownership does not imply request isolation;
- Strict Mode attempts are serialized per Canvas and obsolete generations are
  abandoned; exactly one compiled scene owns global Canvas presentation. A
  mounted custom-R3F-root test now drives the retained-instance Effect
  cleanup/setup sequence over a delayed application load and proves sequential
  work, stale-root rejection, attempt-scoped progress, and one Ready commit;
- the R3F adapter exposes renderer presentation separately from transport,
  including Bootstrap/Full/Failed quality and first-completed-frame evidence;
- a positive-priority frame gate now suppresses Fiber's default presentation
  render while an attempt is preparing, including delayed `compileAsync` and a
  retry. The loaded root is already attached at that point. Another
  positive-priority subscriber or application composer can still render the
  live world, so this is not detached preparation or a universal atomic
  visibility barrier;
- a real ReactDOM/Chromium prototype compared that gate, a hidden-root gate,
  and detached preparation under an always-rendering higher-priority site
  subscriber. Live mutation and root hiding both exposed nonzero partial
  frames, while detached preparation plus one synchronous commit exposed 0.
  The exact positive-control frame count is scheduler-dependent; its required
  signal is `> 0`. Detached prepare/commit is therefore the
  selected production direction, but remains a prototype until global policy
  adapters are split into prepare and activate phases;
- a renderer-neutral `createSceneInstallationCoordinator()` foundation now
  implements the internal transaction selected by that prototype: one newest
  generation, cooperative abort, late-result invalidation, preparation-owned
  resources, staged reversible mutations, synchronous exact-once commit,
  reverse rollback, caller-owned committed leases, and structured cleanup
  failures. Fifteen focused cases cover receiver binding, asynchronous-callback
  rejection, late ownership, abort cleanup observation through commit/dispose/
  replacement, reentrant replacement, and idempotent teardown. This is shipped
  infrastructure, not production atomic R3F: `threeRuntime.ts` and
  `reactThreeFiber.ts` do not consume it yet;
- installed scenes now expose a bounded renderer-neutral animation transport
  through the ready-only R3F handle. Manual clips can play, pause, seek in
  authored seconds, stop/replay, or start all deterministically without
  transferring mixer/disposal ownership. The transport owns its phase instead
  of inferring from `AnimationAction.isRunning()`. That fixes a real
  demand-mode correctness hole for NLA: its actions are intentionally paused
  while Blendlink samples exact strip time, so action-level liveness used to
  misclassify a running sequence as idle. Focused package/Three tests are green;
  a production-dist ReactDOM/R3F 9.6.1/Three 0.184 Chromium gate now proves the
  actual demand-frame behavior. It also found a first-frame handoff race: the
  Ready invalidation could be consumed while the positive-priority gate still
  blocked Fiber. The adapter now invalidates once more after committed Ready
  state removes the gate, and the fixture sees one nonblank static Manual frame
  before any application command;
- the same fixture observed two Effect setups at the ReactDOM Strict root but
  only one R3F scene Effect setup. Installed R3F 9.6.1 creates its reconciler
  container with root strictness disabled, and React does not replay initial
  Effects for a nested-only Strict subtree. Generation safety remains required
  for retries, route/key changes, and future renderer behavior;
- generic installation errors now publish `recoverable: false`. The package
  cannot infer retry safety from an unstructured Error that might represent a
  deterministic schema, CSP, capability, or authoring problem. `retryKey`
  remains available after the application or external state changes;
- a real production Chromium test exposed Three r184 WorkerPool leaving its
  KTX2 promise pending after CSP asynchronously blocks a Blob worker. During a
  package-owned KTX2 load, Blendlink now observes only enforced Blob
  `worker-src`/fallback violations, aborts the private graph, disposes the
  loader, and emits an actionable terminal failure. The identical allowed route
  reaches Ready with decoded `CompressedTexture` maps.

Detached full-scene preparation and synchronous commit are now production
behavior. Cross-browser and broad cancellation evidence remain future work.
`manager.abort()` still does not truthfully mean that arbitrary application
loaders or every worker-side compute task stopped immediately; the detailed
source analysis below remains the boundary for those claims.

The mounted replay fixture deliberately does not claim that a custom R3F root
enables React's development Strict Effects flag: it drives the same retained
component Effect cleanup/setup transition through `retryKey`. The isolated
ReactDOM `<StrictMode>` root observes two setups, while the installed R3F
subtree observes one. The fourth differential cell now executes the production
two-phase adapter; its synthetic limits are stated above.

```text
npm run prototype:r3f-atomic-presentation
BLENDLINK_R3F_ATOMIC_PRESENTATION_PROTOTYPE_PASSED
  livePartial=5 hiddenPartial=10 detachedPartial=0 productionPartial=0
  reactDomStrictSetups=2 r3fEffectSetups=1

npm run test:r3f-animation-transport-browser
BLENDLINK_R3F_ANIMATION_TRANSPORT_BROWSER_PASSED
  manualPlayRenders=15 pauseExtraRenders=0
  seekPixelDelta=207.0 sequenceRenders=128 sequenceAfterFinish=0
```

Likewise, "private manager abort" means Blendlink invokes only its private
manager. Three r184 can attach same-URL consumers from other managers to the
first request. If the application initiated that request, Blendlink cannot
abort it; if Blendlink initiated it, private cancellation also rejects the
coalesced application subscriber. The focused two-order differential in
`threeRuntime.test.ts` preserves this limit against Three upgrades.

There is still no shared production preload API and no render-time Suspense
resource. The transaction and its advanced one-attempt prepared lease are
shipped, but the reference-counted shared-cache interfaces later in this note
remain designs. `useGLTF.preload`, Drei `<Preload>`, a completed download, and
`compileAsync` remain deliberately insufficient as GPU-ready claims.

## Scope and version evidence

This note audits the current Blendlink React Three Fiber adapter against the
deeper lifecycle questions left open in
`research-preview-to-website-2026.md`. It is deliberately limited to runtime
lifecycle and does not propose that Blendlink own the application's Canvas,
route, loading presentation, or deployment.

The source inspection used the versions actually installed in the two working
trees:

- Blendlink: React 19.0.0, `@react-three/fiber` 9.6.1, Three 0.184.0.
- MichaelRoweJonesSite: React 19.2.4, `@react-three/fiber` 9.6.1,
  `@react-three/drei` 10.7.7, Three 0.184.0.

The React minor mismatch is worth retaining as test evidence: the package's
declared React 19 peer range is correct, but Blendlink's own R3F lifecycle tests
currently exercise 19.0.0 rather than the dogfood site's 19.2.4. Primary
sources below are official documentation and the exact tagged library source,
not assumptions based on older releases.

## Executive conclusion

The current adapter now has an atomic presentation transaction and
generation-safe cancellation at the right ownership seam:
`createR3FCompiledScene()` leaves Canvas, route, layout, loading UI, and
deployment with the website while Blendlink concentrates loader, renderer,
camera, Component, and cleanup knowledge. Cancellation of underlying work is
bounded by the loader/browser operation; cancellation of stale commit is
guaranteed.

The high-confidence architecture is a two-phase internal module:

1. **Prepare** a private scene generation: load and decode owned resources,
   establish the baked default, construct environment/probes/components,
   prepare known textures and render targets, and run `compileAsync` against a
   detached or staging scene. No active Canvas globals may change in this
   phase.
2. **Commit** the prepared generation synchronously in a layout effect: claim
   the Canvas owner slot, attach the root, apply the renderer/Scene snapshot,
   hand off the camera and render priority, activate inputs/audio, and request
   one frame. If any prerequisite failed or the generation was canceled,
   commit is impossible.

Suspense may gate a cached **prepare promise**, but it is not itself the atomic
mechanism. The promise must be cached outside the rendering component, and its
ownership rules must be explicit. An effect-started fetch does not suspend.
Likewise, `useGLTF.preload`, Drei `<Preload>`, and Three `compileAsync` are each
only partial barriers; none means "every byte, decoder, texture, shader,
post-process target, and first visible frame is GPU-ready."

Cancellation must be described as two separate guarantees:

- **Commit cancellation:** after unmount/replace, the obsolete generation will
  never become the active scene. Blendlink can and should guarantee this.
- **Work cancellation:** manager-backed fetches can be aborted when Blendlink
  owns a private Three r184 `LoadingManager` and the runtime supports
  `AbortSignal.any()`. Image-element loads, already-running CPU decodes,
  KTX2/Meshopt worker jobs, audio decode, and shader compilation are not all
  covered. They require generation gates and eventual cleanup even after an
  abort request.

Keep the current one-compiled-scene-per-Canvas product contract. The
prepare/commit split now makes a later sequential A-to-B coordinator feasible
without recreating Canvas, but that coordinator does not exist yet. Concurrent
active scenes and crossfades would require two scene/global-render pipelines,
which is a materially larger engine feature.

## Original audit matrix (2026-07-21 baseline)

This table records the state that motivated the implementation work. The
dated implementation update above is authoritative where a row has since
changed.

| Area | Implemented now | Verified now | Gap / exact conclusion |
| --- | --- | --- | --- |
| Application ownership | Generated binding is tiny; host owns Canvas, route, and fallback | Project setup tests assert no lifecycle implementation is generated; packed R3F consumer builds existed at the prior aggregate gate | Correct seam; retain it |
| Suspense | None in the adapter; installation begins in `useEffect` and the component returns `null` | The sole adapter unit test only proves factory creation has no eager load | Effect work cannot activate Suspense; no atomic reveal barrier |
| Baked default | `baked.ready` is awaited and `baked.prepare(renderer)` uploads contributing baked textures before root attachment | Three runtime tests prove a missing default atlas rejects before root attachment | Strong local invariant, but environment, probes, components, camera, and shader preparation happen later |
| Scene attachment | Root attaches after baked readiness | Three runtime tests cover final attachment and rollback | Root attaches before environment, look, fog, controls, playback, probes, components, and `compileAsync` finish, so installation is observably partial |
| Shader/texture preparation | Baked textures use `initTexture`; installer invokes `compileAsync` when present | Generated baked-recipe tests cover texture preparation; Preview Studio has real-browser compilation evidence; R3F adapter tests do not | `compileAsync` prepares shaders, not every texture or composer target; no R3F browser assertion establishes a no-pop first frame |
| Late unmount | Promise completion checks a `cancelled` flag and disposes the late installed value | Not directly mounted/unmounted in the adapter test | This prevents a late camera handoff only after the complete promise resolves; it does not stop in-flight work or interim world mutations |
| Strict Mode | Cleanup deletes the WeakMap owner and marks the first effect canceled | Not tested under React Strict Mode | Development setup/cleanup/setup starts two installations. The obsolete first installation can still mutate the same world while the second runs |
| Loader ownership | One-call installer may own GLTF/KTX2; callers may inject GLTF, KTX2, audio, LUT, probe adapters | Unit coverage exists for owned KTX2 disposal, Meshopt leases, private GLTF resource disposal, and application-owned loaded resources | Created GLTF, HDR/EXR, probe, texture, audio, and LUT loaders do not share one private manager; there is no abort interface or unified progress |
| Error handling | Promise rejection becomes state, then is thrown during render | Only factory creation is tested | A React Error Boundary can catch the later render throw. Suspense cannot. Frame/event/other async errors are not generally caught by Error Boundaries and need an explicit status/failure channel |
| Render loop | `useFrame` updates all systems; composer uses positive priority; demand mode invalidates only while the installed scene's conservative live signal requires another frame | Focused tests plus production-dist ReactDOM/R3F/Chromium gates prove Manual play/pause/seek/stop/replay, a bounded NLA whose internally paused actions animate then settle, and built-in Orbit waking from a native pointer event, following Three's damping activity, then returning to a flat render count | The verified animation and built-in Orbit subsets become genuinely idle. Free controls, LOD presence, active Components, and unknown custom work remain conservatively continuous and still need the wider mounted matrix |
| Render-owner handoff | `installed.current` is assigned, camera is set, `ownsRendering` state is updated, then invalidated; a post-commit effect invalidates again once the presentation gate is gone | Browser evidence found and fixed the static-scene race: the first invalidate could be consumed behind the gate; the strengthened fixture now records one nonblank initial Manual render before interaction | The initial static direct-render path is verified. A composer scene still has a theoretical direct-render frame before positive-priority subscription commits and belongs in the atomic detached-activation gate |
| Canvas ownership | WeakMap rejects a second mounted compiled scene | Source-level only; no mounted two-scene test | Clear contract, but the slot is released at unmount while obsolete asynchronous installation may still be mutating the Canvas |
| Retry/progress/preload | `onReady` only | Not present | Application has no stable ready/progress/failure/retry/preload interface |

## What Suspense and preload actually guarantee

React Suspense only waits for work read during render through a Suspense-enabled
source. It explicitly does not detect data fetched in an Effect. React also
retries an initially suspended tree from scratch, so a promise passed to
`use()` must be cached and reused across renders. Rejections go to the nearest
Error Boundary, not the Suspense fallback. Sources: [React Suspense](https://react.dev/reference/react/Suspense),
[React `use`](https://react.dev/reference/react/use), and
[React Error Boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary).

React's `cache()` is not the client solution here: it is for Server Components.
The official client example uses a module-level promise cache or a framework
cache. Source: [React `cache`](https://react.dev/reference/react/cache).

R3F 9.6.1 `useLoader` uses `suspend-react`. It memoizes one loader per loader
constructor, and keys the result by loader identity plus URLs. `preload()`
starts the same cached load; `clear()` removes that cache entry. The extension
callback is not part of the cache key. Neither `clear()` nor component unmount
disposes Three resources. The R3F documentation therefore warns callers not to
mutate or dispose cached assets casually. Sources: [R3F loader documentation](https://r3f.docs.pmnd.rs/api/hooks#useloader)
and [R3F 9.6.1 loader source](https://github.com/pmndrs/react-three-fiber/blob/v9.6.1/packages/fiber/src/core/hooks.tsx).

Consequences for Blendlink:

- `useGLTF.preload(url)` proves only that the cached Three load/parse promise
  ran. It does not establish the baked state, environment, probes, components,
  camera, post-processing, texture uploads, or shader readiness.
- Reusing R3F's constructor-global loader is unsafe as the primary Blendlink
  seam when the same URL may be requested with different managers, URL
  modifiers, headers, credentials, KTX2 paths, or component adapters. Those
  settings are not all cache keys.
- A cached GLTF scene is mutable. Blendlink patches materials, visibility,
  cameras, controls, probes, and ownership metadata. A shared cached scene
  cannot be treated as a private disposable install. Either cache immutable
  bytes and parse per installed generation, or define explicit shared-resource
  ownership and clone every mutable layer correctly. The former has clearer
  locality.
- `preload()` should state its level: `network`/`decoded` is truthful outside a
  Canvas; `prepared` requires the actual renderer and its capabilities.

Drei 10.7.7 `<Preload>` runs `gl.compile()` in a layout effect and then renders
the current scene through a cube camera. It temporarily reveals objects whose
`visible` flag is false, but it neither awaits `compileAsync` nor exposes a
completion promise. It is not a network/decode Suspense source and not a
general first-frame barrier. Source: [Drei 10.7.7 Preload source](https://github.com/pmndrs/drei/blob/v10.7.7/src/core/Preload.tsx).

## GPU readiness: use precise language

Three r184 documents `initTexture()` as a way to preload a texture and avoid
first-render decode/upload lag. `compileAsync()` waits until the materials it
compiled can render without unnecessary shader-compilation stalls, using
`KHR_parallel_shader_compile` when available. It also requires the target
scene's lighting and environment to be configured first. Source:
[Three WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).

The r184 source makes the separation concrete: `compileAsync()` calls
`compile()`, which traverses renderable objects and prepares material programs;
then it polls those programs for readiness. It does not promise to traverse
arbitrary shader uniform textures, upload every texture, initialize every
EffectComposer render target/pass, finish PMREM generation, or render a valid
visible pixel. Source: [Three r184 WebGLRenderer source](https://github.com/mrdoob/three.js/blob/r184/src/renderers/WebGLRenderer.js).

Blendlink should therefore call the internal barrier **prepared**, not
**GPU-ready**. A prepared generation means:

1. all declared asset promises settled;
2. all artist policies and components were constructed against staging state;
3. known textures that can contribute to the first frame received
   `initTexture()`;
4. subsystem-owned render targets were explicitly initialized where their
   library permits it;
5. `compileAsync(root, camera, targetScene)` settled after target lighting and
   environment were established; and
6. no failure occurred.

Only a browser render/visual smoke test can prove that an actual first frame is
non-empty and acceptable. Avoid `gl.finish()` as a product-level promise: it
would turn preparation into a global GPU stall and still would not prove visual
correctness.

## Safe staged mutation and atomic commit

The current runtime already has valuable rollback locality: cleanups register
in installation order and execute in reverse, while several global policies
restore only if a later owner has not replaced them. Preserve that machinery,
but move all asynchronous work before the active-world commit.

Recommended internal state machine:

```text
idle -> preparing -> prepared -> committing -> ready -> disposed
              |          |            |
              +------> failed <--------+
              +------> canceled
```

Preparation should use a private/staging `THREE.Scene` and a private mutable
root. Renderer-global changes such as tone mapping, shadow policy, and active
composer ownership must be calculated as plans/snapshots but not applied to
the host yet. Inputs, autoplay audio, and navigation handlers should be armed
only at commit. Runtime reflection capture should render the staging scene,
not require an early attachment to the host scene.

The commit must be synchronous and reversible. In one layout-effect turn it
must:

1. validate that the generation still owns its attempt and the Canvas slot;
2. install renderer and host-Scene policy snapshots;
3. attach the prepared root and any grounded background;
4. switch the active camera and render owner together;
5. activate event/audio hooks;
6. publish `ready`; and
7. invalidate exactly one initial frame.

If a synchronous commit step fails, reverse the complete commit. Do not leave a
"mostly ready" handle. Preparation failure must never touch the active world.

An incremental prototype can first prove this with GLB + baked state + HDR +
camera + one post effect before migrating every component. Until that proof
exists, a simpler visibility gate may reduce pops but must not be described as
atomic: hiding only the root still allows environment, fog, renderer look, and
composer changes to affect the host scene during awaits.

## Strict Mode and error boundaries

React Strict Mode performs an extra development-only setup/cleanup/setup cycle
for Effects. React's stated requirement is that cleanup make that sequence
indistinguishable from one setup. Sources: [React StrictMode](https://react.dev/reference/react/StrictMode)
and [React `useEffect`](https://react.dev/reference/react/useEffect).

Today the first Blendlink setup keeps running after its cleanup. It can attach
its root and mutate world globals while the second setup is in flight; only
after its entire promise resolves does the adapter dispose it. The WeakMap does
not prevent this because cleanup immediately releases the owner key. This is a
correctness issue, not merely duplicate network traffic.

The prepare/commit generation token fixes commit correctness. A shared
preparation cache can also avoid duplicate fetch/decode, but the cache needs
lease ownership:

- a render attempt leases a cached preparation;
- a committed scene converts the attempt lease into an active lease;
- an abandoned render does not dispose data another attempt uses;
- owned work aborts only when the last lease is gone;
- eviction/`clear` prevents new leases and disposes after the last active lease;
- rejected entries remain inspectable but `retry` creates a new generation
  rather than reusing the rejected promise.

Do not run active-world mutation inside a cached promise read by `use()`. React
can abandon a suspended render before any Effect cleanup exists. Cache only
preparation whose abandonment is safe under the lease rules; commit remains a
React lifecycle operation.

The current `catch -> setError -> throw on render` pattern makes installation
errors catchable by an application Error Boundary. React does not generally
route errors from event handlers or arbitrary asynchronous callbacks through
Error Boundaries, so Blendlink also needs a status subscription for post-ready
runtime failures. Error Boundaries and loading visuals remain website-owned.

## Cancellation and loading ownership

### What Three r184 can abort

`LoadingManager.abort()` aborts the manager's controller and creates a fresh
controller on the next access. `FileLoader` and `ImageBitmapLoader` combine
their private signal with the manager signal through `AbortSignal.any()`.
Three's own documentation limits the guarantee to loaders that implement the
abort path and browsers that support `AbortSignal.any()`. Sources:
[Three LoadingManager](https://threejs.org/docs/pages/LoadingManager.html),
[Three Loader](https://threejs.org/docs/pages/Loader.html),
[r184 LoadingManager source](https://github.com/mrdoob/three.js/blob/r184/src/loaders/LoadingManager.js),
and [r184 FileLoader source](https://github.com/mrdoob/three.js/blob/r184/src/loaders/FileLoader.js).

A small source-level runtime prototype in this checkout injected a never-settling
`fetch` into r184 `FileLoader`: `manager.abort()` changed the captured Request
signal from `aborted: false` to `true`, and the manager's next controller was
fresh (`aborted: false`). This verifies the installed FileLoader path under
Node 24's `AbortSignal.any`; it is not an end-to-end browser proof.

The exact limits are important:

- `GLTFLoader` creates manager-backed `FileLoader`s for the container and
  buffers, and normally manager-backed `ImageBitmapLoader`s for images on
  supported browsers. Its fallback `TextureLoader -> ImageLoader` uses an
  `<img>` element and has no equivalent manager abort.
- Aborting fetch does not preempt parsing work that already has the bytes,
  synchronous image processing, Meshopt decoding already running, audio
  `decodeAudioData`, PMREM work, or `compileAsync` polling.
- `KTX2Loader` uses manager-backed FileLoaders for texture and transcoder
  bytes. Once transcoding is posted to its WorkerPool, manager abort does not
  cancel that job. `dispose()` terminates workers, but r184 WorkerPool clears
  resolver queues without rejecting their promises; disposing it mid-job may
  leave an awaited preparation unresolved. Dispose after settlement unless a
  browser prototype proves a safe cancel wrapper. Sources:
  [Three KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html) and
  [r184 KTX2Loader source](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/KTX2Loader.js).
- Blendlink's Meshopt worker lease intentionally waits for the load promise to
  settle before releasing the module-global worker pool. Cancellation cannot
  truthfully mean immediate Meshopt worker termination without a new decoder
  contract.

### Private versus application-owned managers

The default path should create one private `LoadingManager` per uncached
preparation attempt and pass it to every package-owned GLTF, KTX2, HDR, EXR,
texture, probe, audio, and LUT loader. This creates depth: URL rewriting,
credentials, headers where supported, progress, item errors, and owned abort
have one locality.

Application-owned loader behavior is a distinct adapter at the same seam:

- Blendlink must never abort or dispose an application-owned manager/loader or
  clear an application-owned cache.
- The application adapter supplies URL modification, headers, credentials,
  CORS policy, and progress semantics. Blendlink may abandon its generation
  and dispose only private installed mutations after a late result.
- A supplied loader must declare whether returned resources are shared. The
  existing `installLoadedThreeCompiledScene()` behavior—caller owns loaded
  resources—is the correct low-level rule.
- If an application wants Blendlink's progress interface, adapt its manager
  into Blendlink events; do not overwrite global callback properties silently.

Drei `useProgress` assigns the callback properties of Three's
`DefaultLoadingManager`. That is convenient for one global owner, but it is not
a subscriber hub and it would miss a Blendlink-private manager. Blendlink
should expose its own attempt-scoped status, leaving the website free to map it
to any visual. Source: [Drei 10.7.7 progress source](https://github.com/pmndrs/drei/blob/v10.7.7/src/core/Progress.tsx).

Progress should distinguish completed items from byte progress. A
`LoadingManager` knows item starts/completions, while GLTF `onProgress` usually
reports only the top-level transfer and may have an unknown total. Never turn
an unknown byte total into a false percentage.

Suggested stable value type:

```ts
type BlendlinkSceneStatus =
  | { phase: 'idle' }
  | { phase: 'loading'; attempt: number; item?: string;
      itemsLoaded: number; itemsTotal: number; bytesLoaded?: number; bytesTotal?: number }
  | { phase: 'preparing'; attempt: number; step: 'decode' | 'textures' | 'probes' | 'shaders' }
  | { phase: 'ready'; attempt: number }
  | { phase: 'error'; attempt: number; error: Error; recoverable: boolean }
  | { phase: 'disposed' }
```

Retry means create a new attempt, not mutate the failed one. Status callbacks
must be best-effort observers: throwing from application presentation code
must not corrupt the runtime transaction.

## Truthful demand-mode rendering

R3F demand mode reacts to React prop changes, not arbitrary Three mutations.
`invalidate()` schedules a frame rather than rendering immediately, and calls
coalesce. Source: [R3F on-demand rendering](https://r3f.docs.pmnd.rs/advanced/scaling-performance).
The installed 9.6.1 loop confirms that an `invalidate()` issued inside
`useFrame` leaves another frame queued. Blendlink uses that behavior only
while a live subsystem proves it remains active; it does not infer idleness
from a static descriptor flag.

A static/non-static descriptor flag is not truthful enough. Activity changes
at runtime:

- looping playback and looping NLA sequences require continuous frames;
- play-on-click and non-looping startup actions require frames only while the
  action is running;
- hover and see-through need frames while converging, then can settle;
- Orbit controls need an input/change wakeup and frames while damping
  continues. The built-in Three adapter now uses native `start`/`change`
  events as the wake edge and Three r184's `OrbitControls.update()` boolean as
  the settle proof;
- Fly controls need frames while movement continues and remain conservative
  until their keyboard/pointer activity can be observed without missing an
  application mutation;
- look-at, LOD, instance synchronization, positional audio, and depth effects
  depend on camera/object changes that may originate outside Blendlink;
- custom component adapters may contain time-based shaders or imperative
  updates Blendlink cannot infer.

The internal module should therefore own a small activity arbiter, not expose
all subsystem details:

```ts
type FrameActivity = 'idle' | 'one-frame' | 'continuous'

interface FrameActivitySink {
  requestFrame(reason: string): void
  holdContinuous(reason: string): () => void
}
```

The production implementation is landing this policy subsystem by subsystem
rather than exposing the proposed arbiter as public API. Event handlers call
the existing package-owned `requestFrame`; playback, Components, and the
built-in Orbit adapter expose live activity. The R3F `useFrame` update asks
the installed scene whether another frame remains necessary. Custom controls
without an explicit activity signal default conservatively to continuous.
This preserves correctness while giving proven built-ins a measurable path
to idle.

The production Chromium Orbit gate starts from one visible render and a flat
idle count, performs a real mouse rotation, records 132 active/damping
renders, moves the camera by `9.878` world units, then records zero additional
renders through a second 420 ms quiet interval. React Strict Mode replays the
ready Effect twice while the loader remains single-call; the activity and
resource owner remains the one installed scene. This is Chromium 150 with
ANGLE SwiftShader, not physical-GPU power evidence.

Unknown external imperative mutations remain the host's responsibility. The
interface documentation should say that a host that mutates Blendlink objects
directly in demand mode must call R3F `invalidate`, just as it must for any
other Three object. Do not claim automatic observation.

## One scene per Canvas, and what a coordinator would cost

The current loud single-owner rule is the correct product contract. One R3F
root exposes one active camera, Scene environment/background/fog, renderer
look/shadow policy, event layer, and render-priority/composer path. Two
independent compiled scenes cannot both own those globals deterministically.

A small future coordinator can support **sequential transitions** without
recreating Canvas:

1. keep scene A committed;
2. prepare scene B privately;
3. synchronously dispose/deactivate A and commit B;
4. invalidate once.

That coordinator should live inside the same deep runtime module and preserve
one active owner. It earns leverage only after atomic commit exists. A
crossfade is different: it needs both scenes rendered into separate targets,
an explicit camera/environment policy for each, doubled transient GPU memory,
and a transition composer. That is not a small coordinator and should remain
future work unless artist demand justifies expanding the product.

The current WeakMap should eventually track the complete in-flight generation
until its preparation settles or is proven canceled, not merely the mounted
Effect. Otherwise a new mount can overlap old world mutation after cleanup.

## Three interface designs

All three designs put the external seam inside an application-owned R3F Canvas.
Their dependencies are: R3F/Three/React as in-process dependencies; the
website-owned static origin/CDN as remote-but-owned; browser fetch, WebGL,
workers, and audio as true external dependencies; and application loader or
custom component behavior as real adapters because both package-owned and
application-owned implementations exist.

### A. Minimal interface: a definition returns one scene module

Constraint: 1 public entry point; maximize leverage per fact the caller learns.

```ts
type SceneDefinition = R3FCompiledSceneDefinition & {
  loading?: { urlModifier?(url: string): string; credentials?: RequestCredentials }
}

type CompiledSceneModule = React.ComponentType<{
  onStatus?(status: BlendlinkSceneStatus): void
  onReady?(scene: InstalledThreeCompiledScene): void
}> & {
  preload(options?: { level?: 'network' | 'decoded' }): Promise<void>
  retry(): void
  clear(): Promise<void>
}

declare function defineR3FCompiledScene(definition: SceneDefinition): CompiledSceneModule
```

Usage:

```tsx
export const HeroScene = defineR3FCompiledScene({ descriptor: hero, createBakedScene })

<Suspense fallback={null}>
  <HeroScene onStatus={setHeroStatus} />
</Suspense>
```

Interface invariants, ordering, and errors:

- `preload` outside Canvas never claims GPU preparation; `decoded` stops at a
  private CPU-side resource.
- Mount may suspend on a cached preparation. Commit occurs only beneath Canvas
  and exactly one module may be committed per Canvas.
- `retry` creates a new generation after a recoverable failure. `clear` blocks
  new leases and waits to dispose owned cached resources; it never clears
  application-owned data.
- Preparation rejection reaches the Error Boundary and `onStatus`; post-ready
  failure reaches `onStatus` and disables further commits/updates.

The implementation hides the manager, cache leases, prepare/commit state
machine, ownership slot, renderer snapshots, activity arbiter, GPU preparation,
and rollback behind one module. Package-owned and application-owned loader
adapters are internal seams. This has the greatest **depth** and generated-file
**locality**. Its tradeoff is lower host control: `retry` and `clear` are broad,
and static methods on a React component are slightly unconventional.

### B. Flexible host-controlled interface: explicit runtime and prepared leases

Constraint: maximize extension and transition control.

```ts
interface R3FSceneHost {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  getCamera(): THREE.Camera
  setCamera(camera: THREE.Camera): void
  requestFrame(): void
  setRenderOwner(owner: null | ((delta: number) => void)): void
}

interface SceneTransport {
  load(request: SceneAssetRequest, signal: AbortSignal,
       report: (event: LoadingEvent) => void): Promise<LoadedSceneAssets>
}

interface CompiledSceneRuntime {
  prepare(definition: R3FCompiledSceneDefinition,
          options?: { signal?: AbortSignal }): Promise<PreparedSceneLease>
  commit(prepared: PreparedSceneLease, host: R3FSceneHost): ActiveSceneLease
  subscribe(listener: (status: BlendlinkSceneStatus) => void): () => void
  dispose(): Promise<void>
}

interface ActiveSceneLease {
  update(delta: number): FrameActivity
  deactivate(): void
}
```

Usage:

```tsx
const runtime = useMemo(() => createCompiledSceneRuntime({ transport, cache }), [transport, cache])
const prepared = use(runtime.prepare(heroDefinition))
useLayoutEffect(() => runtime.commit(prepared, r3fHost), [prepared, r3fHost, runtime])
```

Interface invariants, ordering, and errors:

- `PreparedSceneLease` is single-commit and renderer-capability-specific.
- `commit` is synchronous, fails if another active lease owns the host, and
  either fully commits or leaves the host unchanged.
- `deactivate` is idempotent. Runtime disposal waits for owned preparation
  cleanup but does not abort/dispose supplied transport or cache adapters.
- The caller must keep the promise stable across render, coordinate Error
  Boundaries, and never call `commit` outside a layout lifecycle.

The implementation still hides installation and rollback, but exposes the
host/transport/cache seams. Production HTTP and in-memory/browser-test
transports are two real adapters; R3F and Vanilla hosts are two real adapters.
This design gives transition systems high leverage and excellent internal
testability, but the external interface is shallow for ordinary sites: cache,
promise stability, commit ordering, and lease disposal knowledge leak into
callers. It weakens the artist-first default.

### C. Common-caller default: declarative scene plus a Canvas-local controller

Constraint: make the normal application call trivial and keep controls in a
separate hook only for callers that need them.

```ts
interface BlendlinkSceneProps extends R3FCompiledSceneDefinition {
  onStatus?(status: BlendlinkSceneStatus): void
}

declare function BlendlinkScene(props: BlendlinkSceneProps): React.ReactNode

declare function useBlendlinkScene(): {
  status: BlendlinkSceneStatus
  retry(): void
  preload(definition: R3FCompiledSceneDefinition): Promise<void>
}
```

Usage:

```tsx
<Canvas>
  <Suspense fallback={null}>
    <BlendlinkScene descriptor={hero} createBakedScene={createBakedScene} />
  </Suspense>
</Canvas>
```

Interface invariants, ordering, and errors:

- A Canvas-local controller permits one active definition; changing descriptor
  identity prepares the replacement and atomically swaps it when ready.
- The controller owns retry generation and status. The hook throws outside the
  Blendlink scene/controller context.
- Errors follow the same prepare/Error Boundary and post-ready/status split as
  design A.

The implementation hides the same deep state machine as A and naturally
provides a future sequential-scene coordinator. The dependency adapters remain
internal. The default usage is excellent, but generated bindings would pass a
large definition through JSX on every call and the implicit controller/context
is more magic to debug. It also makes accidental descriptor identity churn a
new interface concern. Locality is weaker than A because stable definition and
component association no longer live together in one generated module.

### Recommendation

Choose A externally and borrow B's `prepare`/`commit` leases only as private
internal seams. It preserves the current generated binding, has the greatest
interface **depth**, gives every website **leverage** without teaching it Three
lifecycle rules, and keeps cache/cancellation/renderer knowledge in one
**locality**. The deletion test is strong: deleting this module would force
load configuration, Suspense promise ownership, staging, camera/composer
handoff, activity scheduling, and cleanup back into every caller.

Do not expose transport or host ports until their second adapters are used in
tests or Vanilla integration. One adapter would make a hypothetical seam. The
existing package-owned/application-owned loader distinction and Vanilla/R3F
host distinction already justify internal adapters.

## Evidence tiers and next implementation slice

### Implemented and verified

- Deep package-owned R3F binding seam and tiny generated site file.
- Private-scene preparation of an exclusively owned root followed by one
  synchronous reversible Scene/renderer/camera/Component/host commit.
- Baked default-state, environment, presentation, controls, probes,
  Components, and `compileAsync` preparation before live root attachment.
- Private one-call GLTF resource disposal, explicit caller ownership at the
  already-loaded seam, KTX2 setup/disposal, and bounded Meshopt worker leases.
- Conservative demand-mode correctness and loud single-scene intent.
- Attempt-scoped `Loading`, `Preparing`, `Ready`, and `Failed` state with
  progress snapshots, retry generations, presentation ownership, and
  conservative recoverability (`false` unless the failure is explicitly known
  to be transient).
- Serialized replay for shared Three caches, generation-aware stale-progress
  rejection, and private-manager abort for requests Blendlink owns.
- A renderer-neutral scene-installation transaction with cooperative
  generation cancellation, preparation-owned resources, exact-once synchronous
  commit, reverse rollback, and structured cleanup errors, consumed by both
  production Three and R3F paths.
- A layout-effect R3F host handoff that preserves application sizing and uses a
  positive-priority gate only until React has published the committed ready
  children.
- Synchronous committed Scene/camera delivery to marked two-phase custom
  adapters and built-in scene-level helpers; unsafe adapters/services fail
  before live mutation.
- A ready-only renderer-neutral animation transport with deterministic
  First/Named/All startup, Manual play/pause/seek/stop/replay, sampled-NLA
  liveness, subscription state, and request-frame integration. The mounted
  production-dist R3F/Chromium gate proves a nonblank static first frame,
  active-frame acquisition, paused/finished settling, seek/stop pixels,
  exact-once teardown, and no post-disposal renders.

### Verified limitations and remaining production work

- The production-source Chromium differential proves zero partial frames
  against a priority-2 competing renderer for its synthetic basic-material
  case. Its strengthened fifth cell also uses the real Three r184 GLTFLoader
  over delayed HTTP for a 1,404-byte GLB plus separate 74-byte PNG, proves the
  ImageBitmap decoded at `2 x 2`, calls `initTexture` and `compileAsync` once,
  retains zero live-preparation leaks, and preserves the committed Scene and
  camera identities. It still does not establish KTX2/Basis, HDR/EXR,
  postprocessing, physical-GPU, cross-browser, or GPU-completion fencing.
- Late-result rejection and sequential replacement are now mounted at the R3F
  seam, and demand-mode animation plus built-in Orbit invalidation are
  browser-proven. Free controls, LODs, audio, and all custom adapters still
  need a wider production ReactDOM/browser matrix.
- `compileAsync` is used when present, but shader/texture readiness and the R3F
  first-frame claim are not browser-proven across drivers and decoder paths.
- There is no shared/ref-counted Suspense preload contract. The advanced
  prepared handle is single-attempt and renderer-bound; shared Three caches do
  not provide sufficient ownership evidence for abort, disposal, or lease
  lifetime. The focused
  [preload lease differential](research-r3f-preload-lease-2026.md) now proves
  why render-time Client acquisition is unsafe and validates a committed-owner
  attempt lease under Strict Mode, but that design remains a prototype rather
  than a public production promise.
- Only one compiled scene may own a Canvas. Sequential prepared transitions
  without recreating Canvas remain future; concurrent scenes/crossfades remain
  outside the current product contract.

### Highest-confidence implementation slice

1. Extend the now-real external GLB/PNG production browser gate to KTX2/Basis,
   HDR/EXR companions, and a postprocessing component.
2. Measure preparation/commit latency, transient memory, first-frame stalls,
   and settled demand-mode cost on a physical GPU before making performance
   superiority claims.
3. Design a reference-counted prepared-resource lease before exposing a public
   preload API.
4. Continue the activity policy subsystem by subsystem: Fly, LOD, audio, and
   postprocessing first. Unknown custom adapters remain continuous until they
   opt into explicit wake/idle signaling.
5. Add a sequential last-good-scene transition coordinator only after a
   dogfood route demonstrates that recreating the Canvas is harmful.

### Prototypes still required before stronger claims

- Abort a real throttled GLB containing external images and KTX2 in Chromium,
  then distinguish canceled network requests from late decode/transcode work.
- Exercise KTX2 worker disposal during transcode; r184 source suggests a
  pending promise can be stranded, so no immediate-worker-cancel claim is safe.
- Extend the successful production-source synthetic fixture to a published
  external GLB with authored environment/lights, KTX2/HDR companions, and a
  composer target; verify dependency requests and presented pixels separately.
- Run Strict Mode setup/cleanup/setup with delayed HDR, audio, and component
  adapters, not only a fast GLB.
- Measure a static scene reaching zero requested frames while looped animation,
  hover, damping controls, LOD, and a time-based custom adapter remain correct.

These prototypes should be browser tests. Node/unit fakes remain useful for
state-machine ordering and ownership, but they cannot establish WebGL upload,
worker, CORS, or visual-first-frame behavior.
