# Why correct CoC is not a qualified EEVEE DOF port

Source pinned by `sources.json`, Blender
`02f0899d78e374b63e7181d9061e1f7ab03419cc`.

## Radius and image coordinates

- `eevee_depth_of_field.cc` sync computes aperture as lens in meters divided
  by twice f-stop. That is an aperture **radius**. Render projects the center
  and one aperture-radius offset at the focus plane, then multiplies NDC
  separation by `0.5 * physical_image_width` for pixel radius. The perspective
  inverse-depth multiplier is focus times the bias.
- `eevee_depth_of_field_shared.hh:coc_radius_from_camera_depth` evaluates that
  signed inverse-view-depth MADD. The source value is full-resolution radius,
  not diameter. The optical disk diameter is twice its absolute value.
- `eevee_depth_of_field_accumulator.bsl.hh:dof_load_gather_coc` explicitly halves
  that CoC for gathering at half resolution. The scatter setup also explicitly
  halves CoC before deriving half-resolution sprite extents. This does not
  justify an extra factor of two in the full-resolution browser footprint.
- Tile bounds use 8 half-resolution pixels = 16 physical pixels. Native tile
  propagation has gather-ring jitter error `1+1/(5+.5)`. Candidate 2 borrows
  these bounding principles; it does not reproduce every native min/max,
  min-intersectable, prediction or half-resolution/color-reduction operation.

The readback controls sample the **browser's** CoC shader and compare it to an
independent homogeneous projection of the source equation. They do not read
EEVEE's actual private CoC GPU texture. Neither the CPU oracle nor numerical
agreement constitutes native GPU-attachment parity. Blender's exposed Depth
render pass is not that CoC attachment; `DEBUG_DOF_PLANES` colors layer usage,
not the scalar radius. A native instrumented build/debug capture would be
needed to inspect the exact internal texture directly.

## Missing native operations that affect the foreground

`eevee_depth_of_field_accumulator.bsl.hh` carries color, CoC first/second moments,
weight, transparency and layer opacity. Source accumulation includes:

1. Per-sample disk intersection, inverse-area **and source layer** weights;
   overlapping foreground/background/slight-focus ranges, not a hard sign split.
2. Symmetric sample pairs, ring buckets, CoC-dependent ordered occlusion and
   transparency composition. Different depth/radius layers cannot be replaced
   by one normalized radiance average and an integrated disk mask.
3. Foreground weight `1 - accumulated_transparency`, while background weight
   comes from layer opacity divided by sample count. Those weights and color
   are resolved together, including near-full/near-empty precision handling.
4. Separate hole-fill, far/background, slight-focus, focus and foreground buffers.
   Resolve composites them in that order. The foreground layer is already
   coverage-bearing; it is not the original hard foreground color mixed over
   a locally blurred copy of itself.
5. Native bright-highlight scatter, spatial filtering, stable half-resolution
   reduction and temporal accumulation. Scatter controls matter for Impact's
   bright foreground highlight; skipping scatter can change its apparent disk
   shape even when the geometric CoC radius is right.

Candidate 2 improves the *existence* of soft foreground coverage but retains
incorrect ring occlusion, layer weighting and background reconstruction. Its
worse measured differences are retained. Increasing sample count did not
resolve these semantic gaps.

The next smallest defensible implementation unit is a **matched layer
accumulator and resolve**, starting with constant-color opaque near/focus/far
planes and an occluding edge, then bright highlights separately. Use the native
layer/intersection/opacity contract consistently; evaluate full foreground
silhouettes and signed DOF-on minus DOF-off deltas. Do not blend partial source
pieces into the current approximate mix and call that native parity. A bounded
1.0 approximation can remain useful, but its visible limitations must be
measured before default enablement.

## Baseline confounds and prepared control

An absolute website-vs-native PNG metric includes lighting, material and display
mismatches. `native-dof-off.py` prepares a one-render original-scene native
control at the same frame 0, EEVEE 64 samples and 1280x720 as the retained native
DOF-on R2. Its only optical change is `camera.data.dof.use_dof=False` in memory;
no scene is saved, source bytes are hash-checked and DOF is restored in memory.
The original native-on reference is pinned rather than regenerated or changed.

`compare-deltas.mjs` compares signed nativeOn-nativeOff with candidate-sharp for
each real browser backend and the same frozen full-frame/foreground/focus
regions. This removes a fixed baseline offset; nonlinear material, bloom and
display coupling and native sampling noise still prevent treating delta
agreement alone as complete optical parity. The producer and every input image
are retained and hashed; there is no automatic pass threshold.

## License boundary

The audited EEVEE C++/BSL files carry `GPL-2.0-or-later` notices. Three r184 and
its artistic DepthOfFieldNode are MIT. The repository currently describes the
browser adapter/runtime under MIT with specific third-party exceptions in
`packages/blendlink/LICENSES.md`, and Blender-dependent Python as GPL-3.0-or-later.
The current camera candidate is an independently implemented equation/disk
approximation, not a transliteration of the native accumulator.

A future direct translation of the substantial EEVEE accumulator or resolve
must preserve its appropriate upstream licensing and notices; it must not be
introduced as ordinary MIT adapter code. GNU's
[translation guidance](https://www.gnu.org/licenses/gpl-faq.html#TranslateCode)
treats translation to another programming language as modification. Before
shipping such a route, make the module/aggregate/package and generated website
license treatment explicit. An independently designed implementation or an
MIT Three-based baseline is a separate possible engineering direction; neither
its license nor its visual behavior should be assumed from functional similarity.
