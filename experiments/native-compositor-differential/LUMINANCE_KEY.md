# Native Luminance Key

`CompositorNodeLumaMatte` now has an independent live pointwise expression for
both Image and Matte. It uses the source OCIO luminance coefficients, maps
luminance through the authored threshold interval, caps the result by the
incoming alpha, and multiplies **all four** image channels by that matte.
Negative/HDR color and negative or above-one alpha are preserved; the matte is
not silently replaced with an ordinary opacity clamp.

Blender 4.2's CPU compositor tests the endpoints before dividing. Its GPU
compositor and modern 5.2/5.3 schemas use a clamped ramp. The exporter records
these models separately. Modern reversed thresholds are tested. Legacy RNA
constrains threshold assignment; the fixture records the actual assigned
state and does not manufacture an unavailable legacy setting.

This first domain requires finite fixed thresholds in [0,1], separated by at
least 1/64. Modern linked static Value/qualified Math inputs can supply a
proven constant; changing or unproved threshold inputs refuse with the artist
node and socket. Narrow or collapsed intervals refuse instead of using an
epsilon or accepting undefined division. Animated/driven reachable controls
retain the compositor's existing refusal. These limits make this a partial
node port, rather than full arbitrary-graph coverage.

## CPU precision and compatibility

The original `native-luminance-key-v1` arithmetic has a retained HDR
counterexample: RGB `(0.1414213478565216, …)` with thresholds `.1/.2` and alpha
`2^60` exposes a one-ULP ramp difference. RGB `(.1,.2,.3)` also distinguishes
the CPU's separately rounded dot stages from a GPU dot. The original 206-scene
check below did not establish accuracy for arbitrary HDR amplification.

Fresh **measured** CPU sources now use `native-luminance-key-cpu-rne-v1`.
This is initially restricted to Blender 4.2.0, 5.2.0 and 5.3.0 on
`darwin/arm64`, with the actual Rec.709 Float32 coefficient tuple and an
independently checked source rounding-mode certificate. The measured 4.2/5.2
profiles preserve gradual underflow; the measured 5.3 profile flushes
subnormal inputs/results. The exporter checks the actual mode rather than
selecting it from the version alone, and the runtime independently rejects
unmeasured version/platform/mode combinations. Native compositor task controls
correlate the certificate with actual RGBToBW, Multiply, Add and Divide
outputs, including tiny values, cancellation and signed zeros.

The new expression preserves the CPU's three rounded products and left-ordered
adds, uses a private correctly rounded bounded ratio, and applies the source
underflow behavior to the **final RGB and alpha products**. A private integer
fallback recovers gradual underflow; ordinary normal pixels take the hardware
path. The default zero-to-one ramp remains supported. No shared Math,
Distance or generic division implementation changes.

Modern GPU all-constant graphs use this path only through their actual CPU
fold; spatial GPU and legacy GPU arithmetic retain v1. Existing v1 documents
retain their original semantics. Unqualified fresh CPU sources also retain
v1, explicitly tagged `legacy-unqualified-cpu-v1` with a
`SOURCE_ADMISSION_NA` reason. Separately qualified Linux and Windows CPU sources
are listed below; all unmeasured profiles retain v1. Persisted legacy reversed
CPU ramps also retain explicit v1+N/A; actual 4.2 RNA constrains reverse
assignment, so no native reversed-authoring proof is claimed.

The initial three-version source corpus contains 358 scenes across all three native
versions/devices. Both APIs on physical Metal and SwiftShader pass **1,432
readbacks**, numeric maximum error **0**, with the original `2e-5` acceptance
budget unchanged. Dense primitive checks additionally compare 655,360 scalar
outputs across the four browser profiles, including exact IEEE word controls.
These are finite-result scene-linear checks, not a claim about arbitrary
unbounded graph amplification or NaN payloads. Dedicated source-admission and
experimental-host evidence are deliberately counted separately.

## Native references and browser checks

The fixture authors independent signed/HDR RGBA input, zero/tiny/negative alpha,
RGB primaries, exact and adjacent Float32 threshold levels, constants and
fields, both outputs, group traversal, cascades, Matte-to-alpha use and shifted
finite image windows. It fingerprints source nodes, sockets, groups and links
before/after extraction. Native output is rendered to Float32 EXR and retained
separately from browser readback. The unused scene is EEVEE; compositor CPU and
GPU are independent source evaluation contracts.

All three native versions pass: 21 scenes per device in 4.2 and 41 per device
in 5.2/5.3, 206 native scenes total. Both browser APIs pass in each recorded
environment, Apple M5 Pro Metal and LLVM SwiftShader: **824 readbacks**. Maximum
absolute error is **5.960464477539062e-7**, below the unchanged **2e-5** compositor
budget. Actual WebGPU adapter/WebGL renderer information, browser version,
launch arguments and harness hashes are recorded. Native qualification files
record the Blender build, source backend and exact fixture/extractor hashes.

Generate one version/device with an actual Blender executable:

```sh
BLENDLINK_COMPOSITOR_LUMINANCE_KEY_DEVICE=CPU \
BLENDLINK_COMPOSITOR_LUMINANCE_KEY_REFERENCES="$PWD/artifacts/luminance-key/cpu" \
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_luminance_key_check.py
```

Repeat with `GPU`, then build and compare the unchanged references:

```sh
npm run build
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/luminance-key/browser \
  artifacts/luminance-key/cpu artifacts/luminance-key/gpu
```

Use Node24. Set `BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium` for bundled full
Chromium; omit it for the headless shell. The captured adapter identifies the
actual device, independently of the channel. Existing compositor cases can use
the same runner; pixel and shader-error acceptance are unchanged.

The regular compositor parity shard includes both source devices where native
GPU compositing is available. The isolated installed-extension probe also
extracts Luminance Key, catching missing package-qualified sibling imports.

## Semantics references

These upstream implementations define the native behavior being measured;
the runtime independently expresses the elementary luminance-ramp mathematics:

- [Blender 4.2 CPU compositor](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_LuminanceMatteOperation.cc)
- [Blender 4.2 GPU compositor](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/realtime_compositor/shaders/library/gpu_shader_compositor_luminance_matte.glsl)
- [Blender 5.3 native function](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_luminance_key.cc)
- [Blender 5.3 GPU compositor](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/shaders/library/gpu_shader_compositor_luminance_matte.glsl)

Linux5.2 `x86_64` build`fbe6228777e7`, actual gradual-RNE and Rec.709 is now
qualified by a fresh actual-production receipt:79 cases/API, including32
bit-exact precision programs, zero error on WebGPU and WebGL2. Source/runtime
build checks remain independent. Its old47 ordinary/32 private-kernel trial
receipt stays `SOURCE_ADMISSION_NA`; no historical receipt was relabelled.
Windows CPU compositor sources also qualify only `win32/AMD64`, actual
gradual-RNE/Rec.709, Blender 4.2.0 build `a51f293548ad` or 5.2.0 build
`fbe6228777e7`. Fresh production verification passed 53/79 cases per browser API,
each including 32 bit-exact precision cases, with zero error. Windows GPU
single-value CPU folding and every unmeasured profile retain v1+N/A. The earlier
Windows private trials retain zero production admission; the initial Mac counts
above are unchanged. See [the production receipts and scope](../luma-cpu-precision/README.md#windows-cpu-production-qualification).
