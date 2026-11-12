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
