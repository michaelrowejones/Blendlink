# Needle shadow and grounded-environment parity audit

- Audit date: 2026-07-23
- Needle Blender add-on: `1.4.2`
- Needle runtime: `@needle-tools/engine 5.1.7`
- Needle Three.js: `0.169.19`
- Blendlink comparison target: package `0.8.0`, Three.js `0.184.0`
- Scope: Contact Shadows, Shadow Catcher, Ground Projection, Blender
  authoring, glTF serialization, runtime lifecycle, ownership, and focused
  evidence design
- Production resolution: all three ownership-aligned Preview paths now ship;
  evidence and remaining limits are recorded below

## Decision

The three Needle features do not belong behind one undifferentiated “ground
effects” switch:

- **Ground Projection** is environment presentation. Blendlink already ships
  the core outcome through `recipe.environment.background = "grounded"` and
  the official Three.js `GroundedSkybox`.
- **Contact Shadows** is a scene-level offscreen renderer with its own render
  targets, camera, fitting policy, frame cost, and renderer-state transaction.
  Blendlink now implements it as an opt-in portable component.
- **Shadow Catcher** is object-level material behavior. Blendlink now
  implements Mask, Additive, and Occluder as an object component.

The smallest coherent design is therefore ownership-aligned:

1. deepen the existing environment module for Ground Projection;
2. add `blendlink.contact-shadows` and `blendlink.shadow-catcher` to the
   existing portable-component seam; and
3. hide each Three implementation behind a deep package-owned module and the
   existing component-adapter registry.

That keeps the application-facing interface unchanged. The site still owns
its route, Canvas, render loop, loading UI, interaction policy, and
deployment. It also avoids a new top-level manifest family.

This audit corrects the older blanket “Ground Projection gap” conclusion:
basic grounded-HDR behavior and compiled-root auto-fit are **Shipped /
Match**, while raw-equirect rotation and cleanup are verified improvements.
Projected blur and dynamic camera-inside-radius policy remain gaps. Initial
far-plane safety now ships without taking ownership of an application or
Blender-authored camera; AR remains a boundary.

Contact Shadows is **Shipped (Preview) / Match and Improvement** after an
actual pinned-Needle mask differential. Shadow Catcher is **Shipped (Preview)
/ Match and Improvement** after focused Chromium effectiveness and lifecycle
evidence; its exact actual-Needle pixel differential remains Pending.

## Evidence boundary

Two commands passed against the current dirty worktree on 2026-07-23:

```text
npm.cmd run verify:needle-baseline
BLENDLINK_NEEDLE_BASELINE_VERIFIED 76 files, 5 source version identities (2026-07-23) integration=mixed-source
```

```text
npx.cmd vitest run packages/blendlink/src/runtime.test.ts \
  packages/blendlink/src/threeRuntime.test.ts \
  packages/blendlink/src/sceneRecipe.test.ts \
  packages/blendlink/src/components.test.ts \
  packages/blendlink/src/threeComponents.test.ts \
  packages/blendlink/src/componentRuntime.test.ts

6 files passed; 118 tests passed
Node 24.15.0; Vitest 3.2.7; Three 0.184.0
```

Those original tests verify recipe parsing, the renderer-neutral grounded-environment
transaction, later-owner transfer, rollback, component atomicity, and loud
missing-adapter failures. They do **not** verify actual GroundedSkybox pixels,
Contact Shadows, Shadow Catcher, mobile GPU time, WebGPU, or a deployed
browser. They are retained as the pre-implementation audit baseline, not the
current claim boundary. Current browser evidence lives in
`research-ground-projection-browser-evidence-2026.md`,
`research-contact-shadows-differential-browser-2026.md`, and
`research-shadow-catcher-implementation-review-2026.md`.

## Exact source identity

`docs/needle-baseline.json` is the machine-readable authority. The following
files are the exact pinned paths used in this audit.

| Source ID | Normalized source path | SHA-256 |
| --- | --- | --- |
| N-ADDON-SETTINGS | `$NEEDLE_ADDON_ROOT/settings_scene.py` | `6e02da2ab32558fb042f0000c863bc6631176458ceb06534d9afcd5061dfd063` |
| N-ADDON-PANEL | `$NEEDLE_ADDON_ROOT/panels_project.py` | `b3cdc2981e48d5bd50fb3ecf255fc51c3e4035c687a84fbbd4276985514541d0` |
| N-ADDON-SCHEMA | `$NEEDLE_ADDON_ROOT/data/builtin.component.json` | `d32f28bc6beb4379dcce1b12e114c389f56e493e4e0820123c9a500dfb867382` |
| N-ADDON-COMPONENTS | `$NEEDLE_ADDON_ROOT/extensions/NEEDLE_components.py` | `e543cb43130fcb9672879dec44fcd9aebbc31bfa3764610fb40828116754e97a` |
| N-ADDON-POST | `$NEEDLE_ADDON_ROOT/extensions/NEEDLE_components_postprocess.py` | `90cdd4fbd883858816d36ea1605e75fd820c4bcac2e8d8c87e76a465eb1ce031` |
| N-ENGINE-COMPONENTS | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/extensions/NEEDLE_components.ts` | `295d820116bd9e019e3f7b02c83a0269611d24ea88a22c0675652d8347dad8d5` |
| N-CONTACT | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/ContactShadows.ts` | `e4bd8398c59d47ad3bd2eef66625b03c14f260e678d27a332a8ad73d4c17733b` |
| N-CATCHER | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/ShadowCatcher.ts` | `af0b0fea08e92cee701b618613975b6412eb7a0b80642312a25ce01bba4b740b` |
| N-GROUND | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/GroundProjection.ts` | `30abd50cd872c62d59d0b6e3cfaefb3f7701145f7820c4b6532197827e9e9627` |
| N-CAMERA-FIT | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_camera.fit.ts` | `bc77b6fc284dd471902e5760dcf797e3bff567f1de58d96e35e8bb53ffd1630b` |
| N-BUILTIN-INSTALL | `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_gltf_builtin_components.ts` | `44aa5d8ea4d98606ca8f6e26b5d8feeeb134d693e0b23c3dd72b0d07c51e4836` |

The relevant official Three sources were also inspected:

| Source | Version | SHA-256 |
| --- | --- | --- |
| Needle-installed `three/examples/jsm/objects/GroundedSkybox.js` | `0.169.19` | `2c15df3f78e136fe37ba3adcdba38ee0bf867cffc54b545f688d85778e8774c2` |
| Needle-installed `three/src/materials/ShadowMaterial.js` | `0.169.19` | `0d6839015caa58e29916599fbfad511a4ebe20fddf9a654fcccb743b2de0b663` |
| Blendlink-installed `three/examples/jsm/objects/GroundedSkybox.js` | `0.184.0` | `14ad38d785bb998bba0dc9e74b5d8f93ea45753b24341be539755d8e567ee456` |
| Blendlink-installed `three/src/materials/ShadowMaterial.js` | `0.184.0` | `9de4022504a8da0934569c8d125e00d6309892af78d3c485dac0c02e909efc40` |

The current Blendlink comparison files were content-identified at audit time:

| Path | SHA-256 |
| --- | --- |
| `packages/blendlink/src/runtime.ts` | `19d9df98a8e69e6c4f133af67ea84a3cc2ee3a1f231959576d99d3fbf6ac7b18` |
| `packages/blendlink/src/threeRuntime.ts` | `5d0d15caa2208305cf36321ab5ea003673d1249ee93cb7b7c05eae249aa6882c` |
| `packages/blendlink/src/sceneRecipe.ts` | `4f1be4248f492832fe3320b1f1db5fe1c67f84749587ff93ec3552cbe5929d38` |
| `packages/blendlink/src/components.ts` | `93753570f0220906ead625ecf7f7eed0ba465e4164ed68c28351967a6e699c99` |
| `packages/blendlink/src/componentRuntime.ts` | `70b372fedfa767e9160067b2a5eb86f82ebdbf5a865fe787bd397477ad4503fa` |
| `packages/blendlink/src/threeComponents.ts` | `3cf41c8b632606d27cf2af1fa9dde64496230e562bfc5d2f87e488d7785883c0` |
| `packages/blender-addon/props.py` | `8c850c3be546f2ad62b7e66ad1556040d824eda6e0b3277c5a4cce4f42511d4c` |
| `packages/blender-addon/ui.py` | `c82681a3ab5251077cfb8c00e449302dd8e6350ff161fdcac3ba756bada2bb68` |
| `packages/blender-addon/component_schema.py` | `525b1d7a0813436772195285f8c6050d8143f1d52b20b6c37dae8c08beddbbcb` |

## Needle’s end-to-end contract

### Shared authoring and serialization path

Needle’s generic Blender component catalog creates typed component properties
from `builtin.component.json`. During node export, active component values are
serialized into the non-required `NEEDLE_components` glTF extension under
`builtin_components`. The runtime loader first resolves extension references,
then looks up each component name in its type store, constructs all component
instances without calling `awake`, queues field deserialization, and performs
that deserialization before lifecycle setup. This ordering exists so
cross-component references resolve before `awake` and `onEnable`.
[N-ADDON-SCHEMA, N-ADDON-COMPONENTS, N-ENGINE-COMPONENTS; supporting
`engine_gltf_builtin_components.ts` lines 45-111 and 133-231]

The project-level Contact Shadows and Ground Projection settings are a second,
convenience authoring path. They inject components on the export extras object
only when no authored instance of the same type has already been encountered.
The project panel disables its convenience control when an authored component
exists, preventing two visible authoring owners. [N-ADDON-PANEL lines 270-304;
N-ADDON-POST lines 300-325]

Shadow Catcher has no project-wide convenience toggle. It uses the generic
object component path. Export post-processing forces the object’s renderer
component enabled when a Shadow Catcher is attached, even when the Blender
object is hidden in the viewport. [N-ADDON-POST lines 90-117]

### Contact Shadows

#### Authoring

The project setting is enabled by default. Its single Darkness value defaults
to `0.5`, accepts `0..2`, and is serialized into both runtime `darkness` and
`opacity`; the injected component also sets `autoFit = true`.
[N-ADDON-SETTINGS lines 74-80; N-ADDON-POST lines 300-310]

The manually added component exposes a wider contract:

- `autoFit`
- `darkness`
- `opacity`
- `blur`
- `occludeBelowGround`
- `backfaceShadows`

The generic schema and project shortcut do not have identical ranges or
defaults. For example, the manual schema declares Darkness `1..5`, while the
project shortcut accepts `0..2`, and the runtime class default is `0.5`.
Blendlink should preserve the artist outcome but define one consistent field
contract instead of reproducing this disagreement. [N-ADDON-SCHEMA
`ContactShadows`; N-CONTACT lines 113-148]

#### Runtime

Needle’s implementation is adapted from Three’s contact-shadow example but
adds a below-ground occluder, optional backface shadows, and Y-scale as the
maximum shadow height. It allocates two fixed `512 × 512` render targets, an
orthographic camera, a depth material, horizontal and vertical blur materials,
a display plane, and an optional depth-only ground occluder. [N-CONTACT lines
42-48, 181-198, and 312-443]

`fitShadows()` computes visible scene bounds while excluding its own helper
root, expands X/Z based on blur, places the plane at the minimum scene Y with a
small offset, and scales the shadow volume to the bounds. A
`scene-content-changed` event marks auto-fit and rendering dirty. The source
explicitly notes that animated transform changes do not have reliable
auto-refit detection. [N-CONTACT lines 174-175 and 200-271]

Unless developer code sets the non-serialized `manualUpdate` field, every
host render invokes:

1. one scene depth render;
2. two separable blur rounds; and
3. two renders per blur round.

That is **five auxiliary `renderer.render()` calls per rendered application
frame**: one depth render plus four blur renders. `manualUpdate` can reduce
this, but it is not in the Blender component schema or serialized project
shortcut. [N-CONTACT lines 156-171, 297-309, 445-613]

The render path temporarily changes the active render target, scene
background, scene override material, clear alpha, XR enabled state,
`matrixWorldAutoUpdate`, a render-list transparent array, and selected object
visibility. It restores those values after the passes, but the body is not
guarded by `try/finally`, and it restores `scene.overrideMaterial` to `null`
rather than to the previously observed value. [N-CONTACT lines 462-574]

Destroy disposes both render targets and several materials/geometries. The
source does not explicitly dispose the visible plane material or the occluder
material. These source facts are reasons to require injected-failure and GPU
resource tests before calling a Blendlink port an improvement. They are not,
on their own, browser leak evidence. [N-CONTACT lines 273-295]

### Shadow Catcher

#### Authoring

The object component exposes:

- `ShadowMask`
- `Additive`
- `Occluder`
- an RGBA shadow color

[N-ADDON-SCHEMA `ShadowCatcher`]

#### Runtime

If the component is attached to a mesh, Needle clones its material and enables
`receiveShadow`. If attached to a non-mesh object, it creates a horizontal
quad. Groups with existing descendant meshes are not supported and produce a
warning. The target is moved to layer 2 so it is not raycastable by default.
[N-CATCHER lines 95-149]

The three modes are materially different:

- **ShadowMask** replaces the material with Three’s official
  `ShadowMaterial`, applying color and alpha.
- **Additive** mutates a standard material with `AdditiveBlending` and
  `onBeforeCompile`; the patched shader emits direct diffuse/specular lighting
  multiplied by a fixed `6.6`, with alpha from the maximum direct-light color
  channel.
- **Occluder** enables depth/stencil writes, disables color writes, and moves
  rendering early with `renderOrder = -100`.

[N-CATCHER lines 139-229; official
`ShadowMaterial`](https://threejs.org/docs/pages/ShadowMaterial.html)]

The class has `start()` but no local `onDisable()` or `onDestroy()` restoration
path. Therefore disabling only this component does not restore the exact
original material, `receiveShadow`, layers, or render order through code in
this class. A Blendlink implementation must make those values an owned,
transactional lease, including shared-material and later-owner cases.
[N-CATCHER lines 85-230]

The Additive implementation must not be copied as the cross-renderer design.
Three’s current official WebGPU migration guide says `ShaderMaterial`,
`RawShaderMaterial`, and built-in material modifications through
`onBeforeCompile()` are not supported by `WebGPURenderer`; custom behavior
must move to node materials/TSL. A WebGL-only additive mode can be a bounded
prototype, but cannot support a portable production claim.
[Three WebGPU migration guide](https://threejs.org/manual/en/webgpurenderer#migration)

### Ground Projection

#### Authoring and serialization

Needle’s project Ground Projection setting is off by default and exposes only
capture height. Export injects:

- `applyOnAwake = true`
- `autoFit = true`
- the authored height
- a radius equal to 30% of the active camera far clip, or `50` without a
  camera
- `arBlending = 1`

The manually added `GroundProjectedEnv` component exposes `autoFit`, `radius`,
and `height`. [N-ADDON-SETTINGS lines 77-80; N-ADDON-SCHEMA
`GroundProjectedEnv`; N-ADDON-POST lines 312-325]

#### Runtime

Needle constructs Three’s official `GroundedSkybox` with explicit resolution
`64`, positions it at capture height, excludes it from custom contact-shadow
rendering, and auto-centers X/Z and the ground level from scene bounds. It
watches scene background changes and rebuilds when texture, height, or radius
changes. [N-GROUND lines 237-503]

The runtime goes beyond stock GroundedSkybox with a custom material patch:

- CubeUV PMREM sampling and blur-at-horizon uniforms;
- background intensity;
- background rotation matching Three’s skybox sampling direction;
- AR/passthrough alpha blending; and
- a fallback texture while AR clears `scene.background`.

It brackets normal rendering to force and then restore scene background blur.
[N-GROUND lines 31-204 and 297-400]

When an old projection is replaced or the component is disabled, this class
removes it from the scene but does not explicitly dispose its geometry or
material. Three’s official disposal guide states that removing a mesh does not
dispose those GPU resources; geometry and material disposal are explicit
application responsibilities. [N-GROUND lines 344-353 and 449-465;
Three disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html)]

Needle’s generic camera-fit code also knows about Ground Projection. It
includes the radius while sizing the fitted camera far plane and calculates a
maximum zoom. The inspected OrbitControls caller consumes fitted
position/look-at/FOV but does not propagate that returned maximum-zoom value,
so the source does not establish a continuing camera-radius constraint.
[N-CAMERA-FIT lines 249-264 and its pinned OrbitControls call path]

## Blendlink’s current behavior

### Grounded environment is already shipped

Blender exposes a **Grounded Backdrop** environment choice with capture height
and radius. The recipe keeps HDR lighting and visible background ownership
independent. Grounded mode forces authoring intensity to `1` and blur to `0`,
so the UI does not promise unsupported projected blur. The recipe and exporter
validate positive height/radius and a real published environment source.
[`packages/blender-addon/props.py` lines 1141-1178 and 1699-1712;
`packages/blendlink/src/sceneRecipe.ts`]

The renderer-neutral `applyCompiledSceneEnvironment()`:

- validates and loads before scene mutation;
- uses one HDR/EXR/KTX2 source for independently selected lighting and
  background outcomes;
- requires an explicit grounded-background adapter;
- installs environment and backdrop as one transaction;
- rolls both back if attachment fails;
- restores only values it still owns;
- transfers ownership rather than disposing resources reparented or retained
  by a later application owner; and
- explicitly disposes detached grounded geometry/material resources through
  its adapter.

[`packages/blendlink/src/runtime.ts` lines 957-1181]

The standard Three adapter constructs Three `0.184.0` GroundedSkybox,
auto-centers it over visible compiled-root meshes, places its floor at their
minimum Y, applies Y rotation and intensity, and loudly warns when a nonzero
projected blur is requested. Hidden/UI/opt-out helpers and application-owned
siblings cannot influence the fit. Its disposer releases geometry and
material; shared environment texture disposal remains under the surrounding
environment transaction. [`packages/blendlink/src/threeRuntime.ts`;
`packages/blendlink/src/threeRenderableBounds.ts`]

This is stronger ownership and cleanup than Needle’s inspected component
class. The actual pinned class and production installer now pass common,
intensity, rotation, auto-fit, and disposal browser cells.

### Current GroundedSkybox geometry is more expensive than Needle

Needle passes resolution `64`; Blendlink omits the constructor’s fourth
argument and therefore uses official Three `0.184.0` default resolution
`128`. An exact local geometry probe produced:

| Resolution | Vertices | Triangles |
| ---: | ---: | ---: |
| 32 | 2,145 | 3,968 |
| 64 | 8,385 | 16,128 |
| 96 | 18,721 | 36,480 |
| 128 | 33,153 | 65,024 |

Command:

```text
node --input-type=module -e "
  import {SphereGeometry} from 'three';
  for (const r of [32,64,96,128]) {
    const g = new SphereGeometry(100, 2*r, r);
    console.log(r, g.getAttribute('position').count, g.index.count/3);
    g.dispose();
  }"
```

<!-- Historical candidate, superseded by the photographic browser evidence:
match Needle’s `64`, then test whether quality-aware `32/64/96` levels preserve
pixels. -->

A later five-view photographic forest-EXR browser gate compared `64` and
`128` through the same Three `0.184.0` renderer, texture, and camera paths.
Resolution `64` removed 75.2% of the triangles but exceeded the predeclared
image-error budget: worst MAE `2.2264`, RMSE `6.4582`, and `7.615%` of pixels
had a channel error over `8`. Blendlink deliberately retains `128` for
evidenced visual fidelity; no GPU-speed claim is made.

### Historical pre-implementation finding (superseded)

`blendlink.ambient-occlusion` is a camera-space N8AO effect. It is adjacent to
Contact Shadows but is not the same planar, top-down, blurred depth projection
and must not be counted as parity.

Blendlink previously recorded Blender shadow-catcher state only while
fingerprinting bake inputs. It now ships first-party
`blendlink.contact-shadows` and `blendlink.shadow-catcher` definitions,
Blender editors, serialization, and deep Three adapters. The historical
paragraphs below explain why the existing portable-component seam was chosen.

The existing portable component system is nevertheless the correct seam:
component records carry plain JSON artist intent; the generic runtime installs
them atomically; Three adapters receive scene, root, camera, renderer,
bindings, lifecycle hooks, and a frame request; and
`requiresContinuousFrames` already derives from each installation’s truthful
`isActive()` signal. [`packages/blendlink/src/components.ts`;
`packages/blendlink/src/componentRuntime.ts` lines 13-23 and 163-223;
`packages/blendlink/src/threeComponents.ts` lines 32-132 and 187-335]

## Capability ledger

Implementation and evidence are intentionally separate.

| Capability ID | Exact comparison | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- |
| NDL-GRD-001 | Published HDR projected through official Three GroundedSkybox with authored capture height/radius | **Match** | **Shipped** | Actual pinned-Needle/Blendlink Chromium common projection MAE `0.0560`, max channel error `6` |
| NDL-GRD-002 | Atomic install, rollback, later-owner transfer, and explicit grounded geometry/material disposal | **Improvement** | **Shipped** | Unit transactions pass; browser renderer geometry count falls on Blendlink disposal while Needle retains geometry until manual disposal |
| NDL-GRD-003 | Center projection on rendered scene X/Z and floor | **Match / Improvement** | **Shipped** | Both actual implementations place the off-origin fixture at `(3, 0.5, 1)` with pixel MAE `0.0556`; Blendlink bounds only its compiled root and excludes hidden/UI/opt-out helpers |
| NDL-GRD-004 | Keep the initial camera far plane large enough for projected radius without stealing camera ownership | **Improvement** | **Shipped** | Browser fixture: former package fallback clips 282 vertices and differs from far-1000 reference at MAE `4.2893`; repaired fallback clips none and is byte-identical. Unsafe application perspective/orthographic cameras reject without far/projection/world/root mutation |
| NDL-GRD-005 | Force continuing camera framing/max zoom to stay within projection radius | **Boundary** | **Future** | Blendlink leaves page composition with Blender responsive frames/the site. Pinned Needle calculates maxZoom during generic fit but the inspected OrbitControls caller does not propagate it; no automatic radius reframe should ship without an artist request |
| NDL-GRD-006 | Ground background intensity and Y rotation | **Match / Improvement** at runtime; authoring intensity is fixed | **Shipped** runtime / **Future** richer authoring | Intensity `0.65` matches at MAE `0.0372`; Blendlink raw-equirect rotation changes all pixels while the pinned Needle raw branch changes none. CubeUV rotation remains Pending |
| NDL-GRD-007 | Blurred projected HDR horizon | **Gap** | **Future** | Blendlink warns and authoring emits blur `0`; Needle source verified; WebGL/TSL visual and cost fixture Pending |
| NDL-GRD-008 | AR/passthrough real-world blending | **Boundary** | **Future** | XR is outside the current website compiler core; no XR browser fixture |
| NDL-GRD-009 | Cross-renderer standard material path when projected blur is off | **Improvement** | **Shipped** | Source/API evidence: Blendlink stock MeshBasicMaterial path avoids Needle `onBeforeCompile`; WebGPU runtime Pending |
| NDL-GRD-010 | Projection geometry budget | **Deliberate fidelity improvement / cost tradeoff** | **Shipped** at 128 | A five-view photographic gate rejected 64's visual error against the predeclared budget despite its 75.2% triangle reduction; no speed claim |
| NDL-CS-001 | Blender-authored Contact Shadows with auto-fit, darkness, opacity, blur, below-ground occlusion, and backface policy | **Match** | **Shipped (Preview)** | Add-on schema/headless and focused runtime tests pass; wider browser field matrices remain Pending |
| NDL-CS-002 | Top-down depth mask plus separable blur and scene-content refit | **Match** | **Shipped (Preview)** | Actual pinned Needle and Blendlink settled masks are byte-identical; both submit five draws |
| NDL-CS-003 | Default per-render update and developer manual update | **Improvement** | **Shipped (Preview)** | Blendlink Static renders `5` then `0/120`; Needle default and Blendlink Continuous render five per frame |
| NDL-CS-004 | Exact renderer/scene state restoration when any auxiliary pass throws | **Improvement** | **Shipped (Preview)** | Production injected-failure unit cases pass; browser failure injection remains Pending |
| NDL-CS-005 | Contact Shadows automatically enabled in every project unless disabled | **Boundary** | **Shipped opt-in only** | Blendlink does not silently double-ground baked/Eevee-source scenes; integrated conflict warnings remain Pending |
| NDL-SC-001 | Object shadow-only mask using official Three ShadowMaterial | **Match** | **Shipped (Preview)** | Focused Chromium verifies partial-alpha Mask pixels; actual Needle differential remains Pending |
| NDL-SC-002 | Additive direct-light catcher | **Match / Improvement** | **Shipped (Preview)** | Visible default Additive output and loud shader failure pass; portable WebGPU fallback remains limited |
| NDL-SC-003 | Depth-only occluder | **Match** | **Shipped (Preview)** | Chromium verifies depth changes without color output |
| NDL-SC-004 | Descendant-group support | **Improvement** | **Shipped (Preview)** | Chromium verifies two descendant receivers where pinned Needle warns groups unsupported |
| NDL-SC-005 | Restore exact material, shadows, layers, render order, and raycast behavior on rollback/disposal | **Improvement** | **Shipped (Preview)** | Focused tests and Chromium prove conditional material/layer ownership; wider interaction/device matrices remain Pending |

## Design comparison

### Design A — literal Needle-style component injection

Put Contact Shadows and Ground Projection on an export extras object, put
Shadow Catcher on meshes, and reproduce the runtime classes directly.

Advantages:

- shortest conceptual comparison with Needle;
- one component-loading path;
- manual object transforms can control Contact Shadows.

Costs:

- duplicates Blendlink’s existing environment owner;
- silently enables fake grounding over baked scenes if Needle’s default is
  copied;
- imports engine-owned renderer and camera policy into a website-owned Canvas;
- retains the inspected update, cleanup, group, and WebGPU limitations; and
- creates two authoring owners for the same grounded HDR outcome.

Decision: reject.

### Design B — new top-level `grounding` manifest object

Create a dedicated scene recipe containing projection, contact shadow, and
catcher settings, then install it outside Components.

Advantages:

- one apparently cohesive feature family;
- straightforward special-purpose validation.

Costs:

- “grounding” combines environment, scene rendering, and object materials that
  have different ownership and lifecycles;
- Shadow Catcher would need object references and cardinality inside a
  scene-global object;
- applications learn another runtime interface;
- the manifest shape grows despite existing deep environment and component
  seams; and
- generic component atomicity, ordering, diagnostics, and custom adapter
  replacement would be duplicated.

Decision: reject.

### Design C — ownership-aligned environment plus component adapters

Keep Ground Projection in `applyCompiledSceneEnvironment()`. Add Contact
Shadows and Shadow Catcher as portable component definitions. Implement both
inside a package-owned Three module whose entire external interface is:

```ts
export const THREE_GROUNDING_ADAPTERS: ThreeComponentAdapterRegistry
```

`threeComponents.ts` merges this registry into its existing core adapters.
The module hides fitting, render targets, renderer-state leases, material
ownership, quality policy, pass accounting, and cleanup. Tests and callers use
the same existing component interface.

Advantages:

- no new public installation interface;
- no new manifest family;
- Ground Projection retains environment asset/texture ownership;
- Contact Shadows participates in truthful frame scheduling;
- Shadow Catcher resolves rename-stable object targets;
- applications can replace either adapter through the existing
  `componentAdapters` override;
- rollback and disposal stay in the existing component transaction; and
- implementation knowledge is local to one deep module.

Decision: recommend.

## Recommended portable intent

These are interface recommendations, not shipped schema.

### `blendlink.contact-shadows`

- targets: Scene or an Empty/Object anchor
- cardinality: one per scene
- fields matching Needle outcomes:
  - `autoFit`
  - `darkness`
  - `opacity`
  - `blur`
  - `occludeBelowGround`
  - `backfaceShadows`
- one explicit advanced update policy:
  - `continuous` — update before every host render;
  - `static` — render once and settle.

Do not expose render-target resolution as art direction. Map Low/Balanced/High
runtime quality to an internal tested policy.

Scene target plus `autoFit = true` is the default artist path. An object target
with `autoFit = false` uses the target transform as an expert/manual plane,
preserving Needle’s controllability without requiring a second manifest
shape.

The default must be **off**. Authoring should warn when a baked Appearance or
Lighting atlas already contains grounding, when realtime shadows already
satisfy the outcome, or when N8AO and Contact Shadows are both strong enough
to visibly double-darken contact regions.

### `blendlink.shadow-catcher`

- target: object
- cardinality: one per target
- modes:
  - `shadow-mask`
  - `additive`
  - `occluder`
- fields:
  - linear RGBA `shadowColor`
  - `includeDescendants`, default true
  - explicit interaction policy only if the catcher must be excluded from
    pointer hits

`shadow-mask` should use official `ShadowMaterial`.
`occluder` should use a package-owned depth-only material. Both can be
WebGL/WebGPU candidates.

`additive` must remain Future until Blendlink has:

1. a physically explainable composition rather than an unexplained constant;
2. equivalent WebGL and TSL behavior;
3. transparent-canvas and AR-like compositing evidence; and
4. point, spot, and directional-light reference pixels.

Do not silently place catcher meshes on a non-interactive layer. Website
interactivity belongs to the application and authored Blendlink actions.

## Differential evidence required

### Fixture 1 — `grounded-hdr-axis`

Create a tiny `.blend` with:

- an asymmetric subject translated away from world origin;
- a floor whose minimum Y is not zero;
- perspective and orthographic cameras;
- a lat-long HDR test chart with labelled azimuth quadrants, a high-frequency
  horizon, and a distinct lower hemisphere; and
- rotations `0°`, `90°`, and `-90°`.

Needle and Blendlink browser harnesses must use the same HDR bytes, camera
matrix, viewport, DPR, tone mapping, and exposure.

Assertions:

- projected floor center equals rendered-subject X/Z center in auto-fit mode;
- ground height aligns with scene minimum Y;
- sky and projected ground azimuth agree at each rotation;
- no radius clipping across the declared camera path;
- 64-resolution output meets a reviewed pixel threshold against 128;
- 32-resolution output is adopted only if it independently meets that
  threshold;
- five create/dispose cycles return `renderer.info.memory.geometries` and
  programs to a stable baseline after a flush frame; and
- injected attachment failure restores exact scene/environment state.

This fixture can prove Match for basic projection, Improvement for ownership,
and a measured geometry-budget win. It must not imply projected-blur parity.

### Fixture 2 — `contact-shadows-differential`

Use bare primitives with:

- one opaque box;
- a thin/open-backed mesh crossing the ground;
- an alpha-tested cutout;
- wire/line/points helpers that must not cast;
- one object below ground;
- a moving object;
- a translated/scaled parent;
- a baked-lighting variant; and
- a realtime-shadow variant.

Assertions:

- reviewed Needle and Blendlink masks stay within a named pixel threshold for
  the common settings;
- backface and below-ground toggles change the intended regions;
- helpers never contribute;
- auto-fit bounds remain stable;
- `static` performs one update and zero auxiliary renders on later unchanged
  frames;
- `continuous` performs exactly one depth and four blur renders per host
  render;
- demand mode settles after the static update;
- injected failure at depth render and each blur stage restores render target,
  clear alpha, XR state, scene background, override material, matrix update,
  render lists, and hidden object visibility;
- disposal is idempotent; and
- baked/AO/realtime-shadow conflicts generate artist-readable diagnostics.

Count `renderer.render()` calls in the deterministic harness. When available,
measure auxiliary GPU elapsed time with Khronos
[`EXT_disjoint_timer_query_webgl2`](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)
and discard disjoint samples. Record CPU and GPU results separately.

A provable Blendlink improvement is:

```text
static unchanged frame:
Needle default auxiliary renders = 5
Blendlink static auxiliary renders = 0
```

That claim becomes Verified only after the browser harness observes both
implementations, not from source counting alone.

### Fixture 3 — `shadow-catcher-compositing`

Use an application-owned transparent Canvas over a checkerboard DOM
background. Include:

- a plane target;
- a Group with two descendant meshes;
- shared source materials;
- directional, point, and spot lights;
- fog and tone-mapping variants;
- pointer interaction on the catcher;
- an injected later-component failure; and
- repeated enable/disable/install/dispose cycles.

Assertions:

- Shadow Mask changes alpha/color only where expected;
- Occluder changes depth but writes no color;
- descendants work or fail loudly as one transaction;
- the original material identity, `receiveShadow`, layers, render order, and
  pointer hits are exact after rollback/disposal;
- later application material ownership is not overwritten on disposal;
- resource counts stabilize;
- mask and occluder compile/render under WebGL;
- TSL/WebGPU tests pass before either receives a cross-renderer badge; and
- Additive remains unavailable unless its own WebGL/TSL pixel matrix passes.

Use Khronos
[`WEBGL_lose_context`](https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/)
to exercise context-loss cleanup separately from ordinary disposal.

## Implementation resolution and remaining order

1. **Ground Projection correction**
   - off-origin/floor auto-fit now ships at the existing environment seam;
   - resolution `128` is deliberately retained after the photographic
     `64`-versus-`128` gate rejected 64's visual error;
   - initial package-fallback far-plane repair and loud application/Blender
     camera refusal now ship without forcing composition or maximum zoom;
   - dynamic camera motion and an optional application-readable inside-radius
     constraint remain future;
   - investigate CubeUV/TSL-compatible projected blur separately.

2. **Shadow Mask and Occluder**
   - schemas, Blender cards, reversible ownership, descendant meshes, and
     unchanged default raycasting now ship;
   - add an actual pinned-Needle pixel differential and broader device matrix.

3. **Contact Shadows**
   - matched visual algorithm, `try/finally` state ownership, Static/Continuous
     scheduling, exact settled-mask pixels, render counts, and disposal now
     ship;
   - physical GPU timing, baked-conflict UX, wider caster matrices, and
     context-loss pixels remain.

4. **Additive Shadow Catcher**
   - WebGL Preview ships with visible-output and failure evidence;
   - a renderer-portable WebGPU/TSL composition remains Future.

5. **AR blending and camera max-zoom coupling**
   - retain as explicit product-boundary work. Do not pull WebXR or
     engine-owned composition into Blendlink merely to make a parity count
     reach 100%.

## Primary sources

- Exact local Needle identities:
  [`needle-baseline.json`](needle-baseline.json)
- Consolidated baseline:
  [`research-needle-behavioral-baseline-2026.md`](research-needle-behavioral-baseline-2026.md)
- Three.js GroundedSkybox:
  [official documentation](https://threejs.org/docs/pages/GroundedSkybox.html)
- Three.js ShadowMaterial:
  [official documentation](https://threejs.org/docs/pages/ShadowMaterial.html)
- Three.js explicit resource lifecycle:
  [How to dispose of Objects](https://threejs.org/manual/en/how-to-dispose-of-objects.html)
- Three.js WebGPU migration constraints:
  [WebGPURenderer migration](https://threejs.org/manual/en/webgpurenderer#migration)
- Khronos WebGL GPU timer:
  [`EXT_disjoint_timer_query_webgl2`](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)
- Khronos context-loss test extension:
  [`WEBGL_lose_context`](https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/)
