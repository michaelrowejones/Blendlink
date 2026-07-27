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
