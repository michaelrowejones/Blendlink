# Color Spill qualification

The live port preserves Blender's Color Spill image operation and original
alpha. It supports every R/G/B spill channel, Single limits from each R/G/B
channel, Average limits, fixed Limit Strength in [0,2], optional fixed custom
RGB strength in [-2,2], and live Image/Factor graphs. Inactive limit/custom
settings are ignored. Extraction never writes the source node's settings.
Linked selectors, changing controls and linked strength controls remain named
refusals. This is a partial node port, not a complete Keying implementation.

The Blender 4.2 CPU model upper-clamps Factor and scales the whole channel
difference. Blender 4.2 GPU and modern CPU/GPU instead scale the spill channel
before subtracting the limit. These are distinct source models. A zero Factor
is not a universal bypass for signed RGB. Modern single-value evaluation uses
the source's CPU evaluator even inside GPU compositing.

The independent runtime uses elementary channel arithmetic. Native source
references used to establish semantics:

- [Blender 5.3 node](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_color_spill.cc)
- [Blender 5.3 GPU arithmetic](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/shaders/library/gpu_shader_compositor_color_spill.glsl)
- [Blender 4.2 CPU operation](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_ColorSpillOperation.cc)
- [Blender 4.2 GPU arithmetic](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/realtime_compositor/shaders/library/gpu_shader_compositor_color_spill.glsl)

`compositor_spill_check.py` creates 352 native reference scenes across Blender
4.2.0, 5.2.0 and 5.3.0, CPU and Metal GPU compositing. It covers independent
input controls, all channel/method choices, custom and inactive strength,
negative/HDR RGB, signed/HDR alpha, constant and image fields, negative/zero/
fractional/over-one Factor, limit endpoints, cascades and named refusals.
Node/socket/property/link fingerprints are identical before and after
extraction. The legacy native CPU renderer itself rewrites inactive unspill
properties during rendering; that native behavior is not an extractor write.

Built-runtime comparisons retain the actual native IR/pixels, immutable runtime
snapshots and actual browser adapter identities. All 1,408 readbacks passed across recorded Apple M5 Metal and SwiftShader
adapters and both browser APIs, with maximum absolute error
1.9073486328125e-6. The existing numerical budget is 2e-5, with exact
native alpha comparison. Evidence is under
`artifacts/color-spill/final{42,52,53}-{cpu,gpu}` and
`artifacts/color-spill/final-built-{metal,software}` in the isolated worker.

Generate one native reference set, then compare the built package:

```sh
BLENDLINK_COMPOSITOR_SPILL_DEVICE=CPU \
BLENDLINK_COMPOSITOR_SPILL_REFERENCES="$PWD/artifacts/spill-cpu" \
"$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_spill_check.py
node experiments/native-compositor-differential/run.mjs --built \
  artifacts/spill-cpu --out artifacts/spill-browser
```
