# Splash Final selected-field density check

This one-variable check asks whether the coarse/noisy Splash result was caused
by the Preview tier's 1024 px selected-field ceiling.

The unchanged selected-sky fixture was compiled and published at the Final
tier. Its generated evidence reports:

- selected field resolution: 2048 by 2048;
- projected-density ratio: `1.725147455818445`;
- projected-density target met: `true`;
- browser-loaded GLB SHA-256:
  `5f35c83835716a735deb39512013d3ada0d720b661cda48df44bf9830ba30d20`;
- browser-loaded GLB bytes: `39,823,320`; and
- successful HTTP, WebGL, nonblank-canvas, and browser-error assertions.

Run the retained production capture with:

```powershell
node experiments\splash-final-sky-density\capture.mjs `
  C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\node_modules
```

Run the fixture-specific visual differential with:

```powershell
node experiments\splash-visual-fidelity-differential\run.mjs `
  --candidate experiments\splash-final-sky-density\output\browser-final-selected-sky.png `
  --output experiments\splash-final-sky-density\output\visual-gates
```

The visual command is expected to exit nonzero. The Final candidate still
fails every complete semantic gate:

| Gate | Final result |
| --- | ---: |
| Shadow broad-band ratio | `0.268231` |
| Shadow luminance-range ratio | `0.154057` |
| Sky local-noise ratio | `1.845976` |
| Sky median-color error | `3.447755` reference spreads |
| Building luminance-detail ratio | `0.042990` |
| Building color-detail ratio | `0.040908` |
| Building reference-pattern correlation | `0.045046` |

The shadow and building measurements are effectively unchanged from the
1024 px Preview candidate. Sky local variation is worse, not better. This
rejects atlas resolution as the primary explanation for these three defects.
The remaining loss is in material/lighting semantics: the selected intrinsic
field omits downstream EEVEE shading, and the dominant building material omits
its independent vertex mask plus mapped/ramped packed image.

This is prototype evidence, not a production-quality claim and not a generic
scene-quality metric.
