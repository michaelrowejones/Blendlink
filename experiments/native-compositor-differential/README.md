# Native compositor differential checks

These checks render real Blender compositor graphs to scene-linear, 32-bit
floating-point EXRs, extract those same graphs, and compare the resulting Three.js
runtime pixels. They exercise the `WebGPURenderer` family using both its actual
WebGPU backend and its WebGL2 backend. They do not install authored compositing in
the ordinary `WebGLRenderer` renderer.

Run commands from the repository root with Node 22.12+ or Node 24, the workspace
dependencies installed, and Playwright Chromium installed. Set `BLENDLINK_BLENDER`
to the Blender executable to test. The complete gate also checks native shader
families:

```sh
npm run build
BLENDLINK_BLENDER=/path/to/blender npm run test:node-parity
```

The gate discovers Blender, generates the native compositor families, and
tests the built package on both browser backends. Blender 4.2 and newer also
render the supported GPU families; an unavailable GPU device fails when those
corpora are requested. Native capabilities and per-family case counts are
recorded. Actual shared Boolean/Integer node creatability is probed separately
for shader/compositor trees, so unavailable utility classes are reported
explicitly. Matched CPU/GPU canaries prove GPU execution through differing ramp
and curve results while unchanged HDR/negative/alpha controls remain bit-exact.
Evidence is retained under
`artifacts/verification-native-node-gate/`. CI runs this gate against Blender 4.2
and 5.2; a successful run is required before claiming parity for that installed
version and platform.

## Generate native references separately

All generators support the old Blender 4.2 scene node tree and the modern scene
compositor group API. Most select Cycles CPU for the scene context; the transform/resampling fixtures
select EEVEE. Injected Image data can allow Blender to omit scene rendering.
These are independent compositor references, with view processing disabled on
the EXR and full compositor precision selected where available.
Their default compositor device is CPU. The channel generator also accepts
`BLENDLINK_COMPOSITOR_CHANNEL_DEVICE=GPU` on versions with an offline GPU
compositor. A requested unavailable GPU device fails instead of substituting CPU.
Pointwise, alpha, mix and color-control generators accept the corresponding
`BLENDLINK_COMPOSITOR_<FAMILY>_DEVICE=GPU` override.

```sh
BLENDLINK_COLOR_BALANCE_REFERENCES="$PWD/artifacts/native/balance" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_color_balance_check.py

BLENDLINK_COMPOSITOR_MATH_REFERENCES="$PWD/artifacts/native/math" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_math_check.py

BLENDLINK_COLOR_CHANNEL_REFERENCES="$PWD/artifacts/native/channels" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_color_channels_check.py

BLENDLINK_COMPOSITOR_POINTWISE_REFERENCES="$PWD/artifacts/native/pointwise" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_pointwise_check.py

BLENDLINK_COMPOSITOR_ALPHA_REFERENCES="$PWD/artifacts/native/alpha" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_alpha_check.py

BLENDLINK_COMPOSITOR_MIX_REFERENCES="$PWD/artifacts/native/mix" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_mix_check.py

BLENDLINK_COMPOSITOR_COLOR_REFERENCES="$PWD/artifacts/native/color" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_color_check.py

BLENDLINK_COMPOSITOR_HUE_CORRECT_REFERENCES="$PWD/artifacts/native/hue-correct" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_hue_correct_check.py

BLENDLINK_COMPOSITOR_WHITEPOINT_REFERENCES="$PWD/artifacts/native/whitepoint" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_whitepoint_check.py

BLENDLINK_COMPOSITOR_MATH_SPATIAL_REFERENCES="$PWD/artifacts/native/math-spatial" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_math_spatial_check.py

BLENDLINK_COMPOSITOR_DEVICE_REFERENCES="$PWD/artifacts/native/devices" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_device_check.py

BLENDLINK_COMPOSITOR_TRIG_REFERENCES="$PWD/artifacts/native/trig" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_trig_check.py

BLENDLINK_COLOR_CHANNEL_REFERENCES="$PWD/artifacts/native/channels-gpu" \
BLENDLINK_COMPOSITOR_CHANNEL_DEVICE=GPU \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_color_channels_check.py
```

Without the reference environment variable each generator still performs its
native checks, using a temporary output directory. To compare saved references
against the current source runtime:

```sh
node experiments/native-compositor-differential/run.mjs \
  --out artifacts/native/browser-source \
  artifacts/native/balance artifacts/native/math artifacts/native/channels
```

Use `--built` after building to prove the emitted runtime that will be shipped:

```sh
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/native/browser-built \
  artifacts/native/balance artifacts/native/math artifacts/native/channels
```

`--built` rejects stale output using both modification times and an independent
whole-program TypeScript emission byte comparison for every production module.
Emission uses captured source text and writes only to memory. This catches stale
dependencies even when the two compositor entry modules have not changed, while
preserving semantic type-only reexports and const-enum lowering.
`provenance.json` records source, expected emission, emitted module and extractor
SHA-256 hashes, plus the TypeScript version. Each reference records its Blender
version/build hash. A fresh output directory is generated when `--out` is omitted,
so simultaneous independent runs cannot overwrite each other's fixtures.

Each run copies production modules into its own `module-snapshot`: source `.ts`
files for a source run, or emitted `.js` files for `--built`. The browser entry
and its relative imports resolve inside that snapshot. Watching and hot reload
are disabled. Provenance records the exact SHA-256 of every copied module;
workspace edits made during a run are listed separately and cannot change its
tested bytes. Backend timeouts scale with corpus size, with a two-minute minimum.
The final built gate must still run against the intended shipping revision.

## Pixel contract and evidence

The runner calibrates an unchanged float texture before each comparison, including
HDR and alpha values. Row orientation is selected from that control render only.
WebGPU readback explicitly accounts for 256-byte row alignment and the unpadded
last row. Each result records the raw readback type, dimensions, array length,
stride, first samples, control error, maximum absolute error, per-channel errors
and worst pixel. A case passes at absolute error at most `2e-5`; control error
must not exceed `1e-6`. Fixtures marked `exactAlpha: true` additionally require zero
alpha error. No relative error allowance hides singular or high-magnitude inputs.

Both requested browser backends must actually initialize. Missing WebGPU,
WebGL2 fallback during a WebGPU run, shader validation errors, browser errors,
non-finite pixels and numeric mismatches fail the run. Both backends are attempted
even if one fails. `results.json` retains their reports. Extra Chromium launch
arguments may be supplied through `BLENDLINK_TEST_CHROMIUM_ARGS`, a JSON array of
strings; this does not relax backend or numeric assertions.

## Verified families and limits

Local native references were generated with official Blender 4.2.0
(`a51f293548ad`), Blender 5.2.0 LTS (`fbe6228777e7`) and Blender 5.3.0
(`02f0899d78e3`). These provide distinct old property-based and modern
socket-based node schemas. Blender 5.2 is also checked by the repeatable CI gate;
its behavior is not inferred from a 5.3 result.

- **Color Balance:** 9 legacy and 10 modern cases. Lift/Gamma/Gain and ASC-CDL,
  partial/negative/greater-than-one factors, zero gamma, HDR and negative RGB,
  scalar bases, and alpha are checked. Both browser backends matched all 19
  references within `3.1e-6`, with exact alpha. White Point, dynamic mode selection
  and animated compositor trees are explicit refusals. Legacy Lift/Gamma/Gain
  uses Blender's sRGB lift/gain stage followed by linear gamma; modern nodes use
  their linear model. Alpha bypasses grading, and the native factor upper clamp
  does not become a lower clamp.
- **Math:** the generator enumerates the installed version's complete scalar
  Math enum and tests ordinary values, clamp behavior and operation boundaries.
  Unsupported or non-finite domains fail closed. The current local combined
  4.2/5.3 batch contains 581 cases, including explicit lower/upper/unchanged
  clamp probes; both browser backends matched within `2.4e-7`.
  Counts are version-dependent and the generated `index.json` is authoritative.
- **Separate/Combine Color:** 127 legacy CPU, 91 modern CPU and 91 modern GPU
  references cover RGB/HSV/HSL/YUV/YCC, every separate output, alpha, roundtrips,
  constant and spatial combinations, out-of-range Hue, negative/HDR values,
  and legacy RGBA/HSVA/YUVA/YCCA aliases. YCC covers ITU BT.601, ITU BT.709 and
  JPEG/JFIF. YUV uses BT.709. Both browser backends matched all 309 references
  within `1.91e-6`, with exact alpha and no shader validation errors.
  Native HSL can be singular for some HDR inputs; these tests assert
  finite native references and do not claim meaningful results for non-finite
  native domains.
- **Pointwise numeric nodes:** RGB to BW, Clamp Min Max/Range, every scalar and
  vector Map Range interpolation, and the legacy Gamma/Map Range aliases.
  The initial 201-case native batch matched both browser backends within
  `2.03e-6`, with exact alpha. Reversed/collapsed ranges, positive/zero/negative
  Steps, scalar/vector conversion and HDR/negative inputs are covered. Modern
  CPU Map Range returns To Min for collapsed ranges; spatial GPU scalar Map
  Range returns zero before its optional output clamp; the legacy compositor
  returns zero even when that clamp is enabled.
- **Color Ramp and curves:** the pointwise generator also covers all RGB ramp
  interpolations, HSV/HSL hue directions, Color/Alpha outputs, narrow and
  duplicate stops, modern and legacy ramp schemas, compositor RGB Curves,
  modern RGB/Float/Vector Curves and legacy Vector Curves. Curve cases include
  Standard/Film Like tone where applicable, non-unit X ranges, horizontal and
  extrapolated endpoints, black/white levels, clipping, partial/spatial factors,
  and authored input alpha. Native lookup data are extracted using an owned
  temporary node-tree copy; tests assert no authored-curve changes or leaked
  temporary IDs.
- **Alpha-aware utilities:** 315 native graphs (107 legacy CPU, 104 modern CPU,
  104 modern GPU) cover Invert flags, dynamic numeric-to-boolean flags, legacy
  Brightness/Contrast Convert Premultiplied, legacy Alpha Over premultiply-slider
  precedence and modern Over/Disjoint Over/Conjoint Over. Zero, negative and
  greater-than-one alpha and negative/extrapolated factors are included. Both
  browser backends matched within `1.91e-6`, with no shader/browser errors.
- **Mix:** 998 native graphs (190 legacy CPU, 404 modern CPU, 404 modern GPU)
  cover all 19 RGB blend enums for legacy MixRGB, shared Shader MixRGB and modern
  Mix Color; Float/Vector Mix, uniform/nonuniform factors, alpha and clamp rules
  are included. Both browser backends matched within `1.91e-6`, with no
  shader/browser errors. Rotation is still a named refusal until its quaternion
  transport and interpolation are proved separately.
- **Color controls:** 596 native graphs (108 Blender 4.2 CPU, 122 each for
  Blender 5.2/5.3 CPU/GPU) cover Exposure, Hue/Saturation/Value, Posterize and
  Color Correction. Color Correction includes all four tonal regions and five
  grading controls, masks below zero/above one, channel switches, dynamic modern
  controls, collapsed/reversed/overlapping tonal ranges, HDR and negative colors,
  and independent alpha. Legacy Lift properties and modern Offset sockets carry
  their respective negative-color fallback rules. Zero gamma has finite constant
  probes; negative-gamma zero-base fallback probes keep positive inputs at least
  `0.125`, since near-zero reciprocal grading amplifies native CPU/GPU rounding
  into large HDR absolute differences. Both browser backends matched within
  `6.62e-6`. Hue/Saturation checks far Hue values, signed/extrapolated factors and
  native device conversions; Blender 4.2 CPU wraps Hue once rather than taking a
  full fractional modulus. Legacy Posterize retains reciprocal-before-floor
  ordering, including adjacent float values at bin boundaries. Compensated CPU
  division preserves those bins and discontinuous Color Correction regions
  without an arbitrary epsilon.

The initial pointwise corpus, including ramps and curves, contains 672 native
graphs (140 legacy CPU, 266 modern CPU, 266 modern GPU). Both browser backends
matched within `2.03e-6`, with no shader/browser errors. Alpha is exact for
passthrough fixtures; calculated alpha uses the numeric tolerance above.

Color Ramp's CPU path evaluates stop interpolation analytically. Its spatial
GPU path uses Blender's native 257-entry table except for native two-stop RGB
optimizations. Curves use Blender's native 257-entry tables and endpoint slopes,
including CPU compositor `Combined(Channel(x))` premultiplied tables and spatial
GPU `Channel(Combined(x))` evaluation. These orders can produce different colors.
Compositor RGB Curves preserve alpha; modern shader RGB Curves in a CPU compositor
return opaque alpha, while their spatial GPU path preserves source alpha.

Native Metal linear table filtering rounds sub-texel interpolation to eight
fraction bits. Blender 5.2 uploads half-float color tables and rounds filtered
half samples with ties away from zero; Blender 5.3 uses full-float table storage
and samples. Table upload rounding and sampler rounding are separate contracts.
The exporter records the native model and the runtime reproduces it on either
browser backend. New positive/negative exact-half-tie probes and adjacent input
floats distinguish the sampler rule from round-to-nearest-even. The expanded
native GPU precision corpus contains 268 cases per version for Blender 5.2/5.3.
Both browser backends match all 536 within `2.03e-6`, with no shader/browser errors.
Other native GPU backends require their own compositor-reference run before
claiming equivalent parity. On Linux 4.2+, the combined gate requests native
OpenGL GPU compositor references under CI's Xvfb; that platform must pass before
claiming parity there. CPU-authored graphs and supported analytic ramp paths do not
require GPU lookup metadata. `BLENDLINK_COMPOSITOR_POINTWISE_DEVICE=GPU`
generates the additional native GPU corpus on a supported Blender installation.
Earlier schema-1 programs without explicit table precision retain their previous
full-float/fixed8 behavior; re-exporting records the native version/device model.

Mix preserves several native historical behaviors rather than applying a single
shader formula to every class. Legacy MixRGB permits unclamped factors and its
Divide zero-divisor lane returns zero. Shared Shader MixRGB ignores the old Use
Alpha flag; its CPU Mix mode interpolates alpha while its spatial GPU Mix mode
preserves A alpha. In Blender 5.3's spatial GPU Shader MixRGB, Clamp Output produces
zero alpha; the fixture records that native behavior. Modern Mix Color interpolates
alpha in Mix mode and applies output clamping to RGBA. Native compositor alpha
composition is emitted through laid-out TSL functions so shared input expressions
are evaluated before conditional branches.

Device and version metadata are part of the conversion contract, not cosmetic
labels. Blender's CPU HSV conversion uses a triangular Hue basis while spatial
GPU HSV uses sextants; out-of-range Hue exposes the difference. Blender 5.2/5.3
fold all-constant GPU graphs through CPU functions, while Blender 4.2 executes
those nodes on the GPU. The exporter records both execution and single-value
devices; actual dependency classification handles linked Value nodes too.
Legacy combinations clamp
negative results where the corresponding modern CPU function preserves them;
modern spatial GPU HSL still clamps. Alpha remains an independent channel, with
no implicit unpremultiply. The tests include spatial inputs specifically to avoid
mistaking constant folding for proof of a GPU operation.

## Legacy GPU and math precision checkpoint

The additional Blender 4.2 GPU corpus contains 140 pointwise, 107 alpha, 190 Mix,
127 channel, 108 color-control and 9 Color Balance graphs. Its 41-mode Math sweep
contains 287 finite cases and five explicit undefined-domain refusals. Native
spatial Math adds 140 legacy and 141 cases each for Blender 5.2/5.3. Matched
device probes contain 15 cases on 4.2 and 18 each on 5.2/5.3. Each device control
records full compositor precision, float-buffer input and 32-bit Raw EXR output;
it checks exact input preservation, independently of the graded result.

Legacy GPU ROUND uses `floor(x + .5)` while legacy CPU uses half-away rounding.
Legacy GPU Posterize uses multiply/floor/divide; its CPU reciprocal ordering is
preserved separately. Native GPU Inverse Square Root requires a positive normal
input on all three tested versions. Math Maximum or Absolute-plus-offset graphs
provide a meaningful proved bound; float32 cancellation is included in the proof.
Native spatial GPU Logarithm base one produces non-finite pixels, and legacy GPU
`atan2(0,0)` does too. Modern CPU-folded constants retain their distinct defined
results. The exporter/runtime refuse the undefined GPU domains, rather than
substituting a CPU safe-math value. These refusals include actual native renders.

Spatial inputs also expose loose browser GPU trigonometric intrinsics that
constant-only sweeps can hide. Fresh Math programs opt into `portable-f32-v1`;
older schema-1 programs retain their intrinsic behavior. The shared
`tslPortableTrig.ts` sine/cosine reducer is proved for inputs within ±8192 and
falls back to the prior intrinsic outside that range. Its rational π/2 parts
have exact float32 products for the supported quadrant range. Factorial series
on the reduced interval come from [NIST DLMF 4.19](https://dlmf.nist.gov/4.19),
and inverse-trig series/identities from
[NIST DLMF 4.24](https://dlmf.nist.gov/4.24). No fitted external coefficient table
is required. A two-part reduced phase and division-residual correction preserve
tangent accuracy near poles.

The trig generator compares actual native CPU/GPU pixels with independent Python
libm controls. Its main 18-case corpus per version covers central/reduced angles,
inverse endpoints and tangent pole flanks with output magnitude about 64. The
separate `pole-stress/index.json` captures adjacent float32 inputs at odd π/2
multiples. On the measured cases the browser matches native CPU stress pixels
exactly; native Metal GPU differs from CPU/libm by one float32 ULP at values around
22.88 million (absolute difference 2). Those stress cases remain outside the
strict absolute-error parity gate. No full accuracy claim is made for enormous
arguments or arbitrary tangent pole neighborhoods, and the global `2e-5` budget
is unchanged.

Native formulas can be inspected in Blender's
[CPU color functions](https://github.com/blender/blender/blob/v5.3.0/source/blender/blenlib/intern/math_color.cc),
[GPU color functions](https://github.com/blender/blender/blob/v5.3.0/source/blender/gpu/shaders/nodes/gpu_shader_common_color_utils.bsl.hh),
and [compositor channel nodes](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/shaders/library/gpu_shader_compositor_separate_combine.glsl).
Coverage of these tested families does not imply support for all compositor nodes;
see [the node translation inventory](../../docs/NODE_TRANSLATION.md).

## Hue Correct and White Point

`BLENDLINK_COMPOSITOR_HUE_CORRECT_DEVICE=GPU` and
`BLENDLINK_COMPOSITOR_WHITEPOINT_DEVICE=GPU` select the actual native GPU
compositor. Hue Correct generates 113 graphs per device on 4.2/5.2/5.3; White Point
generates 121 per device on 5.2/5.3. Blender 4.2 has no native White Point mode and
writes an explicit `not-applicable.json` with zero generated pixel references.

Hue Correct transports Blender's own 257-entry curves, native wrapping and
endpoint behavior, original-hue parameterization of all three curves, clipping
limits, raw Factor extrapolation, and CPU/GPU HSV conversion and color-band
precision. The fixture includes hue/saturation/value edits, VECTOR handles,
nonunit horizontal ranges, HDR/negative RGB and nonunit alpha. A requested
`use_clip=False` retains `True` in these native Hue Correct RNA builds; references
preserve that actual flag and do not claim a separately demonstrated false-flag
state. Modern constant images use the native CPU single-value path, while 4.2
GPU constants keep the native GPU path.

Fresh OpenGL GPU Hue Correct programs record
`hue_curve_sampling_model='opengl-normalized-f32-v1'`. This preserves Blender's
float32 reciprocal range normalization, normalized sampler scale/offset and
texture-coordinate roundtrip before interpolation. The idealized `h*256`
coordinate skips native rounding and changes steep curves. Hue division also
uses the existing split-product residual correction: native `3.5/6` differs
by one float32 ULP from multiplication by a rounded reciprocal. These details
follow the native
[4.2 Hue Correct shader](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/realtime_compositor/shaders/library/gpu_shader_compositor_hue_correct.glsl)
and [5.2 shader](https://github.com/blender/blender/blob/v5.2.0/source/blender/compositor/shaders/library/gpu_shader_compositor_hue_correct.glsl).
CPU and Metal keep their independently proven equations; older programs lacking
the new sampling field retain their prior behavior. Unknown sampling models or
an OpenGL model paired with another native backend refuse explicitly.

White Point ports Color Balance's Bradford adaptation and 31-entry Robertson
temperature/tint locus. It transports the actual OCIO scene-linear↔XYZ matrices
and refuses nonlinear, offset or noninvertible working-space transforms. The
constant matrix uses float32 XYZ directly, independently checked against native
RNA on an owned NodeTree copy, avoiding a lossy XYZ→scene→XYZ roundtrip. Unlinked
controls retain Blender's native CPU-precomputed GPU matrix optimization; linked
Value and spatial controls retain the variable GPU path. Factor has only its
native upper cap; negative RGB and input alpha are preserved.

The proven parameter domain is 1800..100000 K and tint −150..150. Each input must
have proven bounds; spatial controls can use Math Maximum and Minimum. A
piecewise analytic interval certificate also requires a nonzero Bradford source
LMS response, expanded conservatively by 2e-5 for float32 arithmetic. Potential
zero crossings and near-pole grades refuse with the artist's node/socket path.
Fixed negative LMS responses are valid and remain supported. These bounds are
an explicit supported subset, not an assertion that arbitrary native controls
outside it are defined. Dynamic mode selectors still refuse.

The native fixtures cover both unlinked and linked constant controls, each
spatial temperature/tint control, constant and spatial images, raw Factor,
negative/HDR RGB, UI domain endpoints, refusal of unknown/unsafe ranges, and
read-only authored state and image-user counts. For working-space checks, launch
Blender with `OCIO=/absolute/custom/config.ocio`, using an installed configuration
whose `scene_linear` role is changed to `Linear Rec.2020` and whose LUT search
paths are absolute. The fixture sets its generated image and EXR to the chosen
scene-linear space and restores generated pixels after changing image color
space. This adds 121 actual CPU and 121 GPU graphs with different transported
working-space matrices; it does not recolor native references to fit the runtime.

The native equations and constant/variable optimization are documented in
[Blender 5.2 Color Balance](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/composite/nodes/node_composite_color_balance.cc),
[BLI color math](https://github.com/blender/blender/blob/v5.2.0/source/blender/blenlib/intern/math_color.cc),
and [Blender 5.3 Hue Correct](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_hue_correct.cc).

The macOS native Metal checkpoint on 2026-11-12 used Blender 4.2.0
`a51f293548ad`, 5.2.0 `fbe6228777e7`, and 5.3.0 `02f0899d78e3`.
Its 654 Hue Correct and 726 White Point graphs (including 242 Rec.2020 graphs)
passed the built runtime on both browser backends: 1380 comparisons per backend,
maximum absolute channel error 1.14441e-5, with White Point alpha error exactly 0.
The existing 2e-5 budget was unchanged. These native GPU results certify Metal;
the same fixtures must pass against actual native OpenGL before claiming that
platform's parity for the new families.

The OpenGL rounding fix additionally replays 113 fresh Linux 4.2 and 113 fresh
Linux 5.2 native GPU references through the built runtime on both browser
backends, maximum channel error 1.04905e-5 at the unchanged 2e-5 budget. This is a
metadata-only replay: the explicit sampling-model field is inserted into each
retained program; removing it reproduces every original file byte-for-byte,
including its signed input and native EXR values. Per-file source/replay hashes
are recorded in `artifacts/verification-hue-ci/linux42-tagged/replay-provenance.json`
and the corresponding `linux52-tagged` file. This replay does not claim a fresh
Linux extraction with the new emitter. Fresh native CPU/Metal extraction and
pixel checks on 4.2/5.2/5.3 cover another 678 Hue Correct graphs; their emitter
assertions require the OpenGL field only on the actual OpenGL GPU path.

## Native GPU math implementations

Fresh compositor operations record `native_gpu_backend`. Metal HSL preserves
its grouped extrema sum; OpenGL retains the native left-associated subtraction.
This matters for HDR saturation close to its denominator singularity.

GPU inverse trigonometry also records a verified implementation profile.
Mesa's GLSL frontend uses different low-degree polynomials for asin and acos;
these are ported from its
[builtin definitions](https://github.com/mirror/mesa/blob/mesa-24.0.9/src/compiler/glsl/builtin_functions.cpp),
including the native float32 constants. They intentionally differ from accurate
libm inverses. CPU and verified Metal keep the accurate bounded polynomial
model. Existing driverless serialized programs retain their prior behavior.

Identification first uses supported `gpu.platform` queries and initializes that
module when required by Blender 5.2+. Blender 4.2 background mode disables these
queries: when an explicit `DISPLAY` exists, the extractor can query `glxinfo -B`
under the same driver/offload environment, with no shell, a 10-second timeout and
a cached result. Headless Linux needs `mesa-utils` for this fallback. Unknown
OpenGL implementations refuse inverse trig with a named diagnostic instead of
being assigned Mesa's numeric model. CPU folding does not require a GPU query.

Legacy GPU atan2 still requires one provably nonzero operand. GLSL leaves
atan(y,x) undefined at (0,0): actual retained Mesa output is finite 2.356191158,
while Metal produces NaN. The spatial native fixture records both outcomes and
keeps the refusal; a finite implementation artifact does not make that domain
portable. Modern native zero-origin behavior is preserved separately.

Fresh Logarithm IR opts into `math_logarithm_domain_model=nonpositive-zero-v1`
and explicitly guards nonpositive arguments before accepting its result,
so browser subnormal flushing cannot turn the prior 1e-38 threshold into a
false zero comparison and return a large logarithm for input zero. Native
reference pixels and the 2e-5 differential budget remain unchanged. Older
documents without that domain tag keep their previous evaluation.

## Static separable Blur

`compositor_blur_check.py` covers the property-based 4.2 node and the 5.2/5.3
socket schema. The supported filters are Flat (Box), Tent, Quadratic, Cubic,
Gaussian, Catrom and Mitch, with constant absolute radii from 0 through 128
pixels on each axis. Modern Gaussian also supports its Separable switch being
disabled because the native implementation still uses the separable algorithm.
The 4.2 Size multiplier clamps below zero on CPU and to [0,1] on GPU; the CPU
retains multipliers above one. The resulting pixel radii must remain within the
supported bound.

Fresh programs carry finite float32 kernel tables and a versioned accumulation
model. Legacy CPU sums the signed table from left to right, then multiplies by
its inverse sum. Modern CPU/GPU and legacy GPU normalize the symmetric half
table and accumulate center, positive tap, negative tap. Negative kernel lobes
are preserved. Both axes clamp at the image border, preserve the image extent,
and filter all four raw RGBA channels without alpha reassociation or clamping.
Full precision and final-render Automatic precision are supported. Constant
images and zero radii allocate no intermediate targets.

The native definitions are
[4.2 filter kernels](https://github.com/blender/blender/blob/v4.2.0/source/blender/render/intern/initrender.cc),
[4.2 CPU tables](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_BlurBaseOperation.cc),
[modern kernels](https://github.com/blender/blender/blob/v5.3.0/source/blender/blenlib/intern/math_filter.cc),
and [modern symmetric tables](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/cached_resources/intern/symmetric_separable_blur_weights.cc).
These coefficient textures use full float32 storage; their precision contract
is separate from GPU color-band tables.

The browser uses coefficient textures and a uniform loop bound instead of
compiling hundreds of literal reads for each radius. It owns each new RTT
target, internal quad material and coefficient texture, with idempotent
cleanup. Three 0.184's inherited RTT `dispose()` event alone does not release
those targets/materials. Borrowed render-pass textures retain caller ownership;
the shared quad geometry stays alive. Older schema1 Gaussian programs keep
their numerical path and receive the same ownership fix.

Variable/per-pixel radii, linked modern settings, nonseparable
filters, legacy Bokeh, Extend Bounds, and recursive Fast
Gaussian refuse with named diagnostics. The bounded legacy relative sizing
extension below retains the different CPU and GPU radius models. Expanded domains
and automatic viewport half precision are not claimed by this batch.
Nonfinite reconstructed tables also refuse explicitly, including subnormal
radii whose float32 reciprocal overflows; no NaN table is labeled extracted.

Generate native references with each official Blender binary and both devices:

```sh
BLENDLINK_COMPOSITOR_BLUR_DEVICE=GPU \
BLENDLINK_COMPOSITOR_BLUR_REFERENCES="$PWD/artifacts/native/blur-42-gpu" \
"$BLENDLINK_BLENDER_42" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/compositor_blur_check.py
npm run build --workspace blendlink
node experiments/native-compositor-differential/run.mjs --built --timeout-ms 1200000 \
  artifacts/native/blur-42-cpu artifacts/native/blur-42-gpu \
  artifacts/native/blur-52-cpu artifacts/native/blur-52-gpu \
  artifacts/native/blur-53-cpu artifacts/native/blur-53-gpu \
  --out artifacts/verification-compositor-blur/final-built
```

The fixture generates 162 graphs per device on 4.2 and 161 per device on 5.2/5.3
(968 total), using 13×7 float EXR images. Random signed/HDR RGBA, border/center
impulses, each kernel, zero/asymmetric/maximum radii, fractional radii or legacy
multipliers, constant images, final Automatic precision, schema1 Gaussian
compatibility, exposure→Blur and chained filters are covered. Every browser
case requires zero retained GPU textures after disposal; 18 compound cases
also require preservation of the caller's render target, MRT and clear state.
The two extra 4.2 cases check absolute-size aspect correction X and Y: their
native expected arrays must equal aspect NONE exactly before browser comparison.

The 2026-11-12 macOS checkpoint used native Blender 4.2.0 `a51f293548ad`,
5.2.0 `fbe6228777e7` and 5.3.0 `02f0899d78e3`, on CPU and Metal GPU. All 964
graphs passed the built runtime on WebGL2 and WebGPU at the unchanged 2e-5
budget: maximum channel error 3.69549e-6 and 4.76837e-6 respectively. Every
disposal check reported zero retained textures, and all 18 compound graphs
preserved caller state. The evidence is in
`artifacts/verification-compositor-blur/loop-certified-built`; actual native
OpenGL certification remains a separate platform check.

## Legacy gamma-correct Blur

The native 4.2 gamma option is transported with an explicit
`blur_gamma_model` (`legacy-cpu-square-v1` or `legacy-gpu-square-v1`). CPU
unpremultiplies only when alpha is positive, squares positive RGB and zeros
other channels, reassociates alpha, convolves RGBA, and applies the corresponding
square-root transfer. The GPU shader's component-wise negative-color handling
is preserved separately. Alpha itself receives only the filter convolution.

Identity behavior differs: 4.2 GPU returns constant images or zero-radius
images before applying gamma. CPU still applies both transfers and clips
negative color. Transfer functions load intermediate RTT pixels by integer
texel coordinate. Default linear RTT sampling can blend a neighboring positive
alpha into an exact zero by a fraction of an ULP, selecting a different native
reassociation branch. No epsilon or alpha snapping is used.

The native algorithms are the
[CPU operations](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_GammaCorrectOperation.cc)
and [GPU transfer functions](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/realtime_compositor/shaders/library/gpu_shader_compositor_blur_common.glsl).
The split product residual division already used by compositor CPU operations
preserves rounded division by positive alpha. Old programs without the gamma
model keep their existing path; unknown or mismatched models refuse before
allocating resources.

`compositor_blur_gamma_check.py` uses
`BLENDLINK_COMPOSITOR_BLUR_GAMMA_REFERENCES` and
`BLENDLINK_COMPOSITOR_BLUR_GAMMA_DEVICE`. It generates 193 actual graphs per
device on 4.2: all seven filters, constant and spatial inputs, zero/asymmetric/
maximum radii, multipliers, border impulses, signed/HDR RGB, zero/negative/tiny
alpha, and exposure→Blur. Blender 5.2 and 5.3 no longer expose this property:
the generator writes an explicit not-applicable report and zero pixel cases.

Every gamma case checks cleanup. Forty-six native cases additionally require
at most four actual quad renders and no fragment shader larger than 12000
bytes, measuring every intermediate pass through Three's shader diagnostics.
Two exposure cases per device also require caller render state preservation.
The initial source proof passed all 386 CPU/Metal graphs on both browser
backends with maximum channel error 2.38419e-6 at the unchanged 2e-5 budget;
the measured maxima were four passes and 3674 fragment bytes.
The final built checkpoint combines all 968 static/aspect graphs with these
386 gamma graphs (1354 per browser backend). Both backends passed, with
maximum channel error 3.69549e-6 on WebGL2 and 4.76837e-6 on WebGPU; gamma alone
remained at 2.38419e-6. Every texture-cleanup and caller-state check passed.
Evidence is in `artifacts/verification-compositor-blur-gamma/final-built`.

## Blur output interoperability

Fresh Blur programs record `blur_output_sampling_model='native-texel-v1'`.
Their filtered output is an integer texel load, including when a pointwise
node consumes it. Default linear RTT sampling at a rounded pixel-center UV can
move a value across a Posterize bin or an Alpha Over sign decision. Tagless
programs retain their previous RTT sampling; the older schema1 Gaussian path
also remains unchanged. Unknown output sampling models refuse before resource
allocation. Exact reads add no intermediate render pass or texture.

`compositor_blur_interop_check.py` uses
`BLENDLINK_COMPOSITOR_BLUR_INTEROP_REFERENCES` and
`BLENDLINK_COMPOSITOR_BLUR_INTEROP_DEVICE`. It generates 85 graphs per device
on each of 4.2, 5.2 and 5.3 (510 total): Tent, Gaussian and Mitch;
horizontal, vertical and two-axis radii; random signed/HDR RGBA, checker
thresholds with zero/signed alpha, and border impulses. Each Blur feeds
Posterize or premultiplied/straight Alpha Over. All graphs require caller
MRT/clear-state preservation, zero retained textures and at most three quad
renders with fragment shaders below 12000 bytes.

The prior sampling path failed 56 graphs per browser backend with channel
errors up to 0.5. The new source path passes all 510 on WebGL2 and WebGPU,
maximum error 3.57628e-7 at the unchanged 2e-5 budget. Both sets come from actual
native generations. Their float32 input/expected bits, including signed zero,
match; removing only the new sampling property recreates every baseline file
byte-for-byte. The per-file hashes and preservation contract are recorded in
`artifacts/verification-compositor-blur-interop/reference-stability.json`.
The final built checkpoint combines these with 968 fresh static/aspect and
386 gamma graphs, totaling 1864 per backend. Both passed at maximum channel
error 3.81470e-6, with the 510 interoperability graphs remaining at 3.57628e-7.
Every cleanup, caller-state and shader-cost check passed; evidence is in
`artifacts/verification-compositor-blur-interop/final-built`.

## Gaussian kernel precision

Gaussian tables now record `blur_gaussian_math='native-c-f32-v1'` and use the
process's scalar C `expf` and `sqrtf`, as Blender's filter implementation does.
NumPy's platform-dependent float32 transcendental path can produce a different
coefficient ULP. Gamma correction amplifies that error near zero filtered alpha;
the retained Linux 4.2 impulse/radius128 case exposed a 1.46988e-4 RGB error.
The existing numeric budget is unchanged. Missing native scalar functions
produce a named refusal; the exporter never silently substitutes approximate
coefficients. POSIX uses process symbols or system libm, and Windows can use
the system UCRT. Function handles are cached; no package dependency is added.

`compositor_blur_kernel_check.py` uses
`BLENDLINK_COMPOSITOR_BLUR_KERNEL_REFERENCES` and
`BLENDLINK_COMPOSITOR_BLUR_KERNEL_DEVICE`. Six native graphs per device on each
version test radii 0, 1, 2, 2.25, 7 and 128 using 257×4 impulse images. The
native fixture compares exported coefficients against the rendered native
float32 bits before accepting a reference. Browser calibration and output
also compare every float32 word, with zero mismatches required. The fixture
additionally verifies that unavailable C math functions refuse extraction.
All 36 actual native CPU/Metal graphs pass WebGL2 and WebGPU bit-for-bit.

The unchanged Linux reference reproduces its original failure on both macOS
browser backends. Substituting scalar-C-derived tables makes that specific
reference exact. All 880 retained Linux Blur, gamma and interoperability graphs
also pass with regenerated tables: maximum channel errors 6.85453e-7 on WebGL2
and 9.53674e-7 on WebGPU. This is a coefficient-regeneration replay, not a fresh
Linux extraction: only Gaussian weight arrays and their precision marker are
changed. Native input/expected text and float32 bits remain unchanged. Full
per-file provenance is retained in
`artifacts/verification-blur-gamma-linux42/retained-c-tables/replay-provenance.json`;
the actual Linux scalar-library path is certified by the next native kernel gate.
The final built checkpoint combines the 880 retained references with the 36
native kernel graphs; all 916 pass on both browser backends at the same maxima,
with every kernel word exact and every cleanup/state/shader-cost check passing.
Evidence is in `artifacts/verification-blur-gamma-linux42/final-built`.

## Legacy relative Blur

`compositor_blur_relative_check.py` covers the actual 4.2 property-based relative
settings for Flat, Tent, Quadratic, Cubic, Catrom and Mitch. Percentages, X/Y
aspect correction and a constant Size multiplier remain live with respect to
the input image extent. CPU uses float32 `percent * .01 * extent`, rounds with
`floorf(value + .5f)`, then multiplies Size. GPU uses
`extent * (percent / 100) * clamp(Size,0,1)` and retains fractional radii.
The exported graph carries this versioned model rather than a radius frozen
from Blender's render settings. See the native
[CPU radius calculation](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_BlurBaseOperation.cc)
and [GPU radius calculation](https://github.com/blender/blender/blob/v4.2.0/source/blender/nodes/composite/nodes/node_composite_blur.cc).

The live domain remains 0–128 pixels per axis. Both new coefficient tables are
computed and checked before an update is applied. Out-of-bound or nonfinite
radii produce a named artist-node diagnostic, preserve caller state, and recover
when the image returns to a supported extent. Relative Gaussian remains a
named refusal: the scalar native C `expf` used by static kernels is unavailable
to a browser resize callback, and JavaScript `Math.exp` is not assumed equivalent.
5.2/5.3 no longer expose these legacy settings and this fixture reports explicit
not-applicable status with 0 cases there. Modern linked/per-pixel sizing is a
separate unclaimed model.

Guaranteed identities (both percentages zero or a constant zero Size) allocate
no convolution targets; CPU gamma still applies its native pointwise transfer.
Two fixed-size coefficient textures and uniform loop counts otherwise retain one shader
structure across resizes, including zero-to-nonzero CPU radii. Unchanged tables
are not reuploaded. Physical texture extents and recognized render-pass/RTT
extents are followed through texture clones and relative Blur cascades; gamma's
temporary image follows the same domain. Ordinary pointwise expressions are
materialized at the renderer's physical drawing-buffer extent, as with the
existing compositor RTT pipeline. This does not add a general Blender image
domain/transform engine. Each owned RTT restores target/MRT/clear/viewport/scissor
state in `finally`, including failed renders, and disposes its target/material
and coefficient textures without taking ownership of borrowed source textures.

```sh
BLENDLINK_COMPOSITOR_BLUR_RELATIVE_DEVICE=CPU \
BLENDLINK_COMPOSITOR_BLUR_RELATIVE_REFERENCES="$PWD/artifacts/native/relative-cpu" \
"$BLENDLINK_BLENDER_42" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/compositor_blur_relative_check.py
# Repeat with DEVICE=GPU and a separate output directory.
npm run build --workspace blendlink
node experiments/native-compositor-differential/run.mjs --built \
  artifacts/native/relative-cpu artifacts/native/relative-gpu \
  --out artifacts/verification-compositor-relative-blur/final-built
```

Per device the fixture performs 324 native graph renders and adds 9 grouped
same-compiled-graph browser sequences (333 manifest rows). The sequences change
13×7→31×9→7×13→4×4, repeat an unchanged frame, exercise pixel ratio 2, reject a
synthetic 2200×16 (or 16×600 for the identity cascade) frame outside the supported
radius, then recover to 13×7. The
rejected frame has `nativeOracle:false`; it supplies no native pixel claim.
The native in-bound controls include 12 entire Float32-word kernel comparisons,
fractional and rounding-boundary radii, negative/HDR RGBA and zero/signed alpha,
gamma, Exposure inputs, Posterize/Alpha Over consumers, and absolute/relative
filter cascades. Shader/pass budgets and zero retained GPU textures are required;
the gamma→Blur cascade accounts for its seven actual render passes.

The macOS checkpoint used native Blender 4.2.0 `a51f293548ad` on CPU and Metal
GPU. All 666 rows passed the built-package guard and both browser backends with
maximum absolute error `1.1920928955078125e-6`. All 24 kernel word controls were
exact; all 18 live compiled sequences passed, including repeated-table upload
checks, HiDPI, rejected sizes and recovery. The separate source-mode live check
also passed all 18 sequences (maximum `4.76837158203125e-7`). The matched native
CPU/GPU Tent canary differs by `.1120211482`, establishing the device-specific
radius behavior. These are native Metal results, not a claim of Linux OpenGL
certification; the hosted gate must generate and test that backend separately.
Evidence is in `artifacts/verification-compositor-relative-blur/optimized-final-built`.

## Compatibility checkpoint: deferred integer image translations

`compositor_transform_check.py` tests an earned subset of native Translate and
Transform on the 4.2 property schema and the 5.2/5.3 menu-socket schemas. The original v1
model supports absolute integer X/Y offsets from −8192 through 8192, Nearest
interpolation and Clip extension. Transform additionally requires Angle=0 and
Scale=1. Relative/wrapped coordinates, fractional offsets, other interpolation,
rotation/scale, active render-border/crop windows, differing-origin merges and unequal source/render image windows
were named refusals in that checkpoint. The v2 extension below earns Bilinear,
fractional offsets and selected cross-domain branches. Rotate and Scale nodes
remain separate work.

Transforms carry a separate finite image origin through the compiled graph.
Pointwise expressions and neighborhood filters operate on the original pixel
window; the translated origin is realized only at the compositor output. This
preserves off-canvas pixels through inverse translations and Blur/Flip/Posterize
consumers, rather than cropping after every Translate. Constants have no finite
window. This v1 format only merges equal-origin branches; it still refuses
unequal origins during runtime validation. Fresh v2 exports below provide a
qualified native-priority domain realization model. Origin composition is also bounded to ±8192 pixels.

The native contracts come from
[4.2 TranslateCanvasOperation](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_TranslateOperation.cc),
[modern TranslateOperation](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_translate.cc),
[Domain::transform](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/intern/domain.cc)
and [native domain realization](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/intern/realize_on_domain_operation.cc).
This first window model requires each participating image source to match the
renderer's physical compositing extent. It verifies this on every render and
restores renderer target/MRT/clear/viewport/scissor state even on a refusal.
Final realization owns its RTT target and quad material and borrows source
textures. Sampling clamps the inactive texture load before selecting transparent
black outside the window, avoiding undefined out-of-range GLSL texel fetches.

`buildSourceCompositor` also accepts an optional `resolvePassExtent` provider.
The actual post pipeline supplies its known full-frame physical extent for
TRAA/Bloom-style field results that have no raw texture dimensions. Direct
texture callers retain inferred extents. This is explicit renderer/domain
metadata, not an assumption that arbitrary field expressions expose texture
storage. Full data/display-window transport and rotated/scaled intermediate
bounding boxes remain separate work.

The fixture selects an EEVEE scene context on each native version while
independently selecting CPU or GPU compositing. Injected scene-linear float Image
data isolates the compositor contract and can let Blender omit scene rendering;
these pixel checks do not certify EEVEE scene-renderer pixels. It includes strict
Float32 copies, signed/HDR RGBA and zero/negative alpha, entire-image off-canvas
inverse translations, pointwise and Blur/Flip consumers, constant and
same-origin Alpha Over branches, explicit full-frame field providers, and reused
graphs through resize, changed pixels at unchanged dimensions, HiDPI, an
unsupported extent and recovery. Unsupported-extent frames are error-only
controls (`nativeOracle:false`), not native pixel claims.

```sh
BLENDLINK_COMPOSITOR_TRANSFORM_DEVICE=CPU \
BLENDLINK_COMPOSITOR_TRANSFORM_REFERENCES="$PWD/artifacts/native/transform-42-cpu" \
"$BLENDLINK_BLENDER_42" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/compositor_transform_check.py
# Repeat for GPU and Blender 5.2/5.3 into separate reference directories.
npm run build --workspace blendlink
node experiments/native-compositor-differential/run.mjs --built \
  artifacts/native/transform-42-cpu artifacts/native/transform-42-gpu \
  artifacts/native/transform-52-cpu artifacts/native/transform-52-gpu \
  artifacts/native/transform-53-cpu artifacts/native/transform-53-gpu \
  --out artifacts/verification-compositor-transforms/final-built
```

The macOS checkpoint used native Blender 4.2.0 `a51f293548ad`, 5.2.0
`fbe6228777e7` and 5.3.0 `02f0899d78e3`, each with an EEVEE-selected scene context and
CPU/Metal compositing. All 372 built-package rows passed on WebGL2 and WebGPU
(maximum absolute error `4.76837158203125e-7`), including 138 exact Float32-word
copy checks and 24 live compiled sequences. Shader validation and retained GPU
texture counts were zero. Maximum measured cost was five passes, with fragment
sources at most 3674 bytes (GLSL) or 2262 bytes (WGSL). The final native corpus
also verifies read-only render-border refusal; adding that guard left supported
input/expected Float32 words and programs unchanged. Evidence is retained in
`artifacts/verification-compositor-transforms/reviewed-final-built`. Linux OpenGL
requires its own fresh native generation and replay before certification.


## Native fractional translation and default interpolation

Fresh exports use `native-translation-v2`; old integer-v1 documents retain their
previous behavior. Translate supports fixed absolute X/Y in ±8192 pixels,
Nearest or Bilinear sampling, and Clip on both axes. Transform uses the same
translation path with Angle=0 and Scale=1, subject to the legacy CPU qualification
below. Dynamic offsets/menus, relative/wrapped coordinates, Bicubic/Anisotropic,
rotation/scale, active render borders and unequal source/render windows remain
named refusals. New fractional/filtered GPU exports currently require the proved
Metal sampler; an uncalibrated OpenGL backend refuses instead of adopting Metal
precision. Previously supported integer Nearest behavior remains portable.

Modern Blender carries a Float32 origin and realization options through the
finite field. Consecutive transforms compose that origin before sampling;
pointwise/Blur/Flip consumers preserve the raw pixel domain. Alpha Over chooses
its native domain in background→foreground→factor order. Its other Color fields
are realized on that chosen domain before compositing. Equal-origin inputs
share their pixels and retain the selected domain's sampling options. Other consumers with unequal origins and
cross-domain scalar/vector/integer fields remain explicitly unqualified.
Constants have no finite image domain.

Blender 4.2 CPU differs: it resamples each Translate immediately and truncates its
canvas displacement. Nearest first rounds displacement away from zero. Modern
Nearest instead applies Blender's corrective matrix translation before its
normalized-coordinate floor; 4.2 Metal has its separate unbiased sampler path.
Those distinctions include native ±.5, ±.4999 and ±.5001 controls. CPU Bilinear
preserves native rounded coordinate operations, pairwise Float32 products, and
independent `floor(float32(u+1))` neighbor indices, which can differ from
`floor(u)+1` near a boundary.

A legacy CPU limitation is deliberately closed: Bilinear cannot currently consume
an already shifted finite canvas, and nonidentity legacy Transform Bilinear is
refused. Native 4.2 partially computes intermediate buffers through areas of
interest; those compositions produced different boundary pixels and an unchanged
Transform graph produced non-finite pixels on one run. The implementation does
not fit those uncomputed buffer values. The fixture records 68 explicit native
mode refusals on 4.2 CPU while testing its supported direct Translate, Nearest,
constant and unshifted Bilinear paths. Integer-v1 Nearest compatibility remains.
Full native area-of-interest/data-window transport is required to widen this
qualification.

The new realization boundary materializes raw inputs before remapping and returns
an `Fn` producer, so another `.load()` cannot discard an upstream spatial mapping.
Two fixed 256×32 Float32 lookup textures hold per-axis indices, fractions and
legacy finite-window masks. Their contents change only when physical dimensions
change; shader structure is independent of dimensions. The live resampling extent
is 1…8192 pixels per axis. Both axes and every source/render extent are checked
before mutating resources, and invalid extents recover on a later valid render.
RTT/lookup ownership is idempotent, borrowed source textures remain alive, and
renderer target/MRT/clear/viewport/scissor state is restored in `finally`.

Raw FULL RGBA32F compositor sampling was calibrated independently of Image Texture
or half-float/color-band sampling. The proved Metal coordinate model quantizes
the normalized texel position to 8 fractional bits **before** subtracting .5.
Independent fixed-function interpolation probes also found nearest-away Float32
output midpoint ties. Software four-tap interpolation retains small final
Float32 rounding differences; this is not a bit-exact Bilinear claim. The signed
HDR reference corpus includes RGB scaled by 64 and leaves the existing 2e-5 error
budget unchanged. Nearest copies and source calibration compare Float32 words.

Primary contracts:
[modern result sampling](https://github.com/blender/blender/blob/02f0899d78e3/source/blender/compositor/COM_result.hh),
[modern realization/matrix bias](https://github.com/blender/blender/blob/02f0899d78e3/source/blender/compositor/intern/realize_on_domain_operation.cc),
[native CPU interpolation](https://github.com/blender/blender/blob/02f0899d78e3/source/blender/blenlib/BLI_math_interp.hh),
[legacy Translate](https://github.com/blender/blender/blob/a51f293548ad/source/blender/compositor/operations/COM_TranslateOperation.cc),
[legacy full-frame areas/buffer normalization](https://github.com/blender/blender/blob/a51f293548ad/source/blender/compositor/intern/COM_FullFrameExecutionModel.cc),
and [legacy GPU realization](https://github.com/blender/blender/blob/a51f293548ad/source/blender/compositor/realtime_compositor/algorithms/intern/realize_on_domain.cc).

```sh
BLENDLINK_COMPOSITOR_RESAMPLE_DEVICE=CPU \
BLENDLINK_COMPOSITOR_RESAMPLE_REFERENCES="$PWD/artifacts/native/resample-42-cpu" \
"$BLENDLINK_BLENDER_42" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/compositor_resample_check.py
# Repeat for GPU and Blender 5.2/5.3 into separate directories.
# Uncalibrated GPU samplers emit NOT_APPLICABLE + a reason JSON, not pixel success.
npm run build --workspace blendlink
node experiments/native-compositor-differential/run.mjs --built \
  artifacts/native/resample-42-cpu artifacts/native/resample-42-gpu \
  artifacts/native/resample-52-cpu artifacts/native/resample-52-gpu \
  artifacts/native/resample-53-cpu artifacts/native/resample-53-gpu \
  --timeout-ms 1200000 --out artifacts/verification-compositor-resample/final-built
```

The oracle opts out of node thumbnails through the shared helper's default-
preserving `node_previews=False` option. Actual 4.2 Metal Image thumbnails abort
when their 128-pixel aspect-preserving preview would have zero height (for
example 8192×32); disabling those previews renders the same compositor output.
That fixture setting does not change Blendlink runtime behavior or native graph
sampling. Physical extent controls still include 1920 and 8192-wide images.

Checkpoint counts and final built results are recorded with the retained
`qualified-final-built` provenance/results. Native versions are 4.2.0
`a51f293548ad`, 5.2.0 `fbe6228777e7`, and 5.3.0 `02f0899d78e3`, independently
selecting CPU and Metal compositing. The renderer backend is asserted on every
run; fallback and shader validation failures remain fatal. Unsupported-window
resize frames are explicit error-only controls (`nativeOracle:false`), with no
invented native pixels.

`resampling-gpu-probe.py` is an independent public `gpu` compute control. Set
`BLENDLINK_RESAMPLE_GPU_COORDINATES=/absolute/output.json` and run it with the
same Blender command. A tiny EEVEE-selected GPU-compositor render creates the
background GPU context before `GPUShaderCreateInfo`, `gpu.compute.dispatch` and
`GPUTexture.read`. It records division/reciprocal coordinates separately from the
port; its fourth algebraically cancellable channel is explicitly not a sampler
readback. This probe is not a substitute for the actual native graphs above.

The qualified macOS built checkpoint contains 1372 new rows (172 for 4.2 CPU,
240 for each other version/device) plus all 372 original integer-v1 rows.
All 1744 rows passed on each browser backend, maximum absolute error
`7.62939453125e-6`. There are 426 strict Float32-word copy rows and 42 reused
compiled resize sequences per backend, including 42 explicit rejected-window
frames. Measured cost is at most 6 passes and 12567-byte GLSL/10106-byte WGSL
fragments. Shader errors, page/console errors and retained GPU textures are zero;
the whole-production-module build guard and immutable runtime snapshot report no
workspace changes during the run.

A second complete native generation reproduced every one of the 1372 qualified
JSON rows byte-for-byte (`native-repeat-stability.json`). Matched CPU/GPU input
controls retain identical Float32 words, while the same Bilinear graph has
measurably different native device pixels (`matched-device-canaries.json`),
providing a fallback canary independent of the emitted device marker.


### Legacy CPU constant Transform qualification

Fresh extraction refuses a legacy CPU `CompositorNodeTransform` whose Image is
single-valued, whether linked or supplied as a default. The same 4.2 constant
Transform produced transparent black in a retained Linux reference and the
authored color on macOS. Sixteen macOS context controls (EEVEE/Cycles,
thumbnails enabled/disabled, warm/cold evaluation, unused Image present/absent)
did not establish a portable oracle-context fix. The native node lowers to
Scale→Rotate→Translate, whose CPU canvas processing differs from Translate's
explicit single-element shortcut. No black/color result is substituted for the
other host's captured pixels.

This is a fresh-source qualification only: the integer-v1 runtime remains
unchanged. Finite-image Transform, constant Translate, modern Transform and GPU
Transform retain their existing contracts. The integer fixture now emits 61
positive rows and 9 read-only, artist-named constant-input refusals for 4.2 CPU;
the other five version/device corpora still emit 62 positive rows.

`legacy-constant-transform-probe.py` reproduces the independent context controls.
Set `BLENDLINK_TRANSFORM_CONSTANT_PROBE=/absolute/output-directory`, optionally
`BLENDLINK_TRANSFORM_CONSTANT_INPUT=/absolute/retained-reference.json`, and run
with the normal background Blender command. The optional retained input is read
unchanged and its SHA256 is recorded. Probe output characterizes native behavior;
it does not authorize the refused fresh-source mode.

Image-only EEVEE oracle sampling is an explicit fixture option:
`NativeCompositorReference(..., image_only_scene=True)`. Initially Color Spill,
Luminance Key and Difference Key opt in. After the placeholder Render Layers
Image is replaced with the independent float image, the helper checks root
and nested trees for remaining linked render passes or implicit scene-result
readers. Qualified renders temporarily use EEVEE TAA 1; a `finally` restores
the authored sample count, including when rendering raises. The engine,
compositor CPU/GPU device, FULL precision and native node graph stay intact.
Unrelated fixtures retain their current sample counts. Render settings and
elapsed time are retained separately in `render-profile.json`, leaving native
case JSON unchanged.

The initial retained-baseline comparison covers 792 complete native case JSON
files across the three families, Blender 4.2/5.2/5.3 and CPU/GPU. Every file,
including the source program, independent image input and native output,
matched byte for byte. The 41 retained Linux 5.2 CPU Luminance Key input/output
Float32 arrays also matched the Mac candidate exactly; their IR preserves its
correct OPENGL/Metal annotation. That cross-platform agreement is separate
from running the optimized fixture on Linux.

Use `compare-oracle-sampling.py --baseline /retained/family --candidate
/new/family --report /evidence/identity.json` to require complete case identity,
EEVEE, the intended compositor device/precision and exact sample restoration.
`compositor_reference_render_check.py` tests opt-in behavior, remaining root
and nested render passes, Cycles preservation and exception restoration.

For an independent timing/output control, run Blender with
`--background --factory-startup --python-exit-code 1 --python
experiments/native-compositor-differential/probe-oracle-sampling.py --
--evidence /evidence/sampling --device CPU` (or GPU). It alternates six pairs
of 64/1-sample renders, requires identical input/program/output, and excludes
the first pair from timing. On the measured Mac Blender 5.2 Metal profile,
median CPU-case render time changed from 0.195s to 0.0233s and GPU-case time
from 0.108s to 0.0208s. These local timings do not establish Linux speedups.

Difference Key's fresh `native-difference-key-rne-v1` model qualifies the exact
recorded Blender 5.2 Linux x86-64 llvmpipe context: native build
`fbe6228777e7`, LLVM 20.1.2/256-bit renderer, Mesa 25.2.8 driver
`4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4`, SOFTWARE device and requested
and actual OPENGL backends. The source captures all eleven native profile
fields; Python and TypeScript independently check every field. It uses the
existing bounded two-sum corrected mean. The old `native-difference-key-v1`
keeps its serialized arithmetic, including its GPU branch and Metal results.
Older runtimes reject the new tag. The actual reported profile was retained
by hosted run 43334775635, artifact 13995933757.

The distinction matters at strict HDR-alpha boundaries: with RGB f32(.2),
input alpha 2 and tolerance/falloff f32(.1), the retained native Metal image
alpha is 4, while the measured llvmpipe image alpha is 2. Retained-data replay
of the new model is a diagnostic metadata overlay: original image inputs and
native pixels remain unchanged. It is separate from fresh source emission.
The positive fixture asserts the new tag/profile on every Difference op
before saving matching OpenGL references. CPU/Metal assert the original tag.
Fresh-source qualification requires that actual fixture and numerical gate;
an overlay is not evidence that the new producer emitted a document.

Fresh unmeasured GPU/OPENGL requests take the exact source-bake refusal:
`Difference Key GPU OpenGL source precision profile is unverified; use source
baking`. GPU API initialization is attempted when available; failure leaves
unknown fields and cannot grant the model. Other renderer/driver/native-build
profiles require their own proof.

The Difference fixture declares an unmeasured profile using
`qualification.json` with status `source-profile-refused`, protocol
`blendlink-difference-gpu-source-profile-v1`, cases=0, controlCases=1 and
numericalDifferenceCases=0. Its index contains only the independent control.
Two separate Image/Matte records carry basename-only filenames and SHA256
hashes. Each file retains the unsupported program, exact named diagnostics,
source fingerprint/preservation assertion, requested compositor device,
native GPU profile, dimensions and actual float input/output pixels. The
`SOURCE_PROFILE_REFUSED` marker cannot be counted as a completed numerical
Difference family. Default CPU and qualified profiles retain the numerical
`PASSED` marker.

`probe-difference-refusal-protocol.py` tests that protocol with an explicitly
injected unmeasured context over real RNA and native rendering. It asserts
both hashes/outputs, source restoration and zero numerical Difference cases.
It is a routing/error-path simulation, not native Linux fidelity evidence.
Set `BLENDLINK_DIFFERENCE_PROTOCOL_EVIDENCE` to retain it. The actual native
unmeasured-profile fixture remains the source of hosted refusal evidence.

The fresh qualified OpenGL GPU corpus also adds two asymmetric HDR-alpha
cases (Image/Matte) after the original 39 authored graphs. A deterministic
NumPy Float32 search selects sixteen distinct permuted triples near sum 0.6;
ordered-left and ordered-right addition produce different means on opposite
sides of f32(.1+.1). Eight triples straddle in each direction. A separate
owned float image supplies those exact RGB words with alpha 2/key 0. Native
Blender computes all expected pixels; the independent arithmetic only selects
inputs. `association-inputs.json` retains the seed, triples, sum/mean words
and predicted association directions. This supplement tests native dot3
association, independently from whether /3 is correctly rounded. The original
39 node graphs and input arrays are unchanged. Other CPU/Metal profiles keep
their original 39-case corpus.

Fixture source fingerprints capture actual input and output defaults,
including sequence RGBA values and Value-node outputs. ID defaults use type
and name. Both extraction and the native-refusal render restore that full
source fingerprint; the routing test explicitly changes key RGBA/Value
output defaults to verify that either mutation is detected.
