# Blender 5.3 compositor SMAA feasibility

A faithful Anti-Aliasing port is feasible as a dedicated three-pass compositor
operation. The installed Three 0.184 `SMAANode` is not a faithful substitute for
Blender's defaults. This checkpoint is source research only: no SDK/fixture
changes, native/GPU jobs, implementation or support/numerical credit.

The [source pins](../experiments/smaa-source-research/sources.json) retain exact
Blender revision `02f0899d78e374b63e7181d9061e1f7ab03419cc`, source byte hashes,
and the observed local Three/runtime file hashes. Local observations were made
at repository revision `fd2c1ee00643b33a33d565ba346b2617f6e56fdc`; they are
historical source observations rather than an assertion that future installed
or runtime files retain those hashes.

## Native wrapper and actual passes

The [native node](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/nodes/composite/nodes/node_composite_anti_aliasing.cc)
has one Color Image input/output and three scalar inputs. Threshold defaults to
0.2 and is clamped to0..1 then divided by2, producing effective0.1. Contrast
Limit defaults to2 and is bounded below by0. Corner Rounding defaults to0.25,
is clamped to0..1, multiplied by100 and converted to integer, producing25.
The wrapper requests single-value controls with default fallback; a first port
should explicitly admit fixed controls instead of implying support for varying
control images. An actual single-value image shares its input without passes.

The [algorithm](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/compositor/algorithms/intern/smaa.cc)
performs edge detection, blending-weight calculation, then neighborhood blending.
Default axial search count is16, diagonal count8, with corner handling enabled;
no active preset disables these default features. CPU edge detection uses
current Blender color-management luminance coefficients; alpha has weight0.
The Float specialization is also present in the shared algorithm, but that
alone does not qualify arbitrary conversions into the node's Color socket.

CPU sampling uses nearest/Extend for luma edge taps and bilinear/Extend for
weights/resolve and lookup accesses. The GPU wrappers use pixel centers
`(texel+0.5)/image_size`, linear samplers and the input result's image domain.
The cached search lookup is normalized8-bit R with linear filtering; the area
lookup is normalized8-bit RG with linear filtering. Native lookup bytes, packed
search coordinates and row orientation need independent comparison before any
Three PNG can be reused.

The neighborhood pass selects an axis, normalizes the two directional weights,
then combines two bilinear samples at weighted offsets. All RGBA components are
processed; there is no automatic unpremultiplication, alpha-only edge detection,
display transform or gamma conversion added by the wrapper. Preserve the input
Color convention and native operation order. The SMAA library's general gamma
advice does not authorize inserting a transfer function absent from Blender's
wrapper. Alpha-only discontinuities with equal RGB do not acquire luma edges.

## Concrete differences from Three

| Contract | Blender 5.3 default | Installed Three 0.184 SMAANode |
|---|---|---|
| Edge metric | Color-management luminance | Maximum RGB-channel delta |
| Effective threshold |0.1, from node control | Hardcoded0.1 |
| Local contrast | Adjustable; default2 | Hardcoded equivalent2 |
| Far-neighbor comparison | Adjacent left/top against their next neighbors | Center against farther samples |
| Searches |16 axial,8 diagonal |8 axial; no diagonal implementation |
| Corners | Rounding25 by default | No corner processing |
| Resolve | Normalized two-sided weighted samples | Different selected-neighbor interpolation |
| Search lookup | Bilinear and packed-coordinate mapping | Nearest and a different coordinate path |
| Extent | Actual input result domain | Renderer drawing-buffer size |
| Intermediate precision | Requested native result precision | Three HalfFloat targets |
| Lookup readiness | Native cached byte data | Asynchronously loaded embedded PNG images |

Three's [implementation](https://raw.githubusercontent.com/mrdoob/three.js/r184/examples/jsm/tsl/display/SMAANode.js)
provides useful renderer-state restoration, target ownership and disposal
examples. Its pass structure or matching SMAA name does not establish native
algorithm, table, alpha, precision or first-frame equivalence.

## Precision is a runtime contract

The [shader declarations](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/compositor/shaders/infos/compositor_smaa_infos.hh)
nominally specify16-bit image formats. That is not proof that a Full-precision
native compositor uses half-float buffers. The [shader cache](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/compositor/cached_resources/intern/cached_shader.cc)
rewrites image formats through `Result::gpu_texture_format` for the requested
precision; [Result](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/compositor/intern/result.cc)
maps Full Color/Float4 to RGBA32F and Float2 to RG32F. Native context precision
must be pinned independently for each CPU/GPU capture. Three's three targets
are explicitly HalfFloat, so wrapping its node cannot preserve a Full32 claim.

A new port should use explicit Float32 targets and validate Float32 sampling
capability on each actual API. If filtering is unavailable, an independently
qualified texture-load interpolation path or a named refusal is needed; silently
switching to HalfFloat is not a valid fallback. Threshold decisions are
sensitive to arithmetic/rounding changes, so final-image error alone cannot
prove matching edge decisions.

## License boundaries

The installed Three source is distributed under its MIT license. Three cites
historical upstream SMAA v2.8; that pinned `SMAA.h` has a separate permissive
redistribution notice requiring retained source notices and a specified binary
documentation attribution. It is not an MIT header and must not be labeled MIT
merely because Three references it. Its exact bytes/hash are retained alongside
the Three pins. Blender's
modified canonical CPU SMAA algorithm and GPU library explicitly declare
`MIT AND GPL-2.0-or-later`; its node, shader wrappers, precision/cache helpers
and lookup-resource wrappers declare `GPL-2.0-or-later`. These are observed
source labels, not a legal-equivalence assertion. Sharing SMAA ancestry or using
a separately permissive upstream base does not erase notices on Blender modifications copied
into a port. Retain exact upstream/Blender provenance, preserve applicable
notices and update the repository's existing separately licensed runtime-file
inventory when implementation is chosen. No license decision or production
source incorporation occurs in this research checkpoint.

## Proposed first slice and proof stages

Start with default controls, one same-domain Color image and the source
program's existing luminance coefficients. Admit actual single values as a
zero-pass identity. Materialize a live input once if needed; run the faithful
three passes at that input's physical extent before the source display transform.
Use verified native lookup bytes with explicit clamp/filter/orientation and
synchronous readiness. Existing FloatType compositor RTT ownership, extent
validation, source-luminance data and pre-display insertion are reusable seams.
Three's renderer-size policy is not reusable for resized/static image domains.

Initially refuse animated or linked controls, Half precision, transformed/data
windows or resized domains lacking separate realization proof, unsupported
sampling profiles and unproven conversions. This does not propose disabling
existing scene TRAA or replacing the application's automatic final FXAA/SMAA:
authored compositor AA and scene/default AA are distinct stages whose actual
order must remain visible in validation.

1. Prove native wrapper normalization and schemas. Independently capture CPU
   and GPU edge/weight/final stages at pinned precision before selecting the
   reference profile; do not pool their results by assumption.
2. Cover flat/constant images, axial and diagonal lines, long searches, L/T/X
   corners, equal-luminance different-color edges, HDR/signed values, transparent
   RGB and alpha-only boundaries. Include threshold neighbors and zero controls
   as refusal/future-control policy tests. Check edge masks separately from
   bounded weight/final Float32 error; prespecify tolerances before rendering.
3. Exercise boundary clamps,1x1/1xN/Nx1, odd/portrait sizes, resize/recovery and
   cold lookup initialization. Confirm frame-to-frame clearing, target size,
   source preservation, MRT/viewport/scissor restoration and disposal.
4. Run fresh source-pinned saved Final and direct-runtime matrices on actual
   WebGPU/WebGL2, with wrong-profile/missing-capability controls and immutable
   fixture/vendor/runtime captures. Then try native official-scene composition;
   source research alone earns no scene appearance credit.

The cost is three full-image passes plus bounded edge searches, lookup textures
and any initial input realization. Three separate RGBA32F intermediates consume
48 bytes/pixel: about99.5MB at1920x1080 or398MB at3840x2160, excluding input,
alignment and transient allocations. Those are storage calculations, not
measured timing or peak-use claims. Releasing/reusing edges before final resolve
or using RG edges can reduce storage after proof; do not optimize away native
semantics. Profile warm/cold, static/live, sparse/dense edges, actual GPU time,
allocation/resize cost and read traffic; use explicit resource admission and
avoid recomputing unchanged static inputs when dependency tracking proves safe.
