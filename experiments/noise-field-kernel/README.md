# Finite nearest-image Noise field experiment

This is an **opt-in snapshot experiment**, not an enabled SDK feature or a
general SwiftShader fix. The default runtime is unchanged. Actual hosted Linux
SwiftShader Subzero verification is required before considering promotion.

The previous private zero-uniform coordinate barrier failed both APIs on the
actual Linux driver. A separate fixed three-lane Color loop also lost both local
LLVM devices after about 65 seconds. `color-schedule.mts` retains that failed
experiment; it is not applied by the normal runner or by the table flag.

## Pointwise specialization

For an immutable nearest-sampled input, evaluate the existing pure Float32 Noise
kernel at every admitted input texel, then sample the resulting table with the
original image coordinates:

```
Noise(Nearest(input, uv), exactW(input))
    = Nearest(perTexelNoise(input), uv)
```

`nearest-table.mts` calls `foldStaticNoise4dColor`; it does not read native pixels,
GPU output, expected results, fixture IDs, or fixture hashes. The original image
dimensions, bottom-up row order, UV/active-UV selection, nearest interpolation,
repeat behavior, and color-output semantics are retained. Noise output is RGB
with alpha one. Signed and HDR RGB are not clamped. The existing embedded-image
builder owns the generated Float32 texture and its disposal.

Admission is deliberately narrow:

- Fresh `noise_fractal` / `noise_normalized`, static 4D FBM Color, Detail 4–6,
  no Distortion or live Roughness, and a shader evaluation profile accepted by
  the existing pure kernel. Legacy `noise` is never lowered.
- An embedded image of at most 16,384 texels, already-decoded linear Float32
  payload, full storage/no upload rounding, alpha one, nearest/repeat/flat UV
  sampling, and an explicitly known Cycles or EEVEE Metal/OpenGL profile.
- Normal half-representable source RGB within ±2, with exact Float32 products
  at the measured Scale 40 or 80. Half-subnormal payloads are excluded.
- W is an exact Float32 literal or exactly certified `.5 * sameImageY + .125`.
  There is no direct-UV, arbitrary arithmetic, working-space, sRGB, unknown
  processing, or future metadata widening. Image, Noise, and scalar leaf keys
  are checked before the specialization.
- An independent monotone interval proof bounds every seeded octave below
  90,000. The pure kernel separately checks each evaluated sample. Neither
  check accepts a source-supplied bound.

The 16,384-texel cap is a measured resource bound, not a claim that synchronous
preparation at that cap meets a finished product's interaction latency target.
Promotion should consider moving large preparation work off the main thread.
Unknown/unproved inputs retain the existing runtime path.

## Running

Build the worker normally first. `--built` verifies the complete emitted
production program against source, including reviewed asset rewriting, **before**
copying it into a separately hashed experimental overlay. The report identifies
the production baseline, tested overlay bytes, helper/source hashes, TypeScript
version, and frozen harness bytes. It does not label the overlay a shipped build.

Use an absolute Blender executable from each verified 4.2 / 5.2 / 5.3 installation:

```sh
BLENDLINK_BLENDER=/absolute/path/to/Blender \
BLENDLINK_NOISE_ENGINE=EEVEE \
BLENDLINK_NOISE_FIELD_FOCUS=1 \
BLENDLINK_NOISE_FIELD_TABLE_CONTROLS=1 \
BLENDLINK_NOISE_FIELD_TABLE_EXPERIMENT=1 \
BLENDLINK_NOISE_EVIDENCE=/absolute/evidence/raw \
npm exec --yes --package=node@24 -- node experiments/noise-fractal-differential/run.mjs --built
```

Repeat with `BLENDLINK_NOISE_NORMALIZED=1`. The controls add actual native HDR,
5×7 / 7×5 images, negative/positive repeated UV windows, and independent input
image references. For the admission-cap run, additionally set
`BLENDLINK_NOISE_FIELD_CAP=1 BLENDLINK_NOISE_REFERENCE_SIZE=128`; its source
contains 16,384 unique normal half-representable coordinate points and a native
residual-amplification reference. Default proof size remains 64.

Retained native references can be replayed with `--reuse-reference`. On macOS,
use `/private/tmp/...` evidence paths so Vite's canonical filesystem allow list
matches. `BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium` additionally exercises the
physical Metal Chromium profile; the default shell uses LLVM SwiftShader here.
Neither local profile is evidence for Linux Subzero.

The actual hosted failing FIELD_FOCUS references need only the opt-in
`BLENDLINK_NOISE_FIELD_TABLE_EXPERIMENT=1`; each rendered report row records
`fieldTables`. A successful canary must show the expensive field was actually
lowered, both real APIs completed, and all original budgets passed.

Additional checks:

```sh
npm exec --yes --package=node@24 -- node experiments/noise-field-kernel/check-table.mjs /absolute/check-evidence /absolute/raw/reference
npm exec --yes --package=node@24 -- node experiments/noise-field-kernel/compare-unadmitted.mjs /absolute/raw/reference /absolute/compat-evidence
npm exec --yes --package=node@24 -- node experiments/noise-field-kernel/stress.mjs /absolute/raw/reference /absolute/ownership-evidence
npm exec --yes --package=node@24 -- node experiments/noise-field-kernel/capture.mjs /absolute/raw/reference /absolute/shader-evidence cycles-fbm-raw-4d-color-image-4 --built --table
```

The capture command records compiled shader source from the immutable copied
harness. Omitting `--table` measures the baseline; `--schedule` is the explicitly
failed loop experiment. The ownership check needs a raw FIELD_FOCUS corpus that
includes the Cycles ID shown above; the native EEVEE-only controls use different
IDs. Compatibility checks intentionally compare bytes, not native fidelity, for
legacy inputs and rejected fresh inputs.

## Local evidence

Worker evidence is retained beneath `artifacts/verification-field-kernel/`:

- `final-proof{42,52,53}-{raw,normalized,cap-raw,cap-normalized}`: 90 actual native
  graphs, 180 readbacks across WebGPU/WebGL2. Original budgets are unchanged;
  maximum error/budget ratio is 0.987. Input controls and EEVEE carrier precision
  checks remain mandatory. Native build hashes are a51f293548ad (4.2),
  fbe6228777e7 (5.2), and 02f0899d78e3 (5.3).
- `physical53-*`: 60 additional readbacks across both physical Metal APIs. These
  preceded the final scalar-key-only admission narrowing; the native data and
  numerical kernel are identical.
- `table-parity-{raw,normalized}`: unchanged retained failing Linux native
  references replayed locally, 34 readbacks. This is a retained-reference replay,
  not fresh Linux execution.
- `unit-final-2`: 29 admission/read-only/HDR/sampling checks.
- `compat-final-3`: both APIs on LLVM and physical Metal, 393,216 Float32 words
  compared bit for bit for two legacy documents and four rejected fresh inputs.
- `stress-final`: 70 alternating reapply/resize/release draws. Changed immutable
  source data changes output; repeated inputs reproduce pixels. Owned texture
  count is one for the table and zero after plain-color replacement; renderer
  texture count is two/one including the target. Resize 128→32→64→128→64 is stable.

The raw field shader shrank from 24,125 to 2,441 WGSL bytes (22,012 to 2,315 GLSL
bytes), with 21 to zero expanded 4D Perlin calls. At 4,096 texels / 2,048 unique
points, CPU preparation measured about 60–66 ms and the table occupies 64 KiB.
At the 16,384 unique-point cap, CPU preparation measured about 405–423 ms and
the table occupies 256 KiB; total first render/readback was about 475–481 ms in
the final LLVM cap runs. That byte count is the GPU table payload, not total JS
heap usage: construction also temporarily owns output arrays and a memo map.
No process-global table cache is added. Observed raw RGB spans −5.214 to +5.313.

The worker's complete unit suite passed 1,301 tests (five pre-existing skips)
and 25 release-policy tests. Actual Linux Subzero field proof is still pending.
