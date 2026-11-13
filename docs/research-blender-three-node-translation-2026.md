# Blender shader and compositor translation

Research date: 2026-09-07. Primary-source review plus inspection of the repository's pinned `three@0.184.0`. This is a proposed direction, not a claim of implemented node coverage or measured visual parity. It extends [ADR 0006](adr/0006-webgpurenderer-and-tsl-are-the-v1-runtime-target.md) and [the post-processing replacement research](research-wgpu-post-replacement-2026.md).

## Recommendation

Treat the authored Blender scene as a program: translate its shader value graphs, material response, render inputs, compositor graph, and final display transform together. Use a mixture of native runtime evaluation and proven baked fields. A single shader-node name mapping cannot preserve the final image when the renderer supplies different lighting or compositing inputs.

Make fidelity measurable on actual scenes before enlarging the supported-node list. The highest-value first slice for a stylized diorama is the authored view transform, procedural color/ramp graphs, a deliberately scoped toon-lighting family, and the common compositor chain. Report exactly which graph sections remain dynamic, which are baked, and which need a different rendering contract.

## Current implementation boundary

The concurrent local audit found that this is partly an integration problem: [the project starter](../packages/blendlink/src/projectSetup.ts) already scaffolds WebGPU while [Preview Studio](../packages/blendlink/src/previewStudioHost.ts) still constructs `WebGLRenderer`. Runtime TSL installation is gated on WebGPURenderer in `threeRuntime.ts`. Align Preview Studio with the generated application's renderer first, so artists can see the material behavior being exported.

The local TSL material installer currently assigns base color, emission, roughness, metallic and alpha to a standard node material. Normal, coat and transmission roles need further implementation. The Blender IR already recognizes a **limited Diffuse-only Shader to RGB route**, excluding roughness/custom normals and using a fixed-light contract. The research below argues for broadening and testing that family; it does not mean Shader to RGB is entirely unsupported today.

The exporter's current display handling includes an AgX exposure calibration and Filmic-to-ACES mapping, while non-default looks, gamma and display curves are unsupported. Those existing approximations make authored display-transform transport a concrete next step. Existing post effects similarly provide useful runtime machinery but do not substitute for importing the authored compositor graph. These findings come from the local implementation audit; external API documentation alone does not establish SceneToWeb feature coverage.

## What Three already provides

- `WebGPURenderer` supports TSL node materials, WGSL/GLSL generation, a WebGL2 fallback backend, and a compositional post-processing system with multiple render targets. The fallback concerns backend reach; feature support and performance still need testing on the target device. The manual continues to describe the renderer as experimental. [Three renderer manual](https://threejs.org/manual/en/webgpurenderer)
- `MeshPhysicalNodeMaterial` accepts node inputs for clearcoat, sheen, anisotropy, IOR, transmission, thickness, dispersion, and other physical channels. This gives a practical destination for many Principled input graphs; it does not establish identical BSDF formulas or lighting. [Physical node material API](https://threejs.org/docs/pages/MeshPhysicalNodeMaterial.html)
- TSL exposes arithmetic, transforms, texture sampling, noise utilities, and post effects including blur, bloom, LUTs, depth of field, motion blur, outlines, SSAO/SSGI, and SSR. These are useful implementation primitives, not evidence of Blender algorithm equivalence. [TSL specification](https://threejs.org/docs/TSL.html)
- The pinned package has `RenderPipeline`; `PostProcessing` is a compatibility wrapper deprecated since r183. Use the current name in new work. [Pinned r184 source](https://github.com/mrdoob/three.js/blob/r184/src/renderers/common/PostProcessing.js)

## Shader translation boundaries

| Graph family | Proposed handling | Fidelity condition |
| --- | --- | --- |
| Math, Vector Math, Mix, Map Range, ColorRamp, RGB Curves, Mapping | Compile typed value graphs into TSL; preserve connected sockets, defaults, clamps, color spaces, and interpolation | Compare numeric outputs and rendered swatches against Blender across edge cases |
| Image Texture, UV, named attributes | Runtime sampling with authored coordinate and sampling semantics | Validate wraps, interpolation, UV choice, transforms, non-color data, and alpha |
| Noise, Voronoi, Wave and related procedurals | Port the relevant Blender semantics, or bake a proven static field | A similarly named Three/MaterialX noise function is not a compatibility implementation |
| Principled input graphs | Feed node-based physical material channels | Input equality and final lit-image equality are separate tests |
| Camera/Fresnel/Layer Weight effects | Evaluate at runtime where supported | A single texture cannot preserve a changing camera relationship |
| Shader to RGB and arbitrary BSDF combinations | Recognize specific lighting/material families and implement their response explicitly | Require renderer-specific image evidence; do not silently substitute a diffuse color field |
| Light Path, indirect light, volume and transport-dependent tricks | Explicit supported subsets or a declared fixed-state appearance result | A raster shader has no general Cycles path history |

Blender Noise includes dimensionality, fractional detail, roughness, lacunarity, distortion and normalization semantics. Matching a noise category is insufficient; coordinate defaults are also part of the node contract. This is a concrete reason to prefer differential tests over broad nominal support. [Blender Noise documentation](https://docs.blender.org/manual/en/4.0/render/shader_nodes/textures/noise.html)

Blender's Principled shader combines layered diffuse, metal, subsurface, transmission, coat, sheen, and emission behavior. Matching parameter names in Three does not prove that layering, energy compensation, or light integration are equal. That conclusion is an inference from the two material interfaces, and needs experiments. [Blender Principled documentation](https://docs.blender.org/manual/sl/5.2/render/shader_nodes/shader/principled.html), [Three physical node material](https://threejs.org/docs/pages/MeshPhysicalNodeMaterial.html)

**Shader to RGB deserves a dedicated milestone for stylized scenes.** Blender documents it as EEVEE-only: its color output contains BSDF and lighting evaluation. It also has render-pass and PBR-effect limitations inside Blender. Consequently, a Cycles field bake is not a general fallback for this node. A recognized Diffuse → Shader to RGB → ColorRamp family is a reasonable first runtime target, but Three's light/shadow response must be tested against the authored EEVEE result. [Blender Shader to RGB documentation](https://docs.blender.org/manual/id/5.1/render/shader_nodes/color/shader_to_rgb.html)

Light Path illustrates a harder limit: Blender documents differing EEVEE semantics because it has no real ray concept. Three cannot recover Cycles bounce histories by translating the node's output labels. [Blender Light Path documentation](https://docs.blender.org/manual/en/4.5/render/shader_nodes/input/light_path.html)

## Compositor translation

Preserve the connected graph, including branches and recombination, rather than flattening it into an effect list. Start with scene color, alpha, depth, normals, emission, masks and named shader AOVs; allocate only inputs used by the graph. TSL's render pipeline provides graph composition and MRTs. It also permits explicit output-transform placement instead of the default final tone mapping/color conversion. [Three post-processing manual](https://threejs.org/manual/en/webgpu-postprocessing.html)

Blender render passes include renderer-specific light components, AOVs, Cryptomatte and Cycles light groups. These are render products, not merely extra image sockets. MRTs can carry data that SceneToWeb computes, but they cannot supply missing path-traced indirect illumination. Ordinary object masks also do not reproduce Cryptomatte's multiple contributions per pixel through transparency, motion blur and depth of field. [Blender render passes](https://docs.blender.org/manual/en/latest/render/layers/passes.html)

Prioritize exposure, color balance/curves, Mix, alpha-over, masks, blur and the most common Glare settings. Treat Glare modes separately: Blender distinguishes Bloom, Fog Glow, Ghosts and Streaks. Three's pinned Bloom implementation uses threshold extraction and a multiscale separable blur; availability of that node does not establish matching Fog Glow or streak kernels. Resolution dependence, edge handling, premultiplied alpha and intermediate HDR ranges all belong in image tests. [Blender Glare](https://docs.blender.org/manual/id/5.1/compositing/types/filter/glare.html), [Three r184 Bloom source](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/tsl/display/BloomNode.js)

## Color management is part of the exported scene

Three's r184 AgX implementation explicitly uses `agxDefaultContrastApprox`, a polynomial curve approximation. Blender's OCIO configuration separately defines view transforms, display color spaces and looks. Choosing `AgXToneMapping` alone therefore cannot promise equality with the source scene; `ACESFilmicToneMapping` is also not Blender Filmic. [Three r184 tone mapping source](https://github.com/mrdoob/three.js/blob/r184/src/nodes/display/ToneMappingFunctions.js), [Blender OCIO configuration](https://github.com/blender/blender/blob/main/release/datafiles/colormanagement/config.ocio)

Export the actual working space, OCIO identity, view, display, look, exposure, gamma and authored adjustments. Implement the selected processor with analytic operations and LUT assets where appropriate, then validate the browser output against Blender color ramps and HDR samples. Apply it exactly once at the authored point in the pipeline. A finite 3D LUT is an approximation with domain/interpolation limits, not an automatic exact solution: OCIO exposes GPU processor shader extraction and explicitly distinguishes its less accurate legacy single-LUT path. Investigate the modern processor before settling on a lone small LUT. [OCIO processor API](https://opencolorio.readthedocs.io/en/latest/api/processors.html), [OCIO shader API](https://opencolorio.readthedocs.io/en/latest/api/shaders.html)

## Acceptance and convenience

These are proposed product requirements:

1. One export action analyzes the visible scene and chooses supported runtime or baked representations per graph section. No manual node rewiring for proven cases.
2. A compact report shows what translated, what baked, and the exact source node behind any remaining visible difference. A fallback must disclose whether it fixes lighting, animation or camera freedom.
3. Compare fixed-camera Blender references against browser captures with matching geometry, lighting, alpha, exposure and output transform. Show both images and a difference view; keep tolerances explicit per feature.
4. Run a second comparison after moving the camera/light or advancing animation, so a static match cannot certify dynamic fidelity.
5. Validate compositor operators independently on identical HDR/depth/mask input images; otherwise scene-render differences hide compositor defects.
6. Cache by graph topology and semantic inputs. Parameter-only edits should update uniforms where possible; static expensive subgraphs may be materialized once. Measure both compile time and browser frame cost before choosing runtime evaluation over baking.

The long-term promise should be increasingly broad, demonstrated fidelity with preserved interaction. Universal pixel-identical Cycles transport at real-time browser cost is not established by the APIs reviewed here.
