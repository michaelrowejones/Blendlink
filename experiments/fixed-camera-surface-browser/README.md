# Fixed-camera surface browser differential

This focused prototype executes the package-owned Three projector on one
explicitly identified static opaque receiver while retaining a second unrelated
material binding. It verifies real WebGL shader compilation and pixels,
geometry/raycast preservation, wrong-aspect and moved-camera refusal, and
reversible teardown.

Run from the repository root:

```powershell
npm.cmd run test:fixed-camera-surface-browser
```

Evidence is written to `output/evidence.json` with before/after screenshots.
The capability remains **Prototype**: this fixture does not publish the capture
through the compiler manifest or runtime asset graph.
