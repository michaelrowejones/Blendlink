# Unported chromatic GPU Color Key precision

These independent native GPU controls investigate a strict-predicate portability
gap. They do not change production extraction, replace pixels with a table, or
supply a fitted hue correction. General chromatic GPU Color Key still refuses;
the separate grayscale/dead-predicate port does not call HSV at all.

Blender's native Metal shader compiles with `fastMathEnabled = YES`. The captured
MSL uses the source RGB-to-HSV operations, with fixed node colors/thresholds in
uniform buffers. On Apple M5 Pro with Blender 5.3, the independently measured
uniform Key Color `(1, .25, .25)` has hue **4.967053879312289e-9**, rather than zero.
This matches the source-compatible fused expression
`f32(fma(.75, f32(1/.75), -1) * f32(1/6))`. A standalone HSV conversion of
`(1, .53125, .25)` yields .0625000074505806; subtraction of the tiny key hue
rounds to .0625. The same tiny key hue changes the wrap comparison at the
opposite seam. Public GPU compute controls reproduce the actual fused
compositor decisions, while independently returning the intermediate hues.

An explicit FMA prototype passes all 94 retained old GPU graphs on both
physical browser APIs. That is **not** sufficient qualification. Independent
GPU reciprocal controls expose native Metal's approximate reciprocal: for
`high = 3.734758138656616`, native `1/high` is .2677549719810486, while correctly
rounded IEEE Float32 is .2677549421787262. This changes saturation from
1.0922598838806152 to 1.0922600030899048. An actual authored Color Key with key
`(4,1,1)`, Hue=1, Value=1, and Saturation equal to the independently measured
difference from .75 preserves alpha .75 at that threshold; the correctly
rounded reciprocal model would key it. The next greater threshold keys it.
The `.blend`, actual input/output words and compiled Metal source are retained
under the isolated worker's `artifacts/counterexample53` and `Shaders` directories.
No tolerance widening resolves this categorical difference.

`native-fused-controls.py` renders actual EEVEE/GPU/FULL nodes and saves the
strict saturation witness as a `.blend`. `native-staged-controls.py` uses
Blender's public GPU API to measure dynamic scalar arithmetic and paired HSV
calls independently of the node port. `native-primitives.py` separately retains
multiple intermediate outputs, which itself prevents some compiler
reassociation; it must not be mistaken for the fused node. `stage_models.py`
compares a finite set of source-compatible IEEE/FMA hypotheses, not a learned
model; none establishes a general native fast-reciprocal contract.

For example, use the CPU corpus's independent input control (its image values
are also suitable as independent GPU inputs):

```sh
BLENDLINK_COLOR_KEY_PRIMITIVE_INPUT=/absolute/cpu-reference/blender-5-3-cpu-color-key-independent-control.json \
BLENDLINK_COLOR_KEY_PRIMITIVE_OUTPUT=/absolute/evidence/fused.json \
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup -t 1 \
  --python-exit-code 1 --debug-gpu-shader-source '*' \
  --python experiments/color-key-gpu-precision/native-fused-controls.py

BLENDLINK_COLOR_KEY_HSV_CONTROL=/absolute/evidence/fused.json \
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python experiments/color-key-gpu-precision/stage_models.py
```

Source capture writes `Shaders` in the command's working directory. The
staged-control script also copies per-kernel MSL when shader debugging is
requested. These controls have actual native outputs and GPU identity; they
are not claims that the current producer admitted chromatic GPU keying.

Primary sources: [GPU RGB-to-HSV](https://github.com/blender/blender/blob/v5.2.0/source/blender/gpu/shaders/common/gpu_shader_common_color_utils.glsl),
[GPU Color Key](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/shaders/library/gpu_shader_compositor_color_matte.glsl),
[Metal compiler options](https://github.com/blender/blender/blob/v5.2.0/source/blender/gpu/metal/mtl_shader.mm).
