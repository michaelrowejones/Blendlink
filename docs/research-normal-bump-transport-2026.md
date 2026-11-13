# EEVEE normal and bump transport

Research date: 2026-09-07. Blender 5.2.0 LTS `fbe6228777e7` and Three r184 source. No production changes.

## Reference fixture

`artifacts/verification-look/normals/fixture.py` creates thirty separate plane patches whose Normal Map or Bump output is connected through `normal * 0.5 + 0.5` to an Emission shader. Lighting contributes nothing. It saves:

- `world-normal-fixture.blend`;
- `world-normals-raw.png`, rendered with Raw view transform and no dithering;
- `world-normals-linear.exr`, a 32-bit EXR of the scene-linear render;
- `fixture.json`, including camera, transforms, corner normals, per-layer UVs, computed tangent vectors/signs, center pixels and measured world-normal values.

Cases cover strengths 0, 0.25, 0.5, 1 and 2; DirectX convention; rotated, mirrored and named UVs; negative object scale; backfaces; object/world normal spaces; bump inversion, world/UV height fields, UV scaling, custom input normal, missing Height, chained Normal Map → Bump and differing filter widths.

EEVEE's internal result is visibly half-float-quantized even when saved as EXR32. Center reference normals therefore have roughly 0.001 component precision; EXR32 does not manufacture higher source precision. Compare shader values with that bound and use interior pixels to avoid silhouette coverage. After ordinary Blender-to-glTF axis conversion, a Three world normal converts back to Blender world as `[x, -z, y]` before encoding. Disable tone mapping and output conversion when matching the Raw PNG numerically.

## Normal Map

Blender decodes normal color `n = 2 * color - 1`. DirectX convention negates decoded Y. Its tangent-space strength operation is:

```text
n.xy *= strength
n.z = mix(1, n.z, clamp(strength, 0, 1))
result = normalize(T * n.x + B * n.y + N * n.z)
```

Three's `normalMap(color, scale)` scales decoded XY but leaves Z unchanged. Thus mapping Blender Strength directly to Three normalScale is wrong below strength 1; for strength 0.5 and color [0.8,0.6,0.9], Blender uses [0.3,0.1,0.9], whereas unadjusted Three uses [0.3,0.1,0.8]. At strength above 1, Blender keeps decoded Z and continues scaling XY. A compatible tangent path can pre-adjust the decoded vector and use Three's TBN transform without applying strength twice. [Pinned Blender shader](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/gpu/shaders/material/gpu_shader_material_normal_map.glsl), [Three r184 NormalMapNode](https://github.com/mrdoob/three.js/blob/r184/src/nodes/display/NormalMapNode.js)

Blender object/world modes instead transform the decoded object normal to world where needed, then compute `normalize(mix(baseNormal, newNormal, max(0,strength)))`. This extrapolates above strength 1 and is not the tangent-space XY-scale formula. The `base` setting can select original or displacement-adjusted normals for the tangent path. Named UV map selection is part of tangent interpretation. [Pinned node implementation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/shader/nodes/node_shader_normal_map.cc)

Blender's tangent shader adjusts handedness for backfacing fragments and negative object determinants. Three builds its TBN from normal/tangent accessors and has its own face-direction behavior. When a tangent attribute is missing, Three derives a screen-space frame; this is not evidence that it uses Blender's chosen UV basis. Prefer verified exported tangents, including signs, for the applicable UV layer; test mirrored UVs, nonuniform scale and backfaces separately. The fixture's no-UV object still produced a perturbed EEVEE normal: do not assume absence of a UV layer implies Blender's shader-level missing-tangent sentinel. [Three tangent accessor](https://github.com/mrdoob/three.js/blob/r184/src/nodes/accessors/Tangent.js), [Three bitangent accessor](https://github.com/mrdoob/three.js/blob/r184/src/nodes/accessors/Bitangent.js)

## Bump

Blender evaluates the connected Height graph at filtered screen offsets and subtracts the central Height. With normalized input `N`, unnormalized world-position derivatives `dx`, `dy`, and height differences `dhx`, `dhy`, its core is:

```text
Rx = cross(dy, N)
Ry = cross(N, dx)
det = dot(dx, Rx)
gradient = dhx * Rx + dhy * Ry
candidate = normalize(filterWidth * abs(det) * N - signedDistance * sign(det) * gradient)
result = normalize(mix(N, candidate, max(0,strength)))
```

Distance carries the invert and front/back-face sign. Strength is a normalized-vector blend after the perturbation, not an interchangeable distance multiplier. The Height graph may use world coordinates or procedural nodes. If Height is unlinked, Blender forwards the supplied Normal unchanged, even when it is not normalized; without that input it supplies the world normal. Filter Width defaults to 0.1 pixel in the inspected build. [Pinned Bump shader](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/gpu/shaders/material/gpu_shader_material_bump.glsl), [pinned node implementation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/shader/nodes/node_shader_bump.cc)

Three `bumpMap` evaluates forward differences by changing texture UVs, normalizes position derivatives, and offers a single scale. That changes distance dependence and does not replay arbitrary Blender coordinate-dependent height graphs. A direct `bumpMap(texture, strength * distance)` mapping is consequently insufficient. A SceneToWeb implementation needs a well-defined height-graph differentiation context, world-unit derivatives, optional input-normal evaluation and the final strength blend. Initially constrain derivative sources explicitly; retain Blender's bump bake as a separate option only where its resulting surface detail remains applicable. [Three r184 BumpMapNode](https://github.com/mrdoob/three.js/blob/r184/src/nodes/display/BumpMapNode.js)

The measured ramp fixture illustrates the distinction: on a 1.6-unit-wide plane with Height=U and Distance=0.2, strength 1 yields approximately [-0.1245,0,0.9922]. Height=world X instead yields approximately [-0.1963,0,0.9805]. Doubling UV scale changes the normal again. Distance must retain its spatial meaning.

## Principled sheen and emission observations

Blender EEVEE computes a view-dependent empirical sheen response multiplied by nonnegative Sheen Weight and Tint, then attenuates lower layers. Its source describes adding sheen energy to diffuse until a full sheen BSDF exists. Three uses a Charlie-sheen response with its own direct/indirect energy compensation. Therefore `sheenNode = tint * weight` carries input intent but does not establish EEVEE appearance equivalence. Three's node input replaces the combined sheen color; multiplying again by the scalar material sheen would double-apply weight. [Pinned EEVEE Principled shader](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/gpu/shaders/material/gpu_shader_material_principled.glsl), [Three physical node material](https://github.com/mrdoob/three.js/blob/r184/src/materials/nodes/MeshPhysicalNodeMaterial.js), [Three lighting model](https://github.com/mrdoob/three.js/blob/r184/src/nodes/functions/PhysicalLightingModel.js)

Blender Principled emission multiplies Emission Color by Strength, with lower-layer attenuation from sheen and coat and an additional coat tint. A standalone Emission shader is a different closure. Three's `emissiveNode` replaces its normal material-emissive expression: include authored strength exactly once in that node rather than also depending on `emissiveIntensity`. Three's coat finish uses its own Fresnel attenuation; identical inputs do not certify the same layered emission. These interactions need lit/emissive differential fixtures beyond the normal-encoding reference. [Three NodeMaterial](https://github.com/mrdoob/three.js/blob/r184/src/materials/nodes/NodeMaterial.js), [Three material accessor](https://github.com/mrdoob/three.js/blob/r184/src/nodes/accessors/MaterialNode.js)

## Supplemental compositor findings

Blender's implicit Color-to-Float conversion uses luminance from the active color configuration and ignores alpha; default Rec.709 coefficients are [0.2126,0.7152,0.0722]. It is not the arithmetic RGB mean. [Pinned conversions](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/blenkernel/intern/type_conversions.cc), [compositor conversion operation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/compositor/intern/conversion_operation.cc)

Modern ShaderNodeMixRGB and ShaderNodeMix Color delegate to the same blend equations: MIX interpolates RGBA; ADD computes `A.rgb + factor * B.rgb` and retains `A.a`. MULTIPLY and SUBTRACT also retain A alpha. MixRGB clamps factor to [0,1]; Mix only does so when clamp_factor is enabled. The inspected MixRGB execution does not consult its exposed `use_alpha` field, so do not resurrect legacy compositor alpha-factor behavior from that property alone. [Pinned ramp_blend](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/blenkernel/intern/material.cc#L1891), [MixRGB](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/shader/nodes/node_shader_mix_rgb.cc), [Mix](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/shader/nodes/node_shader_mix.cc)
