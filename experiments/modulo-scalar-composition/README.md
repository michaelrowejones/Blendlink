# Native Modulo scalar composition

`math_modulo_native` always produces a scalar. Its raw remainder has no unit
range certificate: Metal can produce a negative remainder near a quotient
boundary, and MF can produce a large positive remainder for the same input.
An authored Math Clamp checkbox or Clamp node establishes the unit contract.

The fix registers that scalar shape in both Noise Roughness walkers. Existing
HSL, Float Curve and Mix factor dispatch already accepts the scalar result.
Tangent-normal range validation now accepts a directly clamped, independently
validated remainder, with exact finite Float32 literal/minmax bounds within
its existing magnitude-16 domain. It still refuses the raw remainder and
malformed primitive/profile data. This changes the range guard, not the
normal kernel; native normal-node emission and runtime coefficient bounds
are tested separately from the existing normal renderer corpus.

The native oracle builds 33 actual EEVEE graphs per measured version: three
independent carrier/orientation controls plus 30 compositions. Four literal
inputs and two nearest half-exact float-image fields feed Clamp, normalized
Noise Roughness, Mix factor, Float Curve factor and HSL input. Noise includes
an amplified native residual. Blender 4.2/5.2/5.3 Metal each pass physical and
software WebGPU/WebGL2 replay (396 readbacks), with unchanged `2e-5` plus
independently measured carrier precision. Unknown legacy non-Metal sources
retain their exact declared Modulo source-bake refusal.

```sh
BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
BLENDLINK_MODULO_COMPOSITION_EVIDENCE=artifacts/modulo-composition \
node experiments/modulo-scalar-composition/run.mjs --built
```

For software replay, omit the browser-channel variable and use a fresh evidence
folder containing the same `reference` directory, with `--built --reuse-reference`.
Native Python helpers and fixture sources are copied before generation; the
shared renderer freezes all runtime modules and harness bytes. RNA graphs,
actual native pixels, IR, source hashes and both API readbacks are retained.

MF nonzero-D Noise intentionally keeps its narrower precision grammar: a
clamped Modulo child does not gain admission there from this shape fix. Its
source and runtime correction remains a separate qualification. Existing
serialized `math` and Noise arithmetic are unchanged.
