# Texture sampling browser gate

This focused gate exercises Blendlink's package-owned texture-sampling module
against a real Three r184 `WebGLRenderer`. It inspects the native WebGL sampler,
not only the JavaScript property, across numeric 4, renderer maximum, shared
leases, and restoration.

Run from the repository root:

```powershell
npm.cmd run build --workspace blendlink
node experiments/texture-sampling-browser/run.mjs
```

The gate deliberately uses SwiftShader when a system Chromium is available. It
is functional browser evidence, not physical-GPU performance evidence.
