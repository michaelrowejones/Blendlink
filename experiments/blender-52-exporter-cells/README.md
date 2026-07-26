# Blender 5.2 exporter capability cells

This experiment creates three compact `.blend` fixtures and compares:

1. Blender 5.2.0 LTS with its installed glTF exporter 5.2.39;
2. the stock exporter invocation used by pinned Needle Blender add-on 1.4.2;
3. Blendlink 0.8.0 zero-configuration planning/compilation; and
4. structural loading through installed Three.js r184 `GLTFLoader`.

Run from the repository root:

```powershell
node experiments/blender-52-exporter-cells/run.mjs
```

The runner owns only `experiments/blender-52-exporter-cells/output/`. It
regenerates the fixtures, stock GLBs, source identity, Blendlink artifacts, and
`evidence.json`. A pass ends with
`BLENDLINK_BLENDER_52_EXPORTER_CELLS_PASSED`.

This is a structural and loader evidence cell. It does not claim browser pixel
parity or reproduce Needle's licensed production transform.

The three relaxed Blendlink diagnostics exercised here are capability-gated
to the exact inspected glTF exporter version 5.2.39. Older, newer, or unknown
exporter revisions retain conservative material diagnostics until separately
pinned and verified.
