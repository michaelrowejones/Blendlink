# Native Wave Texture parity

The fixture creates actual Blender material graphs and renders them through
Cycles CPU and EEVEE. The browser evaluates their emitted live TSL programs
through both WebGPU and the WebGL2 backend of WebGPURenderer. No browser material
is baked for this proof.

```sh
BLENDLINK_BLENDER=/path/to/blender \
BLENDLINK_WAVE_EVIDENCE=artifacts/verification-wave \
node experiments/wave-node-differential/run.mjs
```

`--built` verifies shipped JavaScript after the coordinated package build;
`--reuse-reference` replays native pixels/IR already in the evidence directory.
Every runtime module is captured immutably. The shared `--built` guard emits the
whole TypeScript program and rejects stale dependency-inlined values even if
old dist files have fresh timestamps. Runtime/native module hashes, native
version/device, exact tested bytes, source maps and native pixels are retained.
Vite HMR/file watching is disabled. `BLENDLINK_TEST_CHROMIUM_ARGS` accepts a JSON
array of additional browser arguments.

The corpus covers both wave types, all four directions of each, SIN/SAW/TRI,
Color and Factor, linked positive/negative/zero Distortion, static negative/zero
Distortion, linked Scale/Detail Scale/Phase, fractional and integer Detail, and
linked Detail Roughness. Inputs are nearest-sampled exact half-representable
images. An independent image carrier uses an exact positive affine transform,
so negative source coordinates can be checked without negative Emission clipping.
Independent EEVEE constant carriers establish its final half-float target bound.

Linked Roughness uses the same statically unrolled normalized amplitude sum as
Blender. It is admitted only when both emitter and runtime can establish [0,1]
from the actual expression. Native Wave does **not** clamp linked Roughness just
because the input's UI limits are 0 and 1. An explicit artist-authored Clamp
MINMAX/RANGE, bounded image/Noise/Color Ramp output or other proven convex
expression can establish the range. An untrusted annotation cannot. Unknown
live ranges and negative/HDR linked Roughness remain explicit refusals because
native normalization may be singular. The compiler does not silently insert a
clamp. Distortion zero prunes the entire dead fractal dependency, including
otherwise unsupported Detail/Roughness inputs.

Detail remains static in [0,2]; negative or linked Detail and higher-octave distortion
remain named limitations because earlier native comparisons measured phase
precision divergence there. This batch does not claim the remaining high-octave
Wave domain or all Noise Texture modes.

Fresh Wave programs opt into `precisionModel: portable-f32-v1` for SIN. This
reuses the separately tested generic rational phase reduction and factorial
sine polynomial through |angle|<=8192. Larger arguments use the prior intrinsic;
no phase accuracy claim is made there. Older Wave documents retain their
intrinsic interpretation. The initial native corpus caught a browser intrinsic
sine discrepancy even with Distortion0; fixing the implementation removed it
without widening the comparison budget.

The strict maximum absolute error budget is2e-5. EEVEE adds one independently
verified native final-target half ULP per pixel. Node arithmetic and native table
precision are separate; there is no UV rasterization or generic backend-error
allowance. Current Blender4.2/5.2/5.3 proofs each pass108graphs on both browser backends,
Cycles maximum3.815e-6 across all three versions. The central release gate
repeats the corpus on its installed native version.
These local native EEVEE runs use Metal; hosted software OpenGL is a separate
platform check. This requires WebGPURenderer; legacy WebGLRenderer cannot consume
live TSL programs.

Admission/dead-input checks run with:

```sh
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/wave_translation_check.py
```

The Wave phase and normalized fBM follow Blender's primary implementations:
[Cycles Wave](https://github.com/blender/blender/blob/v5.3.0/intern/cycles/kernel/svm/wave.h),
[Cycles fBM](https://github.com/blender/blender/blob/v5.3.0/intern/cycles/kernel/svm/fractal_noise.h),
[GPU Wave](https://github.com/blender/blender/blob/v5.2.0/source/blender/gpu/shaders/material/gpu_shader_material_tex_wave.glsl).
