# MTLX-TSL-001 — the per-node differential harness

The non-negotiable gate for the Blendlink-owned Blender-node → TSL material
compiler: nothing enters the compiler without a cell here. Each cell renders
one node configuration on both engines and diffs raw linear floats —
channel-level numeric claims, never appearance parity.

- **Blender side**: the cell's graph drives an isolated EMIT proxy and bakes
  one 0..1 UV tile through the shipped Material-bake machinery
  (`bakelib.uv_tile_proxy` + `bake_channel_field_pixels`) — exact channel
  isolation, deterministic single-sample Cycles evaluation, no lighting, no
  view transform, raw float32 output.
- **TSL side**: the hand-written TSL mapping the future compiler must emit,
  rendered with `MeshBasicNodeMaterial.colorNode` over a unit-UV quad on
  `WebGPURenderer` into a `FloatType` render target and read back as floats.
  No canvas, no tone map, no sRGB encode.
- **Gate**: per-cell meanAbs / p99Abs / maxAbs tolerances declared in
  `cells.json`.

## Reproduce

```bash
node experiments/tsl-node-differential/run.mjs
```

`BLENDLINK_TSL_DIFF_REUSE=1` skips re-baking the Blender reference.
Evidence: `output/evidence.json`; both float fields are retained under
`output/reference/` and `output/rendered/`.

## Measured results — 2026-07-27

Blender 5.2.0 (Cycles/OptiX reference) versus three 0.184.0 TSL on a native
WebGPU backend, 64×64, six cells, six gated, all passing:

| Cell | Failure class exercised | meanAbs | maxAbs |
| --- | --- | --- | --- |
| constant-linear | colorspace calibration | 0.0 | 0.0 |
| uv-gradient | coordinate-space mismatch | 1.6e-5 | 3.1e-5 |
| math-compare | inverted logic nodes | 0.0 | 0.0 |
| mapping-rotate | rotate2d/place2d matrix order | 4.5e-6 | 1.1e-5 |
| colorramp-linear | corpus-priority node (ColorRamp) | 9.3e-6 | 2.1e-5 |
| noise-mx-divergence | disagreeing noise implementations | 4.1e-5 | 1.2e-4 |

Findings the harness itself produced:

1. **The "UV upside down" trap is real and was caught on run one**: WebGPU
   float readback returns rows top-down while Blender's bake buffer is
   bottom-up. The uv-gradient cell measured it (green channel inverted,
   mean 0.167) and the decode-site flip in `run.mjs` records the
   measurement.
2. **Blender's base Perlin octave and three's `mx_noise_float` agree to
   1.2e-4** over a real 0.67-span field. The published
   "slightly different hash → completely different pattern" class did not
   apply to this pairing — the base octave shares an implementation
   lineage. The cell is now a gated regression. The claim is bounded to
   exactly this configuration: fractal detail, roughness, lacunarity,
   distortion, 4D, and Voronoi remain unproven.
3. Cycles-on-OptiX and TSL-on-WebGPU agree to ~1e-5 on every proven cell —
   float rounding, not approximation.

## Limits

- Hand-written TSL mappings stand in for the future compiler's output: a
  cell proves the mapping, and the compiler must emit exactly that mapping.
- One configuration per cell; per-node parameter/enum sweeps are the next
  stage, then bounded random-graph composition over the proven allowlist.
- Evidence is valid for the exact (Blender 5.2.0, three 0.184.0) pair and
  re-runs when either pin moves.
