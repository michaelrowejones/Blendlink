# R3F Orbit demand-loop browser gate

This focused production-browser experiment proves the artist-authored Orbit
camera can sleep inside a website-owned React Three Fiber
`frameloop="demand"` Canvas without freezing input or Three's damping.

Run from the repository root:

```powershell
node experiments/r3f-orbit-demand-browser/run.mjs
```

The gate builds the production Blendlink package, type-checks this fixture,
drives a real pointer drag in Chromium, and records:

- a visible initial render followed by a stable idle render count;
- native Orbit input waking the website-owned demand Canvas;
- multiple follow-up renders while Three reports damping work;
- a changed authored camera pose;
- a second stable idle interval after damping settles;
- no page, console, or harness errors.

Unknown application-supplied controls deliberately remain conservative and
continue requesting frames. Only Blendlink's built-in Orbit adapter uses the
live activity proof.

Primary implementation evidence is pinned by SHA-256 in `output/evidence.json`
for Blendlink's production R3F/Three adapters, R3F's loop, and Three r184's
`OrbitControls`.

Limits: this is Chromium/ANGLE SwiftShader, one perspective Orbit camera, and
mouse rotation. It does not establish touch, keyboard, orthographic,
free-flight, XR, WebGPU, physical-GPU, LOD, or post-processing performance.
