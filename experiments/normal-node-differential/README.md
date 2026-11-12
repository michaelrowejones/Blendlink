# Native Object/World Normal Map fields

This batch adds the four assignable non-tangent Normal Map spaces: `OBJECT`,
`WORLD`, `BLENDER_OBJECT` and `BLENDER_WORLD`. Color and Strength currently need
literal/default, RGB/Value, Combine or resolved constant-group inputs, within
absolute value 16. The normal function follows live owner transforms and the
active camera; editing values in Blender and saving rebuilds the program.
Spatial/animated color or strength inputs are not certified here. The existing
tangent path is separate; this proof does not certify its Cycles, smooth-normal,
named-UV or deformation domains. The separate UV Tangent port is documented in
`experiments/tangent-node-differential`; the no-height Bump subset is below.

## Reproduce

Use Node 24 and actual native Blender, from the repository root:

```sh
npm run build
BLENDLINK_NORMAL_NODE_BLENDER=/path/to/blender \
BLENDLINK_NORMAL_NODE_NATIVE="$PWD/artifacts/verification-normal-nodes" \
node experiments/normal-node-differential/suite.mjs --built --profiles shared,cycles-zero
```

`shared` covers ordinary normal-map fields and actual material Normal slots.
`cycles-zero` verifies Cycles World's defined zero-color fallback. EEVEE's
undefined zero direction is refused separately. `--reuse-native` repeats Final
export and browser verification against the exact retained fixture-script hash.
Built tests also compare actual shipped/source Python bytes and use the shared
immutable, whole-program TypeScript runtime snapshot guard. Native processes use
factory startup and preserve source `.blend` hashes; no user preferences or
installed extension are changed.

Focused regressions:

```sh
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/normal_domain_check.py
node packages/blendlink/scripts/run-vitest.mjs \
  packages/blendlink/src/tslNormalNodes.test.ts
```

## Measured scope

Actual Blender 4.2.0, 5.2.0 LTS and 5.3.0 render the authored graphs through
Cycles CPU and EEVEE Metal. Production Final export, actual GLTFLoader,
Meshopt, material installation and WebGPURenderer execute the same programs on
both real WebGPU and forced WebGL2 backends.

| Corpus | Blender 4.2 | Blender 5.2 | Blender 5.3 |
| --- | ---: | ---: | ---: |
| Shared fields, cells per browser backend | 3,552 | 4,320 | 4,320 |
| Cycles zero fallback, cells per backend | 336 | 336 | 336 |
| Actual Final scenes | 24 | 24 | 24 |

This is 26,400 RGB field/control readbacks across both backends, including
independent constant RGB controls; these are not node-type counts. The corpus
covers negative/zero/0.25/0.5/1/2 Strength, negative/HDR Color, legacy Blender
spaces, and modern DirectX convention. ORIGINAL/DISPLACED selectors are retained
where available; their displaced-surface behavior is not claimed because
material displacement is outside the admitted domain.

Owners share actual multi-primitive geometry, have parented nonuniform/reflected
transforms and animation, and use front/back perspective/orthographic views.
Both glTF Y-up and raw Blender Z-up exports retain exact Float32 split normals.
The final frame moves one owner while the other owner and camera stay fixed.
Direct Normal-slot cases use a separate native camera-space oracle, testing the
normal-to-view conversion rather than cancelling it with the same browser math.
Positive nonuniform camera scale must not distort those normals.

Current built reports are `artifacts/verification-normal-nodes-final{42,52,53}/results.json`
and their per-profile `browser-report.json`. Cycles' maximum absolute encoded RGB
error is 1.926e-5 within the fixed 2e-5 allowance for independently chosen native
BOX filter width 0.01. EEVEE adds one final native half-float ULP, independently
calibrated by RGB controls; its largest error is 4.920e-4. No fixture-specific
tolerance was widened. Native Linux/OpenGL certification is separate from this
Metal measurement. These are channel-function proofs, not full BSDF/lighting
or whole-render pixel parity.

## Why the source engine matters

Cycles normalizes the decoded Object/World normal, flips it on backfaces, then
applies non-tangent Strength with a safe normalization and a defined zero-result
fallback. Object space first uses the inverse-transpose object matrix. EEVEE
mixes the raw decoded/transformed vector with the current surface normal before
normalizing; its new non-tangent normal is not backface-flipped. Legacy Blender
spaces also have distinct native decode equations. See
[Cycles Normal Map](https://github.com/blender/blender/blob/v4.2.0/intern/cycles/kernel/svm/tex_coord.h),
[object normal transforms](https://github.com/blender/blender/blob/v4.2.0/intern/cycles/kernel/geom/object.h),
[EEVEE node construction](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/shader/nodes/node_shader_normal_map.cc)
and [EEVEE shader operations](https://github.com/blender/blender/blob/v5.2.0/source/blender/gpu/shaders/material/gpu_shader_material_normal_map.glsl).

A shared ALL material root does not prove an EEVEE-to-Cycles capture equivalent.
Automatic fallback now distinguishes this engine change from a primary-ray-to-UV
capture. Neither can silently stand in for the live normal field.

## Defined normal blends and actual bindings

EEVEE's blend can become a zero vector for certain Color/Strength/geometry
combinations. The compiler and runtime use a conservative certificate: an
ordinary reverse-length bound, or a cone enclosing the actual packed vertex
normals. Checking both signs covers primary front/back faces. Ambiguous cones
refuse rather than silently inventing a direction. Bounds are cached with actual
attribute identity/version; per-draw checks follow live owner transforms. The
cone scan is skipped when the length bound already proves a nonzero result.

Final audit obtains Float32 POSITION/NORMAL and indices from the actual decoded
GLB primitive, with its actual default-scene transform chain. A fake normal-bounds
property supplies no evidence. The installer repeats checks on loaded geometry,
and draw callbacks recheck live context. A required primary-normal declaration
keeps transport/optimizer/renderer contracts explicit. Normal programs are
validated even when Base Color already has a portable carrier; otherwise a bad
normal graph could publish and silently keep a flat carrier. Ordinary portable
artifacts retain the optional-Three audit path. Legacy WebGLRenderer refuses
these required native normal functions, including Normal-only programs with a
portable Base Color; WebGPURenderer's WebGL2 backend remains supported.

All primary-geometry limits apply: no enabled modifiers, animated mesh data,
skins/morphs, generated/GPU instances, material displacement or Simplify Normals;
unit normals with outward triangle cosine above 0.05; finite invertible matrices
within the documented normal conditioning bounds; and no unverified reflected,
sheared, shifted/cropped or panoramic authored camera context. Cycles inherits
its explicit single/shared-user normal model limits. Direct Normal-slot output
is certified; downstream vector normalization needs its own domain proof.

## No-height Bump identity

`--bump` selects an independent EEVEE corpus. Use a separate directory:

```sh
BLENDLINK_NORMAL_NODE_BLENDER=/path/to/blender \
BLENDLINK_NORMAL_NODE_NATIVE="$PWD/artifacts/verification-bump" \
node experiments/normal-node-differential/suite.mjs --built --bump --profiles shared,single,flat,hq
```

[Blender's native branch](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/shader/nodes/node_shader_bump.cc)
returns the geometry normal when both Height and Normal are unlinked. With
Normal linked and Height unlinked, it copies the linked vector verbatim; it
does not normalize zero or nonunit data. Strength, Distance, Filter Width and
Invert are inactive in this branch. A linked constant Height enters the real
height-function path and remains refused, with an actionable diagnostic. The
source graph is left intact. This port does not implement height sampling,
derivatives, minification or bump shading from a height texture.

The fresh `bump_passthrough_native` / `eevee-no-height-v1` contract preserves
that identity through color graphs. Normal and Coat Normal slots require a
verified unit native normal source, the primary geometry normal, or nested
no-height passthroughs of those sources. Other linked normal vectors receive a
named refusal instead of being silently normalized or sent through the legacy
view transform. Engine-specific normal packing, actual Float32 glTF normals,
per-owner matrices, animation and camera validation remain enforced. The
existing Cycles route is unchanged; no new Cycles live coverage is claimed.

Fourteen native fields and an independent authored RGB control cover default,
nested and linked geometry normals, linked Object/World Normal Map output,
zero/nonunit/negative vector color data, inactive unsupported control inputs,
and actual Normal/Coat Normal installation. Three versions (4.2.0, 5.2.0 LTS,
5.3.0) and four profiles (shared owners, one owner, flat faces, high-quality
normals) pass actual Final publication, GLTFLoader, production installation
and both WebGPURenderer backends. This is 96 GLBs and 15,120 field/control
readbacks. Maximum encoded RGB error is 0.000489474 within the unchanged
2e-5 raster allowance plus the native final half-float ULP. No adapter-specific
claim is inferred from browser backend names. The independent authored RGB
control calibrates row orientation with a strict 2e-6 budget; native EXR
control pixels are checked separately under the final half-float allowance.

Focused regressions:

```sh
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/bump_passthrough_check.py
node packages/blendlink/scripts/run-vitest.mjs \
  packages/blendlink/src/tslBumpPassthrough.test.ts
```
