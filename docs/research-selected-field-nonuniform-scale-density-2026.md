# Selected-field world-metric UV normalization

Date: 2026-07-24
Status: source audit, real-Blender prototype, narrow production
implementation, registered headless differential, and aggregate Blendlink
release matrix complete as of 2026-07-24

## Decision summary

Blendlink and the pinned Needle add-on both Smart Project editable Mesh
coordinates without applying the object's world-linear transform. Blender's
operator consumes those local coordinates. A `(100, 1, 1)` object can
therefore receive a nearly square UV island for a `100:1` world-space
rectangle. Later island averaging and packing are uniform transforms; they
cannot repair the directional distortion.

The shipped narrow improvement is:

1. keep the existing compiler-private Mesh transaction;
2. when Blendlink has already chosen its automatic Smart Project fallback,
   make one additional disposable Mesh copy;
3. transform only that unwrap proxy by the receiver's `matrix_world.to_3x3()`;
4. run Blendlink's existing Smart Project settings with
   `scale_to_bounds=False` explicit;
5. validate exact vertex/polygon/loop identity and copy only the generated
   corner UVs back to the compiler-private receiver;
6. remove the unwrap proxy in a `finally` block and fail loudly on any
   topology, cleanup, or finite-coordinate mismatch.

Do not call `bpy.ops.object.transform_apply` on the artist object. Do not
mutate the compiler-private export geometry and then attempt an inverse
restore. The second disposable Mesh costs temporary memory, but it keeps
geometry ownership and rollback simple.

This implementation replaces only the existing `smart-project-fallback`
path. The separate question of when a
valid generic source UV should be preserved versus re-unwrapped needs demo
scene evidence. `BLENDLINK_ATLAS_AUTHORED` remains artist-owned and must not
be silently replaced.

## Capability record

| ID | Needle behavior | Blendlink choice | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- | --- |
| `NDL-MAT-006` | Needle add-on `1.4.2` Smart Projects source Mesh coordinates with `scale_to_bounds=True`, then averages and packs; object scale participates in a shallow cache/allocation heuristic but is not applied to unwrap geometry. | Use a world-linear disposable unwrap proxy, preserve only generated corner UVs, and retain the artist/source Mesh unchanged. Keep `scale_to_bounds=False` because Blender implements that option as independent U/V scaling. | **Improvement** | **Shipped in the current worktree** | `experiments/nonuniform-selected-field-uv-prototype.py` and the registered Blender 5.2 fixture prove the focused positive/mirrored transform, source-ownership, topology-refusal, and failure-cleanup behavior. `npm.cmd run test:full` passed on 2026-07-24. An ad hoc 1M-triangle prototype observed a 12.7% first-run advantage while Needle's persistent-cache repeat remained faster; that timing is not a checked-in regression benchmark. |

This remains a deliberately narrow static selected-field capability. The
prototype and registered production fixture prove the focused planar scale
case and mirrored control, not arbitrary evaluated modifier topology or all
demo-scene appearance. Modifiers and shape keys remain loud refusals.

## Pinned Needle behavior

The exact baseline passed again on 2026-07-24:

```text
npm.cmd run verify:needle-baseline
BLENDLINK_NEEDLE_BASELINE_VERIFIED 111 files, 5 source version identities
(2026-07-24) integration=mixed-source
```

The relevant pinned files are:

| Source | Version / SHA-256 |
| --- | --- |
| `lightmapping/lightmapping_pack.py` | add-on `1.4.2`; `242aad7a29c177ac566ad519425ec55cb0376805d02197a0519107a761801cd3` |
| `lightmapping/lightmapping.py` | add-on `1.4.2`; `4e69f0934d9329b2d8480b097baa1d903aa31bed9337c7a2ae0630cbc900b4f1` |

`lightmapping_pack.py`:

- hashes local vertex positions plus `obj.scale`;
- uses `obj.scale` in its bounding-box size/allocation estimate;
- invokes Smart Project on the original Mesh in Edit Mode;
- sets `angle_limit=1.22`, `area_weight=1`,
  `correct_aspect=True`, and `scale_to_bounds=True`;
- later averages island scale and packs;
- transfers final rectangular scale/offsets to a cloned Mesh.

`lightmapping.py` lines `723..765` re-unwrap the lightmap UV, including an
existing `NEEDLE_LightmapUV`, before cloning the Mesh data. Needle therefore
does not provide an artist-authored exact-layout bypass analogous to
Blendlink's dedicated authored atlas.

The baseline is `integration=mixed-source`; these are exact add-on source
claims, not a coherent Needle browser-stack claim.

## Blender operator behavior

The official Blender source for Smart UV Project calculates face areas,
normals, and projection coordinates from Edit Mesh data. The operator does
not multiply those coordinates by `Object.matrix_world`.

The same source defines `scale_to_bounds` as a post-unwrap operation that
computes separate values:

```text
dx = 1 / (max_u - min_u)
dy = 1 / (max_v - min_v)
u = (u - min_u) * dx
v = (v - min_v) * dy
```

That is deliberately not a uniform scale. It maps both dimensions to the
unit bounds and can destroy a world-correct `100:1` chart. This explains why
Needle's exact `scale_to_bounds=True` flags negate the world-linear proxy in
the focused differential.

Primary source:

- [Blender `v5.2.0` `uvedit_unwrap_ops.cc`](https://github.com/blender/blender/blob/v5.2.0/source/blender/editors/uvedit/uvedit_unwrap_ops.cc),
  SHA-256
  `4a1c01d191bff8c63e06c4faeaadb3f3fd487dc2c08ce3e3a1dfb00d4a253fe2`;
  lines `591..645` pass local BMesh vertex coordinates and lines
  `2636..2741` implement independent U/V bounds scaling.
- [Blender `v5.2.0` `rna_mesh.cc`](https://github.com/blender/blender/blob/v5.2.0/source/blender/makesrna/intern/rna_mesh.cc),
  SHA-256
  `e9be8367a47d090935e025def70a6e3c7627668249164ee5119134c815cb0e18`;
  lines `1528..1567` and `1799..1821` explain why deprecated per-loop
  UV-pin lookup is unsafe after edit-mode operators.
- [Blender Smart UV Project manual](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/uv.html#smart-uv-project)

Installed Blender RNA reports:

```text
scale_to_bounds default: false
scale_to_bounds description:
  Scale UV coordinates to bounds after unwrapping
Mesh.transform(matrix, shape_keys=False):
  Warning: inverts normals if matrix is negative
```

The warning is acceptable only because the transformed Mesh is an
unwrap-only proxy. Its geometry and normals are never baked or exported.

Blender 5.2 also exposed a deprecated-API trap during the registered gate:
reading `MeshUVLoop.pin_uv` after edit-mode UV operators emitted
`rna_mesh.cc:1549` once per corner because the legacy reverse lookup
encountered a non-span float2 attribute. Blendlink now reads the named
`MeshUVLoopLayer.pin` attribute in bulk, supported by the package's Blender
4.2 minimum. `experiments/blender-uv-pin-bulk-check.py` proves the modern API
without the diagnostic, and the headless orchestrator now treats Blender's
internal unreachable-code message as a test failure even when a success
sentinel exists.

## Actual Blendlink transaction

Dirty-worktree snapshot identities captured at
`2026-07-24 11:24:30 -04:00`:

| Source | SHA-256 |
| --- | --- |
| `packages/blendlink/blender/bakelib.py` | `e29ee44f3fba2da084f10482033445cd28f48675aae3a9dae9eb665d1519c522` |
| `packages/blender-addon/material_compiler.py` | `657579f7b29127caead2641625816814b2612c99e0c4ede23d071bfbc229f103` |
| `packages/blender-addon/tests/run_headless.py` | `6397515b6ba48a3c3b4f646ec9a50773bd8f71a6e15c59b39858a7c959ff3a64` |
| `packages/blendlink/src/sceneDiagnostics.ts` | `48f421c2921e7674f41d04328a8625e67a48c45d76e2d2dd583cce9a1532e5fb` |
| prototype | `7e04749d82ff0919a8dbdd4c8d42c8a5aff3d21d98bedca9983384f4fde149a7` |

These are dirty-worktree snapshots, not release identities.

`with_compiled_materials()` currently:

1. re-plans and compares the source fingerprint;
2. groups objects that can share one private Mesh;
3. calls `original_data.copy()`;
4. temporarily swaps each participating object's `data` to that private Mesh;
5. prepares private UVs, bakes, exports to a staged GLB, and attests it;
6. restores every material and original Mesh binding;
7. refuses cleanup mismatches and removes all private data.

For selected-field materialization, planning currently refuses:

- every unapplied modifier;
- shape keys;
- object/Mesh animation or drivers;
- constraints and instancing;
- more than one object/material binding;
- a selected material that does not own the complete one-slot source Mesh.

Before this change, Smart Project operated directly on the copied Mesh while
the object retained its world transform. `average_unpinned()` and `pack()`
then applied uniform island transforms. The world-space area evidence saw
`obj.matrix_world`, but the unwrap geometry did not. Production now inserts
the disposable world-linear proxy only for that automatic fallback and
copies its UVs back in bulk after one complete topology/finite preflight.

## Real-Blender differential

Toolchain:

```text
Blender 5.2.0 LTS
build hash fbe6228777e7
blender.exe SHA-256
e27fbfea8564aa645d4463cb0949695fd85562b9de6df9561b06859a1074adf7
```

Command:

```text
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup `
  --python 'experiments\nonuniform-selected-field-uv-prototype.py' `
  -- 'packages\blendlink\blender'
```

The generated fixture is a one-unit local quad with object scale
`(100, 1, 1)`, plus a mirrored `(-100, 1, 1)` control. It measures every
boundary edge as:

```text
directional texels per world unit =
  UV edge length * 1024 / world edge length
```

It also measures the existing area-equivalent scalar:

```text
sqrt(UV area * 1024^2 / world area)
```

Results:

| Design | Scale | Min directional density | Max directional density | Anisotropy | Area-equivalent scalar |
| --- | ---: | ---: | ---: | ---: | ---: |
| current Blendlink local Smart Project | `100,1,1` | `9.9999994` | `999.99994` | `100.0000000` | `99.9999937` |
| Blendlink world-linear proxy | `100,1,1` | `10.0000000` | `10.0000011` | `1.00000011` | `10.0000004` |
| current Blendlink local Smart Project | `-100,1,1` | `9.9999994` | `999.99994` | `100.0000000` | `99.9999937` |
| Blendlink world-linear proxy | `-100,1,1` | `10.0000000` | `10.0000011` | `1.00000011` | `10.0000004` |
| pinned Needle flags, local Mesh | `100,1,1` | `10.2160554` | `1021.60542` | `99.9999880` | `102.1605490` |
| pinned Needle flags on world-linear proxy | `100,1,1` | `10.2159789` | `1021.59783` | `99.9999940` | `102.1597867` |

The prototype asserts:

```text
Blendlink local control anisotropy > 90
Blendlink world-linear proxy anisotropy <= 1.001
same result for determinant +100 and -100
Needle local control anisotropy > 90
Needle flags still exceed 90 on a world-linear proxy
```

It also validates vertex, polygon, loop count, and each
`(loop.vertex_index, loop.edge_index)` tuple before copying UVs. Both runs
passed.

The existing scalar is the geometric mean of two very different directional
densities in the local control. It cannot diagnose a visibly undersampled
axis by itself.

## Designs compared

### A. World-linear disposable unwrap proxy

Algorithm:

1. copy the already-private Mesh;
2. attach it to a temporary object with identity transform;
3. apply `obj.matrix_world.to_3x3()` to proxy vertices only;
4. Smart Project with `scale_to_bounds=False`;
5. verify topology identity and finite UVs;
6. copy corner UVs to the private export Mesh;
7. delete the object and Mesh in `finally`.

Benefits:

- fixes the focused `100:1` directional density defect;
- works for the tested positive and negative determinant;
- includes parent scale, rotation, and shear represented by `matrix_world`;
- does not touch artist geometry, UVs, transforms, or shape data;
- retains the current baking/export object and shader evaluation context;
- adds only optional diagnostics evidence (`uvGenerationSpace`,
  `repairCount`, and `uvRepairStrategies`); the generated scene binding and
  website loading interface remain unchanged.

Costs:

- one additional temporary Mesh allocation;
- Smart Project still has its ordinary seam/layout heuristics;
- the focused test does not prove every sheared, degenerate, or complex
  multi-island surface;
- only automatic fallback UVs are fixed by the narrow first change.

Decision: **shipped narrow production implementation**.

### B. Post-pack island normalization

Blender's `average_islands_scale()` and Blendlink's packer scale each island
uniformly. Multiplying all UV coordinates in an island by one scalar changes
both directional densities by the same factor:

```text
max_density / min_density remains unchanged
```

The prototype's `100×` skew therefore remains exactly `100×`. An arbitrary
non-uniform UV affine transform could fix one planar chart, but no single
2D affine transform generally represents world-linear distortion across a
curved multi-face island. Splitting and reparameterizing charts is the unwrap
problem again.

Decision: **rejected** as a general correction.

### C. Apply object transform, unwrap, then restore

Calling `bpy.ops.object.transform_apply` on the source violates ownership.
Applying the matrix to the compiler-private export Mesh and later inverting
it is also less safe:

- singular transforms have no inverse;
- failure cleanup must restore every coordinate and normal exactly;
- floating-point round trips can change exported bytes;
- the bake/export object would temporarily carry the wrong geometry context.

Decision: **rejected** in favor of a second disposable proxy.

### D. Loud warning or refusal

A warning for non-uniform scale is truthful and safer than claiming uniform
directional quality. A refusal is appropriate if the proxy topology or UV
copy proof fails. A blanket refusal for every non-uniform scale would make an
ordinary artist workflow needlessly manual when the proxy fixes the measured
case without touching source data.

Decision: **fallback only**, not the primary artist experience.

### E. Adopt Needle's exact Smart Project flags

Needle's source is the default behavioral baseline, but its
`scale_to_bounds=True` setting independently stretches U and V to `0..1`.
The real-Blender control proves that this preserves approximately `100×`
directional skew even after the world-linear proxy.

Decision: **justified deviation**. Keep Blendlink's
`scale_to_bounds=False`; the measured anisotropy improves from about `100×`
to `1.00000011×`.

## Preservation and support conclusions

### Artist/source Mesh ownership

Focused verification: **yes** for the shipped narrow implementation.

The source Mesh is already isolated by a tested private swap. The unwrap
proxy is copied from that private Mesh, and only its topology-validated UV
corner values return in bulk. The focused fixture directly proves source-UV
and object-matrix preservation plus target rollback and temporary Object/Mesh
ID cleanup after a forced projector failure. Broader existing compiler
transaction tests separately cover source Mesh, material, selection, mode,
and private-ID restoration; those broader assertions are not attributed to
the focused scale fixture.

### Mirrored and negative scale

Focused high confidence: **yes** for static topology.

The exact `(-100, 1, 1)` case passed with proxy determinant `-100` and
anisotropy `1.00000011`. Because transformed normals can invert, the proxy
must remain unwrap-only. Production tests should include a non-planar
mirrored Mesh before generalizing beyond this focused proof.

### Modifiers

Current support: **no**. The selected-field compiler loudly refuses every
unapplied modifier before private installation.

The proxy correction ships without weakening that refusal, but it cannot
be cited as modifier preservation. Supporting modifiers needs a separate
evaluated-Mesh transaction that proves:

- the exact evaluated geometry is used for unwrap, bake, and final export;
- material-slot ownership survives evaluation;
- topology/loop mapping remains attestable;
- source modifier state is never applied or changed.

### Shape keys

Current support: **no**. The compiler loudly refuses any `Mesh.shape_keys`.

The production proxy does not need to transform shape keys because it is made
from the already accepted static Mesh and is used only for UV generation.
Future shape-key support must choose and attest an intentional evaluated
shape/frame; it must not silently transform or discard source keys.

### Pinned authored UVs

Current ownership: **preserve**.

`BLENDLINK_ATLAS_AUTHORED` is an explicit artist contract. A world-metric
automatic unwrap must not replace it. Directional distortion evidence or an
artist-readable warning for severely undersampled authored charts is a
separate improvement; a scalar area ratio is insufficient to diagnose it.

### Generic active/render UVs

Current behavior preserves a valid injective generic source layout, whereas
Needle re-unwraps its lightmap UV every time. Automatically re-unwrapping all
non-authored selected-field receivers would be simpler and closer to Needle,
but it can change seams and baking appearance.

Recommended sequencing:

1. ship the world-linear proxy only where Blendlink already chose Smart
   Project;
2. dogfood a second variant that world-metric Smart Projects every
   non-authored selected-field receiver;
3. compare bake seams, payload, coverage, directional density, and compile
   time on the flagship, Cube, and Splash scenes;
4. retain generic source layouts only when that evidence shows a real artist
   benefit, not merely because they exist.

## Focused production fixture evidence

The registered real-Blender add-on fixture beside the selected-field
compiler checks now:

1. creates one local unit quad with an invalid private source UV so the
   automatic fallback is mandatory;
2. sets object scale to `(100, 1, 1)`;
3. runs the production private preparation and asserts anisotropy is at most
   `1.001`;
4. repeats at `(-100, 1, 1)`;
5. asserts source UV and object-matrix preservation;
6. forces an exception after proxy creation and proves exact temporary
   Object/Mesh ID cleanup plus target-UV rollback;
7. rejects a same-count Mesh whose loop vertex identity differs before
   copying any UV;
8. passes the complete final bounds, injectivity, delivery sampleability,
   and gutter transaction.

The fixture measures directional edge density directly. The separate
assertion-backed prototype retains the local Needle/current control and
measures about `100x` skew versus `1.00000011x`; an area-equivalent scalar
cannot distinguish those designs.

The following registered commands passed on 2026-07-24:

```text
npm.cmd run build
npm.cmd run test:addon-headless
npm.cmd run test:baked-e2e
git diff --check
```

The focused fixture proves geometry/UV density and ownership only. The packed
Splash browser gate described below has now run and proves deployment,
WebGL2/nonblank output, and absence of relevant browser errors for those exact
bytes; it does not by itself prove a Blender-to-browser appearance improvement
or establish a universal image-parity threshold.

## Performance status

The production path replaces one local-coordinate Smart Project with one
world-coordinate Smart Project; it does not add a second unwrap. It adds one
temporary Mesh copy, one bulk topology/finite preflight, and one bulk corner-
UV transfer.

Observed production-receiver probe (one local run, with no checked-in
benchmark harness): the actual Splash selected-field receiver is
`DP-SkyPaint.GEO` with 21,318
vertices, 21,263 quads, and 85,158 loops. The broader scene has 1,100,070
triangulated faces; that scene count is not the unwrap receiver's topology.
An intermediate production-receiver probe completed the safe proxy
transaction in `0.08039s` before the final bulk-topology optimization. This is
an observed diagnostic timing, not a maintained performance result.

Prototype performance observation (ad hoc generated fixture; no checked-in
benchmark harness): a separate stress fixture contains exactly 500,000 quads,
1,000,000 triangulated faces, 2,000,000 loops, and scale `(100, 1, 1)`.
Current production `bakelib.py`
(`e29ee44f3fba2da084f10482033445cd28f48675aae3a9dae9eb665d1519c522`)
completed two clean runs in `1.159009s` and `1.124794s`, retained Object mode,
and restored the exact Blender Object/Mesh pointer sets without RNA warnings.
The first run spent `0.530711s` in Smart Project, `0.625697s` in the complete
bulk preflight, and `0.001507s` copying UVs. The original double-validation,
per-loop-copy implementation took `7.462s`.

In the same prototype observation, the exact pinned Needle
`lightmapping_pack.py` bytes completed the identical
fresh-receiver function-level fixture in `1.327188s`, then hit its persistent
source-object hash cache in `0.820232s`. That run observed Blendlink `12.7%`
faster on the first transactional unwrap. Needle was faster on repeated work
because it writes a
persistent cache property onto the source object; a content-addressed private
UV cache remains a truthful performance gap. This comparison executed the
exact pinned Needle function through dependency stubs, not a coherent full
Needle browser stack.

Observed packed dogfood run (one local run on 2026-07-24, not a benchmark):
the final packed tarball SHA-256
`1315ceeb8f4808b0373fb118a67b0306d6b2606f883d443d1f49f94a07e3a975`
compiled the complete 1,100,070-triangle selected-sky Splash Preview in
`59.4s`, versus the recorded `66.5s` pre-optimization baseline. Its production
Vite/Chromium gate loaded the exact 38,878,972-byte content-addressed GLB into
a nonblank 1200×600 WebGL2 Canvas with no relevant browser errors. The
same-camera audit remains an observed measurement rather than a universal parity
threshold: MAE `0.1434793450`, RMSE `0.2089117911`.

Prototype memory observation from the same ad hoc stress fixture: the first
generated run raised peak working set by about `215 MiB`;
a second identical run did not add another proxy-sized allocation and exact
datablock counts remained unchanged. Blender reuses its high-water allocation
after cleanup. This observation did not use a checked-in memory-regression
harness, so it is design input rather than a verified performance guarantee.

Before promoting a general always-reunwrap policy, still compare:

- packed UV area and selected resolution on valid generic source UVs;
- output PNG/GLB bytes;
- same-camera seams and appearance across flagship, Cube, and Splash scenes.

The proxy is the safest correctness design now. A lighter custom position-only
proxy may be considered only if the full Mesh copy becomes a measured
bottleneck and passes the same topology, cleanup, and appearance gates.
