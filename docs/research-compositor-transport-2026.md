# Blender compositor transport prototype

Research date: 2026-09-07. Tested in isolated factory-startup processes on Blender 5.1.2 (`ec6e62d40fa9`) and 5.2.0 LTS (`fbe6228777e7`). This is extraction and semantics research; it does not certify browser pixel parity.

## Deliverables and result

`artifacts/verification-look/compositor/extract_prototype.py` contains a read-only `extract(scene)` function. `fixture.py` creates a reproducible branched compositor, saves disposable `.blend` fixtures and extracted JSON, and asserts:

- Only the active final output and its reachable branches are extracted.
- Extra root outputs, inactive output nodes and unused group outputs do not trigger false unsupported-node errors.
- Group input defaults and links bind by socket identifier; separate group instances retain their own bindings.
- Reroutes and muted nodes follow Blender's explicit internal bypass links.
- Shared branches are memoized and operations emitted in topological order.
- Output identities survive: a connection to Glare's `Glare` output remains distinct from its `Image` output.
- A newly reachable unsupported Lens Distortion node produces a diagnostic naming its source node and socket.
- Only referenced render passes are requested, including a named `StylizedMask` Value AOV.
- Disabling `scene.render.use_compositing` disables the exported compositor.

Both versions passed with twelve operations in the main fixture. JSON examples are `extracted-5.2.json`, `group-instances-5.2.json`, `named-pass-5.2.json` and `unsupported-5.2.json`, with equivalent 5.1 files.

## Version boundary

In both installed versions, the tree is `scene.compositing_node_group`; `scene.node_tree` is absent. `Scene.use_nodes` is deprecated and should not control modern extraction. The final result comes from the first Color input of the active `NodeGroupOutput`; other group outputs are ignored by the scene's final image. The old `CompositorNodeComposite` is undefined. Scene copies share the compositor datablock unless it is explicitly copied. These changes began in Blender 5.0. [Official compositor migration guide](https://developer.blender.org/docs/release_notes/5.0/migration/compositor_migration/)

The prototype has a legacy-tree adapter, but the older-version branch was not executed in this research. Its modern branch does not inspect deprecated `use_nodes`.

Many compositor operations now use shader node classes, and many node options became input sockets. Real socket inventories are recorded in `nodes-5.1.json` and `nodes-5.2.json`. One measured version difference: a new ShaderNodeMix Factor_Float defaults to 0.5 in 5.1 and 1.0 in 5.2. Export actual values rather than assumed defaults.

## Practical operation schema

Each operation records source group-instance path, node type/name, exact output socket identifier/type, semantic RNA properties, and an input dictionary keyed by socket identifier. Input values are typed constants, references, or explicit conversion requests. The prototype records conversions but does not implement Blender's conversion rules; a runtime must not treat an RGBA-to-float edge as an arbitrary component pick.

| Operation | Modern Blender ID | Significant sockets / metadata |
| --- | --- | --- |
| RGB / Value | `CompositorNodeRGB`, `ShaderNodeValue` | Output socket's actual default value |
| Math | `ShaderNodeMath` | `operation`, `use_clamp`; Value identifiers distinguish repeated labels |
| MixRGB | `ShaderNodeMixRGB` | `Fac`, `Color1`, `Color2`; `blend_type`, `use_alpha`, `use_clamp` |
| Mix | `ShaderNodeMix` | `data_type`, `factor_mode`, clamp options; typed socket identifiers such as `A_Color` |
| Alpha Over | `CompositorNodeAlphaOver` | `Background`, `Foreground`, `Fac`, `Type`, `Straight Alpha` |
| Exposure | `CompositorNodeExposure` | `Image`, `Exposure` |
| Bright/Contrast | `CompositorNodeBrightContrast` | `Image`, `Bright`, `Contrast` |
| Gamma | `ShaderNodeGamma` | `Color`, `Gamma` |
| Invert | `CompositorNodeInvert` | `Color`, `Fac`, `Invert Color`, `Invert Alpha` |
| Hue/Saturation/Value | `CompositorNodeHueSat` | `Image`, `Hue`, `Saturation`, `Value`, `Fac` |
| Blur | `CompositorNodeBlur` | `Image`, 2D-vector `Size`, menu `Type`, `Extend Bounds`, `Separable` |
| Glare | `CompositorNodeGlare` | Menu `Type` and `Quality`, highlight parameters, adjustment parameters and mode-specific inputs; separate Image/Glare/Highlights outputs |
| Render Layers | `CompositorNodeRLayers` | Scene, view-layer and requested pass identity |

Do not use socket index as a stable API. Also do not confuse identifier and display name: Glare's displayed `Threshold` is identified as `Highlights Threshold`; both `Float Kernel` and `Color Kernel` display as `Kernel`. Node-group identifiers are typically `Socket_N`, independently of their visible names. The prototype finds group bindings by comparing `socket.identifier`, rather than assuming `collection.get(identifier)` is an identifier lookup. [Official migration guidance](https://developer.blender.org/docs/release_notes/5.0/migration/compositor_migration/)

## Semantics to preserve

Exposure multiplies RGB by `2^exposure` and preserves alpha. It is a scene-linear operation. [Pinned Blender implementation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/composite/nodes/node_composite_exposure.cc)

Bright/Contrast uses brightness/100 and contrast/200. Positive contrast computes a reciprocal slope protected by float epsilon; negative contrast computes a slope clamped at zero. RGB receives the resulting slope and offset while alpha is preserved. A generic CSS contrast filter or a differently parameterized post effect will not reproduce this operator. [Pinned Blender implementation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/composite/nodes/node_composite_brightness_contrast.cc)

Hue/Saturation/Value wraps hue with the authored 0.5-neutral convention, scales saturation and value, converts back to RGB, clamps that adjusted RGB below at zero, and blends by Fac while retaining input alpha. Retaining HDR values and the position of that clamp matters. [Pinned Blender implementation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/composite/nodes/node_composite_hue_saturation_value.cc)

Alpha Over normally consumes premultiplied foreground color; Straight Alpha requests explicit foreground premultiplication. For standard Over, Blender computes foreground plus background times one minus clamped foreground alpha, then interpolates the whole RGBA result with the background by Fac. Disjoint and Conjoint Over use different equations and cannot be silently treated as standard Over. [Pinned implementation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/composite/nodes/node_composite_alpha_over.cc), [Alpha Over manual](https://docs.blender.org/manual/en/latest/compositing/types/color/alpha_over.html)

Modern Blur's pinned implementation reads `Size` directly as nonnegative 2D blur radius, supports a varying size image, and can extend image bounds. The size/domain, chosen kernel and separable flag all affect the result. Supporting only constant-radius Gaussian initially is a valid explicit subset; it must not silently absorb other modes. [Pinned Blur implementation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/composite/nodes/node_composite_blur.cc)

Glare combines highlight extraction, quality-dependent processing resolution, a mode-specific effect and output selection. The Image, Glare and Highlights outputs need separate semantics. Its constant-color input fast path and downsampling behavior are additional differential-test cases. Three Bloom availability does not prove Blender Glare equivalence. [Blender Glare implementation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/composite/nodes/node_composite_glare.cc)

## Named passes and EEVEE

The live fixture enabled Depth, Normal and Emission and declared one Value AOV. The EEVEE Render Layers node exposed `Image`, `Alpha`, `Depth`, `Normal`, `Emission` and `StylizedMask`. The program requests only connected passes; an enabled but unused Normal pass does not force an MRT allocation.

A runtime pass provider should resolve `(scene, viewLayer, pass)` before building effects, with explicit definitions for channel type and spatial meaning. Blender Normal is world-space and Vector contains previous/next screen motion. Pinned EEVEE 5.2 source and a rendered oracle show that Depth is **camera-axis linear Z**, including perspective cameras, with background sentinel `1e10`; generic render-pass documentation's distance wording is insufficient here. Raw Three depth and view-space normals therefore need conversion. Named AOVs additionally require translating their material writers; a matching string alone does not produce their values. See `research-source-passes-2026.md` for the source-backed correction and oracle.

EEVEE documents important limitations: Shader to RGB is correct only in Combined; most auxiliary passes exclude Blended surfaces; depth of field and motion blur affect Combined rather than the other passes. Older manual descriptions mention sixteen Color and sixteen Value AOVs, but pinned Blender 5.2 source now allows **128 total AOVs across both types**. Cycles light groups and transport-specific passes cannot be inferred from a generic raster render target. Preserve these differences in diagnostics and image tests. [Blender render-pass limitations](https://docs.blender.org/manual/en/latest/render/layers/passes.html), [current pinned AOV limit](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/draw/engines/eevee/eevee_renderbuffers_shared.hh).

## Adoption limits and next gates

`status: extracted` certifies schema extraction, not runtime support or visual equivalence. Treat `unsupported` as a failed whole program; the partial operation list retained for diagnostics must not be rendered as if complete.

The prototype deliberately diagnoses root Group Input nodes until scene-pipeline bindings are designed. Nested Group Input instances work. It also rejects other-scene Render Layers references, missing groups, cycles and ambiguous muted mappings. Active-node inputs are conservatively retained; mode-specific dependency pruning still needs per-operator rules because Glare leaves some irrelevant sockets available. No general constant folding, animation curve transport, drivers, multi-scene compositing, image-domain transforms or image-file inputs are implemented here.

The next acceptance gate should evaluate simple operators on identical HDR/alpha input images in Blender and the browser, then add kernels and pass-backed effects. Only after those isolated comparisons should complete EEVEE scene captures establish renderer-plus-compositor fidelity. Keep authored display conversion after this scene-linear graph and apply it once.

## Numeric browser reference cases

`artifacts/verification-look/compositor/generate_browser_cases.py` now creates seventeen 8×8 input/reference pairs using the production `packages/blendlink/blender/compositor_graph.py` extractor. The program is extracted with a Render Layers Image source; that source is then replaced privately with a float Image node containing known HDR, negative and partially transparent RGB values. The CPU compositor runs at FULL precision and writes EXR32; readback retains premultiplied RGBA. An identity case verifies input/output agreement within 0.000001 before any effect comparisons are accepted.

Files under `browser-cases/` contain flat `input`, `expected`, and the production `program`. Arrays are row-major, bottom row first, x-fastest, RGBA; they are scene-linear Linear Rec.709 without display conversion. The cases cover identity, exposure, positive/negative contrast, gamma, separate color/alpha inversion, HSV, MIX/ADD/MULTIPLY for both node families, premultiplied/straight Alpha Over and implicit Color-to-Value conversion. Generation took roughly five seconds including Blender startup; subsequent tiny renders were about 0.1 second each. Browser comparisons remain the consuming task's responsibility.
