# Color Correction region-boundary division

Blender's native Color Correction implementation uses an ordered chain of
piecewise-linear branches. It does not use `smoothstep` or divide by the
Midtones Start/End interval width. Equal, reversed and overlapping intervals
therefore remain supported. See the pinned [4.2 GPU implementation](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/realtime_compositor/shaders/library/gpu_shader_compositor_color_correction.glsl)
and [5.2 GPU implementation](https://github.com/blender/blender/blob/v5.2.0/source/blender/compositor/shaders/library/gpu_shader_compositor_color_correction.glsl).

The native Linux OpenGL corpus exposed a one-ULP quotient difference that can
switch an entire grading region. For float32 `x = nextafter(0.6, -infinity)`,
the rounded RGB sum is 1.7999999523162842. Dividing by 3 gives
0.5999999642372131, while multiplying by the rounded reciprocal gives
0.6000000238418579. The latter equals the rounded `0.5 + 0.1` boundary.
Choosing the other region changed the final channel by about 0.1; a looser
pixel tolerance or a comparison epsilon would conceal the wrong behavior.

Fresh extraction records `native_gpu_backend`. The OpenGL model uses the
existing compensated division helper to preserve the native quotient. CPU
execution keeps its existing division model, including modern constant
folding. Fresh Metal programs explicitly multiply by the float32 reciprocal,
including 4.2 all-constant GPU graphs whose browser compiler might otherwise
fold a division differently. Older untagged programs keep their existing path.
Unrecognized tagged GPU backends refuse by the artist's node name. This is a
measured source-backend distinction, independent of the browser backend.

Retained Linux 4.2/5.2 native GPU pixels cover 130 Color Correction graphs,
including all grading controls and the original collapsed/spatial failures.
Their captured native capability records identify OpenGL. Replay adds that
new provenance field without altering the native input or expected pixels;
original JSON hashes are retained with the evidence. Fresh Metal boundary
fixtures cover 10 graphs on 4.2 and 12 each on 5.2/5.3; modern fixtures include
linked spatial controls and CPU-folded constants. A fresh 5.3 CPU corpus adds
12 graphs. Both actual browser backends are checked with the existing 2e-5
absolute tolerance and exact alpha; no tolerance change is made.

```sh
BLENDLINK_COLOR_INTERVAL_REFERENCES=artifacts/color-interval/gpu \
BLENDLINK_COLOR_INTERVAL_DEVICE=GPU \
  "$BLENDER" --background --factory-startup --python-exit-code 13 \
  --python packages/blender-addon/tests/compositor_color_interval_check.py

node experiments/native-compositor-differential/run.mjs \
  artifacts/color-interval/gpu --built --out artifacts/color-interval/browser
```

The native test defaults to CPU and a temporary directory without these
environment variables. Built replay requires current whole-program emission
equality and immutable production module snapshots. It never rebuilds dist.
Evidence for this correction is under `artifacts/ci-color-interval/` in the
isolated worker, including native logs and retained-input provenance hashes.
