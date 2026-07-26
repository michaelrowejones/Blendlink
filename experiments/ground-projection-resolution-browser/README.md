# GroundedSkybox photographic resolution differential

This real-Chromium fixture compares the current Three.js `GroundedSkybox`
implementation at explicit geometry resolutions 64 and 128. Both renders in
each pair share one renderer context, photographic EXR texture instance,
camera, capture height, radius, output transform, and render target.

Run:

```powershell
node experiments/ground-projection-resolution-browser/run.mjs
```

The deterministic gate writes:

- `artifacts/ground-projection-resolution-browser-2026/evidence.json`
- `artifacts/ground-projection-resolution-browser-2026/grounded-skybox-resolution-grid.png`
- one three-column screenshot per camera

The declared safety budget permits at most RGB MAE 1, RGB RMSE 6, and 3% of
pixels with any RGB-channel error greater than 8, independently for each
tested camera. Resolution 64 exceeded that budget: the observed worst case
was MAE 2.2264, RMSE 6.4582, and 7.615% of pixels over 8. The deterministic
gate therefore records and protects the current recommendation to retain
resolution 128.

Resolution 64 uses 16,128 triangles and resolution 128 uses 65,024, a 75.2%
triangle-count reduction. That is geometry evidence only. The fixture does
not use GPU timer queries and makes no GPU-speed, frame-rate, power, or memory
claim.
