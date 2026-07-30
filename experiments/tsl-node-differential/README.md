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
the mapping must carry: Blender rounds half away from zero while WGSL's
native `round` is half-to-even (the mapping uses sign·floor(|x|+0.5)),
and COMPARE's epsilon has a 1e-5 floor inside Cycles.

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
