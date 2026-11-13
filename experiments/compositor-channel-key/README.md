# Channel Key: qualified RGB profiles

`CompositorNodeChannelMatte` is live translated through the fresh `channel-key`
opcode and `native-rgb-channel-key-pow2-v1` model. Existing serialized programs
and shared color-conversion helpers are unchanged. This is a partial port.

## Artist scope

- RGB color space, all three key channels, Max or Single limiting, and all three
  Single limit channels. The default green / Max / Minimum 0 / Maximum 1 configuration
  is included. Inactive limit/color-space channel menus are not evaluated.
- Fixed Minimum and Maximum in [0,1], with Minimum < Maximum and a Float32
  difference that is a power of two in [1/64,1]. Modern socket defaults, scalar
  Value nodes and constant group inputs are included. Arbitrary expressions or
  animated/driven controls are refused. No authored setting is changed.
- Image and Matte outputs, constant or spatial image input, nested group inputs,
  differently configured cascades, and Matte into Set Alpha. Signed/HDR input
  RGB and alpha are preserved; there is no added alpha clamp.
- Blender 4.2, 5.2 and 5.3 source CPU compositing. Source GPU compositing is
  qualified only for these versions on Metal. Browser rendering supports both
  WebGPU and WebGL2 in the node renderer, with actual Apple Metal and SwiftShader
  adapters recorded by the browser harness. Source device and browser API are
  separate contracts.

HSV, YUV, YCbCr, dynamic menus, collapsed/reversed/nondyadic/narrower ramps,
unknown GPU backends and unknown GPU version models are named limitations.
Legacy CPU non-RGB Image output multiplies the converted color before converting
back; newer/GPU implementations multiply the original color. Aliasing these
routes would silently change the result. Image-domain composition remains
subject to the existing compositor's independent domain restrictions. Channel
Key does not opt into the fixed-Image RTT cache.

## Arithmetic and source evidence

Pinned native sources and SHA256 hashes are in [sources.json](sources.json).
The native schemas were probed by [probe_native.py](probe_native.py); actual
socket assignments, rather than global RNA enum lists, determine menu choices.

For the selected key channel `k` and limiting value `L`:

```text
delta = f32(k - L)
alpha = f32(1 - delta)
if alpha > Maximum: candidate = input alpha
else if alpha < Minimum: candidate = 0
else: candidate = f32(f32(alpha - Minimum) / f32(Maximum - Minimum))
matte = min(candidate, input alpha)
Image = original RGBA * matte
```

Max uses the maximum of the other two channels; Single selects its stated
channel. The comparisons are strict. Negative input alpha can yield negative
matte and positive Image alpha after multiplication; alpha above one can square.
Those results are native behavior, not values to normalize.

The dyadic span makes its reciprocal exact. Float32 stage barriers prevent the
browser compiler from contracting the CPU arithmetic. Native Metal was measured
to reassociate the interior numerator to `f32(f32(1 - Minimum) - delta)` while
retaining the rounded-alpha threshold comparisons. Blender 5.2 Metal retains the
CPU numerator staging when Minimum is linked, including literal Value nodes and
constant group inputs; unlinked Minimum uses the reassociated form. Blender 5.3
uses reassociation in both cases. Modern all-constant GPU graphs fold on the CPU,
so their CPU model is retained. The exported version and control provenance are
checked independently at runtime alongside the actual fixed scalar inputs.
These are measured numerical contracts; no claim about the compiler's internal
reason for the 5.2 distinction is required.

Both discarded models remain documented by artifact reports: CPU-only staging
failed exact alpha in 34 modern5.3 GPU-authored cases, and unconditional Metal
reassociation failed two 5.2 linked-Minimum/group cases. Color errors were below
2e-5, but alpha failures were not accepted or hidden by widening that budget.

## Reproduce

Build this worker with Node24, then generate each native reference directory:

```sh
BLENDLINK_COMPOSITOR_CHANNEL_KEY_REFERENCES=/absolute/reference-directory \
BLENDLINK_COMPOSITOR_CHANNEL_KEY_DEVICE=CPU \
/path/to/Blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_channel_key_check.py
```

Repeat with GPU and each available Blender 4.2/5.2/5.3 binary. The default success
sentinel is `BLENDLINK_COMPOSITOR_CHANNEL_KEY_PASSED`. The fixture also works
without the references environment variable, using temporary output.

For an unqualified native GPU backend, the fixture renders independent control
pixels plus native Image/Matte refusal references, preserves source, and emits
`BLENDLINK_COMPOSITOR_CHANNEL_KEY_SOURCE_PROFILE_REFUSED`. Its
`qualification.json` has `status: source-profile-refused`,
`protocol: blendlink-channel-gpu-source-profile-v1`, `cases:0`,
`numericalChannelCases:0`, `controlCases:1`, and hashed `profileRefusals`.
Its index contains only the independent control. Runners must report that as a
source-profile refusal, not a completed numerical Channel Key family.

Run all qualified native directories through the immutable built harness:

```sh
BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
npm exec --yes --package=node@24 -- node \
  experiments/native-compositor-differential/run.mjs --built \
  --out /absolute/browser-report /absolute/reference-directory ...
```

For the software profiles, also set
`BLENDLINK_TEST_CHROMIUM_ARGS='["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]'`.
The harness records actual adapters and whole-program TypeScript/source equality
for the copied runtime, then tests WebGPU and WebGL2 separately. No scene bake,
native composited-pixel substitution or tolerance widening is used.

## Retained qualification

The native corpus contains 175 graphs per 4.2 CPU/GPU and 181 per 5.2/5.3 CPU/GPU:
1,074 graphs total, 512 adversarial signed/HDR pixels per spatial field,486
Float32 threshold neighbors, exact-alpha enforcement, all RGB key/limit choices,
six ramps, constant folding, independent linked Minimum/Maximum cases, groups,
cascades and Matte-to-Alpha composition. Extraction fingerprints node properties,
custom data, socket defaults, links and group trees before/after. A real copied
add-on namespace extracts the same documents in all six source profiles.

The runtime suite also independently refuses forged controls/models/provenance,
wrong value/output types, unqualified GPU backends and nonliteral claimed
controls. Browser final reports live under `artifacts/channel-key/`; source
preservation and source-code hashes live in every native `qualification.json`.

The final built run passed all 1,074 graphs on each of Apple Metal WebGL2,
Apple Metal WebGPU, LLVM SwiftShader WebGL2 and LLVM SwiftShader WebGPU:
4,296 numerical readbacks, maximum absolute error 2.384185791015625e-7,
exact alpha (zero error), and zero shader/page/console errors. The aggregate
`artifacts/channel-key/qualification-summary.json` checks all native source
hashes against the tested source and reports zero drift. The full worker suite
passed 1,384 unit tests (five unrelated skips) and 29 release-policy tests.
