# Eevee 5.2 Area-light parity in Three.js

Status: source audit and design recommendation, 2026-07-22. This note makes no
production-code change.

## Decision summary

When the selected Blender render engine is Eevee, Blendlink should compile the
semantics that Eevee actually evaluates, not Cycles light-node semantics and
not a renderer-neutral approximation.

Three 0.184 `RectAreaLight` is a useful, unusually close direct-light adapter
for an important subset: an orthogonal square/rectangle, local `-Z` emission,
default diffuse/specular contribution, no material shadowing requirement, and
live Three PBR receivers. Its source geometry, power/area algebra, edge
integral, and 64 x 64 LTC fit data line up closely with Eevee.

It is not a general Eevee implementation. Eevee additionally owns finite
influence fade, per-closure contribution controls, light and shadow linking,
area-sampled soft shadows, ellipse/disk emitters, scene direct-light scale and
clamping, indirect probe contribution, and a different horizon-clipping path.
A scalar calibration cannot recover those missing dimensions.

The evidence therefore supports this product policy:

1. infer Eevee source facts automatically;
2. use package-owned native Three RectArea lowering only for the proven live
   direct-light subset;
3. bake static Eevee-dependent appearance, shadows, linking, and indirect
   contribution automatically; and
4. keep an explicit override as an escape hatch, not as configuration every
   artist must discover.

A Blender-shader port is not the next default. Besides the renderer ownership
and maintenance cost, Blender's relevant implementation files are
GPL-2.0-or-later while Blendlink is MIT. Blender source is excellent behavioral
evidence, but copying its shader implementation or lookup data into Blendlink
would require a deliberate licensing decision. Any deeper web implementation
should be independently derived from the cited papers or use permissively
licensed Three code/data.

## Pinned version evidence

The locally installed executable reports:

```text
Blender 5.2.0 LTS
branch blender-v5.2-release
commit fbe6228777e7d9afefcd61a413844e790ae75db7
build 2026-07-14 (source commit 2026-07-13)
```

`git ls-remote` against Blender's official mirror resolves tag `v5.2.0` to the
same full commit. `node_modules/three/package.json` reports `0.184.0`; the
package declares exactly `three: 0.184.0` as its development peer.

Representative local source hashes:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| Blender `eevee_light.cc` | 26,405 | `8E6A3C94C2ED799822D1645A0E6AE2BC6EBB43759C6C458F2697453342641711` |
| Blender `eevee_light_lib.bsl.hh` | 9,104 | `E406640270B26E802F52E7E0CB642D37724EC267DF5940C3510EA0EFCD9F65AF` |
| Blender `eevee_light_eval.bsl.hh` | 8,306 | `24CF710BD7081EEBBF56756DDC18B474AD490C2F451BC3113D4E46B8450960CB` |
| Blender `eevee_ltc_lib.bsl.hh` | 9,536 | `ED5F98A523BB0CCF156A56E02ECE16E87BA3E78678439C30AEE45BDE7E720825` |
| Three `RectAreaLight.js` | 2,612 | `3D602AFB9AF5A0D62CC94D2C6DF050DE1778711EFA9312566006E14FA0029D11` |
| Three `WebGLLights.js` | 13,548 | `43C3EDBA697CBD764A82B42901960813BC04A0BE6D6B5B5442E9D592AE43F3A0` |
| Three physical-light shader | 22,120 | `93C6FBB624F9ADBC0AC6EA0B01180A980ED11EEED7686BCADE07B631270E8A9B` |
| Blendlink `threeRectAreaLights.ts` at audit | 24,644 | `2132C66325FB7AD82F193383A2EE51A7FC88086EA3FA657EAB1C7B7121C33C6C` |
| Blendlink `weblights.py` at audit | 67,611 | `EEF1266E80CA944FC09D5B989D70F17EFB27FBB671F8AC59B2892B9C90BFCDE8` |

## Eevee's source contract

### Shape, size, transform, and emission side

`Light::sync` maps Blender `SQUARE`/`RECTANGLE` to `LIGHT_RECT` and
`DISK`/`ELLIPSE` to `LIGHT_ELLIPSE`. It separates world-axis scale from the
normalized light transform and repairs handedness. `shape_parameters_set`
stores scaled *half extents*: `size * worldScale.xy / 2`. Square and disk use
one source dimension; rectangle and ellipse use `size` and `size_y`.

Two small-light details are observable source semantics:

- a half-extent product below `0.00001` forces the light's influence radius to
  zero (the light is culled); and
- each half extent is then clamped to at least `0.003` for stable shading.

Blendlink's current producer accepts any positive dimensions, and its runtime
uses the exact dimensions. That differs for extremely small emitters.

Eevee is one-sided. `light_attenuation_common` returns zero for an area light
unless the vector from the shading point to the light has positive dot product
with the light's local `+Z` axis. In artist terms, emission is toward local
`-Z`.

Three constructs a counter-clockwise rectangle explicitly documented in its
shader as shining along local `-Z`, and `LTC_Evaluate` rejects points behind
that plane. Directionality therefore agrees for the supported subset.

Primary anchors:

- [Blender `Light::sync` and type/transform setup][bl-light-sync]
- [Blender area half-extents, culling, and clamp][bl-area-shape]
- [Blender area one-sided attenuation][bl-light-common]
- [Three rectangle winding and direct evaluation][three-direct-rect]

### Energy, normalization, exposure, and color temperature

Blender's artist-facing unit is radiant power in watts. The exact CPU helpers
are:

```text
sourcePower = energy * 2 ** exposure
sourceColor = dataColor * blackbody(temperature)   when Use Temperature is on
```

For a rectangle with effective world area `A`, Eevee's shape radiance is
`1 / (pi * A)`. When Normalize is off, `Light::sync` first multiplies the
source color/power by `A`. Ignoring the later closure-specific factors:

```text
Normalize on:  direct radiance scale = energy * 2**exposure / (pi * A)
Normalize off: direct radiance scale = energy * 2**exposure / pi
```

Three labels RectArea `power` as lumens and `intensity` as nits and defines:

```text
power = intensity * width * height * pi
```

These are not physically interchangeable units. However, for visual
calibration, assigning Blender's numeric normalized power to Three's `power`,
or Blender's numeric unnormalized strength divided by `pi` to Three's
`intensity`, produces the same pre-BRDF scalar. The current Blendlink producer
and runtime implement exactly that algebra. It is a numeric renderer adapter,
not a watts-to-lumens claim.

Eevee's `Light::sync` reads `BKE_light_power` and `BKE_light_color` directly;
it does not evaluate the light node tree. The current producer correctly
ignores Emission nodes for Eevee and composes the RNA `temperature_color`.
Conversely, its blanket refusal of any light-node-tree animation is stricter
than Eevee: node-tree animation is not an Eevee area-light dependency at this
revision.

Primary anchors:

- [Blender power, temperature color, and physical area helpers][bl-light-bke]
- [Blender area radiance normalization][bl-shape-radiance]
- [Blender RNA units and Normalize contract][bl-light-rna]
- [Three RectArea power/intensity relation][three-rect-source]

### Diffuse, specular, transmission, and volume

Eevee creates four independent per-light powers:

```text
diffuse      = diffuse_factor      * areaShapeRadiance * objectVisibility
specular     = specular_factor     * areaShapeRadiance * objectVisibility
transmission = transmission_factor * areaShapeRadiance * objectVisibility
volume       = volume_factor       * pointApproximation * objectVisibility
```

The surface evaluator selects the appropriate power for each closure. Diffuse
uses an identity LTC matrix; GGX reflection and transmission sample the LTC
matrix with their own normals and roughness. Volume deliberately uses a
separate point-light approximation rather than the area integral.

Three exposes one RectArea color/intensity to all supported closures. Its
physical shader adds direct diffuse, direct specular, and clearcoat terms. It
has no per-light diffuse/specular/transmission/volume factors, and the official
class contract limits receivers to PBR materials. Thus non-default unequal
contribution factors cannot be represented by native `RectAreaLight`.

An equal diffuse/specular multiplier can be folded into source strength only
after proving that the scene has no relevant transmission, volume, or other
receiver path. That is compiler analysis, not artist configuration.

Primary anchors:

- [Blender per-closure powers in `Light::sync`][bl-light-sync]
- [Blender closure power selection and LTC evaluation][bl-light-eval]
- [Blender diffuse and GGX LTC setup][bl-closure-light]
- [Three physical RectArea closure contributions][three-direct-rect]
- [Three official RectArea limitations][three-rect-doc]

### LTC implementation: shared fit, different integration

Both engines cite Heitz et al.'s linearly transformed cosines work, and their
core rectangle edge-integral approximation is the same. A read-only parser
compared the pinned arrays:

| Data | Elements compared | Maximum absolute delta | Mean absolute delta |
| --- | ---: | ---: | ---: |
| Blender `ltc_mat_ggx` vs Three `LTC_MAT_1` | 16,384 | `5.0e-7` | `6.9987e-8` |
| Blender `ltc_mag_ggx` vs first two channels of Three `LTC_MAT_2` | 8,192 | `5.0e-7` | `1.0824e-7` |

The deltas are consistent with Blender storing six decimal places in its C++
table. This is strong evidence that the fit data have the same origin.

The evaluation still differs:

- Eevee uses a tabulated horizon-clipped sphere integral after computing the
  rectangle form factor.
- Three uses the cheaper analytic approximation in
  `LTC_ClippedSphereFormFactor`; its own shader contains a disabled alternative
  table path.
- Eevee adds `light_attenuation_facing` to fade leakage around the receiver
  horizon.
- Three samples both matrix and magnitude/Fresnel tables in its material
  shader. Pinned Eevee uploads the matrix and horizon table; its material
  closure/color composition is different.

For scale, evaluating the two horizon formulas at all 64 x 64 Blender table
grid points produced maximum absolute difference `0.1345094` and mean absolute
difference `0.0405319`. Not every grid pair is necessarily produced by every
rectangle, so those are algorithm deltas, not a claimed image error. They do
show why a single strength scalar cannot make the implementations identical at
all view angles and roughnesses.

Primary anchors:

- [Blender rectangle LTC and tabulated horizon integral][bl-ltc]
- [Blender LTC lookup parameterization][bl-ltc-lookup]
- [Blender LUT upload][bl-lut-upload]
- [Three LTC evaluation and analytic clipping][three-ltc]
- [Three LTC texture source and attribution][three-ltc-textures]

### Distance attenuation and Eevee scene controls

The LTC integral already supplies geometric size/distance falloff in both
renderers. Eevee then multiplies it by a finite influence fade:

```text
factor = distance^2 / influenceRadius^2
fade   = saturate(1 - factor^2)^2
```

The radius is either the light's Custom Distance or
`sqrt(relevantPower / scene.eevee.light_threshold)`. The power estimate uses
the strongest color channel, `energy / 100`, and the largest relevant
surface/volume contribution. Blender's source contains a TODO noting that
area-light scale is not included in this radius calculation.

Three's RectArea uniform contains only color, position, half-width, and
half-height. It has no distance, decay, threshold, or custom-cutoff field. The
current Blendlink descriptor/runtime therefore continue lighting beyond the
distance where Eevee fades to zero, and current diagnostics do not name this
mismatch.

Eevee 5.2 also applies scene-level `direct_light_intensity` after direct
closure accumulation and can brightness-clamp direct surface light before that
scale. The current descriptor does not include either setting. A positive
linear direct scale can be folded automatically into compiled light strength;
the nonlinear, per-pixel direct clamp cannot.

Primary anchors:

- [Blender influence-radius construction][bl-area-shape]
- [Blender influence fade][bl-light-common]
- [Blender scene light-threshold sync][bl-light-threshold]
- [Blender final direct clamp and scale][bl-direct-scale]
- [Three RectArea uniform fields][three-light-uniform]

### Shadows and softness

Eevee Area lights cast shadows by default. If `use_shadow` is enabled, Eevee
allocates punctual shadow resources. The shadow tracer samples a rectangle
uniformly or an ellipse/disk with disk sampling, scales samples by the actual
area half-extents, and traces multiple stochastic rays. Its result also depends
on scene ray/step counts, jitter/overblur, filter radius, maximum resolution,
and shadow-map settings.

Three's official class and source state that RectArea has no shadow support.
`castShadow = false` in Blendlink is therefore correct and truthful, but it is
a major visual difference whenever Eevee shadows affect a receiver. A
companion Spot or Point shadow can be an artistic approximation; it is not the
same emitter or penumbra and should never be called parity.

Primary anchors:

- [Blender shadow ownership in `Light::sync`][bl-light-sync]
- [Blender area-shape shadow sampling][bl-shadow-trace]
- [Blender jittered shadow projection][bl-shadow-setup]
- [Three no-shadow contract][three-rect-source]

### Light linking and shadow linking

Eevee stores separate 64-bit light and shadow membership masks. Before direct
evaluation it skips lights whose membership does not include the receiver's
light set. Shadow views carry the separate shadow membership mask so blocker
selection can differ from receiver selection.

Three WebGL gathers every camera-visible light into one render-state light
array and passes that array to each material. Object/Light `Layers` are tested
against the camera while gathering; they are not an Eevee-style per-light,
per-receiver membership relation. Native RectArea therefore cannot reproduce
general Blender Light Linking or Shadow Linking.

Primary anchors:

- [Blender light/shadow membership upload][bl-light-sync]
- [Blender receiver membership test][bl-light-eval]
- [Blender shadow membership visibility][bl-shadow-membership]
- [Three WebGL light gathering][three-light-gather]

### Indirect light and probes

Eevee evaluates area lights against captured surfels when producing indirect
probe data; front and back surfel radiance receive shadowed direct light. The
result then participates in Eevee's separately scaled indirect pipeline.
Three's native RectArea only changes the current direct PBR pass. It does not
retroactively add Eevee's probe bake or diffuse GI, and it cannot recreate
Cycles bounce.

Blendlink can preserve static indirect intent by compiling probes and baked
appearance, but the direct RectArea adapter itself must keep the current
indirect limitation explicit.

Primary anchor: [Blender surfel light evaluation][bl-surfel].

### Spread under Eevee

`AreaLight.spread` exists in RNA and defaults to 180 degrees, but the pinned
Eevee light implementation never reads `area_spread`; the installed Eevee
Light panel exposes shape and dimensions but not Spread. In Eevee 5.2, a
non-default Spread value is therefore not an Eevee parity loss. It remains
relevant to engines that consume it, including Cycles.

The current `_rect_area_approximation_issues` warns for non-default Spread
without branching on the active engine. Under the agreed source-of-truth rule,
that warning should be engine-aware. Likewise, an animation that only changes
Spread should not block an Eevee descriptor.

Primary anchors:

- [Blender Area RNA including Spread][bl-area-rna]
- [Blender Eevee light panel shape/size controls][bl-eevee-light-ui]
- [Blender complete Eevee area shape setup][bl-area-shape]

## Semantic mismatch table

| Concern | Eevee 5.2 | Three r184 / current Blendlink | Truthful result |
| --- | --- | --- | --- |
| Rectangle geometry | Square/rectangle with scaled half-extents | Runtime measures marker world X/Y scale and sets numeric width/height | Match for finite orthogonal positive transforms above Eevee's micro-light thresholds |
| Disk/ellipse | Native LTC disk path | Native RectArea is rectangle-only; Blendlink refuses | Bake or future independently derived disk shader; do not box-approximate silently |
| Direction | One-sided local `-Z` | One-sided local `-Z` | Match |
| Energy/exposure | Radiant watts times `2**exposure` | Lumen/nit labels, but compatible `power = intensity*A*pi` algebra | Numeric visual mapping is sound; physical-unit equivalence is not claimed |
| Normalize | Power constant with size when on; radiance constant when off | Current `power`/`intensity` descriptor split implements this | Match for the supported size subset |
| Temperature | Datablock color times Blender blackbody color | Producer reads evaluated RNA temperature color | Match in the compiled linear-color contract |
| Eevee light nodes | Not consumed by pinned Eevee direct path | Producer ignores node color for Eevee, but animation gate still sees node tree | Color behavior correct; animation dependency analysis is over-conservative |
| LTC data | 64 x 64 GGX fit | Same fit to rounding | Strong match at the data level |
| LTC integration | Tabulated horizon clip plus facing fade | Analytic horizon approximation, no Eevee facing fade | Close in many views, not identical near horizons/rough cases |
| Diffuse/specular | Independent factors and object visibility | One scalar for both | Defaults match best; unequal factors need bake or custom material shader |
| Transmission/volume | Dedicated powers and evaluation paths | No corresponding native per-light controls | Cannot truthfully match with RectArea |
| Distance cutoff | Smooth finite influence, global threshold or Custom Distance | No RectArea distance field | Current missing semantic; bake/custom shader/diagnostic required |
| Shadows | Area-shape stochastic soft shadows and tuning | Explicitly unsupported | Cannot match natively; bake static shadows or label an approximation |
| Light/shadow linking | Separate receiver and blocker masks | No native per-receiver light mask | Cannot match generally without material/shadow pipeline ownership |
| Indirect/probes | Area lights can feed Eevee probe captures | Native direct pass only | Compile static indirect/probes; do not attribute it to RectArea |
| Scene direct scale | Linear post-light multiplier | Not represented | Fold automatically into compiled strength |
| Scene direct clamp | Nonlinear per-pixel direct clamp | Not represented | Bake or deeper pipeline; final tone mapping is not equivalent |
| Receiver model | Eevee closure system | MeshStandard/Physical direct diffuse/specular/clearcoat only | Material/compiler differences remain even with identical light math |
| GPU path | Eevee-owned shaders, culling, shadows | Current Blendlink adapter requires `WebGLRenderer`; Three also has a distinct WebGPU LTC path | Current interface is WebGL-only and should say so |

## Current Blendlink assessment

The existing `threeRectAreaLights.ts` is a good deep runtime **Module** at the
right seam. Its compact interface hides descriptor validation, transformed
dimensions, normalized-power conversion, shared LTC initialization, GPU
prewarm, transactional install/rollback, cancellation, Strict Mode ownership,
receiver auditing, sync, and disposal. Deleting it would spread those concerns
across every generated consumer, so the module earns its depth.

The current producer/runtime gets these difficult facts right:

- normalized power vs unnormalized intensity algebra;
- evaluated Eevee datablock color and temperature;
- local dimensions plus runtime world X/Y scale;
- one Three peer and one shared LTC initialization;
- no accidental Lighting-atlas double illumination;
- no shadows claim; and
- loud unsupported-receiver diagnostics.

The source audit identifies these next corrections before widening automatic
use:

1. branch warnings and animation dependencies by active render engine; Eevee
   ignores Area Spread and light-node graphs;
2. compile Eevee `direct_light_intensity` automatically;
3. diagnose or represent Eevee global/custom distance fade;
4. account for Eevee's micro-area cull/clamp;
5. promote unequal diffuse/specular factors, relevant transmission/volume,
   shadows, linking, and nonlinear direct clamp from generic caveats to
   evidence-driven bake/runtime decisions; and
6. add image evidence across distance, receiver angle, roughness, occlusion,
   and normalized-size changes. One Cube hero crop is not sufficient
   calibration evidence.

## Designs compared

### Design A: calibrated native Three RectArea adapter

Keep the existing descriptor/runtime seam and make producer policy
engine-aware. Automatically lower only the proven live subset, with no normal
artist opt-in required. Preserve a namespaced override for cases where the
artist wants bake-only or accepts a diagnosed approximation.

Package-owned behavior can include:

- active-engine dependency analysis;
- exact datablock color, temperature, exposure, Normalize mapping, and scene
  direct scale;
- rectangle/square geometry and transform validation;
- receiver-aware factor analysis;
- micro-light compatibility policy;
- distance/shadow/linking diagnostics;
- automatic bake-vs-live selection; and
- browser visual evidence.

Benefits: small stable interface, native Three material compatibility, good
lifecycle locality, low payload beyond Three's LTC data, and no website-owned
route/Canvas changes.

Limits: no area shadows, no Eevee cutoff, no masks, no ellipse/disk, no
independent closure powers, and differing horizon/material evaluation. This
adapter can be calibrated, but it cannot be relabeled “Eevee exact.”

### Design B: Blendlink-owned Eevee-like shader/light adapter

Introduce a richer compiled light representation and patch or replace the
lighting implementation of compiled PBR materials. A narrow version could add
Eevee's finite fade, facing term, contribution vector, and a generated horizon
table. A broad version would also require emitter shapes, receiver masks,
transmission/volume paths, probe integration, and a custom shadow pipeline.

Benefits: closer direct-light behavior, support for controls native Three
cannot express, and a path to disk/ellipse and linking for Blendlink-owned
materials.

Costs:

- the interface grows to expose engine/version-specific facts;
- every material variant, shader cache key, WebGL/WebGPU path, skin/morph/
  instancing combination, and Three upgrade becomes Blendlink maintenance;
- application-owned PBR materials are outside the compiled-material seam;
- `onBeforeCompile` ownership can conflict with application effects;
- matching Eevee shadows and probes requires renderer-level ownership, pushing
  Blendlink toward the proprietary-engine boundary the product rejects; and
- Blender shader/table code is GPL, so direct copying is incompatible with a
  casual MIT implementation.

This design has potential depth only if it remains narrow and has a second real
adapter or compelling evidence. Today it mostly moves Eevee implementation
complexity into Blendlink and enlarges the caller-visible compatibility
contract.

### Recommendation

Choose Design A plus automatic Eevee baking as the production architecture.
Treat Design B as a bounded prototype only if cross-scene image matrices show
that native Three's horizon/cutoff differences remain a release blocker for
live PBR receivers after static Eevee lighting is baked.

If such a prototype is warranted, start with one independently derived feature
at an internal seam: Eevee's finite influence fade on Blendlink-owned
materials. Do not begin with shadows or a wholesale Blender shader port.

## What can be automatic

Blendlink can infer without artist configuration:

- active engine and therefore which light-node/Spread semantics matter;
- shape, dimensions, transform, color, temperature, energy, exposure, and
  Normalize;
- scene direct scale, light threshold, Custom Distance, shadow state, factors,
  linking, and relevant animation paths;
- whether receivers are static/baked, native Three PBR, transmission/volume,
  or application-owned;
- whether native RectArea is a proven direct-light subset;
- whether static Eevee lighting should be compiled into appearance/probes; and
- whether a publish must fail loudly because a live result would be materially
  wrong.

Normal configuration can consequently remain focused on post-processing,
interactivity, and explicit artistic overrides.

## What cannot truthfully match through native RectArea

Native Three RectArea alone cannot reproduce:

- Eevee area-sampled shadows and their softness/filtering;
- general light or shadow linking;
- disk/ellipse emitters;
- independent diffuse, glossy, transmission, and volume powers;
- Eevee's finite influence fade and nonlinear direct clamp;
- Eevee probe/indirect results;
- arbitrary Eevee material closures; or
- all near-horizon LTC output.

For static content, baking is the artist-friendly parity path. For dynamic
content, Blendlink must either surface the approximation, choose another
portable light, or explicitly enter a narrower custom-runtime contract.

## Source links

[bl-light-sync]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/eevee_light.cc#L34-L125
[bl-area-shape]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/eevee_light.cc#L161-L238
[bl-shape-radiance]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/eevee_light.cc#L273-L338
[bl-light-common]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/shaders/eevee_light_lib.bsl.hh#L79-L183
[bl-light-eval]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/shaders/eevee_light_eval.bsl.hh#L60-L185
[bl-ltc]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/shaders/eevee_ltc_lib.bsl.hh#L19-L318
[bl-ltc-lookup]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/shaders/eevee_ltc_lut_lib.bsl.hh#L12-L44
[bl-lut-upload]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/eevee_pipeline.hh#L760-L824
[bl-light-bke]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/blenkernel/intern/light.cc#L217-L268
[bl-light-rna]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/makesrna/intern/rna_light.cc#L168-L266
[bl-area-rna]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/makesrna/intern/rna_light.cc#L468-L525
[bl-eevee-light-ui]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/scripts/startup/bl_ui/properties_data_light.py#L77-L140
[bl-light-threshold]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/eevee_light.cc#L390-L448
[bl-direct-scale]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/shaders/eevee_forward_lib.bsl.hh#L158-L200
[bl-closure-light]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/shaders/eevee_closure.bsl.hh#L101-L167
[bl-shadow-trace]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/shaders/eevee_shadow_tracing.bsl.hh#L212-L275
[bl-shadow-setup]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/shaders/eevee_light_shadow_setup.bsl.hh#L275-L355
[bl-shadow-membership]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/shaders/eevee_shadow_visibility.bsl.hh#L1-L55
[bl-surfel]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/draw/engines/eevee/shaders/eevee_surfel_light.bsl.hh#L24-L77
[bl-copying]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/COPYING
[three-rect-doc]: https://threejs.org/docs/pages/RectAreaLight.html
[three-rect-source]: https://github.com/mrdoob/three.js/blob/r184/src/lights/RectAreaLight.js#L3-L89
[three-light-uniform]: https://github.com/mrdoob/three.js/blob/r184/src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js#L173-L189
[three-direct-rect]: https://github.com/mrdoob/three.js/blob/r184/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js#L463-L525
[three-ltc]: https://github.com/mrdoob/three.js/blob/r184/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js#L201-L314
[three-ltc-textures]: https://github.com/mrdoob/three.js/blob/r184/examples/jsm/lights/RectAreaLightTexturesLib.js
[three-light-gather]: https://github.com/mrdoob/three.js/blob/r184/src/renderers/WebGLRenderer.js#L1823-L1851
