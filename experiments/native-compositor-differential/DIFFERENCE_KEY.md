# Native Difference Key

`CompositorNodeDiffMatte` has live Image and Matte outputs. The graph compares
the average absolute RGB distance of two images, applies the authored tolerance
and falloff, preserves the source alpha rules, and multiplies the whole RGBA
image by the matte. The second image's alpha is ignored. Signed/HDR RGB and
negative or above-one input alpha are retained.

Legacy Blender 4.2 CPU fully keyed pixels have zero matte, even for negative
alpha. Modern CPU and GPU paths retain the alpha cap there. At the upper
threshold, native opaque pixels retain the original alpha, including values
above one. These discontinuities make ordinary numerical endpoint error a
visible correctness bug rather than a harmless small color difference.

The CPU-source model explicitly stages its RGB sum and corrects reciprocal
division-by-three rounding with a two-sum residual. Each individual distance
is clipped to 12 inside this calculation only: tolerance+falloff is at most 2,
so those pixels are already opaque and their original image RGB/alpha remain
untouched. The correction avoids a measured one-ULP threshold crossing that
otherwise changed the legacy matte by 0.25. Modern GPU image fields keep their
own native arithmetic; modern all-constant graphs use the CPU evaluation model.

## Domain and proof

Tolerance/Falloff require finite fixed values in [0,1], with Falloff either zero
or at least 1/64. Modern static Value/qualified Math links can supply constants;
unproved or changing thresholds, narrow nonzero falloff and animated/driven
controls refuse. Existing different-origin image-domain limits remain in force.
This is a partial Difference Key port, not full Keying or temporal matte support.

The independent seeded native fixture checks both outputs, fields/constants,
two varying image inputs, reversed RGB channels, ignored key alpha, cascades,
zero falloff, exact/adjacent Float32 threshold levels, HDR-alpha upper endpoints,
and large HDR colors which exercise the bounded mean. Source nodes, properties,
sockets and links are fingerprinted before/after extraction. Original native
Float32 EXR pixels remain separate from browser output and failure baselines.

Blender 4.2, 5.2 and 5.3 each pass 39 native scenes per compositor device:
**234 native scenes**, or **936 browser readbacks** over recorded Apple M5 Pro
Metal and LLVM SwiftShader, WebGPU and WebGL2. Maximum absolute error is 0 in
this retained corpus, below the unchanged 2e-5 acceptance budget. This does not
claim every Float32 bit pattern, device or arbitrary graph combination.

The baseline legacy division failure is retained under the development
`browser-all-software` report, with immutable tested SDK bytes. Its two failures
are the 0.1/0.1 field Image and Matte cases; the corrected CPU profile also checks
the independent HDR-alpha upper-boundary cases. Hardware/software adapter,
browser/harness hashes, source backend and native build metadata are recorded.

## Reproduce

Use Node 24 and an actual Blender executable:

```sh
BLENDLINK_COMPOSITOR_DIFFERENCE_KEY_DEVICE=CPU \
BLENDLINK_COMPOSITOR_DIFFERENCE_KEY_REFERENCES="$PWD/artifacts/difference-key/cpu" \
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_difference_key_check.py
npm run build
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/difference-key/browser artifacts/difference-key/cpu
```

Repeat native generation with `GPU` and the other Blender versions. Full bundled
Chromium uses `BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium`; the default headless
shell is recorded separately. The regular compositor gate and installed-ZIP
import probe exercise the new helper and operation.

Native semantics being measured:

- [4.2 CPU operation](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_DifferenceMatteOperation.cc)
- [5.3 native function](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_difference_key.cc)
- [5.3 GPU operation](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/shaders/library/gpu_shader_compositor_difference_matte.glsl)
