# Installed runtime loading ownership and Needle comparison

Date: 2026-07-22

Status: source audit, three local behavioral probes, and registered manager
ownership/replay differentials. Runtime behavior was not broadened; public
cancellation comments were narrowed to the evidenced guarantee.

## Question

What do the exact installed React Three Fiber, Drei, Three, and Needle
implementations guarantee about loading, cancellation, cache ownership, and
React Strict Mode? In particular, is a private `THREE.LoadingManager` an
independent cancellation boundary, and would adopting `useGLTF`/`useLoader`
make Blendlink's lifecycle safer?

## Exact installed baseline

The Blendlink checkout contains:

- React `19.0.0`;
- `@react-three/fiber` `9.6.1`;
- `suspend-react` `0.1.3`; and
- Three `0.184.0`.

The MichaelRoweJonesSite checkout contains React `19.2.4`, R3F `9.6.1`, Drei
`10.7.7`, Three `0.184.0`, and `three-stdlib` `2.36.1`. Drei's installed
`useGLTF` imports its `GLTFLoader` from `three-stdlib`, while Blendlink imports
the r184 loader from `three/addons`.

The pinned Needle experiment contains `@needle-tools/engine` `5.1.7`. Its own
nested `three` dependency resolves to the npm alias
`@needle-tools/three@0.169.19`. The experiment root also contains an unrelated
`@needle-tools/three@0.154.3` alias; it is not the copy resolved by the engine's
source.

Content identities for the primary inspected files:

| Source | SHA-256 |
| --- | --- |
| `node_modules/@react-three/fiber/dist/events-b389eeca.esm.js` | `dd92f7b70d669b7a0f3f4db35bcddd8f3aa9d10e2b2d76ddec63a7f041ef06d1` |
| `node_modules/suspend-react/index.js` | `12b503b08c451b0f378d547b960399517da189f3d565ac8d0c909714b4d4bb4e` |
| dogfood `node_modules/@react-three/drei/core/Gltf.js` | `2f4e4415df8d1b48c3b607682d149af655d0e6597dd8d7e76e9598fd6b26590f` |
| dogfood `node_modules/@react-three/drei/core/Preload.js` | `456f3909ea4f2fdd6de0e49ddbc60c83fb2286eee00f943ca7b29e7e98093f63` |
| `node_modules/three/src/loaders/LoadingManager.js` | `d71a203b1ba2382e1d95d0993302a20a774cc38d0c323ecbe2892a76e3c6a772` |
| `node_modules/three/src/loaders/FileLoader.js` | `e3f730f2fdefdd4e9285883fb2eb7ca40e13d58ea96e969a669d3eaacd7d0c03` |
| `node_modules/three/src/loaders/ImageBitmapLoader.js` | `e549af8e615e28094d89d9a262802eb8f662bf314567d8d8c76204695238e351` |
| `node_modules/three/src/loaders/ImageLoader.js` | `0507db81b6214afd32f4c781e08acd88005ab4988f93de583f34ded571f1fbcc` |
| `node_modules/three/src/loaders/Cache.js` | `e07792536bda2efe6ba985ff8b0fd4c33635bfebc283fece85125218d66fa653` |
| `node_modules/three/examples/jsm/loaders/GLTFLoader.js` | `97642d720f16cc9a0c9844934198e4d0c023bea8e89576d0f7545d03b2d103d2` |
| `node_modules/three/examples/jsm/loaders/KTX2Loader.js` | `cc5b9be79563ff07035d6fb7681ee2675811a9556c3fdeaf85f519c81e95009f` |
| `node_modules/three/examples/jsm/utils/WorkerPool.js` | `5ac7095fd566bc9ae48376055fd66edf27cb9ebbf9e1269dc206bfd4933ae9eb` |
| `node_modules/@react-three/fiber/dist/react-three-fiber.esm.js` | `f34bd3200c28be51ac10db1c66fdcd9a0052b18a6dee495407d5c44f317df620` |
| dogfood `node_modules/three-stdlib/loaders/GLTFLoader.js` | `2799720aedc03a4e3436ab37ffdd6b0246d874ed412a945b31d04d9da23f4078` |
| Needle `src/engine/webcomponents/needle-engine.ts` | `66e71697676b0cc115139946e5987bd4b7b97a303671b9c0cad365081d0daa68` |
| Needle `src/engine/engine_context.ts` | `84a02111e67f81b67beb023455de175c8567933a04949889b51a0cb38cafb509` |
| Needle `src/engine/engine_loaders.ts` | `3df0fbf23e1d36451cc7827fdbc26bb8c4a594d91dfd358526aca4b8ef6d9a73` |
| Needle `src/engine/engine_loaders.gltf.ts` | `5fa4bf5a04b982d66b2f2975ed4b4f9e3cdbc21883df8fdcce9155c27ac28288` |
| Needle `src/engine/engine_addressables.ts` | `0eb7f7b3535235b0a49ac436f6d2a35d7282ce9e05d0c045de57b206d9606d83` |
| Needle nested `node_modules/three/src/loaders/LoadingManager.js` | `b8fe217e712b14a4880f43ecd9ec5cd8838508717e1048981ce0d27191ebc496` |

Re-audit these findings when any of those package versions or file identities
changes.

## Finding 1: a private r184 manager is useful, but not a complete request namespace

Three r184's `LoadingManager.abort()` aborts a lazily created manager
controller, clears it, and creates a fresh controller on the next access.
Source: `node_modules/three/src/loaders/LoadingManager.js:280-317`.

`FileLoader` combines its own controller with the manager controller only when
the host supplies `AbortSignal.any()`. Without that API it uses only the
loader's private controller, so `manager.abort()` cannot stop that request.
The request also derives headers and credentials from the loader. Source:
`node_modules/three/src/loaders/FileLoader.js:129-141, 288-320, 350-362`.
`ImageBitmapLoader` has the same combined-signal behavior, while
`ImageLoader` uses an HTML `<img>` and has no abort path. Sources:
`node_modules/three/src/loaders/ImageBitmapLoader.js:168-203, 207-219` and
`node_modules/three/src/loaders/ImageLoader.js:88-161`.

The important edge is that `FileLoader` has a module-global `loading` table
keyed by resolved URL alone. A second request for the same URL adds callbacks
to the first request before it constructs a `Request`; manager identity,
headers, credentials, and response type are not part of that in-flight key.
Source: `node_modules/three/src/loaders/FileLoader.js:5, 84-134`.

A local probe with two managers and two same-URL loaders produced:

```json
{"fetches":1,"before":false}
{"afterSecondManagerAbort":false}
{"afterFirstManagerAbort":true}
```

The second manager did not own the coalesced fetch, so aborting it did nothing.
Aborting the first manager aborted the one request serving both consumers. A
second probe showed that both load callbacks ran, but only the first manager
received progress/completion:

```json
["first-callback","second-callback","first-progress:1/1","first-load"]
```

This is independent of `THREE.Cache`, which is disabled by default. The
in-flight table is always active; the optional persistent cache is a separate
URL-only mechanism. Source: `node_modules/three/src/loaders/Cache.js:7-61`.

Therefore the truthful Blendlink guarantee is narrower than "all requests
using the private manager abort":

> Blendlink requests that actually initiate an abort-aware r184 loader request
> are aborted with the private manager when `AbortSignal.any()` is supported.
> Same-URL work already initiated by a different Three loader/manager, HTML
> image loads, and post-download decode/GPU work are not independently owned by
> that manager.

The reverse collision matters too: if Blendlink initiates the shared request
first, canceling Blendlink can also fail an application consumer that Three
coalesced behind it. A private manager is still an improvement over Needle's
default manager, but it is not process-wide isolation.

## Finding 2: GLTF and KTX completion still need a generation gate

The r184 `GLTFLoader` creates manager-backed `FileLoader`s for the container and
external buffers, and manager-backed `ImageBitmapLoader` or `TextureLoader`
instances for images. It propagates its manager, request headers, and credential
policy into those paths. Sources:
`node_modules/three/examples/jsm/loaders/GLTFLoader.js:264-339, 478-489,
2579-2620, 3011-3039, 3220-3346`.

However, `GLTFLoader` does not expose the internal `FileLoader`, and its
`loadAsync()` wrapper has no signal parameter. More importantly, an image-load
failure is caught at the texture dependency layer and converted to `null`, so
the overall GLTF promise can resolve after `LoadingManager.onError` reported a
missing texture. Source:
`node_modules/three/examples/jsm/loaders/GLTFLoader.js:3233-3283`. The installed
`three-stdlib` loader used by Drei has the same behavior at
`C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/node_modules/three-stdlib/loaders/GLTFLoader.js:1765-1792`.

That means a private Blendlink install must not infer "complete dependency
graph" only from GLTF promise resolution. Compiler artifact verification is
the first line of defense; the private manager's error channel and a production
browser request gate must also make a missing companion terminal. A focused
fixture is still needed to prove that an external image failure cannot publish
Ready.

KTX2 network stages use the same manager for the texture bytes and Basis JS/WASM
files. Once bytes are posted to `WorkerPool`, manager abort cannot cancel that
transcode. `KTX2Loader.dispose()` terminates workers, but r184 `WorkerPool`
clears queued resolvers without rejecting their promises, so disposal during a
job can strand the awaiting promise. Sources:
`node_modules/three/examples/jsm/loaders/KTX2Loader.js:279-327, 359-411,
455-503` and `node_modules/three/examples/jsm/utils/WorkerPool.js:122-165`.
Blendlink's CSP-specific terminal-failure workaround is therefore justified;
it must not be generalized into a claim that all worker cancellation settles.

## Finding 3: R3F's cache prevents duplicate loads by sharing ownership

R3F 9.6.1 memoizes one loader instance per constructor in a module-level
`WeakMap`. Its Suspense key is the loader constructor/instance followed by the
input URLs. The extension callback and progress callback are not keys. Sources:
`node_modules/@react-three/fiber/dist/events-b389eeca.esm.js:1240-1300`.

The backing `suspend-react` 0.1.3 cache is module-global and keeps entries
forever by default. A pending entry throws the same promise; a resolved entry
returns the same value; `clear()` merely removes the entry. It does not abort,
dispose, or reference-count the value. Sources:
`node_modules/suspend-react/index.js:3-82` and
`node_modules/suspend-react/readme.md:61-73, 104-133`.

Consequences:

- render retries and Strict Mode render calls with the same key do not start a
  second load;
- preloading a URL with one extension/decoder/manager configuration fixes the
  cached result for a later call using a different callback, because that
  callback is not a key and is not invoked on a cache hit;
- the cached GLTF scene is shared mutable state rather than a private
  generation; and
- unmount cannot be used as a cache lease release.

R3F deliberately does not dispose `<primitive object={...}>` on unmount because
that object's state may live outside React. Source:
`node_modules/@react-three/fiber/dist/events-b389eeca.esm.js:15172-15225`.
That avoids automatically corrupting another consumer of a cached GLTF, but it
also leaves disposal and cache eviction with the application.

Drei 10.7.7 inherits these rules. `useGLTF` delegates to `useLoader`, has a
module-global Draco loader, and exposes `preload`/`clear` without adding manager,
decoder configuration, or ownership to the cache key. Source:
`C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/node_modules/@react-three/drei/core/Gltf.js:7-31`.

Drei `<Preload>` is a synchronous `gl.compile()` plus a cube-camera render in a
layout effect. It exposes no completion promise, does not call `compileAsync`,
and does not use `try/finally` around temporary visibility changes/render-target
allocation. It is neither a network/decode barrier nor a complete prepared-frame
barrier. Source:
`C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/node_modules/@react-three/drei/core/Preload.js:20-40`.

## Finding 4: the current Strict Mode test does not exercise Strict Effects

R3F's imperative `createRoot()` calls React reconciler `createContainer(...,
isStrictMode=false, ...)`. Source:
`node_modules/@react-three/fiber/dist/events-b389eeca.esm.js:15540-15576`.
A local probe rendering a component beneath `<StrictMode>` through that
imperative root observed only one effect setup:

```json
["setup"]
["setup","cleanup"]
```

The cleanup shown in the second line came from the explicit root unmount, not a
development setup/cleanup/setup cycle.

The first focused run exposed an invalid test assumption: the test wrapped the
imperative R3F root's child in `<StrictMode>`, expected attempts `[1, 2]`, and
observed only `[1]`. During this audit the fixture was replaced with an explicit
retained-instance Effect cleanup/setup driven by `retryKey`. The current test
proves that a pending stale attempt is gated and disposed, the replacement is
serialized behind it, and only the replacement commits. It deliberately labels
that sequence "Strict Mode-style" rather than claiming the imperative root ran
Strict Effects. Source: `packages/blendlink/src/reactThreeFiber.test.ts:29-143`.

The final focused command now passes 43/43: 41 `threeRuntime.test.ts` cases,
including the direct private/application-manager abort spies, plus two R3F
adapter cases. This is valid retained-instance replay evidence, not an outer
ReactDOM Strict Mode browser result.

This does **not** prove that an application `<Canvas>` under a React DOM Strict
Mode root can never cause duplicate lifecycle work. `CanvasImpl` is itself
subject to the outer React DOM lifecycle and its cleanup calls
`unmountComponentAtNode`; it creates/configures the inner R3F root in a layout
effect and unmounts it in a passive-effect cleanup. Source:
`node_modules/@react-three/fiber/dist/react-three-fiber.esm.js:50-120`. Only a
mounted application-level `ReactDOM.createRoot(...).render(<StrictMode><Canvas
... /></StrictMode>)` fixture can establish the real behavior.

Blendlink's current `slot.tail` generation serialization remains a prudent
defense for actual unmount/remount, retry, and future R3F behavior, but the test
must model those events rather than assume the imperative R3F root supplies
Strict Effects.

## Finding 5: Needle abandons generations; it does not abort loader work

Needle 5.1.7 creates a new GLTF loader for each load specifically to prevent
async extension configuration from overriding another loader. Those loaders
use the default Three manager; shared Draco/KTX2/Meshopt loaders are configured
separately. Sources: Needle
`src/engine/engine_loaders.ts:48-103, 198-230` and
`src/engine/engine_loaders.gltf.ts:13-81`.

The nested Needle Three 0.169.19 `LoadingManager` has no `abort()` or abort
controller at all. Source: Needle nested
`node_modules/three/src/loaders/LoadingManager.js:1-140`.

On a `src` change, the Needle web component aborts an attempt controller and
passes its signal into `Context.create()`. Context checks that token between
files, suppresses late progress, refuses a stale commit, and destroys loaded
scenes after a stale/aborted result. It never passes the signal into
`loader.load()`. Sources: Needle
`src/engine/webcomponents/needle-engine.ts:551-692` and
`src/engine/engine_context.ts:1141-1223, 1370-1435`.

Needle also:

- catches shader `compileAsync()` failure, logs it, and continues;
- logs a GLTF load failure and resolves `undefined`; and
- caches one Addressables loading promise but contains an explicit TODO for
  aborting resource loading and another unresolved shared-resource disposal
  concern.

Sources: Needle `src/engine/engine_loaders.ts:220-236, 249-331` and
`src/engine/engine_addressables.ts:291-330, 337-380`.

Blendlink's private r184 manager, loud rollback, and nonpublication of canceled
generations are measured improvements over this Needle baseline. The
cross-manager FileLoader collision and worker/decode limits above must remain
part of the claim.

## Design comparison and decision

### Design A: adopt R3F/Drei global `useLoader`/`useGLTF`

This naturally suspends and deduplicates same-key render retries, but it shares
one mutable loader/result, omits manager/decoder/header policy from the cache
key, and has no lease, abort, or disposal ownership. That conflicts with
Blendlink's per-attempt URL policy, transactional scene mutation, and loud
cleanup contract.

### Design B: retain package-owned install attempts and generation gates

This is the current direction. It gives Blendlink one deep module for URL
policy, progress, loud error handling, cancellation requests, preparation,
commit, and reverse cleanup. It also keeps application-owned loaders explicitly
outside Blendlink's cancellation/cache ownership. Its limits are that Three's
module-global in-flight dedup can cross the boundary, and repeated attempts do
not share immutable work unless `slot.tail` prevents overlap.

### Design C: cache immutable bytes, parse/install per generation

A future resource layer could key complete request policy plus content identity,
reference-count the byte lease, and parse a private mutable scene for each
generation. It would avoid R3F's shared mutable GLTF while deduplicating network
work. It is not a small change: external GLTF buffers/images and decoder workers
still need explicit ownership, and a renderer is required for true preparation.

**Decision:** keep Design B. It is a better match for Blendlink's product
boundary and is already stronger than Needle. Do not replace it with
`useGLTF`. Prototype Design C only after the differential gates below exist.

## Focused differential gate status

1. **Completed: cross-manager same-URL FileLoader test.** The registered
   `threeRuntime.test.ts` case exercises both ownership orders, proving that
   canceling the second manager does not abort a first-manager fetch and that
   canceling the first rejects the coalesced second consumer. Keep it as a
   truthfulness regression against Three upgrades.
2. **Missing external texture test.** Serve a valid `.gltf`/`.bin` with one
   failing external image. Assert that package-owned Blendlink installation
   reaches Failed, never Ready, even though stock GLTFLoader converts the image
   rejection to `null`.
3. **Application-level Strict Mode test.** Mount the actual `<Canvas>` through a
   development React DOM root under `<StrictMode>`. Record load count, setup and
   cleanup order, attempts, one committed root, listeners/lights/composer count,
   and disposal. Do not use the imperative R3F root as a Strict Effects proxy.
4. **Delayed unmount/remount test.** Let the first application-owned
   non-abortable load start, unmount, remount, then resolve it. Prove the stale
   root is disposed, the second attempt starts, and only it commits. Repeat with
   a KTX2 worker job that never replies to expose a blocked `slot.tail`.
5. **R3F cache-policy fixture.** Preload a URL with decoder/header extension A,
   then read the same URL with extension B. Prove B is not invoked. This is a
   guardrail explaining why generated Blendlink bindings must not silently move
   to `useGLTF`.
6. **Browser cancellation matrix.** For GLB, external buffer, image fallback,
   ImageBitmap, HDR/EXR, KTX2 bytes, Basis JS/WASM, KTX worker, Meshopt, audio,
   LUT, and probes, separately record request abort, promise settlement, late
   disposal, progress cutoff, and absence of commit. Never summarize the matrix
   as "all loading aborts."

## Commands executed

```text
npm.cmd run test --workspace blendlink -- reactThreeFiber.test.ts threeRuntime.test.ts
```

Initial result: 41/42 exposed the invalid imperative-root Strict Effects
assumption. After the fixture was corrected to drive the retained-instance
cleanup/setup explicitly and the cross-manager differential was registered,
the same focused files pass 43/43.

Two in-memory Node probes imported the installed r184 `LoadingManager` and
`FileLoader`, replaced `fetch`, and exercised same-URL loads under two managers.
A third in-memory Node probe mounted a plain effect beneath `<StrictMode>` using
the installed R3F imperative `createRoot`. Their exact outputs are embedded in
the relevant findings above. No network source or secondary article was used.
