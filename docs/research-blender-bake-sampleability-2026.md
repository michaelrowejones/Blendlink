# Blender bake raster ownership and bounded UV rescue

- Audit date: 2026-07-24
- Scope: Blender/Cycles bake-pixel ownership, Smart UV Project guarantees,
  delivery texel centers, and a bounded UV-rescue trigger
- Installed Blender: `5.2.0 LTS`, build hash
  `fbe6228777e7d9afefcd61a413844e790ae75db7`
- Needle comparison: Blender add-on `1.4.2`, exact local sources identified
  below
- Capability ID: `NDL-PACK-004`

## Decision

**A triangle containing no delivery texel center is not, by itself, an
appropriate UV-rescue trigger.** It is a useful secondary signal after a
triangle has independently been identified as a compiler-induced numerical
sliver or coverage regression.

A blanket “one texel center per triangle” invariant is both stronger than
Blender's contract and unsuitable for dense scenes at low delivery
resolutions. In the real Blender 4 Splash `DP-SkyPaint.GEO` mesh, 38,024 of
42,632 packed UV triangles contain no `(x + 0.5, y + 0.5)` center at 128 px.
That is normal subtexel topology, not 38,024 independently repairable defects.
The texture has only 16,384 texels.

The supported direction is therefore a **precision-sliver rescue**:

1. consider only meaningful geometry in a compiler-owned, fully unpinned
   delivery UV map;
2. identify a narrow suspect set independently, such as triangles whose
   evaluated world/UV quality has collapsed near float32 precision or whose
   sampleability was lost by Blendlink's own packing step;
3. use missing delivery-center coverage as confirmation, not selection;
4. enlarge only affected compiler-owned polygons, repack once within a strict
   bound, and revalidate injectivity, gutters, and the candidate postcondition;
5. fail loudly if the bounded transaction cannot preserve those invariants.

That bounded rescue is now **Shipped** for compiler-owned, fully unpinned
selected-field delivery UVs. The suspect threshold is independent of
sampleability, ordinary subpixel topology is a registered negative control,
and the transaction must finish with an injective layout, proved gutters, and
at least one delivery texel center in every rescued triangle. This is a
compiler-safety improvement over the inspected Needle path; it is not a claim
that every subpixel triangle needs repair or that the final image is visually
perfect.

## Evidence boundary

This note separates three kinds of evidence:

- **Proven Blender behavior** is directly visible in the content-identified
  Blender 5.2 source.
- **Engineering inference** follows from that behavior but is not a Blender
  API guarantee.
- **Implementation evidence** combines the original read-only Splash
  experiment, registered Blender differentials, the current packed Splash
  compile, and the aggregate bake/browser regression matrix.

The Blender revision is the exact commit behind the installed 5.2.0 LTS build,
not a moving branch:
[`fbe6228777e7`](https://github.com/blender/blender/tree/fbe6228777e7d9afefcd61a413844e790ae75db7).

## Proven Blender behavior

### Blender owns the discrete UV raster before Cycles shades it

Blender first initializes every bake pixel with `primitive_id = -1`, projects
each UV triangle into image-pixel space, and calls its integer scan converter.
The scan-conversion callback stores the primitive ID, barycentrics,
differentials, and seed for pixels covered by that triangle. See
[`RE_bake_pixels_populate`](https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/render/intern/bake.cc#L709-L817),
[`store_bake_pixel`](https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/render/intern/bake.cc#L103-L126),
and
[`zspan_scanconvert`](https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/render/intern/zbuf.cc#L153-L226).
The object bake API then passes that populated array to the render engine; for
image targets it delegates pixel creation directly to
`RE_bake_pixels_populate` in
[`bake_targets_populate_pixels`](https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/editors/object/object_bake_api.cc#L1333-L1415).

Cycles does not discover new UV ownership for an unpopulated pixel. Its bake
integrator returns transparent when `primitive_id == -1`. Cycles can jitter
barycentrics for an already populated `BakePixel`, but that happens after
primitive ownership exists. Its own comment also notes that very small
triangles can exhaust ten jitter attempts and fall back to the center. See
[`integrator_init_from_bake` and `bake_jitter_barycentric`](https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/intern/cycles/kernel/integrator/init_from_bake.h#L30-L182).

Consequently, increasing Cycles sample count cannot make an entirely
unpopulated UV triangle acquire a bake pixel. More samples can improve shading
inside ownership Blender already established.

### Blender's bake lattice is close to, but not exactly, the delivery lattice

Before scan conversion, Blender maps UVs using:

```text
x = (u - tile_offset_x) * width  - (0.5 + 0.001)
y = (v - tile_offset_y) * height - (0.5 + 0.002)
```

Integer scan points therefore correspond approximately to
`(x + 0.501) / width` and `(y + 0.502) / height`, not exactly
`(x + 0.5) / width` and `(y + 0.5) / height`. This is visible in the same
[`RE_bake_pixels_populate` implementation](https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/render/intern/bake.cc#L759-L790).

By contrast, the conventional delivered OpenGL texture-center lattice is
`(i + 0.5) / size`: the normalized-coordinate equations scale `s` and `t` by
texture size, nearest filtering selects `floor(u)`, and linear filtering starts
from `floor(u - 1/2)`. See the Khronos
[OpenGL 4.6 Core Specification, sections 8.14.1 and 8.14.2](https://registry.khronos.org/OpenGL/specs/gl/glspec46.core.pdf#page=278).

Therefore, a `(x + 0.5, y + 0.5)` containment test describes the delivery
texture grid; it is not an exact emulation of Blender's bake rasterizer.
Absence from that grid is also not proof that a triangle is invisible on
screen: interpolated UVs and filtering are evaluated at screen fragments, not
only at texture centers.

### Smart UV Project projects and packs; it does not prove sample ownership

The Blender 5.2 Smart UV implementation:

- filters faces using a fixed `1e-12f` area cutoff;
- groups faces using geometric criteria and projects them in floating point;
- calls Blender's island packer; and
- exposes angle, margin, rotation, area weighting, and aspect-related
  properties.

It has no delivery-resolution parameter and no postcondition that each source
triangle or polygon contains a bake sample. See
[`smart_project_exec` and `UV_OT_smart_project`](https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/editors/uvedit/uvedit_unwrap_ops.cc#L3126-L3488)
and the official
[Smart UV Project manual entry](https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/uv.html#smart-uv-project).

This is not a Blender bug claim. Smart UV solves projection and packing; a
resolution-specific sample-ownership guarantee is a separate compiler
postcondition.

## Needle 1.4.2 comparison

The exact inspected Needle add-on sources are:

```text
C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\.cache\needle-spike\
  addon\Needle Engine Exporter for Blender\

Needle Engine Exporter for Blender/lightmapping/lightmapping.py
SHA-256 4e69f0934d9329b2d8480b097baa1d903aa31bed9337c7a2ae0630cbc900b4f1

Needle Engine Exporter for Blender/lightmapping/lightmapping_pack.py
SHA-256 242aad7a29c177ac566ad519425ec55cb0376805d02197a0519107a761801cd3
```

The local baseline verifier passed on 2026-07-24:

```powershell
npm.cmd run verify:needle-baseline
```

It reported 111 content-identified files and `integration=mixed-source`.
Accordingly, this is an exact source-behavior attribution, not an end-to-end
claim about one coherent runnable Needle stack. Full identity details live in
[`research-needle-behavioral-baseline-2026.md`](research-needle-behavioral-baseline-2026.md).

Needle's inspected lightmapping path calls Blender Smart UV Project with a
resolution-derived margin, builds proxy rectangles to allocate receivers,
packs those rectangles, applies the resulting scale/offset to receiver UVs,
and invokes `bpy.ops.object.bake` for selected receivers. No per-triangle
texel-center, raster-ownership, collapsed-UV, or equivalent post-pack
validation was found in those two content-identified files or the adjacent
`lightmapping` package.

Blendlink's narrow post-pack rescue therefore has no matching validation
stage in the inspected Needle path. It is recorded as a scoped
**Improvement** because the registered differential repairs a real
compiler-induced loss, the ordinary-subpixel negative control remains
unchanged, and the current packed Splash result exercises the same strategy.
This is verified superiority at the UV-safety seam only, not a universal
lightmap-quality or visual-parity claim.

## Designs compared

### A. Require one delivery texel center per triangle

**Rejected.** It confuses topology density with an unwrap defect, cannot scale
to preview resolutions, differs slightly from Blender's actual bake lattice,
and would force widespread UV distortion or texture escalation. The Splash
counterexample fails it decisively.

### B. Rescue precision suspects, then require a bounded postcondition

**Adopted and shipped.** An independent numerical or compiler-regression
predicate selects a very small suspect set. Missing delivery-center coverage
then confirms that a suspect needs attention. A local minimum-footprint
adjustment and one global repack are acceptable only for Blendlink-owned,
fully unpinned UVs. The compiler rechecks all packing invariants afterward.

This preserves ordinary dense topology while giving Blendlink a place to
repair defects created or exposed by its own transformation. A geometric
inradius bound can be used as a sufficient construction target for a selected
triangle, but it must not become a global selection rule.

### C. Instrument Blender's exact bake ownership

**Future.** Reading Blender's populated primitive map or reproducing its scan
converter would most closely answer “did Blender assign a bake pixel?” The
primitive array is not exposed as a normal Python bake API, and maintaining a
private rasterizer clone would create version-drift risk. A minimal rendered
mask fixture is a better differential oracle unless exact instrumentation
becomes necessary.

## Research and shipped evidence

A read-only Blender 5.2 experiment used a private copy of
`DP-SkyPaint.GEO` from:

```text
artifacts/release-dogfood/blender-4-splash/fixtures/
  blender-4.0-splash-selected-sky.blend
```

It copied `UVMap` to `BLENDLINK_WEB_ATLAS`, ran the canonical private Smart UV,
evaluated-UV repair, average-island-scale, and guarded packing path, then
inspected all 42,632 loop triangles at the intended delivery resolution.

| Predicate | 128 px | 1024 px |
| --- | ---: | ---: |
| No delivery texel center | 38,024 | 19 |
| Geometry quality `<= 64 * 2^-23` and no center | 19 | 19 |

The 19-triangle intersection is promising because it is stable across the two
resolutions while the blanket set collapses from 38,024 to 19. It is still
only a heuristic suspect set: the threshold does not prove those world-space
triangles are invisible or that repair improves the final image.

The rejected blanket-rescue prototype attempted to regularize 21,244 Splash
polygons at 128 px and then failed because global packing could not preserve a
sampleable footprint for every triangle. That failure is evidence against
Design A, not evidence for a shipped Design B.

The production implementation instead selects only independently
precision-sensitive or compiler-collapsed candidates and then uses delivery
sampleability as confirmation. The registered Blender 5.2 suite proves:

- a nonzero precision sliver receives the bounded
  `sampleable-regular-polygon-rescue`, covers at least one delivery texel
  center per rescued triangle, and finishes with an injective layout;
- a 2,048-triangle ordinary subpixel grid contains 1,838 triangles without a
  delivery texel center at the test resolution but produces zero precision
  candidates and zero repairs;
- a mixed exact-zero/visible polygon is regularized privately while only its
  exact-zero world-area triangle is excluded from density evidence;
- artist-owned pins are never moved, and impossible bounded packing fails
  loudly instead of retrying indefinitely.

The current packed package
(`1315ceeb8f4808b0373fb118a67b0306d6b2606f883d443d1f49f94a07e3a975`)
compiled the complete 1,100,070-triangle Splash Preview. Its manifest records
three repairs, including `sampleable-regular-polygon-rescue`; the production
Vite build and four-case Chromium matrix load exactly one content-addressed
38,878,972-byte GLB into a nonblank WebGL2 canvas without relevant browser
errors. `npm run test:full`, the add-on headless/archive gates, baked
Appearance/Lighting e2e, the flagship Final publish, 21 production browser
checks, the focused 3-test lab suite, TypeScript, and both repositories'
`git diff --check` all pass on this worktree.

## Capability record and required proof

| ID | Relation to Needle | Implementation | Evidence |
| --- | --- | --- | --- |
| `NDL-PACK-004` | Improvement | Shipped | Registered positive/negative differentials, final injectivity/sampleability proof, current-package Splash repair evidence, and aggregate bake/browser gates pass |

The shipped claim is bounded by the following evidence:

1. Registered positive, negative, mixed-zero, pinned-ownership, bounded-failure,
   source-nonmutation, and final-layout assertions pass.
2. The real Splash Preview path completes without mass regularization or
   unbounded atlas growth and publishes exact repair evidence.
3. The baked Appearance/Lighting and current-package production browser gates
   pass on the current dirty worktree.

The truthful statement is: **Blendlink ships a bounded automatic rescue for a
narrow, independently identified class of compiler-owned delivery-UV risks.**
It does not promise a sample center for every source triangle, modify
artist-owned pinned layouts, or infer overall visual parity from this local
postcondition.
