# PROTOTYPE — EEVEE UV materializer

Question: can Blendlink rasterize UV-authored color/material data through an
EEVEE-rendered Geometry Nodes UV canvas quickly, deterministically, and closely
enough to justify a production prototype alongside the existing Cycles baker?

This is throwaway evidence code. It does not participate in Blendlink builds
and must not be imported by production code.

Run the interactive prototype:

```powershell
npm run prototype:eevee-materializer
```

Press `r` to generate the Blender 5.2 fixture and measurements. For a non-
interactive run:

```powershell
npm run prototype:eevee-materializer -- --run
```

Generated evidence is written under `output/`. The experiment compares two
identical EEVEE renders for determinism, compares a portable emission material
against a Cycles emission bake, and separately proves that an EEVEE-only Shader
to RGB material can be captured. It intentionally does not implement margins,
normal baking, AO, GI, or production integration.

## First result — 2026-07-19, Blender 5.2.0 LTS

At 256×256 on the generated two-island fixture:

- repeat decoded-pixel RMSE: `0.0` (deterministic pixels; PNG metadata made the
  whole-file hashes differ);
- stable flat-region EEVEE/Cycles emission RMSE: `0.000411`;
- all-interior RMSE: `0.060050`, concentrated around procedural checker
  transitions where raster antialiasing and bake sampling differ;
- EEVEE: `0.622 s` cold, `0.077 s` warm;
- Cycles emission bake: `0.008 s`;
- Shader to RGB output: captured successfully over the expected `65.6%` UV
  coverage.

Verdict: the mechanism is viable for appearance that only EEVEE can evaluate,
but the experiment provides no speed justification for replacing Cycles on
portable emission/data materials. Do not integrate yet. The next fixture must
cover alpha/decal margins, MikkTSpace normal detail with mirrored islands,
coordinate-dependency rejection, and representative 1K/4K workloads.
