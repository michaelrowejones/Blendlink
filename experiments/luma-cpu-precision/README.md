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

## Linux5.2 production qualification

The qualified allowlist is **only** Linux `x86_64`, Blender5.2.0 build
`fbe6228777e7`, actual gradual-RNE and the measured Float32 Rec.709 tuple.
Source extraction adds `luminance_key_source_build` for this profile; runtime
independently requires that exact identity. Existing Mac documents retain
their profile shape and semantics. Unmeasured Linux versions/builds/architectures
retain `legacy-unqualified-cpu-v1`; the separately qualified Windows CPU sources
are listed below.

The basis is retained native trial run43400812538/job131802895572,
artifact14024667969, archive SHA256
`fe5439bba9286fcf59f9075ba8b1bf4d5f1eb1984537f69478a0c943d6f3bf0d`.
Its actual source was Linux/x86_64 buildfbe6228777e7. Ordinary47 cases/API,
private-kernel32 cases/API and4x16384 primitive controls/API passed exactly
on both browser APIs, with stable native dot/multiply/add controls and
unchanged source programs/pixels. Those receipts remain **SOURCE_ADMISSION_NA
with zero production exact cases**; they are not rewritten or relabelled.

Fresh production qualification **passed** on checkpoint `9d137e3`, run43411851852/job131839951001.
The [reviewed receipt](linux52-production.json) binds artifact14030161909, archive
SHA256 `4bf0d1cad0d4c86eac69570d95c0a77c6a2c695587b6fd8f70e12cd2aa1f52d1`.
Both actual WebGPU and WebGL2 passed79 unchanged production programs, including
32 bit-exact precision cases/API, with zero error. All163 archived runtime source
hashes match the reviewed tree. The mandatory Linux canary continues to require
`PRODUCTION_QUALIFIED` and a fresh actual-production comparison on both APIs.
Precision outputs must be bit-exact, including subnormal and signed-zero
results; merely falling inside a tolerance cannot qualify them. The driver
counts production cases only after that production browser step succeeds.
The private-kernel trial continues to report zero production admission cases
independently. The original Linux production receipt stays unchanged; the
fresh host run below revalidated the same 79 cases/API against the expanded
source guard, with 32 bit-exact precision cases and zero error.

## Windows CPU production qualification

Fresh actual-production run [43418329637](https://github.com/michaelrowejones/Blendlink/actions/runs/43418329637)
qualified these two **CPU compositor source** profiles:

| Source | Exact native build | Production cases/API | Bit-exact precision cases/API |
| --- | --- | ---: | ---: |
| Windows 4.2.0, `win32/AMD64`, gradual-RNE | `a51f293548ad` | 53 | 32 |
| Windows 5.2.0, `win32/AMD64`, gradual-RNE | `fbe6228777e7` | 79 | 32 |

The [production receipts](host-production-receipts.json) bind each actual archive
SHA256, native source/version/build/mode/Rec.709 tuple, program pin, immutable
runtime snapshot and browser result. Both WebGL2 and WebGPU passed every actual
production program with numeric error zero and all 32 precision outputs
bit-exact. Independent native task controls and 65,536 primitive comparisons/API
also passed with zero mismatches; the separate 32-case private trial still
contributes zero production admission cases.

Source extraction and runtime admission independently require the exact Windows
build, AMD64 architecture, actual gradual-RNE mode and Float32 Rec.709 tuple.
Only native CPU compositor sources are qualified. Windows GPU single-value CPU
folding keeps v1 with `SOURCE_ADMISSION_NA`; other Windows versions, builds,
architectures and modes retain the existing v1 contract. Mac and Linux admission
routes remain unchanged. The canaries require fresh `PRODUCTION_QUALIFIED` IR
and a successful actual-production comparison before counting 32 precision cases.

The recorded Windows browser devices are software D3D11 WARP for WebGL2 and
SwiftShader for WebGPU. Chromium requires ANGLE's D3D11 device before selecting
the WebGPU adapter, so Windows uses `--use-angle=d3d11-warp` together with
`--use-webgpu-adapter=swiftshader`. The actual API/driver receipt is separate
from numerical qualification. Unavailable adapters still fail. These receipts
do not qualify physical Windows GPUs or Cycles live shaders; the empty Cycles
scene carries independent native CPU compositor evaluation.

The same run revalidated Linux 5.2.0 `x86_64` build `fbe6228777e7`: 79 production
cases/API, including 32 bit-exact precision cases, with zero error on both APIs.
Both built snapshots on each host contain 163 source/emitter/module pins and
verified snapshot/map hashes. Native fixture/extractor/helper pins match the
reviewed source. Windows hashes reflect Git's CRLF text checkout; the
NUL-containing `sync.ts` remains byte-preserved. The initial Mac 358-scene /
1,432-readback proof and the earlier Linux and Windows N/A receipts retain their
original counts and statuses.

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
Apple source. Windows qualification therefore rests on the actual native task
controls and fresh production receipts above.

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

The driver first checks the actual source-emitted production contract (or v1
compatibility for an unqualified source). It then captures
extra native HDR/tiny cases using the **fixture-only**
`BLENDLINK_LUMA_CPU_EXACT_EXPERIMENT=1` switch. For unqualified sources, the actual v1 IR is retained byte-for-byte.
Qualified sources retain their actual source-emitted production IR. A separate direct private-kernel trial resolves the
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

## Historical Windows browser interop receipt

The [reviewed Windows receipt](windows-browser-receipt.json) records fresh
run43415307659 with full Chromium158. The software ANGLE backend uses
D3D11 WARP, satisfying Chromium's required D3D11 interop query before Dawn
selects its actual SwiftShader WebGPU adapter. Both Windows4.2 and5.2 passed
ordinary21/47 cases/API exactly,32 private kernel cases/API bit-exactly and
4x16384 primitive comparisons/API with zero mismatches. Linux regression
checks passed separately. The normal-trigger fix retains actual API, driver
and device diagnostics; an unavailable adapter still fails the gate.

Those retained Windows source programs remain **SOURCE_ADMISSION_NA**, with zero
production precision admission cases. Successful private trials and browser
availability did not promote them. The separate production receipt above is
the subsequent proof. Earlier failed adapter receipts are preserved; no physical
Windows GPU or general hardware claim is made.
