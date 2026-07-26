# Selected-field density evidence contract

Date: 2026-07-24
Status: density contract and earlier aggregate Blendlink release matrix passed
on 2026-07-24; additive current material attestation is implemented and
focused-verified, with its optimizer differential and aggregate rerun
**Pending current run**

## Decision summary

The selected-field resolution planner is a useful zero-configuration
improvement over the pinned Needle add-on's fixed manual lightmap resolution,
but several current evidence names claim more than the implementation
measures.

The smallest safe migration is additive:

1. preserve every existing schema-1 field and value as a deprecated legacy
   alias;
2. add exact Blender-unit, projection-model, camera-scope, and allocated-texel
   fields;
3. document the current algorithm as a capped sum of clipped projected
   triangle areas, not occlusion-aware or raster-sample-aware visible coverage;
4. keep the current all-camera behavior for this correction so a naming fix
   does not also become a resolution-policy change;
5. evaluate declarative Website Camera plus responsive compositions as a
   separate behavior change with its own decoy-camera differential.

Do not silently reinterpret `achievedPxPerMeter`. Its current value is
texels per raw transformed Blender unit. Blender's stock glTF 5.2 exporter
also emits raw Blender coordinates while glTF defines those output coordinates
as meters, whereas Blender's Scene Unit Scale describes artist-facing
dimensions. A bare “per meter” field therefore has two plausible meanings.
Both must be named explicitly.

## Implementation outcome

The recommended additive design is now implemented without changing texture
allocation:

- new producers emit `selected-field-density-v1`, exact source-unit facts,
  projection model/scope/selection, selected-camera facts, accurate projected
  triangle-area aliases, and allocated texel area;
- every prior schema-1 field retains its prior value;
- new TypeScript fields are optional so old schema-1 artifacts remain valid,
  while new producers always emit them;
- diagnostics clone the nested evidence and its arrays instead of retaining
  caller-owned mutable references;
- pinned authored UVs retry only resolution-dependent gutter failures at the
  next bounded candidate, while overlap/topology remain immediate and the
  ceiling failure names the exact resolution and remedy;
- the separate [world-metric UV audit](research-selected-field-nonuniform-scale-density-2026.md)
  now proves and ships a topology-validated world-linear Smart Project proxy
  for automatic fallbacks, with additive `uvGenerationSpace` evidence.
- the material-compilation object now enforces its exact nested
  `schemaVersion: 1` at runtime and current producers identify the stronger
  final-payload proof with
  `attestationModel: "primitive-corner-v1"`;
- current records bind every `Object[slot]` to exact emitted mesh/primitive
  occurrences, while current image records bind UV values to rendered
  triangle corners through `uvGeometryAssociation`.

In this note, “schema 1” means the nested
`sceneDiagnostics.materialCompilation` object whose `schemaVersion` is `1`
inside the schema-v3 manifest. Selected-field facts live at
`sceneDiagnostics.materialCompilation.gltfEvidence[*].materializationEvidence`;
`materializationEvidence` does not declare a separate schema version.

Focused density verification passed before the current attestation addition:

```text
npm.cmd run build
sceneDiagnostics.test.ts: 13/13
BLENDLINK_MATERIAL_COMPILER_CHECK_PASSED
BLENDLINK_ADDON_TESTS_PASSED
```

The aggregate `npm.cmd run test:full` gate also passed on 2026-07-24 with
Blender 5.2.0 LTS, including packed Vanilla/R3F consumers, the installed
add-on/archive checks, and the two-state baked e2e. That aggregate predates the
current primitive/corner attestation addition and is not reused as evidence for
it. Current focused TypeScript tests refuse unsupported nested schema versions,
same-mesh primitive material moves, and same-set UV corner permutations; the
Blender 5.2 material-compiler check asserts the current marker, exact emitted
primitive occurrences, and geometry-associated UV evidence. The optimizer
preservation differential and current aggregate rerun remain **Pending current
run**.

The registered Blender evidence includes:

- `METRIC` scale `0.01`, `NONE`, raw-area invariance, and exact legacy aliases;
- an orthographic coincident/hidden triangle that doubles the documented
  continuous projected-area sum;
- an active far camera plus unused close camera proving the current
  all-camera/max selection and selected stable ID;
- pinned layouts that fail at 128px but pass at 256px, fail overlap
  immediately, or fail artist-readably at the 256px ceiling.

Historical observed dogfood baseline (one local run on 2026-07-24, not a
checked-in benchmark): the exact packed package SHA-256
`0797369a065f20e1ae37fc8ddf73acdb464a0e23c90a82474a0654d37b8749f8`
compiled the 1,100,070-triangle Splash scene's selected-sky Preview in
66.5 seconds.
Its generated evidence names one eligible/projecting camera, stable ID
`splash-camera-dogfood`, OptiX GPU materialization, a 1024px private texture,
and the unchanged `0.8498349364` density ratio. The production browser gate
loaded exactly one content-addressed 38,878,972-byte GLB into a nonblank
1200×600 WebGL2 Canvas with no relevant browser errors. Those bytes predate
the shipped world-linear proxy and are not current-package verification; the
current packed run is recorded immediately below.

Current-package observed dogfood evidence (one local run on 2026-07-24, not a
checked-in performance benchmark): tarball SHA-256
`1315ceeb8f4808b0373fb118a67b0306d6b2606f883d443d1f49f94a07e3a975`
compiled the same complete scene in `59.4s`. The selected sky evidence retains
the same camera/unit/density facts and now additionally reports
`uvGenerationSpace: "world-linear-private-proxy"`, `repairCount: 3`, and the
exact whole-layout/planar plus sampleability repair strategies. The production
Vite build and four-case Chromium matrix pass; selected sky loads exactly one
38,878,972-byte GLB with SHA-256
`8023cc4cada546f0b68decd87b274118424c03a87d42d25001caaae1650cbbac`,
a nonblank 1200×600 WebGL2 Canvas, and no relevant browser errors.

## Capability record

| ID | Needle behavior | Blendlink behavior | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- | --- |
| `NDL-MAT-002` | No selected-field final-payload attestation analogue was found in the pinned add-on/runtime paths; ordinary portable materials use Blender's stock glTF export, while the native combined lightmap uses Needle-specific transport. | Blendlink's current selected-field producer attests exact emitted primitive ownership and rendered POSITION/UV corner association before optimization, then re-attests the transformed Document before publication. | **Improvement** for this scoped portable route | `primitive-corner-v1` is **Shipped** in the current worktree; legacy schema-1 evidence remains readable with explicitly weaker semantics | Unsupported-version, same-mesh primitive-swap, same-set UV-permutation, and Blender producer fixtures pass. Weld/reorder/14-bit POSITION-quantization preservation and the current aggregate gate are **Pending current run**; no browser-pixel claim is made by this unit/compiler evidence. |
| `NDL-MAT-005` | Needle Blender add-on `1.4.2` exposes a fixed `128..8192` lightmap resolution, default `1024`; the audited selected-field analogue is absent. | The selected-field compiler derives a private texture resolution from projected triangle-area demand and packed UV texel area, a scoped comparative advantage recorded in the evidence column. | **No analogue** | Computation and truthful additive schema-1 evidence are **Shipped** in the current worktree | Needle identity and registered Blender 5.2/TypeScript fixtures pass; `npm.cmd run test:full` passed on 2026-07-24. The Splash timing above remains an observed dogfood measurement, not a regression benchmark. |

Needle primary source:

- version: add-on `1.4.2`;
- normalized path: `lightmapping/lightmapping.py`;
- SHA-256:
  `4e69f0934d9329b2d8480b097baa1d903aa31bed9337c7a2ae0630cbc900b4f1`;
- relevant lines: `1154..1161`, `1176..1180`, `1332..1341`;
- observed behavior: enum choices `128`, `256`, `512`, `1024`, `2048`,
  `4096`, and `8192`, with `1024` as both the property default and missing
  setting fallback.

The source identity is recorded in
[`needle-baseline.json`](needle-baseline.json) and
[`research-needle-behavioral-baseline-2026.md`](research-needle-behavioral-baseline-2026.md).
The baseline verifier passed on 2026-07-24:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 111 files, 5 source version identities
(2026-07-24) integration=mixed-source
```

This is a per-package source conclusion, not a coherent Needle end-to-end
runtime claim.

## Audited Blendlink implementation

Dirty-worktree snapshot identities captured at
`2026-07-24 11:24:30 -04:00`:

| Source | SHA-256 |
| --- | --- |
| `packages/blendlink/blender/bakelib.py` | `e29ee44f3fba2da084f10482033445cd28f48675aae3a9dae9eb665d1519c522` |
| `packages/blender-addon/material_compiler.py` | `657579f7b29127caead2641625816814b2612c99e0c4ede23d071bfbc229f103` |
| `packages/blender-addon/tests/material_compiler_check.py` | `9933016dcd15bb72bd4a527f441440425b4d7e370259d8eff8ebd592e393d94f` |
| `packages/blendlink/src/sceneDiagnostics.ts` | `48f421c2921e7674f41d04328a8625e67a48c45d76e2d2dd583cce9a1532e5fb` |

These are dirty-worktree snapshot hashes, not release identities.

### What the implementation actually computes

`_material_binding_world_area_and_center()` transforms mesh vertices by
`obj.matrix_world` and sums triangle areas. The numeric result is in squared
raw Blender coordinate units.

`_material_projected_pixel_area()`:

1. evaluates one perspective or orthographic camera;
2. calculates its Blender camera matrix for the current render width, height,
   and pixel aspect;
3. clips every selected-material triangle to the homogeneous camera volume;
4. converts each clipped polygon to NDC;
5. sums its continuous projected area in viewport-pixel-area units;
6. stops and returns one viewport when the sum reaches the viewport area.

It does not:

- union overlapping triangle projections;
- depth-test or account for occlusion;
- apply backface/material-alpha/render-visibility coverage;
- count raster samples or fragments;
- use the active render camera specifically;
- use Blendlink's designated Website Camera specifically.

`plan_material_texture_resolution()` sorts every scene object whose type is
`CAMERA`, ignores panoramic cameras, retains perspective/orthographic cameras
with a positive projected sum, and chooses the largest result. The current
camera scope is therefore exactly:

```text
all scene-linked perspective and orthographic camera objects
```

The current selection policy is:

```text
maximum capped clipped projected-triangle-area sum
```

`scene.camera`, `scene.blendlink_project.main_camera`, render visibility,
camera-marker use, and responsive composition declarations do not participate.

`prepare_material_texture_uv()` then computes:

```text
allocated texel area = packed UV area * texture resolution²
linear density ratio = sqrt(allocated texel area / projected triangle-area target)
raw texels per Blender unit =
    sqrt(allocated texel area / raw world area in Blender units²)
```

`achievedProjectedPixels` is therefore allocated UV texel area, not achieved
projected pixels. `projectedCoverageFraction` is a capped projected
triangle-area sum divided by viewport area, not visible coverage.

Current producers preserve the selected camera name/stable ID, eligible and
projecting counts, exact camera scope/selection policy, and projection metric
as additive schema-1 evidence. Older schema-1 artifacts may omit those
optional fields; readers must not infer them.

### Current observed dogfood evidence

The locally generated packed Splash selected-sky manifest from the
2026-07-24 dogfood run reports:

```json
{
  "measurementModel": "selected-field-density-v1",
  "resolutionPolicy": "projected-camera-coverage",
  "sourceUnitSystem": "METRIC",
  "sourceMetersPerBlenderUnit": 1,
  "projectionMetric": "clipped-triangle-area-sum-capped-to-viewport",
  "cameraScope": "all-scene-perspective-orthographic-cameras",
  "selectedCameraName": "Camera",
  "selectedCameraStableId": "splash-camera-dogfood",
  "targetProjectedPixels": 720000,
  "projectedCoverageFraction": 1,
  "projectedTriangleAreaSumPixelAreaCapped": 720000,
  "projectedTriangleAreaSumFractionCapped": 1,
  "achievedPxPerMeter": 0.34197520139196563,
  "achievedProjectedPixels": 519997.9817635778,
  "achievedTexelsPerBlenderUnit": 0.34197520139196563,
  "achievedTexelsPerSourceMeter": 0.34197520139196563,
  "allocatedBindingTexelArea": 519997.9817635778,
  "resolution": 1024,
  "densityRatio": 0.8498349363941684,
  "densityMet": false,
  "uvArea": 0.4959087197910097
}
```

The allocation arithmetic is internally consistent:

```text
0.4959087197910097 * 1024² = 519997.9817635778
sqrt(519997.9817635778 / 720000) = 0.8498349363941684
```

The issue is evidence vocabulary, not this arithmetic.

## Primary-source unit findings

### Blender source units

The installed toolchain is:

```text
Blender 5.2.0 LTS
build hash fbe6228777e7
blender.exe SHA-256
e27fbfea8564aa645d4463cb0949695fd85562b9de6df9561b06859a1074adf7
```

Installed RNA reports:

```text
UnitSettings.system:
  "The unit system to use for user interface controls"
UnitSettings.scale_length:
  "Scale to use when converting between Blender units and dimensions..."
Scene.camera:
  "Active camera, used for rendering the scene"
TimelineMarker.camera:
  "Camera that becomes active on this frame"
```

Blender's official source implements the dimensional conversion in
`BKE_unit_value_scale()`:

- `system == NONE`: never apply `scale_length`;
- length: multiply by `scale_length`;
- area: multiply by `scale_length²`;
- volume: multiply by `scale_length³`.

Primary references:

- [Blender `unit.cc`](https://github.com/blender/blender/blob/main/source/blender/blenkernel/intern/unit.cc)
- [Blender `rna_scene.cc`](https://github.com/blender/blender/blob/main/source/blender/makesrna/intern/rna_scene.cc)
- [Blender Scene Units manual](https://docs.blender.org/manual/en/latest/scene_layout/scene/properties.html#units)
- [Blender `UnitSettings` Python interface](https://docs.blender.org/api/current/bpy.types.UnitSettings.html)
- [Blender `Scene.camera` Python interface](https://docs.blender.org/api/current/bpy.types.Scene.html#bpy.types.Scene.camera)

For a raw area `A`:

```text
source-declared area in m² =
    A * scale_length²       when system is METRIC or IMPERIAL
    undefined               when system is NONE
```

For raw density `D` texels per Blender unit:

```text
source-declared texels per meter =
    D / scale_length        when system is METRIC or IMPERIAL
    undefined               when system is NONE
```

### Published glTF units are a distinct fact

The [glTF 2.0.1 specification, section 3.4](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)
requires all linear distances to be meters.

A focused real-export probe used a one-Blender-unit right triangle with
`METRIC`, `scale_length = 0.01`. Blender glTF I/O `5.2.39` emitted a POSITION
accessor with:

```json
{
  "min": [0, 0, 0],
  "max": [1, 1, 0]
}
```

The GLB SHA-256 was
`9b7f247c8ba33f58962839b75d178d50cc20e161366e009e5d09ada0965cf598`.
The installed export source contains no `scale_length` use; its importer
explicitly converts glTF meters back to Blender units with
`1 / scene.unit_settings.scale_length`.

Consequently:

- one raw Blender coordinate unit is treated as one published glTF meter by
  this stock export path;
- one source-declared centimeter at `scale_length = 0.01` still exports as one
  glTF meter unless another transform explicitly changes it;
- “texels per source-declared meter” and “texels per published glTF meter” can
  differ by 100×.

The current pre-export planner can prove source-space quantities. It does not
currently attest final transformed GLB world area after all optimizer stages,
so it should not invent a `publishedWorldAreaSquareMeters` claim at this seam.

### Concrete unit probe

With a raw one-square-unit surface, `METRIC`, and `scale_length = 0.01`, the
current planner returned:

```text
rawWorldArea = 1.0
```

The source-declared area is `0.0001 m²`, while the stock exported coordinate
area is `1 glTF m²`. This proves why the unqualified `worldAreaM2` /
`achievedPxPerMeter` vocabulary is ambiguous.

The actual Splash source happens to use `METRIC`, scale `1.0`, meters, so the
two meanings coincide for that one dogfood input. It does not repair the
general contract.

## Primary-source projection findings

The current helper operates on continuous projected polygon area. Raster
coverage is defined at sample locations; pixel centers and multisample
locations are separate from continuous area. See:

- [Khronos OpenGL Shading Language 4.60, `gl_FragCoord` pixel-center convention](https://registry.khronos.org/OpenGL/specs/gl/GLSLangSpec.4.60.html)
- [Khronos OpenGL 4.6 core specification](https://registry.khronos.org/OpenGL/specs/gl/glspec46.core.pdf)

A focused Blender 5.2 probe placed a second, projected-coincident triangle
behind a first triangle. The current helper reported:

```text
one triangle continuous area sum:          2411.265248133816
front plus occluded triangle area sum:     4798.597513191638
ratio:                                     1.9900745125014694
viewport area:                             10000
```

The slight deviation from 2 is perspective depth. An orthographic registered
fixture should make the ratio exactly 2. This proves that the metric is not an
occlusion-aware visible-coverage measurement.

For continuous projected geometry, the capped sum is conservative relative to
the union area. It is not a strict upper bound on rasterized sample count for
subpixel triangles, because raster samples are discrete and antialiasing rules
matter. The evidence should name the exact model instead of using the broader
word “coverage.”

## Exact additive schema-1 recommendation

Keep these existing fields and values unchanged, but mark them deprecated in
TypeScript and `docs/MANIFEST.md`:

| Legacy field | Preserve as |
| --- | --- |
| `resolutionPolicy: "projected-camera-coverage"` | legacy policy identifier only |
| `targetProjectedPixels` | alias of `projectedTriangleAreaSumPixelAreaCapped` |
| `projectedCoverageFraction` | alias of `projectedTriangleAreaSumFractionCapped` |
| `achievedPxPerMeter` | alias of `achievedTexelsPerBlenderUnit`; do not reinterpret |
| `achievedProjectedPixels` | alias of `allocatedBindingTexelArea` |
| `targetPxPerMeter` | deprecated unused `null` placeholder |

Add these producer-required fields at
`sceneDiagnostics.materialCompilation.gltfEvidence[*].materializationEvidence`
within the nested material-compilation schema-1 evidence:

```ts
measurementModel: 'selected-field-density-v1'

sourceUnitSystem: 'NONE' | 'METRIC' | 'IMPERIAL'
sourceMetersPerBlenderUnit: number | null
sourceWorldAreaBlenderUnitsSquared: number
sourceWorldAreaSquareMeters: number | null
achievedTexelsPerBlenderUnit: number
achievedTexelsPerSourceMeter: number | null

projectionMetric: 'clipped-triangle-area-sum-capped-to-viewport'
cameraScope: 'all-scene-perspective-orthographic-cameras'
cameraSelection: 'maximum-projected-triangle-area-sum'
selectedCameraName: string | null
selectedCameraStableId: string | null
eligibleCameraCount: number
projectingCameraCount: number
projectedTriangleAreaSumPixelAreaCapped: number | null
projectedTriangleAreaSumFractionCapped: number | null

allocatedBindingTexelArea: number
```

Definitions:

- `sourceMetersPerBlenderUnit` is `scale_length` only for `METRIC` or
  `IMPERIAL`; it is `null` for `NONE`.
- `sourceWorldAreaSquareMeters` and
  `achievedTexelsPerSourceMeter` are `null` when source units are undefined.
- `eligibleCameraCount` counts scene-linked `PERSP`/`ORTHO` cameras attempted.
- `projectingCameraCount` counts those with a valid positive projected sum.
- `selectedCameraStableId` is the namespaced `blendlink_id` when one exists;
  it is `null` for an arbitrary Blender camera.
- both projected fields are `null` on the fixed `fallback-no-camera` path.
- `allocatedBindingTexelArea` is exactly
  `uvArea * resolution * resolution`.
- `densityRatio` remains the linear square-root ratio, and `densityMet`
  remains its threshold result.

Use “texel,” not “pixel,” for texture allocation. Use “pixel area” only for
the continuous projected viewport measurement.

The exact internal source field should likewise become
`worldAreaBlenderUnitsSquared`. Retain `worldAreaM2` as a temporary internal
alias until every schema-1 producer/consumer and fixture has migrated.

### Why this interface is deep enough

One `measurementModel` plus explicit scalar facts hides the implementation
while allowing callers to:

- show artist-facing declared density;
- explain developer-facing allocation cost;
- identify an unexpected decoy camera;
- compare the target and allocated texel areas;
- avoid reconstructing unit, camera, or projection semantics from names.

Callers do not need access to clipping functions, triangle lists, camera
matrices, or UV packing internals.

## Designs compared

### Design A — additive exact fields, legacy aliases retained

Benefits:

- obeys additive-only schema-1 discipline;
- no reader or generated-binding break;
- corrects claims without changing texture resolution;
- separates artist source units from the raw coordinate space;
- makes all-camera over-allocation diagnosable.

Costs:

- temporary duplicated fields;
- legacy names remain misleading until schema 2.

Decision: **recommended now**.

### Design B — schema-2 nested measurement object

A clean replacement could be:

```ts
densityMeasurement: {
  model: 2
  sourceUnits: { ... }
  projection: { ... }
  allocation: { ... }
}
```

Benefits:

- strongest locality and clearest long-term interface;
- no deprecated aliases;
- projection, source units, and allocation cannot be casually conflated.

Costs:

- manifest/material-compilation schema bump;
- every reader, fixture, generated type, and old artifact must migrate;
- combines contract cleanup with release migration risk.

Decision: **defer to a deliberate schema-2 migration**, not this quality pass.

### Design C — replace the metric with visible raster coverage

Credible implementations include a CPU union rasterizer or an Eevee/GPU ID
mask with depth, culling, and sample rules.

Benefits:

- can approximate actual visible samples for one exact camera/render state;
- avoids allocating for fully occluded surfaces.

Costs:

- materially slower and stateful;
- alpha, backface, displacement, modifiers, animation, samples, and visibility
  become part of the interface;
- one fixed camera mask is not generally valid for an interactive website;
- a GPU render transaction is much larger than the current inspection helper.

Decision: **not justified for this route**. The conservative triangle-demand
metric is useful; name and test it honestly.

## Final-payload attestation designs

The density facts above explain why a texture resolution was selected. They do
not by themselves prove that Blender's emitted material, primitive ownership,
or UV-to-corner relationship survived later optimizer transforms. The final
payload needs a separate proof at the `materialCompilation` interface.

### Attestation design A — reinterpret legacy hashes and infer slot ordinals

This design would keep only `bindings: ["Object[slot]"]` and the existing
`uvHash`/count/range fields, treating a Blender material slot as the matching
glTF primitive ordinal.

Benefits:

- no new fields;
- the verifier remains small;
- old and new producers appear identical.

Costs:

- Blender's emitted primitive ordinal is an output fact, not the material-slot
  number; exporter splitting, omission, or reordering can invalidate the
  inference;
- the legacy `uvHash` hashes the sorted distinct float32 UV set, so permuting
  the same values among rendered corners can change the sampled image while
  preserving every legacy UV fact;
- silently strengthening the meaning of existing schema-1 fields would make
  an old artifact appear to carry evidence it never recorded.

Decision: **rejected**. It violates schema truthfulness and fails the
same-mesh material-move and same-set corner-permutation differentials.

### Attestation design B — additive named model and emitted primitive/corner proof

This is the implemented design. Current producers add:

```ts
attestationModel: 'primitive-corner-v1'

gltfEvidence[*].bindingPrimitives: Array<{
  binding: string // exact existing Object[slot] label
  occurrences: Array<{
    mesh: number
    primitives: number[]
  }>
}>

gltfEvidence[*].uvGeometryAssociation?: {
  algorithm: 'mesh-position14-uv-triangles-v1'
  hash: string
  triangleCount: number
  positionGrids: Array<{
    mesh: number
    bits: 14
    offset: [number, number, number]
    scale: number
  }>
}
```

`bindingPrimitives` is complete for every current record. The Python producer
reads the actual staged GLB and records every emitted node occurrence, its mesh
index, and the exact generated-material primitive ordinals on that mesh.
Primitive ordinals are never inferred from the source slot. The final verifier
requires a one-for-one match with `bindings`, rejects duplicates/extras, and
reconstructs the same occurrences from the transformed Document.

`uvGeometryAssociation` is required for a current image record. Its algorithm
is:

1. For each affected mesh, compute and persist the same mesh-volume POSITION
   grid used by installed glTF-Transform 4.4.1's default 14-bit POSITION
   quantization. Bounds cover every base POSITION accessor on the mesh. When
   morph POSITION deltas exist, the grid also covers zero and each relative
   minimum/maximum plus its doubled value, matching the transform's
   relative-delta expansion. `offset` is the bounds midpoint; `scale` is the
   largest axis half-extent.
2. Encode each rendered triangle corner as three little-endian signed 16-bit
   canonical position codes plus two little-endian float32 UV values. The
   position code clamps the normalized coordinate to `[-1, 1]`, rounds its
   magnitude to the nearest of 8,191 positive steps, and restores the sign.
3. Canonicalize only the three cyclic rotations of the 42-byte triangle
   record. Winding is intentionally not canonicalized.
4. Hash each triangle as
   `SHA-256("blendlink:uv-geometry-triangle:v1\0" || primitiveHeader ||
   canonicalTriangle)`, where `primitiveHeader` is four little-endian uint32
   values: mesh index, primitive ordinal, primitive mode, and texCoord.
5. Build the association header from little-endian uint32 texCoord and grid
   count, followed by grids sorted by mesh index. Each grid contributes
   little-endian uint32 mesh index, three float64 offsets, float64 scale, and
   uint32 bits.
6. Compute
   `SHA-256("blendlink:uv-geometry-association:v1\0" ||
   associationHeader || uint64LE(triangleCount) ||
   lexicographicallySortedTriangleDigests)`.

Sorting makes triangle and vertex reorder irrelevant while retaining triangle
multiplicity and the primitive/material seam. Identical complete attribute
rows may be welded without changing rendered corner facts. The 32-byte
digests are sorted in 65,536-record runs; large inputs spill those runs into
one owned temporary directory and use a k-way merge. This keeps the
triangle-digest working chunk bounded and retains an ordinary SHA-256
multiset construction rather than using collision-weaker XOR/sum
commutativity. Temporary runs are removed on success or failure.

Benefits:

- additive within nested schema 1;
- one explicit marker selects the proof model, keeping the reader interface
  small while hiding binary canonicalization and external-sort mechanics;
- exact primitive ownership and POSITION/UV corner association can survive
  semantics-preserving weld/reorder/14-bit POSITION quantization;
- an old artifact cannot be mistaken for current evidence.

Costs:

- schema 1 temporarily carries both legacy UV summary fields and the current
  association;
- producer and verifier must implement the same canonical byte contract;
- current verification performs per-rendered-triangle SHA-256 work and may use
  temporary disk for a large receiver. No current checked-in performance
  threshold has been recorded yet.

Decision: **implemented** as `primitive-corner-v1`. Focused adversarial and
producer tests pass; optimizer preservation and aggregate gates are
**Pending current run**.

### Attestation design C — replace schema 1 with a schema-2 evidence object

A schema-2 migration could delete the legacy UV inventory and make
primitive/corner evidence structurally mandatory without a marker.

Benefits:

- cleanest long-term type surface;
- no dual legacy/current interpretation.

Costs:

- requires coordinated migration of every reader, producer, fixture, and
  existing artifact;
- adds release migration risk without improving the proof already selected by
  the additive marker.

Decision: **Future**, only as a deliberate migration. The reader currently
accepts exactly numeric nested `schemaVersion: 1`; absent, string, or newer
values refuse loudly. Within schema 1, an absent `attestationModel` selects
the documented legacy mesh/distinct-value proof and an unknown model refuses.

### Installed optimizer source identity

The current canonical position grid and invariance requirements were audited
against the exact installed production dependencies, not recalled behavior:

| Package | Normalized installed source | SHA-256 |
| --- | --- | --- |
| `@gltf-transform/functions` `4.4.1` | `node_modules/@gltf-transform/functions/src/quantize.ts` | `7522b24798923b68f57f01f9a0f0991e8d42ee2501c6fc4b521c7763050dd657` |
| `@gltf-transform/functions` `4.4.1` | `node_modules/@gltf-transform/functions/src/reorder.ts` | `b00fba1f088f5cb96b37ef2b4a420ddd22273cd666c5464c9caf9420d7910c93` |
| `@gltf-transform/functions` `4.4.1` | `node_modules/@gltf-transform/functions/src/weld.ts` | `9ff19f47ce53e69216caa23931ff4e1eec8303b9f566090e6e03818a250d1eed` |
| `meshoptimizer` `1.2.0` | `node_modules/meshoptimizer/meshopt_encoder.js` | `f82f201a778333291ba1ca63035321f1c6d2770ef52d219e69e13f6cb2098429` |

The package lock resolves `@gltf-transform/core`, extensions, and functions to
`4.4.1`; the functions package records upstream git identity
`0b533a10fc8266dce426eeb6f36c807057b88da5`. The audited `quantize.ts`
defaults POSITION to 14 bits, computes one mesh-wide volume, expands that
volume for relative morph POSITION extrema, and applies translation only to
base positions. `reorder.ts` calls the installed Meshopt encoder's
`reorderMesh()` and remaps the index/attribute layout. `weld.ts` merges only
bitwise-equal complete vertex streams on its lossless path. These source facts
define the optimizer-preservation differential; source identity alone is not
test evidence that Blendlink's implementation survives the transforms.

### Proof boundary

The Python compiler generates current evidence from the staged GLB produced by
Blender's stock exporter, after Blendlink's private carrier rewrite and before
Node optimization. The TypeScript verifier reconstructs it from the
fully transformed glTF-Transform Document after texture resizing, optional
KTX2 work, and optional Meshopt transforms, before manifest publication.

That is an emitted-preoptimizer-to-final-transform preservation proof. It
proves that the selected stock-glTF material payload, exact emitted
material-to-primitive ownership, and rendered POSITION/UV corner association
survived Blendlink's transformation transaction. It does not prove:

- correspondence to Blender source loop ordinals;
- that two different source loops with the same rendered POSITION/UV facts can
  be distinguished;
- GPU texture upload or shader compilation;
- a presented browser frame or image fidelity;
- arbitrary Eevee Surface parity.

Those claims require separate Blender-source, WebGL/browser, or visual
differentials and must not inherit `Verified` status from this contract.

## Camera-scope designs

### All scene cameras

This is current behavior. It is zero-configuration and conservative for
artists who keep multiple authored viewpoints, but an unused reference or
close-up camera can silently force a larger texture. It also ignores the
product's explicit Website Camera ownership.

### Current active render camera

This follows Blender's `scene.camera` at the evaluated frame. Timeline markers
can make another camera active on a frame. It is simple, but can disagree with
Blendlink's designated Website Camera and does not express website-responsive
compositions or application-controlled transitions.

### Declarative Website Camera plus declared compositions

Blendlink already has a rename-stable Website Camera and responsive
composition records. This most closely matches the shipped website contract
and avoids decoy-camera cost. It also permits a future explicit set of
transition/shot cameras without treating every scene camera as public intent.

Decision: **recommended behavior direction, but as a separate change**:

1. Website Camera and declared compositions;
2. otherwise current `scene.camera`;
3. otherwise Needle's fixed 1024 fallback bounded by the quality ceiling;
4. include additional cameras only through a future explicit declaration.

Do not infer timeline-marker or arbitrary scene-camera publication. The
website owns camera transitions, so additional camera demand must be declared.

The policy should be passed into the canonical `bakelib.py` planner rather than
having bake mechanics reach into add-on UI properties. A small interface such
as an immutable list of `(camera, width, height, role)` samples preserves the
one-home bake rule while keeping recipe policy at the caller seam.

## Required differential fixtures

### 1. Scene-unit semantics

Use one identity-transformed one-square-Blender-unit receiver with a complete
private UV.

Run:

- `METRIC`, `scale_length = 0.01`;
- `IMPERIAL`, `scale_length = 0.3048`;
- `NONE`, with a non-default stored `scale_length` control.

Assert:

```text
raw area is invariant
projected target is invariant
chosen resolution and densityRatio are invariant
METRIC source area = raw area * 0.01²
METRIC source texels/m = raw texels/BU / 0.01
IMPERIAL source area = raw area * 0.3048²
NONE source meter fields are null
legacy achievedPxPerMeter == achievedTexelsPerBlenderUnit
```

Add one real Blender glTF export assertion that POSITION max remains `1` at
`scale_length = 0.01`; this independently prevents a future change from
confusing source-declared dimensions with published coordinates.

### 2. Coincident/occluded projected triangles

Use an orthographic camera and:

- object A with one triangle;
- object B with the same front triangle plus an identical triangle behind it.

Assert:

```text
projected sum B == 2 * projected sum A before viewport cap
projectionMetric == clipped-triangle-area-sum-capped-to-viewport
allocatedBindingTexelArea == uvArea * resolution²
legacy projected fields exactly alias the new fields
```

This source-level fixture validates the algorithm's model. It does not validate
browser-visible pixels and must not be cited as such.

### 3. Camera-scope truth

Create:

- a far/small-footprint camera as `scene.camera`;
- the same camera as Blendlink's designated Website Camera;
- a close/full-footprint unused decoy camera.

For current behavior, assert:

```text
cameraScope == all-scene-perspective-orthographic-cameras
selectedCameraName == decoy
selectedCameraName != scene.camera.name
```

For a later declarative-first implementation, invert the expected selection
and assert the exact resolution difference. Those are two independently
failing designs and should not share one optimistic expected value.

### 4. Schema compatibility

In TypeScript, for
`sceneDiagnostics.materialCompilation.gltfEvidence[*].materializationEvidence`:

- read/copy an old schema-1 evidence object containing only legacy fields;
- read/copy a new schema-1 object containing both sets;
- assert legacy values are unchanged;
- assert all new scalar/nested values survive `compileSceneDiagnostics()`;
- at the enclosing `sceneDiagnostics.materialCompilation` object, refuse every
  `schemaVersion` other than numeric `1`;
- keep that newer-version rejection fixture until a real schema-2 migration
  exists.

### 5. Current attestation

Use fixtures whose failure modes are independent:

- two generated materials on two primitives of one mesh; move the first
  generated material from primitive 0 to primitive 1 without changing its
  mesh/count summaries and require `bindingPrimitives` to refuse;
- one textured triangle with the same three distinct UV pairs before and
  after, but permute those pairs among POSITION corners and require
  `uvGeometryAssociation` to refuse;
- weld duplicate complete vertex rows, reorder vertices/triangles through the
  installed Meshopt encoder, and quantize POSITION through the installed
  14-bit mesh-volume path; require the unchanged rendered association to pass;
- reverse winding, change triangle multiplicity, or change one corner UV and
  require refusal;
- include a morph POSITION target whose doubled relative extrema expand the
  source grid, so recomputing a final base-only grid cannot pass accidentally;
- assert Python and TypeScript produce one golden association hash from the
  same exact fixture.

The first two adversarial refusals and the current Blender producer assertions
pass. The complete optimizer/morph/golden-vector registration is **Pending
current run** until the named differential reports its result.

### 6. Gates

At minimum:

```text
npm.cmd run verify:needle-baseline
npm.cmd run build
npm.cmd run test:unit
npm.cmd run test:addon-headless
git diff --check
```

The selected-field real material compiler gate must also assert emitted
manifest evidence. The optimizer fixture must run the exact installed
weld/reorder/quantize implementations whose identities are pinned above. A
browser gate remains necessary for visual material claims, but it is not
required to prove these source-unit, geometry-metric, or final-transform
preservation definitions.

## Implemented production migration order

1. Added the new internal facts in `bakelib.py`; kept old aliases.
2. Mapped them through `material_compiler.py`.
3. Added them to `MaterialCompilationEvidence` with `@deprecated` comments on
   legacy fields.
4. Added the Blender differentials and TypeScript compatibility fixture.
5. Added exact emitted primitive and rendered-corner evidence behind the
   additive `primitive-corner-v1` marker, retaining the legacy reader branch.
6. Documented exact semantics in `docs/MANIFEST.md`.
7. Updated `NDL-MAT-002`/`NDL-MAT-005` in `docs/TECHNIQUE_LEDGER.md` and the
   material row in `docs/FEATURE_PARITY.md`, separating Shipped, Verified, and
   Future.
8. Left declarative-first camera policy as a distinct future change.

This sequence fixes truthfulness first, preserves existing artifacts, and
keeps a later artist-facing allocation improvement independently measurable.
