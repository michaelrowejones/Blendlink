# WGPU-PP-001 — pinned post-processing against WebGPURenderer

ADR 0006's first milestone: eleven of the shipped Components are
post-processing effects backed by exact pins `postprocessing@6.39.3` and
`n8ao@1.10.2`, and the v1.0 TSL migration cannot be planned until their fate
under `WebGPURenderer` is measured — not assumed. Two separate questions,
never conflated:

1. Do the exact pinned versions run at all against `WebGPURenderer`?
2. Where both backends render, are the pixels identical?

## Reproduce

```bash
node experiments/wgpu-postprocessing-parity/run.mjs
```

Requires local Chrome/Edge (the harness passes `--enable-unsafe-webgpu`) and
the repository `node_modules`. The run refuses to execute if the installed
`three`/`postprocessing`/`n8ao` versions have moved off the pinned answer.
The sentinel `BLENDLINK_WGPU_PP_MEASURED` means the measurement completed;
the answers live in `output/evidence.json`.

## Measured result — 2026-07-27

Environment: Chromium headless with a **native WebGPU backend** (NVIDIA
Blackwell adapter, `renderer.backend.isWebGPUBackend === true`), three
`0.184.0`, one deterministic scene, fixed camera, 384×384, dpr 1.

| Cell | Result |
| --- | --- |
| `WebGPURenderer` plain scene (no composer) | **renders** |
| `WebGLRenderer` control, all 13 effect configurations | **13/13 run** (incl. `N8AOPostPass`) |
| `WebGPURenderer` + pinned post-processing, all 13 configurations | **0/13 run** |
| Comparable pixel pairs for question 2 | **0** |

**Question 1: NO.** Every configuration — a bare
`EffectComposer`+`RenderPass`, every built-in effect the production
`ThreePostPipelineService` constructs (ToneMapping, Bloom, SelectiveBloom,
Vignette, ChromaticAberration, Pixelation, TiltShift, Outline, LUT3D,
DepthOfField), a custom `Effect`-subclass probe standing for the shipped
CAS/Kuwahara shaders, and `N8AOPostPass` — fails at the same phase,
`construct-composer`:

```
TypeError: renderer.getContext(...).getContextAttributes is not a function
```

`EffectComposer`'s constructor immediately reads WebGL context attributes
from the renderer, an API `WebGPURenderer` does not provide. The pinned
library cannot even construct against `WebGPURenderer`; effect semantics,
convolution splitting, and tone-map ordering are never reached.

**Question 2: moot** — zero comparable pairs exist. "Runs identically" is
not merely false; there is nothing to compare.

## What this bounds

- The v1.0 `WebGPURenderer` migration cannot carry `postprocessing@6.39.3`
  or `n8ao@1.10.2`. The eleven post-processing Components need a
  replacement pipeline (three's own TSL node-based post-processing, a
  ported library, or per-effect TSL rewrites), and every replacement needs
  its own pixel evidence against the current WebGL output before any
  Component can claim continuity.
- The tuned effect-fusion behavior in `ThreePostPipelineService` (lazy
  pipeline, compatible-effect fusion, single tone-map ordering) is
  calibrated to this library's semantics and does not transfer.
- Limits: one scene, one machine, same-run comparison; a WebGL2-fallback
  `WebGPURenderer` would measure the fallback path, and the harness records
  which backend actually ran (`webgpuBackendReal`).

---

# WGPU-NODE-001 — the replacement pipeline, per effect (Phase 4 Track 0)

The positive counterpart: the same deterministic scene rendered through the
node-based pipeline (`RenderPipeline` + three's in-tree TSL display nodes +
`n8ao-webgpu@0.1.0`), one cell per production effect configuration, on BOTH
`WebGPURenderer` backends — native WebGPU and the WebGL2 fallback
(`forceWebGL: true`) — beside the pinned pmndrs WebGL stack as the
look-continuity control.

## Reproduce

```bash
npm run test:wgpu-node-postprocessing
```

The sentinel `BLENDLINK_WGPU_NODE_MEASURED` means the measurement completed;
a non-zero exit is the gate (any cell failing to construct/render on either
backend, non-finite pixels, black frames, or an expected-active effect whose
pixels match the no-effect baseline). Evidence: `output/node-evidence.json`.

## Measured result — 2026-07-27

**Native 14/14 · WebGL2 fallback 14/14 · control 13/13 · 0 gate failures.**
Cells: render-pass-only, tone-mapping, bloom, selective-bloom (emissive
MRT), chromatic-aberration, pixelation, outline, lut3d (neutral 32³),
depth-of-field, custom TSL probe, n8ao, traa, fxaa, smaa. Named non-cells
(`pendingTrackB`): vignette, tilt-shift, kuwahara — they wait on the
Blendlink-owned display nodes and the run enforces the list stays honest.

**Update (same day): 19/19 · 19/19 · 0 failures.** The five
Blendlink-owned display nodes shipped in `blendlink/three/tsl-effects`
(`packages/blendlink/src/tslPostEffects.ts`) and the `pendingTrackB` list
is now empty: vignette, tilt-shift, kuwahara (anisotropic,
structure-tensor, 4×16-sample TSL Loop), radial-chromatic-aberration
(center/aspect math), and geometry-pixelation (MRT `directionToColor`
normals + view-Z reconstruction, shipped 0.82 edge darkening). Each
mirrors the shipped GLSL from `threeComponents.ts`. Measured:
cross-backend mean-luma delta ≤ 0.015 on all five (deterministic ports);
vignette 1.87 / tilt-shift 0.87 mean luma vs the pmndrs control even
though the control algorithms differ (eskil vignette, kernel-blur
tilt-shift).

Cross-backend (native vs fallback, same algorithm, mean-luma delta):
≤ 0.29 on every cell except `n8ao` (7.9–11.8 across runs — its temporal
blue-noise accumulation is not converged at 3 warm-up frames; a tighter
per-effect threshold needs convergence or accumulation pinned).

Look continuity vs the pmndrs control (mean-luma delta, context not gate):

| Cell | Delta | Reading |
| --- | --- | --- |
| render-pass-only | 0.01 | base image parity — readback verified |
| custom TSL probe | 0.00 | custom Blendlink nodes are viable |
| chromatic-aberration / outline / lut3d / pixelation | ≤ 0.49 | direct continuity |
| tone-mapping | 5.2 | different operator by design (pmndrs effect vs `renderOutput`) |
| depth-of-field | 13.6 | unit conventions differ (normalized CoC vs view-Z) — Track B maps parameters |
| selective-bloom / bloom | 26 / 93 | pmndrs luminance threshold 0.9 vs node threshold 0 — Track B maps parameters |
| n8ao | 68.4 | `n8ao-webgpu` defaults ≠ old `N8AOPostPass` defaults — Track B maps the authored AO config and re-measures |

Measured traps encoded in the instrument:

- WebGPU canvases may present-and-clear before a `drawImage` capture; node
  cells read back through an explicit `RenderTarget` +
  `readRenderTargetPixelsAsync` (the proven tsl-node-differential pattern).
- The readback target must keep the default (no) color space:
  `renderOutput` already encodes sRGB in-shader, and an `SRGBColorSpace`
  target hardware-encodes AGAIN on write (measured: baseline luma 144 vs
  the control's 79 — double-encode wash-out).
- Upstream r184 bug: `chromaticAberration()`'s default `center = null` is
  documented as "screen center" but `setup()` forwards the null into a
  declared `vec2` parameter — output renders black. Pass
  `vec2(0.5, 0.5)` explicitly.
- `n8ao-webgpu@0.1.0` peers `three@^0.182.0`, which excludes the pinned
  `0.184.0` (0.x caret semantics); the root `package.json` carries an
  `overrides` entry pinning its peer to our three. Its real drift surface
  is `NodeMaterial`/`QuadMesh`/`RendererUtils`/`TempNode` plus ~40 TSL
  helpers (verified: it does NOT import the deprecated `PostProcessing`
  alias) — re-measure on any three move, and vendor the pass (CC0-1.0) the
  moment it lags.
