# Native Noise fractal parity

This proof creates actual Blender material graphs and compares native Cycles CPU
and EEVEE pixels with their exported live TSL programs on WebGPU and the WebGL2
backend of WebGPURenderer. The browser material is not baked.

```sh
BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_NOISE_EVIDENCE=artifacts/verification-noise \
node experiments/noise-fractal-differential/run.mjs

BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_NOISE_VARYING=1 \
BLENDLINK_NOISE_EVIDENCE=artifacts/verification-varying \
node experiments/noise-fractal-differential/run.mjs

BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_NOISE_TYPES='["MULTIFRACTAL","HETERO_TERRAIN","HYBRID_MULTIFRACTAL","RIDGED_MULTIFRACTAL"]' \
BLENDLINK_NOISE_EVIDENCE=artifacts/verification-fractals \
node experiments/noise-fractal-differential/run.mjs
```

`BLENDLINK_NOISE_TYPES` defaults to `["FBM"]`, which runs the signed FBM corpus.
`--built` independently emits the whole TypeScript program, checks every emitted
module including dependency-inlined constants, and freezes the checked bytes.
`--reuse-reference` replays existing native references. Reports retain runtime
and native helper hashes, source snapshots, native version/device, errors,
failures, elapsed time and per-case render/readback time. Vite HMR/file watching
is disabled. `BLENDLINK_TEST_CHROMIUM_ARGS` accepts a JSON array of browser flags.
The full software-renderer corpus is deliberately substantial; shards or
per-family timeouts should account for high-octave 4D Color compilation.

The new `noise_fractal` opcode represents signed FBM and the four other native
recurrences. Older runtimes refuse that opcode, and raw-only runtimes refuse
unrecognized type selectors. Legacy `noise` documents retain their previous
normalized interpretation. Both Color and Factor work in all four dimensions;
4D scales Vector and W together. Shader Color has no separate Alpha output.
The separate `noise_varying` opcode carries a live Roughness child; older
runtimes refuse that capability instead of dropping the child expression.

| Family | Live bounded domain |
| --- | --- |
| Signed FBM | Static Detail 0..6, Roughness 0..1, abs(Lacunarity)<=2, abs(Distortion)<=1, effective scale<=80 |
| Multifractal, Hetero Terrain, Hybrid Multifractal, Ridged Multifractal | Static Detail 0..2, Roughness 0..1, abs(Lacunarity)<=2, abs(Distortion)<=1, effective scale<=80; abs(Offset)<=1 and abs(Gain)<=2 where active |
| Varying Roughness, normalized/signed FBM and all four other modes | Actual scalar child independently proved in 0..1 by emitter and runtime; fixed Detail<=2, all other controls in the finite static domains above |

Negative Detail and Roughness follow native Noise Texture zero clamping. Linked
Roughness above 1 refuses because native Noise has no upper clamp. Supported
constant plumbing may fold static inputs. Varying Roughness requires the
executable child range to be proved; author a Clamp for unknown ranges. An RGB
vector or serialized range/amplitude annotation cannot grant scalar admission.
Other genuinely varying controls retain named refusals. Inactive Offset/Gain and the non-FBM Normalize switch do not
change an unrelated formula. Frequency approximation bands measured for legacy
normalized FBM are not granted to these new recurrences.

Frequency and amplitude admission are separate. A conservative signed-octave
bound 3 follows from the native gradients/scales and convex fade interpolation.
The bounded domains give worst absolute amplitudes 64 (Multifractal), 100 (Hetero
Terrain), 12 (Hybrid) and 48 (Ridged). Python and the runtime derive these bounds
independently; an IR `amplitudeBound` annotation cannot grant a larger domain.
Nonfinite, unknown and unproved controls refuse before building a live program.
This is partial parameter-domain support, not every possible native Noise input.

Native recurrence details matter. The four non-FBM modes update coordinates at
each octave; FBM updates a frequency multiplier. Hybrid stops at a strict
`weight > 0.001` and caps contributing weights at 1. Ridged ignores fractional
Detail. The Hybrid primitive runs in named shader functions so conditional TSL
expressions cannot reuse an inline primitive temporary in the wrong scope.
Focused varying 2D/3D regressions caught that code-generation failure.

Offset precision also depends on native evaluation. Modern MF-eligible literal
graphs use float-staged uint/hash conversion, multiplication and addition. The
4D path uses separate float operations too. Legacy Cycles CPU on Linux x64 and
EEVEE OpenGL with llvmpipe on Linux x64 also use the staged offset profile. Metal/ARM shader graphs
and modern Cycles shader-stage graphs retain their measured folded offsets.
Concrete offsets and evaluation models ship in the IR;
image/object inputs remain shader-stage even when spatially uniform. New raw
loops reproduce float32 amplitude/frequency updates. Named 1D/4D Perlin functions
avoid repeating their integer-hash body for each lane and octave.

The signed FBM corpus has 334 graphs. The four-mode corpus has 458: every mode,
dimension, output and literal/image stage; parameter signs, zero and nonbinary
lacunarity, fractional detail, distortion, scale endpoints, ignored Normalize,
and amplified residual controls. Hybrid cutoff tests use exact float neighbors
below/equal/above 0.001, subtract the initial offset and amplify 2048x. Native
Ridged Detail 1 and 1.75 pairs must be byte-identical. These are boundary tests,
not additional supported domains.

Nearest-sampled image inputs are exactly half-representable. Signed/HDR fields
pass through an authored positive affine transform because native Emission/bake
output cannot carry negatives. The transform's power-of-two scale follows the
amplitude bound; it is part of both actual graphs. EEVEE residual controls first
record a coarse target, subtract that exactly half-representable baseline, and
amplify the residual. This exposes kernel errors hidden by the final half target.
The original error budget stays unchanged. Reports include derived raw errors
rather than presenting mapped error as an unscaled HDR accuracy claim.

The mapped maximum absolute budget is 2e-5. EEVEE adds one independently verified
final-target half ULP; node arithmetic is modeled separately. No UV rasterization
or generic intrinsic allowance is added. Local native EEVEE evidence uses Metal;
hosted software OpenGL is a separate check. Legacy WebGLRenderer cannot consume
live TSL programs.

The signed FBM batch passed all 334 graphs on each Blender 4.2/5.2/5.3 and both
browser backends. A fresh 5.3 built-package run passed the same 334 after its
whole-program guard checked 102 modules. Cycles mapped maximum 9.358e-6; ordinary
signed-FBM scale is 1/16 and the report records the corresponding raw error.

The separate four-mode batch passed all 458 graphs on each Blender 4.2/5.2/5.3
and both browser backends. Cycles mapped maximum was 3.695488e-6 and the largest
derived raw error was 1.907349e-4. The 32 EEVEE residual controls reached a
derived raw maximum of 9.768009e-4 under the independently verified final-target
precision allowance. Reports record both values and the authored oracle scale.
These source runs used immutable 103-module snapshots; all recorded workspace
hashes remained stable. A fresh Blender 5.3 built-package repeat passed all 458
graphs on both backends after the whole-program guard checked 103 modules.
With four software-browser jobs running concurrently,
they took 1,164–1,190 seconds each. Per-case times include building the graph,
first render and readback; higher-detail recurrence support needs a separate
performance and amplitude-domain proof.

Linux offset calibration replays all 334 retained native Blender 4.2 graphs on
both browser backends with the same budgets and unchanged native pixels.
Every one of the 1,800 reconstructed offset components matches the production
helper for the recorded source profile. All 668 rows pass; Cycles mapped maximum
is 4.410744e-6. The original high-octave 3D color failure drops from 1.429319e-4
to 1.192093e-7. This fixes source arithmetic rather than granting a phase-error
allowance. OpenGL evidence here uses the hosted llvmpipe software renderer;
hardware identification comes from the read-only native GPU platform query,
and an unavailable or unmeasured renderer does not acquire this new profile. Source-profile
selection and actual graph emission also pass native 4.2/5.2/5.3 admission tests.
The corrected profile also passes all 334 retained native Blender 5.2 graphs on
both browser backends: 668 rows, Cycles mapped maximum 9.298325e-6. This confirms
the version split: modern Cycles shader-stage inputs retain folded offsets,
while its MF constants use staged offsets. Windows and unmeasured host profiles
keep their previous folded behavior.

The 4D Perlin kernel batches its sixteen lattice hashes into four unsigned
vector groups. Scalar gradients, corner order and floating interpolation stay
the same; WGSL shift operands explicitly match the vector width. A focused
software-renderer case (4D Factor, Detail 6, Roughness 1, Scale 40) retained
byte-identical pixels while reducing shader source from 48.7 KB to 28.2 KB,
GPU compilation wait from 5.63 s to 2.90 s, and first render/readback from
7.40 s to 4.70 s. The existing parameter domain stays the same.

All 88 retained native 4D cases pass on each Blender 4.2/5.2/5.3 and both browser
backends: 528 rows with no failures. These include both outputs and input
stages, all ten parameter variants and amplified GPU residuals. The 5.3 repeat
uses the built package after its whole-program guard checked 105 modules.

Hybrid feedback uses explicit local shader variables for each signal, value
and weight. This keeps the native strict cutoff and arithmetic while avoiding
duplicated conditional expression paths. The hosted failing literal/distorted
case retains byte-identical pixels in a focused comparison, reduces shader
source from 27.0 KB to 15.0 KB, compilation wait from 5.13 s to 0.73 s and first
render/readback from 6.62 s to 0.84 s on the software renderer.

All 126 retained Hybrid graphs pass on each Blender 4.2/5.2/5.3 and both browser
backends: 756 rows, including all dimensions/outputs/stages, parameter variants,
amplified residuals and strict cutoff neighbors. Cycles mapped maximum remains
3.695488e-6. The 5.3 proof uses the built package with 105 whole-program-checked
modules. No error budget or parameter range changes accompany this optimization.

The varying-Roughness corpus has 458 separate graphs and passes on each native
Blender 4.2/5.2/5.3 and both browser backends: 2,748 rows with no failures.
It covers all six mode/normalization selections, all dimensions/outputs,
literal MF-eligible versus shader-stage Roughness sources, fractional/negative
Detail, coordinate/source stage combinations, 48 amplified GPU residual fields,
and Hybrid/Ridged boundaries. Controls use authored unit Clamps around exact
half-representable image values and opaque constant Noise functions. Cycles
mapped maximum is 7.390976e-6; derived raw maximum is 1.983643e-4. The 5.3 built
repeat checks 104 modules against the complete source program. Native admission,
vocabulary, and isolated package-qualified imports also pass. Reference indexes
retain the source platform, architecture and native GPU renderer string.

Raw/fractal 2D noise now uses a native Perlin primitive with explicit float32
fade stages. Physical Apple Metal contracts the ordinary MaterialX polynomial;
an existing 16x EEVEE residual exposed a 2.68e-5 amplified arithmetic difference.
The finite-float bit dependency preserves the intermediate rounding while
retaining the same polynomial, hashes, gradients, interpolation and domain.
Legacy normalized `noise` documents keep their previous primitive.

The failing retained Linux 5.2 OpenGL reference had a native half result
0.5869140625. Physical Metal previously produced 0.5874252915; the corrected
primitive produces 0.5873975158. The complete case maximum decreases from
0.0005112290 to 0.0004913807, below the unchanged half-ULP plus 2e-5 budget
0.00050828125. The first render/readback remains about 134 ms on this device.

All 128 retained 2D raw-FBM/fractal/control graphs on each native Blender
4.2/5.2/5.3 pass both browser APIs on physical Apple Metal and on SwiftShader:
1,536 rows. Cycles mapped maximum is 4.410744e-6. A fresh 5.3 built-package repeat
passes 256 more rows after checking all 105 emitted modules. The controls still
independently determine native output precision and row orientation. This 2D
precision fix does not change the separate high-octave software-GPU cost limits.
Select the bundled full Chromium browser for physical-GPU evidence with:

```sh
BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
BLENDLINK_NOISE_EVIDENCE=/path/to/existing/evidence \
node experiments/noise-fractal-differential/run.mjs --reuse-reference --built
```

Confirm the reported browser GPU information: the channel choice alone does not
guarantee which adapter a machine exposes.

## Fresh static normalized FBM

New bounded static normalized graphs use `noise_normalized`. Older runtimes
refuse the new opcode; old serialized `noise` keeps its prior behavior. The new
program independently validates static Detail <=6, Roughness <=1, absolute
Lacunarity <=2, absolute Distortion <=1 and Scale <=80. Negative Detail and
Roughness use native zero clamping. Named legacy high-scale approximations
remain a separate path. Linked Roughness retains `noise_varying`.

EEVEE is the primary target: 175 native EEVEE graphs on each Blender
4.2/5.2/5.3 pass both physical Apple Metal browser APIs. The 5.3 repeat uses the
built SDK with all 112 modules checked. At the prior unwrapped-model checkpoint, all 175 retained 5.2 EEVEE graphs also
passed both built SwiftShader APIs on the measured Mac ARM host without
device loss; this does not certify hosted Linux driver stability. This includes literal
and spatial shader stages, every dimension/output, fractional/high Detail,
negative/nonbinary Lacunarity, Distortion and amplified residuals. Native
OpenGL is a separate hosted gate, not inferred from Metal source evidence.

Verified Mac ARM Cycles CPU profiles remain available. Its SIMD Perlin uses
fused multiply-add and different fade/interpolation staging, so the payload
selects an explicit source precision model. The bounded portable FMA has
16,384 independent exact-rational float32 controls: zero error on both physical
and software browser APIs. Results travel as positive 11/11/10-bit RGB chunks
so material clipping cannot hide negative-number errors. The extended controls include finite int32-quotient times 100000 cancellation
used by Metal coordinate reduction. This is a bounded kernel proof, not a
general overflow/subnormal FMA promise.

Unmeasured Cycles source profiles and GPU rendering take a named source-bake
path. Shader-stage Cycles SIMD 3D/4D is additionally limited to Detail <=1 and
zero Distortion: the heavier 3D Color Detail 6 program lost both SwiftShader
devices despite tiny memory use. The emitter and runtime refuse those workloads;
MF constant profiles use their independently proved standard model. Fresh
final corpora retain 289 graphs in 4.2 and 317 each in 5.2/5.3, plus 60/32/32
explicit Cycles refusals. All 1,846 admitted physical readbacks pass.

The artist regression includes normalized 3D Scale .15, Detail1, Roughness .5,
Lacunarity2 with zero Distortion. Full-float input calibration is exact and its
Cycles Color/Fac error is <=2.384186e-7. It does not rely solely on the main
corpus's exactly half-representable input grid.

New Metal EEVEE graphs select `eevee-metal-periodic-f32`; native MF constant
graphs select `mf-periodic-f32`. Both reduce each octave coordinate at 100000
and apply the native +.5 correction at abs(coordinate)>=1e6, including Color
and Distortion octaves. Below 100000 they return the coordinate unchanged.
The Metal model uses the measured float32 reciprocal/int32 quotient and fused
subtraction; the MF model computes exact finite-float32 C fmod from the
mantissa/exponent. Independent native Math controls distinguish the large
Metal remainder 96 from a plausible but wrong nonfused remainder 128.

Spatial OpenGL EEVEE and shader-stage Cycles retain their existing unwrapped
models and qualified finite coordinate band. Their periodic source profiles
are not promoted by the Metal/MF result. Old serialized `noise` and prior
`noise_normalized` model names keep their prior behavior. Older runtimes
reject the new model names rather than silently omitting wrapping.

Native Metal boundary corpora contain 259 graphs in 4.2 and 291 each in 5.2/5.3:
all four dimensions, Fac/Color, literal/MF and image stages, both signs and
adjacent float32 values at 100000/1e6, plus the ~1.0741e9 quotient boundary.
Modern MF cases also cover finite extremes through float32 maximum. Both
physical browser APIs pass these cases under the existing native half-target
allowance plus 2e-5; no numerical budget was expanded. The focused software
repeat covers 51/83/83 graphs on the three native versions, including all
modern MF extreme-coordinate cases. Built SDK snapshots validate all 113
runtime modules.

The identity optimization has a separate direct bit proof: 4,096 float32
patterns below 100000, including signed zero/subnormals, pass both production
helpers on physical and software WebGPU/WebGL2 (32,768 exact comparisons).
This preserves input coordinates; it is not a claim that every compiled
material's pixels stay byte-identical. Fresh ordinary EEVEE 175-graph corpora
also pass both physical APIs on each native version.

Normalize is statistical scaling, not a general unit-range guarantee.
Actual native 3D/4D normalized fields can be negative: the durable
`noise_normalized_range_check.py` preserves those values with a positive
Emission offset and verifies the unit-proof refusal. Legacy 1D serialized
normalization can also round a peak to 1.000000238418579 on SwiftShader while
Metal returns 1. Output is preserved; an authored Clamp restores a downstream
unit contract. Fresh staged 1D and the separate 2D admission remain distinct.

```sh
BLENDLINK_NOISE_NORMALIZED=1 BLENDLINK_NOISE_ENGINE=EEVEE \
BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_NOISE_EVIDENCE=artifacts/verification-normalized \
node experiments/noise-fractal-differential/run.mjs --built

BLENDLINK_FMA_EVIDENCE=artifacts/verification-noise-fma \
node experiments/noise-fractal-differential/probe-fma.mjs --built
```

Periodic and identity controls:

```sh
BLENDLINK_NOISE_COORDINATES=1 BLENDLINK_NOISE_ENGINE=EEVEE \
BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_NOISE_EVIDENCE=artifacts/verification-noise-coordinates \
node experiments/noise-fractal-differential/run.mjs --built

BLENDLINK_NOISE_IDENTITY_EVIDENCE=artifacts/verification-noise-coordinate-identity \
node experiments/noise-fractal-differential/probe-coordinate-identity.mjs --built
```

Omit the engine selector to also test admissible Cycles profiles and record
their exact refusal reasons. `BLENDLINK_NOISE_ARTIST_ONLY=1` selects the focused
artist/input calibration graphs. None of these controls require real users.

Admission checks:

```sh
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/noise_parameter_admission_check.py
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/noise_fractal_translation_check.py
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/noise_varying_translation_check.py
```

Primary implementations:
[Cycles fractal recurrences](https://github.com/blender/blender/blob/v5.3.0/intern/cycles/kernel/svm/fractal_noise.h),
[dimensional/color noise](https://github.com/blender/blender/blob/v5.3.0/intern/cycles/kernel/svm/noisetex.h).

Focused browser replays accept `--reuse-reference --ids id1,id2`. Noise subsets
also run the requested engines' independent constant and image controls, in
native manifest order, so row orientation and render precision remain calibrated.
Reports distinguish requested IDs, implicitly included control IDs, and total
completed cases. Constant-only harness retention probes keep their explicit scope.

Driver diagnostics retain the Chromium version, explicit launch arguments,
channel, and the actual initialized WebGPU adapter or WebGL renderer. Set
`DEBUG=pw:browser` to retain browser-process stderr. The optional
`BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium` uses Playwright's bundled full browser
in its newer headless mode; the default remains the separate headless shell.
The harness supplies a blank favicon so full-browser resource checks stay strict.

A focused Linux CI diagnostic repeats the previously terminating 4D image case
with `--disable-gpu-watchdog` and a 12-minute outer deadline. This is isolated
from the ordinary full FBM gate, which retains default launch behavior. Its
reported scope is one case plus independent controls, and it is not full-corpus
or production performance certification. The same retained Linux native case
passed both full-browser Metal backends locally with the default watchdog:
130 ms on WebGPU and 33 ms on WebGL2 for first render/readback on the measured
Apple M5 Pro setup, versus seconds in software rendering. Those observations
are device-specific, not a browser-wide timing guarantee.

### Repeated scalar fields

When a Combine XYZ node connects the same scalar Noise Fac to all three
channels, the serialized expression tree repeats that source. The browser now
shares that one evaluation within the Combine scope. Exact structural equality
keeps distinct primitive types and signed-zero input bits separate; other
channel graphs still build independently. This applies to existing `noise`,
`noise_fractal` and `noise_varying` scalar outputs without changing their math,
controls, native references or error budgets.

All affected retained FBM, other-fractal and varying-Roughness graphs pass on
Blender 4.2/5.2/5.3 and both physical Apple Metal browser APIs: 3,948 rows,
including independent render/orientation controls. The expensive 4D Detail=6
Fac image case retains byte-identical physical-GPU pixels, reduces sampled
texture allocations from six to two (three including the readback target), and
reduces total WebGPU program bytes from 29,631 to 23,071. A default SwiftShader
pilot also passes both APIs. These local results do not certify the Linux
SwiftShader crash; that remains an explicit hosted regression check.

### Raw FBM sum stages

The unnormalized static FBM recurrence materializes each sum stage before the
next octave. This preserves the native float32 recurrence while keeping the
high-detail Color expression shallow for shader compilers. The legacy
normalized recurrence remains unchanged. This is a portability investigation;
hosted Linux success is required before calling its GPU-process loss fixed.

All 334 retained graphs per Blender 4.2/5.2/5.3 pass both physical Metal browser
backends (2,004 readbacks), and all 334 retained Linux 5.2 references pass both
local SwiftShader APIs (668 readbacks). The 996 readbacks overlapping the prior
scalar-sharing corpus are byte-identical. The focused 4D Color case is also
byte-identical on both software APIs. That case's generated program grows from
21,544 to 22,670 bytes on WebGPU and 20,359 to 21,212 on WebGL2; this change does
not claim shader-size reduction or a production timing improvement. Native
references, source parameter bounds and numerical budgets remain unchanged.

### Normalized output and downstream ranges

Normalize does not imply an exact unit interval. Actual native Blender 4.2/5.2/5.3
EEVEE normalized 3D Noise at (27687.359375,47520.48046875,38070.5), Scale 1,
Detail 0 produces −0.00439453125. The 4D point (58250.5,35498.5,49388.5,58164.5)
produces −0.021728515625. Positive emission offsets expose these values without
clipping; 12 physical browser readbacks preserve the output under the unchanged
native target allowance. Python and TypeScript refuse 3D/4D unit-range claims
for legacy, fresh-normalized and varying-normalized opcodes independently.

Legacy serialized 1D at W 291.5, Detail 6, Roughness=f32(.063289), Lacunarity 1
produces 1.000000238418579 on both SwiftShader APIs, while both physical Metal
APIs produce 1. Its JavaScript-double amplitude denominator differs from shader
float32 accumulation. Only that legacy 1D unit proof is removed; its output and
new shader-staged 1D paths retain their behavior. The remaining 2D kernel has
separate headroom evidence; no range is inferred solely from the Normalize UI.

An actual authored clamp can re-establish a downstream range. For RGB, enable
Clamp Result on a Mix Color node; a scalar Clamp converts a color to a scalar
and is appropriate for scalar Roughness fields. HSL admission and live
Roughness validate the executable graph rather than trusting a claimed range.
Native output is never silently clipped by these validation changes.

### Finite 4D gradient selection

The 4D gradient stages each selected coordinate and signed term, then requests
eager conditional selection inside the existing named function. This removes
nested branch expansion while preserving the native signed-gradient sum order.
Separate variables also avoid Three's GLSL nested-ternary precedence defect;
all alternatives are finite within the admitted coordinate domain. No parameter
limits, kernels, amplitude recurrence or native numerical budgets change.

All 334 retained raw-FBM graphs per native version pass both physical browser
APIs on Blender 4.2/5.2/5.3 (2,004 readbacks), with every output byte identical
to the previous staged-sum SDK. Focused 4D periodic/MF graphs add 434 physical
readbacks, including independent controls. All 668 retained Linux 5.2 raw-FBM
readbacks pass in local software browsers and retain their prior pixel bytes.
A further 45 retained Linux EEVEE normalized 4D graphs and controls pass both
local software APIs (90 readbacks), including the high-detail Color workloads.
The problematic constant 4D Color program changes from 22,670 to 22,606 total
WebGPU program bytes and 21,212 to 21,136 WebGL2 bytes; these small size changes
are not a performance guarantee or proof the hosted driver failure is fixed.

Two retained serialized legacy 4D programs (Fac and Color with Distortion) also
match the previous SDK exactly on both APIs and physical/software browser
profiles: 131,072 Float32-word comparisons. This is runtime compatibility
evidence, separately labelled from native numerical oracle evidence. Immutable
snapshots and actual initialized adapters are retained with each report.

## Native normalized live Roughness

Fresh EEVEE normalized FBM with a linked, independently certified scalar
Roughness uses `noise_varying_native`. The new opcode keeps previously saved
`noise_varying` programs on their original primitive and arithmetic. Cycles,
signed FBM and other fractal modes retain that existing capability.

This batch supports Detail <=2, finite static abs(Scale)<=80 and
abs(Lacunarity)<=2, and **Distortion =0**. The actual Roughness expression must
prove both scalar shape and [0,1] range; a label such as `roughnessRange` grants
nothing. Negative Detail uses the native zero clamp. Metal/OpenGL source
backend and compatible Perlin model are explicit. Metal periodic and native-MF
models reuse the qualified coordinate helpers; the OpenGL spatial model keeps
its existing finite coordinate band. This local native evidence is Metal;
OpenGL-native parity remains a separate hosted qualification.

The new opcode does not acquire an exact output-unit proof from Normalize.
An authored Clamp restores a downstream unit/HSL/Roughness contract. This
conservative decision leaves previously earned static 1D/2D bounds intact.

Nonzero Distortion receives the same exact named refusal independently from
the source compiler and runtime. The ordinary renders initially passed, but
amplified actual shader-stage controls exposed errors in coupled distorted
fields. Their FMA/offset investigation is separate from this shipped batch;
no error budget is expanded and no production input graph is rewritten.

The native corpus requests 259 actual graphs per Blender 4.2/5.2/5.3: 193
admitted graphs and 66 declared Distortion refusals. It covers all four
dimensions, Fac/Color, MF-eligible and image Roughness, mixed stage
compositions, negative/fractional Detail, Scale 0/-1/40/80, zero/negative/
nonbinary Lacunarity, real Clamp endpoints and amplified residuals. Independent
constant/image controls remain included. Both physical and software browser
backends replay the exact same retained native pixels: all 2,316 built
readbacks pass, with all 122 runtime modules covered by the semantic build
guard. No browser/shader errors or device losses occurred in this batch.

Every refused graph is retained under `reference/refused/`: actual RNA
properties, input/output defaults and links, pinned original image float32
pixels, and a native render of the unaltered graph. These are source snapshots,
not replacement shaders or successful runtime comparisons. Manifest IDs and
exact reasons distinguish the refused scope; requested counts must equal
admitted plus refused counts, and expected/observed refusal sets must match.

```sh
BLENDLINK_NOISE_NATIVE_VARYING=1 \
BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_NOISE_EVIDENCE=artifacts/verification-native-live-roughness \
node experiments/noise-fractal-differential/run.mjs --built
```

`BLENDLINK_NOISE_RESIDUAL_ONLY=1` selects the focused amplification subset.
Use the same `--reuse-reference` and browser-channel controls described above
for physical versus software runtime replay. This test exercises
WebGPURenderer through its WebGPU and WebGL2 backends; it does not certify
legacy WebGLRenderer TSL support.
