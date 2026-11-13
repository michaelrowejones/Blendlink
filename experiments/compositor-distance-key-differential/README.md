# Native RGB Distance Key

This bounded port targets `CompositorNodeDistanceMatte` in Blender 4.2/5.2/5.3.
It supports **RGB with native CPU evaluation**, including modern GPU scenes
whose actual inputs are all single values and therefore execute Blender's CPU
multi-function. GPU image fields and YCC remain explicitly refused.
CPU names Blender's source evaluator; Three still executes the live expression
on the selected browser GPU backend.

Pinned primary sources:

- [4.2 CPU RGB distance/matte](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_DistanceRGBMatteOperation.cc)
- [4.2 YCC distance](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_DistanceYCCMatteOperation.cc)
- [4.2 node/output conversion](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/nodes/COM_DistanceMatteNode.cc)
- [4.2 GPU shader](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/realtime_compositor/shaders/library/gpu_shader_compositor_distance_matte.glsl)
- [5.2 native CPU/MF and schema](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/composite/nodes/node_composite_distance_key.cc)
- [5.3 native CPU/MF and schema](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_distance_key.cc)
- [5.3 GPU shader](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/shaders/library/gpu_shader_compositor_distance_matte.glsl)

## Contract

Fresh IR uses `distance-key` / `native-rgb-distance-cpu-v1` with separate
`legacy` and `modern` schemas. The metric is Euclidean distance in the original
three RGB channels; Key Color alpha is ignored. Image output multiplies all four
original RGBA channels by the matte, including original alpha. Matte output
returns the scalar directly.

Legacy CPU uses strict `<Tolerance`, then `<Tolerance+Falloff` branches; fully
keyed pixels force zero even for negative image alpha. Modern CPU instead caps
the computed matte by original alpha and safely handles zero Falloff. At exact
zero-falloff equality the legacy/modern results differ. The port retains those
rules and does not normalize or clamp authored HDR/signed image/alpha values.

Controls are fixed finite `[0,1]` values, unlinked or direct literal Value-node
links. Falloff is zero or at least `1/64`. Modern Tolerance must be positive and
at least `2^-50`; legacy CPU permits zero only with zero Falloff. Arbitrary linked arithmetic is not silently folded through Python
double precision. Group-contained nodes are supported with the same control
contract. Unknown models, schemas, versions and evaluator claims refuse.
Independent runtime single-value classification prevents metadata from granting
CPU folding to an actual GPU field.

Rounded squared components and ordered sums retain CPU arithmetic before exact
integer square root and a Distance-only correctly rounded ratio. Absolute component differences may be bounded
to eight internally: any such component is already beyond the greatest possible
threshold sum of two, so this does not change a key decision or the original
image channels. No native pixel readbacks construct the runtime expression.

## Native proof

Official references use Blender 4.2.0 `a51f293548ad`, 5.2.0 LTS
`fbe6228777e7` and 5.3.0 `02f0899d78e3`, EEVEE context, FULL compositor precision
and 32-bit RGBA EXR. Run:

```sh
BLENDER_USER_RESOURCES=/absolute/isolated-profile \
BLENDLINK_COMPOSITOR_DISTANCE_KEY_REFERENCES=/absolute/distance-cpu \
  "$BLENDER" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/compositor_distance_key_check.py

# Repeat with BLENDLINK_COMPOSITOR_DISTANCE_KEY_DEVICE=GPU.
npm run build --workspace blendlink
node experiments/native-compositor-differential/run.mjs --built \
  /absolute/distance-cpu /absolute/distance-gpu --out /absolute/distance-browser
```

The fixture covers both outputs, default/zero/minimum ramps, literal linked
controls, strict threshold neighbors, negative/zero/HDR alpha, original color
HDR, both-field inputs, groups and actual EEVEE Render Layers inputs.
`independent-boundary-vectors.json` retains deterministic Float32 triples chosen
solely from different left/right squared-distance reductions around three
thresholds. Actual native EXR output remains the oracle. These asymmetric probes
expose full matte changes rather than hiding boundary mistakes under an epsilon.
Same compiled graphs are exercised across repeated sizes and DPR2, with unchanged
shader structure, restored caller MRT/clear state and zero retained textures.

## Unqualified profiles

Native Metal GPU fields in all three versions select the opaque branch for the
axis `.2` default-threshold control where the browser's length path selects a
partial matte. With original alpha two, native Matte is two and the browser
prototype returned one; Image alpha differs by two. This is a visible threshold
error, not grounds for a wider numeric tolerance. Native GPU captures and exact
Float32 files are retained in `refusals.json` outside the numeric index. Modern
GPU constant cases remain numeric CPU-fold proofs, not GPU-field certification.
Legacy GPU zero Falloff also contains an unqualified division by zero.

YCC is not an alias for RGB. Legacy CPU measures only chroma and converts the
keyed YCC result back to RGB; modern CPU measures all three converted channels
and multiplies the original RGB image. Native YCC image counterexamples are
retained separately. Supporting it requires its own conversion/output profile.
Unsupported native captures never count as completed browser numeric cases.

Initial release corpus before the zero-Tolerance audit: 45 CPU cases per Blender version, one independent
legacy GPU control, and three cases per modern GPU version (independent control
plus two actual CPU-fold outputs): **142 native cases / 284 built readbacks**.
Both software SwiftShader/LLVM browser APIs passed with exact zero numerical error;
this initial result did not certify physical Metal. The maximum was
one pass and 4,503 fragment-source bytes; all rows released their textures.
Each CPU version includes a same-graph repeated-size/DPR2 sequence. GPU field
case count is explicitly zero; their native captures remain refusal evidence.

## Zero-Tolerance audit and refusal

An independent audit uses normal input RGB values around `1e-20` and the
Float32 squared-subnormal boundary, with bit-exact browser input controls.
Tested native 5.2 CPU preserves positive squared distances while tested native
5.3 CPU returns zero for the same controls. With both thresholds zero this
changes modern hard-key Image alpha by four. With Tolerance zero, Falloff `.125`
and independently preserved finite input alpha `1e20`, the small matte
disagreement becomes an Image-alpha error of `43.36808776855469` on both APIs.
Therefore refusing only zero/zero is insufficient. Fresh source and runtime
independently refuse **all modern zero-Tolerance settings**; no epsilon or wider
error budget is used. The initial legacy positive-Falloff result was also
software-only and is superseded by the physical audit below. Legacy CPU
zero/zero identity remains separately proved. A future modern zero-Tolerance port
requires an explicitly qualified dot/sqrt/denormal model.

Repeat the retained native audit with
`BLENDLINK_DISTANCE_ZERO_REFERENCES=/absolute/output` and
`experiments/compositor-distance-key-differential/native_zero_distance.py`.
The default uses Falloff zero / alpha two. Add
`BLENDLINK_DISTANCE_ZERO_FALLOFF=.125 BLENDLINK_DISTANCE_ZERO_ALPHA=1e20`
for amplification controls. Modern refused native outputs are retained outside
the numeric index, with exact Float32 files and source diagnostics.

After the guard, the family contains 45 legacy CPU cases, 41 cases per modern
CPU version and the same seven GPU control/CPU-fold cases: 134 total. Combined
with both tiny-distance audit configurations, 144 supported cases passed each
built software browser API with zero numerical error. Independent input controls compare
Float32 words, so the observed discrepancy is not an unnoticed input upload loss.

## Physical CPU-arithmetic correction

The combined physical Metal replay exposed 32 Distance failures per API, also
reproduced in an isolated legacy-only run. The same inputs still passed
SwiftShader/LLVM. At a strict `.2` boundary an intrinsic square root rounded one
Float32 step upward, selecting an opaque alpha instead of the native CPU ramp.
The original physical failure remains at
`/private/tmp/blendlink-distance-sqrt-proof/before-real-metal/results.json`.

`tslCompositorCpuSqrt.ts` instead takes the exact integer root of a 47/48-bit
radicand in 24 radix-four digits. A two-word input and at-most-27-bit working
remainder fit uint32 arithmetic. For floor root `q`, rounding increments exactly
when the integer remainder exceeds `q`, because the half-way square has
fractional part one quarter. There is no floating sqrt estimate or epsilon.

An additional positive-Tolerance both-field control exposed a one-ULP error in
the existing approximate CPU-division helper: native matte
`.4142134487628937`, physical `.41421347856521606`. Decimal alpha `1e20`
happened to round both final products to the same Float32. Independently chosen
power-of-two alpha `2^64` scales the matte difference exactly and exposes an
Image-alpha error of **549755813888**, in all three native versions and both
physical APIs. Native records and the failed old-division replay are retained
in `before-ratio-native2` / `before-ratio-physical2` under the evidence root.

`tslCompositorCpuDistanceRatio.ts` performs 23 fractional restoring-division
digits plus exact nearest/even rounding. This private Distance path receives
`max(f32(distance-Tolerance),0)` and positive fixed Falloff; negative quotients
were already unused or clamped. With positive Tolerance at least `2^-50`, a
nonzero near-threshold numerator is at least `2^-74`; the numerator is at most
16 and Falloff lies in `[1/64,1]`. Thus the ratio is normal or zero. Both zero
signs are retained by the primitive. Legacy zero/zero bypasses the metric and
ratio entirely. Shared division, generic Math and Noise behavior are unchanged.

Correct sqrt cannot recover a squared component already flushed upstream. The
physical legacy zero-Tolerance/positive-Falloff audit also fails Image alpha by
`43.36808776855469`. Source and runtime now refuse that domain, keeping native
outputs outside the numeric index; legacy zero/zero remains admitted. A positive
Tolerance at least `2^-50` shields all tiny distances below the threshold.
Fresh source extraction now checks exact measured release tuples 4.2.0, 5.2.0
and 5.3.0, including refusal of unmeasured patch versions.

Independent `native_sqrt.py` and `native_ratio.py` capture **16,384 actual native
CPU field values per operation per version**, including all normal exponents,
mathematically selected sqrt midpoint neighbors, bounded ratio significands,
fixed and random admissible divisors. Native values also agree with an
independent binary64 mathematical control rounded to Float32. These are
primitive controls, not extra shader-node support claims.

```sh
BLENDLINK_DISTANCE_SQRT_REFERENCES=/absolute/sqrt \
  "$BLENDER" --background --factory-startup --python-exit-code 1 -t 1 \
  --python experiments/compositor-distance-key-differential/native_sqrt.py
BLENDLINK_DISTANCE_RATIO_REFERENCES=/absolute/ratio \
  "$BLENDER" --background --factory-startup --python-exit-code 1 -t 1 \
  --python experiments/compositor-distance-key-differential/native_ratio.py
BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
  node experiments/compositor-distance-key-differential/sqrt-run.mjs \
  /absolute/sqrt /absolute/ratio --out /absolute/physical-math
```

The browser decodes exact IEEE input words from independently checked integer
texture lanes. All **98,304 native primitive values plus 73 separately labeled
mathematical bit controls** pass bit-exact in physical Metal WebGPU/WebGL2 and
SwiftShader/LLVM WebGPU/WebGL2. The mathematical controls include smallest /
largest subnormals, powers and neighbors, and negative zero. They do not admit
native subnormal image arithmetic; the Distance upstream refusal remains.
Exact helper bytes are snapshotted per run. Final evidence is
`/private/tmp/blendlink-distance-sqrt-proof/math-final-{physical,swiftshader}`.

The final family has 138 indexed rows, including independent controls, plus
eight admitted tiny-audit rows: **146 cases per API/adapter pair**. This includes
134 numerical Distance programs and 12 independent controls. Fresh native
family records are in `release2/family-{42,52,53}-{cpu,gpu}`; unchanged tiny
records are in `release/{zero,amplified}-{42,52,53}`. Final built proofs at
`release2/built-{physical,swiftshader}` use immutable modules and the full
TypeScript emit guard. All retain DPR/repeated resize, caller MRT, cleanup and
the original 16 KiB shader-cost gate. Fixed output kind and input nodes are
captured before deferred shader construction; a caller-mutation unit regression
checks that boundary.

Warm 1080p draw-plus-completion-readback wall times are measured separately for
each primitive, not isolated GPU timestamps or a frame-rate guarantee. In the
retained physical WebGPU run integer sqrt / ratio medians are approximately
1.45 / 1.05 ms; software WebGPU is approximately 10.15 / 8.25 ms. WebGL2 results
are approximately 16.7 ms for integer and intrinsic paths, dominated by the
measurement cadence. The extra correctness cost remains visible in the reports.

The CPU Blender 5.2 native canary additionally generates fresh independent sqrt
and ratio records and runs this **source-helper** proof, even when the separate
built Distance comparison fails. `BLENDLINK_DISTANCE_EXPECTED_NATIVE=5.2.0`
checks the producing release/build, CPU evaluator, EEVEE context, bounded 16,384
input/expected values and independent mathematical agreement before browser work.
It snapshots the two production TypeScript helper files; it does not claim
compiled-JavaScript or whole-program primitive parity. The preceding compositor
family command separately runs the built JS graph gate. Both browser APIs are
checked, failed results/progress are retained before assertions, and actual
adapter identities are recorded. CI software results cannot become a physical
Metal claim. Raw native data, helper hashes and browser failures are retained
under the compositor canary artifact.
