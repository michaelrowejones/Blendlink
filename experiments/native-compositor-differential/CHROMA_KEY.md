# Native Chroma Key: qualified soft key

`CompositorNodeChromaMatte` has a partial live port for **Blender's CPU
compositor with Minimum (legacy Cutoff) exactly zero**. The default positive
cutoff remains unsupported. Neither extraction nor playback changes authored
values to enter this domain; the diagnostic names the required setting.
GPU-authored source compositing, including all-constant modern graphs, also
refuses explicitly. Browser playback uses WebGPURenderer with either WebGPU or
WebGL2; that browser choice is separate from Blender's source compositor device.

The live operation projects BT.709 Cb/Cr onto the fixed key's chroma axis,
applies the authored acceptance wedge and falloff, caps the matte by source
alpha, and multiplies the entire RGBA image by that matte. Negative matte and
signed/HDR image values are retained. Alpha above one is not silently clamped:
outside the wedge, alpha 3 produces Image alpha 9. The key's alpha is unused
numerically. Legacy Lift/Shadow Adjust storage is inactive in this algorithm
and remains untouched.

## Domain and source preservation

- Maximum / legacy Acceptance is a finite fixed Float32 angle in
  [pi/32, pi/2]; Falloff / legacy Gain is in [1/64, 1].
- The finite fixed key has RGB in [0,1] and normalized BT.709 chroma magnitude
  at least 1/32. Near-neutral keys remain unsupported.
- Modern scalar controls accept unlinked values or direct Value nodes. Key
  RGBA accepts an unlinked value, RGB node, or RGB Combine Color whose four
  channels are unlinked/direct Value constants. Key alpha may be any finite
  constant. A spatial or unsupported unused alpha branch cannot bypass graph
  validation.
- Image can remain a live image field or constant. Both Image and Matte
  outputs, multiple differently configured instances and cascades are measured.
- Existing animation/driver and image-origin/domain restrictions still apply.
  This is soft chroma suppression, not full Keying, spill correction, temporal
  matte processing or a guarantee for arbitrary Float32 combinations.

Legacy CPU YCbCr normalization multiplies a rounded reciprocal; modern CPU
divides. The private fresh runtime model preserves those separate stages and
corrects reciprocal-division residuals. Native scalar C math prepares only
the fixed key basis and maximum-angle coefficient during extraction, retaining
the producing CPU's sinf/cosf/tanf/sqrtf/atan2f results. No image/matte values are
baked. Missing native scalar functions or malformed prepared coefficients
refuse. Existing shared color operations and older serialized models are
unchanged.

The seeded native fixture uses factory-isolated Blender, EEVEE as the scene
renderer, CPU full-precision compositing, and independent Float32 EXR output.
It checks property/socket/link/custom-property fingerprints before and after
extraction. Cases include primary and picked keys, both outputs, field/constant
images, unlinked/RGB/Combine Color key sources, ignored negative/zero/HDR key
alpha, inactive legacy controls, fixed linked modern controls, control-domain
endpoints, acceptance-boundary neighbors, signed/HDR alpha and cascades.
Unsupported positive cutoffs, source GPU, spatial key/control inputs,
near-neutral keys and unqualified scalar ranges get read-only refusal checks.

Each of Blender 4.2, 5.2 and 5.3 generates **122 native scenes**. The retained
built-runtime proof runs all 366 scenes on recorded Apple M5 Pro Metal and LLVM
SwiftShader, each with WebGPU and WebGL2: **1,464 graph readbacks**. Source/native
build identifiers, adapter information and immutable whole-program SDK bytes
are recorded separately. Maximum absolute error is 4.76837158203125e-7 on Metal and zero on
SwiftShader. The acceptance budget remains 2e-5 absolute.

## Retained hard-cutoff counterexamples

Positive Minimum is a binary angular decision. A one-ULP difference in native
atan2 or the browser implementation can change matte by approximately 0.83,
rather than merely changing a color by an ULP. The full-CPU boundary corpus
found legacy picked-cyan failures on Metal and modern picked-key failures on
SwiftShader. A correctly rounded ideal-angle midpoint reformulation also
failed: native legacy atan2f itself can differ from double-atan2 rounded to
Float32. Neither an epsilon nor a wider pixel tolerance resolves that contract.

Development evidence under `artifacts/chroma-key/` retains
`original-atan2-all-metal`, `original-atan2-all-software`,
`cutoff-cpu-metal` and `source-unit-physical` with their original native inputs,
reference pixels and tested bytes. GPU-source failures persist even with
unit-range alpha. Those candidate routes are unpromoted; the production
source and installer/runtime guards reject them.

An additional cascade regression protects the shader-function boundary:
one module-level parameterized kernel per schema prevents duplicate named
function declarations and accidental reuse of another instance's coefficients.
Captured cascade shaders and their actual output are retained in the final
browser reports.

## Reproduce

Generate references once with each actual Blender version:

```sh
BLENDLINK_COMPOSITOR_CHROMA_KEY_REFERENCES="$PWD/artifacts/chroma-key/cpu" \
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_chroma_key_check.py
npm run build
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/chroma-key/browser artifacts/chroma-key/cpu
```

Pass all three reference directories to test them together. Repeat playback
with `BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium` for full bundled Chromium;
record the returned adapter rather than inferring hardware from the channel.
The default headless shell was measured separately as SwiftShader.

Primary native contracts being measured:

- [4.2 CPU Chroma Matte](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_ChromaMatteOperation.cc)
- [4.2 conversion/alpha graph](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/nodes/COM_ChromaMatteNode.cc)
- [5.2 Chroma Key function and sockets](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/composite/nodes/node_composite_chroma_key.cc)
- [CPU RGB/YCbCr conversion](https://github.com/blender/blender/blob/v5.2.0/source/blender/blenlib/intern/math_color.cc)
- [GPU contract, currently unqualified](https://github.com/blender/blender/blob/v5.2.0/source/blender/compositor/shaders/library/gpu_shader_compositor_chroma_matte.glsl)
