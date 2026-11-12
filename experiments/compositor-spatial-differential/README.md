# Discrete native compositor spatial operations

Flip preserves exact full-frame pixels. Blender 4.2's X/Y/XY property and modern
fixed Flip X/Flip Y Boolean inputs normalize to `native-flip-v1`. Unknown modes,
malformed flags, animation, and linked axis selectors refuse. Constant images
and identity axes remain passthrough expressions. Signed/HDR color and hidden
color at zero alpha are retained.

A mapped texture load is returned as a field expression. Three's
`convertToTexture` returns TextureNode inputs unchanged, so returning a bare
mapped TextureNode would let a later spatial operation discard its mapping when
it calls `.load()` again. A materialization boundary preserves the evaluated
field for Flip cascades and Flip → Blur. It owns its RTT material and render
target; it never takes ownership of caller textures.

Actual CPU/Metal fixtures cover 13×7 images, all axes, constants, Exposure →
Flip, Flip → Posterize, Flip → Alpha Over, Flip → Flip, Blur → Flip, and Flip →
Blur. All 182 graphs across Blender 4.2/5.2/5.3 passed both built browser
backends, maximum absolute error 4.76837158203125e-7. Every graph verifies zero
remaining textures and caller MRT/clear-state restoration. Single Flip and
other cases are bounded at four measured draw passes including the caller-state
probe; Flip → Blur allows the one additional materialization pass (five), with
fragment shader sizes below 12,000 bytes. These are scene-viewport image-domain
operations, not support for expanded/transformed image domains or other spatial
node families.

```sh
BLENDLINK_COMPOSITOR_FLIP_REFERENCES=artifacts/flip-cpu \
  blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_flip_check.py
BLENDLINK_COMPOSITOR_FLIP_REFERENCES=artifacts/flip-gpu \
BLENDLINK_COMPOSITOR_FLIP_DEVICE=GPU \
  blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_flip_check.py
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/flip-browser artifacts/flip-cpu artifacts/flip-gpu
```

## Native enhancement Filter

The fixed Soften, Box Sharpen, Diamond Sharpen, Laplace, Sobel, Prewitt,
Kirsch and Shadow kernels normalize to `native-filter-v1`. Factor stays a live
field, including negative and greater-than-one values. Each nine-tap load
clamps to the input image boundary. Legacy CPU edge accumulation order and
nonnegative channel clamping differ from modern/GPU evaluation; the runtime
keeps those paths explicit. Modern single-value Image inputs bypass filtering
even when Factor is a field. A uniform image texture still undergoes filtering.

Fresh native CPU and Metal fixtures contain 217 graphs per device/version:
signed 13×7 random and impulse images, positive/negative constants, hidden RGB,
zero/negative/HDR alpha, six Factor cases, Flip → Filter, Filter → Posterize,
and Filter → Blur. All 1,302 graphs across Blender 4.2/5.2/5.3 pass both source
and built browser backends, maximum absolute error 9.5367431640625e-6.
Every graph checks texture cleanup, caller MRT/clear-state restoration, at most
five measured draw passes including the state probe, and fragment shaders
below 20,000 bytes. Linked kernel menus, animation, expanded/transformed image
domains, and GPU Half precision do not have an admitted contract.

```sh
BLENDLINK_COMPOSITOR_FILTER_REFERENCES=artifacts/filter-cpu \
  blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_filter_check.py
BLENDLINK_COMPOSITOR_FILTER_REFERENCES=artifacts/filter-gpu \
BLENDLINK_COMPOSITOR_FILTER_DEVICE=GPU \
  blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_filter_check.py
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/filter-browser artifacts/filter-cpu artifacts/filter-gpu
```
