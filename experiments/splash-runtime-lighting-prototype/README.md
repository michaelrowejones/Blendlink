# PROTOTYPE — Splash lit-material and shadow recovery

This fixture answers two bounded questions against the exact retained
`blender40SplashSelectedSky` artifact:

1. Does opting into Blendlink's existing authoring-preview evidence recover
   the artist's shadow intent by itself?
2. If selected intrinsic fields are represented by ordinary lit
   `MeshStandardMaterial` receivers instead of `MeshBasicMaterial`, do the
   source Sun and shadow settings recover the missing right-wall structure?

It does **not** alter Blendlink's compiler or claim that converting an unlit
selected field is a correct production policy. The conversion happens only
after installation, in this disposable browser harness. `DP-SkyPaint.MAT`
remains unlit because the source sky is emissive geometry.

Build and capture:

```powershell
node node_modules/vite/bin/vite.js build --config experiments/splash-runtime-lighting-prototype/vite.config.mjs
node experiments/splash-runtime-lighting-prototype/capture.mjs <directory-containing-playwright>
```

Then evaluate any capture with the fixture-specific independent gates:

```powershell
node experiments/splash-visual-fidelity-differential/run.mjs `
  --candidate experiments/splash-runtime-lighting-prototype/browser-lit-shadow.png `
  --output experiments/splash-runtime-lighting-prototype/output/lit-shadow
```

The expected variants are:

- `baseline`: retained generated installation unchanged;
- `authoring`: existing `useAuthoringPreview` only;
- `lit`: selected fields converted to diffuse PBR receivers, without the
  authoring-preview shadow policy;
- `lit-shadow`: both changes.

## Result — red, 2026-07-24

All four production-browser captures loaded the exact retained GLB
(`8023cc4cada546f0...`), presented a non-zero WebGL2 canvas, and reported no
relevant page, console, request, or HTTP error.

The independent Eevee-relative gates remained red:

| Variant | Shadow band | Shadow range | Sky noise | Sky color error | Building luma detail | Building color detail | Building correlation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 0.268232× | 0.154057× | 1.630720× | 3.458311 | 0.042990× | 0.040908× | 0.045046 |
| authoring | 0.160217× | 0.046848× | 1.436203× | 1.126234 | 0.022445× | 0.026865× | 0.032910 |
| lit | 0.202933× | 0.116086× | 2.084766× | 3.477929 | 0.034417× | 0.036187× | 0.057366 |
| lit-shadow | 1.371301× | 0.131487× | 2.039379× | 1.126234 | 0.029435× | 0.032973× | 0.036793 |

The lit-plus-shadow candidate proves that a Three shadow map can place the
large right-wall occluder, but the result is nearly black and has only
`0.131487×` the reference luminance range. It also cannot recover image detail
that was omitted from the GLB. Therefore:

- defaulting the generated integration to authoring-preview evidence is not a
  material or shadow-fidelity fix;
- mechanically changing selected fields from unlit to diffuse PBR is not a
  valid compiler policy;
- enabling both is still not an Eevee approximation worth shipping.

The prototype rejects that two-line runtime remedy. A production design must
preserve the relevant intrinsic material closure and a bounded representation
of Eevee's lit/shadow response instead of inventing ambient light after export.

Evidence lives under `output/<variant>/evidence.json`; every run also rechecked
the three isolated negative controls.
