# MTLX-TSL-001 — the per-node differential harness

The non-negotiable gate for the Blendlink-owned Blender-node → TSL material
compiler: nothing enters the compiler without a cell here. Each cell renders
one node configuration on both engines and diffs raw linear floats —
channel-level numeric claims, never appearance parity.

- **Blender side**: the cell's graph drives an isolated EMIT proxy and bakes
  one 0..1 UV tile through the shipped Material-bake machinery
  (`bakelib.uv_tile_proxy` + `bake_channel_field_pixels`) — exact channel
  isolation, deterministic single-sample Cycles evaluation, no lighting, no
  view transform, raw float32 output.
- **TSL side**: the hand-written TSL mapping the future compiler must emit,
  rendered with `MeshBasicNodeMaterial.colorNode` over a unit-UV quad on
  `WebGPURenderer` into a `FloatType` render target and read back as floats.
  No canvas, no tone map, no sRGB encode.
- **Gate**: per-cell meanAbs / p99Abs / maxAbs tolerances declared in
  `cells.json`.

## Reproduce

```bash
node experiments/tsl-node-differential/run.mjs
```

`BLENDLINK_TSL_DIFF_REUSE=1` skips re-baking the Blender reference.
Evidence: `output/evidence.json`; both float fields are retained under
`output/reference/` and `output/rendered/`.

> **This table is superseded and two of its rows are no longer true.** It records fourteen cells;
> the manifest now holds **110 (109 gated)**. More importantly, the `noise-fractal-detail` and
> `voronoi-f1-divergence` rows below are listed as diagnostics measuring 1.9e-1 and 9.6e-1 — both
> are now gated cells passing at ~1e-3, so whatever fixed the fBM composition and the Worley hash
> landed after this was written and the run summary reports `noiseDivergenceMean=0.0000`. That
> stale 1.9e-1 figure had propagated into `tsl_ir.py` as the justification for capping Noise Scale
> at 20; re-measuring on 2026-07-30 put scale 40 at 1.8e-3 maxAbs and earned the bound. Treat the
> numbers below as history and `output/evidence.json` as current.

## Measured results — 2026-07-27

Blender 5.2.0 (Cycles/OptiX reference) versus three 0.184.0 TSL on a native
WebGPU backend, 64×64, fourteen cells, twelve gated, all gates passing:

| Cell | Failure class exercised | meanAbs | maxAbs |
| --- | --- | --- | --- |
| constant-linear | colorspace calibration | 0.0 | 0.0 |
| uv-gradient | coordinate-space mismatch | 1.6e-5 | 3.1e-5 |
| math-compare | inverted logic nodes | 0.0 | 0.0 |
| mapping-rotate | rotate2d/place2d matrix order | 4.5e-6 | 1.1e-5 |
| colorramp-linear | corpus-priority node (ColorRamp) | 9.3e-6 | 2.1e-5 |
| math-safe-divide | safe divide (b=0 → 0, never inf) | 1.0e-5 | 1.6e-5 |
| math-modulo-sign | truncated vs floored modulo | 3.1e-5 | 3.1e-5 |
| math-power-negative-base | compatible pow vs undefined GLSL pow | 2.5e-5 | 4.9e-5 |
| math-trig | transcendental precision | 4.0e-5 | 1.3e-4 |
| colorramp-constant | CONSTANT interpolation | 0.0 | 0.0 |
| mapping-texture-mode | place2d inverse transform | 2.8e-6 | 4.8e-6 |
| noise-mx-divergence | base Perlin octave | 4.1e-5 | 1.2e-4 |
| noise-fractal-detail | fBM composition (diagnostic) | **4.6e-2** | **1.9e-1** |
| voronoi-f1-divergence | Worley hash (diagnostic) | **2.8e-1** | **9.6e-1** |

The noise family verdict is now fully measured: the **base Perlin octave is
shared** between Cycles and MaterialX (1.2e-4), Blender's **fBM
composition is not** (octave blending/normalization differ, mean 4.6e-2),
and **Voronoi is a completely different pattern** (different cell hash,
mean 0.28) — the published Worley finding reproduced here. The compiler's
noise roadmap follows directly: reuse the mx base octave, port Blender's
fractal loop, port Blender's Voronoi hash, each behind its own gated cell.
The Blender safe-math wrappers in `main.js` (`blenderDivide`,
`blenderModulo`, `blenderPower`) are the exact functions the compiler must
emit for Math nodes; their cells prove them against undefined GPU
behavior.

Findings the harness itself produced:

1. **The "UV upside down" trap is real and was caught on run one**: WebGPU
   float readback returns rows top-down while Blender's bake buffer is
   bottom-up. The uv-gradient cell measured it (green channel inverted,
   mean 0.167) and the decode-site flip in `run.mjs` records the
   measurement.
2. **Blender's base Perlin octave and three's `mx_noise_float` agree to
   1.2e-4** over a real 0.67-span field. The published
   "slightly different hash → completely different pattern" class did not
   apply to this pairing — the base octave shares an implementation
   lineage. The cell is now a gated regression. The claim is bounded to
   exactly this configuration: fractal detail, roughness, lacunarity,
   distortion, 4D, and Voronoi remain unproven.
3. Cycles-on-OptiX and TSL-on-WebGPU agree to ~1e-5 on every proven cell —
   float rounding, not approximation.

## The compiler pipeline and scene stage — 2026-07-27

The harness now drives the production compiler end to end: `tsl_ir.py`
(the addon-side emitter — group walls crossed in both directions via
`find_principled_root`'s instance stack) emits JSON IR from the same
graphs Cycles bakes, and the packaged `tslNodeRecipe.ts` builds it into
TSL. Twenty cells, nineteen gated, all passing — including group
crossing, Map Range, Mix OVERLAY (whose vector-condition `select`
collapses to one lane; the mapping builds per-channel scalar selects),
PINGPONG, Clamp, and the ported Cycles fractal loop that closed the
4.6e-2 MaterialX fBM divergence.

`node experiments/tsl-node-differential/run.mjs --scenes` measures the
compiler against real corpus scenes (read-only, autoexec disabled):

| Scene | Materials | Principled roots (grouped) | Linked channels | IR compiled | Differentials |
| --- | --- | --- | --- | --- | --- |
| cube-diorama | 52 | 37 (16) | 35 | 2 | **2/2 pass, mean 0.0** |
| ellie-animation | 53 | 19 (1) | 12 | 1 | (unique-route channel, not tile-sampleable) |
| blender-4.0-splash | 68 | 23 (0) | 0 | 0 | — |
| trapx-painterly | 7 | 2 (0) | 0 | 0 | — |

Real corpus materials (`Clay`, `Metal`) compile through the production
pipeline and match Cycles byte-exactly. The refusal tallies in
`output/evidence.json` are the compiler's measured to-do list — next
named gaps: Mix DIVIDE (×9), Map Range SMOOTHSTEP (×8), ColorRamp
B_SPLINE/CARDINAL (×8), Noise 2D (×4), Attribute/vertex color (×2).
The dominant remaining class ("no root-level single Principled surface")
in splash/trapx is the stylized Mix-Shader/Shader-to-RGB frontier —
that is the view-dependent cell work (Fresnel, Layer Weight), not
missing coverage nodes.

## The coverage and view-dependent batches — 2026-07-27 (later)

Twenty-eight cells, twenty-seven gated, all passing, now including:

- **The view-dependent class**: Cycles bakes with
  `view_from=ACTIVE_CAMERA` under a fixed camera contract, and the TSL
  side evaluates the same optics with an analytic view cosine. The
  dielectric Fresnel formula matches to **4.8e-7** and Layer Weight
  (both outputs) to 8.5e-6 — the trapx frontier's foundation.
- The corpus-measured node gaps: Mix DIVIDE (zero-divisor keeps A —
  decided by the reference, not assumed), Map Range SMOOTHSTEP, B-Spline
  and Cardinal ColorRamps via the sampled-LUT route (Blender's own
  `evaluate()` fills 257 texels; the shader lerps between exact samples),
  2D noise (the vec2 Perlin dimension also shares the mx lineage), and
  vertex color against the COLOR_0 contract.
- Two WGSL/TSL traps measured and encoded: **WGSL const-evaluates
  literal divisions and rejects the shader** (every division routes
  through a const-safe guarded divisor), and a vector-condition `select`
  collapses to one lane (per-channel scalar selects).
- A bounded honesty rule from a real material: Plaster's detail-6 noise
  diverged at 3.9e-2 — high-octave float phase amplification, not a
  wrong algorithm — so the emitter refuses Noise detail > 2 (the proven
  range) and those channels keep the Material bake.

Scene stage after the batch: cube-diorama and ellie-animation each pass
**every** sampled differential (Clay/Metal byte-exact; ellie's
`tongue` — a production B-spline ramp over a named UV map — at 5.5e-6),
with view-dependent and attribute-driven channels tallied under their
faithful transports instead of forced through the tile domain.

## The full Math-enum sweep — 2026-07-27 (later still)

Fifty-four cells, fifty-three gated, all passing. Twenty-six spec-driven
sweep cells (declared as `"sweep"` objects in `cells.json`, built by one
generic reference builder — the IR pipeline needs no per-cell TSL code)
cover the entire remaining Blender Math enum with Cycles' safe
semantics: SQRT, INVERSE_SQRT, ABSOLUTE, EXPONENT, LOGARITHM, CEIL,
FRACT, TRUNC, ROUND, SNAP, WRAP, COMPARE, SMOOTH_MIN, SMOOTH_MAX, SIGN,
TANGENT, ARCSINE, ARCCOSINE, ARCTANGENT, ARCTAN2, SINH, COSH, TANH,
RADIANS, DEGREES, and FLOORED_MODULO. Every input domain crosses the
op's guard branch (negative sqrt/log inputs, the arcsine domain clamp
beyond ±1, all four atan2 quadrants, the snap/wrap zero-range guards).

Measured: every cell sits at float-rounding noise — means 1e-5 class,
maxima under 5.6e-4 (the inverse-sqrt pole texel) — and the discrete
cells (CEIL, TRUNC, ROUND, SIGN, COMPARE) are byte-exact. Two semantics
the mapping must carry: WGSL's native `round` is half-to-even, while
native Blender 5.3 Cycles shader Math uses `floor(x + 0.5)`. The original
sweep never landed on exact half-integers and therefore did not establish
tie behavior. The later fixed-input boundary cells prove `ROUND(-0.5)=0`
and `ROUND(+0.5)=1`; they replaced the incorrect half-away mapping.
COMPARE's epsilon has a 1e-5 floor inside Cycles.

One cell-design finding the harness produced: the first compare sweep
used a factor slope of exactly 0.2, which put 13 texel rows on exact
float knife edges (0.2·5/128 = 1/128 coincides with a representable
|u−0.5| boundary), and interpolation ulps flipped those decisions
per-engine — mean 3.174e-3 = 13/4096, precisely the rows where 2j+1 is
divisible by 5. The gated cell now uses a non-aligned 0.19/0.013 spec;
the lesson (comparison cells must keep boundaries off representable
coincidences) is recorded in the cell's notes.

## The node-family batches — 2026-07-27 (continued)

Eighty cells, seventy-nine gated, all passing. Beyond the Math sweep the
compiler gained, each family behind its own cells:

- **The complete Mix blend enum** (19 modes) with ported rgb↔hsv, and a
  measured correction: Mix LIGHTEN is the symmetric interp toward
  max(a,b) — the legacy compositor's asymmetric max(a, b·t) diverged at
  0.155 and the reference decided.
- **The Vector Math core enum** (23 ops) with per-channel safe semantics
  and the scalar Value-output path.
- **RGB Curves** via the sampled-LUT route Cycles itself uses.
- **Color utilities**: Invert, Gamma, Bright/Contrast, RGB→BW,
  Hue/Saturation, Separate/Combine HSV.
- **Deterministic textures**: Checker (byte-exact), Gradient (all seven
  types), Magic (trig cascade), Wave (all types/profiles + distortion
  through the ported fractal).
- **The hash family**: White Noise byte-exact through the ported Jenkins
  lookup3 on raw float bits, and Voronoi F1 (2D/3D, Distance + Color) at
  3e-5 through Blender's own `hash_pcg3d_i`.

The straggler batch (Noise Color, Voronoi SMOOTH_F1, Magic Fac) added
four more measured lessons:

- **Noise Color's offset seeds are dimension-dependent** (noisetex.h:
  2D uses seeds 2/3 but 3D uses 3/4 because distortion consumes the low
  seeds per dimension) — the wrong pair decorrelated both offset lanes
  at 1e-1 while the shared Fac lane stayed at 4e-5, and a z≈150 probe
  cell cleared the Perlin lineage before the seed fix.
- **Tint has a parser recursion limit**: the 125-cell SMOOTH_F1
  accumulator chain built as one nested mix(...) expression measured
  "maximum parser recursive depth reached"; `.toVar()` per iteration
  flattens the chains into sequential statements.
- **A frequency bound is part of channel honesty**: sub-texel
  sample-position differences (~3e-5 UV) multiply by texture scale —
  ellie's scale-100 hair noise measured 1.8e-1 decorrelation through
  its steep ramps while the new scale-16 cell passes at 1.7e-4, so the
  emitter refuses Noise/Voronoi scales above 16 (and linked scales).
- White Noise now requires a QUANTIZED coordinate root (floor/ceil/
  snap) whenever UV feeds it — the raw-bit avalanche class, enforced
  structurally.

The Image Texture batch (the corpus's largest single-node class, ×14)
landed at 1e-8 through embedded-pixel IR (bounded at 128×128; larger
images stay named for the production texture transport): manual
bilinear at u·W − 0.5 with per-tap REPEAT/EXTEND wrapping, Closest, and
the byte/sRGB path. Its measured finding: **Cycles associates alpha at
image load in byte sRGB space with integer floor division**
(rgb·alpha_byte // 255), THEN applies the exact IEC decode, and the
Color output stays associated — zero-alpha texels bake black and
nothing divides back. Two wrong-but-plausible models (no association;
associate-after-decode with un-associate) measured 1.9e-1 and 1.3e-1
before the byte-space model matched to 2.4e-8. A second trap: byte
images need `pack()` after pixel assignment or the renderer samples
zeros.

Two findings the hash batch measured, both worth remembering:

1. **Blender 4.x+ Voronoi does not use the White Noise hash.** White
   Noise still hashes float BITS with Jenkins lookup3 (verified 5/5
   against baked ground truth), but Voronoi jitter moved to a SIGNED
   integer PCG (`hash_pcg3d_i`: signed multiply-wrap, arithmetic
   shift-right 16, one xorshift round, mask to 31 bits, /0x7FFFFFFF).
   Porting "the" hash family as one thing produced total decorrelation
   (mean 0.166); the probe chain (constant-input hash cell → hash-free
   randomness-0 lattice cell → Position-output jitter extraction →
   upstream source read) localized it. WGSL's i32 >> being arithmetic is
   load-bearing, and shift amounts must be u32.
2. **Continuous-coordinate White Noise cannot be texel-gated across
   engines.** The uv-gradient cell measures interpolated UVs differing
   by ~260 ulps between Cycles' bake rasterizer and WebGPU's — hash
   avalanche turns that into full per-texel decorrelation on ANY two
   backends. The gated cell quantizes to floor(uv·8) so the hashed bits
   are integer-valued and identical; continuous inputs stay
   same-distribution but numerically incomparable.

## Captured lighting — the EEVEE oracle (2026-07-27, latest)

Shader to RGB cannot be evaluated by Cycles at all, so the harness
gained a second oracle: EEVEE orthographic renders of the unit tile
under a fixed-light contract (one sun with declared rotation/strength,
no world, 1 sample, Raw view transform, float EXR readback). Measured:
EEVEE's diffuse capture is exactly albedo × S·cos(θ)/π — gated through
two contract points (straight-on and 60°) plus the full splash chain
shape (capture → Separate → ColorRamp → coerced surface) at 1.5e-4.
The `shader_to_rgb_diffuse` op consumes
`BuildTslOptions.diffuseIrradiance` (harness: the analytic contract;
production: real lighting — Phase 4's application seam, like viewCos).
Flat-tile bound: N cannot vary per texel, so the cosine is gated across
cells, not across the image.

Sharp BOX projection (blend 0) is ported with the measured
sign-dependent per-plane flips at 2.1e-8; the flat tile gates the +Z
branch, the other planes carry the same ported formula as a named
bound, and blend > 0 refuses (the splash BOX population turns out to
use blend > 0 — now precisely named).

**Glass BSDF disposition**: Glass stays a named surface refusal by
decision, not omission. The six-channel model has no transmission
channel; canonicalizing Glass onto alpha would fabricate an appearance
Cycles does not render. The honest path is a transmission channel +
KHR_materials_transmission on the receiver — a contract change that
belongs with Phase 4's material application, not a lossy hack here.

## Limits

- Hand-written TSL mappings stand in for the future compiler's output: a
  cell proves the mapping, and the compiler must emit exactly that mapping.
- One configuration per cell; per-node parameter/enum sweeps are the next
  stage, then bounded random-graph composition over the proven allowlist.
- Evidence is valid for the exact (Blender 5.2.0, three 0.184.0) pair and
  re-runs when either pin moves.


## Focused native mode proofs — 2026-11-11

`run-mapping.mjs` runs focused source proofs without rebuilding the shared
package. It uses actual Blender Cycles CPU node graphs, the production
Python emitter, the production TypeScript builder through Vite, and both
WebGPURenderer backends: WebGPU and its WebGL2 fallback. The latter is not
legacy `WebGLRenderer`, whose portable glTF/material carriers do not install
these live TSL expressions. Each backend independently calibrates constant
linear values and UV orientation before measuring node cells. Source and
emitter hashes must remain stable throughout a run.

```sh
npm exec --yes --package=node@24 -- node experiments/tsl-node-differential/run-mapping.mjs
npm exec --yes --package=node@24 -- node experiments/tsl-node-differential/run-mapping.mjs --mix
npm exec --yes --package=node@24 -- node experiments/tsl-node-differential/run-mapping.mjs --map-range
npm exec --yes --package=node@24 -- node experiments/tsl-node-differential/run-mapping.mjs --hue-ramp
npm exec --yes --package=node@24 -- node experiments/tsl-node-differential/run-mapping.mjs --boundary
npm exec --yes --package=node@24 -- node experiments/tsl-node-differential/run-mapping.mjs --math
npm exec --yes --package=node@24 -- node experiments/tsl-node-differential/run-mapping.mjs --vectors
```

`BLENDLINK_BLENDER_PATH` (or `BLENDLINK_BLENDER`) selects a native Blender
executable; `BLENDLINK_TSL_DIFF_ARTIFACTS` selects a separate evidence
directory when testing another version. `BLENDLINK_TEST_CHROMIUM_ARGS`
accepts a JSON array of extra Chromium flags, including CI software GPU
flags. Backend initialization must still prove the requested backend.

Add `--built` after a coordinated package build to verify the shipping
JavaScript module. That flag refuses an older build. Reports and native
float buffers live in `artifacts/verification-{mapping,mix-math,map-range,
hue-ramp,math-boundary,shader-math}`. The report records the actual Blender
version; a run with one Blender version does not establish other versions.

| Family | Live translation earned by the focused cells | Explicit boundary |
| --- | --- | --- |
| Mapping | POINT/TEXTURE/VECTOR/NORMAL; static and linked XYZ transforms, nonuniform/negative scale, safe inverse and zero scale | NORMAL and varying transforms feeding frequency-bounded Noise require a separate coordinate-frequency proof and refuse. Inverse texture scale is included in static Noise bounds. |
| Vector Rotate | AXIS_ANGLE/X_AXIS/Y_AXIS/Z_AXIS/EULER_XYZ; inverse, linked center/axis/angle/rotation, zero-axis no-op and inverse round trips | Varying transforms feeding frequency-bounded Noise refuse. |
| Vector Math | All native operation enums: 27 in Blender 4.2, 30 in Blender 5.3, including PROJECT/REFLECT/REFRACT/FACEFORWARD and newer ROUND/POWER/SIGN | Before 5.2 Reflect/Refract require a provably nonzero normal; static POWER zero-base/negative-exponent refuses. New geometric/nonlinear transforms feeding frequency-bounded Noise refuse. |
| Mix | FLOAT and VECTOR; uniform/per-component factor, clamp and extrapolation, scalar-to-vector broadcasts | RGBA behavior stays in its existing path; inactive outputs and unsupported future types refuse. |
| Map Range | FLOAT and FLOAT_VECTOR; LINEAR, STEPPED, SMOOTHSTEP, SMOOTHERSTEP, reversed ranges, zero Steps and collapsed source ranges | STEPPED requires finite nonnegative static Steps; dynamic/negative Steps refuse. Scalar and vector collapsed-range semantics differ natively and are preserved. |
| ColorRamp | HSV/HSL × NEAR/FAR/CW/CCW; all five interpolation settings, RGB and alpha outputs | Native Cycles' 257-entry evaluator table is preserved: floor lookup for CONSTANT, linear lookup otherwise. RGB LINEAR/CONSTANT keep their analytic path. |
| Math boundary | Exact half-integer ROUND and out-of-domain ASIN/ACOS under native shader Cycles | These are shader semantics; legacy compositor node semantics can differ. |

“Exact” is the gated native-shader comparison in the cell's declared
numeric tolerance, including calibrated rasterizer interpolation differences.
The ColorRamp table is the native shader algorithm itself; it does not
claim exact evaluation of the continuous `ColorRamp.evaluate()` function.
A denser table can disagree more with Blender's rendered shader near hue
kinks, so it is not substituted. The source color space, hue direction,
interpolation setting and native table/lookup provenance travel in the IR.
The factor stays live. This is a sampled node function, not a UV surface
bake, and it introduces no additional approximation relative to the native
Cycles table. EEVEE parity needs separate native-render evidence.

Approximate/decorrelated texture cells retain their separately declared
budgets and algorithm proofs in `cells.json`; these focused exact-node
proofs do not widen those bands or establish whole-scene pixel parity.

Measured in the 2026-11-11 focused source batch on Blender 5.3:
Mapping's four new cells maxAbs ≤1.97e-6, Mix's seven new cells ≤2.40e-5,
and Map Range's seventeen new cells ≤8.20e-6. Fifty new ColorRamp cells
cover forty color mode/direction/interpolation combinations, eight alpha
outputs and two exact constant-factor bin boundaries. Smooth ramp
maxAbs ≤1.50e-4; every CONSTANT cell is byte-exact on both backends.
The maximum native hue-table derivative 7.495 × factor slope 1.273 ×
independently calibrated UV max 3.1233e-5 predicts less than 2.99e-4;
the corresponding moving-color gate is mean 4e-5, p99 1.8e-4, max 3.2e-4.
This accounts for known rasterizer interpolation and does not relax the
native algorithm. Full scalar Math's 38 cells pass; its inverse-square-root
pole is the existing maximum 5.65e-4. Native Blender 4.2 also passes the
focused Math boundary and full hue-ramp families with the same tolerances.
These source reports still require `--built` verification for shipping.


The 2026-11-12 vector batch adds complete Mapping and Vector Rotate modes,
and all remaining Vector Math enums. The focused `--vectors` gate passed
63 cells per browser backend on Blender 5.3 and 57 on Blender 4.2. Its report
explicitly identifies native configurations that are unavailable: four cells
requiring ROUND/SIGN/POWER in 4.2, and two zero-normal cases requiring the
safe native normalization introduced by the 5.2 source contract. Such cases
are not counted as passes. Native refusal tests establish the older finite
domain and reject zero-base negative powers. Largest error among the new
cases is below 5.40e-5; the existing tangent/trigonometric sweep remains the
family maximum 1.34e-4. Local Blender 5.2 also passes all 63 cells on both
browser backends. Shader proof
servers disable file watching/HMR, and source hashes remain part of every
report. Oversized Cubic image transport now refuses explicitly because its
runtime resolver has no proven cubic sampler; embedded Cubic stays live.

## Brick textures

`node experiments/tsl-node-differential/run-mapping.mjs --brick --built`
checks 130 native Cycles graphs on both browser backends. Local source proofs
pass on Blender 4.2, 5.2 and 5.3. Eighty fixed-input kernel cases differ by at
most 5.96e-8. The spatial cases cover both outputs, signed coordinates,
offset/squash frequencies, zero scale/mortar, bias extremes, linked colors,
scale, mortar size/smoothing, and dimensions bounded positively by Math Maximum.

Nearest-sampled exactly representable coordinate and control images isolate
the native Brick kernel from unrelated affine/FMA contraction. Fixed shader-stage
inputs also prevent modern multi-function folding; additional literal controls
exercise that separate path. Both evaluators receive the same authored images. This isolates the node from the independent bake UV nudge, which
the unchanged UV calibration fixture still measures. Negative color probes
encode their signal after the native node so the production bake can retain it.

Two sharp spatial variants amplify float32 partition/remainder rounding at
mortar edges. Their maximum-error allowance uses independently compared
pre-Brick position carriers, eight rounded float operations at the measured
coordinate magnitude, and the analytic smoothstep derivative bound
`1.5 / (mortarSize * mortarSmooth)`. The local smoothstep derivative is applied only where the independently bounded
coordinate interval intersects a mortar transition. All three strict budgets
apply to the remaining numerical residual; raw maximum/mean/p99 and the local
allowance are retained separately. Linux retained-reference replay gives a
maximum residual of 1.20e-7. Measured raw worst error is 3.58e-4; this precision allowance does not
apply to hard/discontinuous mortar or the fixed-input algorithm probes.

The exporter requires provably positive brick dimensions and effective squash
width, preserving live bounded dimensions while refusing undefined zero
division. Animated inputs still follow the material animation transport limits.
These fixtures do not certify arbitrary frequency, parameter, or whole-scene
pixel equivalence.

Retained native artifacts can be replayed with `--reference-dir /path/to/reference`
and an optional comma-separated `--ids` subset. Replays record manifest/IR hashes
and explicitly record that the current native emitter was not executed. Final
release checks regenerate native references.

## Clamp ranges

`node experiments/tsl-node-differential/run-mapping.mjs --clamp --built`
checks 58 native graphs per Blender version on both browser backends. Blender
4.2, 5.2 and 5.3 pass with maximum absolute error 3.94e-6. Both MINMAX and
RANGE are covered with negative/HDR values, reversed/collapsed bounds, and live
bounds crossing inside the tile. RANGE lowers to existing min/max algebra;
MINMAX keeps the native authored order. The native bake observes the unchanged
Clamp result through a positive 1/32 scale plus 0.5 carrier. Constant cells are
exact; the fixed 1e-5 spatial budget covers the independently measured Cycles
UV nudge after that observation scale. This does not certify nonfinite inputs
or animated node parameters.

## Native image sampling

`node experiments/tsl-node-differential/run-mapping.mjs --images --built`
checks 220 actual native graphs per Blender version on both browser backends.
Blender 4.2, 5.2 and 5.3 source proofs pass. The same production emitter walks
the graph evaluated by Cycles CPU or EEVEE; actual scene-linear pixels come
from isolated channel bakes or orthographic emission renders. All four
extensions (Repeat/Extend/Mirror/Clip), three filters (Closest/Linear/Cubic),
RGB/Alpha outputs, signed multi-tile fields and exact dyadic boundary probes
are covered. This is the Flat 8x8 floating Non-Color image magnification
contract; arbitrary minification/mipmap footprints and every color/alpha
association remain outside this numerical claim.

Cycles nearest selection reproduces the native truncation-minus-negative
index rule at exact negative integers. Old schema-1 programs without an
engine tag retain their previous floor behavior. Clip reads transparent black
per out-of-bounds tap; Cubic border footprints therefore fade rather than
being cut off at the image rectangle. Mirror wraps each tap independently.

The native GPU float data-image upload unassociates texels (zero alpha keeps
its authored RGB), then truncates to half storage when the source Image's
Half Precision setting is enabled. Disabling it retains float32 storage.
Cubic EEVEE sampling pairs positive B-spline weights into four bilinear
lookups; native Metal uses eight-bit filter fractions. This precision belongs
to the image sampling operation, separate from EEVEE's eventual scene target.
Two independent nontrivial emission carriers first verify that target's
half-float bound; the report retains raw error and per-component target
allowance separately from strict residual mean/p99/maximum budgets. Fixed
CPU boundary probes differ by at most1.20e-7; their strict budget is5e-6.

Floating GPU images that exceed finite half storage refuse with an actionable
Half Precision message. Media/tile/viewer sources refuse before reading their
current frame as a static image. Source pixels and precision settings are
never changed by extraction. External image transport retains its separate
pinned-byte/decoded-dimension contract, and currently refuses Cubic/Mirror/Clip.
