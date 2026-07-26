# Preview to website: the 2026 Blendlink publishing seam

Date: 2026-07-21

## Question

What is the lowest-friction, most portable way to move an artist-authored
Blendlink scene from the disposable Preview Studio into a real Three.js
website, without taking ownership of the website or introducing a cloud
service?

The target is broader than one portfolio: an existing Vanilla Three.js site,
an existing React Three Fiber site (including a Next.js App Router site), or a
new minimal Vite site must all receive the same scene contract.

## Primary-source findings

### The website must keep its route and renderer

React Three Fiber's `Canvas` owns the renderer, scene, camera, resize policy,
and render loop. Its hooks are valid only beneath that Canvas. A positive
`useFrame` priority deliberately transfers render-loop ownership to effects
such as a composer. This supports a small Blendlink adapter mounted *inside*
an application-owned Canvas; generating a second Canvas would fight the host
application's lifecycle. Sources: [R3F Canvas](https://r3f.docs.pmnd.rs/api/canvas),
[R3F hooks and render-loop ownership](https://r3f.docs.pmnd.rs/api/hooks).

Next.js App Router pages are Server Components by default, while state,
lifecycle, and browser APIs belong in a narrow Client Component. A generated
Blendlink R3F binding should therefore carry its own `use client` boundary,
leaving the route and surrounding page server-renderable. Next also recommends
lazy-loading heavy Client Components and libraries when they are not needed
for the initial route render. Sources: [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components),
[Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading).

### Portable scene bytes belong in static assets, but URLs must be revisions

Next serves `public/` files at root-relative URLs, but deliberately gives them
`Cache-Control: public, max-age=0` because mutable names cannot be assumed
safe to cache. Vite likewise copies `public/` assets unchanged, while imported
assets enter its hashed build graph; Vite explicitly recommends imports unless
an asset must keep its filename or be referenced without a source import.
Sources: [Next.js public folder](https://nextjs.org/docs/app/api-reference/file-conventions/public-folder),
[Vite static assets](https://vite.dev/guide/assets.html),
[Vite public base paths](https://vite.dev/guide/build.html#public-base-path).

A multi-file glTF delivery (GLB, baked atlas variants, environment maps,
reflection textures, audio, and the Basis transcoder) is not uniformly
importable across Next and Vite. Ordinary static assets are therefore the
portable default. Correct caching comes from making the requested URL change
with the content. HTTP guidance explicitly recommends a version or hash in
the URL and permits a year-long immutable policy once that invariant holds.
Vercel likewise preserves hashed static files across deployments. Sources:
[MDN HTTP caching and cache busting](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching#cache_busting),
[Vercel CDN static-file caching](https://vercel.com/docs/caching/cdn-cache#static-files-caching).

Blendlink first appended verified content hashes to generated asset URLs as a
cache-busting baseline. Internal compilation now additionally seals every
compiler-owned request, including concrete decoder files, beneath one complete
graph SHA-256 directory. `compiledSceneImmutableAssetPolicy` returns the exact
eligible prefix/header, while host-specific mutation remains application-owned.
Generic external typegen cannot make this claim without complete closure.

### Loader complexity belongs behind one runtime interface

Three's `GLTFLoader` needs explicit KTX2 and Meshopt configuration for their
respective glTF extensions. `KTX2Loader.detectSupport(renderer)` must run
before loading, it needs separately served WASM/JS transcoder files, and its
workers must be disposed. `LoadingManager.setURLModifier()` is the supported
escape hatch for application-owned CDNs, archives, and authenticated URLs.
Sources: [Three GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html),
[Three KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html),
[Three LoadingManager](https://threejs.org/docs/pages/LoadingManager.html).

The Khronos extensions support optional fallbacks, but exact Meshopt decoding
and Basis transcoding are still runtime responsibilities. Those details should
remain in `installThreeCompiledScene`, not be repeated in every generated site
file. Sources: [EXT_meshopt_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md),
[KHR_texture_basisu](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md).

### Generated bindings are useful; generated application trees are not

`gltfjsx` demonstrates the value of a generated, typed, drop-in R3F binding
and preloading, but its generated JSX expands the complete scene graph into
application code. That is appropriate when a developer wants to restructure
individual model nodes. It is a poor fit for Blendlink's artist-owned scene,
where camera policy, baked states, light groups, components, post-processing,
and future schema evolution should remain behind one runtime interface.
Source: [pmndrs gltfjsx](https://github.com/pmndrs/gltfjsx).

The installed Needle Blender add-on 1.4.2 was also inspected directly. Its
first-party `settings_scene.py`, `panels_project.py`, `operators_web.py`, and
`utils_web_project.py` establish the useful UX pattern: store a project path,
generate or choose a project, start a preview server, export to the browser,
and expose production build separately. Its implementation also shows what
Blendlink should avoid: template ownership as the primary integration seam,
fixed-port assumptions, hidden `npm update`/install work, and framework logic
inside Blender Python.

## Alternatives evaluated

### 1. Export assets and print instructions

Interface: `compile`, followed by documentation telling the developer how to
configure loaders and mount the result.

This is portable but shallow. Deleting the module barely changes callers:
loader, lifecycle, camera, resize, post-processing, and cleanup complexity
reappears in every site. It is the current friction we are trying to remove.

### 2. Generate and own a complete Vite/Next project

Interface: `Generate Web Project`, then all editing happens inside the owned
template.

This makes a blank demo easy and is worth retaining for Blendlink's minimal
Vite starter. It is the wrong primary seam for existing sites: it duplicates
routes, design systems, dependency choices, analytics, accessibility, and
deployment configuration. Template migrations also become a product burden.

### 3. Generate framework-specific scene implementations

Interface: emit a complete Vanilla installer or an 80-line R3F lifecycle
component into every website.

This is functional but moves Blendlink implementation into user-owned files.
Every lifecycle fix must either leave old sites broken or overwrite artist
code. The MichaelRoweJones dogfood component currently demonstrates this
problem.

### 4. Recommended: deep runtime adapters plus a thin generated binding

Interface:

```text
blendlink connect [site] --blend scene.blend  # one-time project attachment
blendlink preview [scene]                     # Preview profile + real site HMR
blendlink publish [scene]                     # Final + verify + site build
```

The generated application-owned file should be only the stable association:

```ts
'use client'
import { createR3FCompiledScene } from 'blendlink/react-three-fiber'
import { hero } from '../generated/hero.gen'
import { createBakedScene } from '../generated/hero.baked'

export const HeroScene = createR3FCompiledScene({
  descriptor: hero,
  createBakedScene,
})
```

The runtime adapter owns load configuration, late-load disposal, camera handoff,
resize, frame updates, conditional composer ownership, errors, and disposal.
The site still owns its Canvas, route, fallback, loading presentation,
analytics, router integration, and when the scene is lazy-loaded.

This module is deep: three artist-facing operations and one tiny site binding
hide the compiler and renderer machinery. It has two real adapters (Vanilla
Three and R3F), while filesystem/process seams remain internal and replaceable
in tests.

## Publish transaction

`publish` should mean "the repository is ready for its normal deployment",
not "upload to Blendlink cloud". In order:

1. Compile the selected scene(s) with the Final profile.
2. Refuse stale recipes, Preview artifacts, schema mismatches, missing
   companions, changed Blender dependencies, or byte/hash drift.
3. When a scene name is supplied, verify that scene only. An unrelated legacy
   or bespoke scene must not prevent a deliberate scoped publish.
4. Run the website's existing `build` script unless `--assets-only` is used.
5. Refuse recursive build scripts that call `blendlink publish` again.
6. Re-verify after the site build and report the exact artifact and build
   outcome.

Remote deployment stays application-owned. Blendlink may later add explicit
provider adapters, but must not infer permission to deploy, create cloud
resources, or alter hosting configuration.

## Dogfood findings: MichaelRoweJonesSite

The site is a useful worst-case integration, not a toy fixture:

- Next 16 App Router + R3F + Three r184.
- A bespoke production workbench pipeline and a reversible Blendlink lane
  coexist in one config.
- The current R3F binding duplicates lifecycle implementation that belongs in
  the package.
- `blendlink verify` is currently project-wide: an old schema in the bespoke
  `workbenchScene` blocks checking `workbenchDogfood`.
- The dogfood recipe can lag the installed template, which Preview does not
  present as a Final-readiness transaction.
- A local `file:`/junction dependency is not equivalent to the eventual packed
  npm install: TypeScript and Turbopack can follow the real package path and
  resolve a second React/R3F/Three peer universe. The dogfood site now preserves
  logical symlink resolution for types and aliases all renderer peers to its
  own singletons; normal registry consumers need neither workaround.
- A large family of project-specific `workbench:*` scripts shows which
  optimization and publishing knowledge should move into Blendlink over time;
  the website's composition and painterly shaders should remain site-owned.

The immediate dogfood target is the isolated `/blendlink-lab` route. It lets
the new adapter and publish transaction prove themselves without replacing
the production hero or destroying the bespoke lane.

## Failure modes and required behavior

- **Unsaved Blender work:** save before compile; never publish stale bytes.
- **Preview mistaken for Final:** `publish` always compiles Final and `verify`
  refuses draft manifests.
- **One bad scene blocks another:** scoped publish and scoped verify use the
  requested canonical scene name and fail on an unknown name.
- **Broken site build:** surface the package manager command and exit code;
  do not claim readiness.
- **Recursive build hook:** detect `build` scripts containing Blendlink
  publish and fail with an `--assets-only` correction.
- **KTX2 decoder missing:** keep the existing loud companion-integrity check.
- **SSR executes WebGL:** generated R3F binding is a Client Component and
  loader installation begins in an effect beneath Canvas.
- **Route unmount during load:** late installations dispose immediately and
  never replace the current camera.
- **Post-processing fights R3F:** take render ownership only when the installed
  component stack reports a composer.
- **Base path or CDN:** retain explicit descriptor URLs and application-owned
  loader/LoadingManager overrides; do not concatenate an unproven host path.
- **Mutable public caching:** keep hash-versioned requests now; move all
  companion files into a content-addressed directory before recommending
  blanket immutable headers.

## Runtime integration review after the first dogfood

A second primary-source pass against the implemented adapter found four
important distinctions that a build-only workflow can hide:

1. React Three Fiber 9 is the React 19 line. Connect must reject an R3F 8 /
   React 18 site before it writes config or bindings, rather than leaving npm
   or TypeScript to explain the mismatch later. Source: [R3F installation compatibility](https://r3f.docs.pmnd.rs/getting-started/installation).
2. `frameloop="demand"` does not observe imperative Three mutations. Blendlink
   must invalidate while its animation, camera-control, LOD, or Component
   lifecycle is active; otherwise an apparently supported Canvas freezes.
   Source: [R3F on-demand rendering](https://r3f.docs.pmnd.rs/advanced/scaling-performance).
3. One Canvas has one global camera, environment, renderer look, and composer.
   Concurrent compiled-scene mounts therefore need a coordinator or a loud
   single-owner rule; silently mounting both is incorrect. Source: [R3F state and render priority](https://r3f.docs.pmnd.rs/api/hooks).
4. A framework build plus byte/hash verification is not a browser proof. CSP,
   WebGL support, canvas sizing, CORS, base paths, and decoder worker policy can
   still fail at runtime. `publish` should report repository/asset readiness,
   then name browser checks as the next gate. Sources: [R3F Canvas fallback and sizing](https://r3f.docs.pmnd.rs/api/canvas), [CSP `worker-src`](https://www.w3.org/TR/CSP3/#directive-worker-src).

The first three low-risk contracts are implemented now: connect validates the
React/R3F major pair, the adapter keeps demand-mode rendering alive, and a
second compiled scene in one Canvas fails with an ownership explanation. The
MichaelRoweJones browser gate is the model for the fourth: it verifies the GLB
request, console/network errors, visible pixels, mobile framing, accessibility,
and an intentional asset-failure state after `publish` succeeds.

The review also identified deeper follow-up work that should not be disguised
as complete. Production installation now prepares an exclusively owned root on
a private Scene and commits synchronously from the R3F layout phase; it still
does not provide a shared/ref-counted Suspense cache. One private
`LoadingManager` spans package-owned GLB, KTX2, HDR/EXR, probe, baked texture,
audio, and LUT work, but its abort cannot stop arbitrary application loaders or
every already-running decode/transcode/GPU task. `assetBaseUrl` rebases known
compiler-owned URLs. Complete immutable graph-addressed publication is now
shipped for internal scenes and locally verified across packed Next/Vite
subpath/CDN cells; deployed-edge policy remains host evidence. Sources:
[Three LoadingManager](https://threejs.org/docs/pages/LoadingManager.html),
[R3F `useLoader`](https://r3f.docs.pmnd.rs/api/hooks#useloader),
[Next `basePath`](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath),
[Vite public base path](https://vite.dev/guide/build.html#public-base-path).

## Acceptance checklist

- [x] Existing Vanilla and R3F consumers compile from the packed npm tarball.
- [x] Generated R3F bindings contain association data, not lifecycle code.
- [x] Setup is idempotent and never overwrites an existing application file.
- [x] `connect` remains a compatibility-safe alias during migration from
      `setup` terminology.
- [x] `publish scene` compiles Final and verifies only that scene.
- [x] `publish` runs the existing site build by default; `--assets-only` is
      explicit and reported.
- [x] A recursive site build is rejected before spawning.
- [x] The MichaelRoweJones `/blendlink-lab` builds against the new adapter.
- [x] The registered Blender add-on continues to preview and compile through
      the same CLI, with failures and stderr tails visible.
- [x] Unit, real-tool, consumer, package, add-on, and baked e2e gates pass.

## Later, separately evidenced work

1. Add explicit retention/cleanup for obsolete content-addressed graph
   directories, and extend complete closure/addressing to cooperative external
   pipelines only when they can declare their entire companion graph.
2. Add an in-Blender project-directory chooser backed by `connect --blend`,
   including a portable project-link policy for `.blend` files outside a
   website repository.
3. Add an optional generated Next preview route only after collision,
   accessibility, lazy-loading, and route-ownership behavior is specified.
4. Add deployment-provider adapters only as explicit commands with their own
   authentication and authorization boundaries; keep local static publishing
   complete without them.

## Deeper lifecycle/deployment pass (2026-07-21)

Three independent primary-source audits now extend this record:

- [R3F lifecycle, loading, and cancellation](research-r3f-lifecycle-loading-2026.md)
- [Asset addressing and static deployment](research-asset-addressing-deployment-2026.md)
- [Production browser smoke and loading ownership](research-browser-smoke-production-2026.md)

The interface comparison retained `createR3FCompiledScene()` as the external
deep module: generated bindings stay tiny while attempt ownership, loaders,
status, camera/composer handoff, scheduling, and cleanup remain package-local.
An explicit prepare/commit/transport interface was rejected as the default
because it would make every website learn cache leases and mutation ordering;
a Canvas-local transition controller remains premature while one active scene
per Canvas is the truthful contract.

### Implemented in this slice

- A cancelable installation task now generation-gates ready publication and
  uses one private `LoadingManager` across package-owned GLB, KTX2, HDR/EXR,
  probe, baked-atlas, audio, and LUT loaders. Application-owned managers and
  loaders are never aborted or disposed by Blendlink.
- R3F attempts are serialized per Canvas, closing the Strict Mode overlap in
  which an obsolete first effect could mutate the same world as its
  replacement. Loading, renderer preparation, ready, and recoverable failure
  are exposed as facts for application-owned presentation and retry.
- Demand-mode invalidation is conservative rather than unconditional:
  interactions request a frame, hover transitions and playback report dynamic
  activity, and only active or unobservable per-frame work keeps the loop
  continuous. The built-in Orbit adapter now wakes from Three's native
  `start`/`change` events and uses `OrbitControls.update()` as its live damping
  proof; a production R3F/Chromium pointer gate records 132 active frames and
  zero renders after settle. Unknown application controls and Free controls
  remain deliberately continuous.
- Compiler URL query composition is safe for existing queries. An optional
  `assetBaseUrl` rebases only known compiler-owned requests; external Component
  media remains untouched.
- `publish` may run an application-declared browser smoke command only after
  the application build and post-build artifact verification. Absence and
  `--assets-only` are explicit skipped results.
- the smoke command may receive an OS-assigned port through an application-
  configured environment variable, and `blendlink/assets` exposes the complete
  compiler-declared HTTP dependency graph for manifest-based request checks.
- baked scenes retain a complete embedded first paint, then stage and prewarm
  the complete full-resolution active atlas set before one synchronous
  promotion; a mixed-quality intermediate composition is never committed.

### Claim boundary after implementation

Cancellation means obsolete work cannot produce a ready handle; immediate
work abort remains limited to Three loaders wired to the private manager and
browsers with the required abort support. Image-element loads, running
decode/transcode jobs, and `compileAsync` can still settle late and are then
discarded. Preparation still starts in an Effect and therefore does not activate
React Suspense, but it now occurs on a private Scene and commits the root,
presentation policy, camera, Components, and host ownership synchronously from
a layout effect. `preparing` still means neither GPU-ready nor presented.

The 2026-07-24 production-source Chromium differential records partial frames
`5 / 9 / 0 / 0` for live mutation, root-only hiding, detached control, and
`createR3FCompiledScene()` under a priority-2 application renderer. This
verifies the synthetic basic-material transaction, not network GLB,
KTX/HDR/EXR, postprocessing, physical-GPU, or cross-browser paths. The
MichaelRoweJones 21-component browser dogfood additionally found and fixed a
scene-level Contact Shadows handoff; its helper/capture now receives the
committed Scene/camera through the same synchronous Component activation seam.

The browser command is a dogfoodable adapter, not yet the destination browser
module. A local Next production success does not prove deployed CDN headers,
CORS, redirects, or credentials. Visual failure uses application-authored
evidence; Blendlink does not impose a universal non-black-pixel threshold.

Complete graph-addressed publication is now shipped for compiler-owned scene
closures. The generated Splash selected-sky browser gate requested its GLB
from one graph-hash directory and re-attested the exact response hash. What
remains future is explicit retention/cleanup of obsolete graph directories and
cooperative external pipelines that cannot yet declare their full companion
closure; deployed immutable headers remain host evidence.

The four-scene Splash dogfood also compared a static application registry with
an application-owned lazy registry. Both preserve the one-compiled-scene-per-
Canvas owner rule, but static imports placed every installer/runtime in a
1,650.54 kB minified entry chunk. Dynamic imports kept the route map equally
small for developers, reduced the entry to 2.36 kB, and emitted each scene
binding as an independent roughly 40 kB on-demand chunk; all four production
browser cases still loaded exactly one GLB. Blendlink should document this
ordinary framework code-splitting pattern, not take ownership of the route or
invent a global multi-scene registry.

## Public-hero dogfood seam (2026-07-21)

Three independent interface designs were compared before changing the public
MichaelRoweJones hero. All rejected a direct component swap: the existing site
uses `WebGPURenderer` plus a TSL finishing graph, while Blendlink's standard
installer and portable Components intentionally require `WebGLRenderer`.
Also, the first dogfood Final contained no Components or light groups, so it
could not represent the animated lamp contribution or the site's route wipe.

The selected boundary keeps one application-owned WebGL Canvas and one
compiled scene per Canvas. A private website module owns camera choreography,
projected DOM hit rectangles, lamp motion, route transitions, adaptive DPR,
loading presentation, analytics, and a WebGL translation of the site's
painterly finishing pass. Blendlink owns installation, the compiled root,
authored presentation, baked states/light groups, cancellation, and disposal.
The generated binding stays tiny.

To make that boundary practical for developers, `createR3FCompiledScene()` now
accepts children and attaches a module-local `useScene()` hook. Children mount
only after ready and receive a read-only application handle containing the
root, active camera, and a generated-key node map plus asynchronous state and
light-group operations. They cannot dispose package resources. This was chosen
over leaking the raw installed handle through route code or adding a generic
website/control plugin registry before a second real caller exists.

The public site now selects Blendlink by default while retaining explicit
`workbenchRenderer=legacy` and `workbenchRenderer=needle` diagnostic/rollback
lanes. The query must be selected after hydration; reading
it in an SSR `useState` initializer was proven to pin every request to legacy
and has been corrected so renderer-specific assets are not warmed before the
browser chooses a lane.

Responsive camera dogfooding found two separate application bugs. First, the
site snapshotted position/target but read FOV back from the live selected
camera; an aspect resize therefore mutated the value used on the next resize.
The contract now snapshots FOV as immutable authored evidence. Second, the
public lane switched among wide/compact/portrait authored cameras even though
the website promised one stable hero composition. Blendlink continues to type
all authored cameras, but this application now keeps its selected camera and
converts that lens across aspect ratios. A DPR-2 browser probe measures the
monitor at exactly 11.9375% of Canvas width at both 1600x900 and 800x900, keeps
the cloud visible at both widths, and restores the full composition after the
round trip. This remains website-owned policy, not a package assumption that
every scene should ignore authored Responsive Frames.

The lamp's `lamp_bulb_fill` is now authored in the isolated dogfood Blender
copy as the Cycles Light Group `Lamp Pool`. That makes the artist/compiler own
which direct and bounced contribution forms the additive layer; the website
still owns the deliberately nonphysical cursor-following spatial emphasis.
The group is prepared before public ready and its strength remains connected
to the existing warmup/breath/focus controller. The ready-only handle exposes
separate asynchronous preparation and synchronous live light-group mutation,
plus application cleanup that is guaranteed to run before generated material
disposal. The site's private adapter composes the cursor mask with the generated
Appearance hook, registers that restoration, and runs `WebGLRenderer.compileAsync`
before it reports public ready. This is a tested shader-readiness barrier for
this scene, not a claim that asset preload alone makes arbitrary scenes GPU-ready.
A future generalized spatial
light-group schema was rejected until another scene demonstrates the need.

Finally, the real 4096px base-plus-light-group publish exposed an invoker bug:
a healthy Cycles bake can spend more than five minutes inside one silent C
operation. `bakelib.py` now repeats the last progress record from a daemon
heartbeat that touches no Blender data, while the Node invoker always enables
the internal protocol but only echoes it for an opted-in wrapper. The watchdog
therefore remains an inactivity guard without killing productive long bakes or
making ordinary CLI output noisy.

### Browser differential: DPR, atlas sampling, and terminal status (2026-07-21)

**Evidence status:** the measurements below are browser observations from the
MichaelRoweJones public hero and `/blendlink-lab`, not conclusions inferred from
the bake settings. The lifecycle guard described under “Implemented” is present
in the current Blendlink worktree and has a unit regression test; that fix still
needs the public-hero browser reproduction repeated. DPR remains application
policy, atlas allocation remains future Blendlink work, and the package-owned
anisotropy change is in progress but not yet verified green.

#### Browser evidence

- In Chromium at a 1440×1000 CSS viewport with device DPR 2, the public hero's
  drawing buffer was 2160×1500 (1.5×) at three seconds, then 1440×1000 (1×) at
  eight and fifteen seconds. The browser reported ANGLE D3D11 on an NVIDIA RTX
  5080. The site starts this Canvas at `min(deviceDpr, 1.5)` and its Drei
  `PerformanceMonitor.onFallback` sets DPR to 1, so this was a measured
  application-owned adaptive-quality decision, not evidence that the baked
  atlas had been delivered at a lower tier.
- Every observed GLB, base-atlas, background, and lamp-layer request returned
  200 and used the canonical content-addressed WebP URL. The base and lamp WebPs
  on disk were both 4096×4096. The Final manifest nevertheless allocated about
  32.4% of atlas UV area to the wall, while representative foreground objects
  received much less (`Desk` about 0.299%, `Monitor` about 0.219%, `Resume`
  about 0.009%, and small cards about 0.002%). This distinguishes “the 4096
  atlas loaded” from “each visible object received enough source texels.”
- A raw-versus-final capture at DPR 1 found that the site's painterly pass
  increased mean absolute gradient from 4.9781 to 7.4020 and Laplacian energy
  from 298.9985 to 543.1701. Its render targets follow drawing-buffer size.
  This A/B does not prove artistic fidelity, but it rules out a hidden
  downsample/blur in that pass as the cause of the observed softness.
- Before the current terminal-progress guard, `/blendlink-lab` reported
  `loading` at 52 ms, `preparing` at 551 ms, `ready` at 562 ms, then regressed
  to `preparing` at 720 ms. The public hero could remain there for 60 seconds
  even though all assets returned 200 by 1.228 seconds and the Canvas intro
  completed. Aborting the primary lamp WebP, which selected the PNG fallback,
  changed the terminal result to `ready`; that order-sensitive result isolated
  a late manager-progress race rather than a failed render.

#### Source interpretation

The dogfood installation was checked against its actual installed versions:
Three r184, React Three Fiber 9.6.1, and Drei 10.7.7. R3F's installed
`dist/events-*.js` calculates the requested DPR and calls
`gl.setPixelRatio(viewport.dpr)` when it changes; the matching tagged source is
[`calculateDpr` in R3F 9.6.1](https://github.com/pmndrs/react-three-fiber/blob/v9.6.1/packages/fiber/src/core/utils.tsx).
Drei's installed `core/PerformanceMonitor.js` samples with `performance.now()`,
counts direction flips, calls `onFallback` after the configured flip-flop
limit, and then stops sampling while fallback is active; see the matching
[`PerformanceMonitor` 10.7.7 source](https://github.com/pmndrs/drei/blob/v10.7.7/src/core/PerformanceMonitor.tsx).
The observed 1.5×→1× change therefore matches the installed libraries and
`BlendlinkWorkbenchStage.tsx`; R3F did not independently lower the DPR.

The generated dogfood recipe configured color space, `flipY`, and wrapping,
then called `renderer.initTexture(texture)`, but did not configure texture
anisotropy. Three r184 initializes [`Texture.anisotropy` to 1](https://threejs.org/docs/pages/Texture.html#anisotropy),
and the official docs state that higher anisotropy reduces mipmap blur at the
cost of more samples. Three exposes the device ceiling through
[`renderer.capabilities.getMaxAnisotropy()`](https://threejs.org/docs/pages/WebGLRenderer.html#capabilities).
This makes default anisotropy a credible, source-backed cause of softness on
the desk's grazing-angle atlas lookup; it does not explain front-facing objects
whose atlas allocation is already small.

The late status regression follows Three's manager contract rather than a
network failure. [`LoadingManager.onProgress`](https://threejs.org/docs/pages/LoadingManager.html#onProgress)
runs when an individual item completes, and r184's
[`itemEnd` source](https://github.com/mrdoob/three.js/blob/r184/src/loaders/LoadingManager.js)
invokes it before testing whether all known items are complete. A generated
background `qualityReady` promotion can start and finish after Blendlink's
install promise has published ready; the manager has no concept of that
application lifecycle terminal state.

#### Implemented, verified, and future boundaries

- **Implemented, unit-verified, and browser-reverified in the current Blendlink worktree:**
  `installThreeCompiledScene()` now disables attempt-scoped progress in its
  `finally` block. A regression test starts and ends a late manager item after
  installation settles and proves that no new progress event is published.
  The rebuilt public hero remained terminal `ready` while all canonical atlas
  quality requests completed, closing the original Ready-to-Preparing race.
- **Implemented, unit-verified, generated, and browser-reverified:** the baked-recipe template
  sets each active texture to the renderer-supported maximum anisotropy before
  `initTexture` and applies the same preparation to asynchronously promoted
  textures. This correctly belongs in the deep baked recipe, not a
  website-specific material patch. The renderer test contract now includes
  capabilities, all 356 unit tests pass, and the generated dogfood recipe v10
  contains the same preparation path. The production browser loaded every
  canonical tier without a runtime or console failure. Anisotropy improves
  grazing-angle mip sampling; it does not manufacture atlas detail that was
  never baked.
- **Implemented and browser-reverified dogfood allocation:** plan evidence
  showed Wall owned 32.419% of the old Main atlas—97.93% of its used area—while
  all ten foreground objects together received only 115,092 texels. Three
  designs were measured: lowering Wall's artist weight kept four bake jobs but
  left the hero under one texel per Canvas pixel; an 8192 Main raised active
  base-plus-light memory from about 128 MiB to about 512 MiB; moving Wall to a
  2048 `architecture` atlas raised foreground density from 154 to 752.1 px/m
  while lowering Wall only from 217.7 to 164.5 px/m. The selected split passes
  the blocking plan with zero warnings/errors and raises the foreground from
  roughly 0.17–0.29 to 0.83–1.42 atlas texels per Canvas pixel. A DPR-2 browser
  A/B measured card gradient/Laplacian detail at 2.51×/2.90× and desk
  Laplacian detail at 1.78×. This uses the existing artist-owned atlas seam;
  the compiler packer remains unchanged.
- **Future bake-quality improvement:** expose composition-relative atlas
  texels per declared output pixel and recommend an atlas split when one
  low-frequency receiver consumes more than about 90% of used space while
  visible foreground stays below one texel per output pixel. `targetDensity`
  is a blocking validation contract, not a packing input; increasing atlas
  resolution does increase achieved px/m because Blender's packer scales the
  islands to fit, but a monolithic increase can spend most new pixels on the
  wrong receiver and impose a disproportionate GPU-memory cost.
- **Application-owned policy, implemented and browser-verified:** delaying the
  monitor past loading, intro, and resize work still reduced a stable DPR-2
  RTX-class browser to DPR 1 after ten seconds. The flagship site therefore
  removed that adaptive fallback and now holds its existing capped native DPR
  (maximum 2) across full, half, and restored viewports. The same ten-second
  production probe measured a 2x backing buffer in all three states. Blendlink
  exposes truthful renderer and asset readiness facts; it does not seize the
  website's Canvas-quality policy.

### Direct image-field material transport (2026-07-22)

**Evidence status:** implemented and focused-test verified in the source tree.
The full aggregate/package/browser gates still belong to the enclosing demo
scene run.

The next Material Compiler transport was deliberately limited to an explicit
Image Texture **Color** selection whose result can be represented without a
pixel bake: one static clean FILE image, packed or readable externally, exact
sRGB, Straight alpha interpretation, PNG/JPEG bytes, Flat projection, Linear
interpolation, Repeat wrapping, opaque Website Alpha, and either an unconnected
Vector input (active render UV) or one direct named UV Map. Non-Color/data
images are not relabelled as base color; dirty, generated, tiled, animated,
sequence/movie, mapped, procedural-coordinate, alpha, and other sampling cases
remain loud blockers.

Two credible implementations were compared:

1. Build one private Blender material around the already loaded Image and let
   Blender's official glTF exporter gather `KHR_materials_unlit`, texture,
   sampler, and UV variants, then independently attest the GLB.
2. Serialize or patch glTF image/material records inside Blendlink.

The first design was selected. The second would duplicate MIME selection,
sampler defaults, buffer alignment, UV-set variants, extension bookkeeping, and
application transform policy already owned by the stock exporter. A bake-every-
image design was also rejected for this direct case: it would add lossy work and
new ownership without increasing representational fidelity. Future general
field baking still belongs behind the same compiler seam and must use canonical
`bakelib.py` mechanics.

This choice is grounded in the
[glTF 2.0 material and texture contract](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html),
including sRGB base-color RGB, linear alpha, sampler defaults, and `texCoord`,
and Blender's
[official glTF material export documentation](https://docs.blender.org/manual/en/5.0/addons/import_export/scene_gltf2.html).
Installed Blender 5.2 LTS exporter 5.2.39 source was inspected as additional
version-specific evidence: its unlit gatherer recognizes the Background/Image
shape, unlinked Image Vector resolves through the active render UV, direct UV
Map nodes resolve a named layer, UV-layer order becomes `TEXCOORD_n`, and the
no-conversion image path reuses original PNG/JPEG bytes. Because those are
implementation facts rather than a permanent public guarantee, Blendlink does
not trust them implicitly.

The Python compiler now fingerprints the exact source byte hash/MIME/dimensions
and evaluated, material-slot-scoped UV field before mutation. After export it
requires one generated unlit material, no source fallback, an embedded image
with the same bytes, the exact Linear/Repeat sampler and texCoord, count-matched
finite VEC2 accessors, and the same distinct float32 UV hash/range. The final
TypeScript document pass repeats byte, MIME, dimension, sampler, texCoord, and
UV proof after all configured transforms. Thus an application may still choose
resize or KTX2 policy, but the first exact image route refuses to call changed
bytes the selected source.

Appearance and Lighting ownership were resolved separately. For an all-
Appearance Baked/Hybrid export, the existing `render_meshes()` predicate owns
complete static surfaces, so only exact live survivors enter selected-field
compilation after the bake transaction. A source material shared by static and
live objects is safe because Appearance installs a generated copy on the static
binding and the compiler installs a private material only on the live binding.
Any selected-field intent with any Lighting atlas blocks before packing/baking:
Lighting retains the live base material, and replacing only its color field
without a proved composition rule would change the lighting formula.

Focused evidence currently passes in Blender 5.2 for a packed 2x2 RGBA PNG,
active-render and named-UV classification, exact GLB byte/sampler/UV attestation,
and cleanup. A separate plan-only headless fixture proves static Appearance
ownership, live Hybrid compilation, and pre-bake Lighting refusal. Eleven
`sceneDiagnostics` tests pass, including final image-byte and UV-mutation
refusals, and the package TypeScript no-emit check is clean.
