# Mixed-Hybrid material-fidelity differential

This is the smallest real Blender 5.2 fixture for Blendlink's
occurrence-aware Hybrid material gate. It generates one source `.blend` with:

- one static Appearance receiver;
- one explicit Dynamic survivor sharing the Appearance receiver's same
  `needsBake` active-Surface material; and
- one Lighting receiver with a different `needsBake` active-Surface material.

Both procedural graphs are Cycles-compatible. Preview and Final planning must
therefore exempt only `Appearance Receiver`; `Dynamic Survivor` and
`Lighting Receiver` remain loud material-fidelity errors.

The runner then seeds a valid last-good GLB, schema-3 manifest, and valid
generated TypeScript module. A forced Final compile must refuse before
publication, preserve every seeded byte, remove its complete staging
directory, and publish no companion files.

Run from the repository root after `npm run build`:

```powershell
node experiments/hybrid-material-gate-differential/run.mjs
```

`BLENDLINK_BLENDER_52` and `BLENDLINK_NEEDLE_ADDON_ROOT` may override the
pinned local defaults. Generated working files live under ignored `output/`;
the exact run identity and result are written to `evidence.json`.

This is a structural/compiler transaction gate. It does not claim browser
pixels, bake quality, or a coherent authenticated Needle production build.

