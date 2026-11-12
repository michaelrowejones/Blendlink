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
