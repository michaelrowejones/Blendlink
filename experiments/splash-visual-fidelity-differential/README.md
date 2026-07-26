# Splash visual-fidelity differential (prototype)

## Question

Can one deterministic, seconds-scale command independently detect the three
defects reported in the current Blendlink rendering of Blender's 4.0 Splash
scene: lost façade shadow information, a noisy or chromatically incorrect sky,
and missing building-surface texture/detail?

This is deliberately a fixture-specific prototype, not a universal
"visual-parity percentage". It evaluates the authored 1200×600 camera against
the captured Eevee frame that is the source of truth.

## Run

From the repository root:

```powershell
node experiments/splash-visual-fidelity-differential/run.mjs
```

To evaluate a corrected capture:

```powershell
node experiments/splash-visual-fidelity-differential/run.mjs --candidate C:\path\to\corrected.png
```

The process exits nonzero if any symptom remains. Generated masks,
side-by-side diagnostics, and `evidence.json` are written to `output/`.

Every run also executes three deterministic isolated-negative controls. Each
starts with the exact Eevee reference and changes only one authored semantic
region: it flattens the shadow zones, perturbs the sky pixels, or flattens the
wall-texture patch. The harness refuses to trust itself unless each synthetic
candidate fails exactly its intended symptom while the other two gates pass.

## Evidence model

- **Shadow information:** Three fixture-authored, obstruction-light wall zones
  measure broad (roughly 8–60 px) luminance structure and the 10th–90th
  percentile luminance range. Both must retain at least 72% of the Eevee
  reference. This measures cast-shadow structure, not global brightness.
- **Sky:** Reference-blue pixels inside two authored background zones form the
  mask. Candidate local RGB noise may be at most 1.25× reference noise, and
  median chromatic error may be at most two of the reference sky's own 90th
  percentile local RGB spreads.
- **Building texture:** A flat left-façade patch avoids the roof, window, and
  right-wall cast shadows. Reference-derived interior pixels exclude the
  strongest cable/lantern edges. Candidate luminance and RGB detail must each
  retain at least 70% of the reference, the local pattern must correlate by at
  least 0.65, and its RMS pattern error must stay below 0.7 reference-detail
  units.

Every acceptance threshold is a ratio or spread derived from this exact Eevee
reference. The values are review tolerances for this differential—not claims
that 70%, 72%, or 1.25× defines visual parity for other scenes.

Passing the Eevee reference back as `--candidate` is the positive control and
must pass. The current Blendlink browser capture is the red control and should
fail the reported symptoms until rendering materially improves.
