# WebGPU and Blendlink

Research date: 2026-07-21

## Executive recommendation

**Keep Three.js `WebGLRenderer` as Blendlink's production default. Begin a
separate, explicitly experimental `WebGPURenderer`/TSL adapter, but do not expose
WebGPU as an artist-facing render-mode checkbox until it has full visual and
component parity.**

WebGPU is the correct strategic direction. It exposes modern GPU rendering and
compute capabilities, and Three.js is concentrating major new renderer work on
its WebGPU/TSL stack. But Three still calls `WebGPURenderer` experimental and
warns that some applications will have missing features or perform better with
`WebGLRenderer`. More importantly, Three's WebGPU renderer does not run the
legacy `EffectComposer`, `ShaderMaterial`, `RawShaderMaterial`, or
`onBeforeCompile` paths. Those are not incidental limitations for Blendlink:
the current component pipeline is built on `postprocessing`, N8AO, GLSL custom
effects, and an `onBeforeCompile` baked-appearance path.
[Three WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer)

So the answer to “should we use WebGPU?” is **yes for an experimental future
adapter and renderer-neutral design work; no as the primary renderer or a
near-term quality fix for Bloom, Vignette, AO, or Kuwahara.** The immediate
component-quality effort should harden the current WebGL stack. A premature
renderer switch would add a second implementation before the first has visual
acceptance evidence.

## What WebGPU is

WebGPU is a low-level Web API for GPU rendering and general-purpose compute. It
is designed to map efficiently to modern native APIs such as Direct3D 12,
Metal, and Vulkan; unlike WebGL, it is not designed around OpenGL ES. WebGPU
also makes compute shaders a first-class feature rather than requiring graphics
workarounds. Its shader language is WGSL.
[WebGPU specification introduction](https://gpuweb.github.io/gpuweb/#introduction)
[WebGPU explainer](https://gpuweb.github.io/gpuweb/explainer/)
[WGSL specification](https://www.w3.org/TR/WGSL/)

This creates real opportunities for lower CPU submission overhead, GPU compute,
modern multi-pass pipelines, and future effects that are awkward under WebGL.
It does **not** mean that an existing Three.js WebGL scene becomes faster by
changing one constructor. Renderer architecture, shader implementation,
materials, pass fusion, device limits, and scene workload still determine the
result. Three explicitly notes that `WebGLRenderer` can still be faster for
some scenes.
[Three WebGPURenderer migration guidance](https://threejs.org/manual/en/webgpurenderer#migration)

As of this review, WebGPU and WGSL remain W3C Candidate Recommendation Drafts,
not final W3C Recommendations.
[W3C WebGPU publication history](https://www.w3.org/standards/history/webgpu/)
[W3C WGSL publication history](https://www.w3.org/standards/history/WGSL/)

## Browser and platform availability on 2026-07-21

WebGPU is widely deployed, but it is not yet a universal replacement for
WebGL2. MDN still labels the API “Limited availability” and requires a secure
context. The WebGPU working group's implementation table gives the more useful
platform detail.
[MDN WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
[GPU for the Web implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)

| Browser family | Stable coverage documented by the working group | Important gaps |
| --- | --- | --- |
| Chromium | macOS, Windows, and ChromeOS since 113; supported Android 12+ ARM/Qualcomm/Intel devices; selected Linux Intel/NVIDIA configurations in later releases | Android GPU/OS coverage is conditional; several Linux configurations and Windows ARM64 remain flagged or incomplete |
| Firefox | Windows since 141; Apple Silicon macOS coverage expanded in 145/147 | Linux remains Nightly, Android disabled by default, and other Mac hardware remains incomplete in the working-group table |
| Safari/WebKit | Safari 26 on macOS, iOS, iPadOS, and visionOS | Older Apple OS/browser combinations do not gain this support |

Safari 26's release notes confirm WebGPU shipped enabled on its Apple
platforms. Firefox 141's release notes confirm the Windows release. Chromium's
own release notes document the initial desktop release and the conditional
Android rollout.
[Safari 26 release notes](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
[Firefox 141 developer release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/141#apis)
[Chrome 113 WebGPU release](https://developer.chrome.com/blog/webgpu-release)
[Chrome 121 Android rollout](https://developer.chrome.com/blog/new-in-webgpu-121#support-webgpu-on-android)

Three's `WebGPURenderer` can automatically select WebGPU and fall back to its
own WebGL2 backend, which is valuable. However, that fallback runs the **new
TSL/node renderer architecture on a WebGL2 backend**. It does not make the
existing WebGL `EffectComposer` and GLSL component stack compatible with
`WebGPURenderer`.
[Three WebGPURenderer fallback](https://threejs.org/docs/pages/WebGPURenderer.html)

## Three.js, TSL, and React Three Fiber maturity

Three's new renderer provides:

- a WebGPU backend with an automatic WebGL2 backend fallback;
- TSL, a JavaScript-authored node shading language that can generate WGSL or
  GLSL for the selected backend;
- a new node-composed post-processing system with multiple-render-target
  support and pass combination;
- official TSL building blocks for effects including Bloom, Chromatic
  Aberration, Depth of Field, GTAO/denoising, and other modern effects.

[Three WebGPURenderer overview](https://threejs.org/manual/en/webgpurenderer)
[Three TSL specification and post-processing catalog](https://threejs.org/docs/TSL.html#post_processing)
[Three GTAO TSL source](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/tsl/display/GTAONode.js)

The same official guide also states that the renderer is experimental,
`EffectComposer` passes are unsupported, and custom GLSL materials or
`onBeforeCompile()` modifications must be rewritten as node materials/TSL.
This is an architectural migration, not a renderer substitution.
[Three WebGPURenderer migration limitations](https://threejs.org/manual/en/webgpurenderer#migration)

React Three Fiber 9 supports the renderer's asynchronous initialization: its
`Canvas` `gl` callback may return a promise. But R3F's own documentation still
describes WebGPU as work in progress and not fully backward-compatible with
Three's feature set. R3F makes the integration possible; it does not remove the
Three or post-processing compatibility work.
[R3F Canvas WebGPU guidance](https://github.com/pmndrs/react-three-fiber/blob/master/docs/API/canvas.mdx#webgpu)

## Direct consequences for Blendlink's component stack

Blendlink's current production installer deliberately requires a
`WebGLRenderer`, and its baked appearance modifies materials with
`onBeforeCompile`. The component pipeline types its renderer as
`WebGLRenderer` and constructs a `postprocessing` `EffectComposer`.
[Blendlink Three runtime](../packages/blendlink/src/threeRuntime.ts)
[Blendlink baked appearance](../packages/blendlink/src/bakedRecipe.ts)
[Blendlink component pipeline](../packages/blendlink/src/threeComponents.ts)

The external libraries reinforce that boundary:

- pmndrs `postprocessing` documents and types its composer around
  `WebGLRenderer`, `WebGLRenderTarget`, and WebGL context access.
  [postprocessing README](https://github.com/pmndrs/postprocessing#usage)
  [EffectComposer source](https://github.com/pmndrs/postprocessing/blob/main/src/core/EffectComposer.js)
- N8AO explicitly says it is not compatible with WebGPU yet.
  [N8AO WebGPU status](https://github.com/N8python/n8ao#webgpu)
- Blendlink's Kuwahara effect is a custom GLSL `postprocessing.Effect`, so it
  would require a TSL rewrite rather than automatic translation.
  [Blendlink Kuwahara source](../packages/blendlink/src/threeComponents.ts)

| Blendlink area | Current WebGL path | WebGPU/TSL implication |
| --- | --- | --- |
| Bloom, Vignette, Chromatic Aberration, DoF | pmndrs effects | Rebuild with official TSL nodes and prove parameter/pixel parity |
| Ambient Occlusion | N8AO | N8AO cannot carry over; evaluate Three GTAO + denoise as a separate adapter |
| Kuwahara | custom GLSL pmndrs effect | Rewrite the algorithm in TSL and build image/performance tests |
| Outline, Pixelation, Sharpen, Tilt Shift, LUT grading | pmndrs/custom WebGL path | Port effect-by-effect; availability of a similarly named node is not proof of equivalent semantics |
| Baked appearance/light groups | `onBeforeCompile` shader patching | Redesign as TSL/node material behavior before WebGPU can render the authored contract |
| glTF PBR scene content | ordinary Three materials/loaders | Mostly promising, but must be verified against Blendlink's actual material, texture, light, probe, animation, and alpha fixtures |

The WebGL2 fallback is still useful after these effects are written in TSL: one
TSL adapter could target both WebGPU and the new renderer's WebGL2 backend. It
does not reduce the initial porting cost, and it must not silently substitute a
different-looking effect when a capability is absent.

## Recommended adoption plan

### Production path now

1. Keep `WebGLRenderer` and the existing component runtime as the default.
2. Finish the component visibility, artist UX, reference-image, transparency,
   resize, lifecycle, and physical-device performance gates there first.
3. Treat better Bloom/Vignette/Kuwahara results as component-quality work, not
   as a reason to change renderer.

### Optional experimental path

1. Preserve renderer-neutral component records and service descriptors.
2. Build a separate internal TSL adapter rather than adding conditional branches
   throughout the WebGL adapter.
3. Start with a small representative vertical slice: unmodified glTF PBR,
   camera/lights/environment, baked appearance, Bloom, and one depth effect.
4. Use `WebGPURenderer`'s automatic WebGL2 backend to test whether one TSL
   implementation remains visually stable across both backends.
5. Keep it behind a developer-only experiment with loud unsupported-component
   diagnostics. Do not let Preview and published sites select different
   backends invisibly.

### Promotion gates

WebGPU should become an artist-visible Preview option only after:

- every shipped visual component has a TSL adapter or an explicit unavailable
  status, with no silent fallback;
- baked Appearance, Lighting, state changes, probes, KTX2 textures, animation,
  alpha, and tone mapping match the established reference fixtures;
- opaque and transparent canvases pass screenshot comparisons at common DPRs;
- Bloom, AO, Outline, DoF, and Kuwahara pass still and animated-camera tests;
- WebGPU and forced-WebGL2 TSL backends pass the same component scenes;
- Chrome/Edge, Safari, and Firefox are tested on real desktop hardware, plus
  representative iOS and Android devices;
- startup, steady-state GPU time, memory, shader compilation, and package size
  are measured against the WebGL default; and
- device loss, unavailable adapters, browser fallback, resize, reinstall, and
  disposal produce explicit recoverable behavior rather than a grey canvas.

Promotion to the default should require a measured win on representative
Blendlink scenes, not merely API availability. Until then, WebGPU belongs on the
roadmap as a serious parallel adapter—not as a feature-parity checkbox and not
as a dependency of the current component-quality pass.

## Bottom line

WebGPU is the future-facing foundation Blendlink should prepare for. Three's TSL
model is especially attractive because the same authored shader graph can
target WebGPU and the new renderer's WebGL2 backend. But the present Blendlink
runtime is intentionally and deeply WebGL-specific, while Three's renderer is
still experimental and the two core post libraries do not carry over.

**Use WebGPU to guide interfaces now; prototype it separately next; ship it only
after it earns parity. Keep WebGL as the reliable artist-facing path while the
current components are made genuinely excellent.**
