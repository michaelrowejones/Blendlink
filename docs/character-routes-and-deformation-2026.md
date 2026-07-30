# Character routes and deformation — measured plan (2026-07-29)

Status: plan. Supersedes the "declare rigged characters out of scope" recommendation.

Every number here was measured against `showcases/ellie` (a CloudRig character), three r184 in
`node_modules/three/src`, or the Blender 5.2 glTF exporter. Inferences are marked.

## 1. The model: three axes, not one

Blendlink has three ways to carry a Blender look, but they are not alternatives on one axis:

- **Lighting** — baked lighting atlas, or realtime lights.
- **Surface** — stock glTF PBR, baked material maps, or TSL translation. These three *are*
  alternatives to each other, per object-slot.
- **Deformation** — apply at export, translate to a runtime vertex program, bake correctives,
  or refuse. This axis did not exist and is what a character actually needs.

Two corrections that follow from source:

**Lighting and TSL are not exclusive.** `NodeMaterial.setupLightMap` builds an `IrradianceNode`
whenever `material.lightMap` is set, and `TextureNode.getDefaultUV` honours the TEXCOORD_1..3
binding `fork_lighting_materials` emits. A node material can carry a Blendlink lightmap *and* a
TSL `colorNode`. The exclusivity is ours alone: the `compile_objects` subtraction in
`export_scene.py` removes atlas-owned objects from material compilation.

**The deforming-object atlas exclusion is correct as written.** Both existing bake outputs bake
light (COMBINED with all passes; DIFFUSE-indirect irradiance), and baked light is genuinely
invalid for a deforming object. What is missing is a third `bakeOutput` — surface only, no
light. This is the character case.

**Performance ordering is per material, not per method.** Ellie measures 211 MB of GPU texture
against a 23.9 MB glb with 65 draw calls. On that character the scarce resource is texture bytes
and draw calls, not ALU, and a procedural TSL material can be cheaper than either bake.

## 2. What actually breaks the character

Blender's glTF exporter mutes only the ARMATURE modifier before evaluating the depsgraph, so
every other deformer's frame-1 state is frozen into the exported bind pose. Measured deviation
over frames 1..320 as a fraction of bbox diagonal — `max_F |C(F) − C(1)|` where `C` is the
closed-form deformers' contribution on top of skinning:

| object | deviation | cause |
| --- | --- | --- |
| `teeth_top.001`, `teeth_btm.001` | 142.8%, 144.2% | SURFACE_DEFORM |
| `eye.R.001`, `eye.L.001` | 89.4%, 88.5% | LATTICE |
| fannypack, handkerchief | 2.4%, 1.6% | CORRECTIVE_SMOOTH |
| head | 0.6% | SHRINKWRAP + LATTICE |
| jacket, hair, trousers, body, zippers | 0.000 | — |

**Six modifier instances on four objects — 5.2% of the 115 live modifiers on visible meshes —
cause the entire visible defect.** Modifier counts badly overstate the problem: the file holds
two copies of the character, and hidden objects never reach the exporter.

## 3. Taxonomy

Blender 5.2 has 57 non-Grease-Pencil modifiers. The classes that matter:

- **A — apply at export** (SUBSURF, MIRROR, ARRAY, SOLIDIFY, MASK, BOOLEAN, ...). Already what
  `export_apply=True` does. Drops out of this class the moment a parameter is animated.
- **S — skeletal** (ARMATURE). glTF-native. Two silent gaps: `use_deform_preserve_volume` (DQS)
  is linearised — 4 of 29 on ellie — and `use_bone_envelopes` has no glTF form.
- **B1 — closed-form per vertex** (LATTICE, SIMPLE_DEFORM, CAST, WAVE, WARP, CURVE, HOOK,
  DISPLACE). Translatable to a vertex program: each vertex is a pure function of its incoming
  position, an optional group weight, a few scalars and at most one auxiliary matrix.
- **B2 — needs the target's runtime state** (SHRINKWRAP, SURFACE_DEFORM, MESH_DEFORM). Lower to
  skin weights when the target is LBS-skinned; otherwise translate or bake. NEAREST_SURFACEPOINT
  shrinkwrap re-searches every frame — refuse.
- **B3 — iterative neighbourhood** (CORRECTIVE_SMOOTH, SMOOTH, LAPLACIAN*). Compute prepass or
  ignore. On ellie this class is worth 2.4% at best — deprioritise.
- **D — attribute/data** (DATA_TRANSFER, NORMAL_EDIT, WEIGHTED_NORMAL, VERTEX_WEIGHT_*,
  UV_PROJECT/WARP). Bake to vertex attributes when static; refuse when driven by a moving
  transform.
- **R — simulation** (CLOTH, SOFT_BODY, ...). Refuse. Do not build a solver.

MASK is not a deformer: static masks are export-time topology, animated ones are
`material.maskNode` fragment discard, which the shadow pass honours for free.

## 4. The decisive three.js facts

**`material.positionNode` runs BEFORE skinning, not after.** `setupPosition` eagerly assigns
`positionLocal` from `positionNode`, but `SkinningNode` writes `positionLocal` inside its own
`setup()`, which `StackNode.build` appends to the tail and generates last — and
`SkinningNode.positionNode` defaults to `positionLocal`, so skinning consumes the deformer's
output. Confirmed in generated WGSL and GLSL.

**Post-skin deformation is still expressible**, by the mechanism `SkinningNode` itself uses:
wrap the deformer in a Node whose `setup()` writes `positionLocal`, and `toStack()` it after
skinning. This is inferred from build order and is the gating experiment (§6a).

Three consequences to design in, not discover:

1. **Normals.** A deformer must write `positionLocal`, `normalLocal` *and* `positionPrevious`.
   Nothing derives normals from position.
2. **Motion vectors.** `positionPrevious` defaults to rest geometry; TRAA is the WebGPU default,
   so a deformer that skips it renders correctly and ghosts in motion.
3. **Shadows ignore the override.** The renderer swaps in a shadow material that copies only
   `colorNode`, `depthNode` and `positionNode` — a `setupPosition` override is not carried, so
   shadows stay undeformed. Accept and diagnose; measure the silhouette delta first.

Do **not** build on `geometryNode` (zero usages in all of r184; it is a compute-dispatch hook,
built as `void` for side effects) or `vertexNode` (replaces clip-space output only; view and
world position still come from the undeformed value, and shadows ignore it).

## 5. Plan

**Phase 0 — make the pipeline honest.** No new capability. Refuse a deforming modifier with no
ARMATURE in an animated scene (this alone catches the teeth). Add a per-object frozen-modifier
residual diagnostic with leave-one-out attribution: warn >1%, refuse >10%. Report silently
dropped shape keys (28 of 241 meshes carry them) and DQS linearisation. Make the `bakeOutput`
ternary raise instead of collapsing an unknown value to `appearance`. Extract the differential
harness runner so its oracle is pluggable.

**Phase 0f — the export depends on which action is assigned.** Found while specifying 0a, not
in the original plan. Ellie's `["Quality"]` rig property drives 39 modifier properties and is
keyed at 2.0 by five of the 56 shipped clips, but is *not* keyed by the assigned
`ANI-ellie.idle`, where it holds 1. Swapping the assigned action moves 31 `SUBSURF.levels` and
the evaluated visible-mesh vertex count from **47,022 to 173,290 — 3.68×**. The shipped GLB is
the Quality=1 state; five clips ship expecting the denser mesh. Constant within any one clip, so
it does not disqualify class A, but the published topology is silently whichever action happened
to be assigned at export. Report the assigned action and any modifier property driven by a
rig property that other clips key differently. Same shape as 0a: no depsgraph evaluation needed
to detect it, only to quantify it.

**Phase 1 — export-time lowerings, no runtime code.** SURFACE_DEFORM to `JOINTS_0/WEIGHTS_0`
when the target is skinned — fixes two of the four catastrophic objects, 143% to ~0.25%. Guard by
verifying the target's stack is pure LBS, else measure and refuse. Class-D attribute bake plus
the animated-driver refusal. Split MASK static/animated.

**Phase 1b — stop baking constant channels. Measured 2026-07-30; do this before Phase 2.**
The per-channel bake writes a texture for every Principled channel whether or not the channel
varies. On ellie that is **38 of 85 textures and 75.2 MB of the 201.5 MB GPU budget — 37.3% —
for images that are a single solid colour**. Decoded from the shipped GLB, "constant" meaning no
channel varies by more than one 8-bit code value:

| what | count | GPU bytes | fill |
| --- | --- | --- | --- |
| emissive | 24 | 53.0 MB | `(0,0,0)` — pure black, every one |
| ORM | 12 | 22.2 MB | e.g. `(255,152,64)` = AO 1.0, rough 0.596, metal 0.251 |
| base colour | 2 | 0.1 MB | `(236,67,216)`, `(162,149,135)` |

**75.2 MB of it is free**, not merely recoverable: every black emissive sits under
`emissiveFactor = [1,1,1]` so the product is already zero, and every constant ORM sits under
`roughnessFactor = metallicFactor = 1.0` so the constant *is* the factor, exactly. Only the two
base colours (0.1 MB) need arithmetic, an sRGB→linear fold to `baseColorFactor`
(`(236,67,216)` → `[0.8388, 0.0561, 0.6867]`). Nothing needs re-baking and nothing changes
visually.

The information to skip them is already in the plan and is simply not read. The shipped manifest
records **105 channels as `routing: "constant"` with the exact `value`** — against 8 `unique`, 3
`tileable`, 2 `viewDependent`, 1 `uniform` — including `Emission Color: [0,0,0,1]`, which is the
24 black textures verbatim. The channel router does the analysis and the baker ignores the
answer.

This lands ahead of Phase 2 because it is bigger than what the shared atlas was scoped to buy,
costs no new route, and shrinks the input the atlas would have to pack. Note it is a **VRAM and
binding-count win, not a download win** — those PNGs are already 14 KB each, so the 23.8 MB GLB
barely moves. The win is 37% of texture memory, 38 fewer texture bindings, and 51 materials that
stop pretending to be textured.

**Phase 1c — half the character is in the transparent queue and none of it is transparent.
Measured 2026-07-30.** 26 of ellie's 51 materials publish `alphaMode: BLEND`. Every one of the 26
is a `BLENDLINK_WEB.*` per-channel bake output, and **every one of them has exactly 0.00% midtone
alpha** — the base-colour alpha is purely binary, 0 or 255. It is the atlas's uncovered
background, not authored translucency. Blender agrees: of the 49 source materials on visible
meshes, **47 are `DITHERED` and only 2 are `BLENDED`**.

This is not a hidden bug. The compiler declares it at
`packages/blender-addon/material_compiler.py:3432` — *"Baked alpha publishes as BLEND; MASK
detection from baked coverage is not implemented yet"* — and the mode is chosen one branch above,
at `:3413`: `"BLEND" if (alpha_baked or alpha_factor < 1.0) else "OPAQUE"`. What is new is the
evidence that implementing the missing detection is now worth it and is provably lossless: the
coverage is binary in **26 of 26** cases, so `MASK` with cutoff 0.5 is exactly equivalent on every
sampled texel while restoring depth write.

The cost of leaving it is not only performance. A `BLEND` material does not write depth and is
sorted back-to-front per frame, so overlapping surfaces on the same character — eyes inside a
head, teeth inside a mouth, hair over a scalp — resolve in draw order rather than depth order.
That is the mechanism behind the "seeing the eyeballs through the head" defect reported against
the first ellie render.

**Why the alpha is baked at all.** The BLEND population is exactly the materials whose surface
root the channel router could not read: **all 26 are `status: needsBake` with
`surfaceRoot: "unsupported"`**, and their channel list is empty — the router emits no channels at
all, not merely no `Alpha`. `ellie.head_hair` has `surfaceRoot: "principled"`, a full seven-channel
record including `Alpha: {routing: "constant", value: 1}`, and ships opaque. `ellie.head`, off the
same mesh, has an unsupported root and ships BLEND.

The causal chain is therefore: non-Principled surface root → nothing to read a constant alpha
*from* → the whole surface is baked, alpha included → `alpha_baked` is true → `:3413` picks BLEND.
`surfaceRoot: "unsupported"` is necessary but not sufficient: 7 further materials are also
`needsBake`/`unsupported` and still publish OPAQUE, because they never went through the
per-channel bake.

That distinguishes 1c from 1b. In 1b the router genuinely does know the answer and the baker does
not ask. Here the router has nothing to offer, so the fix is not "read the existing record" — it is
the MASK detection the compiler already names as missing, deciding the mode from the *baked
coverage* instead of from the absence of a source constant. Worth noting where this lands
strategically: those 26 stylized, non-Principled materials are precisely the population the TSL
route exists to serve, so 1c is the near-term correctness fix and TSL is the answer that stops them
being baked at all.

Both 1b and 1c were measured on the pre-texCoord-fix GLB and need re-quoting after a clean HEAD
compile.

**Phase 2 — the route model.** Lighting × Surface split; `bakeOutput = "material"` through all
four gate points; per-slot shared surface atlas; delete the `compile_objects` subtraction so
lighting and TSL compose; promote TSL to a real route with its own property, UI and decision
path. Success is measured as ellie's draw calls (65) and texture bytes before/after — against
the post-1b figure, **126.3 MB**, not today's 201.5 MB, so the atlas is not credited with 1b's
win. (The plan's earlier "211 MB" was an estimate; 201.5 MB is measured from the shipped GLB as
RGBA8 plus a full mip chain.)

**Phase 3 — one runtime deformer: LATTICE, post-skin.** A deform node material subclass, a
deformer node writing position/normal/previous, the cage as a 3D texture or uniform array. All
68 of ellie's lattices are KEY_BSPLINE — 64-tap B-spline is the required path, not an
optimisation — and the head stacks 7 cages (~448 taps/vertex), so a cost budget and refusal are
part of the deliverable. Fixes the remaining two objects.

**Phase 4 — pose-driven correctives.** Gated on §6f. Sample the 56 clips, fit sparse morph
targets, drive weights from pose. Worth 2.4% on ellie — do not start until a scene demands it.

**Phase 5 — escape hatches.** VAT as a per-object opt-in with a hard byte-budget refusal
(ellie would be ~815 MB, so this refuses by measurement). Simulation refuses. Spring bones as an
authored component if secondary motion is ever needed.

## 6. Open measurements, in priority order

- **a. ANSWERED — NO. Measured 2026-07-29** via `showcases/ellie/deformer-order.html` +
  `src/deformerOrder.js`, four authoring patterns against both backends, a fresh renderer per
  pattern (sharing one let the node-builder cache serve a previously built program, which
  presented as an override that never ran while still producing a shader):

  | pattern | emitted? | position vs skinning |
  | --- | --- | --- |
  | `Fn(…)().toStack()` after `super.setupPosition()` | **no** — the Fn body never executes | absent |
  | a real `Node` subclass `.toStack()`'d (void *or* vec3 return) | **no** — `setup()` never runs | absent |
  | `positionLocal.addAssign(…)` directly after super | yes | **before** skinning |
  | `material.positionNode` reading `positionLocal` | yes | **before** skinning |

  Two conclusions. `toStack()` called from inside a `setupPosition` override never builds the
  node at all — silently — so the originally proposed Phase 3 mechanism would have shipped a
  deformer that does nothing. And the two patterns that do emit are byte-identical and both
  land *before* skinning, confirming that `positionNode` feeds into skinning rather than
  following it.

  **Post-skin deformation is therefore not expressible through any documented material-level
  seam in r184.** The remaining routes are: open-code skinning inside `positionNode` (carrying
  the four traps already priced, including an `isSkinnedMesh` lie that disables per-frame
  material updates); a compute prepass (WebGPU only — WebGL2's transform-feedback path renders
  black); or pose-driven morph targets, which is Phase 4 and glTF-native. Phase 3 must not be
  written until one of those is proven. `getShaderAsync` returned nothing usable on the WebGL2
  backend, so that half is a probe limitation rather than a measured three limitation.
- **b. How wrong is an undeformed shadow for the eyes and teeth?** Decides whether the shadow
  limitation needs a workaround. Diff the shadow map; likely sub-texel.
- **c. What does 7-stacked B-spline LATTICE cost on the head?** Sets the refusal threshold.
- **d. Is CORRECTIVE_SMOOTH's 2.4% visible at delivery resolution?** Decides whether Phase 4 or
  class B3 ever gets built.
- **e. ANSWERED — NO. Measured 2026-07-30** by RNA read over the 33 visible meshes. All **13**
  MASK modifiers in the scene are `VERTEX_GROUP` mode; **zero** are `ARMATURE`. The "no pre-skin
  deformers" conclusion holds, and there is no bone dependency hiding in a mask.

  The read also settles Phase 1's "split MASK static/animated" for this scene, in the direction
  that removes work. Of the 13, four are enabled — `eyelashes/Mask`, `head/Mask`,
  `jacket/Mask Collar`, `tongue/Mask` — and **not one of them carries any animation on any
  property**. The other nine are disabled and *are* driven, but only on `show_viewport` /
  `show_render`, never on `vertex_group` or `threshold`. Each driver reads one rig custom
  property (`Properties_Character_Ellie["Mask Left Arm"]` and siblings, `PRP-Spine["FannyPackStrap"]`).

  A driver on `show_viewport` is topology-changing — enabling a MASK deletes vertices — so this
  looked like a second, worse instance of Phase 0f. It is not. Every one of those properties is
  keyed by 6–7 actions and **every keyframe in every action is 0.0**: one distinct value set,
  `(0.0,)`, per property, across the whole clip library. The remaining ~50 clips do not key them
  and hold the same 0.0. So the masks are provably off in every clip, and the shipped topology
  does not depend on which action was assigned. Contrast `["Quality"]`, which five clips key at
  2.0 — that is why 0f is real and this is not.

  Phase 1 still needs the static/animated split as a *mechanism*, because nothing here proves the
  next scene is as tidy; it just does not need it for ellie.
- **f. Is the deformer residual a pure function of pose?** Go/no-go for Phase 4. Find two frames
  in different clips with near-identical bone transforms and diff the deformed meshes.
- **g. Does a shared surface atlas actually reduce ellie's GPU bytes?** Phase 2's whole
  justification. Run the allocator at candidate densities and sum against the **post-1b 126.3 MB**
  *before* building the route. Half-measured 2026-07-30: today's budget is **201.5 MB** across 85
  textures (RGBA8 + full mip chain, decoded from the shipped GLB), 65 draw calls, 51 materials.
  Composition: one 2048² `ellie.dirt_map` at 21.3 MB shared by 3 materials, 30 × 1024² at 160.0 MB,
  then 9 × 512², 18 × 256², 25 × 128², 2 × 64². **Only 21.3 MB is shared by more than one material
  slot; 180.1 MB is single-use.** Phase 1b removes 75.2 MB of that as provably constant, which
  leaves ~126.3 MB in genuinely varying single-use images — that residue, not the headline number,
  is what the atlas has to beat. The allocator run is still owed.

  **The draw-call half of the same baseline, measured 2026-07-30.** 65 draw calls = 36 mesh
  instances carrying 65 primitives; no mesh is instanced more than once. A glTF mesh needs one
  primitive per material, so **if the surface atlas collapses materials, the floor is 36 draw
  calls — a 45% cut** — and 15 multi-material meshes account for every one of the 29 extra calls.
  The worst is `ellie_boots` at 9 primitives / 9 materials on one 17,148-triangle mesh; five
  jacket pins each split into 2 purely to give the underside its own material. Below 36 you would
  have to merge meshes, and there the binding constraint is **20 distinct vertex-attribute
  layouts**, with alpha mode (26 BLEND / 25 OPAQUE) as the last hard boundary.

  Two things fell out that are not about the atlas:

  - **All 51 materials are `doubleSided: true`.** Nothing is back-face culled anywhere on the
    character. Worth a separate look — it is fragment cost paid on every surface, and for a
    closed character mesh most of it should be unnecessary.
  - Vertex attributes total 4.74 MB, of which **1.24 MB (26.1%) has no standard `GLTFLoader`
    binding**: `TEXCOORD_4..6` (481 KB) and `COLOR_1..COLOR_8` (788 KB). Neither is straightforwardly
    waste, and both need care before anyone "fixes" them:
    - The `TEXCOORD_4..6` here is the **pre-fix state**. This GLB predates the texCoord work;
      `MAX_BINDABLE_TEX_COORD = 3` at `packages/blender-addon/material_compiler.py:4576` already
      refuses them at HEAD. Historical, not open. It does mean the whole §6g measurement needs
      re-taking on a clean HEAD compile before Phase 2 is scored against it.
    - The extra `COLOR_n` sets **are** read — the TSL recipe path binds them by name
      (`color_1`, see `tslNodeRecipe.test.ts:89`) — so they are not dead. But **135 of the 194
      extra COLOR bindings are byte-identical to that primitive's own `COLOR_0`.** That is a
      concrete, measured instance of the TSL consolidation question: 70% of the extra colour
      sets carry no information their `COLOR_0` does not already carry. (Whether they already
      share accessors is a separate question this measurement does not answer, so the byte
      saving is not yet established — only the redundancy.)

## 7. Prior art

Nobody ships DCC deformers as deformers. Unreal, Unity, Houdini Engine, USD, VRM and Needle
Engine all resolve arbitrary stacks by refitting to pose-driven morph targets, baking to a vertex
cache, or replacing with a runtime approximation. glTF has no ratified or draft extension for
procedural deformation, mesh caches, VAT or cloth — morph targets are the only non-skeletal
deformation it carries.

Worth copying: **pose-space deformation** as Unreal's ML Deformer and Ziva RT ship it (copy the
shape, not the ML — start with per-bone-pair correctives); **our own differential harness**, with
a vertex-displacement oracle instead of a pixel one; and **VRMC_springBone** as the model for
honest approximation — the spec is explicit that spring bones are authored, not derived from a
sim.

## 8. TSL readiness

### 8a. Measured coverage against ellie, 2026-07-30

Two independent measurements over the 49 materials on ellie's visible meshes, ~9,300 shader nodes
in total, groups recursed.

**Node-type census** — every `bl_idname` reachable from each material, diffed against the node set
`tsl_ir.py` handles (46 types). The entire gap is **two node types**:

| missing node | materials needing it |
| --- | --- |
| `ShaderNodeBump` | 35 |
| `ShaderNodeVectorRotate` | 17 |

12 materials are already fully covered; 16 need only Bump; 13 need both; **none needs
`VectorRotate` alone**. So Bump alone takes coverage from 12/49 to 28/49, and both together reach
49/49 at the node-type level.

**Actual translation run** — `tsl_ir.emit_surface` invoked on all 49. 13 translate; 36 refuse by
name; **zero unexpected errors**, which is itself worth recording: every failure is a deliberate,
named refusal, not a crash. The 36 refusals:

| refusal | count | what it really is |
| --- | --- | --- |
| `Image 2048x2048 exceeds the embedded-IR bound (128x128); the texture transport carries it` | 30 | a transport bound, not a semantic gap — the shader is expressible, the image just travels separately |
| `Noise scale N exceeds the proven range (<= 20)` (N = 30, 100) | 2 | the known open noise-scale experiment |
| `ShaderNodeVectorTransform has no proven TSL mapping` | 1 | `ellie.eyes_pupils` |
| `surface node ShaderNodeAddShader has no surface-expression mapping` | 1 | `ellie.highlights` |
| `ShaderNodeNormalMap has no proven TSL mapping` | 1 | `ellie.scrunchie` |
| `Transparent BSDF with a non-white Color tints transmission; no cell yet` | 1 | `ellie.watch_glass` |

**Neither number is the truth on its own, and it matters which way each is wrong.** `_refuse`
raises on the *first* problem found, so the runtime list is a lower bound — 30 materials stop at
the image bound and were never walked far enough to hit their Bump nodes, which is why Bump never
appears as a refusal reason despite being in 35 materials. The census is an upper bound in the
other direction: it sees node *types* and knows nothing about per-mode gaps like the noise-scale
bound.

Taking the union, the complete blocker list for 65% of a real production character is:

1. the 128×128 embedded-IR image bound (30 materials) — transport, and the texture transport
   already carries these, so this may not be a gap at all once the route is real;
2. `ShaderNodeBump` (35) and `ShaderNodeVectorRotate` (17) — both plain math, both with
   direct TSL forms;
3. noise scale > 20 (2) — the experiment already on the books;
4. four one-off features, one material each.

That is a short, enumerable list, and it is the measured basis for treating TSL as the answer for
the stylized population rather than an aspiration. It also identifies the highest-value single
piece of work: **`ShaderNodeBump` is the most-needed missing translator in the codebase.**

### 8b. Structural gaps

Solid as a shipping material feature; not yet rails for a modifier IR. Four gaps to close in
Phase 2:

1. **It is not a route.** `blendlink_tsl_ir` has one read site, inside `_plan_material_bake`,
   unreachable unless the material bake is also requested, with no UI and no operator.
2. **The IR envelope is Principled-channel shaped** — per-channel byte budget, channel plan
   model, Principled root. Generalise to `{id, version, nodes, inputs, budget, hash}`.
3. **The runtime installer is fragment-only.** Separate "build a node graph from IR" from
   "install into a material slot"; that boundary is the reuse seam.
4. **One load-bearing invariant is untested.** The clone path restores null `*Node` slots after
   `Material.copy`; what that actually protects is skinning, because a non-null `vertexNode`
   bypasses `setupPosition` entirely. Add a SkinnedMesh + morph assertion that the generated
   vertex shader still contains the skinning statements.
