# R3F loading and application-interface audit

Date: 2026-07-24
Status: source audit, implemented retry/dependency-failure tranche, mounted
unit evidence, production Next dogfood, and production-source Chromium evidence

## Decision

Keep Blendlink's package-owned, effect-started, detached preparation path as the
production default. Do not replace it with R3F `useLoader`, Drei `useGLTF`, or a
render-time cache of complete prepared scenes.

The shipped loading interface is already correctly placed:

- Blendlink owns loading, detached renderer preparation, atomic commit,
  generation gating, and disposal;
- the application owns its route, Canvas, Error Boundary, loading visuals,
  analytics, and deployment; and
- transport/install progress, installed readiness, baked-quality settlement,
  and first-frame observation remain distinct facts.

The selected high-confidence developer-experience improvement is now shipped:
`useCompiledScenePresentation()` exposes one attempt-scoped retry binding:

```tsx
const lifecycle = useCompiledScenePresentation()

<SiteErrorBoundary key={lifecycle.retryKey}>
  <Canvas>
    <WorkbenchScene {...lifecycle.sceneProps} />
  </Canvas>
</SiteErrorBoundary>

<button onClick={lifecycle.retry}>Retry scene</button>
```

`sceneProps` contains only `retryKey`, `onLoadStateChange`, and
`onPresentationStateChange`. `retry()` synchronously invalidates the old
callback generation, resets the presentation snapshot, and advances the key.
The application still chooses its Error Boundary, fallback, Canvas-remount
policy, and button. Blendlink should not ship a loading screen or a generic
Error Boundary wrapper.

Do not add a public preload function in the same change. A complete prepared
scene is mutable, renderer/Scene-bound, and single-commit. The now-addressed
runtime graph makes a future immutable byte prefetch possible, but request
selection, reuse by GLTFLoader, bounded cache ownership, credentials, and
last-reference cancellation are still unresolved. Its eventual name must say
`prefetchAssets` and its terminal fact must say `transportReady`, never
`ready`.

## Capability records

| ID | Capability | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- |
| `NDL-LIF-001` | Attempt-local loader ownership, progress, dependency failure, cancellation request, and late-result cleanup | **Improvement** | **Shipped** | The focused runtime/presentation gate passed 65/65 after adding the browser-proven private-manager dependency ledger and an application-manager non-interference case. Chromium 150 fetched a valid 1,412-byte GLB, received an intentional external PNG 404, published Failed once and Ready zero times, and committed zero fixture nodes. Cancellation remains explicitly narrower than “all work stopped.” |
| `NDL-LIF-002` | Detached preparation and synchronous atomic commit | **Boundary / Improvement** | **Shipped** | The same current run covers the unit seams. Existing production-source Chromium evidence is recorded in `research-r3f-lifecycle-loading-2026.md`; this audit did not rerun that browser gate. |
| `NDL-LIF-003` | Renderer-bound Suspense/preload ownership | **Improvement proposed** | **Prototype; production Gap** | `research-r3f-preload-lease-2026.md` records the committed-owner prototype. There is still no production Suspense resource or preload interface. |
| `NDL-LIF-004` | Application-owned loading, failure, ready, quality, and presentation interface | **Boundary / Improvement** | **Shipped** | Six store cases plus four mounted-hook cases cover truthful item counts, ready facts, quality settlement, callback identity, Strict Mode reactivation, and stale callback suppression. The production Next component lab retains its own UI and passes 2/2 browser cases. |
| `NDL-LIF-005` | One application-facing retry binding without taking over fallback UI or Canvas | **Boundary / Improvement** | **Shipped** | `retry()` synchronously revokes old ingress, resets to Idle, advances a monotonic key across batched calls, and accepts adapter-local attempt one. The dogfood site spreads `sceneProps`, keys its own Error Boundary/Canvas, and recovers from an induced first-load failure. |

Needle attribution in this note is per-package source evidence, not coherent
end-to-end Needle evidence. `npm.cmd run verify:needle-baseline` passed 110
pinned files and five version identities on 2026-07-24, but the registry
correctly remains `integration=mixed-source`.

## Exact inspected versions and identities

The Blendlink workspace resolves:

- React and ReactDOM `19.0.0`;
- `@react-three/fiber` `9.6.1`;
- `suspend-react` `0.1.3`; and
- Three `0.184.0`.

Drei is deliberately not a Blendlink dependency. The dogfood site resolves
React/ReactDOM `19.2.4`, R3F `9.6.1`, Drei `10.7.7`, `three-stdlib` `2.36.1`,
and Three `0.184.0`.

| Source | Version | Normalized path | SHA-256 |
| --- | --- | --- | --- |
| Blendlink R3F adapter | current worktree | `packages/blendlink/src/reactThreeFiber.ts` | `18b85df943994a46a158161df8aec75fd2f5383f8a8586dd2e796c94c74f939c` |
| Blendlink Three installer | current worktree | `packages/blendlink/src/threeRuntime.ts` | `d8dba507e20446eea7588a83028a65140f6b32b6f90cd5e8523ddbd9b1d43120` |
| Blendlink presentation store | current worktree | `packages/blendlink/src/scenePresentation.ts` | `868fdb67cb82ce379e2344d0e4bae83ee7b5584510565ba3084a4880a8e7d495` |
| Blendlink React hook | current worktree | `packages/blendlink/src/react.ts` | `5dfabb7a815b7c8e507da4caab9ce252466c09ceb3a4d71a7f20e5f9f2ba1a4f` |
| R3F loader implementation | 9.6.1 | `node_modules/@react-three/fiber/dist/events-b389eeca.esm.js` | `dd92f7b70d669b7a0f3f4db35bcddd8f3aa9d10e2b2d76ddec63a7f041ef06d1` |
| `suspend-react` cache | 0.1.3 | `node_modules/suspend-react/index.js` | `12b503b08c451b0f378d547b960399517da189f3d565ac8d0c909714b4d4bb4e` |
| Three LoadingManager | 0.184.0 | `node_modules/three/src/loaders/LoadingManager.js` | `d71a203b1ba2382e1d95d0993302a20a774cc38d0c323ecbe2892a76e3c6a772` |
| Three FileLoader | 0.184.0 | `node_modules/three/src/loaders/FileLoader.js` | `e3f730f2fdefdd4e9285883fb2eb7ca40e13d58ea96e969a669d3eaacd7d0c03` |
| Three GLTFLoader | 0.184.0 | `node_modules/three/examples/jsm/loaders/GLTFLoader.js` | `97642d720f16cc9a0c9844934198e4d0c023bea8e89576d0f7545d03b2d103d2` |
| Three KTX2Loader | 0.184.0 | `node_modules/three/examples/jsm/loaders/KTX2Loader.js` | `cc5b9be79563ff07035d6fb7681ee2675811a9556c3fdeaf85f519c81e95009f` |
| Three WebGLRenderer | 0.184.0 | `node_modules/three/src/renderers/WebGLRenderer.js` | `f42d1f7e2dddf575a2f8528fe5a561078f87eadc09ed5e805c64461b068b29de` |
| Drei `useGLTF` | 10.7.7 | `C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/node_modules/@react-three/drei/core/Gltf.js` | `2f4e4415df8d1b48c3b607682d149af655d0e6597dd8d7e76e9598fd6b26590f` |
| Drei `Preload` | 10.7.7 | `C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/node_modules/@react-three/drei/core/Preload.js` | `456f3909ea4f2fdd6de0e49ddbc60c83fb2286eee00f943ca7b29e7e98093f63` |
| Drei `useProgress` | 10.7.7 | `C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/node_modules/@react-three/drei/core/Progress.js` | `324c5c65a0e098842d54ce34f78b6be69bda524d9e7d7e448af36f90a61b82fd` |
| Needle web-component lifecycle | Engine 5.1.7 | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/webcomponents/needle-engine.ts` | `66e71697676b0cc115139946e5987bd4b7b97a303671b9c0cad365081d0daa68` |
| Needle context loading | Engine 5.1.7 | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_context.ts` | `84a02111e67f81b67beb023455de175c8567933a04949889b51a0cb38cafb509` |
| Needle loader construction/prewarm | Engine 5.1.7 | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_loaders.ts` | `3df0fbf23e1d36451cc7827fdbc26bb8c4a594d91dfd358526aca4b8ef6d9a73` |
| Needle Addressables | Engine 5.1.7 | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_addressables.ts` | `0eb7f7b3535235b0a49ac436f6d2a35d7282ce9e05d0c045de57b206d9606d83` |
| Needle loading-progress helper | Engine 5.1.7 | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/webcomponents/needle-engine.loading.ts` | `67b26874c21573eaafdd1ef334cdbff3519c839ce823ed766db008e63b26c09c` |

The last Needle helper is content-identified here but is not yet part of
`needle-baseline.json`; any future behavior change based specifically on its
heuristic should first add it to the machine-verified baseline.

## What Blendlink currently guarantees

| Fact | Current interface | Truthful guarantee | Deliberate non-guarantee |
| --- | --- | --- | --- |
| Loading | `phase: "loading"`, optional item, `itemsLoaded`, `itemsTotal` | Attempt-scoped item completion from a package-owned manager; totals may grow as dependencies are discovered; a private-manager item error is terminal even if GLTFLoader recovers | Not bytes, a stable percentage, decode progress, or GPU progress |
| Preparing | `phase: "preparing"` | The root GLTF load resolved and Blendlink is configuring a detached candidate, including baked defaults, presentation policy, Components, known texture initialization, and shader preparation | Not a display-compositor fence |
| Ready | `phase: "ready"` plus installed handle | The complete detached candidate committed synchronously and ready-only children may mount | Not necessarily promoted full atlas quality or first presented frame |
| Quality | presentation `bootstrap`, `full`, or `failed` | Whether tracked baked-quality promotion remains or failed | Not proof of visual parity |
| Presented | presentation `presented: true` | Blendlink's R3F frame callback completed and a following animation-frame callback ran | Not a GPU fence, pixel oracle, or proof the display compositor showed nonblank output |
| Failed | error plus conservative `recoverable` | The attempt will not publish Ready; the render throw reaches the nearest React Error Boundary; private companion errors name the URL and deployment remedies | Generic errors are not classified as safely recoverable |
| Cancel | task cancellation and generation replacement | A canceled/stale attempt cannot commit; privately initiated manager-aware work is asked to abort and late results are disposed | Shared same-URL fetches, all image paths, worker transcodes, CPU decodes, `compileAsync`, and GPU work do not all stop immediately |

The R3F adapter starts preparation in an Effect
(`reactThreeFiber.ts:302-493`), commits the prepared transaction in a layout
effect (`537-546`), throws terminal errors during render (`609`), and mounts
application children only after readiness (`610-611`). This is Suspense-safe in
the ordinary English sense of “does not show a partial scene,” but it is not a
React Suspense resource: React explicitly does not detect work started in an
Effect. [React Suspense](https://react.dev/reference/react/Suspense)

The framework-neutral store (`scenePresentation.ts:88-251`) is the right deep
module. It concentrates attempt filtering, quality settlement, audio
subscription, presentation merging, and observer subscription behind one
small interface. The React hook is a thin adapter over that seam using
`useSyncExternalStore`.

### Important current limits

1. Context loss is the only current `recoverable: true` path, but its message
   correctly tells the application to remount the Canvas. A boolean does not
   encode “retry scene” versus “remount Canvas”; do not make automatic retry
   policy from it.
2. With an application-owned loader/manager, Blendlink deliberately neither
   aborts the manager nor overwrites its single callback properties. The
   application therefore retains progress and dependency-failure policy;
   Blendlink reports only its high-level Loading/Preparing/Ready/Failed phases.
3. One presentation hook/store is one scene lifecycle producer. Sharing it
   across independently mounted scene producers is intentionally unsupported.
4. The missing-companion browser gate is one same-origin HTTP 404 cell. The
   broader production smoke owns deployed CDN, credential/header, and CORS
   matrices.
5. There is still no public preload interface. Any future immutable byte cache
   needs bounded ownership, policy-aware identity, and honest transport-only
   readiness.

## Primary-source conclusions

### React Suspense and Strict Mode

React documents that Effect-started fetches do not activate Suspense and that a
tree suspended before first mount is retried from scratch without preserving
state. A render-time Promise must therefore come from a stable external cache.
[Suspense](https://react.dev/reference/react/Suspense)
[use](https://react.dev/reference/react/use)

Root Strict Mode re-renders and re-runs Effects with an additional
setup/cleanup cycle in development. That makes idempotent cleanup and stable
attempt identity mandatory even when the installed R3F imperative root does not
itself enable Strict Effects.
[StrictMode](https://react.dev/reference/react/StrictMode)

React's `cache` is documented for Server Components only. Current `cacheSignal`
is also server-scoped and returns `null` in Client Components. The installed
React 19.0.0 client additionally implements `cache(fn)` as a pass-through and
does not export `cacheSignal`. Neither is a production Client R3F ownership
primitive.
[cache](https://react.dev/reference/react/cache)
[cacheSignal](https://react.dev/reference/react/cacheSignal)

React still requires an Error Boundary to catch a later render throw and has no
function-component equivalent for `componentDidCatch`. This supports returning
a retry key and callbacks while leaving the actual boundary with the
application.
[React Error Boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)

### R3F, Drei, and shared cache ownership

R3F 9.6.1 `useLoader` memoizes one loader per constructor, keys its
`suspend-react` entry by loader plus URL inputs, and omits extension and progress
callbacks from the key. `preload` starts that same cache entry; `clear` only
removes it. `suspend-react` 0.1.3 retains entries globally with no reference
count, abort, or value disposal. The result is useful shared cache warming, not
an exclusive mutable scene lease.
[R3F 9.6.1 source](https://github.com/pmndrs/react-three-fiber/blob/v9.6.1/packages/fiber/src/core/hooks.tsx)
[R3F useLoader documentation](https://r3f.docs.pmnd.rs/api/hooks#useloader)

Drei 10.7.7 `useGLTF` delegates directly to that cache and adds decoder
configuration without adding it to the cache key. Its `Preload` component runs
synchronous `gl.compile()` and a cube-camera render in a layout effect; it has
no completion Promise and is not a transport/decode/GPU/presented barrier.
[Drei useGLTF source](https://github.com/pmndrs/drei/blob/v10.7.7/src/core/Gltf.tsx)
[Drei Preload source](https://github.com/pmndrs/drei/blob/v10.7.7/src/core/Preload.tsx)

Drei `useProgress` takes over the four callback properties of Three's
`DefaultLoadingManager`. That is convenient for a single globally managed app,
but it cannot observe Blendlink's private manager and is not a composable
subscription seam for an application-owned manager.

### Three cancellation and preparation

Three r184 documents that `LoadingManager.abort()` works only when the loader
implements abort and the browser supports `AbortSignal.any()`.
[LoadingManager](https://threejs.org/docs/pages/LoadingManager.html)

The installed `FileLoader` further deduplicates in-flight work by resolved URL
alone. A later same-URL consumer can join a request initiated with another
manager, headers, or credentials. This is why Blendlink correctly promises
private-manager abort invocation rather than a private network namespace.
[Three r184 FileLoader source](https://github.com/mrdoob/three.js/blob/r184/src/loaders/FileLoader.js)

KTX2Loader's manager owns the KTX2 and Basis fetches, but after bytes reach its
WorkerPool, manager abort does not cancel the transcode. `dispose()` terminates
workers; it is not a general settlement guarantee for every pending job.
[Three r184 KTX2Loader source](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/KTX2Loader.js)

`compileAsync()` resolves when shader compilation should no longer create
unnecessary stalls. `initTexture()` is useful for initializing texture upload.
Neither method promises a fully presented, nonblank frame.
[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
[Three r184 WebGLRenderer source](https://github.com/mrdoob/three.js/blob/r184/src/renderers/WebGLRenderer.js)

### Needle 5.1.7 baseline

Needle's web component owns a default loading overlay and emits `loadstart`,
repeated `progress`, and `loadfinished`. It can suppress stale progress with an
attempt controller and create ID, but its signal is checked around
`loader.loadSync`; it is not passed into the actual loader request. Late loaded
scenes are destroyed. The overlay customization path is also coupled to
product/licensing rules in the inspected source.

Needle's computed progress combines the current top-level file index with
per-file byte progress; when the total is unknown, it advances a small
heuristic amount. Blendlink's item counts are less visually smooth but more
truthful. The website can choose an indeterminate progress treatment without
Blendlink inventing a percentage.

Needle Addressables separates binary `preload()` from `loadAssetAsync()`, which
is the correct conceptual split to retain. The inspected implementation caches
raw bytes or one shared mutable loaded instance, returns `null` to a concurrent
raw-binary preload, and contains explicit TODOs for resource abort and
reference-safe disposal. Blendlink should match the separation and improve the
ownership before exposing it.

Needle creates a new GLTFLoader per load, installs Components, and invokes
`compileAsync`; shader-preparation failure is logged and loading continues.
Blendlink's detached transaction and loud rollback remain measured
improvements, not reasons to adopt Needle's engine-owned UI or loop.

## Designs compared

### Design A: keep callbacks plus the framework-neutral presentation store

This is the shipped design. It is a deep module: one small callback/subscription
interface hides attempt ordering, quality and audio settlement, presentation
facts, and disposal. It does not prescribe DOM or Canvas structure.

**Decision:** retain and deepen. This has the best locality and product fit.

### Design B: use R3F/Drei Suspense, global cache, and `useProgress`

This gives a concise fallback and avoids duplicate same-key render loads.
However, it shares mutable loaded scenes, omits loader policy from cache
identity, has no release/abort/disposal ownership, and reports through a global
default manager that Blendlink deliberately does not use.

**Decision:** reject for the complete Blendlink scene lifecycle. Keep
`createUseBlendlink(useGLTF)` as an explicitly cache-owning low-level binding
adapter, not the recommended compiled-scene installer.

### Design C: cache a complete prepared scene and throw its Promise in render

This would activate an ancestor Suspense fallback. It is unsafe because a
complete candidate is renderer-bound, mutable, tied to one application Scene,
and commit-once. A Client render abandoned before first commit supplies no
deterministic Effect cleanup. The existing prototype proved the leak and
selected a committed-owner exclusive lease instead.

**Decision:** keep Prototype. Do not ship from this audit.

### Design D: immutable graph byte prefetch plus private parse/install attempts

This is the eventual performance design. The graph fingerprint can safely
identify bytes across routes, but a correct module must still choose only the
delivery dependencies needed by the target device, key request policy, bound
memory, reference-count consumers, abort only on last release, and feed those
bytes into a private parse path. A plain `fetch()` that merely hopes
GLTFLoader's later request hits the browser cache is not a strong interface.

**Decision:** Future. Prototype after retry ergonomics and the cancellation
matrix, not in the same production change.

### Design E: Blendlink-owned loading/error wrapper

A wrapper could render a spinner and Error Boundary automatically. It would
reduce a few lines while taking ownership of DOM, fallback style, analytics,
boundary granularity, and Canvas-remount policy from the website.

**Decision:** reject as a product-boundary regression.

## Implemented interface

The change deepens `blendlink/react` only; it does not change the generated
scene schema or the R3F install transaction.

`UseCompiledScenePresentationResult` now adds:

```ts
readonly retryKey: number
readonly retry: () => void
readonly sceneProps: Readonly<{
  retryKey: number
  onLoadStateChange: (state: CompiledSceneLoadState) => void
  onPresentationStateChange: (
    state: CompiledSceneRendererPresentationState,
  ) => void
}>
```

Required invariants:

1. `retry()` invalidates the current ingress generation synchronously before
   scheduling React state.
2. It resets the current snapshot to Idle and advances a monotonic retry key.
3. Callbacks captured from an older `sceneProps` object become no-ops.
4. The next binding accepts attempt `1` from a freshly keyed/remounted scene;
   adapter-local attempt numbers are not assumed globally monotonic.
5. Callback and `sceneProps` identities remain stable within one retry
   generation.
6. Observer failures remain isolated by the existing adapter.
7. The existing `reset()` remains available for view-only clearing, but docs
   direct actual retry flows to `retry()`.
8. Error Boundary and Canvas keys remain explicit application choices.

This adds leverage without adding a new lifecycle implementation. Generated
scene bindings do not need to change because structural prop spreading already
matches `R3FCompiledSceneProps`.

## Current validation and remaining gates

### Retry binding

Focused mounted React tests now prove:

1. progress and Ready update a mounted hook through `useSyncExternalStore`;
2. `retry()` returns Idle and advances `retryKey`;
3. an old binding's Loading/Failed/Ready and presentation callbacks are ignored
   after retry;
4. the new binding accepts a freshly mounted adapter's attempt `1`;
5. two batched retries cannot revive the intermediate binding;
6. callback identities are stable inside an epoch and change across retry;
7. a ReactDOM root `<StrictMode>` setup/cleanup/setup does not dispose the
   owned store between probe Effects, while final unmount does;
8. a real first-failure/second-success R3F fixture keys the application's Error
   Boundary with the returned key and reaches exactly one current Ready.

The component acceptance lab now replaces its hand-written attempt/reset
wiring while retaining its visible application-owned retry button, status,
Error Boundary, and Canvas. Its production browser suite passes both ordinary
installation and induced first-failure/retry recovery.

### Loading truth before broader claims

The real-browser external-companion failure cell now:

- serves a valid GLB graph whose external image returns 404;
- proves the private manager records the exact failing URL;
- observes Failed once, Ready zero times, and zero committed fixture nodes;
- exercises the new private-manager ledger after stock GLTFLoader resolves;
  and
- leaves application-owned manager callbacks untouched by contract.

Add a context-loss cell that proves the task is abandoned and the app can
recover only after its chosen Canvas remount. This should precede any richer
recovery enum.

### Future asset prefetch

Before exposing `prefetchAssets()`:

1. define a selected request subset rather than eagerly downloading every
   atlas alternative in `compiledSceneAssetUrls()`;
2. key graph fingerprint, resolved base URL, credentials, headers, and fetch
   policy;
3. prove same-key deduplication and different-policy isolation;
4. prove last-reference network abort separately from late decode disposal;
5. enforce a bounded byte cache and integrity failure;
6. feed retained bytes into a private GLTF parse/install generation or make the
   weaker HTTP-cache-only behavior explicit;
7. measure request count, transferred bytes, peak memory, decoder workers, time
   to Bootstrap, Full, and Presented against no prefetch; and
8. retain the explicit statement that transport readiness is not decode,
   texture upload, shader, GPU, or presentation readiness.

## Commands run

```text
npm.cmd ls react react-dom @react-three/fiber @react-three/drei three --all
npm.cmd run verify:needle-baseline
npm.cmd run test --workspace blendlink -- threeRuntime.test.ts reactThreeFiber.test.ts react.test.ts scenePresentation.test.ts
npm.cmd run test:r3f-missing-companion-browser
npm.cmd run build
npx.cmd playwright test e2e/blendlink-components-lab.spec.ts --workers=1
```

Results:

- Blendlink dependency tree: React/ReactDOM 19.0.0, R3F 9.6.1, Three 0.184.0,
  no Drei dependency;
- Needle identity: 110 files, five source-version identities,
  `integration=mixed-source`; and
- focused Blendlink runtime/presentation gate: four files, 65/65 tests passed;
- Chromium 150 missing-companion gate: HTTP 200 GLB + HTTP 404 PNG, Failed
  `1`, Ready `0`, committed nodes `0`; and
- production Next 16.2.6 build plus component-lab browser dogfood: 2/2 passed,
  including host-owned failure/retry recovery.
