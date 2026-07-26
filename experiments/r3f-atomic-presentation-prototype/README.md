# R3F atomic-presentation browser differential

> **Synthetic browser evidence — not a published-application smoke test.**

## Question

Can Blendlink prevent a site-owned, positive-priority R3F renderer from
presenting a partially configured scene, and does the production
`createR3FCompiledScene` path preserve that boundary under a deliberately
delayed loader, component preparation step, and real `compileAsync` call?
Does the same boundary survive a real HTTP-fetched GLB whose separately
requested PNG must be decoded and explicitly initialized by the renderer
before commit?

Run the real ReactDOM Strict Mode + Chromium fixture with:

```powershell
npm run prototype:r3f-atomic-presentation
```

The fixture renders five independent R3F canvases beneath one real ReactDOM
root. A DOM sentinel proves the root Strict Mode setup/cleanup replay. Each
canvas has a
priority-1 callback that declines to render during preparation and a
priority-2 application callback that always renders. It samples the actual
default framebuffer after that competing render. The first three canvases are
independent controls. The fourth and fifth import the current production
`createR3FCompiledScene` and `defineThreeComponentAdapter` source.

The production cell uses an application-owned synthetic GLTF loader whose root
starts red, a marked async component adapter that changes only the detached
root to green, and a wrapper that delays then invokes Three's original
`WebGLRenderer.compileAsync`. Its priority-2 renderer must observe blue
application frames during both delays, zero red frames, and green frames after
the adapter's layout-phase commit. It also asserts that the marked adapter
never observes its root parented to the live application scene, then receives
the exact committed application Scene and prepared camera identities during
its synchronous activation.

The fifth cell replaces the synthetic loader with Three's real `GLTFLoader`.
The local Vite server delivers a generated 1,404-byte binary GLB after a
180 ms delay. That GLB references a separate 74-byte PNG, delivered by a
second HTTP request after a 220 ms delay. The browser must expose a decoded
2x2 `ImageBitmap`, call the real `WebGLRenderer.initTexture`, remain blue
through fetch, decode/upload-init, and `compileAsync`, then present the green
texture only after the production adapter's layout-phase commit.

## Installed source identity

The prototype inspected and executes the repository's installed versions:

| Source | Version | Normalized path | SHA-256 |
|---|---:|---|---|
| React | 19.0.0 | `node_modules/react/package.json` | package identity |
| React DOM development client | 19.0.0 | `node_modules/react-dom/cjs/react-dom-client.development.js` | `495d78cd55901829d595757f03fdf5916b045073f52f9385885a9da9187d3b31` |
| React Three Fiber | 9.6.1 | `node_modules/@react-three/fiber/dist/events-b389eeca.esm.js` | `dd92f7b70d669b7a0f3f4db35bcddd8f3aa9d10e2b2d76ddec63a7f041ef06d1` |
| Three.js | 0.184.0 | `node_modules/three/src/renderers/WebGLRenderer.js` | `f42d1f7e2dddf575a2f8528fe5a561078f87eadc09ed5e805c64461b068b29de` |
| Three GLTFLoader | 0.184.0 | `node_modules/three/examples/jsm/loaders/GLTFLoader.js` | `97642d720f16cc9a0c9844934198e4d0c023bea8e89576d0f7545d03b2d103d2` |
| Three ImageBitmapLoader | 0.184.0 | `node_modules/three/src/loaders/ImageBitmapLoader.js` | `e549af8e615e28094d89d9a262802eb8f662bf314567d8d8c76204695238e351` |
| Needle Engine context | 5.1.7 | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_context.ts` | `84a02111e67f81b67beb023455de175c8567933a04949889b51a0cb38cafb509` |

Each run also records SHA-256 identities for
`packages/blendlink/src/reactThreeFiber.ts` and
`packages/blendlink/src/threeRuntime.ts` in `evidence.json`, so the production
claim remains tied to the exact source bytes executed by Vite.
It also records the fixture generator and the exact generated GLB/PNG byte
hashes, so the external-asset claim cannot silently drift with fixture bytes.

`npm run verify:needle-baseline` passed on 2026-07-23 with 110 pinned files,
five source version identities, and `integration=mixed-source` before this
comparison. The R3F/Needle-context conclusion is attributed to the exact
Engine 5.1.7 source; it is not an end-to-end add-on/build-pipeline claim.

## Primary-source findings

- R3F 9.6.1 increments an internal manual-render counter for every subscriber
  with priority greater than zero, sorts subscribers from low to high, invokes
  every subscriber, and suppresses only its own final `gl.render()` when the
  counter is nonzero. A priority-1 callback returning early cannot suppress a
  priority-2 callback. The official hook documentation says taking over the
  loop makes the subscriber responsible for rendering and that callbacks run
  in ascending priority. Sources: installed
  `events-b389eeca.esm.js:1115-1138,16041-16064` and the
  [R3F hooks documentation](https://r3f.docs.pmnd.rs/api/hooks).
- React 19 development Strict Mode performs an extra Effect setup/cleanup
  cycle at a strict root. The fixture requires at least two setups and one
  cleanup from a sentinel mounted directly in the ReactDOM root. Source:
  [React StrictMode](https://react.dev/reference/react/StrictMode) and
  [React useEffect](https://react.dev/reference/react/useEffect).
- R3F 9.6.1 creates its own reconciler container with `isStrictMode=false`.
  ReactDOM Strict Mode around `<Canvas>` does not propagate root strictness
  through that renderer seam. Wrapping the scene children in `<StrictMode>`
  creates a nested strict subtree, and React explicitly does not perform the
  initial extra Effect replay when Strict Mode is not enabled at the root.
  The current browser observation is therefore two DOM-sentinel setups but one
  R3F installation-effect setup. Source: installed
  `events-b389eeca.esm.js:15538-15566` and the root-vs-subtree note in the
  [React StrictMode documentation](https://react.dev/reference/react/StrictMode).
  This is version-specific evidence, not a lifecycle guarantee Blendlink
  should rely on: retries, key changes, route remounts, and a future R3F
  strict-root change still require generation-safe cancellation.
- Three r184's renderer returns immediately for `object.visible === false`, so
  a hidden parent prunes its descendants. Layers are different: a layer
  mismatch skips that object but traversal still continues into its children.
  Neither mechanism protects `Scene.background`, `Scene.environment`, fog, the
  camera, renderer look, or a composer. Sources: installed
  `WebGLRenderer.js:1823-1936` and the official
  [Object3D](https://threejs.org/docs/pages/Object3D.html) and
  [Layers](https://threejs.org/docs/pages/Layers.html) documentation.
- Three r184's `GLTFLoader` adds one manager item for the complete model in
  addition to the underlying file request, parses only after the GLB bytes
  arrive, and resolves parser dependencies before calling the model's
  `onLoad`. For an external image, it selects `ImageBitmapLoader` where
  supported; that loader resolves only after `fetch`, `blob`, and
  `createImageBitmap`. Sources: installed
  `GLTFLoader.js:290-329,2579-2607,2636-2699,3212-3350` and
  `ImageBitmapLoader.js:104-160`.
- Three r184 documents `initTexture` as a way to preload rather than defer
  decode/upload overhead until first render, and its implementation invokes
  the appropriate WebGL texture binding/upload path synchronously. This is an
  upload-init operation, not a GPU completion fence. Source: installed
  `WebGLRenderer.js:3519-3545`.
- `compileAsync` resolves when the scene can render without unnecessary shader
  compilation stalls; the r184 implementation prepares materials and polls
  shader-program readiness. It is not specified as a complete texture-upload
  or visible-frame fence. It accepts an Object3D/Scene that is not the live
  R3F scene. Sources: installed `WebGLRenderer.js:1360-1535` and
  [Three WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).
- Needle 5.1.7 owns its renderer and stops the animation loop during context
  creation. It adds loaded models only after the file-loading generation
  succeeds, finishes setup with the owned loop stopped, then restarts the loop;
  ready is dispatched after a rendered frame. Needle therefore has no
  site-owned competing-renderer seam to solve. Sources: pinned
  `engine_context.ts:1182-1223,1343-1365,1425-1445,1869-1873`, identified above,
  plus pinned `needle-engine.ts` SHA-256
  `66e71697676b0cc115139946e5987bd4b7b97a303671b9c0cad365081d0daa68`.

## Designs compared

### 1. Positive-priority frame gate

This has a tiny interface and correctly prevents Fiber's automatic render. It
cannot prevent another positive-priority subscriber from rendering the live
world. The Chromium control intentionally exposes red partial pixels while the
priority-1 gate is blocking.

### 2. Hidden root or reserved layer

`root.visible = false` prevents root-local geometry from rendering, but the
fixture still exposes a live red `Scene.background`. A layer gate is weaker:
parent layer mismatch does not prune child traversal, only 32 layer bits exist,
application cameras may enable the bit, and scene/renderer globals remain
outside the gate. This design is useful as defense in depth, not an atomic
presentation interface.

### 3. Explicit application renderer lease

Blendlink could expose `canPresent`/`render` through the ready handle and ask
every application composer to honor it. This is a small, deep seam for a
cooperating application, but it cannot truthfully protect unknown
positive-priority subscribers. Making it mandatory would also transfer
renderer-loop ceremony to every developer.

### 4. Detached prepare and synchronous commit

The root and desired scene-global state remain on a staging scene while
asynchronous preparation and `compileAsync` run. One no-`await` commit attaches
the finalized root and publishes its global presentation. The competing
renderer therefore sees the application baseline before commit and ready state
after commit, never the partial red state. This is the only compared design
that protects against an uncooperative renderer without taking renderer
ownership away from the website.

## External-asset fixture designs compared

### A. Published dogfood bundle with KTX2, Meshopt, and the full scene

The published workbench scene is valuable as a later integration smoke, but it
is not a clean foundational differential. The high variant is approximately
7.8 MB, combines `EXT_meshopt_compression`, `KHR_texture_basisu`, scene
complexity, publishing, and presentation, and embeds its KTX2 images inside the
GLB rather than requesting separate texture URLs. A failure cannot identify
which boundary regressed, and the current descriptor has no external HDR
environment to exercise.

### B. Generated GLB plus one external PNG

The chosen fixture is deliberately small and content-identified. It produces
exactly two delayed same-origin GETs, keeps the PNG outside the GLB, verifies
the resulting 2x2 decoded image rather than trusting loader completion alone,
records the real `initTexture` invocation, and proves the eventual textured
frame with framebuffer `readPixels`. Fetch, decode/upload-init, shader
preparation, and synchronous presentation are independently observable while
the competing renderer remains active.

This is the smallest honest improvement over the synthetic loader. Separate
future cells should add a real Basis-compressed KTX2 plus its JavaScript/WASM
transcoder and a tiny external Radiance HDR. They should use server-controlled
release barriers so worker/transcode and HDR decode are independently
causal—not replace the fast PNG foundation or conflate every decoder in one
fixture.

## Verdict and production interface exercised

Blendlink now implements the deep two-phase installation module this prototype
originally selected:

```ts
interface ThreeCompiledScenePreparationTask {
  readonly promise: Promise<PreparedThreeCompiledScene>
  cancel(): void
}

interface PreparedThreeCompiledScene {
  // Synchronous, transactional, exactly once. No await inside this operation.
  commit(host?: {
    activate?(scene: InstalledThreeCompiledScene): { dispose(): void } | void
    requestFrame?(): unknown
  }): InstalledThreeCompiledScene

  // Idempotent; releases an uncommitted preparation.
  dispose(): void
}
```

`startThreeCompiledScenePreparation(...)` receives the renderer, loader policy,
viewport, application fallback camera, and live scene only as the eventual
commit target. It owns an internal staging scene and a presentation plan
containing the finalized root, environment/background/fog values,
renderer-look transaction, camera, shadows, inactive input/audio adapters, and
postprocessing rebind. The production cell directly exercises this path
through `createR3FCompiledScene`.

`commit()` is the external seam and test surface. Its invariants should be:

1. synchronous and yield-free;
2. all-or-rollback on a synchronous failure;
3. exactly once, with `dispose()` remaining idempotent;
4. no event/input/audio activation before commit;
5. no application-owned scene/renderer value restored unless Blendlink still
   owns the installed identity;
6. a prepared composer must rebind from the staging scene to the live scene
   during commit, rather than continuing to render the staging scene.

The generated R3F adapter starts asynchronous preparation in a passive Effect
and performs the synchronous transaction in a layout Effect. The synthetic
marked adapter proves the public two-phase custom-adapter seam is accepted and
that its root-local async work remains off the live scene. The external cell
shows the same production transaction staying detached across real GLB/PNG
requests, ImageBitmap decode, one explicit upload initialization, and
`compileAsync`; only its later committed samples are green. The positive
priority gate remains defense in depth while React publishes ready children;
it is not described as the atomic guarantee.

The 2026-07-24 Chromium 150/ANGLE SwiftShader run recorded two HTTP 200
requests (1,404-byte GLB and 74-byte PNG), one 2x2 decode check, one
`initTexture`, one `compileAsync`, two detached checks, zero live preparation
leaks, zero red frames, more than 70 baseline-blue frames, and more than 60
committed green frames in the external cell. `evidence.json` is regenerated on
every run and retains the exact counts.

## Evidence limits

Both production cells remain local fixtures under Chromium/ANGLE SwiftShader,
not published-application smoke tests. The external case is same-origin,
no-CSP, no-auth, and no-base-path; it does not prove CORS, CDN, deployment,
request headers, credentials, or package-owned manager cancellation/URL
modification. Its tiny PNG does not cover KTX2/Basis workers or transcoding,
Meshopt/Draco, HDR/EXR, large mip chains, reflection capture, postprocessing,
or memory pressure.

`initTexture` initiates upload but has no GPU-completion promise, and
`compileAsync` remains a shader-stall barrier. The later green `readPixels`
sample proves only that this one visible texture completed in this renderer;
it does not prove a stall-free first frame or physical-GPU timing. The fixture
also does not prove cancellation once image/worker decode is underway or
complete CPU-side `ImageBitmap` cleanup. Physical GPUs, WebGPU, XR, Firefox,
WebKit, mobile, and a deployed route remain separate evidence gates.
