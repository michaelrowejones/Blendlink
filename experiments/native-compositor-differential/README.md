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
compositor group API. They use Cycles CPU for the scene render, disable view
processing of the EXR, and select full compositor precision where available.
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

Relative sizing, variable/per-pixel radii, linked modern settings, nonseparable
filters, legacy Bokeh, Extend Bounds, and recursive Fast
Gaussian refuse with named diagnostics. Relative radii need a resize-aware
image-domain model: native 4.2 CPU rounds the percentage-derived radius before
the Size multiplier while GPU retains the fractional radius. Expanded domains
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
