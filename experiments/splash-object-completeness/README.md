# Splash object-completeness prototype

**PROTOTYPE — diagnostic evidence, not production code.**

Question: are visible Blender 4.0 Splash objects omitted from the Blendlink
artifact, or are they present but visually lost after material/lighting
transport?

The probe renders a detached, raw EXR emission-ID pass at the authored camera,
records the exact source object responsible for every confidently interior
visible pixel, then compares the visible source names with the node inventories
of the Blendlink and bounded Needle GLBs. The source scene and source
datablocks are never saved.

Run from the repository root:

```powershell
node experiments/splash-object-completeness/run.mjs
```

The default inputs are the retained selected-sky source and the retained
Blendlink/Needle selected-sky GLBs. Results are written to
`experiments/splash-object-completeness/output/evidence.json`.
The command exits `3` while any named lamp/flowerpot focus object meets the
registered visual-collapse threshold, so the exact reported symptom remains a
red-capable regression signal.

The run also writes `object-appearance-overview.png`. Its columns are Eevee,
Blendlink stock/no selected-field lowering, Blendlink selected-field lowering,
bounded Needle, and the detached object-ID render; its rows are the lamp, left
hanging flowerpot, right hanging flowerpot, and ground flowerpot. The colored
strip at the top of each crop identifies the column.

The adjacent browser prototype tests one variable: generated unlit materials
stay unchanged except that materials whose every bound `COLOR_0.a` value is
exactly `1` are promoted from the transparent pass to opaque depth-writing
materials. Build and capture it with:

```powershell
node node_modules/vite/bin/vite.js build --config experiments/splash-object-completeness/vite.config.mjs --configLoader runner
node experiments/splash-object-completeness/capture.mjs C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\node_modules
```

Last evidence run, 2026-07-24 (Blender 5.2.0 LTS, Three.js 0.184.0,
Chromium 150):

- structural inventory: `208 / 208` directly visible source mesh names in
  Blendlink and Needle, with zero missing;
- selected-field baseline: 30 visually collapsed direct objects and all nine
  named lamp/flowerpot parts collapsed;
- same-GLB opaque-alpha prototype: four visually collapsed direct objects and
  zero named lamp/flowerpot parts collapsed;
- browser capture: nonblank WebGL output with zero page or console errors in
  both baseline and prototype modes.

## Production evidence closure

After a corrected selected-sky Final publish, first capture the production
browser, refresh the selected-sky visual-reference matrix against the current
saved `.blend`, rerun this object audit, and write a fresh Splash
visual-fidelity differential to the default production evidence directory.
Then run:

```powershell
node experiments/splash-object-completeness/verify-production.mjs
```

The gate checks that the manifest and visual-reference matrix refer to the
current saved `.blend`; that all other evidence refers to the same published
GLB and browser PNG; that all nine lamp/flowerpot focus objects recover; that
no more than the opaque-alpha prototype's four meaningful direct objects
remain collapsed; that the focus materials are attested opaque, lit stock PBR
carriers; that the fixture-specific shadow gate passes; and that sky/building
metrics do not regress from the retained pre-fix Blendlink capture. It also
pins the retained Eevee and coherent Needle screenshots by SHA-256.

This command deliberately does not replace the browser capture, object audit,
or visual differential. It only binds their independent evidence together and
will fail if any input is stale. Use `--fidelity <path>` (and the other
documented `--name <path>` pairs in the script) when retaining a differently
named candidate directory.
