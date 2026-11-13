# Native compositor alpha conversion

Set Alpha and Alpha Convert are live pointwise programs. Both native Set Alpha
modes (Apply Mask, Replace Alpha) and both conversion directions (To
Premultiplied, To Straight) preserve signed/HDR RGB, negative alpha, alpha above
one, and hidden RGB at exactly zero alpha. Unpremultiplication tests the actual
zero; it does not replace small alpha with an epsilon. Modern fixed menu sockets
and legacy mode/mapping properties normalize to an explicit `native-alpha-v1`
model; linked selectors and unknown models refuse with the artist node name.

The source-model audit uses Blender's `node_composite_set_alpha.cc` and
`node_composite_alpha_convert.cc`. Actual native execution, rather than the node
class or formula alone, earns coverage.

The fixture covers 59 graphs per device/version on Blender 4.2, 5.2 and 5.3:
13×7 signed images, zero and negative zero, alpha ±2⁻²⁴ and ±2⁻¹⁰, non-dyadic
fractional alpha, values outside [0,1], constant and spatial masks, native
constant-folded images, and conversion cascades. The unchanged alpha output of
Alpha Convert is checked exactly. Native CPU and Metal GPU references are
separate. All 354 graphs passed both built browser backends (708 graph/backend
pairs), maximum absolute error 4.76837158203125e-7. This is compositor channel
parity, not whole-scene lighting parity or other GPU driver certification.

```sh
BLENDLINK_COMPOSITOR_ALPHA_CONVERSION_REFERENCES=artifacts/alpha-cpu \
  blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_alpha_conversion_check.py
BLENDLINK_COMPOSITOR_ALPHA_CONVERSION_REFERENCES=artifacts/alpha-gpu \
BLENDLINK_COMPOSITOR_ALPHA_CONVERSION_DEVICE=GPU \
  blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_alpha_conversion_check.py
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/alpha-browser artifacts/alpha-cpu artifacts/alpha-gpu
```
