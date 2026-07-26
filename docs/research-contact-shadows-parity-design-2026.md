# Contact Shadows: Needle parity and a provable idle-cost improvement

- Audit date: 2026-07-23
- Needle Blender add-on: `1.4.2`
- Needle runtime: `@needle-tools/engine 5.1.7`
- Needle Three fork: `@needle-tools/three 0.169.19`
- Blendlink comparison target: package `0.8.0`, Three `0.184.0`
- Scope: Contact Shadows authoring, capture/blur algorithm, update policy,
  renderer ownership, disposal, context loss, and differential evidence
- Production result: shipped as a Preview first-party component through
  `threeContactShadows.ts`, the shared component installer, and the Blender
  authoring schema

## Decision

Blendlink should first match Needle's visible WebGL result, but it should not
copy Needle's unconditional five auxiliary renders on every host frame.

The recommended design is a deep package-owned `threeContactShadows` module
behind the existing portable-component seam:

1. the artist record contains the six Needle outcome controls plus an explicit
   `static` or `continuous` update policy;
2. the Three adapter performs the same one depth capture and two separable
   blur rounds when a refresh is required;
3. `static` is the default and performs one refresh after installation, recipe
   changes, quality changes, and context restoration;
4. `continuous` truthfully keeps the host render loop active for arbitrary
   animation;
5. every renderer/scene mutation is restored in `finally`;
6. the application retains its route, Canvas, renderer, main render loop, and
   loading presentation; and
7. Contact Shadows remains opt-in because silently stacking it over baked
   grounding is outside Blendlink's product contract.

This gives a testable improvement without changing the matched visual
algorithm:

```text
unchanged static scene after the first refresh
Needle default:    5 auxiliary renders per host frame
Blendlink target:  0 auxiliary renders per later host frame
```

That comparison is now browser-verified. The actual pinned Needle 5.1.7 class
and Blendlink production module produced byte-identical settled `512 x 512`
RGBA8 masks in Chromium: alpha MAE/RMSE/maximum error `0`, Pearson `1`, five
top-level renders, and five observed GL draws each. Blendlink then performed
zero auxiliary renders over 120 unchanged static frames, while Needle's
default and Blendlink's explicit Continuous mode each performed five on every
observed frame. See
[the differential record](research-contact-shadows-differential-browser-2026.md).

Three r184 now also has an official TSL/WebGPURenderer contact-shadow example.
It is an important future adapter, not a drop-in replacement for the current
website-owned `WebGLRenderer`: the official migration guide says node
materials/TSL belong to `WebGPURenderer` (which can use WebGPU or its WebGL 2
backend), while classic `WebGLRenderer` remains the recommended pure-WebGL
renderer. Blendlink must not swap the application's renderer to claim parity.

## Evidence boundary

The pinned Needle inventory passed before relying on it:

```text
npm.cmd run verify:needle-baseline
BLENDLINK_NEEDLE_BASELINE_VERIFIED 68 files, 5 version identities (2026-07-23)
```

The deterministic cost/state prototype also passed:

```text
node experiments/contact-shadows-policy-prototype.mjs
```

It proves arithmetic and the proposed `try/finally` transaction shape only:

- a Needle-equivalent refresh is one depth render plus four blur renders;
- four `512 x 512`, nine-tap blur passes perform `9,437,184` texture samples;
- over 600 host frames, continuous policy performs 3,000 auxiliary renders;
- a static scene performs five total auxiliary renders;
- injected failures at the depth pass and each of four blur passes restore the
  prototype's exact pre-existing state; and
- explicitly depthless WebGL targets have 2 MiB of specified RGBA8 attachment
  storage versus 3.5 MiB of specified RGBA8 + DEPTH_COMPONENT24 attachments
  in Needle's two default targets.

The byte counts describe attachment formats, not driver allocation. The
prototype does **not** prove browser pixels, actual GPU memory, GPU time,
context restoration, skinning, alpha cutouts, or integration with R3F.

## Implementation resolution

The preferred deep-module design shipped without adding a manifest family or
taking ownership of the application's Canvas:

- Blender authors Auto Fit, Darkness, Opacity, Blur, Occlude Below Ground,
  Backface Shadows, and Static/Continuous update policy on either Scene or an
  Empty; cardinality remains one Contact Shadows owner per scene.
- `threeContactShadows.ts` owns the private camera, display plane, blur plane,
  materials, and two depthless/stencilless render targets. It matches Needle's
  one depth capture and two two-pass blur rounds.
- Static is the default. Generation-aware dirty scheduling requests one host
  frame after installation, relevant changes, or context restoration;
  Continuous truthfully remains active.
- Every renderer and scene mutation is restored through a transaction even
  when an injected auxiliary render throws. Listener registration rolls back,
  disposal is idempotent, and shared application resources are not disposed.
- Owned helpers retain the application camera's layer mask. Transparent and
  `allowOverride=false` materials are excluded using public Three material
  state rather than a private engine override flag.

Focused production tests cover authoring/serialization, bounds, pass order,
update scheduling, injected failure restoration, listener rollback, context
generation, layer ownership, and disposal. The real browser differential adds
exact settled-mask, render-count, attachment configuration, non-default camera
layer, and material-exclusion evidence. A production R3F dogfood route,
physical-GPU timing, alpha-cutout/backface matrices, and browser context-loss
pixels remain acceptance work rather than hidden claims.

## Exact source identity

`docs/needle-baseline.json` is the identity authority. The files material to
this audit are:

| Source | Version / immutable revision | SHA-256 |
| --- | --- | --- |
| `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/ContactShadows.ts` | `@needle-tools/engine 5.1.7` | `e4bd8398c59d47ad3bd2eef66625b03c14f260e678d27a332a8ad73d4c17733b` |
| `$NEEDLE_ADDON_ROOT/settings_scene.py` | Needle add-on `1.4.2` | `6e02da2ab32558fb042f0000c863bc6631176458ceb06534d9afcd5061dfd063` |
| `$NEEDLE_ADDON_ROOT/panels_project.py` | Needle add-on `1.4.2` | `b3cdc2981e48d5bd50fb3ecf255fc51c3e4035c687a84fbbd4276985514541d0` |
| `$NEEDLE_ADDON_ROOT/extensions/NEEDLE_components_postprocess.py` | Needle add-on `1.4.2` | `90cdd4fbd883858816d36ea1605e75fd820c4bcac2e8d8c87e76a465eb1ce031` |
| `$NEEDLE_ADDON_ROOT/data/builtin.component.json` | Needle add-on `1.4.2` | `d32f28bc6beb4379dcce1b12e114c389f56e493e4e0820123c9a500dfb867382` |
| `experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/src/core/RenderTarget.js` | `@needle-tools/three 0.169.19` | `5bb802e2816441c38837db03b4a93a78ec462129d3149501221cb5d1f6e615f9` |
| `experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/src/renderers/webgl/WebGLTextures.js` | `@needle-tools/three 0.169.19` | `c0bafdedca70fc5d654ce25781508faee32e0e8b7e0fcd1cb9ea86883c8b4a66` |
| `node_modules/three/package.json` | Three `0.184.0` | `8308e43d6d6dd4c636c2dfe2e724da07dcd9fe4349bba6afb56f2c5ba6625391` |
| `node_modules/three/examples/jsm/shaders/HorizontalBlurShader.js` | Three `0.184.0` | `a155715ca3bfe4fd1f9efc51f189fecd5c53160df47dd571a7d5936dc436ab0c` |
| `node_modules/three/examples/jsm/shaders/VerticalBlurShader.js` | Three `0.184.0` | `67792abdf08ba2305fc2a2f45ca151f55b66a82f5aebbe45230246cdb72181d7` |
| `node_modules/three/examples/jsm/tsl/display/GaussianBlurNode.js` | Three `0.184.0` | `677f8388b9072b2f9ea3b24d5543299038e9ee76ba4dcf603b1ba8b0ab9f7870` |
| `node_modules/three/src/core/RenderTarget.js` | Three `0.184.0` | `fbaaf889c8ba95c8e88d391ba1fad3b88b6bf63b7e15119f2786dad8f63ea1c0` |
| `node_modules/three/src/renderers/WebGLRenderer.js` | Three `0.184.0` | `f42d1f7e2dddf575a2f8528fe5a561078f87eadc09ed5e805c64461b068b29de` |
| `node_modules/three/src/renderers/common/RendererUtils.js` | Three `0.184.0` | `11e8c6da6f70545364b7a83715bb47f35ef4eb063b4e33a11ebe2c840147de61` |

The two official example HTML files are not shipped in the npm package. Their
immutable Three `r184` sources were inspected directly:

- [WebGL contact-shadow example](https://github.com/mrdoob/three.js/blob/r184/examples/webgl_shadow_contact.html)
- [WebGPU/TSL contact-shadow example](https://github.com/mrdoob/three.js/blob/r184/examples/webgpu_shadow_contact.html)

## What Needle actually does

### Authoring has two inconsistent entry points

Needle's project setting is enabled by default. It exports `autoFit = true`
and copies one Darkness value into both `darkness` and `opacity`. The project
range is `0..2` with default `0.5`.

The generic component instead exposes:

- `autoFit`
- `darkness`
- `opacity`
- `blur`
- `occludeBelowGround`
- `backfaceShadows`

Its catalog defaults/ranges disagree with both the project setting and runtime
class. The catalog defaults darkness/opacity to `1`, limits darkness to
`1..5`, and defaults the below-ground occluder to `true`. The runtime class
defaults darkness/opacity to `0.5`, `autoFit` to `false`, and the occluder to
`false`.

Blendlink should match the artist outcomes but publish one coherent contract;
reproducing this disagreement would not be parity.

### Runtime is five auxiliary renders per update

Needle allocates two fixed `512 x 512` default WebGL render targets, one
orthographic camera, one depth material, two blur materials, one display
plane, and an optional below-ground occluder.

Unless developer code sets its non-serialized `manualUpdate`, every
`onBeforeRender` performs:

1. one top-down scene render with `MeshDepthMaterial`;
2. horizontal blur at `blur * 2`;
3. vertical blur at `blur * 2`;
4. horizontal blur at `blur * 0.5`; and
5. vertical blur at `blur * 0.5`.

The installed Three horizontal/vertical shaders specify nine texture samples
per fragment. At `512 x 512`, the four full-target blur passes therefore issue
this structural workload per refresh:

```text
512 * 512 * 4 passes * 9 samples = 9,437,184 texture samples
```

At 60 host frames per second, Needle's default path structurally requests 300
auxiliary renders and roughly 566 million blur texture samples per second,
before counting depth-scene work, main rendering, bandwidth, blending, or
driver overhead. This is not measured GPU timing.

### Autofit is event-driven, not animation-aware

`fitShadows()` excludes the helper root, bounds the scene, expands X/Z based
on blur, places the plane at scene minimum Y, and uses the capture volume's Y
scale as maximum shadow height. A `scene-content-changed` event marks the
effect dirty and requests refit.

The source explicitly says animated transform auto-refit is not reliable and
is not implemented. Blendlink therefore does not need a per-frame bounding-box
scan to claim match, but its limitation and update policy must be loud.

### Renderer ownership is incomplete

The capture path temporarily mutates:

- active render target;
- clear alpha;
- XR enabled state;
- scene background;
- scene override material;
- scene `matrixWorldAutoUpdate`;
- a render-list `transparent` array; and
- selected object visibility.

It restores those values only on the normal path. There is no `try/finally`,
and `scene.overrideMaterial` is restored to `null`, not to the value observed
before capture.

Needle also depends on a private render-list behavior: it swaps the list's
public `transparent` property while Three's internal closure continues to
populate its original transparent array. It scans the previous opaque list to
hide colorless, wireframe, line, point, and custom-excluded objects. This
should be treated as pinned implementation behavior, not a stable Three
interface.

Destroy disposes two targets, depth/blur materials, and helper geometries, but
does not explicitly dispose the visible plane material or occluder material.
These are source facts, not measured leak evidence.

## Three r184 has two different official paths

### Classic WebGL example

The current WebGL example still matches the broad Needle algorithm:

- two `512 x 512` targets;
- one depth capture;
- two horizontal/vertical blur rounds; and
- five auxiliary renders per animated frame.

The example also restores the render target to `null` and override material to
`null` rather than preserving arbitrary application owners, and it has no
`try/finally`. It is example code, not an ownership-safe module.

### TSL/WebGPURenderer example

Three r184 added a separate TSL example. It uses:

- one `512 x 512` color+depth capture target;
- `NodeMaterial` for the depth mask and display plane;
- `GaussianBlurNode` for one horizontal and one vertical pass; and
- one depth plus two blur renders per host frame.

`GaussianBlurNode` owns two additional depthless render targets and restores a
broader renderer state with `RendererUtils`. It still updates once per frame
(`NodeUpdateType.FRAME`) and its restore path is not protected with
`try/finally`.

Fewer render calls do not prove lower GPU work. With the example's `sigma = 4`,
the installed node computes a kernel size of 11 and samples the center plus
two samples for offsets 1 through 10: 21 texture samples per blur fragment.
Its two `512 x 512` blur passes structurally issue `11,010,048` texture
samples, 16.7% more than Needle's four nine-tap passes. It may still win on
pass setup, bandwidth locality, or visual quality; only GPU timing and pixels
can decide.

Its specified attachment storage is also nominally 3.75 MiB: one RGBA8 +
DEPTH_COMPONENT24 capture target and two depthless RGBA8 blur targets.

The official
[WebGPURenderer migration guide](https://threejs.org/manual/en/webgpurenderer)
states that TSL/node materials are supported by `WebGPURenderer`, which uses
WebGPU by default and WebGL 2 as fallback. It also says `WebGLRenderer` remains
the recommended choice for pure WebGL applications. This makes a TSL adapter
a real second renderer adapter, not a transparent implementation detail.

## Quantified design comparison

The figures below are structural counts for one `512 x 512` effect. They are
not browser measurements.

| Design | Auxiliary renders per refresh | Blur samples per refresh | Specified attachment storage | Unchanged static frame |
| --- | ---: | ---: | ---: | ---: |
| A. Literal Needle WebGL | 5 | 9,437,184 | 3.5 MiB | 5 renders |
| B. Deep WebGL, matched blur, depthless targets | 5 | 9,437,184 | 2.0 MiB | 0 after initial refresh |
| C. Three r184 TSL/WebGPURenderer | 3 | 11,010,048 | 3.75 MiB | 3 renders in the example |

Design B removes two unused depth attachments. Both Needle's depth material
and blur materials disable depth testing/writes, so their depth buffers do not
contribute to the result. The specified attachment-format reduction is
`(3.5 - 2.0) / 3.5 = 42.9%`. Actual driver memory must be measured separately.

For 600 host frames (ten seconds at 60 Hz):

| Policy | Refreshes | Auxiliary renders | Blur samples |
| --- | ---: | ---: | ---: |
| Needle/continuous | 600 | 3,000 | 5,662,310,400 |
| Static unchanged | 1 | 5 | 9,437,184 |
| On-change, ten refreshes | 10 | 50 | 94,371,840 |

Design B is selected for the current WebGL adapter because it preserves
application renderer ownership, can first match Needle pixels, and has an
independently falsifiable idle-cost improvement. Design C should be a future
adapter when Blendlink has a real WebGPURenderer caller and cross-renderer
fixtures; one hypothetical adapter is not a reason to introduce a renderer
seam.

## Recommended deep module

The external seam should remain the existing component adapter. Internally,
one module owns fitting, targets, materials, pass accounting, state leases,
context events, and disposal:

```ts
installThreeContactShadows({
  scene,
  renderer,
  anchor,
  values,
  quality,
  requestFrame,
  diagnostics,
}): RuntimeComponentInstallation
```

The portable record stays renderer-neutral. Recommended artist fields:

- `autoFit: boolean`
- `darkness: number`
- `opacity: number`
- `blur: number`
- `occludeBelowGround: boolean`
- `backfaceShadows: boolean`
- `updatePolicy: "static" | "continuous"`

Resolution is runtime quality policy, not art direction. The parity fixture
must use `512`. Lower resolutions can ship only as separately evidenced
quality modes.

The returned runtime installation needs only the existing lifecycle:

- `beforeRender()` refreshes when dirty or continuous;
- `setQuality()` reallocates only when the resolved quality changes, marks
  dirty, and requests a frame;
- `isActive()` returns true while initially dirty or continuously updating;
- `dispose()` is idempotent and releases every owned target, material,
  geometry, and DOM listener.

`static` should mark itself dirty on install, component-value replacement,
quality change, and `webglcontextrestored`. A later `on-demand` policy can be
added only when a real caller exists: the application already owns R3F
`invalidate()`, and the official R3F performance guide says invalidation
coalesces a requested frame rather than rendering immediately. A special
Contact-Shadows-only application method would make the generic component
interface shallower.

For arbitrary website-authored object animation, the truthful first contract
is `continuous`. Compiler-known Blendlink animation can later select or
recommend that policy automatically, but static must never claim to observe
all vertex shader, skinning, morph, physics, or application mutations.

## Renderer-state transaction

Every refresh must capture and restore the exact observed values:

| Owner | State | Needle 5.1.7 | Blendlink target |
| --- | --- | --- | --- |
| Renderer | render target, cube face, mip level | target only | exact tuple |
| Renderer | clear color and alpha | alpha only | exact color + alpha |
| Renderer | `autoClear` | unchanged/implicit | exact value if changed |
| Renderer | XR enabled | restored on success | restore in `finally` |
| Scene | background | restored on success | restore in `finally` |
| Scene | override material | reset to `null` | exact prior identity |
| Scene | `matrixWorldAutoUpdate` | restored on success | restore in `finally` |
| Objects | visibility | restored on success | token/identity-aware restore in `finally` |
| Three internals | render-list arrays | private mutation | do not mutate |

The module should traverse candidate objects before the render and hide
unsupported helpers explicitly, recording only objects it changes. This is
more stable than replacing `renderer.renderLists` internals. It must restore a
changed object only when the value still equals the module-installed value, so
an application callback that assumes ownership is not overwritten.

The shader patch must assert that the expected Three depth-shader seam was
actually replaced. A missing seam is a loud install/render failure, not a
fallback to the wrong mask.

Alpha-tested cutouts require their own evidence. Needle's scene-wide override
material does not carry each source material's alpha map/test into the shared
depth shader. Blendlink may initially match that limitation, but preserving
cutouts through cached per-source depth materials is a candidate Improvement,
not something to claim from a generic depth override.

## Cancellation, disposal, and context loss

There is no network request to abort and no honest way to interrupt a
synchronous `renderer.render()` already in progress. The cancellation
contract should therefore be precise:

- disposal before the next requested frame prevents the refresh;
- disposal after a synchronous refresh releases all owned resources;
- disposal is idempotent;
- calls after disposal fail loudly through the existing runtime lifecycle;
- Blendlink does not dispose or force-loss/restore the application renderer;
- no `AbortSignal` claim is made for GPU work or shader compilation.

Three r184's `WebGLRenderer` handles `webglcontextlost` and reinitializes its
internal GL state on `webglcontextrestored`. Component JS objects remain, but
a static contact-shadow texture must be rendered again after restore.
Therefore the module should own one `webglcontextrestored` listener on
`renderer.domElement`, mark itself dirty, call the provided `requestFrame`,
and remove the listener on disposal. It may mark dirty on context loss but
must not attempt auxiliary renders while the context is lost.

The browser gate should use Three's official `forceContextLoss()` /
`forceContextRestore()` methods when the
[`WEBGL_lose_context`](https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/)
extension is available. WebGPU device-loss behavior remains Pending until a
WebGPURenderer adapter exists.

## Differential evidence plan

### 1. Deterministic unit seam

Inject a narrow renderer adapter into the deep module and test:

- exactly one depth + four blur renders per refresh;
- static install: one refresh, then `isActive() === false`;
- continuous: one refresh for every host `beforeRender`;
- resize/quality/context restore marks static dirty and requests one frame;
- repeated invalidations coalesce at the host, not inside the module;
- renderer target/cube face/mip level, clear color/alpha, XR, `autoClear`,
  scene background, override material, matrix policy, and changed visibility
  are exact after success;
- an injected throw at each of five stages restores the same state;
- a pre-existing non-null override material is preserved;
- no access to `renderer.renderLists`;
- every owned target/material/geometry/listener disposes exactly once;
- later application visibility ownership is not overwritten; and
- a missing depth-shader patch seam fails with component identity.

This proves control flow and ownership only.

### 2. `contact-shadows-differential` browser fixture

Use the same GLB bytes, camera matrices, `800 x 800` viewport, DPR 1, color
space, tone mapping, and exposure in Needle and Blendlink. Include:

- opaque closed mesh;
- thin open/backfacing mesh;
- alpha-tested cutout;
- wire, line, points, and `colorWrite = false` helpers;
- object below ground;
- moving and static objects;
- translated/scaled parent;
- a pre-existing non-null `scene.overrideMaterial`;
- baked-grounding, N8AO, and realtime-shadow variants; and
- static and continuous policies.

Capture the raw contact mask before main-scene composition as well as the final
canvas. Establish the threshold from three repeated same-implementation
captures first. Proposed acceptance after repeatability is known:

- mask SSIM at least `0.995`;
- no more than `0.5%` of mask pixels above absolute alpha error `0.05`;
- shadow support bounding-box edges within one pixel;
- backface and below-ground toggles independently change named regions; and
- excluded helpers contribute zero pixels.

Those numbers are proposed gates, not passed results. If normal same-build
repeatability exceeds them, record and justify a revised threshold before
comparing implementations.

### 3. Render-count and demand-loop browser gate

Instrument only the auxiliary module's renderer seam, not the application's
whole renderer:

- Needle default: observe five auxiliary renders for each host frame;
- Blendlink continuous: observe the same five;
- Blendlink static: observe five on the first frame and zero on the next 120
  unchanged host frames;
- R3F demand mode settles after the first static refresh;
- quality/resize/context restore requests exactly one new host frame; and
- a disposed static instance never requests or renders another frame.

This is the smallest fixture that can promote the idle-cost claim from Pending
to Verified.

### 4. CPU/GPU performance evidence

Warm up shader programs and collect at least 120 non-disjoint samples for each
design/quality/device. Report CPU and GPU separately:

- CPU: `performance.now()` around the complete refresh transaction, median,
  p95, and scene traversal time;
- GPU: Khronos
  [`EXT_disjoint_timer_query_webgl2`](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)
  around the complete auxiliary refresh; poll asynchronously and discard every
  sample where `GPU_DISJOINT_EXT` is true;
- devices: one integrated desktop GPU and one representative mobile device;
- metrics: refresh GPU ms, CPU ms, render count, resolution, caster
  triangles/draws, and renderer version.

Do not infer GPU speed from render count or texture-sample arithmetic. Compare
the matched five-pass WebGL design with Three r184's three-pass TSL design only
under an application-declared WebGPURenderer harness.

### 5. Context-loss and resource gate

After a successful static render:

1. force context loss and restoration;
2. assert one refresh is requested and the mask reappears;
3. repeat install/render/dispose five times;
4. assert Three `renderer.info.memory.textures/geometries` returns to the
   warmed baseline after a flush frame; and
5. verify all component listeners are removed.

`renderer.info` is a coarse observation, not proof of driver memory. Treat the
2 MiB attachment-format claim and actual resource-stability claim separately.

## Capability records

Implementation and evidence remain separate.

| Capability ID | Comparison | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- |
| NDL-CS-001 | Blender-authored auto-fit, darkness, opacity, blur, below-ground occlusion, and backface policy | **Match** | **Shipped (Preview)** | Add-on schema/headless and focused runtime tests pass; the browser differential covers the manual-volume subset, while auto-fit/backface/below-ground pixel matrices remain Pending |
| NDL-CS-002 | One top-down depth capture plus two separable blur rounds | **Match** | **Shipped (Preview)** | Actual pinned Needle 5.1.7 and Blendlink settled masks are byte-identical in the controlled Chromium fixture; both submit five draws |
| NDL-CS-003 | Static idle policy versus Needle's default every-frame update | **Improvement** | **Shipped (Preview)** | Browser-verified: Blendlink Static `5` then `0/120`; Needle default and Blendlink Continuous `[5,5,5]` |
| NDL-CS-004 | Exact state restoration on any auxiliary-pass failure | **Improvement** | **Shipped (Preview)** | Production injected-failure unit cases restore renderer/scene state at every pass; equivalent real-browser failure injection remains Pending |
| NDL-CS-005 | Automatically enable Contact Shadows for every project | **Boundary** | **Shipped opt-in only** | Blendlink will not silently double-ground baked/AO/realtime scenes; an integrated conflict-warning matrix remains Pending |
| NDL-CS-006 | Omit unused depth attachments | **Improvement** | **Shipped (Preview)** | Actual browser targets report Needle depth enabled and Blendlink depth/stencil disabled with identical settled pixels; this is allocation configuration, not a GPU-time claim |
| NDL-CS-007 | TSL contact shadows on WebGPURenderer/WebGL 2 fallback | **Gap** | **Future adapter** | Official Three r184 source verified; no Blendlink WebGPURenderer fixture |
| NDL-CS-008 | Re-render static mask after WebGL context restoration | **Improvement** | **Shipped (Preview)** | Generation-aware production unit cases pass; `WEBGL_lose_context` browser pixels and repeated resource baselines remain Pending |

## Primary sources

- [Pinned Needle inventory](needle-baseline.json)
- [Broader shadow/ground audit](research-needle-shadow-ground-parity-2026.md)
- [Three r184 WebGL contact-shadow example](https://github.com/mrdoob/three.js/blob/r184/examples/webgl_shadow_contact.html)
- [Three r184 WebGPU/TSL contact-shadow example](https://github.com/mrdoob/three.js/blob/r184/examples/webgpu_shadow_contact.html)
- [Three r184 GaussianBlurNode](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/tsl/display/GaussianBlurNode.js)
- [Three WebGPURenderer migration guide](https://threejs.org/manual/en/webgpurenderer)
- [React Three Fiber demand-loop guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [Khronos GPU timer extension](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)
- [Khronos context-loss test extension](https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/)
