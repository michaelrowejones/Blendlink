# Replacing the pinned post-processing stack for WebGPURenderer

- Date: 2026-07-27
- Follows: [WGPU-PP-001](TECHNIQUE_LEDGER.md) (measured negative — the pinned
  `postprocessing@6.39.3` and `n8ao@1.10.2` cannot construct against
  `WebGPURenderer`; `experiments/wgpu-postprocessing-parity`) and
  [ADR 0006](adr/0006-webgpurenderer-and-tsl-are-the-v1-runtime-target.md).
- Status: **approved direction** for the reshaped Phase 4; implementation and
  per-effect pixel evidence remain future work.

## Measured replacement inventory

Enumerated from the exact pinned `three@0.184.0` package on disk
(`node_modules/three/examples/jsm/tsl/display/`), not from documentation.
Three's node-based `PostProcessing` pipeline plus these TSL display nodes
cover most of Blendlink's eleven shipped post-processing Components in-tree:

| Component | pmndrs class today | three 0.184 TSL replacement | Gap class |
| --- | --- | --- | --- |
| Bright/Selective Bloom | `BloomEffect` / `SelectiveBloomEffect` | `BloomNode` | selective masking needs a Blendlink design (layers/MRT mask) |
| Vignette | custom `Effect` | — | small Blendlink-owned TSL node (uv math) |
| Chromatic Aberration | `ChromaticAberrationEffect` | `ChromaticAberrationNode` | direct |
| Pixelation | `PixelationEffect` | `PixelationPassNode` | direct |
| CAS / Sharpen | custom `Effect` | `SharpenNode` | direct |
| Tilt Shift | `TiltShiftEffect` | `GaussianBlurNode` + focus-mask math | small Blendlink-owned composition |
| N8AO Ambient Occlusion | `N8AOPostPass` | `GTAONode` | **different algorithm** — the largest look-continuity risk |
| Outline | `OutlineEffect` | `OutlineNode` | direct |
| 3D LUT Color Grading | `LUT3DEffect` | `Lut3DNode` | direct |
| Depth of Field | `DepthOfFieldEffect` | `DepthOfFieldNode` | direct |
| Kuwahara | custom `Effect` | — | small Blendlink-owned TSL kernel |

Tone mapping ordering — today owned by the tuned fusion service — is native
to the node pipeline (`RenderOutputNode`), which removes the single-tone-map
ordering machinery rather than porting it.

## Evidence contract for the port

- Per effect: a deterministic-camera Chromium fixture comparing the new TSL
  output against the **current pmndrs WebGL output** on the same scene.
  Deltas are measured and recorded; direct replacements are expected to be
  near, Blendlink-owned rewrites are tuned to match, and the N8AO→GTAO cell
  is expected to differ — that difference is a named product decision with
  side-by-side evidence, never a silent swap.
- The fusion service's semantics (lazy pipeline, compatible-effect fusion)
  do not transfer; the node pipeline builds one graph instead. Resolved-order
  reporting survives as a report over the node graph.
- Dependency consequence: `postprocessing` and `n8ao` leave the dependency
  graph at v1.0; v0.x keeps them untouched.

## Open before implementation

1. Selective Bloom masking design on the node pipeline.
2. N8AO-vs-GTAO look-continuity policy (tuned defaults + the side-by-side
   gate's acceptance statement).
3. Whether `three/webgpu`'s `PostProcessing` runs acceptably on the
   WebGL2 fallback backend — the same harness
   (`experiments/wgpu-postprocessing-parity`) extends to measure it.
