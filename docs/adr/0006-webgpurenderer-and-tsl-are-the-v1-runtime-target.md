# WebGPURenderer and TSL are the v1.0 runtime target

Status: accepted on 2026-07-27

Blendlink's generated integration currently targets Three's `WebGLRenderer`.
Reaching materials that baking can never reproduce — view-dependent optics such
as Fresnel, Layer Weight, and glass — requires evaluating the authored graph at
runtime, and the only portable way to do that in Three is TSL node materials,
which run on `WebGPURenderer`. v1.0 therefore targets `WebGPURenderer` and TSL.
The v0.x line stays on `WebGLRenderer` and gains the Material bake, which
produces ordinary glTF and is not invalidated by the migration.

## Considered options

**Dual-target both renderers.** Rejected. Two renderer paths with different
material capabilities means one `.blend` has two different pixel results, and
every gate that makes Blendlink credible — byte attestation, the Khronos
corpus, the Needle baseline, the Chromium component fixtures — would need forked
expectations. Blendlink's differentiator is proving what the browser actually
sampled; doubling the evidence burden attacks exactly that.

**Stay on `WebGLRenderer` permanently.** Rejected as a ceiling rather than a
choice: view-dependent materials would never be reachable, and `trapx-painterly`
and comparable scenes would stay permanently refused.

## Why the reach cost is lower than it looks

`WebGPURenderer` provides a WebGL2 backend and falls back automatically, so
migrating does not reduce end-user device support. What changes is the
application's renderer construction — and Blendlink generates that integration.

## Consequences

- `onBeforeCompile` is unavailable. The four current call sites — `bakedRecipe`,
  `threeContactShadows`, `threeFixedCameraAppearance`, `threeShadowCatcher` —
  become node graphs, which is a simplification rather than a loss.
- The legacy `EffectComposer` path is unavailable. The pinned
  `postprocessing@6.39.3` and `n8ao@1.10.2` dependencies back 11 of the 21
  shipped Components. **Measured 2026-07-27 (WGPU-PP-001,
  `experiments/wgpu-postprocessing-parity`): they do not run against
  `WebGPURenderer` at all.** On a native WebGPU backend the `WebGLRenderer`
  control runs 13/13 effect configurations while 0/13 construct against
  `WebGPURenderer` — every one fails inside `EffectComposer`'s constructor
  (`renderer.getContext(...).getContextAttributes is not a function`), so
  pixel identity has zero comparable pairs. The migration therefore cannot
  carry these libraries: the eleven post-processing Components need a
  replacement pipeline (three's TSL node post-processing, a ported library,
  or per-effect rewrites), each with pixel evidence against the current
  WebGL output, and the tuned effect-fusion semantics in
  `ThreePostPipelineService` do not transfer. The reshaped replacement plan —
  three's in-tree TSL display nodes cover 8 of the 11 effects; vignette,
  tilt-shift, and kuwahara become small Blendlink-owned TSL nodes; N8AO→GTAO
  is a named look change requiring side-by-side evidence — is recorded in
  [research-wgpu-post-replacement-2026.md](../research-wgpu-post-replacement-2026.md).
- The exact `three@0.184.0` pin is re-attested against a faster-moving surface
  than `WebGLRenderer` presented.
- Every browser gate and visual baseline is re-established against the new
  renderer.
- Material intent is compiled by a Blendlink-owned node compiler, not by
  Blender's MaterialX export (ADR 0005). Nothing enters that compiler without
  passing a per-node differential against Blender's own evaluation.
- The Material bake remains correct and useful after the migration, because
  baked channels are ordinary glTF textures that render identically on both
  renderers.
