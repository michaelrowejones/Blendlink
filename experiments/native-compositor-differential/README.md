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

The gate discovers Blender, generates the three native compositor families, and
tests the built package on both browser backends. Evidence is retained under
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
TypeScript emission byte comparison for `tslSourceCompositor` and `tslNodeRecipe`.
`provenance.json` records source, expected emission, emitted module and extractor
SHA-256 hashes, plus the TypeScript version. Each reference records its Blender
version/build hash. A fresh output directory is generated when `--out` is omitted,
so simultaneous independent runs cannot overwrite each other's fixtures.

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
(`a51f293548ad`) and Blender 5.3.0 (`02f0899d78e3`). These provide distinct old
property-based and modern socket-based node schemas. Blender 5.2 is checked by
the repeatable CI gate rather than inferred from a 5.3 result.

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
- **Separate/Combine Color:** 45 legacy CPU, 39 modern CPU and 39 modern GPU
  references cover RGB/HSV/HSL, every separate output, alpha, roundtrips,
  constant and spatial combinations, out-of-range Hue, negative/HDR values,
  and legacy RGBA aliases. Both browser backends matched all 123 references
  within `1.91e-6`, with exact alpha and no shader validation errors.
  YUV/YCC and old HSVA/YUVA/YCCA aliases remain outside
  this port. Native HSL can be singular for some HDR inputs; these tests assert
  finite native references and do not claim meaningful results for non-finite
  native domains.

Device and version metadata are part of the conversion contract, not cosmetic
labels. Blender's CPU HSV conversion uses a triangular Hue basis while spatial
GPU HSV uses sextants; out-of-range Hue exposes the difference. An all-constant
GPU graph is constant-folded through the CPU function. Legacy combinations clamp
negative results where the corresponding modern CPU function preserves them;
modern spatial GPU HSL still clamps. Alpha remains an independent channel, with
no implicit unpremultiply. The tests include spatial inputs specifically to avoid
mistaking constant folding for proof of a GPU operation.

Native formulas can be inspected in Blender's
[CPU color functions](https://github.com/blender/blender/blob/v5.3.0/source/blender/blenlib/intern/math_color.cc),
[GPU color functions](https://github.com/blender/blender/blob/v5.3.0/source/blender/gpu/shaders/nodes/gpu_shader_common_color_utils.bsl.hh),
and [compositor channel nodes](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/shaders/library/gpu_shader_compositor_separate_combine.glsl).
Coverage of these tested families does not imply support for all compositor nodes;
see [the node translation inventory](../../docs/NODE_TRANSLATION.md).
