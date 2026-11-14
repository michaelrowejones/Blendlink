# Implicit White Noise field research

**Research only; zero port/Final/browser credit.** Actual Blender 5.3.0
`02f0899d78e3` CPU compositor: 24 renders / 10,224 raw Float32 output words,
with zero differences, at 13×9, 9×13, 16×8 and 8×8. Separate raw Uniform
coordinate captures precede untouched unlinked White Noise 2D Value/Color,
3D Color and 4D Color (fixed W). Every noise word matches an independent hash
of the captured coordinate words. Same-cache explicit coordinate→White Noise
controls also equal the implicit fields. One guarded native Python prefix is
archived in `artifacts/verification-compositor-white-noise-field-native-r1`.

`sources.json` pins the primary sources, with original GPL licenses; source
bodies stay in ignored research artifacts. The native default is a Float2
cached Uniform Image Coordinates result on `context.get_compositing_domain()`.
The render context constructs its domain from actual render size; `Domain(size)`
sets data/display size equal, data offset zero and identity transformation.
The MF performs native Float2→Float3 conversion, padding Z with +0. The same
coordinate cache serves explicit Image Coordinates and the implicit input.
These statements concern full-frame square-pixel CPU rendering, without
borders/crops/transformed domains. They do not authorize arbitrary image-domain
or native GPU-field equivalence.

The source arithmetic is ordered Float32:

```
coordinate = float(pixel + dataOffset) + 0.5
centered = coordinate - float(displaySize) / 2
uniform = (centered / max(displaySize)) * 2
```

Within integer extents 1..8192 and zero offset, half-centers and centered
numerators are exact. Nonzero coordinates are normal, with magnitude at least
1/8192. The final multiplication by two is exact. A correctly rounded host
axis can therefore use `Math.fround((2*i + 1 - size) / maxSize)`; power-of-two
rescaling commutes with rounding in this normal finite range. A binary64 host
division has enough precision to round this bounded rational to Float32: an
exact binary midpoint reduces to a dyadic and is exact in binary64; otherwise
the denominator is at most 8192, leaving ample separation from a Float32
midpoint. Center zero is natively +0, with no sign repair.

The existing `buildFullFrameFloatCoordinateKernel` expresses the same source
order, but **its bounded coordinate proof is insufficient for hashing**. Its
retained coordinate-only receipt has 33,024 differing words, maximum 1 ULP,
and zero violations of its own declared 2-ULP/absolute gate. Feeding those words
to White Noise can select completely different hashes. This existing receipt
is pinned in `evidence.json`; it is not a new browser field qualification.

Recommended next prototype: a shared **R32F two-row axis table**. Store X in
row0 and Y in row1 of one `max(width,height) × 2` texture, pad unused entries
with +0, and use two unfiltered integer texel loads. It costs at most 64 KiB at
8192, one binding, O(W+H) host work and one upload only when a valid physical
extent changes. It never computes a full CPU noise image and adds no render
pass or production readback. Share the table per built pipeline, not per White
Noise node, within the existing total sampler budget of eight. Test actual
R32F allocation, raw upload/load words and native input axes before hashing;
derive orientation independently and use integer physical pixel indices.

Before SDK integration, test both APIs on actual Metal and SwiftShader,
odd/asymmetric/extreme sizes, resize/DPR, unchanged-extent upload reuse,
dispose/cancellation/reapply, actual resource counts, and stale data/schema/
version/extent mutation refusals. Half textures, interpolation, sRGB transforms,
replacing source zeros, output repair or relaxed noise tolerances are excluded.
Existing fixed-input White Noise and approximate coordinate ports remain intact.

An exact uint32 rational-to-Float32 ALU route appears mathematically possible,
using bounded normalization, two quotient/remainder stages and round-to-nearest
bit packing per axis. It adds substantially more shader arithmetic and backend
proof burden. Defer it until the lookup prototype has measured costs; no
premature optimization or performance claim is made here.

## Retained axis prototype and conversion counterexample

`prototype-evidence.json` records three failed, zero-credit prototype attempts.
The first exposed a Y-convention error: Three `QuadGeometry` places image UV
row0 at screen top. Integer `screenCoordinate.xy` matches that existing
compositor image-storage convention; flipping Y to a world-raster convention
was incorrect. An independent image-load control selects physical readback
orientation before any axis/noise evaluation. The second attempt stopped on a
fixture metric race: Three resets draw-call counters each RAF, so the counter
must be captured synchronously immediately after draw, before async readback.
Neither correction changes native data or numeric acceptance.

The third attempt completed both actual Metal APIs: 48 native frames and
1,979,328 exact words per API across eight extents, including 8192×4 and 4×8192.
It observed exactly eight table builds/uploads for eight extents, no further
uploads on unchanged draws, a maximum 64 KiB R32F allocation, one binding/two
unfiltered loads, four named mutation refusals and three idempotent cleanup/
reapply cycles. The old direct coordinate kernel's coordinate-plus-hash
research controls differed at 14,240 words per Metal API. Overall field credit
remains zero because SwiftShader failed the subsequent hash result gate.

The decisive separate four-tuple diagnostic retains full generated GLSL/WGSL
and unchanged production-module hashes. Source X/Y words and raw Jenkins U32
low/high16 lanes are exact on both APIs and profiles. **Dynamic uint32→Float32
conversion differs on both SwiftShader APIs**, at 11 of 117 field pixels.
For seed words `[3211546309,3206384089]`, the correct hash is
`0xda457153 = 3661984083`. Native CPU rounds that to `3661984000` (Float32 word
1331316081); dynamic SwiftShader conversion produces `3661984256` (word
1331316082). Normalization inherits that one-ULP difference. A uniform-U32
control reproduces it without a texture or hash. Multiplying by 2^-32 instead
of dividing by Float32(UINT_MAX) does not fix the already wrong conversion.

The **same failed seed through the actual production fixed-input compositor
helper is exact on all four tuples**, as is literal-U32 conversion. A fresh
actual native CPU constant-unit regression also matches all 64 words. The
existing port emits only compile-time literal seed inputs; it does not admit
uniforms or dynamic coordinate fields. This observed case therefore does not
invalidate its fixed-source receipt, while it blocks the proposed field route.

Next research must explicitly construct native CPU round-to-nearest/ties-even
normalization from integer mantissa/remainder bits, casting at most 24 exact
significant bits, then exact power-of-two scaling. Keep the old shader route
unchanged. All failures and partial Metal successes remain research; no lookup
prototype, dynamic field or replacement normalizer is admitted by this record.
