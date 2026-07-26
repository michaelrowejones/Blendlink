# Blendlink scene visual-effects audit

Research date: 2026-07-21

## Scope and evidence boundary

This is a source-level audit of the eleven scene effects. It is deliberately
not a claim that any effect works in Blender, Preview, or a published site.
The audit inspected Blendlink's current implementation and the exact packages
installed in this worktree:

- `three@0.184.0`;
- `postprocessing@6.39.3`;
- `n8ao@1.10.2`;
- `@react-three/fiber@9.6.1`; and
- `react@19.0.0`.

The installed versions satisfy their declared peer ranges. The principal
Blendlink sources are `packages/blendlink/src/components.ts` and
`packages/blendlink/src/threeComponents.ts`. Tests currently establish object
construction, ordering, selected cleanup, and policy transitions using a fake
renderer. They do **not** compile the shaders, render reference frames, measure
GPU work, or establish visual quality. The repository's general visual-audit
runner can compare real browser PNGs, but no effect-specific reference images
or completed effect matrix were found. Therefore every visual status below is
either **source-proven defect**, **source-supported design**, or **unverified**.

The production boundary remains `WebGLRenderer`. Three documents
`WebGLRenderer` as its maintained choice for pure WebGL applications, while
the new post-processing architecture is TSL/node composition and does not run
legacy `EffectComposer` code unchanged. WebGPU/TSL is consequently a future
adapter, not a remedy for the defects below.
[Three WebGPU migration guide](https://threejs.org/manual/en/webgpurenderer)
[Three TSL post-processing catalog](https://threejs.org/docs/pages/TSL.html)

Exact installed-source anchors used for findings that public API prose alone
cannot establish:

| Evidence | Installed source |
| --- | --- |
| Blendlink effect construction, phases, quality, and shaders | `packages/blendlink/src/threeComponents.ts:373-1491` |
| Blendlink public fields/defaults/support badges | `packages/blendlink/src/components.ts:111-381` |
| pmndrs SRC ignores opacity; SCREEN with black is identity | `node_modules/postprocessing/build/postprocessing.js:2446-2576` ([upstream blend sources](https://github.com/pmndrs/postprocessing/tree/v6.39.3/src/effects/blending/glsl)) |
| pmndrs effect color-space integration and attribute sorting | `node_modules/postprocessing/build/postprocessing.js:15430-15645` ([upstream EffectPass](https://github.com/pmndrs/postprocessing/blob/v6.39.3/src/passes/EffectPass.js)) |
| Bloom threshold/MIP allocation and full-input MIP sizing | `node_modules/postprocessing/build/postprocessing.js:4038-4175,4198-4477` ([upstream BloomEffect](https://github.com/pmndrs/postprocessing/blob/v6.39.3/src/effects/BloomEffect.js)) |
| LUT defaults to SRC and sRGB input | `node_modules/postprocessing/build/postprocessing.js:8082-8255` ([upstream LUT3DEffect](https://github.com/pmndrs/postprocessing/blob/v6.39.3/src/effects/LUT3DEffect.js)) |
| N8AO converts configured tint sRGB→linear, detects transparency, and has no class disposal override | Runtime bundle `node_modules/n8ao/dist/N8AO.js:1220-1849`; matching readable source `node_modules/n8ao/src/N8AOPostPass.js:45-144,282-351,539-791` ([upstream N8AOPostPass](https://github.com/N8python/n8ao/blob/main/src/N8AOPostPass.js)) |
| N8AO fullscreen wrappers own disposable shader materials | `node_modules/n8ao/src/FullScreenTriangle.js:1-35` ([upstream FullScreenTriangle](https://github.com/N8python/n8ao/blob/main/src/FullScreenTriangle.js)) |
| Three uploads `toneMappingExposure` to matching shader uniforms | `node_modules/three/src/renderers/WebGLRenderer.js:2699-2702` ([Three r184 renderer source](https://github.com/mrdoob/three.js/blob/r184/src/renderers/WebGLRenderer.js)) |

## Executive finding

The shared pipeline is a sound direction, but the present `production` labels
are ahead of the evidence. Three effects have source-proven artist-control
failures, Bloom's normal LDR fallback can be visually empty at its default,
and Kuwahara is an honest prototype only in its registry badge—not in all of
its descriptive copy. The remaining effects are plausible implementations
without rendered acceptance evidence.

### Ranked risk

| Rank | Effect | Finding | Confidence | Smallest defensible action |
| --- | --- | --- | --- | --- |
| P0 | Outline | The artist defaults are black/dark, but `OutlineEffect` is left at its default `SCREEN` blend. Screen with black is the destination unchanged. pmndrs explicitly says to use `ALPHA` for dark outlines. | Source-proven broken default | Pass `blendFunction: BlendFunction.ALPHA`; add visible/hidden-edge screenshots before restoring Production. |
| P0 | Color Grade | `intensity` is assigned to blend opacity while `LUT3DEffect` keeps `SRC`. In installed pmndrs, the SRC blend function returns the source and ignores opacity, so every Intensity value renders identically. | Source-proven ineffective field | Construct with `BlendFunction.NORMAL` (or an explicit shader mix), then verify 0/0.5/1 against identity and channel-swap LUTs. |
| P0 | Ambient Occlusion | Blendlink's contract says tint tuples are linear RGB. N8AO converts `configuration.color` from sRGB to linear during every render, so a non-black Blendlink tint is decoded a second time. | Source-proven wrong field semantics | Convert the Blendlink linear color to sRGB before assigning the N8AO configuration, or adapt N8AO behind a clearly named linear-color seam. |
| P0 | Bloom | With an unsigned-byte/LDR target, color has already been tone-mapped/clamped to at most 1. The default threshold is 1 and pmndrs masks with `smoothstep(threshold, threshold+smoothing, luminance)`, so ordinary default LDR content contributes no bloom. The warning calls this a compatible fallback but does not say the default can be empty. | Source-proven default/fallback mismatch | Prefer a restrained sub-1 default for new records and issue an actionable LDR warning when threshold is at least 1; verify HDR and forced-LDR fixtures. |
| P1 | N8AO cleanup | `N8AOPostPass` has no own `dispose()` in 1.10.2. Its inherited pmndrs `Pass.dispose()` shallowly disposes direct render targets/materials/textures/passes, but N8AO's `FullScreenTriangle` wrappers are none of those. Their shader materials are therefore not demonstrably released. | Source-proven ownership gap; actual driver retention unmeasured | Add a pinned adapter cleanup test using renderer program/texture counts. Prefer an upstream disposal fix or a versioned wrapper over undocumented property poking. |
| P1 | Kuwahara | The single full-resolution shader estimates orientation from four immediate luma samples and evaluates four sparse sectors. The cited anisotropic method uses a smoothed structure tensor and eight polynomial sectors; the multi-scale paper adds a low-pass pyramid. Blendlink copy says “multi-stage” and says quality may lower working resolution, but the implementation is one stage and quality changes only sample count/radius. | Source-proven description mismatch; visual quality unverified | Keep Experimental/Preview; correct the copy immediately. Promotion requires a multi-pass implementation or evidence that the approximation meets explicit visual, temporal, and device budgets. |
| P1 | Pixelation | The color-only pmndrs path transforms UV before sampling, so RGBA is pixelated together. Blendlink's geometry-aware path samples block RGB but returns the original per-pixel alpha, producing a high-resolution alpha silhouette around block RGB. R3F resize observes logical size, not `viewport.dpr`, so a DPR-only change may retain stale granularity. | Source-supported defect paths; browser reproduction required | Sample block alpha in the geometry path and key R3F resize to DPR as well as size; assert exact CSS-pixel blocks at DPR 1/2/3. |
| P1 | Tilt Shift | Authored `quality: high` is immediately capped by the runtime's hard-coded initial Balanced policy. No production caller selects High. Thus choosing High is indistinguishable from Balanced in the ordinary workflow. | Source-proven workflow mismatch | Make initial runtime quality explicit in the install API/descriptor and visible in diagnostics, or remove High from authoring until a host can select it. |
| P1 | Stack semantics | Effects are sorted by broad phase and then component ID; pmndrs also sorts effects within a fused pass by resource attributes. There is no artist-authored stack order, and “post-ldr” contains multiple different color-space expectations. | Source-proven fixed ordering; correctness unverified | Publish one documented fixed semantic order and test it, or add a validated authored-order contract. Do not describe alphabetical IDs as semantic order. |
| P2 | Depth of Field | The installed pmndrs implementation supports world-unit distance, a moving target, perspective/orthographic camera data, near/far bokeh, and resize. Transparent surfaces remain a declared depth limitation; camera motion, focus accuracy, and edge artifacts have no rendered evidence. | Plausible, unverified | Keep Preview until the depth-ladder and moving-target oracles pass. |
| P2 | Vignette | All three fields reach uniforms, processing is in linear display-referred RGB after tone mapping, and input alpha is copied exactly. The default is restrained. Shape, aspect behavior, tint attractiveness, and stacking remain visually unreviewed. | Source-supported, unverified | Render a flat-field/radial oracle at wide/mobile aspects; tune only from reviewed images. |
| P2 | Chromatic Aberration | Directional mode delegates to pmndrs; radial mode aspect-corrects its direction, bounds samples, and preserves input alpha. Amount is normalized image space, which is stable in CSS pixels across DPR at a fixed CSS viewport but scales with viewport width by design. | Source-supported, unverified | Validate channel centroids and transparent edges at multiple dimensions/DPRs. |
| P2 | Sharpen | The bounded cross-shaped five-tap shader is safe and every Amount value is wired. It is inspired by CAS but is not the reference FidelityFX CAS kernel, so the current “CAS-style” wording is important. Halo/noise behavior is unmeasured. | Source-supported approximation | Retain “style”; use MTF/step/noise oracles and real GPU timing before Production. |

## Shared WebGL pipeline

### What is well designed

The pipeline centralizes the composer, depth target, optional normal pass,
quality changes, resize, effect fusion, tone-map transfer, and disposal. It
uses a half-float target when `EXT_color_buffer_float` is available, disables
the renderer tone mapper only while it owns an equivalent pmndrs
`ToneMappingEffect`, and restores shared renderer state with reference counts.
This follows pmndrs' documented linear/HDR workflow: high-precision linear
buffers, `NoToneMapping` on the renderer, and tone mapping at the end of the
HDR portion of the chain.
[pmndrs postprocessing: output color space and tone mapping](https://github.com/pmndrs/postprocessing#output-color-space)

The installed `EffectPass` converts between Linear-sRGB and sRGB when an
effect declares a different input color space and encodes output when rendering
to screen. This matters for `LUT3DEffect`, whose installed default input color
space is sRGB, while custom Blendlink effects default to Linear-sRGB.
[LUT3DEffect reference](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/LUT3DEffect.js~LUT3DEffect.html)
[Three color-management guide](https://threejs.org/manual/en/color-management.html)

Resize is mostly delegated correctly: the composer queries the renderer's
drawing-buffer size after receiving logical dimensions, and its passes receive
backing-buffer dimensions. The gap is at the R3F binding: its resize effect is
keyed only by logical width/height, while R3F exposes DPR separately. A DPR-only
change must be an acceptance case rather than assumed to cause a logical resize.

Cleanup is reasonably explicit for pmndrs effects, selective Bloom/Outline
selection layers, owned LUT textures, the composer, and renderer state. N8AO is
the exception described above. Cleanup acceptance must inspect renderer
program/texture counts after repeated install/render/dispose cycles; a unit
spy on a high-level `dispose()` call is insufficient.

### Color, HDR, alpha, and output rules

Three's working space is Linear-sRGB; display output is normally sRGB. It warns
that post-processing needs an output conversion and that half-float precision
is preferred when later stages require linear HDR data.
[Three color management](https://threejs.org/manual/en/color-management.html)
[WebGLRenderer output and buffer types](https://threejs.org/docs/pages/WebGLRenderer.html)

Blendlink's HDR order is currently:

1. scene color/depth;
2. pass effects such as AO;
3. `post-depth` effects such as DoF;
4. `post-hdr` effects such as Bloom and Tilt Shift;
5. transferred application tone mapping when supported;
6. `post-ldr` creative effects;
7. optional SMAA; and
8. screen color-space encoding.

That broad order is credible. The exact order inside each phase is not yet a
product contract. Alpha behavior is also effect-specific, not guaranteed by
the composer: Vignette, Sharpen, radial Chromatic Aberration, and Kuwahara copy
input alpha; convolution effects may spread RGBA; geometry-aware Pixelation
currently samples RGB and retains unpixelated alpha; Outline in ALPHA mode and
Bloom can deliberately create visible coverage outside the original opaque
silhouette. Each needs transparent-canvas references over both light and dark
HTML backgrounds. “Alpha preserved” must mean a defined compositing result,
not merely that a shader writes an alpha channel.

### Quality tiers are policy, not evidence

Current tier behavior is:

| Effect | Low | Balanced | High | Audit |
| --- | --- | --- | --- | --- |
| Bloom | 5 MIP levels | 7 | 8 | `resolution.scale` changes too, but installed mipmap blur always sizes from the full input, so that scale is ineffective in mipmap mode. |
| Pixelation edges | normal buffer at 0.5 scale | 1 | 1 | Color-only path is unchanged. |
| Tilt Shift | small kernel, 0.35 scale | medium, 0.5 | large, 1 | Further capped by authored Quality; ordinary startup always uses Balanced. |
| AO | Performance, half-res | Medium, half-res | High, full-res | N8AO changes shader sample counts, denoise samples, and targets; transitions can recompile/allocate. |
| Outline | 0.5 multiplier | 0.75 | 1 | Resolution changes can also change apparent stroke width. |
| DoF | 0.25 scale | 0.5 | 1 | Same authored focus/blur controls. |
| Kuwahara | 8 samples/sector, 0.75 radius scale | 12/1 | 16/1.15 | Still full-resolution; lower quality changes the rendered look as well as cost. |
| Vignette, chromatic aberration, color grade, sharpen | unchanged | unchanged | unchanged | Reasonable for cheap fixed-work effects, but must be measured. |

pmndrs' mipmap Bloom performs one luminance pass, a downsample at every MIP,
and an upsample for all but the smallest level before final composition. Its
MIP count is therefore a meaningful cost knob; Blendlink's additional
`effect.resolution.scale` assignment is not.
[BloomEffect reference](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/BloomEffect.js~BloomEffect.html)
[MipmapBlurPass reference](https://pmndrs.github.io/postprocessing/public/docs/class/src/passes/MipmapBlurPass.js~MipmapBlurPass.html)

## Effect-by-effect acceptance oracles

These are not generic “pixels changed” assertions. Each oracle has a known
spatial or numeric relationship that the output must satisfy.

### 1. Bloom

Use a black scene containing equal-area emissive patches at linear radiances
0.5, 0.8, 1, 2, and 8 plus a bright non-emissive patch. Capture half-float HDR
and forced unsigned-byte LDR at exposures 0.5/1/2.

- Below-threshold patches must remain within baseline tolerance; above-threshold
  halo energy must increase monotonically with radiance and Intensity.
- Radius must increase the second spatial moment of halo energy without moving
  its centroid.
- Emissive Objects must reject the bright non-emissive patch and select every
  exported emissive material, including multi-material meshes.
- Changing exposure must not change the pre-tone threshold membership, though
  final perceived brightness changes through tone mapping.
- Transparent output must be composited over black, white, and a checkerboard;
  RGB/alpha fringes must be intentional and stable.
- Forced LDR must either produce the documented fallback with defaults or give
  an actionable diagnostic that says which threshold can work.

pmndrs defines threshold, smoothing, MIP count, radius, and intensity exactly
as used here; its default threshold is 1 and its default intensity is 1.
[BloomEffect reference](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/BloomEffect.js~BloomEffect.html)

### 2. Vignette

Render a constant RGBA flat field at 16:9, 9:16, and 1:1.

- Center RGB and every alpha byte must equal baseline.
- Along rays from center, distance from Tint must be monotonic; corresponding
  normalized positions must agree across aspect ratios according to the chosen
  frame-shape contract.
- Intensity 0 must be exact baseline; increasing Intensity must monotonically
  approach Tint at corners.
- Increasing Softness must widen the transition rather than merely darken it.
- A non-black linear tint must move RGB toward the declared linear tuple with
  no global gamma shift.

### 3. Chromatic Aberration

Use isolated white vertical/horizontal lines, a radial spoke chart, and a
transparent colored silhouette.

- Directional mode channel centroids must separate by the authored angle and
  normalized amount; reversing angle by 180 degrees must swap red/blue sides.
- Radial mode must have zero displacement at Center and monotonically increasing
  displacement outward, with no x/y bias on a non-square frame.
- DPR 1/2/3 at fixed CSS size must agree after downsampling to CSS pixels.
- Amount 0 must be exact baseline and all texture coordinates must remain
  bounded at frame edges.

### 4. Pixelation

Use a one-device-pixel checker, a depth step, a normal crease, and a
partially-transparent diagonal.

- Every block must be uniform RGBA, aligned to a stable origin, and measure the
  requested CSS pixel size at DPR 1/2/3.
- Depth Edges 0 and Normal Edges 0 must exactly match the cheaper color-only
  path. Raising each independently must darken only its corresponding boundary.
- Transparent coverage must be block-sampled consistently with RGB.
- Resize and DPR-only changes must rebuild the exact grid without a one-frame
  stale size.

Three's own WebGL `RenderPixelatedPass` and TSL `pixelationPass` are useful
references because they jointly render beauty, normal, and depth rather than
adding high-resolution geometry edges after an unrelated color pixelation.
[RenderPixelatedPass](https://threejs.org/docs/pages/RenderPixelatedPass.html)
[TSL pixelationPass](https://threejs.org/docs/pages/TSL.html#pixelationPass)

### 5. Contrast-Adaptive Sharpen

Use flat fields, slanted edges, a Siemens star, high-frequency texture, and
white noise.

- Flat fields must remain exact; Amount 0 must be exact baseline.
- MTF50/high-frequency contrast should rise monotonically over a useful Amount
  interval, while overshoot beside a step edge stays below a reviewed bound.
- The output must remain finite and in the intended post-tone range.
- Noise amplification and halos must be measured, not judged from a single
  attractive scene.

Compare the approximation against the official FidelityFX CAS reference on the
same input before strengthening the product name. CAS is an adaptive sharpener
with an optional scaling path; Blendlink currently implements only a small
fixed-footprint approximation.
[AMD FidelityFX CAS](https://gpuopen.com/fidelityfx-cas/)

### 6. Tilt Shift

Render a full-frame texture with repeated equal-frequency detail and a depth-
independent diagonal chart.

- The sharpness metric must peak in the authored focus band and decline
  smoothly on both sides.
- Focus Position translates that peak; Angle rotates its locus; Feather changes
  transition width; Strength changes blur without moving the focus band.
- Low/Balanced/High must preserve focus geometry and converge visually as
  resolution increases. The chosen authored/runtime quality resolution must be
  reported.
- Frame edges and transparent borders must not develop dark or opaque smears.

### 7. Ambient Occlusion

Use two perpendicular planes with calibrated separations, a floating cube,
thin geometry, transparent single- and multi-material meshes, and both
perspective and orthographic cameras.

- In World mode, the occlusion reach in world units must remain constant as the
  camera dollies; its screen projection changes. In Screen mode, measured reach
  in backing pixels must remain constant.
- Intensity 0 must be exact baseline. A non-black Tint must produce the declared
  linear color, catching the present double decode.
- Occlusion must be stable under camera motion and should not become an edge
  detector at small radii; noise and denoising residuals need explicit metrics.
- Transparent handling, log depth, reversed depth, and orthographic projection
  each need separate frames and console/shader checks.
- Repeated install/dispose must return renderer program/texture counts to the
  warmed baseline.

N8AO documents radius/falloff sensitivity, quality modes, transparent-object
handling, and its WebGPU limitation. Its own source converts configured color
from sRGB to linear, auto-detects transparency, and switches sample/denoise
counts by quality.
[N8AO official repository](https://github.com/N8python/n8ao)
[N8AO documentation](https://n8programs.com/n8ao/)

### 8. Outline

Use two overlapping selected boxes and one unselected occluder over transparent
and opaque backgrounds.

- Default visible edges must contain a nonzero count of pixels close to the
  authored black. This single check catches the current SCREEN failure.
- X-Ray off must suppress hidden edges; on must reveal exactly the selected
  hidden silhouettes with Hidden Color.
- Measured thickness in the chosen unit must stay within tolerance across DPR
  and quality tiers.
- Strength 0 and Thickness 0 must be exact baseline.
- After disposal, every selected object's layer mask must equal its original,
  and no outline target/program may continue to grow across reinstall cycles.

pmndrs explicitly requires `BlendFunction.ALPHA` for dark outlines.
[OutlineEffect reference](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/OutlineEffect.js~OutlineEffect.html)

### 9. Color Grade

Use a 2x2x2 identity LUT, a deterministic channel-permutation LUT, and malformed,
404, and cross-origin URLs.

- Identity at Intensity 1 must match baseline within texture precision.
- Intensity 0 must be exact baseline; 0.5 must be the defined midpoint in the
  selected grading color space; 1 must match the known channel transform. This
  catches the current SRC-opacity failure.
- Tetrahedral off/on must agree at lattice points and differ only within a
  bounded interpolation tolerance between them.
- Query/hash URLs must select the correct loader; failures must name the URL,
  extension, and loader/CORS cause.
- Loading and disposal must respect application-owned versus Blendlink-owned
  textures.

Installed pmndrs declares `LUT3DEffect` input as sRGB by default and says
tetrahedral interpolation is more accurate but slower.
[LUT3DEffect reference](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/LUT3DEffect.js~LUT3DEffect.html)

### 10. Depth of Field

Use a depth ladder with textured planes in front of, at, and behind the focus
distance, then move a focus target laterally and in depth while the camera moves.

- Sharpness must peak at the focus distance/target and fall on both foreground
  and background sides.
- Focus Range widens the sharp interval without moving its center; Blur Strength
  increases blur without changing focus.
- Object focus must follow world position under parenting and camera motion.
- Perspective and orthographic cameras need separate expected frames; excessive
  near/far ratios must produce the existing warning and bounded artifacts.
- Transparent foreground/background cases must display the documented
  limitation rather than a grey frame or shader failure.

The installed pmndrs implementation accepts world-unit `focusDistance` and
`focusRange`, calculates object focus from camera-to-target distance, owns near
and far bokeh buffers, and resizes its internal targets.
[DepthOfFieldEffect source reference](https://pmndrs.github.io/postprocessing/public/docs/file/src/effects/DepthOfFieldEffect.js.html)

### 11. Kuwahara Painterly Filter

Use flat/noisy regions, a hard diagonal, corners, curved high-contrast strokes,
fine texture, and a slow sub-pixel camera pan.

- Flat-region variance must decrease while the edge-location error stays below
  a reviewed bound; corners must not round into an unrelated shape.
- Directionality must improve coherence along oriented features without
  introducing streaks in isotropic regions.
- Strength 0 must be exact baseline; all controls need monotonic or otherwise
  explicitly defined image metrics.
- Temporal evidence must report per-pixel frame-to-frame residual after
  compensating for known camera motion, plus a reviewed animation.
- Transparent tests must detect RGB bleed from unpremultiplied samples.
- Low/Balanced/High must report actual sample texture reads, working resolution,
  GPU time, and visual delta. Current shader work is approximately four sectors
  times 8/12/16 eligible samples plus gradient reads per output pixel.

The strongest cited target is not a four-sector single-pass filter. The 2010
formulation uses eight polynomially weighted sectors over an ellipse shaped by
local orientation/anisotropy. The 2011 method adds thresholding and a low-pass
pyramid to reduce artifacts and support stronger abstraction.
[Anisotropic Kuwahara polynomial weighting paper](https://www.kyprianidis.com/p/npar2010/jkyprian-npar2010.pdf)
[Multi-scale anisotropic Kuwahara paper and artifacts](https://www.kyprianidis.com/p/npar2011/index.html)

## Performance evidence required

No physical-device effect measurements were found. Do not derive mobile claims
from SwiftShader. Use it only for deterministic correctness and shader-failure
coverage.

For each effect alone and for representative stacks, record:

- cold module/load time, shader compile/link duration, and first useful frame;
- steady-state CPU p50/p95 and GPU p50/p95 from non-blocking disjoint timer
  queries where supported;
- renderer calls, triangles, programs, geometries, and textures with
  `renderer.info.autoReset = false` across the complete multi-pass frame;
- allocated render-target dimensions, format, samples, and calculated bytes,
  clearly labeled as calculated rather than browser-reported residency;
- pass/fullscreen-draw count and effect-internal sample counts;
- 1280x720 DPR 1, 1280x720 DPR 2, 390x844 DPR 3 (or the target phone's actual
  viewport/DPR), and 1920x1080 DPR 1 sensitivity;
- idle/static and animated-camera runs; and
- Low/Balanced/High plus the combined artist-representative stack.

Three exposes renderer counters and recommends disabling automatic reset when
collecting a frame containing multiple passes.
[WebGLRenderer `info`](https://threejs.org/docs/pages/WebGLRenderer.html#info)

The repository's `runtimePerformance` timer-query seam can collect part of
this evidence, but it must surround the entire Blendlink render and be paired
with effect identity, resolution, quality, physical GPU/browser/driver, and
render-target accounting. A median from an unknown GPU is not a product tier.

## Two credible architecture choices

### Design A — harden the shared pmndrs WebGL service

Keep renderer-neutral records and the current deep package-owned pipeline.
Correct the three proven contracts, make initial runtime quality explicit, add
the effect laboratory and reference oracles, and wrap/pin dependency ownership
where its cleanup contract is insufficient. Publish one fixed semantic order.

Advantages: smallest change, leverages installed pmndrs depth/color-space/pass
fusion, preserves existing generated bindings, and fits WebGL production now.
Costs: N8AO and pmndrs semantics remain dependencies; custom effects still need
their own alpha and visual validation; future TSL work remains separate.

### Design B — replace the WebGL stack with Three official passes/custom passes

Use Three's `RenderPixelatedPass`, official output pass, and other official
WebGL examples where available, while implementing the missing effects and one
Blendlink-owned graph.

Advantages: fewer third-party semantic surprises and closer alignment with
Three's examples. Costs: no single official WebGL implementation covers all
eleven effects; Bloom, selective masks, LUTs, DoF, effect fusion, and AO would
still require mixed dependencies or substantial new engine code. This expands
Blendlink toward an engine and duplicates mature pmndrs machinery.

### Recommendation

Choose Design A for this pass. It is the deeper module: application bindings
stay tiny while color, depth, ordering, quality, cleanup, and diagnostics have
one owner. Do not promote source presence to Production; promotion belongs to
the browser evidence. Use Three's official WebGL/TSL implementations as
acceptance references, not as a reason to rewrite the current renderer before
it is measured.

For stack ordering, also compare two product contracts:

1. a fixed documented order (AO → DoF/Tilt → Bloom → tone map → LUT → stylize
   → lens/pixel/sharpen/vignette → outline/AA); or
2. artist-authored order with dependency constraints and loud invalid
   combinations.

The fixed order is the better first contract for solo developers: it is
predictable, testable, and avoids exposing renderer graph theory. Artist order
should be added only when real scenes demonstrate a need.

For Kuwahara, retain the current bounded shader only as a named approximation
or build the faithful multi-pass path: smoothed structure tensor, eight
polynomial sectors, optional pyramid, premultiplied-alpha handling, and tiered
working resolution. These are distinct designs. The former can remain Preview
if its evidence is good; only the latter should inherit the paper's stronger
algorithmic claims without qualification.

## Minimal high-confidence implementation sequence

1. Fix Outline blend mode, Color Grade interpolation blend, and AO tint
   conversion; add narrow unit assertions against the actual installed effect
   properties **and** browser-rendered acceptance frames.
2. Make forced-LDR Bloom actionable and tune new-record defaults from reviewed
   HDR/LDR images. Remove the ineffective mipmap `resolution.scale` quality
   claim or implement a real working-resolution policy.
3. Correct Kuwahara's “multi-stage” and working-resolution copy immediately;
   keep Preview until temporal and physical-device evidence exists.
4. Pixelate geometry-aware alpha, observe DPR changes in R3F, and prove CSS-grid
   dimensions at DPR 1/2/3.
5. Make initial runtime quality an explicit, reportable install decision so
   authored Tilt Shift High can actually be selected.
6. Add a supported N8AO cleanup boundary and a 25-cycle warm/install/render/
   dispose resource-count regression.
7. Run every oracle opaque/transparent, desktop/mobile, still/moving, alone and
   in the fixed representative stack; then update the component ledger.

Until that sequence produces artifacts, a truthful source-only status is:

- **Gap/Broken:** Outline default, Color Grade Intensity, AO non-black Tint;
- **Preview:** Bloom fallback/default, Pixelation geometry-alpha/DPR, Tilt Shift
  High workflow, DoF, and Kuwahara;
- **Preview pending visual review:** Vignette, Chromatic Aberration, Sharpen;
- **Production:** none of the eleven based on current rendered evidence.

That final line is not a judgment that the plausible effects look bad. It is
the evidence standard requested for this pass: adapter code and unit tests are
not rendered proof.

## Implementation follow-up (2026-07-21)

After the source audit, the narrow installed-API fixes were applied without
promoting any effect to visually verified:

| Effect | Implemented source/API correction | Evidence after this change |
| --- | --- | --- |
| Outline | Explicit `BlendFunction.ALPHA`, so authored dark edges are not a `SCREEN` identity | Installed object property test; rendered dark/light/X-Ray matrix pending |
| Color Grade | Explicit `BlendFunction.NORMAL`, making blend opacity interpolate input and LUT output | Installed object property, opacity, tetrahedral-mode, and ownership tests; rendered LUT/color-space matrix pending |
| Ambient Occlusion | Linear Blendlink tint is converted to the sRGB-facing N8AO 1.10.2 configuration boundary | Installed N8AO configuration test; nonblack rendered tint matrix pending |
| Bloom | New-record threshold is `0.8`; LDR warning explains that thresholds at/above `1` cannot select ordinary clamped highlights; quality changes only MIP count | Runtime warning/default/MIP API tests; rendered HDR/LDR matrix pending |
| Pixelation | Geometry-aware block output samples alpha from the same block UV as RGB | Installed shader-source assertion; transparent-canvas render pending |
| Kuwahara | Catalog and ledger now describe an experimental single-pass approximation and admit that quality changes sample count and filter radius | Metadata/schema tests; all visual and performance evidence remains pending |

## Post-audit integrated browser evidence

The dogfood site subsequently added an application-owned effect-isolation mode
around the real `ComponentLab.blend` output. Each case installs the eight
generated object records plus exactly one of the eleven generated scene-effect
records through the R3F binding and production Next.js build. An identity-LUT
composer control avoids counting the direct-renderer-to-composer transition as
effect output. Repeat-control noise was zero.

All eleven effects produced a visible canvas, reported their exact authored ID
in the resolved post stack, changed more than 0.01% of pixels, and exceeded RGB
MAE 0.01. Color Grade initially and correctly failed at zero delta because the
fixture used an identity LUT; after authoring a restrained nonidentity LUT in
the Blender fixture, regenerating the `.blend` through the installed add-on,
and publishing normally, it passed at 27.7620% changed pixels and MAE 1.237386.

This establishes an integrated, rendered **presence/effectiveness** gate, not
the effect-specific correctness or aesthetic claims listed above. The run used
Chrome WebGL 2 on ANGLE/SwiftShader. Transparent/DPR/mobile/camera-motion
matrices, reviewed references, temporal stability, and physical-GPU performance
remain open, so no effect was promoted beyond Preview. Exact results and the
distinction are summarized in [the component acceptance record](COMPONENT_ACCEPTANCE.md).

The remaining cleanup, temporal, GPU-budget, and real-browser acceptance work
from the sequence above is unchanged. In particular, these unit tests do not
compile the GLSL or establish production-quality appearance.
