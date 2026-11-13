# Native terminal compositor affine domains

This fixture earns a bounded live Transform / Rotate / Relative Scale slice.
It does not claim every native image-window operation. The existing v1 integer
and v2 translation-only programs retain their original runtime paths.

## Supported contract

- Blender 5.2 and 5.3 sampling-menu nodes, modern deferred
  compositor domains. CPU and calibrated native Metal GPU are distinct models.
- Fixed unlinked scalar parameters; Nearest or Bilinear with Clip on both axes.
- Authored angle between `-float32(2*pi)` and `float32(2*pi)`, positive per-axis
  scale 0.125–8, translation ±8192 pixels. Composed linear and inverse-linear
  coefficients must remain bounded by 64; composed location remains ±8192.
- Equal source/render physical extents, 1–8192 pixels per axis; repeated resize,
  repeated content updates, portrait extents, and pixel-ratio changes are live.
- Terminal transform chains preserve the full unfiltered source until the actual
  output realization. Operations before that chain remain ordinary inputs.
  Alpha and signed/HDR RGB follow the same raw RGBA32F sampling operation.

Intermediate affine consumers (including Exposure, Blur, and Alpha Over) are
explicitly refused: native modern operations first realize the linear part into
resized integer data/display windows. Silently operating in the original crop
would lose pixels and change subsequent filtering. The separate host algebra
also proves these bounding windows against native Exposure scenes; a live
extent-aware render-target path is still required before enabling such graphs.

Legacy 4.2 immediate affine canvases, OpenGL/unknown GPU samplers, render borders,
linked parameters, Bicubic, extension/wrap modes, nonpositive scales, absolute or
render-size Scale modes, unbounded compositions, and mixed old-v1/new-affine
programs remain named refusals. Fresh extraction is read-only. Existing old-v1
programs are still readable without adopting this new contract.

## Native math and precision

Primary native sources are Blender's `node_composite_transform.cc`,
`node_composite_rotate.cc`, `node_composite_scale.cc`,
`BLI_math_matrix.hh`, `BLI_math_matrix_types.hh`, `BLI_bounds.hh`,
`COM_realize_on_domain_operation.cc`, and its `realize_on_domain` GPU shader.
The source revisions used here are 5.2 `fbe6228777e7` and 5.3 `02f0899d78e3`.
The pinned 5.3 Eigen dependency is `8a1083e9bf41b91fdea6546681f806154efdc25a`;
its `InverseImpl.h` supplies the float3x3 cofactor/inverse-determinant path.
Relevant upstream trees: [Blender 5.2](https://projects.blender.org/blender/blender/src/commit/fbe6228777e7/source/blender),
[Blender 5.3](https://projects.blender.org/blender/blender/src/commit/02f0899d78e3/source/blender).

The emitter uses scalar native C `sinf/cosf` on the authored Float32 angle.
`mathutils.Matrix.Rotation` has a different angle-wrapping path: using it changes
the endpoint residual at pi/2. Host matrix composition, BLI translation order,
Eigen inversion, input/output half-pixel centers and Nearest corrective bias are
independently rounded Float32 operations. A native equal-domain epsilon shortcut
is applied only at realization, preserving residuals during chain composition.

CPU coordinates use separately rounded products, then two rounded additions.
A 128 KiB, 256×32 RGBA32F table stores the two pairs of axis products, refreshed
only on extent changes. The shader observes Float32 boundaries in interpolation
weights, products and pairwise additions. CPU neighbor indices are independently
`floor(float32(coordinate+1))`; substituting `floor(coordinate)+1` changes pixels
near zero.

The public native GPU compute control proves matrix evaluation as nested-right
FMA: `fma(a,x,fma(b,y,c))`. The affine-specific portable FMA retains a second
residual and sticky bit at Float32 halfway boundaries. It leaves the existing
Noise helper unchanged. Eight counterexamples are retained where reusing that
helper would change a coordinate ULP and cross an 8-bit sampler phase boundary.
GPU bilinear phase is quantized before subtracting the half pixel. Shader
half-up rounding avoids `floor(z+.5)`, whose Float32 addition can itself round
across a bin threshold. Raw compositor RGBA32F interpolation remains separate
from image-node byte/half texture models. Bilinear output is numerically bounded,
not claimed bit-exact; the independent coordinate controls are bit-exact.

The coordinate helper is limited to finite bounded matrix operands, pixel
coordinates ≤8192, and coefficients/offsets either zero or |value|≥2^-50. The
runtime validates the normalized coordinate matrix, including after resize.
It is not a general overflow/subnormal FMA API.

## Reproduce

Use official Blender executables and Node 24. From the repository root, generate
each 5.2/5.3 CPU and GPU corpus separately:

```sh
BLENDLINK_COMPOSITOR_AFFINE_REFERENCES=/absolute/evidence/53-cpu \
BLENDLINK_COMPOSITOR_AFFINE_DEVICE=CPU \
"/absolute/Blender.app/Contents/MacOS/Blender" --background --factory-startup \
  --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/compositor_affine_check.py
```

Replace CPU with GPU for calibrated Metal, and use the corresponding official
version executable. 4.2 emits three read-only refusals and an explicit
not-applicable report rather than claiming native affine parity. Native scene
context selects EEVEE, with injected float Image data and 32-bit RGBA EXR output;
this isolates compositor semantics and is not a certification of EEVEE rendering.

Run source parity, build, then verify the emitted runtime:

```sh
npm exec --yes --package=node@24 -- node \
  experiments/native-compositor-differential/run.mjs \
  /absolute/evidence/52-cpu /absolute/evidence/52-gpu \
  /absolute/evidence/53-cpu /absolute/evidence/53-gpu --out /absolute/source-proof
npm exec --yes --package=node@24 -- npm run build --workspace blendlink
npm exec --yes --package=node@24 -- node \
  experiments/native-compositor-differential/run.mjs --built \
  /absolute/evidence/52-cpu /absolute/evidence/52-gpu \
  /absolute/evidence/53-cpu /absolute/evidence/53-gpu --out /absolute/built-proof
```

The shared runner freezes every production module, checks whole-program emit
provenance in built mode, copies each native reference byte-for-byte, and
strictly requires actual WebGL2 and WebGPU. Each new scene enforces ≤2 passes,
≤25,000 fragment-source bytes, no shader/device/page errors, exact input
calibration, caller MRT/viewport/scissor restoration, and zero retained textures.
Twelve resize sequences include changed content at the same size, a high-DPI
frame, an intentionally mismatched source/render extent, and recovery.

For independent coordinate arithmetic, first generate the investigative native
pixel corpus with `BLENDLINK_AFFINE_NATIVE` and `BLENDLINK_AFFINE_DEVICE=GPU`
using `native.py`. `analyze-gpu.mts` writes real sampling matrices plus independent
random/sticky/wide bound controls to `coordinate-input.json`. Feed that file to
the public GPU compute probe:

```sh
npm exec --yes --package=node@24 -- node --experimental-strip-types \
  experiments/native-compositor-affine/analyze-gpu.mts /absolute/native-pixels
BLENDLINK_AFFINE_COORDINATE_INPUT=/absolute/native-pixels/coordinate-input.json \
BLENDLINK_AFFINE_COORDINATE_OUTPUT=/absolute/native-coordinates.json \
"/absolute/Blender.app/Contents/MacOS/Blender" --background --factory-startup \
  --python-exit-code 1 -t 1 \
  --python experiments/native-compositor-affine/gpu-coordinates.py
npm exec --yes --package=node@24 -- node \
  experiments/native-compositor-affine/run-coordinates.mjs \
  /absolute/native-coordinates.json /absolute/coordinate-proof --accurate --built
```

Omitting `--accurate` intentionally tests the older Noise FMA as a negative
control; the sticky cases must fail. `analyze.mts` is the independent host-side
CPU matrix/window/sampler differential. The mathematical host investigation
does not substitute for the production emitter/runtime proof above.

## Current evidence

Official native versions: 4.2 `a51f293548ad`, 5.2 `fbe6228777e7`, and 5.3
`02f0899d78e3`, macOS arm64. Final affine corpus is 175 scenes per device on
5.2 and 5.3: 700 total, plus 22 read-only refusal cases per
modern version/device and three legacy refusal cases per device. Matched native
CPU/GPU canaries differ in 85 scenes per version, so the proof distinguishes
native GPU execution from CPU fallback. No expected pixels are synthesized by
the production implementation.

The independent Metal compute proof contains 158 matrices and 966,092 coordinate
components, including 8192×1, 1×8192, 8191×1, 1×8191 and 257×255 controls.
The portable helper matches every Float32 bit, including zero signs, on both
browser APIs in source and built modes. The older helper fails four sticky
matrix controls, retained separately as negative evidence.

All 700 final scenes pass the built runtime on both APIs: 350 CPU scenes are
exact (maximum absolute error zero), and 350 Metal scenes have maximum error
`4.76837158203125e-7`. Both APIs preserve caller state, report no shader/device/
page errors, and retain no textures. The largest measured fragment source is
23,307 bytes; every scene uses at most two passes. The retained 1,744 old v1/v2
transform scenes also pass both APIs, maximum error `7.62939453125e-6`.
