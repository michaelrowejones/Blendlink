# Native CPU Luminance Key precision

This corpus separates production source admission, native CPU arithmetic and
experimental host qualification. It does not replace the native output with a
browser formula or fit the production kernel to native pixels.

The production port is `native-luminance-key-cpu-rne-v1`. Its initial measured
source profiles are Blender 4.2.0 / 5.2.0 gradual-RNE and 5.3.0 FTZ/DAZ-RNE on
darwin/arm64 with the actual Rec.709 Float32 coefficient tuple. Source extraction
checks the actual mode; runtime admission independently checks the closed
certificate and measured version/platform/mode combination. Existing v1
documents, spatial GPU evaluation and unqualified fresh CPU sources keep v1.
Persisted legacy reversed CPU ramps also retain the explicit v1 contract; current 4.2 RNA constrains reverse authoring. Unqualified fresh CPU sources are explicitly tagged `legacy-unqualified-cpu-v1`
and `SOURCE_ADMISSION_NA`; they do not gain an HDR precision claim.

## Counterexamples and derivation

The old shared division and generic GPU dot each have an actual CPU-native
one-ULP counterexample. Gray RGB `0.1414213478565216`, thresholds `.1/.2`, and
alpha `2^60` isolate ramp rounding; mixed RGB `(.1,.2,.3)` isolates dot staging.
Binary alpha scaling exposes the difference without depending on another
product-rounding boundary. These authored graphs remain in the native fixture.
The original ordinary scenes and their native pixels are unchanged. Additional controls distinguish spatial thresholds with singleton bounds from genuinely single-value thresholds, and preserve the v1 contract for serialized legacy reversed ramps. The actual 4.2 RNA setter constrains reverse assignment; that is recorded separately from numerical proof.

Native RGBToBW is independently compared with actual native Multiply/Multiply/
Multiply/Add/Add nodes and a Float32-stage model over 16,384 values per version.
The private dot therefore preserves three separately rounded products followed
by `(r+g)+b`. The nonbinary ramp uses integer restoring division with one exact
remainder-based RNE rounding, bounded to numerator `[0,1]` and divisor
`[1/64,1]`. Power-of-two ramps use exact scaling; default `[0,1]` stays live.

An initially universal FTZ candidate failed the retained tiny/HDR controls:
RGB `2^-126`, default thresholds and alpha `2^120` yield Image alpha `.015625`
on measured 4.2/5.2, but `0` on measured 5.3. This candidate was not promoted.
The final kernel records the actual underflow/input mode and preserves it
through dot, subtraction, ratio **and final RGBA multiplication**.

The gradual fallback uses original integer arithmetic. A 12-bit-limb product
retains all 48 significand bits and rounds once, including underflow. Small
adds are scaled by `2^100`; a subnormal result is an exactly representable
integer multiple of `2^-149`, so integer descaling introduces no double
rounding. Normal pixels take real conditional hardware fast paths. No shared
Math, Noise, Distance or generic division implementation changes.

The NumPy mode probe is not treated as proof of a native task's behavior:
actual compositor task outputs separately validate Multiply, Add, RGBToBW and
Divide; the certificate is checked before/after those tasks. The source build
flags are supporting evidence only. In particular, the inspected Blender 4.2
Windows CMake file lacks the explicit contraction-off flag found in the pinned
Apple source. Windows bit parity remains unearned until its native trial.

## Measured proof

- Native 4.2 / 5.2 / 5.3 CPU+GPU: 358 scenes, including ordinary Image/Matte,
  groups, cascades, actual modern GPU constant CPU folds, HDR alpha and tiny
  default-zero ramps. Built physical Metal and SwiftShader, each through
  WebGPU and WebGL2: **1,432 production readbacks, numeric maximum error 0**.
- Dense private primitive checks: **655,360 scalar browser comparisons** over
  all four API/adapter profiles. The input carrier is independently checked at
  the IEEE-word level, including negative zero. Native FTZ task controls remain
  separate from the gradual fallback's arithmetic contract.
- The separate direct-kernel protocol cross-checks the 32 precision cases per
  native version on all four profiles: **384 reads, zero bit mismatches**.
  These are deliberately not counted as production admission tests.
- The full host driver also passes locally with Blender 5.2 and an explicitly
  empty one-sample Cycles CPU scene. Its original native source programs and
  ordinary pixels are unchanged between ordinary and experimental captures.

These are finite-result scene-linear checks. NaN payloads, arbitrary downstream
amplification and unmeasured source CPU/compiler profiles are not implied.
The ordinary compositor budget remains `2e-5`; private primitive and kernel
qualification checks use exact word/numeric comparison instead of widening it.

Retained worker evidence is under `artifacts/verification-luma-stages-built`,
`verification-luma-final-primitives`, `verification-luma-final-ratio53`,
`verification-luma-kernel-stages` and `verification-luma-host-driver52-stages`.
Reports include native source hashes, independent calibration, API/adapter,
browser version, immutable production module snapshots and semantic built
provenance. Historical failed candidates remain separately retained.

## Repeatable production proof

Use Node 24. Generate actual native reference files; the browser runner does
not generate or modify them:

```sh
BLENDLINK_COMPOSITOR_LUMINANCE_KEY_DEVICE=CPU \
BLENDLINK_COMPOSITOR_LUMINANCE_KEY_REFERENCES="$PWD/artifacts/luma/cpu" \
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_luminance_key_check.py
```

Repeat with GPU and the other native versions. After a coordinated build:

```sh
npm run build
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/luma/software artifacts/luma/cpu artifacts/luma/gpu
BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/luma/physical artifacts/luma/cpu artifacts/luma/gpu
```

The recorded adapter determines hardware/software identity, rather than the
channel name alone. Do not change production source while a capture runs.

## Unmeasured host qualification

The separate Linux 5.2 / Windows 4.2 / Windows 5.2 workflow runs this command
after a clean build and Chromium install:

```sh
BLENDLINK_BLENDER=/path/to/blender \
BLENDLINK_LUMA_CPU_ORACLE_ENGINE=CYCLES \
node experiments/luma-cpu-precision/qualify-host.mjs \
  artifacts/verification-luma-cpu-host
```

The unused scene is explicitly empty Cycles CPU at one sample. The compositor
remains native CPU, with unchanged authored nodes and full Float32 native
output; this avoids a Windows OpenGL scene dependency. Default local scene
engine is EEVEE when the override is omitted.

The driver first checks ordinary production v1 compatibility. It then captures
extra native HDR/tiny cases using the **fixture-only**
`BLENDLINK_LUMA_CPU_EXACT_EXPERIMENT=1` switch. The actual unqualified v1 IR is
retained byte-for-byte. A separate direct private-kernel trial resolves the
untouched upstream graph, calls the production arithmetic kernel, and always
records `productionAdmissionCases: 0`. It never spoofs source platform tags,
rewrites the source program, or grants production support.

`precision-qualification.json` is a closed schema checked by
`precision-protocol.mjs`. A normal unqualified capture reports
`SOURCE_ADMISSION_NA`, zero precision files and zero production exact cases.
An explicit experimental capture retains that admission status and zero
production exact cases, but supplies 32 hashed native trial files. N/A is never
a numerical pass. The driver retains actual source platform/architecture/mode,
build hash, original v1 programs, independently captured primitive controls,
input/expected pixels and browser failures. Successful host arithmetic still
requires a separately reviewed allowlist change and a fresh **production**
rerun before promotion.

```sh
node --test experiments/luma-cpu-precision/precision-protocol.test.mjs
```

## Primary source

- [4.2 CPU endpoint/ramp code](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_LuminanceMatteOperation.cc)
- [5.2 native CPU function](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/composite/nodes/node_composite_luminance_key.cc)
- [5.3 native CPU function](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_luminance_key.cc)
- [5.3 vector dot implementation](https://github.com/blender/blender/blob/v5.3.0/source/blender/blenlib/BLI_math_vector.hh)
- [4.2 Apple build flags](https://github.com/blender/blender/blob/v4.2.0/build_files/cmake/platform/platform_apple.cmake)
- [4.2 Windows build flags](https://github.com/blender/blender/blob/v4.2.0/build_files/cmake/platform/platform_win32.cmake)
