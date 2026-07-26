# Outline handling: installed Needle, Three.js, and Blendlink

**Date:** 2026-07-21
**Question:** What does the installed Needle Engine stack actually provide for
outlines, and which evidenced design should Blendlink adopt?
**Scope:** Research and design only. No runtime, add-on, manifest, or dogfood
implementation was changed for this note.

## Executive conclusion

The exact installed Needle stack does **not** contain a 3D object-selection or
whole-scene outline effect. Needle Blender add-on 1.4.2 exposes an `Outline`
component whose generated catalog classifies it under **User Interface** and
whose only controls are `effectColor` and `effectDistance`. Needle Engine 5.1.7
maps those values to a `three-mesh-ui` border on a sibling `Graphic`. The
official current component catalog also describes it only as “Add an outline
effect to UI elements.” [N1] [N2] [Needle component catalog][needle-components]

Needle therefore provides no 3D outline implementation for Blendlink to copy.
The useful precedent is narrower: a small artist interface, one coordinated
postprocessing stack, lazy loading, explicit enable/disable/dispose lifecycle,
and quality controls that can reduce MSAA or device pixel ratio. Those are host
and UX ideas, not an outline algorithm. [N3] [N4]

Blendlink's current `blendlink.outline` is a more ambitious 3D scene effect,
implemented with pmndrs `OutlineEffect`. Its lifecycle and dark-outline blend
mode are sound, but its present target semantics do not match the selected-
object algorithm underneath:

- every Mesh, Line, and Points descendant is selected once at installation;
- pmndrs computes occlusion depth after hiding the selected objects, so when
  almost the whole scene is selected, selected objects do not serve as
  occluders for one another;
- the pmndrs selection helper mutates Three render layers and restores layer 0
  by enabling it, not by restoring the prior mask;
- new descendants are not added after installation, while removed descendants
  remain referenced until disposal;
- the override depth/mask materials do not preserve arbitrary transparent or
  alpha-cutout material silhouettes; and
- authored thickness zero still installs and executes the supporting outline
  renders with edge strength zero. [B2] [P1] [P2]

The recommended product model is to keep three distinct meanings separate:

1. **UI border** — Needle's component; not a 3D scene effect.
2. **Selection highlight** — an object/collection subset, optionally visible
   through other geometry. A selective depth/mask outline is appropriate.
3. **Scene/toon linework** — silhouettes and optionally depth/normal creases
   across the rendered scene. A whole-scene geometry or depth/normal technique
   is appropriate.

Do not expose pmndrs `Selection`, layer numbers, render targets, or composer
ordering to applications. A package-owned outline module should present one
small intent interface and keep WebGL selective, WebGL scene-line, and future
TSL adapters behind its seam. That preserves Blendlink's application-owned
Canvas and renderer while concentrating mutation, invalidation, quality, and
cleanup in one implementation.

## Versions inspected

| Item | Exact inspected version | Evidence |
| --- | --- | --- |
| Needle Blender add-on | 1.4.2 | installed `__init__.py` `bl_info` [N1] |
| Needle Engine | 5.1.7 | installed experimental package [N1] |
| Needle Three fork | 0.169.19 | installed nested package [N1] |
| Needle pmndrs postprocessing | 6.39.0 | installed nested package [N1] |
| Blendlink | 0.8.0 | package metadata [B1] |
| Blendlink Three development version | 0.184.0 | installed package [B1] |
| Blendlink pmndrs postprocessing | 6.39.3 | installed package [B1] |

Official web documentation can move ahead of these installations. Claims about
Needle behavior below use the installed source as the implementation of record;
official Needle pages are used to check whether the public product contract
agrees. Claims about candidate Three.js techniques use the installed r184
source and current official Three.js documentation.

## Exact Needle behavior

### Artist controls and runtime meaning

The generated Blender component catalog contains one item named `Outline`. It
is in the `User Interface` category, inherits `Behaviour`, and exposes:

- `effectColor: RGBAColor`
- `effectDistance: Vector2`

The runtime class stores only those two serialized properties. `Graphic`
queries an `Outline` on the same GameObject when applying UI options. It maps
the maximum absolute X/Y distance to `borderWidth`, and maps the color and
alpha to `borderColor` and `borderOpacity`. There is no scene, camera, object
selection, hidden-edge color, X-Ray switch, depth render, or postprocessing
effect in this path. [N2]

That is also the current official contract: Needle lists `Outline` in the User
Interface group and describes it as an outline for UI elements, while its
rendering-component summary does not list a 3D outline component.
[Needle component catalog][needle-components]
[Needle component reference][needle-component-reference]

Needle's `SeeThrough` component is related to camera occlusion but is not an
outline substitute. It periodically compares camera direction to a reference
point, fades designated obstructing renderers, disables their raycasting while
faded, and restores shadow casting. That is useful evidence that Needle names
occlusion behavior separately instead of overloading UI `Outline`. [N5]

### Postprocessing integration that a custom outline could use

Needle does have a capable generic postprocessing host:

- `PostProcessingEffect.onEnable()` adds the component to
  `context.postprocessing`; `onDisable()` removes it.
- An effect result is created once and cached by the component. `dispose()`
  disposes a returned effect/pass or every result in an array.
- The core stack marks itself dirty when effects are added or removed and
  rebuilds on a later update when a camera exists.
- The handler lazily imports the postprocessing package, owns one composer,
  groups compatible effects, orders them, restores renderer state, and disposes
  passes and render targets.
- Automatic MSAA is reduced when measured FPS falls and restored after a
  stable interval. Experimental adaptive resolution steps DPR between 1 and
  the lower of 2 or native DPR.
- If another composer is already active, the handler warns and replaces it.
- The core postprocessing update returns immediately in XR. [N3] [N4]

The current official Needle interface describes the same high-level model:
effects add to or remove from a core stack, the stack rebuilds when dirty, and
adaptive resolution may lower DPR when performance drops.
[Needle PostProcessing][needle-postprocessing]

**Inference:** a project-specific Needle component could create pmndrs
`OutlineEffect` through this host, but that is not an installed Needle artist
feature. It would also inherit an engine-owned composer and render loop, which
conflicts with Blendlink's product boundary: the website retains ownership of
its Canvas, renderer, route, post stack, and deployment.

## What the current Blendlink outline actually does

### Authored interface

`blendlink.outline` is a scene-targeted WebGL Preview component with:

- Visible Color
- Hidden Color
- Strength
- Thickness, described honestly as approximate rendered pixels
- X-Ray

The compiler serializes those values without exporting postprocessing
implementation details. The Three adapter requires a scene target. [B2]

### WebGL adapter

The adapter creates pmndrs `OutlineEffect` with:

- explicit `BlendFunction.ALPHA`, because pmndrs' default `SCREEN` blend makes
  black an identity color;
- visible/hidden colors and edge strength;
- a discrete blur kernel chosen from authored thickness;
- a resolution scale derived from thickness and runtime quality; and
- X-Ray from the authored value.

It traverses the root once, adds every Mesh, Line, and Points object to the
effect's `Selection`, lowers the internal resolution at Low/Balanced quality,
clears selection before composer disposal, and adds a final SMAA effect because
outline edge detection happens after scene MSAA. [B3] [B4]

The lifecycle module is deep: the application calls the Blendlink installer,
while composer creation, effect ordering, renderer-state ownership, resize,
quality, render, and reverse-order disposal remain inside the implementation.
That is stronger than asking each generated binding to create its own effect.
[B3]

### pmndrs selection and occlusion behavior

pmndrs `OutlineEffect` is a **selection** effect. Its `Selection` assigns a
dedicated Three render layer. On each update with a non-empty selection it:

1. disables layer 0 on every selected object;
2. renders scene depth without the selected objects;
3. enables layer 0 on the selected objects;
4. renders the selected layer with a depth-comparison material;
5. detects visible/hidden edges; and
6. optionally blurs the edge texture. [P1] [P2]

This supports the intended “selected product behind an unselected wall” case.
It does not prove whole-scene X-Ray. When all rendered meshes are selected,
the non-selected depth pass has no mesh occluders, so one selected mesh behind
another is not classified in the same way as a selected mesh behind an
unselected wall. This is an inference directly from the installed pass order;
it needs a rendered two-object fixture before being labeled visual proof.

The selection layer has two exact ownership hazards:

- its allocator starts at layer 2 and the source explicitly warns that custom
  layers may collide;
- `setVisible(true)` always enables layer 0 instead of restoring the old mask.

A read-only probe against Blendlink's installed Three 0.184.0 and
postprocessing 6.39.3 started an object on layer 5 only (`mask = 32`), added it
to selection layer 2 (`36`), hid and showed the selection (`36`, then `37`),
and cleared it (`33`). Layer 0 remained incorrectly enabled. This is
**probe-verified**, not merely inferred. [P1]

The supporting depth pass uses a generic `MeshDepthMaterial`; the mask uses a
generic `DepthComparisonMaterial`. The override-material manager preserves
side, skinning, instancing, and flat-shading variants, but it does not reproduce
arbitrary alpha maps, alpha tests, transmission, custom discard logic, or
application material hooks. Transparent glass and cutout foliage therefore
need explicit acceptance fixtures. [P3]

### Per-frame and lifecycle cost

With any selected object, pmndrs performs the non-selected depth render,
selected mask render, edge pass, and optional blur work on every composer
render. The final effect composite is part of the composer effect pass.
Resolution scaling reduces pixel cost but not scene traversal or the two
supporting scene renders. `xRay = false` suppresses hidden-edge composition; it
does not remove the supporting depth/mask renders. [P2]

Blendlink adds final SMAA for Outline because the effect generates fresh edges
after scene MSAA. This is correct, but it is another full-screen stage. The
runtime's demand-mode ownership means a fully static page can still settle;
camera controls, animation, resize, quality changes, or application invalidates
pay the outline work on those rendered frames. [B3] [B4]

Blendlink now journals the selected renderables' and camera's exact layer
masks around every pmndrs update. The adapter reserves an otherwise-unused
nonzero layer only for that update, removes it from the occluder depth camera,
and restores all masks on success, a thrown render, and disposal. The composer
then recursively disposes effects, passes, and render targets. pmndrs' base
`Effect.dispose()` performs a shallow disposal of render targets, materials,
textures, and passes owned directly by the effect. [B3] [P2]

Current gaps remain:

- selection membership is a one-time traversal rather than a live set;
- a removed target stays strongly referenced until cleanup;
- a thickness of zero still constructs and runs the effect;
- the current scene-wide target does not give selective X-Ray an unambiguous
  occluder set; and
- browser evidence is still pending for hidden edges, transparency, moving
  cameras, and DPR-dependent thickness.

## Credible designs

### Design A — selective screen-space mask

Use a selected-object depth/mask effect for object or collection emphasis. The
selection and occluder sets are distinct inputs: selected objects produce the
mask; the complete visible scene produces occlusion depth.

pmndrs `OutlineEffect` provides visible/hidden colors, X-Ray, blur, patterns,
pulse, MSAA for its mask, and resolution scaling. It is a practical WebGL
prototype, and its official documentation explicitly says to use ALPHA for dark
outlines. [pmndrs OutlineEffect][pmndrs-outline]

**Strengths**

- correct conceptual fit for hover, selection, hotspots, and configurators;
- stable screen-space styling under a moving camera;
- visible versus hidden edge colors and X-Ray are native concepts;
- works inside Blendlink's existing WebGL composer.

**Limitations**

- two supporting scene renders plus screen-space work per rendered frame;
- the installed selection implementation mutates layers, requiring Blendlink's
  exact per-update mask journal rather than direct use;
- transparency and alpha-cutout silhouettes are not material-exact;
- selecting the entire scene erases the selected/non-selected distinction;
- static membership must be refreshed for dynamic scene graphs.

**Recommendation:** retain as the preferred semantic for a future object or
collection **Selection Outline** behind the package-owned adapter. Do not
expose pmndrs layers. Blendlink's exact mask journal is now regression-tested;
a future render-object filter could remove the mutation entirely. Zero targets
or zero strength should remove/skip the effect rather than execute invisible
passes.

### Design B — inverted-hull toon silhouette

Three's official WebGL `OutlineEffect` renders the scene normally, then renders
compatible meshes again with a BackSide shader that expands vertices in clip
space along normals. It supports morph targets, skinning, displacement, fog,
clipping, and per-material `userData.outlineParameters`; it excludes meshes
without normals, wireframes, and depth-test-disabled materials. [T1]

**Strengths**

- honest whole-mesh silhouette semantics;
- no full-size depth/mask render targets;
- natural depth occlusion between outlined meshes;
- an additional mesh render can be cheaper than several full-screen targets
  for modest scenes.

**Limitations**

- it outlines geometry, not arbitrary alpha-cutout silhouettes or depth/normal
  creases;
- hard/split normals, thin geometry, intersections, and non-manifold meshes can
  create gaps or thickness artifacts;
- it temporarily replaces every compatible material and `onBeforeRender`;
- the r184 addon restores state only on the normal path, with no `try/finally`;
- the r184 class exposes no `dispose()`, and its aged-out cache entries are
  deleted without an explicit material disposal call; and
- it is WebGLRenderer-only. The official docs direct WebGPU users to
  `ToonOutlinePassNode`. [Three WebGL toon outline][three-toon-outline]

**Recommendation:** the better short-path prototype for a scene-wide **Toon
Silhouette**, provided Blendlink wraps or forks it behind its own module with
transactional material restoration, explicit cache disposal, dynamic-object
coverage, and visual fixtures. Do not reuse its per-material `userData`
interface as Blendlink's authored schema.

### Design C — depth/normal whole-scene edge pass

Render or share scene depth and normals, then detect discontinuities in screen
space. Unlike selective outline, all rendered geometry remains in the source
buffers. This can produce outer silhouettes, object intersections, and normal
creases—the common meaning of a whole-scene/toon outline.

**Strengths**

- matches the existing scene-targeted authoring more closely than selecting
  every object in a selection effect;
- no selection layer mutation or live target membership set;
- can share depth/normal evidence with AO or other effects inside one deep post
  module;
- screen-space thickness and quality tiers are straightforward.

**Limitations**

- requires a new, tested shader and buffer-composition contract;
- transparency, alpha cutouts, normals, reversed/log depth, orthographic
  cameras, and tone-map ordering all need explicit handling;
- hidden/X-Ray lines are not a natural single-layer result; and
- full-frame buffers can dominate mobile bandwidth.

**Recommendation:** strongest long-term WebGL design for scene linework, but a
prototype until it has transparent/cutout, camera, quality, and GPU-time
evidence. Scene-wide X-Ray should block or use a separately named multi-layer
design rather than pretending one depth buffer can reveal every hidden surface.

### Design D — Three r184 TSL adapters

Three r184 now has two different node paths:

- `OutlineNode` is a selected-object depth/mask outline. It filters objects via
  the renderer's render-object function instead of changing object layers,
  skips all work when selection is empty, runs once per frame, resizes multiple
  targets, and explicitly disposes all targets and materials. [T2]
  [Three OutlineNode][three-outline-node]
- `ToonOutlinePassNode` is a toon outline pass limited to
  `MeshToonMaterial`/`MeshToonNodeMaterial`. [T3]
  [Three ToonOutlinePassNode][three-toon-node]

The official Three WebGPU guide says the old `EffectComposer` stack is not
supported by `WebGPURenderer`; node composition is the replacement, and the
renderer remains experimental despite improved maturity.
[Three WebGPU renderer][three-webgpu]

**Recommendation:** use these as the future TSL adapter reference, especially
the mutation-free render-object filtering and explicit disposal. Do not switch
Blendlink's production WebGL outline merely because a similarly named node
exists. Match the semantic and rendered fixtures first.

## Decision matrix

| Requirement | pmndrs selective | Three inverted hull | Custom depth/normal | Three TSL |
| --- | --- | --- | --- | --- |
| Selected object/collection | Best fit | Possible but wasteful | Possible with ID/mask work | `OutlineNode` fits |
| Whole-scene silhouettes | Mismatched if all objects are “selected” | Best prototype fit | Good | Toon node, material-limited |
| Interior depth/normal creases | No | No | Yes | Selected node: no; custom nodes possible |
| Hidden/X-Ray selected edges | Yes, with distinct occluders | No | Requires extra layers | `OutlineNode` exposes hidden mask |
| Alpha-cutout fidelity | Unproven/generic override | Geometry only | Must be designed | Must be tested |
| Screen-space thickness | Approximate | Clip-space expansion | Direct | Direct node inputs |
| WebGL application-owned composer | Yes | Replaces render call unless wrapped | Yes | Different renderer pipeline |
| WebGPU path | No | No | Separate implementation | Yes, experimental renderer |
| Mutation risk | Render layers | Materials/hooks | Renderer/pass state | Render-object function with state helper |
| Empty-effect idle | Must explicitly skip | Still extra render if enabled | Can skip | `OutlineNode` skips empty selection |

## Recommended Blendlink seam

Keep the authored manifest values stable while putting strategy and ownership
behind one package module:

```ts
type OutlineKind = 'selection' | 'scene-silhouette' | 'scene-edges'

interface OutlineIntent {
  kind: OutlineKind
  targets: readonly THREE.Object3D[]
  visibleColor: THREE.ColorRepresentation
  hiddenColor: THREE.ColorRepresentation
  strength: number
  thicknessPx: number
  xRay: boolean
}

interface OutlineInstallation {
  setTargets(targets: readonly THREE.Object3D[]): void
  setQuality(quality: RuntimeQuality): void
  invalidate(): void
  dispose(): void
}
```

This is an internal adapter seam, not necessarily a new public manifest shape.
The compiler already knows component target kind and resolved objects. A scene
record can remain scene-targeted while an object/collection capability is
designed additively and versioned deliberately.

The module implementation owns:

- target expansion and live membership;
- selected versus occluding sets;
- layer/material/renderer mutation journals;
- effect/pass ordering and tone-map phase;
- resize, DPR, quality, invalidation, and zero-cost disable;
- shader compilation/preparation;
- context loss/recreation coordination;
- resource disposal; and
- readable diagnostics when a technique cannot honor transparency, X-Ray,
  renderer backend, or target type.

The deletion test passes: without this module, the R3F adapter, Vanilla Three
adapter, generated bindings, and application code would each have to reproduce
selection maintenance, occlusion meaning, composer placement, quality, and
cleanup.

Needle's engine owns and may replace the global composer. Blendlink should
deviate: its module attaches to the existing Blendlink post-pipeline adapter and
never takes ownership of the website's route, Canvas, or renderer.

## Implementation recommendations, in evidence order

1. **Correct the product vocabulary before adding controls.** Document UI
   border, selection highlight, and scene/toon linework as separate concepts.
   Do not describe the installed Needle UI component as 3D outline parity.
2. **Make the current limitations loud.** Until a rendered matrix passes, keep
   `blendlink.outline` at WebGL Preview. Warn or block scene-wide X-Ray if the
   implementation cannot preserve selected-versus-occluder meaning.
3. **Eliminate invisible work.** Strength or thickness zero, no targets, or an
   unavailable backend should install no active outline render work.
4. **Prototype twice.** Compare a hardened inverted-hull scene silhouette with
   a depth/normal scene-edge pass. In parallel, retain a corrected selective
   adapter for object/collection highlighting.
5. **Do not leak render layers.** A production selective adapter must restore
   exact masks or avoid object-layer mutation. The installed pmndrs helper is
   not safe for arbitrary application-owned layer masks as-is.
6. **Treat transparency as a contract.** Report whether each material is exact,
   geometry-silhouette-only, approximated, or unsupported. Never silently turn
   foliage cards or glass into opaque occluders.
7. **Keep lifecycle package-owned.** Refresh dynamic membership, release
   removed objects, clear selection before disposal, dispose render targets and
   cached materials, and test React Strict Mode install-cleanup-install.
8. **Keep WebGPU a separate adapter.** Three's official guide says the WebGL
   composer is not a WebGPU pipeline. Reuse intent and fixtures, not WebGL pass
   objects.

## Required evidence before Production

### Visual matrix

- selected object in front of and behind an **unselected** opaque occluder;
- selected object behind another **selected** object;
- X-Ray on/off with visibly distinct hidden color;
- whole-scene outer silhouette versus object intersections and normal creases;
- alpha-cutout foliage, alpha-hashed/dithered material, transparent glass,
  transmission, DoubleSide, and clipping planes;
- skinned, morphed, instanced, displaced, negative-scale, and multi-material
  meshes;
- perspective and orthographic cameras, moving camera, near/far extremes,
  log/reversed depth where supported;
- transparent canvas over light and dark page backgrounds;
- DPR 1/2/3, phone/desktop sizes, and Low/Balanced/High quality; and
- dark and light outlines before/after tone mapping and final AA.

### Ownership and lifecycle matrix

- an object authored on a nonzero custom layer retains its exact mask after
  every frame and disposal;
- dynamic child add/remove/reparent updates selection without retained
  references;
- component disable/re-enable, scene transition, R3F Strict Mode, and repeated
  install/dispose do not grow render targets, programs, selections, or listeners;
- context loss/restoration recreates dependent GPU resources. Khronos specifies
  that pre-loss WebGL textures and buffers are no longer valid after restore.
  [WebGL context loss][webgl-context-loss]
- a thrown render/material hook cannot leave scene background, materials,
  visibility, layers, renderer target, auto-clear, or shadow settings mutated.

### Performance evidence

For representative desktop, integrated-GPU, and phone fixtures, record:

- `renderer.info.render.calls`, triangles, and active textures/programs;
- internal render-target dimensions and formats;
- CPU frame time and GPU time with the WebGL timer-query extension where
  available;
- idle rendered-frame count in demand mode;
- quality-switch and resize allocation churn; and
- first-use shader compilation stall versus prepared/second-use render.

Compare disabled, selective pmndrs, inverted hull, and depth/normal designs at
the same output pixels. A smaller resolution scale is an input, not proof of
acceptable appearance or cost.

## Status summary

| Status | Finding |
| --- | --- |
| **Exact installed evidence** | Needle 1.4.2/Engine 5.1.7 has UI `Outline` only; no installed 3D outline effect/component was found in its generated catalog, registered component list, or postprocessing effects. |
| **Implemented in Blendlink** | Scene-targeted WebGL outline through pmndrs, explicit ALPHA blend, colors/strength/approximate thickness/X-Ray, quality scaling, post-edge SMAA, and package-owned cleanup. The adapter now reserves an otherwise-unused scene layer only during the effect update, isolates selected objects from the occluder depth pass regardless of their authored layer, and restores exact object/camera masks on success, failure, and disposal. |
| **Probe-verified and fixed** | pmndrs selection introduced layer 0 permanently for an object originally occupying only a custom layer. A regression now exercises a layer-7 object, the depth/mask phases, an application layer change, a thrown mask render, and disposal without retained mutation. |
| **Source-evidenced gap** | Whole-scene selection collapses selected-versus-occluder semantics; membership is static; generic depth/mask materials do not preserve arbitrary transparent/cutout shaders; zero thickness still costs supporting renders. |
| **Inference awaiting browser proof** | Selected-behind-selected X-Ray behavior, exact transparent/cutout artifacts, thickness stability, and moving-camera appearance. |
| **Future prototype** | Hardened inverted-hull scene silhouettes versus shared depth/normal scene edges, plus a mutation-free selective adapter; TSL adapters remain a separate renderer track. |

## Source anchors

- **N1 — installed versions:**
  `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\__init__.py:38-49`;
  `experiments\needle-spike\node_modules\@needle-tools\engine\package.json:1-4,63-84`;
  `experiments\needle-spike\node_modules\@needle-tools\engine\node_modules\three\package.json:1-4`;
  `experiments\needle-spike\node_modules\@needle-tools\engine\node_modules\postprocessing\package.json:1-4`.
- **N2 — installed Needle UI Outline:** generated artist catalog at
  `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\data\components.needle.json:1`;
  the registered effect imports and UI-only `Outline` import/registration at
  `experiments\needle-spike\node_modules\@needle-tools\engine\src\engine\codegen\register_types.ts:68-80,125,220-235,281`;
  runtime properties at
  `experiments\needle-spike\node_modules\@needle-tools\engine\src\engine-components\ui\Outline.ts:7-20`;
  UI border mapping at
  `experiments\needle-spike\node_modules\@needle-tools\engine\src\engine-components\ui\Graphic.ts:209-217`.
- **N3 — Needle effect lifecycle and core stack:**
  `experiments\needle-spike\node_modules\@needle-tools\engine\src\engine-components\postprocessing\PostProcessingEffect.ts:56-160`;
  `experiments\needle-spike\node_modules\@needle-tools\engine\src\engine\postprocessing\postprocessing.ts:30-99,110-195,215-314`.
- **N4 — Needle composer, lazy loading, quality, and cleanup:**
  `experiments\needle-spike\node_modules\@needle-tools\engine\src\engine-components\postprocessing\PostProcessingHandler.ts:51-208,231-308,314-482,571-608`.
- **N5 — separate Needle occlusion behavior:**
  `experiments\needle-spike\node_modules\@needle-tools\engine\src\engine-components\SeeThrough.ts:34-112,114-198,225-340`.
- **B1 — Blendlink versions:** `packages\blendlink\package.json:1-4,38-62`;
  `node_modules\three\package.json:1-4`;
  `node_modules\postprocessing\package.json:1-4`.
- **B2 — Blendlink authored outline contract:**
  `packages\blendlink\src\components.ts:304-320`;
  `packages\blender-addon\component_schema.py:47-51,252-276`;
  `packages\blender-addon\props.py:662-684,1368-1375`.
- **B3 — Blendlink outline adapter and lifecycle:**
  `packages\blendlink\src\threeComponents.ts:391-588,621-650,725-734,1271-1320,1516-1528,2091-2110`.
- **B4 — Blendlink outline tests and post-edge AA:**
  `packages\blendlink\src\threeComponents.test.ts:218-337`;
  `packages\blendlink\src\threeComponents.ts:534-551`.
- **P1 — installed pmndrs selection mechanics:**
  `node_modules\postprocessing\build\index.js:2091-2270`.
- **P2 — installed pmndrs OutlineEffect:**
  `node_modules\postprocessing\build\index.js:8659-9134`; base disposal at
  `:2580-2851`.
- **P3 — installed pmndrs depth/mask override mechanics:**
  `node_modules\postprocessing\build\index.js:1560-1724,6705-6902,8339-8385,8498-8614`.
- **T1 — Three r184 inverted-hull WebGL outline:**
  `node_modules\three\examples\jsm\effects\OutlineEffect.js:1-475`.
- **T2 — Three r184 selected-object TSL outline:**
  `node_modules\three\examples\jsm\tsl\display\OutlineNode.js:45-127,428-532,749-790`.
- **T3 — Three r184 TSL toon outline:** implementation in
  `node_modules\three\build\three.webgpu.js:40492-40656`; official interface
  linked below.

[needle-components]: https://engine.needle.tools/docs/api/modules/Built-in_Components.html
[needle-component-reference]: https://engine.needle.tools/docs/reference/components.html
[needle-postprocessing]: https://engine.needle.tools/docs/api/classes/Engine_Core.PostProcessing.html
[pmndrs-outline]: https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/OutlineEffect.js~OutlineEffect.html
[three-toon-outline]: https://threejs.org/docs/pages/OutlineEffect.html
[three-outline-node]: https://threejs.org/docs/pages/OutlineNode.html
[three-toon-node]: https://threejs.org/docs/pages/ToonOutlinePassNode.html
[three-webgpu]: https://threejs.org/manual/en/webgpurenderer
[webgl-context-loss]: https://registry.khronos.org/webgl/specs/latest/1.0/
