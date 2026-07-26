# Bake workflow: Needle 1.4.2 evidence and a deep Blendlink seam

- Research date: 2026-07-21
- Needle Blender add-on inspected: 1.4.2, installed for Blender 5.2
- Needle runtime inspected: `@needle-tools/engine` 5.1.7
- Blendlink comparison target: current working tree on 2026-07-21

## Question

Which concrete baking affordances make Needle Engine approachable, which of
its guarantees are actually present in the installed source, where does
Blendlink still have an evidenced gap, and what is the smallest deep module
interface that can own Blendlink's bake workflow without moving bake mechanics
out of `packages/blendlink/blender/bakelib.py` or casually reshaping the
manifest?

The Needle comparison is a static source and documentation audit. The
implementation-status section below separately records production changes and
executed tests from this pass. Local source markers such as **N4** resolve to
exact files in [Source anchors](#source-anchors).

## Decision

Do not copy Needle's lightmap file format, runtime extension, global shader
patch, proxy-quad allocator, or bake-setting surface. Preserve Blendlink's
existing atlas, color, cache, delivery, and schema contracts. Adopt the useful
shape of Needle's artist loop—clear participation, visible preview, one
prominent action, raw-result inspection—through a two-entry deep module:

```python
report = bakeworkflow.assess(scene, profile, prior=None)
compilation = bakeworkflow.compile(scene, profile, destination, prior=None, report=None)
```

`assess()` performs every deterministic pre-Cycles decision and returns the
same plan evidence the build will use. `compile()` always reassesses; an
optional caller report is useful only as a comparison hint and is never trusted
as an executable plan. It returns attested artifacts plus the exact
current-version manifest projection. There is no stale-plan ordering
constraint for callers.

The external seam belongs in a new orchestration module such as
`packages/blendlink/blender/bakeworkflow.py`. `bakelib.py` remains the one home
for saves, color management, background flattening, packing, weights, proxy
join/freeze, dependency fingerprints, and reflection/bake primitives. The new
module would coordinate those primitives; it would not reimplement them.

## Implementation and verification status

Implemented in this pass, without changing manifest schema version or moving
bake mechanics out of `bakelib.py`:

- The exporter now records one privacy-safe execution summary for a baked
  build: Preview/Final profile, total duration, samples, supersampling,
  denoising, CPU/GPU class, backend, and per-job rebuilt/reused duration plus
  effective atlas size. Exact GPU product names remain local log detail and do
  not enter a published artifact.
- The Blender add-on shows the last measured bake duration and the slowest
  measured jobs in the published bake panel. These are historical facts, not
  an unsupported time estimate.
- Canonical embedded recipe JSON now replaces stale configured RNA controls on
  load. This closes a dogfood failure in which a deliberately migrated 4096 px
  Appearance recipe could be silently overwritten by old 2048 px Lighting
  controls on the next save.
- The hero dogfood has deterministic `base` and `full` bake-evidence browser
  modes and Blender raw/static reference plates, so additive Lamp Pool evidence
  can be evaluated separately from application-owned live lighting.
- Evaluated baked geometry is checked for real triangles whose staged atlas UVs
  collapse to zero area. Fully unpinned derived layers are repaired and checked
  again; pinned ownership blocks mutation. A decoded-final-GLB check repeats the
  invariant for both Appearance and Lighting texture-coordinate channels.
- Atlas delivery defaults to the highest artist-authored tier. Applications can
  explicitly choose the previous `adaptive` heuristic or a positive target
  resolution without changing the manifest schema.

Verified here with the TypeScript build, 354 unit tests (2 skipped), the full
headless add-on/archive suite, and the real two-state baked appearance/lighting
e2e. The e2e asserts rebuilt timing evidence on the first build and reused
timing evidence on the cached build.

The defects that motivated the implementation were established before repair:

- Unpinned authored atlas UVs can acquire non-zero-area, zero-UV-area faces
  when a modifier such as Solidify adds geometry. Before this repair, the exact
  degenerate-triangle blocker was scoped to pinned islands, so the dogfood Wall
  published four collapsed Solidify rim quads as eight glTF triangles. This is
  now reproduced from the freshly published GLB, not inferred from an older
  browser artifact. [B9]
- The former atlas delivery default used the viewport's largest dimension times device
  pixel ratio, without considering how much of an atlas a screen-dominant
  object owns. At 1600x900 and DPR 1 the dogfood correctly requested the 2048
  px Main tier, but that tier left one large visible Wall triangle only about
  445x222 atlas texels. The load was complete before the capture; this was not
  a 1024 px bootstrap race. [B10]

Future work remains explicitly separate: affected-face-only repair research,
composition-aware recommendations for the opt-in adaptive policy, the
`bakeworkflow` extraction, a prediction model, selected-island rebuilding, and
a scene-declared visual threshold. The default does not pretend viewport width
is sufficient evidence to reduce the artist's Final atlas.

## What Needle actually provides

### Artist surface and defaults

Needle exposes an object/light `Lightmapped` toggle and a `Lightmap Scale`
factor. Editing either setting propagates to the other selected objects. The
toggle defaults off; scale defaults to `1.0` with a `0.01..100` range. [N2]
The official workflow consequently asks the artist to mark static meshes and
contributing lights, choose a resolution/quality, then press **Bake Lightmap**.
It recommends a low resolution such as 512 with Preview quality while
iterating. [Needle lightmapping documentation][needle-lightmapping]

The installed scene defaults are:

| Setting | Installed default | Available choices |
| --- | --- | --- |
| Lightmap Preview | Off | Off / On |
| Resolution | 1024 | 128, 256, 512, 1024, 2048, 4096, 8192 |
| Quality | Preview | Preview, High, Custom |
| Denoiser | Off | Off / On |
| Debug view | Off | composed preview / raw lightmap |

These values come from registered RNA, not marketing copy. [N3]

The large bake button is enabled only when lightmap preview is active or the
viewport is Rendered. `Lightmap in View`, `Lightmap Selected`, and applying UVs
permanently are hidden under **Show Experimental Options**. The panel reports
the last bake duration and offers a raw-lightmap debug toggle. The selected
object surface also exposes the texture preview and dimensions, scale/offset,
pixel tile size, and a UV-tile preview. [N4]

This is a strong progressive-disclosure pattern. It is not evidence that the
experimental partial-bake path safely preserves a previous atlas: the code
that copies and merges the prior lightmap is commented out in the installed
implementation. [N5]

### Bake preparation and quality

Needle gathers visible lightmapped meshes and lightmapped lights. It hides
non-lightmapped meshes during baking, which also prevents them from casting
shadows or contributing bounce. It can temporarily clone a Material Preview
studio HDRI into the World when `use_scene_world` is off, and restores state
through an undo-action list. [N5] [N6]

The add-on selects a Cycles GPU when possible. Its Preview preset configures
up to 1024 samples but a 0.05-second time limit, two bounces, adaptive sampling,
and optional fast denoising. High configures up to 4096 samples but a 0.2-second
time limit, also with two bounces. Custom leaves the artist's Cycles quality
controls in force, while the implementation still applies persistent data,
disabled caustics, light-tree use, subdivision simplification, and a 2048
render texture limit. [N7]

Those preset names therefore do not mean “1024-sample” and “4096-sample” in
ordinary use: the time limits may terminate much earlier. Blendlink should not
copy the labels without reporting the resolved settings and measured outcome.

The installed bake is a Cycles `COMBINED` image-texture bake. Its actual pass
filter includes emission, direct, indirect, diffuse, material color, and
transmission, while excluding glossy. This corrects an earlier reading that
said transmission was excluded: the nearby source comment describes a
diffuse-only intent, but the executable set contains `TRANSMISSION`. It uses a
resolution-scaled two-pixel-or-greater dilation margin and packs a float image
before export. Needle selects all receivers, attaches the same target image,
and invokes Blender once; Blender clears tagged targets once, then loops over
the separate selected objects with masked writes. Needle accordingly packs a
`2 * bake margin + 4px` inter-island gutter so the two receiver-local EXTEND
bands cannot overwrite one another. [N5] [N9] The official Blender source
confirms both the clear-once behavior and per-selected-object loop.
[Blender bake operator][blender-bake-api]
[Blender bake source][blender-bake-source] [Blender UV editing][blender-uv]

### UV allocation and reuse

Needle creates or reuses `NEEDLE_LightmapUV`, uses an existing second UV layer
when present, and clones shared mesh data for per-instance lightmap UVs. The
current installation batches Smart UV Project unwraps, calculates an adaptive
per-object local margin, and caches unwraps by topology counts, vertex
positions, object scale, `Lightmap Scale`, resolution, and total object count.
[N8]

Global atlas allocation is still performed indirectly. Each object becomes a
proxy quad sized by the sum of its object-space bounding-box dimensions times
object scale and `Lightmap Scale`. Needle packs those quads with rotation off,
then stores a scale/offset transform back on each source object. [N9]

This gives artists a useful single “more/less detail” control but no target or
achieved texel density, no per-atlas budget, no capacity blocker, no protected
authored islands, and no saved-layout evidence. The official documentation
likewise describes `Lightmap Scale` qualitatively rather than promising a
measured density. [Needle lightmapping documentation][needle-lightmapping]

### Exact atlas-bake match/deviate decision

The comparison below treats the installed 1.4.2 Python as behavior and the
official page as product guidance. That distinction matters: the official page
still calls lightmapping experimental and recommends backing up the `.blend`,
and its requirement for a marked light disagrees with the installed path that
warns and continues when no marked light exists. “Needle supports” therefore
does not imply that every advertised path is safe enough to copy into a
compiler contract. [Needle lightmapping documentation][needle-lightmapping]
[N5]

| Mechanic | Installed Needle 1.4.2 evidence | Blendlink decision | Reason |
| --- | --- | --- | --- |
| Artist participation | `Lightmapped` on meshes and lights plus `Lightmap Scale`; selection is collected before baking. [N2] [N5] | **Match the interaction shape.** Keep Automatic/Realtime/Baked and texel weight rather than adopting Needle property names. | One visible participation decision and one relative-detail control are artist-readable. |
| Contributor filtering | Every non-lightmapped mesh is hidden from render while baking. `lightmapping.py:258-325` | **Deviate.** Keep safe static realtime receivers as shadow/bounce contributors; continue excluding dynamic/collision geometry. | Hiding a static table because it is not a receiver changes another receiver's baked shadows and bounce. Blendlink's distinction is evidenced, not cosmetic. |
| Bake pass | Cycles `COMBINED`; executable pass set contains `EMIT`, `DIRECT`, `INDIRECT`, `COLOR`, `DIFFUSE`, and `TRANSMISSION`; margin is `max(2, resolution / 256)`. `lightmapping.py:423-449` | **Match only for Bake Appearance.** Keep the separate indirect-diffuse Bake Lighting route. | Appearance is the same “bake is the painting” class. Lighting must remain material-independent to multiply with authored PBR at runtime. |
| Receiver ownership and gutter | One shared image; one Blender call over separate selected receivers; Blender clears once and bakes each receiver in native object context; global pack reserves `2 * margin + 4px`. `lightmapping.py:364-450`; `lightmapping_pack.py:194-207` | **Match.** Keep frozen receivers as separate objects, select only the current atlas, leave every eligible receiver visible as a contributor, and use the same two-margin gutter. | This preserves Object Attribute, Object Info, generated/object coordinates, transforms, ray visibility, and unknown nested semantics. A joined proxy cannot represent that contract generally. |
| Local UV generation | Reuses/renames a second layer, then batches Smart UV Project with adaptive local margins. `lightmapping.py:692-752`; `lightmapping_pack.py:335-465` | **Match after evaluated geometry exists.** Retain authored/pinned ownership; use Smart Project as an unpinned fallback or repair, not as unconditional author-data replacement. | Smart Project is a useful default. Running it only on source topology misses modifier-generated faces, which the dogfood proves. [B9] |
| UV reuse | MD5 cache covers source counts/positions, object scale, Lightmap Scale, resolution, and object count. `lightmapping_pack.py:11-36`, `:392-465` | **Match the cache affordance; deviate in dependencies.** Keep evaluated geometry, modifiers, exact UV bytes, and pipeline version in the fingerprint. | Source topology alone cannot attest the final triangles Cycles and glTF consume. |
| Global allocation | One proxy quad per object, sized from the sum of source bounding-box dimensions times Lightmap Scale, packed without rotation by Blender; scale/offset is stored on the object. `lightmapping_pack.py:38-90`, `:149-223` | **Match the two-level, fixed-orientation ownership shape; improve the allocator.** Keep measured surface area, target/achieved px/m, camera weighting, named atlases, padding, and capacity blocking, and place the outer receiver rectangles with a deterministic MaxRects portfolio. | On this dogfood, Needle's exact default proxy formula gives about 48.79% to distant exterior `Cube`, 47.06% to `Wall`, and only 4.14% to all other hero props combined. On Cube's actual 38 measured Blendlink receiver rectangles, Blender's outer pack used 73.59% of the edge-usable area while fixed-orientation MaxRects reached 87.75%; a headless differential locks pure-allocator determinism, exact gutters, uniform scale, and a material shelf-control win. Evaluated Blender UVs remain a separate input seam. [B9] [B11] [B12] |
| Runtime representation | One RGBM image plus renderer scale/offset metadata and a global Three lightmap decode patch. [N10] [N11] | **Deviate.** Keep ordinary Three/glTF materials, explicit Appearance versus Lighting composition, multiple atlases, and application-owned renderer lifecycle. | Needle can make a vertically integrated engine assumption; Blendlink's product boundary cannot. |
| Partial object/view bake | UI is experimental and the previous-atlas merge is commented out. [N4] [N5] | **Do not match yet.** Rebuild the complete invalidated atlas job. | A selected receiver can still change another island through shadows or bounce; safe partial work needs dependency evidence. |
| Iteration UX | One prominent bake, Preview/High/Custom, raw view, texture/UV preview, last duration. [N3] [N4] | **Match.** Preserve truthful resolved settings and measured history rather than copying the preset names literally. | This is Needle's strongest transferable design and does not require its runtime. |

### Export and runtime

Before glTF export, Needle converts the float bake to gamma-space RGBM in an
8-bit Non-Color PNG. It creates a temporary textured material and quad so the
stock exporter carries the image, then writes custom `NEEDLE_lightmaps`
texture and renderer metadata. [N10]

Needle Engine 5.1.7 registers those textures by source identifier and applies
per-renderer lightmap scale/offset through material property blocks. Its
runtime globally replaces Three's lightmap shader chunk to decode RGBM,
including an alpha multiplier of 8 whose source comment says it was
heuristically derived. [N11] This works as an engine-owned vertical slice; it
is not a portable glTF/Three contract that Blendlink should adopt.

The installed exporter has one global image named
`NEEDLE_lightmap_image`, and exported renderers use lightmap index zero. Unique
instance lighting is implemented through per-renderer scale/offset into that
atlas, not multiple artist-managed atlas budgets. [N7] [N10]

There is also a possible formula mismatch that deserves a control fixture:
the Blender add-on includes material color in its Combined bake, while the
runtime retains Three's ordinary lightmap integration and changes only RGBM
decode. It is an inference from the two code paths—not proof of visible
double-albedo—but a saturated diffuse reference would prove or reject it
quickly. [N5] [N11]

### Dogfood differential: collapsed modifier UVs and tier magnification

The hero's approved Blender reference is Eevee while Blendlink's current
Appearance baker uses Cycles. That renderer difference explains neither issue
below: both are measurable geometry/delivery failures after the bake result
exists.

**White right reveal.** The authored `Wall` has one Solidify modifier, 9 source
polygons, and 36 source atlas-UV loops. Evaluating it produces 22 polygons and
88 loops. Importing the freshly published GLB back into Blender and measuring
each final triangle found 44 Wall triangles, of which eight have non-zero
POSITION area but exactly zero `TEXCOORD_0` area. They are the four Solidify
rim quads. Several lie at normalized camera x 0.95..0.97, matching the right
reveal. [B9]

Those collapsed lines are not neutral. Sampling the canonical Main atlas at
their published coordinates produced normalized RGB values around
`[0.90..0.94, 0.78..0.81, 0.67..0.70]`. The published default Main decode
scale is `1.974915623664856`, so one-dimensional warm highlight samples are
stretched over real geometry and restored above 1.0 before tone mapping. The
nearly white reveal is therefore falsifiably tied to collapsed UVs; changing
Cycles samples or comparing against Eevee cannot repair it. [B9]

The precise pipeline hole is:

1. Blendlink freezes evaluated meshes, so the final Solidify geometry exists.
2. It adopts the evaluated propagation of the authored source layer.
3. The existing exact zero-area check runs only for islands containing pinned
   loops.
4. This migration intentionally copied `WEB_BAKE` with every pin cleared.
5. Pack Islands can move/scale an island but cannot give a collapsed face a
   second UV dimension.

Needle is useful precedent for Smart Project, but not a fix as installed. It
unwraps and hashes `obj.data` before Cycles evaluates modifiers. A Solidify rim
created later can inherit the same collapsed edge. Blendlink should deviate by
validating the evaluated/final triangle domain and either repairing only fully
unpinned affected faces or blocking loudly when pinned placement would need to
move. [N8] [B3] [B9]

**Soft wall.** The fresh dogfood plan records a 4096 px Main atlas at 34.63%
occupancy. Wall owns 33.913% of that atlas and measures 222.7 canonical px/m.
The generated runtime does not request canonical resolution merely because the
application says “High”; it computes `max(innerWidth, innerHeight) * DPR` and
chooses the first available atlas tier at least that large. A 1600x900, DPR 1
reference capture therefore selected 2048 px, halving Wall to about 111.35
px/m. One large camera-visible Wall triangle spans only about 445x222 texels at
that tier while covering a substantial part of the output. [B10]

A Playwright network probe observed successful responses for the GLB, default
Main 2048 WebP, default Background 512 WebP, Lamp Pool Main 2048 WebP, and Lamp
Pool Background 512 WebP before the stage reported ready at 2.53 seconds. The
comparison waited another 2.2 seconds. Thus this capture was not accidentally
showing the embedded 1024/256 bootstrap pair. At DPR 2 the same viewport would
select 4096; the current heuristic is behaving as written, but it ignores the
screen footprint of an object that owns only part of its atlas. [B10]

Status is deliberately separated:

| Status | Evidence |
| --- | --- |
| **Implemented** | After evaluated-geometry freeze and workspace staging, fully unpinned objects with real zero-UV-area triangles are Smart Projected on the derived atlas layer and revalidated; any pin blocks mutation with an artist-readable error. Type generation independently rejects a decoded final baked GLB when a non-zero surface triangle still has zero selected texture-coordinate area. Runtime atlas delivery now defaults to `authored` (highest advertised tier), retains the former viewport/device heuristic only as explicit `adaptive`, and accepts a positive requested resolution. No manifest schema changed. |
| **Verified** | The original fresh final GLB contains eight zero-UV-area Wall triangles; their camera placement and sampled atlas values explain the white reveal. A real Blender 5.2 Solidify fixture proves collapsed inherited rim UVs, transactional pinned refusal, unpinned repair, authored-layer preservation, revalidation, logging, and idempotence. Decoded-GLB tests cover both Appearance `TEXCOORD_0` and Lighting's explicit secondary channel. Runtime tests prove authored, adaptive, numeric-between-tier, and invalid policies. The repaired Final publish passed its production build and all 9 configured browser tests; an identical 1600x900 capture reduced the right-reveal near-white region from 59.4% to 0.0% and raised retained upper-wall edge energy from 59.8% to 118.8% of the Eevee reference. The remaining +57.3 luma is a Cycles/Eevee lighting difference, not clipping. |
| **Current gap** | `adaptive` remains a viewport/device heuristic and is intentionally opt-in; it does not yet use projected per-object atlas occupancy. The safe repair currently reprojects the whole fully unpinned derived object rather than only modifier-generated polygons. |
| **Future prototype** | Compare whole-object repair with affected-face-only projection on representative modifier stacks, and prototype composition evidence that can recommend a lower tier without weakening the default artist-authored result. Do not silently move pinned art. |

The current official page still labels Needle lightmapping experimental and
recommends backups. It advertises automatic UVs, instance-specific lightmaps,
mixed baked/realtime lighting, different lighting scenarios, and automatic
export. [Needle lightmapping documentation][needle-lightmapping]

### Reflection probes are a second bake workflow

Needle's probe panel supports Bake and Custom modes, per-probe and Bake All
actions, assigning the current viewport HDRI, a texture preview, dimensions,
and an influence gizmo. The installed Bake defaults to 256×128 and 128 Cycles
samples, with choices from 64×32 through 2048×1024. It renders a panorama with
GPU/CPU fallback to a 32-bit-float EXR using **lossy** DWAA compression, packs
it into the `.blend`, and restores render, camera, and output state. [N12]

Blendlink's Runtime/Baked/Custom probe ownership, stable derived paths,
transactional Bake All, byte attestation, staleness evidence, and published
PMREM adapter already exceed that safety contract. Needle's first-class
thumbnail, action, and influence-volume presentation remains a useful UX
reference. Needle documents baked/custom 360-degree reflections and automatic
FastHDR environment compression as part of its environment workflow.
[Needle environment lighting][needle-environment] The current source,
Eevee/Cycles differential, receiver-exclusion fix, GPU state transaction, and
evidence limits are consolidated in
[the reflection-probe parity audit](research-reflection-probe-needle-parity-2026.md).

### Ceilings not to copy

Several installed behaviors materially limit a parity claim:

- The performance baseline runs even in Custom quality: it enables Simplify,
  forces render subdivision to level zero, and caps source textures at 2048.
  A bake can therefore diverge from the artist's normal render. [N7]
- Preview/High also mutate adaptive/noise, fast-GI, culling, and bounce fields
  that `RenderSettings.reset()` does not restore. The add-on has an undo
  journal for other mutations, but this specific snapshot is incomplete. [N7]
- The blocking `bpy.ops.object.bake` has no intermediate sample progress or
  cooperative cancellation. [N5]
- `bakeLightmaps()` catches its failure and shows a message, after which the
  operator returns `FINISHED`; downstream automation cannot treat that return
  as truthful success. [N4] [N5]
- Official requirements say at least one marked light is needed, while the
  installed code warns and continues, permitting World/emissive-only input.
  That behavior may be useful, but the contract is inconsistent. [N5]

## Blendlink's evidenced position

### Already stronger

Blendlink already exceeds the inspected Needle path in the following areas:

1. **Explicit output semantics.** Each atlas chooses Lighting—indirect GI with
   authored PBR retained—or Appearance—a finished visible result. The UI names
   the consequence; the compiler configures the two bake passes separately.
   [B1] [B4]
2. **Editable, measured atlas ownership.** Main plus additional atlases have
   explicit resolution, target px/m, absolute pixel padding, Stop and Explain
   versus Scale to Fit, selected-object membership, automatic/authored/pinned
   UV modes, exact packed-UV evidence, occupancy, required capacity, and target
   achievement. [B1] [B2] [B3]
3. **Truthful Preview/Final profiles.** Preview and Final settings are separate;
   Final defaults to 128 samples, 2× supersampling, and guided post-bake OIDN.
   Preview defaults to 16 samples and 0.25 resolution, with a readable 256-pixel
   floor and visibly provisional scale-to-fit policy. [B1] [B2]
4. **Contributor semantics.** Static realtime meshes may still cast/bounce into
   baked receivers, while dynamic meshes and collision proxies are explicitly
   excluded to prevent permanent ghosts. Every frozen atlas receiver exists before any
   bake so other atlases remain shadow/bounce contributors. Needle instead
   hides every non-lightmapped mesh. [B5] [N5]
5. **States and controllable lights.** Blendlink bakes visibility states and
   additive Cycles Light Groups over the same atlas layout, with an explicit
   blocker where visibility-changing states would make additive bounce or
   shadows false. [B5]
6. **Safe bytes and delivery.** `bakelib.py` forces and restores the color
   contract, records alpha coverage, preserves HDR through a runtime scale,
   uses albedo-guided denoising after dilation (and deliberately omits Blender's
   invalid object-space NORMAL guide), dithers the saved PNG, applies the one
   constant background after every lossy stage, generates verified resolution
   tiers, and hashes the artifacts. [B6]
7. **Conservative incremental builds.** Per state/atlas and light-group/atlas
   fingerprints include evaluated geometry, transforms, materials, source
   images, lights, World, collection visibility, UVs, Blender and pipeline
   versions, and quality settings. Prior canonical and delivery artifacts are
   hash-checked before reuse. [B5] [B7]
8. **Saved-result inspection.** The Blender add-on already exposes verified
   thumbnails, exact saved-pixel isolation, density/UV-grid views, allocated
   texels, atlas membership, and the plan table. Needle's raw view remains a
   useful simplicity reference, not a missing Blendlink capability. [B2]
9. **Failure and cancellation truth.** Blendlink runs the compiler in a child
   Blender process, streams job progress and a heartbeat, treats sentinel plus
   result artifacts as success evidence, surfaces stderr tails, and can kill
   the complete process tree. It does not claim in-process Cycles sample
   cancellation, but its outer operation can be stopped truthfully. [B8]

### Evidenced gaps worth addressing

1. **The orchestration has no deep module seam.** Planning, job graph creation,
   reuse decisions, Cycles setup, contributor filtering, state/light-group
   loops, artifact staging, and manifest assembly live across a large
   `export_scene.py` path. `bakelib.py` correctly owns the mechanics, but
   callers and tests lack one narrow orchestration interface. [B4] [B5]
2. **The artist still lacks a truthful pre-build cost.** Blendlink now shows
   measured total/per-job duration, rebuilt/reused status, effective size,
   profile, and device/backend for the prior build. It still does not show a
   pre-build dirty-job count or an estimate learned from comparable historical
   jobs. A future estimate must be labeled and derived; it must not pretend
   sample count alone predicts time. [N4] [B2]
3. **No safe object-only final bake.** Needle exposes this experimentally, but
   its preservation/merge code is disabled. Blendlink correctly rebuilds an
   invalidated atlas job. A real improvement would require a tile/island-level
   dependency graph plus contributor/shadow reach evidence; simply baking the
   selection would ship stale bounce and shadows. Do not add the button before
   that proof. [N4] [N5] [B7]
4. **Visual acceptance remains scene-declared, not intrinsic to baking.** This
   is correct for a general compiler—a black frame can be intentional—but the
   hero dogfood should bind the existing reference-matrix/browser callback to
   representative baked cameras, states, and lamp positions. The bake module
   should return stable evidence IDs for that gate; it should not embed a
   universal pixel threshold.
5. **Material-domain expansion is still prototype work.** Eevee UV-canvas
   material baking, tangent-normal materialization, selected-to-active high/low
   baking, UDIM/virtualized output, and a proven compressed HDR lightmap format
   are not production Blendlink contracts. Needle 1.4.2 does not provide a
   superior portable implementation of them either. Keep them outside the
   production interface until a focused prototype has byte and browser proof.
6. **Per-job evidence is not yet a prediction model.** The current manifest
   records measured duration/device class/backend/effective resolution for the
   latest execution, and the add-on presents it. It is deliberately not a
   cross-build history and cannot yet answer “how long will this publish take?”
   before Cycles starts. [N4] [B2]

## Proposed deep module

### Interface

```python
def assess(
    scene: bpy.types.Scene,
    profile: Literal["preview", "final"],
    prior: PriorBakeEvidence | None = None,
) -> BakeReport: ...


def compile(
    scene: bpy.types.Scene,
    profile: Literal["preview", "final"],
    destination: Path,
    prior: PriorBakeEvidence | None = None,
    report: BakeReport | None = None,
) -> BakeCompilation: ...
```

The validated recipe on `scene` remains the one authored contract; the public
interface does not duplicate every Cycles or pack setting into a second request
schema. `prior` is an optimization hint whose hashes and schema version must be
revalidated before use. `report` can let the compiler describe what changed
since a recent assessment, but `compile()` always reassesses and refuses to use
it as a stale executable plan. Progress and cancellation belong to the
invocation host, not authored scene data; they enter through a private adapter.

`BakeReport` is derived evidence: receiver/contributor classification, atlas
layout, output semantics, target/achieved density, capacity, UV ownership,
resolved profile settings, jobs, cache eligibility, warnings/errors, and
stable evidence IDs. It produces no artifact and never claims a Cycles result.

`BakeCompilation` contains:

- the same report, refreshed from the build invocation;
- staged, decoded, dimension/hash-attested artifacts and variants;
- current-version baked manifest fields in their existing shape;
- an atomic-install description for the outer compiler.

It does not write the website, run the website build, install runtime
materials, or own the application route.

### Usage

The CLI, Blender add-on, and tests all cross the same seam:

```python
# Check Atlas Fit / plan --preview
report = bakeworkflow.assess(scene, profile="preview", prior=prior)

# Preview Website / Publish Website
compilation = bakeworkflow.compile(
    scene, profile=quality, destination=staging, prior=prior, report=report
)
compiler.install_bake_compilation(compilation)
```

The Blender UI renders `BakeReport`; it does not recalculate atlas meaning.
The outer compiler installs `BakeCompilation`; it does not inspect internal job
objects or call save/packing primitives. Tests can exercise every planning and
build outcome through these two functions.

### Hidden implementation

The implementation hides:

1. schema/version validation and profile resolution;
2. receiver, contributor, dynamic, collision, and excluded classification;
3. evaluated-geometry freeze and instance realization;
4. automatic/authored/pinned UV staging, validation, packing, and capacity;
5. deterministic job-graph construction for states × atlases and light groups
   × atlases;
6. dependency fingerprints, volatile-dependency rejection, and prior-artifact
   integrity;
7. GPU selection/fallback and deterministic Cycles state;
8. receiver/material-target lifetime, collection/light visibility journals, guide bakes, and
   cleanup on every failure path;
9. coverage, HDR normalization, albedo-guided OIDN fallback, dither, constant
   background, resolution variants, and saved-byte checks through `bakelib`;
10. staged output, artifact hashes, diagnostics, and the existing manifest
    projection.

The deletion test passes: removing this module would force the CLI exporter,
add-on, plan command, and test fixtures to reproduce job construction, cache
truth, cleanup ordering, and artifact assembly.

### Dependencies and adapters

The external interface has no adapter parameter. Internally the implementation
accepts two real adapters at private seams:

- `BlenderBakeHost`: evaluated-scene access, Cycles operations, disposable
  datablocks, progress/cancellation checks, and a restoration journal;
- `FakeBakeHost`: deterministic geometry/jobs/images for orchestration tests,
  including injected failures after pack, bake, denoise, save, and install.

Filesystem staging/hash verification can use the same production adapter in
integration tests; a second filesystem abstraction is unnecessary unless a
real archive or remote store becomes a supported build target. Website build
and browser verification remain outer compiler modules.

`bakelib.py` is a dependency, not an adapter. It is the canonical
implementation of bake mechanics and must not be copied into the workflow
module, the add-on, or a consumer.

### Why not the superficially smaller alternatives?

| Alternative | Rejection |
| --- | --- |
| `run(request.operation) -> union` | One spelling hides two result types but makes every caller learn an operation tag and discriminate a union. It is false interface minimalism. |
| `plan() -> bake(plan)` | Introduces an ordering constraint and stale-plan hazard. Build must revalidate anyway, so passing a plan is unsafe leverage. |
| `plan() / bake() / publish()` | `publish()` would duplicate the compiler's website/artifact transaction and expand the bake module beyond its seam. |
| Expose pack, unwrap, bake-state, denoise, save, and cache methods | This mirrors implementation structure, leaks ordering and cleanup rules, and would make a shallow module. Those remain private or in `bakelib.py`. |

## Implementation order suggested by the evidence

1. Extract orchestration with replace-don't-layer tests; keep output bytes and
   manifest shape identical.
2. Make the existing Check Atlas Fit and Preview/Publish paths consume the same
   `BakeReport`/`BakeCompilation` seam.
3. Add pre-build dirty-job evidence and record duration/device/resolution per
   completed job. Only then show a clearly labeled estimate.
4. Bind the hero dogfood reference matrix to baked cameras/states/lamp poses and
   attach browser diffs. Do not add a universal threshold.
5. Prototype selected-to-active and Eevee/material-domain bakes separately.
   Promote one only when its source pixels, tangent/color contract, margins,
   cache dependencies, and Three.js result are proven.

## Follow-up: native receiver ownership supersedes the joined proxy (2026-07-22)

The hero's apparent second corkboard was isolated to a real Cycles Combined
shadow from `CorkBoard` on `Wall`, not UV overlap, compression, denoising, or
runtime sampling. Source and final-GLB rays hit the same Wall UV; only Wall owns
that atlas point; the dark rectangle already exists in the raw bake. Removing
the corkboard or separating it with `visible_shadow=false` removes the patch.

The compiler defect was broader ownership loss in `bakelib.join_proxy`:
joining atlas receivers preserves geometry/materials but collapses Blender's
per-object Cycles ray visibility, Object Attributes, Object Info, and local or
generated coordinate context onto one object. The Cube Rug demonstrates the
failure directly: its `Color 1` and `Color 2` OBJECT attributes resolve to zero
on the joined proxy, while a native receiver bake restores the complete tan
dog-ring pattern.

An earlier version of this note incorrectly claimed that Needle's separate
receiver bake isolates receivers from one another. The installed 1.4.2 code
does not hide lightmapped receivers: it leaves all of them render-visible,
selects them together, and calls Blender once. Blender internally loops over
the receivers, so they keep native shader/ray state while continuing to cast
shadows and contribute bounce. Only non-lightmapped meshes are hidden.

Blendlink now matches that ownership seam. Evaluated receiver meshes stay as
separate objects, one shared image is cleared once, and only the current
atlas's receivers are selected while every eligible receiver remains visible.
The package retains its stronger global surface-area/density/pinned-island
policy, adopts Needle's `2 * margin + 4px` gutter and two-level receiver shape,
and replaces only Blender's outer proxy-quad placement with a deterministic
fixed-orientation MaxRects allocator. A focused Blender 5.2 fixture verifies
distinct shared-material OBJECT colors, Object Info alpha, clear-once masked
writes, the independent padding bands, and exact graph and selection
restoration. The full Cube browser rerun remains pending at this point in the
record.

The earlier private-material workaround remains useful historical evidence:
the first real 512 px dogfood differential changed the hard Appearance-patch
ghost/clear luma ratio from `0.165669` to `1.033352` through the ordinary joined
proxy. A second differential isolated the remaining soft patch to indirect
diffuse occlusion in `Lamp Pool`: direct light was zero at both samples, while
the joined proxy with CorkBoard hidden from diffuse rays produced `1.220244`
instead of an effectively black ghost sample. The dogfood scene now authors
`CorkBoard.visible_shadow = false`, `CorkBoard.visible_diffuse = false`, and
`Monitor.visible_shadow = false`; the browser ROI is a permanent regression
gate. Native receiver ownership now preserves all standard per-object Cycles
ray switches directly rather than approximating two of them in a joined graph.

## Follow-up: deterministic outer receiver allocation (2026-07-22)

Needle's useful architectural baseline is one local chart layout and one outer
rectangle per receiver, with rotation disabled so applying the result requires
only scale and offset. Blendlink keeps that interface. It deviates only in the
outer implementation: generated Blender proxy objects and
`bpy.ops.uv.pack_islands` are replaced by a pure fixed-orientation MaxRects
portfolio. Every receiver gets the same global scale; only its translation
differs. Local chart orientation, surface/camera/artist weight ratios, and the
pinned-layout fallback therefore do not change.

The decision was measured before implementation on the real Cube Final input:

| Outer design | Uniform scale versus captured Blender layout | Receiver rectangles / edge-usable square | Predicted UV occupancy | Predicted target achievement |
| --- | ---: | ---: | ---: | ---: |
| Blender proxy pack, rotation off | `1.00000` | `73.59%` | `0.20626` captured (`0.2034..0.2094` across runs) | `0.8894` captured (`0.8822..0.8949` across runs) |
| Deterministic bottom-left corners, rotation off | `1.09578` | about `87.2%` | `0.24766` | `0.97459` |
| Deterministic MaxRects, rotation off | `1.09918` | `87.75%` | `0.24920` | `0.97761` |
| Deterministic MaxRects, cardinal receiver rotation | `1.10292` | about `88.3%` | `0.25090` | `0.98094` |

The rotation gain is only about 0.34% in linear scale over fixed-orientation
MaxRects. It is rejected: Needle's scale/offset semantics are simpler, and
Blendlink does not need a new receiver-level rotation mapping for a negligible
Cube gain. Perfect rectangle placement would still be bounded near `0.2845`
UV occupancy because receiver-local AABBs contain substantial empty space;
that is a separate local-chart problem, especially for Bracken, Bird Cage,
and Computer, and must not be conflated with the safe outer allocator change.

The registered Blender headless gate exercises the pure allocator with input
order reversed and interleaved, proves byte-equal returned placements, and
uses an adversarial eleven-rectangle fixture where MaxRects retains 1.38 times
the uniform scale of a deterministic first-fit shelf. The actual Blender UV
fixture then proves a 4:1 weighted area ratio, non-overlap, a 20px atlas edge,
and a 36px cross-receiver gap (`m=16`, `size=4096`) after float32 UV storage.
The existing transactional wrapper and final full-island validator remain the
authoritative rollback and acceptance seams.

### Conditional determinism found in the current Cube plan

Two independent current packed-consumer Cube plans cleared the capacity gate,
but not the exact-layout gate. Their atlas-layout hashes were
`330cce2ff9603e2f908227feff6766faffed3f1a24296b1353be9380b134fee6`
and `bf7d8bc92582f400664f8f964cfd2e21bf5640f0de351f1b78f62c85e0d4cff1`;
occupancy was `0.2439..0.2460` and target achievement was `0.9660..0.9701`.
The outer improvement is real, but the complete compiler is not yet
byte-reproducible. [B12]

A fresh-process trace located the first difference at evaluated-mesh freeze.
Topology stayed byte-identical for every receiver, while active/render UV
float32 bytes differed on 16 Bevel receivers. The same captured UV snapshot
then produced 12 byte-identical Dresser packs and six byte-identical complete
38-receiver packs inside one process. The exact contract is therefore:
MaxRects is deterministic when handed exact rectangle inputs; evaluated UV and
receiver-local stages remain upstream inputs to that contract.

This remains an improvement over Needle 1.4.2's outer path. Needle derives its
mesh list from a Python `set` and calls Blender's explicitly non-deterministic
box sort, and it adds no control for Blender Bevel's pointer-hashed UV merge.
Blendlink should retain the pure allocator without claiming it repairs the
separate evaluated-UV seam.

Four production-policy families were tested only on disposable automatic atlas
data. Fixed decimal grids through `1e-6` and guarded float32 ULP buckets both
left fresh-process hash differences. Needle-style Smart Project on every
automatic receiver violated the 20px gutter validator; limiting it to
pre-freeze automatic Bevel receivers made one pair's allocator inputs exact,
but 70/80/89-degree variants reached only `0.93008`, `0.92461`, and `0.93281`
target achievement. Explicit authored atlas UVs remained untouched throughout.

No production canonicalizer was promoted. Stable iteration in Blender's Bevel
UV averaging is the preferred upstream repair. Any package-owned alternative
remains Future Work until it passes fresh-process exact hashes, the `0.95`
density gate, exact gutters, authored-UV preservation, and two-state bake-pixel
evidence. The current Cube browser image remains a separate visual acceptance
gate; plan quality does not imply visual parity.

The allocator fault-injection fixture also found that the earlier transaction
retained a UV-layer RNA wrapper across Edit Mode. Blender may replace that
layer's CustomData storage without changing its name, so writing the stale
wrapper did not restore the live UVs. Rollback now snapshots object, layer
name, and coordinates, reacquires the live named layer after failure, restores
it exactly, and reports any missing layer or loop-count drift instead of
masking the original failure.

## Source anchors

- **N1 — installed versions:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\__init__.py:38-49`; `C:\Users\micha\Documents\GitHub\blendlink\experiments\needle-spike\node_modules\@needle-tools\engine\package.json:1-4`.
- **N2 — object/light participation, multi-selection, scale defaults:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\panels_object.py:6-39`; visible placement in `panels_components.py:119-136`.
- **N3 — scene defaults and quality choices:** installed `lightmapping\lightmapping.py:1154-1205` and `:1307-1391`.
- **N4 — panel workflow, experimental partial options, duration, debug:** installed `panels_lightmapping.py:5-67`, `panels_components.py:200-279`, and `operators_lightmap.py:7-34`.
- **N5 — selection, contributor visibility, native multi-object bake, prior-merge status, restoration:** installed `lightmapping\lightmapping.py:169-325`, `:332-527`, and `:544-570`.
- **N6 — viewport HDRI cloning:** installed `lightmapping\lightmapping.py:25-156`.
- **N7 — Cycles presets/performance baseline/restoration:** installed `lightmapping\lightmapping_common.py:25-172`.
- **N8 — UV creation, shared-mesh handling, adaptive unwrap/cache:** installed `lightmapping\lightmapping.py:692-768`; `lightmapping\lightmapping_pack.py:11-36` and `:335-496`.
- **N9 — proxy-quad allocation, global pack, and two-margin gutter:** installed `lightmapping\lightmapping_pack.py:38-238`, especially `:194-207`.
- **N10 — RGBM PNG, dummy material/quad, custom glTF extension:** installed `extensions\NEEDLE_lightmaps.py:174-231` and `:263-322`; RGBM conversion in `lightmapping\lightmapping.py:573-672`.
- **N11 — runtime registration, decode, and per-renderer application:** `experiments\needle-spike\node_modules\@needle-tools\engine\src\engine\extensions\NEEDLE_lightmaps.ts:18-128`; `src\engine\engine_lightdata.ts:31-130`; `src\engine-components\RendererLightmap.ts:20-193`.
- **N12 — reflection-probe UI and bake:** installed `panels_reflectionprobe.py:7-100`; `operators_reflectionprobe.py:295-512`.
- **B1 — Blendlink authored settings/defaults:** `packages\blender-addon\props.py:77-119`, `:832-860`, and `:1546-1636`.
- **B2 — artist atlas/quality/result surface:** `packages\blender-addon\ui.py:1754-1905` and `:2880-3260`; current summary in `docs\FEATURE_PARITY.md:111-115`.
- **B3 — UV mechanics and evidence:** `packages\blendlink\blender\bakelib.py:1585-3073`; plan evidence in `packages\blendlink\blender\export_scene.py:2237-2431`.
- **B4 — output-specific bake configuration:** `packages\blendlink\blender\bakelib.py:3100-3157`; dispatch/execution in `packages\blendlink\blender\export_scene.py:1894-1961`.
- **B5 — bake orchestration, contributors, job graph, reuse, states/groups:** `packages\blendlink\blender\export_scene.py:2503-3171`.
- **B6 — save/color/coverage/denoise/background/delivery mechanics:** `packages\blendlink\blender\bakelib.py:784-811`, `:1038-1547`.
- **B7 — conservative dependency fingerprint:** `packages\blendlink\blender\bakelib.py:586-622`; artifact reuse checks in `packages\blendlink\blender\export_scene.py:2524-2609`.
- **B8 — child-process evidence, timeout, and process-tree termination:** `packages\blendlink\src\invoke.ts:570-711`; add-on process control in `packages\blender-addon\syncrun.py:142-171`.
- **B9 — dogfood final-geometry/UV differential:** evaluated-mesh freeze and
  authored-layer adoption in `packages\blendlink\blender\export_scene.py:1658-1716`;
  authored UV transfer and pinned-only layout validation in
  `packages\blendlink\blender\bakelib.py:1585-1630` and `:2409-2542`;
  dogfood `Wall` Solidify setup and unpinned `WEB_BAKE` migration in
  `C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\scripts\blender\prepare_blendlink_dogfood.py:32-33`,
  `:44-107`, and `:157-196`; published Wall allocation/density and Main decode
  scale in `C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\src\generated\workbenchDogfood.manifest.json:3276-3304`,
  `:3404-3430`, `:3572-3583`, and `:3698-3709`. Final triangle counts, UV
  areas, camera projections, atlas samples, and Needle proxy shares came from
  read-only Blender 5.2 probes of the source scene and freshly published GLB;
  the measured results are recorded above rather than promoted to a shipping
  verifier.
- **B10 — dogfood delivery-tier differential:** tier choice and quality-load
  upgrade in
  `C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\src\generated\workbenchDogfood.baked.ts:461-490`
  and `:1049-1068`; canonical and delivery variants in
  `C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\src\generated\workbenchDogfood.manifest.json:3041-3152`.
  Request completion and ready timing came from the Playwright network probe
  described above; they are browser evidence for this dogfood capture, not a
  general guarantee about every application host.
- **B11 — deterministic receiver allocator differential:** pure allocator and
  Blender float32 regression fixtures in
  `packages/blender-addon/tests/run_headless.py`; implementation and final
  spacing validation in `packages/blendlink/blender/bakelib.py`. Cube inputs
  were captured read-only from
  `artifacts/release-dogfood/cube-diorama/fixtures/cube-diorama-web-appearance.blend`
  through the same Final `bake_prepare_geometry` path. The values above are the
  measured allocator comparison; the rebuilt plans now clear capacity but not
  exact whole-pipeline hash stability.
- **B12 — Blender 5.2 evaluated-UV determinism trace:** exact source revision,
  source hashes, direct-Bevel and control probes, complete Cube stage trace,
  and rejected canonicalization policies in
  [`research-blender-uv-evaluation-determinism-2026.md`](research-blender-uv-evaluation-determinism-2026.md).

[needle-lightmapping]: https://engine.needle.tools/docs/blender/lightmapping
[blender-bake-api]: https://docs.blender.org/api/current/bpy.ops.object.html#bpy.ops.object.bake
[blender-bake-source]: https://raw.githubusercontent.com/blender/blender/main/source/blender/editors/object/object_bake_api.cc
[blender-uv]: https://docs.blender.org/manual/en/latest/modeling/meshes/editing/uv.html
[needle-environment]: https://engine.needle.tools/docs/blender/environment.html
