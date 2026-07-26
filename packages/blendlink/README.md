# Blendlink

Blendlink is an artist-first Blender-to-Three.js scene compiler. Artistic
publishing intent lives in the `.blend`; the website receives ordinary GLB,
textures, a readable manifest, typed bindings, and a small user-owned baked
composition recipe.

```bash
npm install blendlink
npx blendlink addon install
npx blendlink preview --blend assets/hero.blend  # private cached Live Preview Studio
npx blendlink plan --preview # inspect its atlas plan without running Cycles
npx blendlink connect . --blend assets/hero.blend # attach the real website
npm install                  # connect declares site dependencies; you keep ownership
npx blendlink preview        # open + watch the connected website
npx blendlink publish        # Final + verify + site build + verify
```

Requires Node 22.12+ on the Node 22 line, or Node 24. The generated starter
uses Vite 7 and the same tested runtime floor.

CLI commands do not import a renderer. The npm package also carries the lazy
post-processing implementations used by the standard WebGL adapter, so npm may
resolve their compatible `three` peer even in a CLI-only install. A connected
website explicitly owns `three` at exact runtime version `0.184.0` and a
matching r184 `@types/three` patch (`>=0.184.0 <0.185.0`). Blendlink declares
both as optional peers and never lists either package as a direct dependency.
Only the executable Three package is byte/source-profiled; allowing declaration
patches within the same type release avoids pinning websites to an unrelated
declaration-file bugfix. Broader Three runtime ranges are not claimed until
their loader/runtime capability profiles and packed consumers are independently
verified.

The root `blendlink` entry is renderer-neutral and does not load the optional
React or React Three Fiber peers. Import React lifecycle helpers, including
`createUseBlendlink`, from `blendlink/react`; import the Canvas adapter from
`blendlink/react-three-fiber`. This explicit boundary keeps CLI, compiler, and
framework-neutral consumers usable without installing a UI framework.

For the standard Three.js runtime integration, import
`installThreeCompiledScene` from `blendlink/three`. It applies the authored
look, camera, environment, shadows, playback, LODs, reflection probes, portable
Components, and baked states behind one disposable handle. `blendlink connect`
generates a minimal Vanilla integration or a tiny user-owned React Three Fiber
association component. The package-owned `blendlink/react-three-fiber` adapter
keeps loader setup, late-load disposal, camera handoff, resizing, frame updates,
conditional post-processing ownership, errors, and cleanup in one maintained
implementation. `blendlink setup` remains a compatibility alias.
Connect validates React 19 with React Three Fiber 9 before mutation. The
adapter enforces one compiled-scene owner per Canvas and keeps demand-mode
frames active only while installed systems truthfully require them. The ready
handle exposes explicit `fitCamera()` / `resetCamera()` operations and immutable
semantic `accessibleControls` for application-owned anchors and buttons;
Blendlink owns picking and scene behavior, while the website keeps DOM, router,
analytics, focus presentation, layout, and loading UI. Its
attempt-scoped `onLoadStateChange` reports Loading, renderer Preparing, Ready,
and recoverable Failed facts without owning the website's loading screen.
`onPresentationStateChange` separately reports renderer `loading`, atomic
`bootstrap`, promoted `full`, or `failed` quality and the first completed-frame
observation. A completed frame is not a pixel-fidelity, GPU-fence, or display-
compositor guarantee. Applications may pass both callbacks to
`useCompiledScenePresentation()` from `blendlink/react`; it also exposes the
installed scene, immutable accessible controls, baked-quality settlement, Web
Audio readiness, post-processing ownership, and continuous-frame policy. Its
`sceneProps` is one stable generated-scene binding per retry epoch. `retry()`
revokes every old callback synchronously, returns the view to Idle, and
advances `retryKey`; the website still decides whether that key remounts only
the scene or its Error Boundary and Canvas. The same framework-neutral store
is available from `blendlink/scene-presentation`.
Unmount abandons the attempt and aborts private manager-backed requests where
Three and the browser support it; non-abortable decode/compile work is disposed
after it settles rather than mislabeled canceled. Blendlink's private manager
also treats any failed glTF companion as terminal even when Three recovers with
a null texture. An application-supplied loader retains that validation policy
along with its URL, header, credential, progress, and abort ownership.

`blendlink publish [scene]` is the production boundary: it compiles Final,
verifies the selected artifact set, runs the website's own package-manager
`build` script, and verifies again afterward. Use `--assets-only` for an
explicit custom deployment pipeline. An optional
`website.browserSmoke.command` then runs the application's production browser
gate against the verified build. `website.browserSmoke.portEnv` can receive an
OS-assigned loopback port to isolate concurrent runs. Browser/test code can
import `compiledSceneAssetUrls` from `blendlink/assets` without pulling in the
Node compiler barrel. `createBrowserSmokeEvidence` from
`blendlink/browser-smoke` classifies application-recorded asset, console/page,
worker-CSP, decoder/CORS, Canvas, WebGL, visible-pixel, and service-worker facts;
it owns no route, browser, server, or universal pixel threshold. Blendlink does
not upload or infer a hosting provider.

New atlases default to **Bake Lighting**: authored PBR textures and their UVs
stay intact, indirect diffuse GI is written to a separate lightmap UV, and the
generated recipe binds each state through `MeshStandardMaterial.lightMap`.
**Bake Appearance** remains available for an intentionally flattened, unlit
capture of unsupported or stylized material graphs. Older recipes retain that
legacy Appearance behavior until the artist changes them explicitly.
The Lighting preflight names connected emissive meshes and an unpublished
non-black Blender World whose illumination would not have an equivalent owner
in Three.js, then recommends an exported Light, a published HDR, or Appearance.
This standard integration is deliberately WebGL-only. It fails clearly for a
`WebGPURenderer`; WebGPU applications consume the portable assets and typed
descriptor through an application-owned renderer adapter.

`blendlink preview --blend <saved.blend>` needs no website project. It creates
or reuses a disposable Vite/Three viewer in a private per-scene user cache,
installs that viewer's declared dependencies when needed, compiles Preview
quality, opens the verified local URL, and remains active as a save watcher.
Every subsequent Blender save recompiles through the same single-flight Preview
path and refreshes the site. An export failure is reported while the last good
preview remains available; unsaved depsgraph edits are not streamed.
The Studio reports **Ready** only after the current generation has been
installed, shader-compiled, rendered, and acknowledged by the matching browser
session. Until then it remains visibly Preparing, Compiling, or Validating; a
failed or stale candidate never replaces the active scene.

Pause, Reset view, background, fullscreen, and Details controls keep common
artist checks one click away. The drawer adds Fit window, Desktop, and Mobile
viewport presets, build statistics, Web Checks, and published baked-state or
Light Group controls. These conveniences exist only in the private Studio and
do not modify a connected site's UI.

Preview resolution uses a 256 px per-atlas readability floor unless the Final
atlas itself is smaller. Target detail and pixel margins scale with each
atlas's actual Preview ratio, preventing a Final-size gutter from swallowing a
reduced preview island. `blendlink plan <scene> --preview [--json]` reports
those exact Preview settings without Cycles; the unqualified `plan` reports
Final.
`--no-open` leaves browser control to the caller. A normal `blendlink preview`
provides the same save-driven loop while keeping the connected site's own dev
command and reported URL.

Realtime and PBR-preserving Hybrid materials publish through Blender's stock
glTF exporter, including the Principled inputs and KHR material extensions it
supports. Blendlink does not claim a separate shader translator: Material
Properties reports **Exact glTF**, **Approximated**, or **Needs Bake** from the
active surface graph. Unsupported procedural branches are named so the artist
can simplify them, choose an Appearance bake, or intentionally provide a
website runtime material.

When connect attaches an existing site, it never edits application source.
Follow its printed hookup action—add the generated component inside a WebGL
R3F Canvas or call the generated Vanilla installer—before judging the scene in
the real site's layout.
Generated R3F components accept a typed `onReady` callback with the complete
advanced installed handle, so integration code can select baked states, adjust
light groups, or control animation. It is borrowed: the component retains
lifecycle/disposal ownership, and callers must not dispose it while mounted.
Ready children should prefer the generated `use<Scene>Scene()` hook for the
ownership-safe application interface:

```tsx
<WorkbenchScene
  onReady={(scene) => {
    console.log(scene.animation?.availableClips)
    scene.animation?.play('Wave')
  }}
/>
```

The renderer-neutral animation transport also exposes immutable `state`,
`subscribe`, deterministic `playAll`, `pause`, authored-seconds `seek`, and
replayable `stop`. Blendlink retains the mixer, frame loop, and terminal
disposal. Callback identity changes do not reinstall the scene; the component
retains disposal ownership. Installation failures publish Failed and are
rethrown during render for the nearest React Error Boundary; status and ready
callback exceptions are isolated and logged. It takes R3F render priority only
while an authored post-processing
component needs the installed composer; otherwise Fiber keeps its normal render
ownership. Demand-mode Canvases render the initial visible static frame, stay
awake while known installed systems require continuous frames, and settle
again when they are idle. Newly active Blendlink-owned runtime work begins at
delta zero, and later R3F update/composer deltas are capped at 100 ms so a
blocked tab or slow frame cannot skip a complete one-shot action. The
application's R3F clock and explicit low-level playback updates remain exact.
For an application-owned loading/error/control surface:

```tsx
import { useCompiledScenePresentation } from 'blendlink/react'

const presentation = useCompiledScenePresentation()

<SiteSceneErrorBoundary key={presentation.retryKey}>
  <Canvas>
    <WorkbenchScene {...presentation.sceneProps} />
  </Canvas>
</SiteSceneErrorBoundary>

{presentation.phase === 'failed' ? (
  <button type="button" onClick={presentation.retry}>Retry scene</button>
) : null}
```

Render `presentation.accessibleControls` as native links/buttons and call
`presentation.scene?.components.audio.resume()` directly from the site's
trusted Enable Sound click when `presentation.presentation?.audio.state` is
`blocked`. Blendlink observes readiness; the site owns the gesture and UI.
Use `assetBaseUrl` on the generated definition for a Next/Vite base path or CDN
root. The package rebases only compiler-owned scene/Basis requests; a supplied
application manager or loader keeps its own URL, headers, credentials, cache,
progress, dependency-failure enforcement, abort, and disposal ownership.

Internally compiled scenes are activated from a complete
`<scene>/<full-sha256>/` graph. Hosts may import
`compiledSceneImmutableAssetPolicy(scene[, assetBaseUrl])` from
`blendlink/assets` to obtain the exact graph prefix and
`public, max-age=31536000, immutable`. Blendlink returns policy data; it does
not edit Next, Vite, CDN, or deployment configuration. Stable compatibility
paths and old graph retention remain deliberately separate from this header.
If an addressed graph is corrupt, remove the exact complete digest directory
reported by `blendlink verify` before compiling again; Blendlink will not
mutate an immutable graph in place. Valid stable compatibility atlases can seed
the existing fingerprint/hash-checked incremental bake cache during that
repair, without becoming runtime authority.

The first portable Components library includes selective/bright Bloom,
Vignette, Chromatic Aberration, DPR-stable Pixelation, bounded
Contrast-Adaptive Sharpen, Tilt Shift, N8AO Ambient Occlusion, Outline, 3D LUT
Color Grade, object- or distance-focused Depth of Field, a preview anisotropic
Kuwahara treatment, Keep Visible Through Objects, click/hover/visibility
behaviors, Website Surface, Look At, click-to-play animation, and spatial or non-spatial audio.
Installed audio reports `unavailable`, `blocked`, `ready`, or `failed`, resumes
the shared Web Audio context synchronously from trusted activation, and begins
authored playback only after the context is running. Disposal removes Blendlink
listeners and leases but never closes the application/global Three context.
Records use stable
IDs, a separate component schema version, scene/object targets, and plain JSON
values. Post effects lazy-load one pmndrs pipeline, fuse compatible stages,
retain the authored tone mapper after HDR effects, and expose the resolved
order. The standard adapter returns `update`, `render`, `resize`, and `dispose`
lifecycle through the installed scene; call `installed.render(deltaSeconds)`
in place of direct `renderer.render(...)` so authored post-processing can run.
Sites may add namespaced `componentAdapters`; an enabled type without an
adapter fails loudly. Rigidbody/Collider stay in their existing canonical
object metadata, and multiplayer components are outside Blendlink's scope.
In Blender, the categorized task search shows consequence, cost,
compatibility, docs, and target readiness. Safe versioned copy/paste preserves
extension JSON and reports changed/already-matching/skipped/error targets;
malformed known values and unresolved references never coerce silently. Spatial
Audio uses linear full rolloff, so **Silent Beyond** means zero gain at and past
the authored outer radius.

A Website Surface is one separate Realtime, single-material Mesh with finite,
full-square 0..1 UV0 and a scene-unique lowercase name. The application supplies and retains an
`HTMLCanvasElement` or `OffscreenCanvas`; Blendlink isolates the Three material,
wraps the canvas as sRGB, requests a demand frame when pixels change, and
restores/disposes only its own resources:

```ts
const screen = scene.websiteSurfaces.bindCanvas('monitor-screen', appCanvas)
drawScreen(appCanvas)
screen.changed()
screen.dispose()
```

Vanilla installed scenes and the generated ready-only R3F handle expose the
same interface; R3F narrows the name from the generated descriptor when
possible. The site still owns drawing, input, Canvas, DOM, route,
accessibility, and analytics. Website Surface never aliases baked
`setState()`. V1 refuses a material slot inside an Appearance-baked object and
independently validates UV0 bounds (`1e-5`) and square-edge coverage (`1e-4`)
in the add-on, exporter, and runtime. The sRGB live canvas uses Clamp-to-Edge,
Linear min/mag, anisotropy `1`, no mip generation, and identity transform/full
UV0 rather than inheriting fallback `KHR_texture_transform`. Display preserves
the authored fallback texture object and tint while unbound, neutralizes tint
only while application pixels are bound, and conditionally restores both on
disposal.

Simple clip autoplay remains the default. An opt-in authored NLA Sequence can
publish one validated Blender NLA track with ordered Action strips, trims,
speed/scale, repeat, reverse, Replace/Add, blend envelopes, weight, easing,
extrapolation, mute, loop, and duration. Export stages only referenced Actions
and restores the authored stack; unsupported or overlapping strip semantics
fail before publication. The one-call installer schedules the sequence
deterministically and gives it precedence over simple autoplay.

For KTX2 scenes, internal sync and generic `blendlink typegen` both publish the
attributed Three/Basis transcoder directory beside the local GLB; the one-call
installer configures and owns `KTX2Loader` automatically. A deployment that
relocates the GLB must mirror that sibling directory or provide an
application-owned loader.

Generic Meshopt GLBs are equally self-describing: typegen records required
`EXT_meshopt_compression`, and the runtime configures the official decoder even
when the asset has no Blendlink optimization report. Generated descriptors
include exact decoded Meshopt bytes. Awaited high-level loads use a bounded
1-2 worker lease only at 4 MiB or larger, share it across concurrent Blendlink
loads, and release it after the last load settles; small, unknown-size, SSR,
and worker-incompatible loads decode on the main thread. Pass
`meshoptWorkerCount: false`/`0` to force main-thread decoding, or pass an
application-configured `meshoptDecoder` to retain ownership of its global pool;
Blendlink never calls `useWorkers()` on that override. The owned decoder is
mutually exclusive with Blendlink's worker count/threshold. You can instead override
`meshoptWorkerCount` (maximum four) and
`meshoptWorkerThresholdBytes` after measuring representative devices.
Configure-only loader calls never start workers.

Use `npx blendlink perf [scene] --tier mobile|balanced|showcase` for a truthful
compiled-artifact/build-budget report. It validates the manifest against the
exact GLB, decodes required Meshopt streams, separates GLB bytes, decoded
accessors, the geometry-only accessor subset, embedded images, GPU-texture
evidence, triangles, estimated draws, animation bytes, and verified atlas-
delivery savings. It ranks dominant triangle and decoded-geometry contributors
independently. A non-blocking visual-parity advisory reports how many used
materials and rendered triangles still need baking; complete all-default
material-payload collapse remains a failure, as does a selected budget overrun
under `--fail`. Browser performance still remains separate measured evidence. For real sessions,
`createRuntimePerformanceMonitor()` records Resource Timing bytes, frame
p50/p95/p99, long tasks, `renderer.info` peaks, and non-blocking
`EXT_disjoint_timer_query_webgl2` samples with disjoint results rejected. The
monitor is opt-in and renderer-neutral; it never presents static counts as a
frame-rate measurement.

If website code deliberately supplies every material for an otherwise
collapsed artifact, configure a per-scene `applicationMaterialAdapter` with
`acknowledgePayloadCollapse: true` and a concrete `description`. Verification
then emits a loud accepted-risk warning instead of an impossible GLB-only
failure; the application browser gate must prove that named adapter. The
acknowledgement is intentionally not a general material-warning suppression.

```ts
import { createRuntimePerformanceMonitor } from 'blendlink'
import { collectThreeTextureEvidence } from 'blendlink/three'

const performanceMonitor = createRuntimePerformanceMonitor()
performanceMonitor.start()

function renderMeasuredFrame(requestAnimationFrameTimestamp: number, deltaSeconds: number) {
  installed.update(deltaSeconds)
  // Call this instead of rendering the scene a second time. The RAF timestamp
  // keeps frame intervals on the browser's performance clock.
  performanceMonitor.sample(
    renderer,
    () => installed.render(deltaSeconds),
    requestAnimationFrameTimestamp,
  )
}

const runtimeReport = await performanceMonitor.finish(renderer)
const textureEvidence = collectThreeTextureEvidence(installed.root)
```

`finish()` stops the measurement and returns explicit capability reasons when
Resource Timing, long-task observation, renderer counters, or GPU timer queries
are unavailable. Call `dispose()` instead when abandoning a measurement.
`collectThreeTextureEvidence()` deduplicates live Three textures and reports
their selected target family, roles, mip chain, and block-aware standard format
payload. Driver-private allocation overhead and unrecognized formats remain
explicitly unknown.

Generated `<scene>.baked.ts` files remain editable and are never silently
overwritten. The installer awaits their `ready` contract; use
`setStateAsync()` when a UI transition must know decoding succeeded. If
`verify` reports an older template, `blendlink recipe update <scene>` first
backs up the exact file and then installs the current baked-composition template.
Current recipes also bound inactive loader-owned state textures with a
device-aware decoded RGBA+mipmap LRU. Override it with
`bakedTextureCacheBytes` on `installThreeCompiledScene()`, or call the generated
factory directly with `{ textureCacheBytes }`; active, loading,
promoted-default, and application-adopted textures remain pinned.

Baked atlas delivery defaults to predictable authored quality: the highest
advertised tier. Pass `bakedAtlasDeliveryQuality: 'adaptive'` to the installer
to opt into viewport/device selection, or a positive resolution such as `1024`
to select the smallest advertised tier at or above it. Direct recipe callers use
the same values through `{ atlasDeliveryQuality }`. An R3F host may pass
`bakedAtlasDeliveryQuality` on the generated scene component to override only
that Canvas mount—for example, a developer lab can use `"adaptive"` while the
public hero keeps the authored default.

The complete artist workflow, Blender UI guide, contracts, and research live
in the [Blendlink repository](https://github.com/michaelrowejones/Blendlink).

The npm tarball is a mixed-license aggregate and declares
`SEE LICENSE IN LICENSES.md`. Its Node/compiler/runtime files are MIT;
Blender-dependent Python and the add-on aggregate are GPL-3.0-or-later; bundled
Basis notices are Apache-2.0. The tarball's `LICENSES.md` maps those file-level
licenses and points to their complete texts/notices.
