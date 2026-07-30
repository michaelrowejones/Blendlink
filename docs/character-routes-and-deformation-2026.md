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

**Phase 1 — export-time lowerings, no runtime code. SURFACE_DEFORM lowering SHIPPED 2026-07-30.**
Measured on ellie, exhaustively over all 331 frames:

| mesh | ships today | lowered | improvement |
| --- | --- | --- | --- |
| `GEO-ellie_teeth_top.001` | 178.8 mm = 143.53% | **0.089 mm = 0.071%** | 2009× |
| `GEO-ellie_teeth_btm.001` | 173.8 mm = 144.87% | **1.109 mm = 0.925%** | 157× |

Both on 8 joints of `RIG-Ellie.001`, adding **no new joints** — every bone was already shipped.

Three corrections the measurement forced on this plan:

- **"Guard by verifying the target's stack is pure LBS" is refuted.** On ellie that test is both
  unnecessary — both impure targets lower fine — and insufficient, because the target whose
  SHRINKWRAP is *provably inert* (0.000 m contribution) is the worse of the two at 0.925%. The
  guard measures the residual instead.
- **The "~0.25%" above was never the lowering error.** It is the SHRINKWRAP impurity, reproduced
  at 0.234% and 0.000%. The real error is 0.071% and 0.925%. The bottom is 3.7× the plan's claim
  because its rest cage is 42 verts driving a 678-vert mesh, and barycentric interpolation cannot
  reproduce SurfaceDeform's multi-polygon reconstruction at that resolution.
- **Reading Blender's own bind data is impossible.** 5.2 exposes 20 RNA properties on
  `SurfaceDeformModifier` and none is bind data; the `SDefVert` array never leaves C.

Still owed in Phase 1: class-D attribute bake plus the animated-driver refusal. MASK
static/animated is answered by §6e — the mechanism is still owed, ellie does not need it.

**Phase 1 residue — the fannypack zippers, and why they are not the next win.** After the teeth
lowered, `GEO-ellie_fannypack_zippers.001` is the *only* mesh left in ellie's Geometry Fidelity
refusal. Two separate things are true about it and they point opposite ways:

- **Its bind-branch refusal is over-strict.** Phase 1 refuses because three SurfaceDeform binds
  share the mesh and "their visibility selects between different cages". Measured: they are
  mutually exclusive by construction — `SurfaceDeform` is driven by `1-FannyPackOpenable`, both
  `OpenableTop` and `OpenableBot` by `FannyPackOpenable` — and that rig property is **keyed by 6
  actions with every keyframe 0.0**, single distinct value set, current value 0. Exactly the §6e
  pattern. So the branch is provably resolved to one live cage,
  `GEO-ellie_fannypack_zipper_combined_deformer.001`, and the refusal could be relaxed with the
  constant-driver predicate Blendlink already applies elsewhere.
- **Relaxing it would not unblock ellie.** The same mesh carries two animated LATTICE modifiers,
  `Lattice Front` and `Lattice Top`, following cages the timeline moves through `RIG-Ellie.001`.
  Those are Phase 3, which §6a leaves blocked. The zipper mesh is refused for a second reason that
  no export-time lowering can address.

Record this so nobody relaxes the bind-branch refusal expecting a green compile. The honest status
is that Phase 1 took ellie's geometry refusals from three meshes to one, and the last one is
waiting on Phase 3.

**Phase 1b — stop baking constant channels. Measured 2026-07-30, then corrected by an
adversarial re-measurement the same day; do this before Phase 2.**
The per-channel bake writes a texture for every channel whether or not the channel varies. On
ellie that is **38 of 85 textures and 75.354 MiB of the 201.5 MiB GPU budget — 37.4% — for images
that are a single solid colour**. "Constant" here means *zero* variation in every channel, not
merely small variation. The total cross-checks against the manifest's own
`stats.gpuTextureBytes`.

| what | count | GPU bytes | fill |
| --- | --- | --- | --- |
| emissive | 26 | 59.667 MiB | `(0,0,0)` — pure black, all 26 |
| ORM | 10 | 15.583 MiB | e.g. `(255,152,64)` = AO 1.0, rough 0.596, metal 0.251 |
| base colour | 2 | 0.104 MiB | `(236,67,216)`, `(162,149,135)` |

**Every one of these needs a factor rewritten; none is free.** glTF multiplies factor by texture,
so dropping a texture and leaving the factor alone changes the result in all three classes:
a black emissive under `emissiveFactor = [1,1,1]` becomes **fully emissive white**, and a constant
ORM under `roughnessFactor = metallicFactor = 1.0` becomes **roughness 1.0 / metallic 1.0** rather
than the constant. The rewrites: `emissiveFactor → [0,0,0]`; `roughnessFactor`/`metallicFactor` →
the constant channel value (linear, no conversion, and all 10 have AO = 255 so occlusion drops as
identity); `baseColorFactor` → the sRGB→linear fold, e.g. `(236,67,216)` → `[0.8388, 0.0561,
0.6867]`.

**Most of this is duplication, not constancy, and that changes what to build first.** The 38
constant textures share only **16 distinct payloads** — one single payload backs 10 of them and
accounts for 53.3 MiB by itself. **52.583 MiB is recoverable by plain de-duplication**, leaving
**22.771 MiB (11.3%) as the elision's actual marginal win.** `optimizer.ts:903` already runs
`dedup(...)`, but with `keepUniqueNames: true`, and all 85 texture names are unique, so it merges
exactly nothing. That is not an oversight to flip: the policy note at `optimizer.ts:962-978` says
never *"flatten a solid texture ... or discard a named resource that may be addressed by
application code"*, and `prune` is called with `keepSolidTextures: true`. Changing it reverses a
recorded decision. The counter-argument worth weighing is that these names are generated
(`channel-<hash>-emissive`), not authored, so "application code may address them" is much weaker
here than for an artist-named texture — but that is a call to make deliberately, not by flipping a
flag.

**The root cause is not what I first wrote.** I claimed the router computes `routing: "constant"`
and the baker ignores it. That is refuted: all 105 constant-routed channels already take
`route: "factor"` and none of them produced a texture. The truth is the same defect as 1c — the
26 constant-emissive materials are **exactly** the 26 `BLEND` materials, and all 26 are
`surfaceRoot: "unsupported"` with an empty channel list. The router has no answer for these
materials to ignore. A non-Principled root means the whole surface is baked, which emits a black
emissive, a constant ORM *and* the binary alpha that forces BLEND, all from one cause. **1b and 1c
are one defect with three symptoms**, and the population is the stylized set that §8a shows TSL
could carry.

**The attestation gate — SHIPPED 2026-07-30, ahead of the elision.** The emissive check used to
sit entirely behind `if emissive_fact is not None`, so it only ran when an emissive *image* was
planned: the one case that cannot fail. Both languages now gate the other case — when no emissive
image is planned the emitted factor must be black and no `KHR_materials_emissive_strength` may
ship. `npm run test:full` passes with the gate in place, so the invariant holds across the whole
release corpus, not just ellie. When the elision starts folding a non-zero constant emission into
the factor it must record the expected value on the plan and compare against it; widening this
branch silently would hand 1b back the hole it exists to close.

**Also shipped 2026-07-30: the duplicate half of the win.** `mergeGeneratedChannelTextures` in
`optimizer.ts` merges byte-identical compiler-generated channel textures. Measured on ellie:
**85 → 63 textures, 201.458 → 148.875 MiB GPU (−52.583 MiB, −26.1%)**, no material slot losing a
binding, file size essentially unchanged. The scoping matters — it matches only
`channel-<token>-<slot>`, whose token is `sha256(_variant_key(...))[:12]` and therefore never was
stable identity, so every authored name keeps all three of the protections that guard it
(`keepUniqueNames`, `protectNamedResourcesForPrune`, `captureSemanticIdentity`). **1b's remaining
marginal win is the 22.771 MiB that is genuinely constant rather than duplicated.**

Finally, it is a **VRAM and binding-count win, not a download win** — those PNGs are 14 KB each
and total 207 kB of a 10.2 MB payload. Quote the **37.4%**, not the megabytes: under KTX2/BC7 the
whole budget is roughly 50 MB and the constant share roughly 19 MB, but the fraction holds.

**These figures are stale and must be re-measured before they score anything.** The GLB they came
from is dated 2026-07-29 07:10 and predates both the `TEXCOORD > 3` refusal
(`material_compiler.py:4576`) and the UV prune; it still carries texCoord 4, 5 and 6, which HEAD
now refuses. The atlas at HEAD is not the atlas these 38 were counted from.

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
  slot; 180.1 MB is single-use.** Phase 1b plus plain de-duplication remove 75.354 MiB of that,
  which leaves ~126.1 MiB in genuinely varying single-use images — that residue, not the headline
  number, is what the atlas has to beat. The allocator run is still owed, and so is re-taking this
  whole baseline on a clean HEAD compile.

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

**Node-type census — SUPERSEDED, and wrong in a way worth recording.** A first pass diffed every
`bl_idname` in each material tree against the 46 types `tsl_ir.py` handles and reported the gap as
`ShaderNodeBump` (35 materials) and `ShaderNodeVectorRotate` (17), concluding that Bump alone would
move coverage from 12/49 to 28/49. **That is false.** The census counted nodes the IR never walks.
`_leaf_channels` (`tsl_ir.py:423`) reads exactly five Principled sockets — Base Color, Metallic,
Roughness, Alpha, Emission Colour and Strength — and **never reads `Normal`**. Every one of those 35
Bump nodes feeds `Normal`, so the IR never traverses to it and it was never a blocker.
Implementing `ShaderNodeBump` would unblock **zero** materials.

**Reachability-aware census — the real node gap.** Walking only the sub-graph the IR actually
reads: **47 of 49 materials contain no unsupported node at all.** Two do:

| material | reachable unsupported nodes |
| --- | --- |
| `ellie.denim_inside` | `ShaderNodeVectorRotate` |
| `ellie.eyes_pupils` | `ShaderNodeCameraData`, `ShaderNodeTangent`, `ShaderNodeVectorTransform` |

Four node types across two materials — and 23 of the 49 reach no nodes whatsoever, being
constant/factor-only. This agrees with the translation run below, where the surviving one-off
refusals name `VectorTransform` on exactly `eyes_pupils`.

**The lesson, since this misled three separate conclusions.** Node presence ≠ node reachability ≠
translation blocker. Any future coverage claim has to walk from the channel sockets, or it is
counting decoration.

**Normal is not carried at all, and that is the real finding under the Bump question.**
`emit_surface` returns six channels and `Normal` is not one of them, so every material that
translates today translates *without its bump or normal detail*. The portability audit does report
this (`"Bump shading has no direct glTF form"` on 31 materials), so it is not silent — but the TSL
route's own fidelity ceiling is lower than §8a previously implied. Carrying the Normal channel is a
real feature worth scoping on its own, and `ShaderNodeBump` is one input to it rather than a
standalone win.

**Actual translation run — corrected twice, then improved.** My first run reported 13/49
translating with 30 of 36 refusals blamed on a `128x128` embedded-IR image bound. **That bound was
an artifact of my probe**, which called `emit_surface` without production's configuration:
`_allow_texture_refs` defaults to `False`, and `material_compiler.py:2737` and `:3024` set it
`True` around the real plan and compile. With it on, the image bound refuses **nothing** and the
whole `texture_ref` path — Python emit, `tslNodeRecipe.ts` resolve, `tslMaterialRuntime.ts`
publish, with tests — is already shipped and wired.

Re-run with production config, the dominant blocker was Noise: **29 of 49 materials refused on
`Noise scale > 20`, 27 of them at exactly scale 40.**

**The scale bound is now measured at 40, and coverage went 13/49 → 20/49 (27% → 41%).** A new
gated cell `noise-scale40` in the differential harness passes with 5.6× headroom, and the harness
stays green at 110 cells / 109 gated:

| cell | meanAbs | p99Abs | maxAbs | gate (maxAbs 0.01) |
| --- | --- | --- | --- | --- |
| `noise-scale16` | 1.73e-4 | 5.37e-4 | 7.19e-4 | pass |
| `noise-scale20` | 2.03e-4 | 6.33e-4 | 9.46e-4 | pass |
| **`noise-scale40`** | **4.15e-4** | **1.30e-3** | **1.77e-3** | **pass** |
| `noise-scale100` | 1.023e-3 | 3.16e-3 | 4.33e-3 | **fails meanAbs by 2.3%** |

Two things worth keeping from that table. The error is **near-linear in frequency, not a
decorrelation cliff** — which refutes the justification the emitter itself carried, that scale 100
"decorrelates to 1.8e-1". The real figure is 1.023e-3, wrong by ~175×, and it predates whatever
fixed the fBM composition that the harness README still lists as a 1.9e-1 diagnostic. And scale
100 *still refuses*, because it misses the meanAbs gate by 2.3% — the tolerance was not loosened to
admit it, and the material bake carries it faithfully today. There is no `noise-scale100` cell in
the manifest because a cell draws its IR from the production emitter, so the harness structurally
cannot hold a cell above the emitter's own bound.

Clearing the bound exposed what was queued behind it — `_refuse` raises on the first problem, so
these were always there:

| refusal | materials |
| --- | --- |
| `Noise distortion has no cell yet` | 10 |
| `ShaderNodeVectorRotate has no proven TSL mapping` | 7 |
| `Noise detail 6 exceeds the proven range (<= 4)` | 4 |
| `Image interpolation has no cell yet` | 2 |
| `VectorTransform`, `AddShader`, `NormalMap`, tinted Transparent, scale 100, dimensions | 1 each |

`noise-detail6` was then earned the same way — maxAbs **2.49e-4** against the 0.01 gate, **40x
headroom**, barely worse than detail 4's 1.94e-4. The bound had sat at 4 citing a detail-6
measurement of 3.9e-2, wrong by ~157x: the same vintage and the same direction as the scale-100
claim. **Two stale figures in this file's own comments had been capping the compiler.**

That one bought no coverage, and the reason is worth recording: the four detail-6 materials also
use an unsupported noise *dimension*, so clearing detail moved them from one refusal to the next
and `Noise dimensions` went 1 → 5. Earning a bound and gaining a material are different events.

Standing at scale 40 / detail 6, the blockers are:

| refusal | materials |
| --- | --- |
| `Noise distortion has no cell yet` | 10 |
| `ShaderNodeVectorRotate has no proven TSL mapping` | 7 |
| `Noise dimensions has no cell yet` (1D/4D) | 5 |
| `Image interpolation has no cell yet` | 2 |
| `VectorTransform`, `AddShader`, `NormalMap`, tinted Transparent, scale 100 | 1 each |

Noise is still dominant at **15 of 29** — distortion and dimensions now, not scale or detail —
with `VectorRotate` second at 7. Distortion is the one piece here that is real implementation
rather than a measurement: Blender perturbs the input coordinates by noise sampled at three
hash-derived offsets, and because those offsets depend only on a seed they are constants that can
be folded at emit time rather than requiring Blender's integer hash in TSL.

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
