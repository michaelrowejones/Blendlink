# Demo-scene dogfood: compiled cost and material fidelity, 2026

Research and implementation date: 2026-07-22

## Outcome

The two demos exposed different compiler jobs, and Blendlink now diagnoses them
through one exact final-artifact seam rather than offering generic optimization
advice:

- Cube Diorama is a concentrated evaluated-geometry problem. One planar Floor
  mesh accounts for 99.5% of the source active-view-layer artifact. An explicit
  floor-only experiment, not an automatic compiler rewrite, reduces that real
  Blendlink artifact from 61.66 MiB and 2,106,644 triangles to 4.00 MiB and
  17,684 triangles. The current furnished derivative then deliberately enables
  the excluded Demo Assets collection and Meshopt, shipping 9.55 MiB and
  371,556 triangles. That fixes the dominant geometry problem but still exceeds
  the showcase profile's 5 MiB transfer budget.
- Blender 4.0 Splash is a distributed geometry problem plus complete material
  payload collapse. Its GLB is structurally loadable, but all 1,100,070 rendered
  triangles use Needs Bake source materials and the artifact contains no useful
  PBR, texture, emissive, unlit, or material-extension payload. Final
  verification rejects that stock result. A DPM-only derivative and a
  33-selected-field derivative now publish attested unlit factor/vertex-color
  payload; the broader derivative improves the retained visual metric without
  claiming EEVEE lighting or compositor parity.

The downloaded source files were never saved or modified. Dogfood derivatives
live under ignored `artifacts/release-dogfood` paths and state their changes
explicitly.

## Evidence status

- **Implemented:** final-GLB identity/audit module, contributor attribution,
  material-collapse classification, artifact-aware `blendlink perf`, grouped
  material warnings, independent Cycles Appearance compatibility, Blender UI
  remedy correction, Final/verify collapse gate, export-scope-aware material
  diagnostics, an explicit application-owned material-adapter acknowledgement,
  private-scene ownership for canonical PNG/scene-linear EXR writes, and
  proactive plus observed exact-runtime-graph reproducibility warnings. The
  direct Material Compiler routes now add constant and vertex-color selected
  fields, compiler-private color carriers, atomic `COLOR_0` normalization, and
  pre- and post-optimizer numeric attestation.
- **Verified locally:** focused unit tests, package TypeScript build, Blender
  5.2 add-on headless/archive suite, real demo recompiles, exact packed-consumer
  production builds, both Cube verification passes, both intentional Cube
  showcase performance failures, the intentional stock Splash performance/
  verification failures, successful DPM-only/all-fields material compiles, a
  real packed-tarball save regression against Splash's FFMPEG artist scene, and
  the retained production Chromium gates.
- **Dogfood artifact:** explicit Cube derivative and application-owned binding;
  baseline remains available through `?scene=baseline` in its local harness.
- **Measured visual evidence, not an acceptance pass:** the repaired Cube
  Blender reference is valid RGB evidence, and the current web/reference audit
  reports MAE `0.1360108`, RMSE `0.1970969`, maximum error `0.9529412`, and
  changed-pixel ratio `0.999753858`. No acceptance threshold is configured;
  these numbers establish a major appearance mismatch, not parity.
- **Still research:** Cube Hybrid/Appearance fidelity, automatic complete-
  surface graph lowering plus explicit selected-socket Emit materialization,
  alpha/silhouette acceptance, general
  redundant-subdivision detection from source modifier evidence, broad Splash
  geometry reduction, and visual parity for Splash AO/shadows/compositor output.

## Retained evidence identities

| Input/artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Locally packed Blendlink 0.8.0 tarball | 1,039,495 | `AEDCC65DA7D527DECE05EDB14FC903C6B147BF5CE14089ECE94FEFA8AE0A2B89` |
| Downloaded Cube Diorama `.blend` | 11,674,153 | `A9906942C7100612CDCBC086B31179C96D1125C034140B39A87B9FE9FE65AB7E` |
| Retained Cube baseline GLB | 64,652,696 | `4BB8A27D91D2BB792A5DF1EF68B9B8A34797862948B0C7FE411D1FD57AFA1064` |
| Cube furnished/tuned derivative `.blend` | 11,179,677 | `5408AAA2C1B0B3F67DC2591346A515A605F71A60117BF2C3E79E48912959A4A1` |
| Retained Cube furnished/tuned GLB | 10,016,356 | `C44F09DAF8A692CF43F2AA527188AC3DB209508BDF1AB7900C4562524BA1DC7C` |
| Downloaded Blender 4.0 Splash `.blend` | 33,844,223 | `FEC31BE671D68E2594D087865FB2A8BBBC2929C56E365085A8D4E6AF260FB67F` |
| 120-frame Splash derivative `.blend` | 33,355,778 | `7CD0993A56E55379DDDF2EFB786597061CCD78215C4207AC0B4E1EA4C666E050` |
| Retained 120-frame Splash GLB | 39,659,276 | `F8F4DDC858D1F987A92E5F1B7942E146A9432BDBC8CE27B4D3978E4295FAF7A3` |
| DPM selected-field Splash GLB | 23,269,768 | `75392D1CEC10F8D697D52554A2D6FC914C4AA71099BC0F0480FF1CE97638DFD2` |
| 33-selected-field Splash GLB | 38,687,016 | `D7CDB1A1668AE2DE32E57B84C823E744A69FECDBD5D30291B69E2F7CF35EAB40` |

The Splash fixture builder makes the 120-frame derivative source reproducible.
A separate refusal harness points at the untouched 210-frame original and retains
machine-readable evidence that compilation exits nonzero because the current
exhaustive procedural audit cap is 120 frames. That refusal is an intended,
verified guardrail rather than an unexplained demo failure.

The hashes above identify the retained, browser-verified artifact set. They do
not imply that every fresh Blender process will reproduce the Cube GLBs byte
for byte. Repeated unchanged `compile --force` runs under Blender 5.2 kept the
same evaluated topology and rendered-triangle counts but changed microscopic
UV values on Bevel-modified meshes. The stock glTF exporter's split-vertex
deduplication consequently produced different accessor counts, GLB lengths,
and cache hashes. Fixing `PYTHONHASHSEED` and enabling shared accessors did not
remove the drift. Blendlink deliberately does not round artist-authored or
baked-atlas UVs to disguise it.

Two loud diagnostics now cover that distinction:

- a proactive Blender 5.2 warning identifies exported meshes that combine an
  enabled Bevel modifier with UVs while modifiers and texture coordinates are
  being exported; and
- when `--force` rebuilds otherwise-current declared inputs, the compiler
  compares the preceding and new complete `runtimeAssetGraph` fingerprints and
  reports the changed paths if the exact bytes drift.

The new artifact set remains exact and atomically published; ordinary no-op
compilation still skips the exporter and preserves its cache key. The retained
tuned browser image was byte-identical across the investigated GLB drift
(`A9C8F8F355FE9A3D…`) and retained the same visual-diff metrics. That is observed
visual stability for this case, not a general semantic-equivalence proof and
not byte reproducibility.

## Cube Diorama: exact cause and result

The baseline final GLB reports:

| Metric | Source active view layer | Floor-only experiment | Current furnished derivative |
| --- | ---: | ---: | ---: |
| GLB bytes | 64,652,696 | 4,192,116 | 10,016,356 after Meshopt |
| Rendered triangles | 2,106,644 | 17,684 | 371,556 |
| Draw calls | 19 | 19 | 100 |
| Estimated GPU textures | 72,701,264 | 72,701,264 | 89,478,476 |
| Decoded geometry bytes | 60,982,144 | about 0.50 MiB | 9,320,504 |
| Embedded image bytes | 3,648,500 | not retained | 4,782,668 |

`Floor → Plane.005` contains 2,097,152 triangles and 60,644,416 decoded
accessor bytes. The Blender source mesh is only 8,192 triangles. A Simple
Subdivision modifier at viewport level 4 expands it exactly 256×. The evaluated
result remains planar with uniform normals, the material displacement socket is
unlinked, and visible microdetail comes from a bump texture.

The derivative disables that audited modifier in its own saved copy and records
the decision in `blendlink_demo_web_tuning`. It does not add a hidden compiler
override. The isolated floor-only build passes the balanced budget. The current
furnished build also records that it enabled the source file's excluded Demo
Assets collection, uses the real addon setup contract for the authored Camera,
and opts into Meshopt. It passes the showcase triangle, draw-call, and GPU-
texture budgets, but its 9.55 MiB GLB still fails the 5 MiB initial-transfer
budget by 4.55 MiB. The baseline report now says:

> Inspect evaluated modifiers on "Floor" (mesh "Plane.005"): it accounts for
> 99.5% of rendered triangles.

This is more useful than the previous generic LOD recommendation. Meshopt on
the uncorrected Floor reduced transfer bytes but retained 2.1 million triangles
and roughly 52 MiB of decoded geometry. On the corrected furnished derivative,
Meshopt reduces transfer cost without being misrepresented as the geometry fix.
Compression is secondary to fixing the authored evaluated cost.

The final-artifact material advisory is deliberately not a blanket failure.
The baseline maps 5 of 6 used materials to **Needs Bake**, covering 2,106,634
triangles, but those bindings retain meaningful emitted material payload;
verification passes while the showcase performance policy fails on both GLB
size and rendered triangles. The tuned artifact maps 36 of 46 used materials
to **Needs Bake**, covering 285,270 triangles. Only 4,574 of those triangles
lack meaningful payload, and none of its used materials is blocked by the
current Cycles Appearance evaluator. Its verification and triangle/draw/GPU
budgets pass, while `blendlink perf --profile showcase --fail` exits nonzero
solely for the 5 MiB GLB budget. This is a portability warning with exact
coverage, not a visual-parity claim; the performance failure is a separate
transfer consequence.

The packed production Vite/Chromium gates for the baseline and furnished
derivative each assert the expected GLB HTTP response and SHA-256, a live WebGL
context, a nonzero Canvas, a nonblank pixel probe, and no relevant request,
page, or console error. The valid Blender reference was recaptured after finding
that its active View Layer had render use disabled. A subsequent pixel audit
still measures the major mismatch recorded above. The gates prove production
transport/decode/render mechanics; they do not prove that Realtime matches the
Cycles-authored image.

### Cube packed-consumer audit after the Needle differential

Blendlink's source and packed tarball now replace the joined semantic bake
proxy with the same behaviorally important approach used by the audited Needle
1.4.2 add-on: real receiver objects remain separate, their real materials
receive temporary bake targets, and Blender performs one native multi-object
bake into a shared image. Focused headless fixtures independently prove that
this preserves Object Attribute/Object Info context that the joined control
loses. Blendlink retains its stronger transaction, dependency fingerprint,
artist-density, pinned-UV, and exact-gutter checks.

The first 2026-07-22 Cube rebuild did **not** validate that code. Although the
tarball bytes matched current `dist`, npm retained an older
`node_modules/blendlink` because the local tarball path and package version had
not changed. Explicit SHA-256 comparison caught the stale consumer only after
the rebuild. Its 0.2841 occupancy, 541.2-second render, 8,578,676-byte GLB,
production browser pass, and measured 0.0672021 MAE describe the older installed
compiler, not the new native/packer path. They remain useful historical visual
evidence but must not be cited as current-head validation.

The audit now extracts the exact tarball into a clean consumer package slot and
requires its Blender scripts to hash-identically match `dist` before planning.
That current packed package produces this truthful result:

| Evidence | Current packed result |
| --- | ---: |
| Native receivers | 38 |
| Shared 4096px atlas occupancy | 0.2067 |
| Target achievement | 0.8894 |
| Lowest receiver density | 161 px/m (`Cube.003`, weighted) |
| Blocking receiver | `Cube.006` |
| Plan exit | nonzero |

The plan blocks before a costly bake because Main reaches only 89% of its
density target. It retains the focused repairs (24 collapsed evaluated Cat
triangles, one Desk micro-polygon) without touching authored UV layers. This is
much safer than the failed global-gutter prototype's 0.0143 occupancy, but it
does not clear the 0.95 dogfood threshold. Production work is therefore back in
packing diagnosis; no current-head Final or browser-parity claim is made yet.

The stale forced rebuild also emitted an exact-byte drift warning even though
declared inputs were unchanged. Blender 5.2 evaluated Bevel UV floats can vary
microscopically and change split vertices and cache identity. Its immediately
following ordinary publish reused that older exact artifact and passed all
post-build checks. Blendlink has a safe operational no-op cache for retained
artifacts, but does not claim forced Blender re-export byte reproducibility for
this scene.

## Splash: why the browser result is gray

The earlier all-datablock source inventory found 68 materials: 15 Exact, 8
Approximated, and 45 Needs Bake. The current compiler correctly follows export
scope and retains 42 material records, all Needs Bake; the exported GLB uses 33
of those names across all 335 draws and all 1,100,070 rendered triangles. The
artifact contains zero images and textures and no meaningful material
parameters. Omitted core glTF values become white base color, metallic 1, and
roughness 1, which Three's GLTFLoader applies.

The dominant repeated graph family affects 717,417 triangles (65.2%). Twenty-
nine export-scoped materials contain Shader to RGB. Blender documents Shader to
RGB as EEVEE-only, so “Needs Bake” cannot truthfully imply that the existing
Cycles Combined Appearance route can evaluate the graph.

The new outcomes are intentionally distinct:

- compilation groups the repeated material warnings into one consequence plus
  three examples and preserves every export-scoped record in
  `sceneDiagnostics.materials.records`;
- the Blender material card reports Cycles Appearance as blocked and no longer
  offers that impossible remedy;
- `blendlink perf` reports the complete material collapse alongside geometry;
- `blendlink verify` fails with the affected triangle count, dominant family,
  and the 29 Cycles-blocked materials actually used by the artifact.

The exact derivative is 39,659,276 bytes with 39,213,026 decoded accessor
bytes, of which 39,212,994 are geometry, zero embedded image bytes, and zero
estimated GPU texture bytes. It has 335 draws and 1,100,070 rendered triangles.
All 33 used materials and every rendered triangle meet the narrow complete
payload-collapse definition. Both showcase performance and Final verification
therefore fail intentionally. Its packed production browser gate still passes
the exact HTTP/hash/WebGL/nonblank/error assertions, which proves that browser
health and artistic acceptability are separate questions.

This does not claim that a tone mapper, light tweak, or browser smoke threshold
can restore absent chroma.

### Splash selected-field recovery

The first all-fields run exposed a Blender 5.2 multi-material exporter defect,
not missing source data: a later slot selecting the same color layer could be
mapped to an all-white `COLOR_0`, and exporting fewer color layers fixed only
one affected slot. Blendlink now carries each selected layer through a private
VEC4 attribute, atomically rewrites the generated primitive to ordinary
`COLOR_0`, removes the private semantic, and attests the numeric range both
before and after optimizer transforms. The final DPM and all-fields GLBs contain
no `_BLENDLINK_WEB_*` semantic.

The DPM-only artifact compiled in 24.7 seconds. It records one vertex-color
lowering, is 23,269,768 bytes, and renders the same 1,100,070 triangles. Its
1200x600 production Chromium run loaded the exact SHA-256 above over HTTP into
WebGL 2, had entropy `5.835279`, and passed the Canvas, nonblank, request,
console, and page-error assertions.

The all-fields artifact compiled in 65.8 seconds. It records 33 lowerings—30
vertex-color and 3 factor—with numeric range evidence for all 30 vertex routes.
It is 38,687,016 bytes and still renders 1,100,070 triangles. Its 1200x600
production Chromium run passed the same assertions with entropy `6.692781` and
RGB standard deviations `62.2697 / 65.4893 / 68.2333`. The production Vite
build passed.

The failed first run also exposed a diagnostic transport defect: a long stock
exporter progress log could push the Python Material Compiler traceback out of
the old combined tail. Blender invocation failures now preserve separate
40-line stderr and 20-line stdout tails, so the blocking compiler reason remains
visible instead of being buried by later exporter output.

The retained comparison remains consequence evidence rather than a pass:

| Artifact | MAE | RMSE | Max | Changed-pixel ratio |
| --- | ---: | ---: | ---: | ---: |
| Stock | 0.1813311 | 0.2640845 | 0.9098039 | 0.9997500 |
| DPM only | 0.1813784 | 0.2643164 | 0.9098039 | 0.9993403 |
| 33 selected fields | 0.1611896 | 0.2352268 | 1.0000000 | 0.9993639 |

The broader selection restores meaningful chroma and reduces aggregate error.
It still publishes an artist-selected intrinsic field rather than
Shader-to-RGB lighting, AO, shadows, Filmic/view-curve treatment, the
compositor, or World parity. The almost-total changed-pixel ratio makes that
boundary visible.

## Interface choices

### Manifest-only budget versus compiled-artifact audit

A manifest-only function is synchronous and cheap, but cannot validate that the
GLB matches, distinguish omitted material defaults, decode Meshopt, or attribute
cost. The chosen `auditCompiledSceneArtifact({ manifest, glbBytes })` seam owns
those final-artifact facts. Filesystem discovery remains in CLI/verify adapters;
budget policy remains in `performance.ts`. Save-driven Preview does not pay the
large-GLB decode cost.

The report now separates all decoded accessors from decoded geometry accessors
so animation or other non-geometry data is not mislabeled. Triangle dominance
and decoded-geometry-byte dominance also have distinct rankings; one mesh is
not assumed to dominate both. Material advisories use only materials and
triangles reached by the compiled default scene, not every material datablock
in the `.blend`.

### Automatic simplification versus consequence-first attribution

Automatic simplification could reduce Cube without asking, but would introduce
hidden dual geometry and needs visual-error policy for every asset. The chosen
contract names the exact contributor and lets the artist change the source or
make an explicit derivative. A future namespaced per-modifier export override
could be justified only as opt-in temporary export state with Preview parity.

### Material routes

1. Stock Blender glTF export remains authoritative for recognized Principled
   PBR and KHR extensions.
2. Cube should dogfood the existing flagship route first: switch its explicit
   derivative to Hybrid with an Appearance atlas and compare that Cycles-
   compatible flattened result against the repaired reference. This directly
   addresses its procedural materials and bake-only Area-light contribution;
   it is a better first fidelity test than inventing a runtime light adapter.
3. Only after that baseline should Cube evaluate an artist-enabled Three
   `RectAreaLight` approximation for genuinely live PBR surfaces. It must be
   calibrated, explicitly PBR-only and shadowless, and must never silently
   replace Blender's Area light.
4. Splash now proves the direct explicit-selection route: exact constants and
   Color/Alpha attributes become ordinary unlit factor/`COLOR_0` payload with
   numeric final-artifact evidence. Remaining procedural intrinsic color should
   use an explicit artist-selected, Cycles-evaluable source socket routed
   through a private Emission proxy and Emit bake. Neither route claims
   Shader-to-RGB, AO, shadow, or compositor parity.
5. A general EEVEE material engine or Blender-node-to-Three shader compiler is
   rejected: either would make Blendlink own an engine and constrain the
   website renderer.

An application that deliberately replaces the collapsed GLB materials may set
`applicationMaterialAdapter` with `acknowledgePayloadCollapse: true` and a
nonempty description. That converts only this narrow verification error into a
loud warning naming the adapter and requiring browser evidence; it does not
silence portability diagnostics, change GLB bytes, or claim fidelity. Without
that explicit configuration, the stock collapsed Splash artifact continues to
fail. The selected-field variants pass because they carry attested glTF payload,
not because they use this acknowledgement.

### Private bake-image save ownership

The Splash derivative exposed an independent Blender 5.2 integration bug: its
artist-owned output is `FFMPEG`, and Blender can reject assigning `PNG` through
that scene's narrowed file-format enum. Canonical bake PNG and scene-linear EXR
writes now use a disposable `BLENDLINK_IMAGE_SAVE_STAGE` in `bakelib.py`. The
stage alone receives the Standard/None/0 transform, format, channels, depth,
and dither; it writes the live image buffer, requires a nonempty file, and is
removed in `finally`. The artist scene is structurally outside the mutation
path rather than depending on best-effort restore.

The headless bake-save regression forbids the former artist-scene color helper,
writes real PNG and EXR bytes, and asserts that the artist output/color state
and scene inventory are unchanged. A second dogfood check imports `bakelib.py`
from the final packed tarball into the actual Splash derivative. Its retained
[machine-readable evidence](../artifacts/release-dogfood/blender-4-splash/evidence/private-save-stage.json)
shows the same `FFMPEG` / `RGB` / 8-bit / dither 1 / Filmic / Medium High
Contrast / exposure `-0.10554122924804688` state before and after, a 260-byte
PNG, a 1,311-byte EXR, and no leaked private scene. This verifies save ownership
and byte production; it does not make the Splash material graph portable.

### Tram Station: unsupported renderables now fail before export

The untouched official Blender 2.82 Tram Station scene exposed a different
false-success mode. Blender 5.2 opens 29 render-visible Grease Pencil objects
containing 10,416 stored strokes across 296 nonempty drawing frames (326 stored
frames total). A stock GLB retained all 29 object names as transform nodes but
gave none a `mesh`; the browser could therefore report a healthy nonblank
Three.js scene while the demo's defining drawn artwork was absent. This matches
the installed Blender 5.2.39 exporter: its mesh gatherer converts
Curve/Surface/Font and otherwise accepts Mesh/PointCloud, returning no mesh for
Grease Pencil. [Official glTF node mesh gatherer](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/nodes.py)

Blendlink now inspects the exact selection, collection, active View Layer,
render-visibility, visible-instance-source, and `-noimp` scope used by export.
Both plan-only inspection and real Preview/Final compilation reject a scoped,
nonempty `GREASEPENCIL` object before material mutation or glTF emission. The
structured evidence records object type plus stored, nonempty, and stroke
counts; the artist-facing failure names representative objects and explains
that stock glTF would keep only empty transform nodes. Empty Grease Pencil
objects and render-hidden/out-of-scope drawings do not block.

The registered Blender 5.2 headless test creates a real two-stroke drawing,
proves that stock export emits its named node without a mesh, proves that the
canonical Final planning seam refuses it, and proves the empty and
render-hidden controls pass. A separate read-only probe of the official Tram
source produced the exact 29 / 10,416 / 296 refusal above. Legacy Blender 4.2
`GPENCIL` frame inspection remains supported through the same narrow interface.

There is deliberately no “allow missing art” flag and no automatic conversion.
Blender's generic Object-to-Mesh probe on the static `housebigtop` drawing
produced 15,113 vertices and 14,683 edges but zero polygons and no materials;
that centerline result does not preserve fills, thickness, opacity, layering,
depth order, or drawing animation. The supported remedies are to create and
visually validate an artist-owned mesh or baked-still proxy and explicitly
exclude the source, or keep the scene blocked until a dedicated adapter can
prove those semantics. Blendlink is not becoming a Grease Pencil renderer.

## Export-scope and production evidence

Material and procedural diagnostics now follow the same active View Layer,
collection, visibility, and selection scope used by export, while retaining
the source objects needed by visible collection instances. This was required by
the Cube derivative: its intentionally excluded Demo Assets must not pollute
the report, while enabling that collection must make those records appear.

Both demo harnesses install the exact locally packed Blendlink tarball rather
than resolving the published registry version. Their production builds pass.
The retained browser gates cover Cube baseline/tuned plus Splash stock,
DPM-only, and all-fields variants independently. These are retained-artifact
identity and runtime-health claims only; they are not claims that a forced
Blender rebuild reproduces the same bytes. No demo currently has an accepted
Blender-to-web appearance threshold.

## Primary sources

- [Blender 5.1 glTF exporter manual](https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html)
- [Official Khronos/Blender glTF PBR gatherer](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/pbr_metallic_roughness.py)
- [Official Khronos/Blender glTF primitive extractor](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/primitive_extract.py)
- [glTF 2.0 material specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-material-pbrmetallicroughness)
- [Blender Cycles baking manual](https://docs.blender.org/manual/en/5.0/render/cycles/baking.html)
- [Blender EEVEE node support](https://docs.blender.org/manual/en/5.0/render/eevee/limitations/nodes_support.html)
- [Three r184 GLTFLoader](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/GLTFLoader.js)

The detailed Splash graph inventory and retained-image measurements are in
[research-demo-material-portability-2026.md](research-demo-material-portability-2026.md).

## Next docket

1. Surface source/evaluated modifier expansion directly in the Blender
   Optimization panel, with Select Object/Open Modifier actions.
2. Switch the explicit Cube derivative to Hybrid + Appearance and measure it
   against the existing Blender reference. Consider an explicit RectAreaLight
   approximation only afterward, if interactive PBR surfaces still require it.
3. Build on the verified direct Splash factor/vertex-color route with one
   explicit selected-socket Cycles Emit bake. Prove actual texture payload,
   alpha/silhouette handling, refusals, and multi-view limits; do not build a
   general EEVEE engine.
4. Reduce Splash's distributed geometry with authored grouping/LOD/instancing
   evidence; there is no Cube-like single automatic fix.
5. Add browser ready/decode/frame timing evidence for these large artifacts;
   exact production smoke proves nonempty WebGL output, not
   representative-device performance.
6. Define an artist-reviewed Cube visual target and threshold only after its
   material and lighting route is deliberate; the current measured mismatch
   must not be relabeled as parity.
