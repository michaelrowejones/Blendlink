# R3F preload and preparation lease research

Date: 2026-07-24
Status: **Prototype**; no production interface is claimed

## Decision

Do not put a complete Blendlink scene preparation directly into a module-level
Client React Suspense cache.

A complete candidate is renderer-bound, reflects one application Scene's
presentation state, owns mutable decoded Three resources, and may be committed
exactly once. It is therefore neither immutable nor safely shareable between
consumers. More importantly, Client React exposes no deterministic cleanup
callback for a render that suspends before its first commit.

The safest foundation is two deliberately separate modules:

1. an **exclusive renderer-bound attempt lease**, acquired only by a committed
   owner and retained through load, preparation, synchronous activation, and
   final cleanup; and
2. a future **immutable asset-graph lease**, keyed by a complete content
   fingerprint, for transport bytes only. It must be named `prefetchAssets` (or
   equivalently explicit wording), not `preloadScene` or `ready`, because
   network completion proves neither decode nor GPU/presentation readiness.

The first module is prototyped. The second should wait for production
content-addressed graph publication so every GLB companion, KTX2/Basis file,
environment, probe, and generated asset participates in the key.

## Capability record

| ID | Capability | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- |
| NDL-LIF-003 | Reference-counted Suspense/preload ownership | **Improvement proposed over Needle's unabortable, non-reference-counted addressable; production remains a Gap** | **Prototype** | `node experiments/r3f-preload-lease-prototype/run.mjs`; passed 2026-07-24 in Chrome 150 with React/ReactDOM 19.0.0. Controlled candidate only; production R3F/Three gate pending |

Needle attribution is limited to the exact Engine 5.1.7 file identified below.
The repository's baseline verifier reports `integration=mixed-source`; this note
does not claim a coherent runnable Needle browser differential.

## Exact inspected sources

`npm run verify:needle-baseline` passed on 2026-07-24: 110 pinned files, five
source-version identities, `integration=mixed-source`.

| Source | Version | Normalized path | SHA-256 |
| --- | --- | --- | --- |
| React development client | 19.0.0 | `node_modules/react/cjs/react.development.js` | `0c81ce0e95e381e08b91123e1faa9c1093626ff6d2229c546e5a1d82c0549e91` |
| ReactDOM client | 19.0.0 | `node_modules/react-dom/cjs/react-dom-client.development.js` | `495d78cd55901829d595757f03fdf5916b045073f52f9385885a9da9187d3b31` |
| React Three Fiber runtime | 9.6.1 | `node_modules/@react-three/fiber/dist/events-b389eeca.esm.js` | `dd92f7b70d669b7a0f3f4db35bcddd8f3aa9d10e2b2d76ddec63a7f041ef06d1` |
| `suspend-react` | 0.1.3 | `node_modules/suspend-react/index.js` | `12b503b08c451b0f378d547b960399517da189f3d565ac8d0c909714b4d4bb4e` |
| Three LoadingManager | 0.184.0 | `node_modules/three/src/loaders/LoadingManager.js` | `d71a203b1ba2382e1d95d0993302a20a774cc38d0c323ecbe2892a76e3c6a772` |
| Three FileLoader | 0.184.0 | `node_modules/three/src/loaders/FileLoader.js` | `e3f730f2fdefdd4e9285883fb2eb7ca40e13d58ea96e969a669d3eaacd7d0c03` |
| Three WebGLRenderer | 0.184.0 | `node_modules/three/src/renderers/WebGLRenderer.js` | `f42d1f7e2dddf575a2f8528fe5a561078f87eadc09ed5e805c64461b068b29de` |
| Needle addressables | Engine 5.1.7 | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_addressables.ts` | `0eb7f7b3535235b0a49ac436f6d2a35d7282ce9e05d0c045de57b206d9606d83` |

Primary documentation:

- React requires the same cached Promise across retries and explains that a
  tree which suspends before first mount is retried from scratch without
  preserving its state: [React `use`](https://react.dev/reference/react/use)
  and [React Suspense caveats](https://react.dev/reference/react/Suspense).
- Root Strict Mode re-renders and re-runs Effects in development, including a
  setup/cleanup/setup stress test:
  [React StrictMode](https://react.dev/reference/react/StrictMode) and
  [React `useEffect`](https://react.dev/reference/react/useEffect).
- React `cache` is a Server Components facility. Current `cacheSignal` likewise
  returns no client lifetime signal; it always returns `null` in Client
  Components:
  [React `cache`](https://react.dev/reference/react/cache) and
  [React `cacheSignal`](https://react.dev/reference/react/cacheSignal).
  The installed React 19.0.0 client makes `cache(fn)` a pass-through and does
  not export `cacheSignal`.
- Three documents that `LoadingManager.abort()` works only for loaders that
  implement abort and browsers with `AbortSignal.any()`:
  [LoadingManager](https://threejs.org/docs/pages/LoadingManager.html).
- `WebGLRenderer.initTexture()` initializes texture storage/upload work, while
  `compileAsync()` resolves when shader compilation should no longer cause
  unnecessary stalls. Neither is a complete GPU completion or presented-frame
  fence:
  [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).

## What the installed implementations actually do

### React and R3F

React's documented abandoned-render rule is the decisive ownership fact:
Effects run after a component commits, so an Effect cannot release work
created by a render that never committed.

R3F 9.6.1 `useLoader` calls `suspend-react` with a key composed of the loader
constructor/instance and URL inputs. When passed a constructor, R3F also holds
one loader instance per constructor in a `WeakMap`. `useLoader.preload` starts
the same cached operation; `useLoader.clear` only removes the cache entry.

`suspend-react` 0.1.3 stores entries in a module-global array. Entries retain a
Promise and then a response or error. Its `clear()` removes an entry but does
not abort loading and does not dispose decoded Three objects, textures, decoder
resources, or GPU allocations. There is no reference count. R3F does not pass
the library's optional lifespan setting. Loader extensions and progress
callbacks are not part of `useLoader`'s cache key.

Consequently, `useGLTF.preload`/`useLoader.preload` is useful cache warming but
is not a lifetime-owning, renderer-ready scene lease.

### Three cancellation and shared request behavior

Three r184 `FileLoader` combines its own signal with its manager signal only
when `AbortSignal.any()` exists. `LoadingManager.abort()` therefore cannot stop
non-manager work or loaders without that support.

`FileLoader` also deduplicates in-flight requests in a module-global
`loading[url]` table. A later same-URL caller appends callbacks to the first
request rather than creating a request with its own manager signal. Aborting
the later manager cannot truthfully claim ownership of that shared fetch.
This supports Blendlink's existing distinction:

- a package-created private manager may be asked to abort its attempt;
- an application-owned manager must never be aborted by Blendlink; and
- all cancellation claims still need generation gating and late-result
  disposal.

### Needle 5.1.7

The pinned `AssetReference` caches by URL inside a Needle context.
`preload()` downloads an `ArrayBufferLike`; it does not decode, upload, compile,
or present the scene. Concurrent `preload()` calls while
`_isLoadingRawBinary` is true return `null` instead of a shared awaitable.

`loadAssetAsync()` deduplicates through `_loadingPromise` and returns one shared
mutable instance. `unload()` destroys that instance and raw bytes. The inspected
source explicitly leaves both aborting a resource and preventing disposal while
resources remain in use as TODOs.

Blendlink should match the useful separation between byte prefetch and scene
instantiation, while improving cancellation, ownership, and reference
lifetime rather than reproducing those TODOs.

## Designs compared

| Design | Developer benefit | Ownership result | Decision |
| --- | --- | --- | --- |
| Render-time `use(cachedPromise)` containing a fully prepared scene | Concise; outer Suspense fallback works automatically | **Unsafe.** A pre-first-mount abandoned render provides no Effect cleanup. The candidate is mutable, renderer/Scene-specific, and single-commit, so global sharing is invalid. TTL cleanup cannot know whether a legitimately slow suspended render still needs the candidate. | Reject for complete scene preparation |
| Immutable, content-addressed asset-graph byte lease | Can start before Canvas exists; safe cross-route/network sharing; CDN/browser-cache friendly | Safe only for immutable bytes when the full graph and request policy form the key. It proves transport completion, not parse, transcode, image decode, `initTexture`, shaders, or a presented frame. Requires a bounded byte LRU and explicit release/abort ownership. | Future, after graph-addressed publication |
| Explicit exclusive renderer-bound attempt lease acquired by a committed owner | One deep interface can own progress, cancellation, retry generation, activation, rollback, and cleanup; can place only a reader below an application-owned Suspense fallback | Correct lifetime. Same logical owner may bridge Strict Mode replay for one microtask; different owners never share a candidate. Final release removes the entry, asks private work to cancel, blocks stale activation, and disposes late results. | Prototype selected |

## Proposed deep interface

The generic registry should remain package-internal. Generated bindings should
expose one convenient optional component rather than renderer, Scene,
LoadingManager, or cache-key machinery:

```tsx
<WorkbenchScene.Suspense
  fallback={<SiteOwnedSceneLoader state={loadState} />}
  retryKey={retryKey}
  onLoadStateChange={setLoadState}
>
  <SiteOwnedInteraction />
</WorkbenchScene.Suspense>
```

`WorkbenchScene.Suspense` is a committed outer owner. It starts an exclusive
attempt in an Effect, then places only the attempt reader/activator beneath its
nested React Suspense boundary. The website supplies the fallback and retains
route, Canvas, layout, analytics, error-boundary, retry, and deployment
ownership. The current ordinary `<WorkbenchScene />` remains the compatible
effect-driven interface.

The internal interface should be no larger than:

```ts
interface SceneAttemptLease {
  readonly attempt: number
  readonly ready: Promise<void>
  readonly snapshot: SceneAttemptSnapshot
  subscribe(listener: (state: SceneAttemptSnapshot) => void): () => void
  activate(host: StableSceneCommitHost): InstalledScene
  release(): void
}
```

Interface invariants are part of the contract:

- acquisition occurs only from a committed owner, never from render;
- the cache key includes generated scene identity, renderer, application
  Scene, asset/loader/base-URL policy, delivery quality, and retry generation;
- the logical owner identity is stable across the root Strict Mode Effect
  replay;
- `activate()` is synchronous and idempotent only for the same stable host,
  because Strict Mode also replays layout Effects; a different host or a stale
  lease fails loudly;
- `release()` is idempotent. At zero references it schedules exactly one
  microtask retirement. Same-owner reacquisition in the Strict Mode replay
  cancels that retirement; a real unmount does not hide behind a longer TTL;
- release means **attempt abandoned**, not “all work instantly stopped.”
  Package-owned manager requests are asked to abort. Shared fetch, decode,
  transcode, shader, and GPU work may settle late and must then be disposed;
- application-owned loaders/managers are observed but never aborted;
- progress is attempt-scoped item progress, not byte percentage or GPU
  progress; observer failure cannot fail preparation;
- retry uses a new monotonic attempt identity and never revives a failed or
  retired candidate;
- `ready` means detached preparation completed. It does not mean a frame was
  presented or a GPU fence completed.

If an early transport interface is later added, keep it distinct:

```ts
interface SceneAssetLease {
  readonly transportReady: Promise<void>
  release(): void
}

const assets = WorkbenchScene.prefetchAssets({ assetBaseUrl })
```

It must not expose decoded scene objects and must not be accepted as a
renderer-ready attempt. Whether bytes stay after the final release belongs to
a bounded package cache policy; it is not silently equivalent to ownership by
R3F's global loader cache.

## Prototype evidence

The isolated prototype is
[`experiments/r3f-preload-lease-prototype`](../experiments/r3f-preload-lease-prototype).

Command:

```powershell
node experiments/r3f-preload-lease-prototype/run.mjs
```

Last pass: 2026-07-24, Chrome `150.0.7871.129`, React/ReactDOM `19.0.0`.

Observed differential:

- rejected render-time acquisition: one start, one late resolve, zero cancel,
  zero dispose, zero activation, and one retained registry entry after React
  removed the still-suspended component;
- committed Strict owner: two Effect setups, two Effect cleanups, two layout
  activation calls, but one preparation start, one actual activation, one
  final cancel, one final dispose, and zero retained entries;
- pending final release: one cancel, deliberately non-cooperative late resolve,
  zero activation/visible Ready, one late dispose, zero retained entries;
- exclusivity/retry: a second logical owner was rejected while the first lease
  lived; after retirement it received attempt 2, and both late candidates were
  disposed.

Artifacts:

- `experiments/r3f-preload-lease-prototype/evidence.json`
- `experiments/r3f-preload-lease-prototype/r3f-preload-lease.png`

The candidate is a controlled fake. This evidence validates React ownership
and registry transitions only. It does not validate a production Three/R3F
load, decoder worker, manager abort, GPU state, or cross-browser timing.

## Gates required before production

1. **Pure lease module**
   - same-owner Strict handoff, different-owner rejection, idempotent release;
   - same-host layout activation replay and different-host rejection;
   - release before/after preparation and after activation;
   - cooperative rejection and non-cooperative late success;
   - subscriber add/remove, observer exceptions, terminal failure, and retry
     generation;
   - exact-once reverse cleanup even when cancellation/disposal throws.
2. **Real React/R3F browser fixture**
   - root Strict Mode with one real GLB request/decode/preparation and one
     synchronous commit;
   - removal before GLB response, during companion texture fetch, during KTX2
     transcode, and during `compileAsync`;
   - same committed Scene/camera identities, zero partial frames, and zero
     stale activation;
   - final unmount returns renderer/program/texture/geometries to a measured
     baseline across repeated cycles.
3. **Cancellation ownership differential**
   - private manager request abort is observed;
   - application-owned manager is never aborted;
   - two managers requesting the same URL exercise Three's global in-flight
     coalescing and prevent an overbroad abort claim;
   - credentials, headers, URL modification, base path, CORS, and CSP remain
     part of the key or application-owned policy.
4. **Failure/retry integration**
   - application Error Boundary receives deterministic load/authoring/CSP
     failures;
   - a changed retry key starts a new attempt without stale progress;
   - recoverability remains structured and conservative.
5. **Compatibility and performance**
   - packed R3F consumer builds with and without the optional Suspense wrapper;
   - production Next dogfood demonstrates site-owned fallback/analytics;
   - measure duplicate requests, peak CPU memory, decoder workers, Three
     renderer allocations, time-to-first-presented frame, and idle frames
     against the current effect path.
6. **Immutable graph prefetch (separate future gate)**
   - complete graph fingerprint and base/credential/header policy key;
   - deduped byte requests, last-reference abort, bounded LRU, tamper failure;
   - explicit proof that transport readiness is reported separately from
     decode, upload, compile, and presentation.

Until those real gates pass, `NDL-LIF-003` remains **Prototype / production
Gap**. The current atomic effect-driven R3F installer remains the shipped,
truthful default.
