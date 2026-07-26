# Contact Shadows integration and evidence audit

- Audit date: 2026-07-23
- Scope: first-party WebGL Contact Shadows component
- Production changes made by this workstream: none
- Related capability records: `NDL-CS-001` through `NDL-CS-008`

## Source identity

This audit used the locally installed production dependencies and the pinned
Needle source rather than generic examples:

| Source | Version | SHA-256 |
| --- | --- | --- |
| `node_modules/three/src/renderers/WebGLRenderer.js` | Three `0.184.0` | `f42d1f7e2dddf575a2f8528fe5a561078f87eadc09ed5e805c64461b068b29de` |
| `node_modules/three/examples/jsm/shaders/HorizontalBlurShader.js` | Three `0.184.0` | `a155715ca3bfe4fd1f9efc51f189fecd5c53160df47dd571a7d5936dc436ab0c` |
| `node_modules/three/examples/jsm/shaders/VerticalBlurShader.js` | Three `0.184.0` | `67792abdf08ba2305fc2a2f45ca151f55b66a82f5aebbe45230246cdb72181d7` |
| `node_modules/@react-three/fiber/dist/events-583399dd.cjs.prod.js` | R3F `9.6.1` | `5ba9ef6d2ea1f57ed66dfd930adefdf38f8fe4ecd8d4264b3535d36c5b8b2ad3` |
| `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/ContactShadows.ts` | Needle Engine `5.1.7` | `e4bd8398c59d47ad3bd2eef66625b03c14f260e678d27a332a8ad73d4c17733b` |

React `19.0.0` is installed. The broader Needle identity was independently
verified by `npm run verify:needle-baseline` in the parent workstream.

## Integration findings

### The direct R3F path does not call `beforeRender`

`InstalledThreeComponents.render()` is the only existing call site for the
portable lifecycle's `beforeRender()`. The R3F adapter invokes
`InstalledThreeCompiledScene.render()` only when Blendlink owns a
post-processing renderer. With no post stack, R3F invokes
`InstalledThreeCompiledScene.update()` and then performs its own automatic
`gl.render(scene, camera)`.

Therefore a Contact Shadows adapter implemented only with `beforeRender()`
will never refresh in the common no-post R3F path. A temporary adapter can use
one idempotent refresh operation from both `update()` and `beforeRender()`, but
coalescing those calls with an unscoped boolean is unsafe: a direct-render
frame can leave the boolean set and suppress a later context-restoration or
render-only refresh.

The deeper fix is a package-owned render-preparation phase that R3F calls
before automatic rendering as well as before a Blendlink-owned composer
render. Until that seam exists, tests must cover all three host sequences:

1. `update()` followed by application-owned automatic rendering;
2. `update()` followed by `beforeRender()` and a Blendlink-owned render; and
3. render-only Vanilla use through `beforeRender()`.

R3F 9.6.1 runs `useFrame` subscribers before its automatic render. Its
`invalidate()` coalesces calls made outside a frame to one requested frame and
requests one additional frame when called during `useFrame`. This makes a live
`isActive()` signal viable: static is active while dirty, then settles after
the successful refresh; continuous remains active.

### Scheduling must be an explicit application hook

`webglcontextrestored` occurs outside the normal component update path. The
deep module must mark itself dirty and ask the application-owned render loop
for a frame. `InstallThreeComponentsOptions.requestFrame` therefore needs to
reach the component adapter through an additive, narrow context or service.
The callback must not be hidden inside renderer ownership and must not run
after disposal.

### Target cardinality is currently metadata

The TypeScript parser and Blender validation reject duplicate
`(component type, target)` placements. They do not enforce the registry's
general `one-per-scene` cardinality across distinct object targets.

This matters if Contact Shadows is object-targeted. Two instances can render
each other's helper planes into their masks unless every package-owned helper
is explicitly excluded. The contract must choose and test one of these
designs:

| Design | Benefit | Required proof |
| --- | --- | --- |
| Scene-only auto-fit | Simplest artist default and automatic uniqueness | Manual Empty placement remains a documented gap |
| Scene auto-fit plus object Empty manual placement, one per scene | Complete authoring outcomes with a coherent default | Enforce cardinality in TS, Blender, and runtime |
| Multiple object anchors | Supports several independent receivers | Mark and exclude every Contact Shadows helper from every fit/capture; prove overlap and disposal |

Declaring `one-per-target` while allowing auto-fit on an arbitrary Mesh makes
the serialized target misleading: the target is ignored for placement. If
manual mode rejects Mesh targets, Blender validation and UI must expose that
before publish.

### Three's transparent DoubleSide path can double caster draws

Pinned Needle leaves its `MeshDepthMaterial.transparent` value false and sets
`CustomBlending` plus `MaxEquation`. Three r184's public WebGL state still
enables custom blending for an opaque material. By contrast, Three's renderer
performs separate back- and front-side draws when all of these are true:

- `material.transparent === true`;
- `material.side === DoubleSide`; and
- `forceSinglePass === false`.

Because backface shadows default on, setting the shared depth override
transparent can double each caster draw. The matched material should retain
Needle's opaque classification unless browser pixels establish a concrete
reason to deviate. A real-browser draw-count gate should cover this; a fake
renderer cannot.

### Auto-fit must use visible renderable bounds

Needle's `getBoundingBox()` skips invisible subtrees and non-mesh helpers, as
well as Grid/Box helpers, GroundedSkybox, ShadowMaterial, UI, and objects
disabled for auto-fit. `Box3.setFromObject(root, true)` does not implement that
policy. A hidden giant mesh can therefore inflate a fixed `512 x 512` receiver
and make the useful shadow region visibly low resolution.

Use a public mesh traversal with explicit inclusion policy. The differential
fixture needs one small visible caster plus a hidden giant mesh; the fitted
receiver must be unchanged when the hidden mesh is added.

## Deterministic module test matrix

The deep module test should use real Three objects and a narrow fake renderer.
It proves control flow and ownership, never pixels or GPU speed.

| Area | Required assertion |
| --- | --- |
| Pass topology | Exactly `depth, H-wide, V-wide, H-narrow, V-narrow`; targets ping-pong in the expected order |
| Blur values | `2 * blur` then `0.5 * blur`; X/Z aspect correction uses world scale; zero blur retains the matched `0.05` floor |
| Mask material | `CustomBlending`, `MaxEquation`, no depth test/write, Front/DoubleSide toggle, darkness uniform, asserted shader replacement |
| Targets | Two `512 x 512` color targets, `depthBuffer=false`, `stencilBuffer=false`, no mipmaps, linear filters |
| Display | Black transparent plane maps the final target; authored opacity reaches the material; below-ground occluder toggle is independent |
| Camera layers | The owned display plane and occluder are visible to a non-layer-0 application camera without mutating that camera's mask |
| Auto-fit | Needle expansion and ground offset; visible meshes only; hidden giant, empty bounds, translated/scaled parent, and internal helper exclusion |
| Manual fit | Empty/group transform is retained; Mesh manual target fails with component/target identity |
| Static policy | Active before first refresh; five calls once; inactive afterward; unchanged updates add zero calls |
| Continuous policy | Exactly five auxiliary renders for every host frame, with no duplicate when update and render hooks both run |
| Refresh ownership | Refresh requested during a pass is not overwritten by the pass's final `dirty=false`; reentrant refresh fails loudly or coalesces deterministically |
| Context loss | Loss makes the component dormant; restore marks dirty and requests one frame; repeated restore coalesces at the host; no callback after disposal |
| Failure injection | A throw at each of the five passes restores every state and leaves static dirty for retry |
| Renderer state | Exact target/cube-face/mip tuple, clear color/alpha, XR enabled, and any mutated auto-clear state |
| Scene state | Exact background and non-null override-material identity, `matrixWorldAutoUpdate`, helper visibility, and changed object visibility |
| Public ownership | No `renderer.renderLists` access; an application change from installed `visible=false` to `true` wins |
| Three r184 override opt-out | Source slots with `material.allowOverride=false` are excluded, so their original shader cannot write into the mask |
| Resource ownership | Both targets, every material, shared geometry, helper attachment, and both context listeners dispose once; partial listener/setup failure rolls back |
| Multiple installs | Either second same-scene install fails loudly, or two anchors exclude each other's helpers and dispose independently |
| Evidence wording | Unit name says “five-pass structure,” not “pixel parity” |

`renderer.autoClear` need only be restored if the module changes it. Render
target restoration must preserve the complete public tuple available in Three
r184: `getRenderTarget()`, `getActiveCubeFace()`, and
`getActiveMipmapLevel()`.

## Adapter and runtime integration matrix

| Existing test file | Addition |
| --- | --- |
| `packages/blendlink/src/components.test.ts` | Defaults, ranges, target/cardinality choice, cost/consequence, invalid update policy, and duplicate cardinality |
| `packages/blendlink/src/componentRuntime.test.ts` | Live `isActive()` changes from dirty to idle without permanently claiming continuous work |
| `packages/blendlink/src/threeComponents.test.ts` | Real adapter wiring, values, request-frame forwarding, direct path, composer path, warnings/errors, and disposal |
| `packages/blendlink/src/threeRuntime.test.ts` | Compiled-scene getter changes from active to idle after one successful static update; continuous remains active |
| `packages/blendlink/src/reactThreeFiber.test.ts` | A no-post `frameloop="demand"` Canvas refreshes before its automatic main render and settles; continuous invalidates; context restore produces one new frame |

The R3F test must not use `frameloop="never"` to prove demand semantics:
R3F's installed `invalidate()` intentionally returns without scheduling in
`never` mode. Use a controlled `requestAnimationFrame` queue or a browser
fixture with `frameloop="demand"`.

Also combine Contact Shadows with one post-processing component. The
post-pipeline owns `renderer.autoClear=false` and may transfer tone mapping;
all five auxiliary renders must leave that ownership intact before the
composer renders.

## Blender schema and UI checklist

The artist contract must remain identical in:

- `packages/blendlink/src/components.ts`;
- `packages/blender-addon/component_schema.py`; and
- native RNA, serialization, hydration, and validation in
  `packages/blender-addon/props.py`.

Required portable values:

- `autoFit: boolean`, default `true`;
- `darkness: number`, default `0.5`;
- `opacity: number`, default `0.5`;
- `blur: number`, default `4`;
- `occludeBelowGround: boolean`, default `false`;
- `backfaceShadows: boolean`, default `true`; and
- `updatePolicy: "static" | "continuous"`, default `"static"`.

Extend:

- `COMPONENT_VALUE_BINDINGS` and `COMPONENT_DEFINITIONS`;
- `BlendlinkComponentSettings` RNA properties;
- `_COMPONENT_NUMBER_FIELDS`, `_COMPONENT_BOOLEAN_FIELDS`,
  `_COMPONENT_TEXT_FIELDS`, and `_COMPONENT_ENUM_FIELDS`;
- `component_values()` and `_hydrate_component_values()`;
- `_COMPONENT_ICONS`, `_CARD_LABELS`, and `_draw_known_fields()`;
- `component_schema_check.py` for defaults, bindings, discovery, and targets;
- `run_headless.py` for a non-default serialize/hydrate round trip; and
- component validation for manual-on-Mesh and the selected scene cardinality.

The UI should show:

- Fit to Scene first;
- a clear target/placement explanation;
- darkness, opacity, and blur together;
- below-ground and backface toggles;
- Update last, with Static recommended and Continuous described as necessary
  for animation or application-driven motion; and
- a visible high-cost consequence rather than silently enabling the effect.

## Browser evidence matrix

One Blendlink-only screenshot can prove that the implementation renders, but
it cannot promote Needle parity. Use the exact same geometry, transforms,
camera, WebGL context settings, and pixel analysis for the pinned Needle
runtime and Blendlink.

### Pixel cells

1. Opaque closed caster at default values.
2. Thin open/backfacing caster with backfaces on and off.
3. Object below ground with the occluder on and off.
4. Static and translated/non-uniformly-scaled manual Empty.
5. Hidden giant mesh plus small visible caster for auto-fit.
6. Line, points, wireframe, `colorWrite=false`, `allowOverride=false`,
   transparent, and alpha-tested helpers in named regions.
7. Contact Shadows combined independently with baked grounding, realtime
   shadows, N8AO, and one HDR post stack.

Capture both the raw mask render target and final canvas. Establish
same-implementation repeatability before applying the proposed SSIM/error
thresholds in the main design note. Record canvas size, DPR, color space, tone
mapping, exposure, browser build, ANGLE renderer, Three versions, and source
hashes.

### Scheduling and ownership cells

- Needle default: five auxiliary renders per host frame.
- Blendlink continuous: the same five.
- Blendlink static: five on the first frame, zero for the next 120 unchanged
  host frames.
- No-post R3F demand Canvas: first mask is ready before the main render and
  the loop settles.
- Context restore: exactly one new refresh and the mask reappears.
- Dispose before the requested frame: no auxiliary renders or callback.
- Non-null application override material, non-default clear color/alpha,
  non-null cube/mip render target, XR flag, and camera layers are unchanged;
  the result remains visible when the main camera enables only a nonzero layer.

### Draw and resource evidence

- Observe actual GL draw calls for backface on/off so a transparent
  DoubleSide regression cannot hide behind five top-level `render()` calls.
- Repeat install/render/dispose five times and compare
  `renderer.info.memory.textures/geometries` after a flush frame with the
  warmed baseline.
- Use `EXT_disjoint_timer_query_webgl2` only for GPU-time claims, discard
  disjoint samples, and report CPU and GPU separately.

## Exact integration file checklist

Core implementation and tests:

- `packages/blendlink/src/threeContactShadows.ts`
- `packages/blendlink/src/threeContactShadows.test.ts`
- `packages/blendlink/src/threeComponents.ts`
- `packages/blendlink/src/threeComponents.test.ts`
- `packages/blendlink/src/components.ts`
- `packages/blendlink/src/components.test.ts`
- `packages/blendlink/src/threeRuntime.test.ts`
- `packages/blendlink/src/reactThreeFiber.test.ts`

Blender authoring:

- `packages/blender-addon/component_schema.py`
- `packages/blender-addon/props.py`
- `packages/blender-addon/components_ui.py`
- `packages/blender-addon/component_validation.py`
- `packages/blender-addon/tests/component_schema_check.py`
- `packages/blender-addon/tests/run_headless.py`
- the installed Component Lab fixture/gate

Browser and records:

- `experiments/contact-shadows-browser/`
- `artifacts/contact-shadows-browser-2026/evidence.json`
- `docs/TECHNIQUE_LEDGER.md`
- `docs/research-needle-behavioral-baseline-2026.md`
- `docs/FEATURE_PARITY.md`
- `docs/COMPONENT_ACCEPTANCE.md`

Promotion order is: deterministic module control flow, adapter/runtime
integration, Blender round trip, Blendlink browser pixels, pinned Needle
differential, then performance/resource evidence. A lower layer must not be
used to claim a higher one.
