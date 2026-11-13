# Shared vector utilities

Function Input Vector reads the authored `node.vector` property. It emits the
existing `const_vec3` shader expression and a typed VECTOR constant in compositor
programs. XYZ Combine and Separate now evaluate live compositor fields as well
as constants. No source nodes are modified. Animated node trees and unknown XYZ
outputs refuse.

These classes are actually creatable in both shader and compositor trees in
Blender 5.2 and 5.3. The same creation probes refuse them in the 4.2 compositor;
4.2 shader XYZ support is unchanged and has its existing native corpus.

Native compositor evidence has 33 graphs/device/version: signed/HDR fields,
alpha-to-component inputs, channel permutations, all XYZ outputs, constant vector
properties, and vector-to-scalar/RGBA conversions. All 132 native CPU/Metal graphs
passed each built browser backend, maximum absolute error 2.384185791015625e-7.
Material evidence adds four vectors per engine/version, including negative,
non-dyadic and tiny components transported through fixed affine channel math.
Independent constant controls certify EEVEE's half-float render carrier. Cycles
readbacks are exact; EEVEE uses that independently checked carrier allowance.
Source and built runs are separate. Blender 4.2 reports the new families as
not applicable, and shader animation refusal is exercised on 5.2/5.3.

The central shared-utility shader corpus includes these cases automatically.
For a focused native proof:

```sh
BLENDLINK_UTILITY_KINDS=constant,vector-input \
BLENDLINK_BLENDER=/path/to/blender \
BLENDLINK_UTILITY_EVIDENCE=artifacts/vector-input \
  node experiments/shared-utility-differential/run.mjs --built
BLENDLINK_COMPOSITOR_VECTOR_REFERENCES=artifacts/vector-compositor \
  blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_vector_check.py
node experiments/native-compositor-differential/run.mjs --built \
  --out artifacts/vector-browser artifacts/vector-compositor
```
